/**
 * Static-world cell store (plan 074/01): one `.oscell` blob → GPU buffers + a recorded `GPURenderBundle`
 * replayed while the cell is frustum-visible. Record happens ONCE at load (we own record time — no version
 * dances); unload destroys everything and the residency ledger must return to its prior line.
 */
import {
  decodeOscell,
  type Oscell,
  type OscellBreakable,
  OscellChannel,
  type OscellGroup,
  type OscellObject,
} from '@opensa/engine-formats';

import type { Resources } from '../core/resources';
import type { PipelineSet } from '../render/pipelines';
import type { TextureArrays } from './textures';

import { MSAA_SAMPLES, pipelineIdFor } from '../render/pipelines';
import { alignedErase } from './degenerate';

export interface CellHandle {
  /** Blended classes (blend/beam) — executed in the frame's SECOND phase, after every cell's opaque
   *  (blends write no depth; interleaving them per cell let later cells' opaque repaint them — field bug). */
  blendBundle: GPURenderBundle | null;
  /** World-space bounding sphere [x, y, z, r] (cell bounds shifted by origin). */
  bounds: readonly [number, number, number, number];
  /**
   * Smashable placements (B7·a): key hash → the placement's triangles inside THIS cell's index buffer.
   *
   * A prop breaks by having its indices overwritten with degenerate ones — the cell's render bundle is
   * recorded once and never rebuilt, but it only REFERENCES the index buffer, so rewriting the buffer's bytes
   * is legal and costs one `writeBuffer`. Keeping the props inside the merged batch is what keeps the draw
   * count flat (splitting them out per placement measured 4.5x the draws).
   */
  breakables: Map<number, { indexCount: number; indexOffset: number }[]>;
  bundle: GPURenderBundle;
  cellBindGroup: GPUBindGroup;
  draws: number;
  index16: boolean;
  indexBuffer: GPUBuffer;
  /** The cell's index bytes, kept ONLY when it has smashable props: erasing one needs its neighbours' bytes
   *  (see `alignedErase`). Cells with nothing to smash keep nothing. */
  indexData: Uint8Array;
  key: string;
  /** 2dfx corona anchors (074/06 row 13), WORLD-space positions precomputed at load. */
  lights: {
    color: readonly [number, number, number, number];
    farClip: number;
    /** Key hash of the smashable placement that owns this light; 0 when nothing can smash it. */
    owner: number;
    size: number;
    x: number;
    y: number;
    z: number;
  }[];
  /** ObjectTable draws (074/06 row 9) — outside the bundle; the frame gates them (timed by hour). kind-4
   *  UV-scroll draws (B7·c) carry their OWN cell uniform + bind group: the origin is shared with the cell but
   *  the uvAnim transform is rewritten each frame, so they cannot ride the immutable cell bind group. */
  objects: {
    bindGroup: GPUBindGroup;
    groups: OscellGroup[];
    kind: number;
    params: number;
    uvAnimUniform: GPUBuffer | null;
  }[];
  /** 2dfx PARTICLE emitters (B6), WORLD-space. The HOST resolves the name against effects.fxp and builds
   *  the instance buffers; the cell only carries the anchors. */
  particles: { effectName: string; x: number; y: number; z: number }[];
  /**
   * The placement mapper (minor 6), WORLD-space bounds — populated ONLY while {@link CellStore.picking} is on.
   *
   * Kept as one flat row list rather than a per-id map because a pick WALKS it and a hide filters it; the
   * whole point of the table is that it is cheap enough to scan. It stays empty in normal play: a full map's
   * mapper is tens of MB, and the residency budget is the reason this engine exists.
   */
  placements: {
    bounds: Float64Array;
    id: number;
    indexCount: number;
    indexOffset: number;
    model: string;
    txd: string;
  }[];
  /** Roadsign glyph quads welded into this cell (`.oscell` minor 8) — summed per visible cell into
   *  `EngineStats.roadsignQuadsRecorded`. Read off the header, not counted: the quads are indistinguishable
   *  from any other beam geometry once welded. */
  roadsignQuads: number;
  /** Triangles baked into the two bundles — summed per visible cell into `EngineStats.trianglesRecorded`.
   *  Counted once at load because a bundle is recorded once and never rebuilt. */
  triangles: number;
  uniform: GPUBuffer;
  vertexBuffer: GPUBuffer;
  visible: boolean;
}

