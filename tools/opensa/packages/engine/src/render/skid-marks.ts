/**
 * Skid-mark decals (plan 089/03) — the engine's first (and only) decal lane. A mark is not a particle: it
 * is world GEOMETRY lying on the road, a ribbon of quads extruded along a tyre's contact path, textured
 * with SA's own `particleskid` and fading out on the WALL clock (the brief's 5 REAL seconds — a game hour
 * is 60 real seconds here, so a game-time fade would run ~7× too fast; the shader reads the engine-uptime
 * seconds the frame uniform already carries).
 *
 * The store is a RING of segments — the brief's "oldest recycled first" is the write cursor wrapping. The
 * live window [start, end) advances past expired segments each frame (expiry is FIFO because birth is
 * monotonic), so dead quads are never rasterised; the window crosses the wrap as at most TWO draw ranges.
 * GPU side is the corona pattern: one buffer sized to the cap at install, small positional writeBuffers
 * for freshly laid segments only, nothing created per frame.
 */
import type { Resources } from '../core/resources';

/** Floats per vertex: position(3) + uv(2) + alpha(1) + birth seconds(1). */
export const SKID_VERTEX_FLOATS = 7;
/** Vertices per segment: two triangles, unindexed (segments are written independently into a ring). */
export const SKID_SEGMENT_VERTS = 6;

/** World-wide segment cap. Sized for the lifetime below: a sustained 4-wheel slide at speed lays
 *  ~240 segments/s, so 4096 holds the full lifetime without recycling live marks; the ring wrap is the
 *  "oldest recycled first" backstop beyond that. */
export const SKID_SEGMENT_CAP = 4096;

/** Mark lifetime, REAL seconds (wall clock, never game time). The brief said 5; field round 1 wanted
 *  marks to linger 2–3× longer. MUST match `SKID_LIFE` in the `skid` shader. */
export const SKID_LIFE_SECONDS = 12;

/** One laid quad, engine space. `l0/r0` must repeat the previous segment's `l1/r1` for a seamless ribbon. */
export interface SkidSegment {
  /** Alpha at the older edge / the newer edge — the darker-the-harder rule arrives here precomputed. */
  alpha0: number;
  alpha1: number;
  l0: readonly [number, number, number];
  l1: readonly [number, number, number];
  r0: readonly [number, number, number];
  r1: readonly [number, number, number];
  /** Along-ribbon texture coordinate at each edge (the texture repeats in v). */
  v0: number;
  v1: number;
}

/**
 * The CPU ring: packed vertex data + per-segment birth times + the live window. Pure — the GPU half and
 * the tests both drive it; `now` is always a parameter so expiry is deterministic under test.
 */
export class SkidMarkRing {
  /** Packed vertex floats for the whole ring, upload-ready per segment. */
  readonly data: Float32Array;
  /** Live segments (HUD + tests). */
  get count(): number {
    return this.length;
  }
  /** Per-segment birth seconds — expiry (FIFO) and the live window derive from it. */
  private readonly births: Float64Array;
  /** Ring write cursor (next segment slot). */
  private cursor = 0;
  private length = 0;

