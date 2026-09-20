/**
 * Dynamic one-shot particles (plan 089/01) — the spawn-driven lane the baked 2dfx path cannot be.
 *
 * The baked lane (B6) uploads once per cell-set change and loops its whole lifecycle in the vertex shader;
 * nothing there can start at a moving point, scale with what a tyre is doing, or stop. This lane owns a CPU
 * pool per blend mode: a spawn stamps the SAME 9-float record the baked lane uses, with the PHASE set to
 * minus the spawn time — so the shared shader arithmetic plays the particle exactly once (the `oneShot`
 * pipeline override clamps the age instead of looping it). Dead records are swap-removed on the same clock
 * the shader animates with; pruning on any other clock flashes a reborn particle for a frame.
 *
 * The GPU side is the CORONA pattern, not `setParticles`': every buffer and the atlas are created ONCE when
 * the library is installed, and a frame costs at most one partial `writeBuffer` per blend mode — nothing is
 * created or destroyed per frame.
 */
import type { Resources } from '../core/resources';
import type { PipelineId, PipelineSet } from './pipelines';

/** Floats per instance — must match the particle pipelines' vertex layout (spawn, velocity, life/phase/system). */
const STRIDE = 9;

/**
 * Particles per blend mode — the lane's hard budget (089 readme: budget-capped, designed in). A full pool
 * DROPS new spawns rather than growing: 1024 × 36 B = 36 KB per buffer, and ~2 k live billboards is already
 * far past what tyre smoke + impact puffs around one player should ever hold.
 */
export const DYNAMIC_PARTICLE_CAP = 1024;

/** The sprite atlas + baked system records the lane draws with — same shapes as the baked upload. */
export interface DynamicParticleLibrary {
  /** Per system: additive pipeline (fire, sparks) or the alpha-blend one (smoke)? Indexed by systemIndex. */
  additive: readonly boolean[];
  /** RGBA8 sprite layers, all one size, packed sequentially. */
  atlas: { height: number; layers: number; rgba: Uint8Array; width: number };
  /** Baked systems, FX_SYSTEM_STRIDE floats each. */
  systems: Float32Array;
}

/** One blend mode's half of the lane: its pool, its persistent instance buffer, its pipeline. */
interface DynamicLaneHalf {
  buffer: GPUBuffer;
  dirty: boolean;
  pipeline: PipelineId;
  pool: DynamicParticlePool;
}

/**
 * A packed pool of live one-shot particles. Everything is preallocated: a spawn writes 9 floats, a death is
 * a swap-remove — no allocation per particle, ever. `data[0, count × 9)` is always upload-ready.
 */
export class DynamicParticlePool {
  count = 0;

  /** Packed instance records; the live range is [0, count × STRIDE). */
  readonly data: Float32Array;

  /** Absolute death time (seconds on the shader's clock), parallel to the packed records. */
  private readonly deaths: Float64Array;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * STRIDE);
    this.deaths = new Float64Array(capacity);
  }

  /** Swap-remove every particle whose death time has passed. Returns true when the pool changed. */
  prune(now: number): boolean {
    let changed = false;
    for (let index = this.count - 1; index >= 0; index -= 1) {
      if (this.deaths[index] > now) {
        continue;
      }
      const last = this.count - 1;
      if (index !== last) {
        this.data.copyWithin(index * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
        this.deaths[index] = this.deaths[last];
      }
      this.count = last;
      changed = true;
    }

    return changed;
  }

  /** False when the pool is full or the life is not positive — the spawn is DROPPED, not queued. */
  spawn(
    now: number,
    life: number,
    systemIndex: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    alpha = 1,
  ): boolean {
    if (this.count >= this.capacity || life <= 0) {
      return false;
    }
    const at = this.count * STRIDE;
    const data = this.data;
    data[at] = x;
    data[at + 1] = y;
    data[at + 2] = z;
    data[at + 3] = vx;
    data[at + 4] = vy;
    data[at + 5] = vz;
    data[at + 6] = life;
    // The shader ages every instance as (clock + phase) / life — a phase of minus the spawn time makes
    // that THIS particle's own age, and the one-shot pipelines clamp it instead of looping.
    data[at + 7] = -now;
    // Per-spawn opacity rides the FRACTION of the system slot (089/02 round 2): the shader reads
    // 1 − fract(z), so an integer slot — every baked instance, and the default here — stays fully opaque
    // and the instance layout never changes. 0.999 floors the encodable alpha just above zero.
    data[at + 8] = systemIndex + Math.min(0.999, Math.max(0, 1 - alpha));
    this.deaths[this.count] = now + life;
    this.count += 1;

    return true;
  }
}