/**
 * Host bytes one mapper row costs: the `Float64Array(6)` of world bounds (48) plus the row object holding
 * it — three numbers, two string references and the array reference, at 8 bytes a slot on a 64-bit engine,
 * over a ~16-byte object header. It is an ACCOUNTING figure, not a heap measurement: no browser API reports
 * the real retained size, and a number derived from the shapes we allocate is the honest available answer.
 * A `performance.measureUserAgentSpecificMemory()` reading is the way to check it, and it needs a device.
 */
const PLACEMENT_ROW_BYTES = 48 + 16 + 6 * 8;

/** What a map-inspector click resolved to. */
export interface PickHit {
  /** Distance along the pick ray (world units) — the frontmost hit wins. */
  distance: number;
  id: number;
  model: string;
  /** Centre of the hit placement's box: what the inspector reports as its position. */
  position: [number, number, number];
  txd: string;
}

export class CellStore {
  /**
   * Parse the placement mapper and RETAIN index bytes on load, so a host can pick a placement out of the
   * world and hide it. Off by default — both cost real memory on a full map. Takes effect on the NEXT load.
   *
   * **It is a CAPABILITY, not a debug switch, and the name is the point** (201/5-01). It was
   * `debugPicking` until 2026-08-12, and `apps/dispatch` — a production surface whose central interaction is
   * click-to-inspect — armed it at boot. A build that switched debug off in production would have removed
   * the console's best feature with nothing saying so, which is the failure
   * [restrictions/architecture.md](../../../../docs/restrictions/architecture.md) records: a production
   * surface may not stand on a `debug*` switch. The map inspector still uses it, and now says which
   * capability it is asking for rather than which mode it thinks it is in.
   *
   * What it costs is not free and not hidden either: read {@link pickingBytes}.
   */
  picking = false;
  get count(): number {
    return this.cells.size;
  }
  /**
   * What {@link picking} is costing right now, in HOST bytes, summed over the loaded cells.
   *
   * Two things, because the capability retains two (201/5-01 asked for the number *measured, not
   * estimated*): the mapper rows themselves — a `Float64Array(6)` per placement plus the row's own fields —
   * and the cell index bytes, which a cell with nothing smashable would otherwise drop on the floor after
   * upload. Both are CPU-side, which is exactly why they were invisible: `Engine.ledger()` counts GPU
   * residency by category, and a host reading only that sees a capability whose price is zero.
   *
   * The model and TXD names are NOT counted. They are references into the cell's own name table, which the
   * decode allocated either way, and counting a shared string per row would inflate the number that has to
   * be compared against a real budget.
   */
  get pickingBytes(): number {
    let bytes = 0;
    for (const cell of this.cells.values()) {
      bytes += cell.indexData.byteLength + cell.placements.length * PLACEMENT_ROW_BYTES;
    }

    return bytes;
  }
  private readonly cells = new Map<string, CellHandle>();
  private readonly colorFormat: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  private readonly device: GPUDevice;
  private readonly frameBindGroup: GPUBindGroup;
  private readonly pipelines: PipelineSet;
  private readonly resources: Resources;

  private readonly textures: TextureArrays;

  constructor(options: {
    colorFormat: GPUTextureFormat;
    depthFormat: GPUTextureFormat;
    device: GPUDevice;
    frameBindGroup: GPUBindGroup;
    pipelines: PipelineSet;
    resources: Resources;
    textures: TextureArrays;
  }) {
    this.device = options.device;
    this.resources = options.resources;
    this.pipelines = options.pipelines;
    this.textures = options.textures;
    this.frameBindGroup = options.frameBindGroup;
    this.colorFormat = options.colorFormat;
    this.depthFormat = options.depthFormat;
  }

  /** All loaded cells (culling + HUD iterate this). */
  all(): IterableIterator<CellHandle> {
    return this.cells.values();
  }