  /** Live window, segment indices [start, start + length) mod capacity. */
  private start = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * SKID_SEGMENT_VERTS * SKID_VERTEX_FLOATS);
    this.births = new Float64Array(capacity);
  }

  /** Advance the window past segments older than the lifetime. Returns true when anything expired. */
  prune(now: number): boolean {
    let changed = false;
    while (this.length > 0 && now - this.births[this.start] >= SKID_LIFE_SECONDS) {
      this.start = (this.start + 1) % this.capacity;
      this.length -= 1;
      changed = true;
    }

    return changed;
  }

  /** Lay one segment; returns the slot index written (the GPU half uploads exactly that slot). */
  push(segment: SkidSegment, now: number): number {
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.length === this.capacity) {
      this.start = this.cursor; // the ring is full: the oldest segment is recycled, the window slides
    } else {
      this.length += 1;
    }
    this.births[slot] = now;
    const at = slot * SKID_SEGMENT_VERTS * SKID_VERTEX_FLOATS;
    const d = this.data;
    const vertex = (offset: number, p: readonly [number, number, number], u: number, v: number, a: number): void => {
      const base = at + offset * SKID_VERTEX_FLOATS;
      d[base] = p[0];
      d[base + 1] = p[1];
      d[base + 2] = p[2];
      d[base + 3] = u;
      d[base + 4] = v;
      d[base + 5] = a;
      d[base + 6] = now;
    };
    // Two triangles: l0-r0-l1 and r0-r1-l1 (winding is irrelevant — the pipeline does not cull).
    vertex(0, segment.l0, 0, segment.v0, segment.alpha0);
    vertex(1, segment.r0, 1, segment.v0, segment.alpha0);
    vertex(2, segment.l1, 0, segment.v1, segment.alpha1);
    vertex(3, segment.r0, 1, segment.v0, segment.alpha0);
    vertex(4, segment.r1, 1, segment.v1, segment.alpha1);
    vertex(5, segment.l1, 0, segment.v1, segment.alpha1);

    return slot;
  }

  /** The live window as at most two contiguous segment ranges (the ring seam splits it). */
  ranges(): readonly { count: number; first: number }[] {
    if (this.length === 0) {
      return [];
    }
    const end = this.start + this.length;
    if (end <= this.capacity) {
      return [{ count: this.length, first: this.start }];
    }

    return [
      { count: this.capacity - this.start, first: this.start },
      { count: end - this.capacity, first: 0 },
    ];
  }
}

/** The GPU half: the persistent vertex buffer + the mark texture's bind group. Created once at install. */
export class SkidMarks {
  readonly ring = new SkidMarkRing(SKID_SEGMENT_CAP);
  private readonly bindGroup: GPUBindGroup;
  private readonly buffer: GPUBuffer;
  private readonly device: GPUDevice;
  private readonly resources: Resources;
  private readonly texture: GPUTexture;
  private readonly textureBytes: number;

  constructor(
    device: GPUDevice,
    resources: Resources,
    layout: GPUBindGroupLayout,
    sprite: { height: number; rgba: Uint8Array; width: number },
  ) {
    this.device = device;
    this.resources = resources;
    this.buffer = resources.createBuffer('debris', {
      label: 'skid-marks',
      size: SKID_SEGMENT_CAP * SKID_SEGMENT_VERTS * SKID_VERTEX_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.textureBytes = sprite.rgba.byteLength;
    this.texture = resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'skid-texture',
        size: { height: sprite.height, width: sprite.width },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      this.textureBytes,
    );
    device.queue.writeTexture(
      { texture: this.texture },
      sprite.rgba,
      { bytesPerRow: sprite.width * 4 },
      {
        height: sprite.height,
        width: sprite.width,
      },
    );
    this.bindGroup = device.createBindGroup({
      entries: [
        { binding: 0, resource: this.texture.createView() },
        {
          binding: 1,
          // Repeat along the ribbon (v accumulates in metres); the width axis clamps to the soft edge.
          resource: device.createSampler({
            addressModeU: 'clamp-to-edge',
            addressModeV: 'repeat',
            label: 'skid',
            magFilter: 'linear',
            minFilter: 'linear',
          }),
        },
      ],
      label: 'skid',
      layout,
    });
  }

  /** Lay one segment: ring write + one small positional writeBuffer for exactly that slot. */
  add(segment: SkidSegment, now: number): void {
    const slot = this.ring.push(segment, now);
    const floats = SKID_SEGMENT_VERTS * SKID_VERTEX_FLOATS;
    this.device.queue.writeBuffer(this.buffer, slot * floats * 4, this.ring.data, slot * floats, floats);
  }

  destroy(): void {
    this.resources.destroyBuffer('debris', this.buffer);
    this.resources.destroyTexture('texture', this.texture, this.textureBytes);
  }

  /** Prune on the wall clock, then draw the live window (at most two ranges across the ring seam). */
  draw(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, frameBindGroup: GPUBindGroup, now: number): number {
    this.ring.prune(now);
    const ranges = this.ring.ranges();
    if (ranges.length === 0) {
      return 0;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, frameBindGroup);
    pass.setBindGroup(1, this.bindGroup);
    pass.setVertexBuffer(0, this.buffer);
    for (const range of ranges) {
      pass.draw(range.count * SKID_SEGMENT_VERTS, 1, range.first * SKID_SEGMENT_VERTS, 0);
    }

    return ranges.length;
  }
}