/** The installed lane: pools + the GPU resources they draw with. Created once, refilled per frame. */
export class DynamicParticles {
  /** Live particles across both pools (HUD + tests). */
  get count(): number {
    return this.add.pool.count + this.blend.pool.count;
  }
  private readonly add: DynamicLaneHalf;
  private readonly additive: readonly boolean[];
  private readonly bindGroup: GPUBindGroup;
  private readonly blend: DynamicLaneHalf;
  private readonly device: GPUDevice;
  private readonly resources: Resources;
  private readonly systems: GPUBuffer;
  private readonly texture: GPUTexture;

  private readonly textureBytes: number;

  constructor(device: GPUDevice, resources: Resources, layout: GPUBindGroupLayout, library: DynamicParticleLibrary) {
    this.additive = library.additive;
    this.device = device;
    this.resources = resources;
    this.systems = resources.createBuffer('debris', {
      label: 'dyn-particle-systems',
      size: Math.max(16, library.systems.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.systems, 0, library.systems);
    const layerBytes = library.atlas.width * library.atlas.height * 4;
    this.textureBytes = library.atlas.rgba.byteLength;
    this.texture = resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'dyn-particle-atlas',
        size: {
          depthOrArrayLayers: Math.max(1, library.atlas.layers),
          height: library.atlas.height,
          width: library.atlas.width,
        },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      this.textureBytes,
    );
    for (let layer = 0; layer < library.atlas.layers; layer += 1) {
      device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: layer }, texture: this.texture },
        library.atlas.rgba.subarray(layer * layerBytes, (layer + 1) * layerBytes),
        { bytesPerRow: library.atlas.width * 4 },
        { height: library.atlas.height, width: library.atlas.width },
      );
    }
    this.bindGroup = device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.systems } },
        { binding: 1, resource: this.texture.createView({ dimension: '2d-array' }) },
        {
          binding: 2,
          resource: device.createSampler({ label: 'dyn-particle', magFilter: 'linear', minFilter: 'linear' }),
        },
      ],
      label: 'dyn-particle',
      layout,
    });
    const half = (pipeline: PipelineId, label: string): DynamicLaneHalf => ({
      buffer: resources.createBuffer('debris', {
        label,
        size: DYNAMIC_PARTICLE_CAP * STRIDE * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      }),
      dirty: false,
      pipeline,
      pool: new DynamicParticlePool(DYNAMIC_PARTICLE_CAP),
    });
    this.add = half('particle-add-once', 'dyn-particle-add');
    this.blend = half('particle-blend-once', 'dyn-particle-blend');
  }

  destroy(): void {
    this.resources.destroyBuffer('debris', this.systems);
    this.resources.destroyBuffer('debris', this.add.buffer);
    this.resources.destroyBuffer('debris', this.blend.buffer);
    this.resources.destroyTexture('texture', this.texture, this.textureBytes);
  }

  /** Prune the dead, upload the halves that changed, issue at most two instanced draws. */
  draw(
    pass: GPURenderPassEncoder,
    pipelines: PipelineSet,
    frameBindGroup: GPUBindGroup,
    quad: GPUBuffer,
    now: number,
  ): number {
    let draws = 0;
    for (const half of [this.blend, this.add]) {
      const changed = half.pool.prune(now);
      if (changed || half.dirty) {
        this.device.queue.writeBuffer(half.buffer, 0, half.pool.data, 0, half.pool.count * STRIDE);
        half.dirty = false;
      }
      if (half.pool.count === 0) {
        continue;
      }
      pass.setPipeline(pipelines.get(half.pipeline));
      pass.setBindGroup(0, frameBindGroup);
      pass.setBindGroup(1, this.bindGroup);
      pass.setVertexBuffer(0, quad);
      pass.setVertexBuffer(1, half.buffer);
      pass.draw(6, half.pool.count);
      draws += 1;
    }

    return draws;
  }

  /** Route by the system's blend mode. False when the index is unknown or its pool is full. */
  spawn(
    now: number,
    systemIndex: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    alpha = 1,
  ): boolean {
    if (!Number.isInteger(systemIndex) || systemIndex < 0 || systemIndex >= this.additive.length) {
      return false;
    }
    const half = this.additive[systemIndex] ? this.add : this.blend;
    const spawned = half.pool.spawn(now, life, systemIndex, x, y, z, vx, vy, vz, alpha);
    half.dirty = half.dirty || spawned;

    return spawned;
  }
}