  /**
   * Smash the placement with this key: overwrite its triangles with degenerate ones (every index → 0, so each
   * triangle collapses to a point and rasterizes nothing). The render bundle is untouched — it references the
   * index BUFFER, and we are only rewriting its bytes. Returns false when no loaded cell owns the key (the
   * prop streamed out, or it was already broken and its cell has not reloaded).
   *
   * There is no explicit restore: a cell reload rebuilds the index buffer straight from the pak, which is
   * exactly SA's behaviour — streaming out and back in respawns the prop.
   */
  breakPlacement(keyHash: number): boolean {
    for (const cell of this.cells.values()) {
      const ranges = cell.breakables.get(keyHash);
      if (!ranges) {
        continue;
      }
      const stride = cell.index16 ? 2 : 4;
      for (const range of ranges) {
        // 4-byte alignment is not a detail here: an unaligned writeBuffer is REJECTED (the browser only warns),
        // so with u16 indices a prop whose range started on an odd index simply refused to break.
        const erase = alignedErase(cell.indexData, range.indexOffset, range.indexCount, stride);
        this.device.queue.writeBuffer(cell.indexBuffer, erase.byteOffset, erase.bytes);
      }
      cell.breakables.delete(keyHash);
      // The prop's own 2dfx lights go with it: a smashed traffic light left its coronas hanging in the sky.
      const lights = cell.lights.filter((light) => light.owner !== keyHash);
      if (lights.length !== cell.lights.length) {
        cell.lights.length = 0;
        cell.lights.push(...lights);
      }

      return true;
    }

    return false;
  }

  has(key: string): boolean {
    return this.cells.has(key);
  }

  /**
   * Hide the placement with this id everywhere it is loaded (map inspector): the same degenerate-index trick
   * `breakPlacement` uses, applied to a mapper row instead of a breakable one. Returns how many cells were
   * touched. There is no inverse — the caller restores by RELOADING the cells, which rebuilds their index
   * buffers straight from the pak (the map viewer re-pins its set to do exactly that).
   */
  hidePlacement(id: number): number {
    let hidden = 0;
    for (const cell of this.cells.values()) {
      const rows = cell.placements.filter((placement) => placement.id === id);
      if (rows.length === 0) {
        continue;
      }
      const stride = cell.index16 ? 2 : 4;
      for (const row of rows) {
        // Same alignment rule as breakPlacement: an unaligned writeBuffer is REJECTED with only a warning,
        // so a u16 range starting on an odd index would silently refuse to hide.
        const erase = alignedErase(cell.indexData, row.indexOffset, row.indexCount, stride);
        this.device.queue.writeBuffer(cell.indexBuffer, erase.byteOffset, erase.bytes);
      }
      cell.placements = cell.placements.filter((placement) => placement.id !== id);
      hidden += 1;
    }

    return hidden;
  }

  /** Decode + upload + record. Idempotent per key. */
  load(key: string, bytes: Uint8Array): CellHandle {
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }
    const cell = decodeOscell(bytes);
    const vertexBuffer = this.resources.createBuffer('cellVertex', {
      label: `${key}:vb`,
      size: align4(cell.vertexData.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, pad4(cell.vertexData));
    const indexBuffer = this.resources.createBuffer('cellIndex', {
      label: `${key}:ib`,
      size: align4(cell.indexData.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, pad4(cell.indexData));
    const uniform = this.resources.createBuffer('uniform', {
      label: `${key}:cell`,
      size: 32, // origin+flags (16) + uvAnim vec4 (B7·c) — identity for the bundle, per-object for kind-4 draws
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // origin.w = per-cell channel FLAG BITS (small ints are exact in f32): bit 0 = baked sunVis, bit 1 =
    // baked emissive mask (074/07) — the shader gates on them, so a channel-less pak never misreads the
    // reserved bytes (no in-data sentinels needed).
    const cellFlags =
      ((cell.channelMask & OscellChannel.SUN_VIS) !== 0 ? 1 : 0) |
      ((cell.channelMask & OscellChannel.EMISSIVE) !== 0 ? 2 : 0);
    // Bundle geometry gets IDENTITY uvAnim (0,0,1,1) — a uniform-gated no-op in vsWorld.
    this.device.queue.writeBuffer(uniform, 0, new Float32Array([...cell.origin, cellFlags, 0, 0, 1, 1]));
    const cellBindGroup = this.device.createBindGroup({
      entries: [{ binding: 0, resource: { buffer: uniform } }],
      label: `${key}:cell`,
      layout: this.pipelines.cellLayout,
    });
    // ObjectTable groups render OUTSIDE the bundle (hour-gated); the bundle records the rest.
    const objectOwned = new Set<number>();
    for (const object of cell.objects) {
      for (let own = object.groupStart; own < object.groupStart + object.groupCount; own += 1) {
        objectOwned.add(own);
      }
    }
    const bundleGroups = cell.groups.filter((_, index) => !objectOwned.has(index));
    const opaqueGroups = bundleGroups.filter((group) => group.pipelineClass <= 1);
    const blendGroups = bundleGroups.filter((group) => group.pipelineClass >= 2);
    const bundle = this.record(key, opaqueGroups, cell.index16, vertexBuffer, indexBuffer, cellBindGroup);
    const blendBundle =
      blendGroups.length > 0
        ? this.record(`${key}:blend`, blendGroups, cell.index16, vertexBuffer, indexBuffer, cellBindGroup)
        : null;
    const handle: CellHandle = {
      blendBundle,
      bounds: [
        cell.bounds[0] + cell.origin[0],
        cell.bounds[1] + cell.origin[1],
        cell.bounds[2] + cell.origin[2],
        cell.bounds[3],
      ],
      breakables: groupBreakables(cell.breakables),
      bundle,
      cellBindGroup,
      draws: bundleGroups.length,
      index16: cell.index16,
      indexBuffer,
      indexData: cell.breakables.length > 0 || this.picking ? cell.indexData : new Uint8Array(0),
      key,
      lights: cell.lights.map((light) => ({
        color: light.color,
        farClip: light.farClip,
        owner: light.owner,
        size: light.size,
        x: light.position[0] + cell.origin[0],
        y: light.position[1] + cell.origin[1],
        z: light.position[2] + cell.origin[2],
      })),
      objects: cell.objects.map((object: OscellObject) => {
        // kind-4/5 UV-scroll (B7·c; 5 = hour-gated scroller, minor 7): its own cell uniform (origin shared,
        // uvAnim rewritten per frame) + bind group. Every other kind rides the immutable cell bind group.
        if (object.kind !== 4 && object.kind !== 5) {
          return {
            bindGroup: cellBindGroup,
            groups: cell.groups.slice(object.groupStart, object.groupStart + object.groupCount),
            kind: object.kind,
            params: object.params,
            uvAnimUniform: null,
          };
        }
        const uvAnimUniform = this.resources.createBuffer('uniform', {
          label: `${key}:uvscroll:${object.params}`,
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uvAnimUniform, 0, new Float32Array([...cell.origin, cellFlags, 0, 0, 1, 1]));

        return {
          bindGroup: this.device.createBindGroup({
            entries: [{ binding: 0, resource: { buffer: uvAnimUniform } }],
            label: `${key}:uvscroll:${object.params}`,
            layout: this.pipelines.cellLayout,
          }),
          groups: cell.groups.slice(object.groupStart, object.groupStart + object.groupCount),
          kind: object.kind,
          params: object.params,
          uvAnimUniform,
        };
      }),
      particles: cell.particles.map((particle) => ({
        effectName: particle.effectName,
        x: particle.position[0] + cell.origin[0],
        y: particle.position[1] + cell.origin[1],
        z: particle.position[2] + cell.origin[2],
      })),
      placements: this.picking ? worldPlacements(cell) : [],
      roadsignQuads: cell.roadsignQuads,
      triangles: bundleGroups.reduce((sum, group) => sum + group.indexCount / 3, 0),
      uniform,
      vertexBuffer,
      visible: true,
    };
    this.cells.set(key, handle);

    return handle;
  }

  /**
   * Nearest placement whose world AABB the ray enters (map inspector's click-to-pick). A slab test over the
   * mapper rows of every VISIBLE cell — no BVH and no ID-buffer readback, which the welded cell path could
   * not support anyway (batched geometry, no per-vertex id). Returns null when picking is off or nothing hit.
   */
  pick(origin: readonly [number, number, number], direction: readonly [number, number, number]): null | PickHit {
    let best: null | PickHit = null;
    for (const cell of this.cells.values()) {
      if (!cell.visible) {
        continue;
      }
      for (const placement of cell.placements) {
        const distance = raySlab(origin, direction, placement.bounds);
        if (distance === null || (best !== null && distance >= best.distance)) {
          continue;
        }
        const b = placement.bounds;
        best = {
          distance,
          id: placement.id,
          model: placement.model,
          position: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2],
          txd: placement.txd,
        };
      }
    }

    return best;
  }

  unload(key: string): void {
    const handle = this.cells.get(key);
    if (!handle) {
      return;
    }
    this.cells.delete(key);
    this.resources.destroyBuffer('cellVertex', handle.vertexBuffer);
    this.resources.destroyBuffer('cellIndex', handle.indexBuffer);
    this.resources.destroyBuffer('uniform', handle.uniform);
    // kind-4 UV-scroll draws own a per-object cell uniform (B7·c) — release each with the cell.
    for (const object of handle.objects) {
      if (object.uvAnimUniform) {
        this.resources.destroyBuffer('uniform', object.uvAnimUniform);
      }
    }
    // The recorded bundle holds no destroyable GPU objects of its own; it dies with GC.
  }

  private record(
    key: string,
    groups: readonly OscellGroup[],
    index16: boolean,
    vertexBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    cellBindGroup: GPUBindGroup,
  ): GPURenderBundle {
    const encoder = this.device.createRenderBundleEncoder({
      colorFormats: [this.colorFormat],
      depthStencilFormat: this.depthFormat,
      label: key,
      sampleCount: MSAA_SAMPLES,
    });
    encoder.setBindGroup(0, this.frameBindGroup);
    encoder.setBindGroup(1, cellBindGroup);
    encoder.setVertexBuffer(0, vertexBuffer);
    encoder.setIndexBuffer(indexBuffer, index16 ? 'uint16' : 'uint32');
    // Deterministic order: opaque first, then cutout (within the bundle; cross-cell order is submit-side).
    const ordered = [...groups].sort((a, b) => a.pipelineClass - b.pipelineClass);
    for (const group of ordered) {
      encoder.setPipeline(this.pipelines.get(pipelineIdFor(group.pipelineClass, group.side)));
      encoder.setBindGroup(2, this.textures.get(group.textureArrayRef).bindGroup);
      encoder.drawIndexed(group.indexCount, 1, group.indexOffset, 0, 0);
    }

    return encoder.finish({ label: key });
  }
}

function align4(bytes: number): number {
  return Math.ceil(bytes / 4) * 4;
}

function groupBreakables(rows: readonly OscellBreakable[]): CellHandle['breakables'] {
  const breakables: CellHandle['breakables'] = new Map();
  for (const row of rows) {
    const ranges = breakables.get(row.keyHash) ?? [];
    ranges.push({ indexCount: row.indexCount, indexOffset: row.indexOffset });
    breakables.set(row.keyHash, ranges);
  }

  return breakables;
}

/** `writeBuffer` requires a multiple-of-4 byte length — odd uint16 index counts need a padded copy. */
function pad4(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 4 === 0) {
    return bytes;
  }
  const padded = new Uint8Array(align4(bytes.byteLength));
  padded.set(bytes);

  return padded;
}

/** One row per RANGE in the pak (a prop split across materials owns several) — group them by placement. */
/**
 * Ray vs AABB (the slab method). Returns the entry distance along `direction`, or null when the ray misses
 * or the box is entirely behind the origin. A ray STARTING inside the box hits at 0 — clicking while stood
 * inside a building should still select it.
 */
function raySlab(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  bounds: Float64Array,
): null | number {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = direction[axis];
    const min = bounds[axis];
    const max = bounds[axis + 3];
    if (Math.abs(d) < 1e-9) {
      if (origin[axis] < min || origin[axis] > max) {
        return null; // parallel to this slab and outside it
      }
      continue;
    }
    const t1 = (min - origin[axis]) / d;
    const t2 = (max - origin[axis]) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) {
      return null;
    }
  }
  if (far < 0) {
    return null;
  }

  return Math.max(near, 0);
}

/** Mapper rows with their AABBs shifted into world space (the cell stores them cell-local). */
function worldPlacements(cell: Oscell): CellHandle['placements'] {
  return cell.placements.map((placement) => {
    const bounds = new Float64Array(6);
    for (let axis = 0; axis < 3; axis += 1) {
      bounds[axis] = placement.bounds[axis] + cell.origin[axis];
      bounds[axis + 3] = placement.bounds[axis + 3] + cell.origin[axis];
    }

    return {
      bounds,
      id: placement.id,
      indexCount: placement.indexCount,
      indexOffset: placement.indexOffset,
      model: cell.names[placement.nameRef] ?? '',
      txd: cell.names[placement.txdRef] ?? '',
    };
  });
}
