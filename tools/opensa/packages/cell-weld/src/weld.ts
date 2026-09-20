/**
 * Cell welder (plan 074/03): one grid cell (HD or LOD level) → one `.oscell`. Every mergeable model instance
 * is transform-BAKED into cell-local ENGINE coordinates (GTA Z-up → engine Y-up: e = (x, z, −y)) and welded
 * into draw groups keyed by (texture array, pipeline class, side) — the offline batching that IS the thesis.
 * Timed defs weld into trailing `timed` buckets → objectTable entries (074/06 row 9, hour-gated at runtime);
 * IDE-anim defs weld STATICALLY at bind pose (field fix: skipping them left building-sized holes —
 * burger01_LAw is a 22×35 m diner, not a sign; their IFP animation is a later dynamic-entity feature).
 */
import type {
  Oscell,
  OscellBreakable,
  OscellGroup,
  OscellLight,
  OscellParticle,
  OscellPlacement,
} from '@opensa/engine-formats';
import type { AssetFileSystem, IplInstance, MapDefinitions, RWClump, RWUvAnimation } from '@opensa/renderware';

import { encodeOscell, OSCELL_VERTEX_STRIDE, OscellChannel } from '@opensa/engine-formats';
import { WIND_MODELS } from '@opensa/game/mods/wind-mode';
import { animatedFrames, clipForModel } from '@opensa/renderware/anim/frame-clip';
import { getClump, getIfp } from '@opensa/renderware/archive/asset-cache';
import { breakableInstanceKey, breakableKeyHash } from '@opensa/renderware/breakable/key';
import { cellGroups } from '@opensa/renderware/map/cell-groups';
import { type GridCell } from '@opensa/renderware/map/world-grid';
import { frameWorldTransform } from '@opensa/renderware/mesh/frame-transform';
import { isVertexAlphaBeam, NIGHT_AMBIENT, prepareClumpAtomics } from '@opensa/renderware/mesh/prepare-clump';
import { IdeFlag } from '@opensa/renderware/parsers/text/index';
import { ROADSIGN_PALETTE, type RoadsignGlyphQuads } from '@opensa/renderware/roadsign/glyph-quads';

import type { TexturePlanner } from './textures';

/**
 * The whole convert's UV-scroll animations (B7·c / plan 074/18), de-duped by dict name in encounter order —
 * SA's UVAnimDict names are GLOBAL, so every material referencing one shares a single slot. `slot` is the
 * manifest `uvAnimations` index a kind-4 objectTable entry stores; the runtime advances them in sync.
 */
export interface UvAnimRegistry {
  byName: Map<string, { anim: RWUvAnimation; slot: number }>;
}

/** The welded-but-not-yet-encoded cell — the bake stages (074/07) mutate scratch rows between the phases. */
/** A smashable placement's triangles inside ONE bucket, before the cell layout turns it into an absolute
 *  index range (B7·a). A prop split across materials contributes one of these per bucket. */
export interface WeldBreakableRange {
  bucket: WeldBucket;
  count: number;
  keyHash: number;
  start: number;
}

export interface WeldBucket {
  indices: number[];
  key: string;
  max: [number, number, number];
  min: [number, number, number];
  pipelineClass: number;
  side: number;
  textureArrayRef: number;
  /** Timed-object window (074/06 row 9) — this bucket becomes an objectTable draw, not part of the bundle. */
  timed: null | { off: number; on: number };
  /** UV-scroll dict entry (B7·c / plan 074/18) — this bucket leaves the bundle and becomes a kind-4 objectTable
   *  draw whose UVs crawl on the manifest animation at `slot`. Null for ordinary geometry. */
  uvAnim: null | { name: string; slot: number };
  vertices: number[]; // scratch rows: px py pz nx ny nz u v dr dg db da nr ng nb sway layer ao sunVis
}

export interface WeldedCell {
  /** Smashable placements' index ranges (B7·a) — HD cells only; a LOD prop is never hit. */
  breakables: WeldBreakableRange[];
  buckets: WeldBucket[];
  hasAo: boolean;
  hasNight: boolean;
  hasSunVis: boolean;
  hasSway: boolean;
  /** 2dfx corona anchors (074/06 row 13), cell-local engine coords — HD cells only. */
  lights: OscellLight[];
  lod: boolean;
  origin: readonly [number, number, number];
  /** 2dfx PARTICLE emitters (row 13, B6): factory smoke, fires, fountains — HD cells only, like coronas. */
  particles: OscellParticle[];
  /** EVERY placement's index range + identity (minor 6) — the debugger's mapper, both levels. */
  placements: WeldPlacementRange[];
  stats: WeldStats;
}

/**
 * One placed object's triangles inside ONE bucket, before the cell layout turns it into an absolute range
 * (the minor-6 mapper). Same shape as {@link WeldBreakableRange} plus the identity the debugger needs: the
 * model/TXD names and the local-space AABB of exactly the vertices this range covers.
 */
export interface WeldPlacementRange {
  bucket: WeldBucket;
  count: number;
  id: number;
  max: [number, number, number];
  min: [number, number, number];
  model: string;
  start: number;
  txd: string;
}

export interface WeldStats {
  /** Placements whose MOVING frames were left out of the bundle for the host to animate (B7·b). */
  animatedObjects: number;
  /** IDE-anim instances welded at bind pose (no runtime animation yet — 074/06 ledger note). */
  animatedStatic: number;
  /** Smashable placements recorded (B7·a) — index ranges the engine can degenerate on a hit. */
  breakables: number;
  groups: number;
  indices: number;
  /** 2dfx PARTICLE emitter anchors welded into this cell (B6). */
  particles: number;
  /** Placement-mapper rows written (minor 6) — the debugger's per-object identity. */
  placements: number;
  /** GLYPH QUADS those entries welded (minor 8) — the number the engine sums over visible cells to answer
   *  "do plates still draw at LOD range", which no screenshot can at ~8 px. One sign is many quads. */
  roadsignQuads: number;
  /** 2dfx roadsign entries welded as beam-class text (plan 076). */
  roadsigns: number;
  skippedTimed: number;
  /** ObjectTable entries produced (timed windows / scrapyard piles …). */
  timedObjects: number;
  /** UV-scroll objectTable entries (B7·c): kind-4 draws whose UVs crawl at runtime. */
  uvAnimObjects: number;
  vertices: number;
}

/** A fresh registry — one per convert, threaded through the real (non-occluder) weld. */
export function createUvAnimRegistry(): UvAnimRegistry {
  return { byName: new Map() };
}

/** Manifest-order list (slot ascending) — convert.ts feeds this to `buildOspak`. */
export function uvAnimList(registry: UvAnimRegistry): RWUvAnimation[] {
  return [...registry.byName.values()].sort((a, b) => a.slot - b.slot).map((entry) => entry.anim);
}

/** Scratch-row layout (floats per welded vertex) + the slots the bakers touch. */
export const WELD_ROW = 20;
export const WELD_AO = 17;
export const WELD_SUNVIS = 18;
export const WELD_SUNSOFT = 19;

/** Synthesized night ambient for geometry without an authored night set — shared with the rigid builder. */
const [NIGHT_AMBIENT_R, NIGHT_AMBIENT_G, NIGHT_AMBIENT_B] = NIGHT_AMBIENT;

/**
 * Wind-sway tuning per vegetation kind (074/06 row 10 — the plan-039 prod model baked offline). The vertex
 * carries the final amplitude in METRES (unorm8, 1 m ceiling): `weight` scales the adapted DFFs' prelit-alpha
 * weights (wind overlay dirs), `height` scales metres-above-base for unadapted vegetation.
 */
const SWAY_TUNING = {
  palm: { height: 0.035, weight: 0.5 },
  tree: { height: 0.02, weight: 0.35 },
} as const;

/** Phase 2: encode the (possibly baked) scratch buckets into `.oscell` bytes. */
export function assembleCell(welded: WeldedCell): Uint8Array {
  return assemble(welded.buckets, welded.origin, welded, welded.stats);
}

/** Whether a def is VEGETATION for the cutout rule — the same test the welder sways by, so a converted tree
 *  and the cell beside it classify their canopy alpha identically. */
export function isVegetationDef(def: { flags: number; modelName: string }): boolean {
  return swayKindFor(def) !== null;
}

/** Convert one cell in one shot (weld + encode, no bake) — the tests' and no-bake path. */
export function weldCell(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  cell: GridCell,
  lod: boolean,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
  breakableModels?: ReadonlySet<string>,
  uvAnimRegistry?: UvAnimRegistry,
): null | { bytes: Uint8Array; stats: WeldStats } {
  const welded = weldCellParts(fs, defs, cell, lod, planner, originEngine, breakableModels, uvAnimRegistry);

  return welded ? { bytes: assembleCell(welded), stats: welded.stats } : null;
}

/** Phase 1: weld into scratch buckets; returns null when the cell contains nothing mergeable. */
export function weldCellParts(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  cell: GridCell,
  lod: boolean,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
  /** Models object.dat marks as smashable (B7·a) — omit and only the DFF shatter mesh gates. */
  breakableModels?: ReadonlySet<string>,
  /** UV-scroll registry (B7·c): omit on occluder welds — a scroller then welds as ordinary static geometry. */
  uvAnimRegistry?: UvAnimRegistry,
  /** 2dfx roadsign glyph quads (plan 076) whose WORLD position falls in THIS cell — collected globally in a
   *  pre-pass (they are world-space, not instance-local), welded here as beam-class text. BOTH levels since
   *  plan 100/03: the same world-keyed list feeds the LOD bundle, so a plate keeps reading past ~440 u. */
  roadsigns?: readonly RoadsignGlyphQuads[],
): null | WeldedCell {
  const buckets = new Map<string, WeldBucket>();
  const stats: WeldStats = {
    animatedObjects: 0,
    animatedStatic: 0,
    breakables: 0,
    groups: 0,
    indices: 0,
    particles: 0,
    placements: 0,
    roadsignQuads: 0,
    roadsigns: 0,
    skippedTimed: 0,
    timedObjects: 0,
    uvAnimObjects: 0,
    vertices: 0,
  };
  const flags = { hasNight: false, hasSway: false };
  const lights: OscellLight[] = [];
  const particles: OscellParticle[] = [];
  const breakables: WeldBreakableRange[] = [];
  const placements: WeldPlacementRange[] = [];

  const groups = [...cellGroups(defs, cell, lod).values()].sort((a, b) => (a.def.modelName < b.def.modelName ? -1 : 1));
  for (const group of groups) {
    const def = group.def;
    // IDE-anim defs (B7·b): the frames the clip MOVES are left out of the bundle — the host renders those as
    // live entities. Everything else welds as usual, which is the point: `burger01_LAw` is a 22x35 m diner
    // that sits in the anim section only because its sign spins. Skipping the whole def deleted the building
    // (the "blue hole" field report, plan 041) — and promoting the whole def would drag the diner out of the
    // merged batch for the sake of one sign.
    const animated = def.anim !== undefined ? movingFrames(fs, def) : null;
    if (animated) {
      stats.animatedObjects += animated.size > 0 ? group.instances.length : 0;
      stats.animatedStatic += animated.size === 0 ? group.instances.length : 0;
    }
    // Timed defs (074/06 row 9) weld like everything else, but into `timed` buckets → objectTable draws.
    // Breakable props (B7·a) stay INSIDE the merged bundle — splitting them out per placement measured 4.5x
    // the draw calls. Instead the weld records each placement's index RANGES; the engine degenerates those
    // triangles in place on a hit, which the immutable bundle allows (it references the buffer, not its bytes).
    weldGroup(
      fs,
      group.def,
      group.instances,
      buckets,
      planner,
      originEngine,
      flags,
      lod ? undefined : breakables,
      breakableModels,
      animated,
      // UV-scroll is HD-only: a LOD copy of the LV skull sign would scroll a second ghost behind it.
      lod ? undefined : uvAnimRegistry,
      // The mapper rides BOTH levels: the inspector can pin a section as LOD ("Show LODs") and must still
      // answer what was clicked there.
      placements,
    );
    // 2dfx corona anchors and emitters (074/06 row 13). BOTH levels since plan 100/03: on HD these come off
    // the source models, on LOD off the baked cell model's own 2dfx section, which `opensa-lod-generator`
    // writes cell-relative. Doubling — the reason this was HD-only — cannot happen: a slot holds ONE level
    // (`slot.current`), and the HD↔LOD swap unloads the old key in the same synchronous `create` call.
    // A LOD light is never breakable: a far corona has no smashable owner (breakables are HD-only, and the
    // baked cell model is not in `breakableModels` anyway).
    collectLights(
      fs,
      group.def,
      group.instances,
      originEngine,
      lights,
      lod ? false : isBreakable(fs, group.def, breakableModels),
    );
    collectParticles(fs, group.def, group.instances, originEngine, particles);
  }

  // Roadsign text (plan 076): world-space glyph quads collected in the pre-pass for THIS cell weld into beam
  // buckets — unlit + full-bright (readable day AND night), drawn in the blend phase AFTER all opaque so the
  // text composites over its plate, never before it.
  //
  // BOTH levels since plan 100/03, and the source stays the WORLD-KEYED pre-pass rather than the LOD model's
  // own type-7 entries — the one place this step departs from "a LOD's effects come from the LOD model".
  // A plate's coordinates are world, and 131 of the map's 489 sit OUTSIDE the cell holding the instance that
  // carries them (measured, `opensa-lod-generator/006`). Read off the LOD model, such a plate would weld into
  // cell A's LOD bundle while the HD pre-pass files it under cell B — two different keys, so the streamer's
  // one-level-per-slot rule would not stop them being resident together, and the plate would draw twice.
  // Bucketing by world position keeps every plate on exactly ONE key, at both levels.
  if (roadsigns && roadsigns.length > 0) {
    stats.roadsignQuads = weldRoadsigns(roadsigns, buckets, planner, originEngine);
    stats.roadsigns = roadsigns.length;
  }

  // Bundle buckets first, then timed buckets grouped by their (on, off) window — the objectTable references
  // a CONTIGUOUS group run per window, so the sort key keeps equal windows adjacent.
  const ordered = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (ordered.length === 0) {
    return null;
  }

  stats.particles = particles.length;

  return {
    breakables,
    buckets: ordered,
    hasAo: false,
    hasNight: flags.hasNight,
    hasSunVis: false,
    hasSway: flags.hasSway,
    lights,
    lod,
    origin: originEngine,
    particles,
    placements,
    stats,
  };
}

/** Bake one instance of one part into the bucket (GTA→engine axes + cell-local offset). */
function appendInstance(
  bucket: WeldBucket,
  atomic: ReturnType<typeof prepareClumpAtomics>[number],
  index: Uint16Array | Uint32Array,
  instance: IplInstance,
  layer: number,
  origin: readonly [number, number, number],
  swayKind: keyof typeof SWAY_TUNING | null,
  frame: null | { pos: [number, number, number]; rot: number[] },
): void {
  // GTA IPL quaternions are the conjugate of the usual convention (parity with build-region).
  const [qx, qy, qz, qw] = [-instance.rotation[0], -instance.rotation[1], -instance.rotation[2], instance.rotation[3]];
  const m = quatToMat3(qx, qy, qz, qw);
  // A NIGHT-ONLY timed model (SA's `*_nt` dressing, 085 row D) with no authored night set keeps its DAY
  // prelit at night — that prelit IS its night look (vanilla renders it fullbright after the 22:00 swap);
  // the dark day×ambient synthesis crushed the Fremont casino facades to a fraction of their brightness.
  const nightIsDay = isNightOnlyWindow(bucket.timed);
  const [ambientR, ambientG, ambientB] = nightIsDay ? [1, 1, 1] : [NIGHT_AMBIENT_R, NIGHT_AMBIENT_G, NIGHT_AMBIENT_B];
  const base = bucket.vertices.length / WELD_ROW;
  const used = new Map<number, number>(); // source vertex → welded row (per instance/part)
  const remap = (source: number): number => {
    const existing = used.get(source);
    if (existing !== undefined) {
      return existing;
    }
    let px = atomic.positions[source * 3];
    let py = atomic.positions[source * 3 + 1];
    let pz = atomic.positions[source * 3 + 2];
    let nx = atomic.normals[source * 3];
    let ny = atomic.normals[source * 3 + 1];
    let nz = atomic.normals[source * 3 + 2];
    // Frame chain first (anim-hierarchy models place parts via frames; null = identity fast path).
    if (frame) {
      const f = frame.rot;
      [px, py, pz] = [
        f[0] * px + f[1] * py + f[2] * pz + frame.pos[0],
        f[3] * px + f[4] * py + f[5] * pz + frame.pos[1],
        f[6] * px + f[7] * py + f[8] * pz + frame.pos[2],
      ];
      [nx, ny, nz] = [
        f[0] * nx + f[1] * ny + f[2] * nz,
        f[3] * nx + f[4] * ny + f[5] * nz,
        f[6] * nx + f[7] * ny + f[8] * nz,
      ];
    }
    // world (GTA) = R·v + t → engine (Y-up) = (x, z, −y) → cell-local.
    const gx = m[0] * px + m[1] * py + m[2] * pz + instance.position[0];
    const gy = m[3] * px + m[4] * py + m[5] * pz + instance.position[1];
    const gz = m[6] * px + m[7] * py + m[8] * pz + instance.position[2];
    const ex = gx - origin[0];
    const ey = gz - origin[1];
    const ez = -gy - origin[2];
    const gnx = m[0] * nx + m[1] * ny + m[2] * nz;
    const gny = m[3] * nx + m[4] * ny + m[5] * nz;
    const gnz = m[6] * nx + m[7] * ny + m[8] * nz;
    const colorSize = atomic.color?.itemSize ?? 3;
    const dayR = atomic.color ? atomic.color.array[source * colorSize] : 1;
    const dayG = atomic.color ? atomic.color.array[source * colorSize + 1] : 1;
    const dayB = atomic.color ? atomic.color.array[source * colorSize + 2] : 1;
    const dayA = atomic.color && colorSize === 4 ? atomic.color.array[source * colorSize + 3] : 1;
    bucket.vertices.push(
      ex,
      ey,
      ez,
      gnx,
      gnz,
      -gny,
      atomic.uv ? atomic.uv[source * 2] : 0,
      atomic.uv ? atomic.uv[source * 2 + 1] : 0,
      dayR,
      dayG,
      dayB,
      dayA,
      // No authored night set → synthesize night = day × ambient (074/06 row 1: one blend formula for the
      // whole world; the weather-reactive ambient of the old dual-tint path is a later refinement). A
      // night-only timed model keeps day as-is instead — see `nightIsDay` above.
      atomic.nightColor ? atomic.nightColor[source * 3] : dayR * ambientR,
      atomic.nightColor ? atomic.nightColor[source * 3 + 1] : dayG * ambientG,
      atomic.nightColor ? atomic.nightColor[source * 3 + 2] : dayB * ambientB,
      // Sway amplitude in metres (074/06 row 10): adapted DFFs carry per-vertex weights (prelit alpha),
      // unadapted vegetation falls back to height-above-base (pz = model-space GTA Z, up).
      swayKind === null
        ? 0
        : Math.min(
            1,
            atomic.sway
              ? atomic.sway.weights[source] * SWAY_TUNING[swayKind].weight
              : Math.max(pz, 0) * SWAY_TUNING[swayKind].height,
          ),
      layer,
      // aoSkyVis + sunVis threshold/softness defaults = fully open; the bakes (074/07) overwrite HD rows.
      1,
      0,
      0.05,
    );
    bucket.min[0] = Math.min(bucket.min[0], ex);
    bucket.min[1] = Math.min(bucket.min[1], ey);
    bucket.min[2] = Math.min(bucket.min[2], ez);
    bucket.max[0] = Math.max(bucket.max[0], ex);
    bucket.max[1] = Math.max(bucket.max[1], ey);
    bucket.max[2] = Math.max(bucket.max[2], ez);
    const row = base + used.size;
    used.set(source, row);

    return row;
  };
  // Axis flip (x, z, −y) mirrors handedness once — triangle order stays (parity with the −90°X root, which
  // also never re-wound); engine pipelines cull ccw-front like three did.
  for (let tri = 0; tri < index.length; tri += 3) {
    bucket.indices.push(remap(index[tri]), remap(index[tri + 1]), remap(index[tri + 2]));
  }
}

function assemble(
  ordered: WeldBucket[],
  origin: readonly [number, number, number],
  channels: {
    /** Bucket-relative ranges from the weld (B7·a) — resolved to absolute index offsets by the layout below. */
    breakables?: WeldBreakableRange[];
    hasAo: boolean;
    hasNight: boolean;
    hasSunVis: boolean;
    hasSway: boolean;
    lights: OscellLight[];
    particles: OscellParticle[];
    /** Bucket-relative placement ranges (minor 6) — resolved and merged by the layout below. */
    placements?: WeldPlacementRange[];
  },
  stats: WeldStats,
): Uint8Array {
  let vertexCount = 0;
  let indexCount = 0;
  for (const bucket of ordered) {
    vertexCount += bucket.vertices.length / WELD_ROW;
    indexCount += bucket.indices.length;
  }
  const index16 = vertexCount <= 0xffff;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  const view = new DataView(vertexData.buffer);
  const indexArray = index16 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  const groups: OscellGroup[] = [];
  const cellMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const cellMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  let vertexBase = 0;
  let indexBase = 0;
  let hasEmissive = false;
  const bucketIndexBase = new Map<WeldBucket, number>();
  for (const bucket of ordered) {
    bucketIndexBase.set(bucket, indexBase);
    const bucketVertices = bucket.vertices.length / WELD_ROW;
    hasEmissive = writeBucketVertices(bucket, vertexBase, view) || hasEmissive;
    for (let entry = 0; entry < bucket.indices.length; entry += 1) {
      indexArray[indexBase + entry] = bucket.indices[entry] + vertexBase;
    }
    const center: [number, number, number] = [
      (bucket.min[0] + bucket.max[0]) / 2,
      (bucket.min[1] + bucket.max[1]) / 2,
      (bucket.min[2] + bucket.max[2]) / 2,
    ];
    const radius = Math.hypot(bucket.max[0] - center[0], bucket.max[1] - center[1], bucket.max[2] - center[2]);
    groups.push({
      bounds: [center[0], center[1], center[2], radius],
      indexCount: bucket.indices.length,
      indexOffset: indexBase,
      pipelineClass: bucket.pipelineClass,
      side: bucket.side,
      textureArrayRef: bucket.textureArrayRef,
    });
    for (let axis = 0; axis < 3; axis += 1) {
      cellMin[axis] = Math.min(cellMin[axis], bucket.min[axis]);
      cellMax[axis] = Math.max(cellMax[axis], bucket.max[axis]);
    }
    vertexBase += bucketVertices;
    indexBase += bucket.indices.length;
  }

  const objects = buildObjectTable(ordered);
  stats.timedObjects = objects.filter((object) => object.kind === 0).length;
  stats.uvAnimObjects = objects.filter((object) => object.kind === 4).length;

  stats.groups = groups.length;
  stats.vertices = vertexCount;
  stats.indices = indexCount;
  // The weld recorded each smashable placement's triangles as an offset INSIDE its bucket; the layout above
  // is what finally decides where that bucket's indices live, so the absolute range can only be resolved here.
  const breakables: OscellBreakable[] = (channels.breakables ?? [])
    .filter((range) => range.count > 0)
    .map((range) => ({
      indexCount: range.count,
      indexOffset: (bucketIndexBase.get(range.bucket) ?? 0) + range.start,
      keyHash: range.keyHash,
    }));
  stats.breakables = breakables.length;
  const mapper = buildPlacementTable(channels.placements ?? [], bucketIndexBase);
  stats.placements = mapper.placements.length;
  const center: [number, number, number] = [
    (cellMin[0] + cellMax[0]) / 2,
    (cellMin[1] + cellMax[1]) / 2,
    (cellMin[2] + cellMax[2]) / 2,
  ];
  const cell: Oscell = {
    bounds: [
      center[0],
      center[1],
      center[2],
      Math.hypot(cellMax[0] - center[0], cellMax[1] - center[1], cellMax[2] - center[2]),
    ],
    breakables,
    channelMask:
      (channels.hasNight ? OscellChannel.NIGHT_PRELIT : 0) |
      (channels.hasSway ? OscellChannel.SWAY : 0) |
      (channels.hasAo ? OscellChannel.AO_SKY_VIS : 0) |
      (channels.hasSunVis ? OscellChannel.SUN_VIS : 0) |
      (hasEmissive ? OscellChannel.EMISSIVE : 0),
    groups,
    index16,
    indexCount,
    indexData: new Uint8Array(indexArray.buffer),
    lights: channels.lights,
    names: mapper.names,
    objects,
    origin,
    particles: channels.particles,
    placements: mapper.placements,
    roadsignQuads: stats.roadsignQuads,
    vertexCount,
    vertexData,
  };

  return encodeOscell(cell);
}

/**
 * The atomic's model-space transform, or null when SA would not apply one.
 *
 * SA parity (plan 095): only a CLUMP model keeps its frame hierarchy. An `anim` IDE entry loads through
 * `LoadClumpFile`, which is how a windmill's blades sit on their tower — but a plain objs/tobj model loads
 * through `LoadAtomicFile`, and that hands every atomic a FRESH identity frame
 * (`RpAtomicSetFrame(atomic, RwFrameCreate())`), so the DFF's own frame transform is dead data. We used to
 * apply it regardless: it rotated a mod's `land_42_sfw` 90° and sank 165 vanilla `aw_streettree1` 3.1 m into
 * the ground. The COL — authored in the space SA renders — agrees with the reversed source on every affected
 * model. The gate is `def`, not the clump, because `prepareClumpAtomics` is cached by model name and may not
 * depend on who asked for it.
 */
function atomicFrame(
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  clump: RWClump,
  frameIndex: number,
): null | { pos: [number, number, number]; rot: number[] } {
  return def.anim !== undefined ? frameWorldTransform(clump.frames, frameIndex) : null;
}

/** Local-space AABB of the weld rows in `[startRow, endRow)` — the first three floats of each row. */
function boundsOfRows(
  vertices: readonly number[],
  startRow: number,
  endRow: number,
): { max: [number, number, number]; min: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let row = startRow; row < endRow; row += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertices[row * WELD_ROW + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  return { max, min };
}

function bucketFor(
  buckets: Map<string, WeldBucket>,
  arrayRef: number,
  pipelineClass: number,
  side: number,
  timed: null | { off: number; on: number },
  uvAnim: null | { name: string; slot: number },
): WeldBucket {
  // '~' sorts after digits: timed / uv-scroll buckets land AFTER the bundle ones. uv-scroll keys by dict name
  // so distinct animations never merge; both families leave the recorded bundle (each is its own objectTable draw).
  const window = timed ? `~t${String(timed.on).padStart(2, '0')}-${String(timed.off).padStart(2, '0')}|` : '';
  const scroll = uvAnim ? `~u${uvAnim.name}|` : '';
  const key = `${scroll}${window}${String(arrayRef).padStart(4, '0')}|${pipelineClass}|${side}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = {
      indices: [],
      key,
      max: [-Infinity, -Infinity, -Infinity],
      min: [Infinity, Infinity, Infinity],
      pipelineClass,
      side,
      textureArrayRef: arrayRef,
      timed,
      uvAnim,
      vertices: [],
    };
    buckets.set(key, bucket);
  }

  return bucket;
}

/**
 * The out-of-bundle draws for a cell's trailing buckets: timed windows merge into contiguous runs (074/06
 * row 9), and each UV-scroll dict bucket is one kind-4 row (B7·c, params = the manifest animation slot).
 * Both families sort AFTER the bundle buckets, so the engine's object-owned exclusion is a trailing set.
 */
function buildObjectTable(ordered: WeldBucket[]): Oscell['objects'] {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;
  const objects: Oscell['objects'] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const timed = ordered[index].timed;
    if (!timed || ordered[index].uvAnim) {
      continue; // a timed SCROLLER is one kind-5 row below, not a kind-0 — two rows drew it twice (minor 7)
    }
    const last = objects[objects.length - 1];
    if (last && last.groupStart + last.groupCount === index && samePreviousWindow(ordered, index)) {
      last.groupCount += 1;
    } else {
      objects.push({
        groupCount: 1,
        groupStart: index,
        kind: 0,
        params: timed.on | (timed.off << 8),
        transform: IDENTITY,
      });
    }
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const uvAnim = ordered[index].uvAnim;
    if (!uvAnim) {
      continue;
    }
    // kind 5 (minor 7): a scroller with a tobj window — the Fremont facade's stripes run only 22→5.
    const timed = ordered[index].timed;
    objects.push({
      groupCount: 1,
      groupStart: index,
      kind: timed ? 5 : 4,
      params: timed ? uvAnim.slot | (timed.on << 16) | (timed.off << 24) : uvAnim.slot,
      transform: IDENTITY,
    });
  }

  return objects;
}

/**
 * Resolve the mapper's bucket-relative ranges to absolute index offsets and intern the names (minor 6).
 *
 * A model is welded material-by-material with the INSTANCE loop innermost, so one placement contributes a
 * row per (part × bucket) — a five-material building placed 40 times would be 200 rows. Rows of the same
 * placement that ended up ADJACENT in the final index buffer are merged, which collapses the common case
 * (one part, many triangles) without losing the ability to hide an object split across buckets.
 */
function buildPlacementTable(
  ranges: readonly WeldPlacementRange[],
  bucketIndexBase: Map<WeldBucket, number>,
): { names: string[]; placements: OscellPlacement[] } {
  const names: string[] = [];
  const nameRefs = new Map<string, number>();
  const intern = (name: string): number => {
    const existing = nameRefs.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const ref = names.length;
    names.push(name);
    nameRefs.set(name, ref);

    return ref;
  };
  const rows = ranges
    .filter((range) => range.count > 0)
    .map((range) => ({
      bounds: [...range.min, ...range.max],
      id: range.id,
      indexCount: range.count,
      indexOffset: (bucketIndexBase.get(range.bucket) ?? 0) + range.start,
      nameRef: intern(range.model.toLowerCase()),
      txdRef: intern(range.txd.toLowerCase()),
    }))
    .sort((a, b) => a.indexOffset - b.indexOffset);

  const placements: OscellPlacement[] = [];
  for (const row of rows) {
    const previous = placements[placements.length - 1];
    if (previous && previous.id === row.id && previous.indexOffset + previous.indexCount === row.indexOffset) {
      previous.indexCount += row.indexCount;
      previous.bounds = [
        Math.min(previous.bounds[0], row.bounds[0]),
        Math.min(previous.bounds[1], row.bounds[1]),
        Math.min(previous.bounds[2], row.bounds[2]),
        Math.max(previous.bounds[3], row.bounds[3]),
        Math.max(previous.bounds[4], row.bounds[4]),
        Math.max(previous.bounds[5], row.bounds[5]),
      ];
      continue;
    }
    placements.push(row);
  }

  // Names are only referenced by the table; an empty table must not carry a pool (the reader skips it).
  return placements.length > 0 ? { names, placements } : { names: [], placements: [] };
}

/** Part → `.oscell` pipelineClass: additive (4) wins, then beam (3); else the texture's alpha class
 *  decides. Additive = the def carries `IdeFlag.ADDITIVE` (085 row C — vgncircus2neon: SA's timed neon
 *  overlays are fullbright in BOTH prelit sets and glow by ADDING onto the base building; welded as
 *  ordinary lit geometry they were crushed by the night indirect scale and read dull) — but ONLY for
 *  materials with alpha to blend. Vanilla puts flag-8 models through the additive blend solely on the
 *  alpha render pass; a submesh whose texture has NO alpha channel draws in the opaque pass regardless
 *  (085 row H — casinoblock3_nt: every `casinolights*` is DXT1 no-alpha and renders as the SOLID black
 *  fascia in vanilla; classing them additive made the black texels vanish — a see-through facade). */
function classOf(
  beam: boolean,
  additive: boolean,
  alphaClass: 'cutout' | 'opaque' | 'softBlend',
  noDepthWrite = false,
): number {
  if (additive && alphaClass !== 'opaque') {
    return 4;
  }
  if (beam) {
    return 3;
  }
  // `NO_ZBUFFER_WRITE` (0x40) is SA saying "I am an overlay — composite me, do not occlude with me": ground
  // alpha decals (`grnd_alpha*`), graffiti, road lines, the `alphbrk*` sheets — 250 defs. The cutout pipeline
  // WRITES depth and compares `greater`, so a coplanar overlay would lose its own depth test; the blend class
  // is the one that reads `greater-equal` and composites (`pipelines.ts`). Honoured for ALPHA materials only,
  // which is plan 039's precise lesson: bare-0x40 opaque TERRAIN (`VegasSland40`) must keep occluding, and
  // vanilla only routes a model through blended states on its alpha pass.
  if (noDepthWrite && alphaClass !== 'opaque') {
    return 2;
  }

  return alphaClass === 'cutout' ? 1 : alphaClass === 'softBlend' ? 2 : 0;
}

/** Transform every instance's 2dfx corona anchors into cell-local ENGINE coords (074/06 row 13). */
function collectLights(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  instances: readonly IplInstance[],
  origin: readonly [number, number, number],
  out: OscellLight[],
  /** Set when this def is smashable: the light is tagged with its placement, so a smashed traffic light takes
   *  its coronas down with it instead of leaving them hanging in the sky. */
  breakable = false,
): void {
  const clump = getClump(fs, def.modelName);
  for (const geometry of clump.geometries) {
    for (const light of geometry.lights) {
      for (const instance of instances) {
        const [qx, qy, qz, qw] = [
          -instance.rotation[0],
          -instance.rotation[1],
          -instance.rotation[2],
          instance.rotation[3],
        ];
        const m = quatToMat3(qx, qy, qz, qw);
        const [px, py, pz] = light.position;
        const gx = m[0] * px + m[1] * py + m[2] * pz + instance.position[0];
        const gy = m[3] * px + m[4] * py + m[5] * pz + instance.position[1];
        const gz = m[6] * px + m[7] * py + m[8] * pz + instance.position[2];
        out.push({
          color: light.color,
          farClip: light.coronaFarClip,
          owner: breakable ? breakableKeyHash(breakableInstanceKey(def.modelName, instance.position)) : 0,
          position: [gx - origin[0], gz - origin[1], -gy - origin[2]],
          size: light.coronaSize,
        });
      }
    }
  }
}

/**
 * 2dfx PARTICLE emitters (type 1) → cell-local ENGINE coords (B6). The FX SYSTEM itself lives in
 * `effects.fxp` (tracks, sprite, blend mode) and the host parses that; the cell only records WHERE an
 * emitter of a given name sits. HD level only, exactly like the coronas — a LOD copy would double every
 * factory chimney's smoke.
 */
function collectParticles(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  instances: readonly IplInstance[],
  origin: readonly [number, number, number],
  out: OscellParticle[],
): void {
  const clump = getClump(fs, def.modelName);
  for (const geometry of clump.geometries) {
    for (const particle of geometry.particles ?? []) {
      for (const instance of instances) {
        // GTA IPL quaternions are the conjugate of the usual convention (parity with appendInstance).
        const [qx, qy, qz, qw] = [
          -instance.rotation[0],
          -instance.rotation[1],
          -instance.rotation[2],
          instance.rotation[3],
        ];
        const m = quatToMat3(qx, qy, qz, qw);
        const [px, py, pz] = particle.position;
        const gx = m[0] * px + m[1] * py + m[2] * pz + instance.position[0];
        const gy = m[3] * px + m[4] * py + m[5] * pz + instance.position[1];
        const gz = m[6] * px + m[7] * py + m[8] * pz + instance.position[2];
        out.push({
          effectName: particle.effectName.toLowerCase(),
          // GTA Z-up → engine Y-up (e = x, z, -y), then cell-local: the same change the vertices take.
          position: [gx - origin[0], gz - origin[1], -gy - origin[2]],
        });
      }
    }
  }
}

/**
 * SA marks a smashable prop two ways and prod gates on EITHER: the DFF carries an RW Breakable shatter mesh
 * (238 models do), or object.dat gives it a smash damage effect (the bins and boxes that shatter their visible
 * mesh instead). Absent object.dat → the shatter-mesh gate alone still works.
 */
function isBreakable(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  breakableModels?: ReadonlySet<string>,
): boolean {
  return (
    getClump(fs, def.modelName).geometries.some((geometry) => geometry.breakable !== undefined) ||
    (breakableModels?.has(def.modelName.toLowerCase()) ?? false)
  );
}

/** A timed window that shows the model ONLY after dark — SA's `*_nt` night-dressing convention
 *  (casinoblock41_nt is 22→5; the map's night windows run 20→6 / 22→6). Such a model's DAY prelit is its
 *  night look, and its emissive compares against void (085 row D). */
function isNightOnlyWindow(timed: null | { off: number; on: number }): boolean {
  return timed !== null && timed.on >= 18 && timed.off <= 8;
}

/**
 * Which of an anim def's frames actually MOVE. Empty when the model's IFP or its clip is missing — the def
 * then welds whole, at bind pose, exactly as before (that fallback is what keeps a missing IFP from deleting a
 * building).
 */
function movingFrames(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
): ReadonlySet<number> {
  const clump = getClump(fs, def.modelName);
  const animation = clipForModel(getIfp(fs, def.anim ?? ''), def.modelName);

  return animation ? animatedFrames(clump.frames, animation) : new Set<number>();
}

function quatToMat3(x: number, y: number, z: number, w: number): number[] {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/**
 * Record what the just-appended index range BELONGS to: the breakable table when the prop is smashable, and
 * the minor-6 mapper always. Both are one row per (part × instance × bucket); the mapper's AABB covers
 * exactly the vertices this append added, because a box around the whole model would swallow its neighbours
 * on a pick.
 */
function recordRanges(
  def: { modelName: string; txdName: string },
  instance: IplInstance,
  bucket: WeldBucket,
  start: number,
  vertexStart: number,
  breakables: undefined | WeldBreakableRange[],
  placements: undefined | WeldPlacementRange[],
): void {
  const count = bucket.indices.length - start;
  if (count === 0) {
    return;
  }
  const id = breakableKeyHash(breakableInstanceKey(def.modelName, instance.position));
  breakables?.push({ bucket, count, keyHash: id, start });
  placements?.push({
    bucket,
    count,
    id,
    model: def.modelName,
    start,
    txd: def.txdName,
    ...boundsOfRows(bucket.vertices, vertexStart, bucket.vertices.length / WELD_ROW),
  });
}

/**
 * UV-scroll slot for a material (B7·c): the first UVAnimDict name it references that the clump actually carries,
 * registered GLOBALLY by name (SA dict names are global identifiers, so every reference shares one slot). Null
 * when there is no plugin, no registry (occluder weld), or the named entry is missing / empty — render static
 * rather than invent a scroll (the same fallback philosophy as a missing IFP welding at bind pose).
 */
function resolveUvAnim(
  clump: ReturnType<typeof getClump>,
  material: { effects?: { uvAnim?: { names: string[] } } },
  registry?: UvAnimRegistry,
): null | { name: string; slot: number } {
  const name = material.effects?.uvAnim?.names[0];
  if (!registry || name === undefined) {
    return null;
  }
  const existing = registry.byName.get(name);
  if (existing) {
    return { name, slot: existing.slot };
  }
  const anim = clump.uvAnimations?.find((entry) => entry.name === name);
  if (!anim || anim.keyframes.length === 0) {
    return null;
  }
  const slot = registry.byName.size;
  registry.byName.set(name, { anim, slot });

  return { name, slot };
}

/** True when the bucket at `index` shares the previous bucket's timed window (merge into one object). */
function samePreviousWindow(ordered: WeldBucket[], index: number): boolean {
  const current = ordered[index].timed;
  const previous = ordered[index - 1]?.timed;

  return current !== null && previous != null && previous.on === current.on && previous.off === current.off;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

function snorm(value: number): number {
  return Math.max(-127, Math.min(127, Math.round(value * 127)));
}

/** Sway kind for a def — IDE veg flags first, then the wind list (plan 039: list membership is the TRIGGER;
 *  prelit alpha alone must not trigger — roads/night overlays use it too).
 *
 *  A generated far-LOD is asked as its SOURCE when its own name misses the list: `lod-trees-generator` names
 *  an impostor `lod<source>`, and the row it inherits from carries no vegetation bit for most of the roster —
 *  105 of the 184 impostors of the 2026-08-21 build are wind models by NAME only, so without this the tree
 *  sways and welds cutout while its own LOD stands still in a soft-blend pass (lod-trees plan 013, cause 3). */
function swayKindFor(def: { flags: number; modelName: string }): keyof typeof SWAY_TUNING | null {
  if ((def.flags & IdeFlag.IS_PALM) !== 0) {
    return 'palm';
  }
  if ((def.flags & IdeFlag.IS_TREE) !== 0) {
    return 'tree';
  }
  const own = def.modelName.toLowerCase();
  const model = WIND_MODELS.has(own) ? own : own.replace(/^lod/, '');
  if (!WIND_MODELS.has(model)) {
    return null;
  }

  return model.includes('palm') ? 'palm' : 'tree';
}

function unorm(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/** Weld every atomic part × instance of one model group into the shared buckets. */
function weldGroup(
  fs: AssetFileSystem,
  def: NonNullable<ReturnType<MapDefinitions['catalog']['get']>>,
  instances: readonly IplInstance[],
  buckets: Map<string, WeldBucket>,
  planner: TexturePlanner,
  originEngine: readonly [number, number, number],
  flags: { hasNight: boolean; hasSway: boolean },
  /** Set on HD cells: smashable placements append their index ranges here. */
  breakables?: WeldBreakableRange[],
  /** Models object.dat marks as smashable (prod's secondary gate); omit and only the DFF shatter mesh gates. */
  breakableModels?: ReadonlySet<string>,
  /** Frames an IFP clip moves (B7·b): their atomics are NOT welded — the host renders them live. */
  animated?: null | ReadonlySet<number>,
  /** UV-scroll registry (B7·c): a material referencing a UVAnimDict entry leaves the merged bundle. */
  uvAnimRegistry?: UvAnimRegistry,
  /** The minor-6 mapper: EVERY placement appends its range + identity here (last param on purpose — the
   *  call site is positional, and inserting mid-list would silently rotate the optional arguments). */
  placements?: WeldPlacementRange[],
): void {
  const clump = getClump(fs, def.modelName);
  const atomics = prepareClumpAtomics(clump);
  // SA marks a smashable prop two ways and prod gates on EITHER: the DFF carries a RW Breakable shatter mesh
  // (238 models do), or object.dat gives it a smash damage effect (the bins and boxes that shatter their
  // visible mesh instead). Absent object.dat → the shatter-mesh gate alone still works.
  const breakable = breakables !== undefined && isBreakable(fs, def, breakableModels);
  const doubleSided = (def.flags & IdeFlag.DISABLE_BACKFACE_CULLING) !== 0 ? 1 : 0;
  const additive = (def.flags & IdeFlag.ADDITIVE) !== 0;
  const noDepthWrite = (def.flags & IdeFlag.NO_ZBUFFER_WRITE) !== 0;
  const swayKind = swayKindFor(def);
  const timed = def.time !== undefined ? { off: def.time.off, on: def.time.on } : null;
  for (const atomic of atomics) {
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    if (animated?.has(atomic.frameIndex)) {
      continue; // a moving part: the host draws it as a live entity, so welding it would double it
    }
    const frame = atomicFrame(def, clump, atomic.frameIndex);
    for (const part of atomic.parts) {
      const material = geometry.materials[part.materialIndex] ?? {
        color: [255, 255, 255, 255] as const,
        texture: null,
        textured: false,
      };
      const beam = isVertexAlphaBeam(material, geometry);
      // UV-scroll (B7·c): a material referencing a UVAnimDict entry the clump actually carries becomes a kind-4
      // objectTable draw whose UVs crawl at runtime. Route it to its own per-dict bucket (out of the merged
      // bundle); an unknown name or a missing registry (occluder weld) falls back to ordinary static geometry.
      const uvAnim = resolveUvAnim(clump, material, uvAnimRegistry);
      // Vegetation prefers CUTOUT (field fix: soft-classed canopies wrote no depth → trees showed through
      // trees). Vanilla SA alpha-TESTS foliage; our A2C+MSAA equivalent needs the cutout texture pipeline.
      const resolved = planner.resolve(
        def.txdName,
        material.texture?.name ?? null,
        material.color,
        swayKind !== null,
        def.modelName,
      );
      const bucket = bucketFor(
        buckets,
        resolved.arrayRef,
        classOf(beam, additive, resolved.alphaClass, noDepthWrite),
        doubleSided,
        timed,
        uvAnim,
      );
      // Bit 15 of the layer u16 flags stochastic de-tiling layers (074/12) — the engine masks the index.
      const layerValue = resolved.layer | (resolved.stochastic ? 0x8000 : 0);
      for (const instance of instances) {
        const start = bucket.indices.length;
        const vertexStart = bucket.vertices.length / WELD_ROW;
        appendInstance(bucket, atomic, part.index, instance, layerValue, originEngine, swayKind, frame);
        recordRanges(def, instance, bucket, start, vertexStart, breakable ? breakables : undefined, placements);
        flags.hasNight ||= atomic.nightColor !== null;
        flags.hasSway ||= swayKind !== null;
      }
    }
  }
}

/**
 * Weld a cell's roadsign glyph quads (plan 076) as BEAM-class geometry: unlit and full-bright (the palette
 * colour rides both the day AND night prelit, so a sign reads at night — the world-cutout path would darken it
 * into the dark boards the field reported), with the `roadsignfont` atlas as one texture-array layer and the
 * quads' atlas UVs. Double-sided (the three path used DoubleSide). Beam sits in the blend phase, after opaque.
 */
function weldRoadsigns(
  roadsigns: readonly RoadsignGlyphQuads[],
  buckets: Map<string, WeldBucket>,
  planner: TexturePlanner,
  origin: readonly [number, number, number],
): number {
  const resolved = planner.resolve('particle', 'roadsignfont', [255, 255, 255, 255], false);
  const layerValue = resolved.layer | (resolved.stochastic ? 0x8000 : 0);
  let welded = 0;
  for (const sign of roadsigns) {
    const [pr, pg, pb] = ROADSIGN_PALETTE[sign.colour] ?? ROADSIGN_PALETTE[0];
    const bucket = bucketFor(buckets, resolved.arrayRef, 3, 1, null, null); // beam class (3), double-sided (1)
    const quadCount = sign.positions.length / 12;
    for (let q = 0; q < quadCount; q += 1) {
      const base = bucket.vertices.length / WELD_ROW;
      for (let c = 0; c < 4; c += 1) {
        // World GTA → engine (x, z, −y) → cell-local — the same change the model vertices take.
        const ex = sign.positions[q * 12 + c * 3] - origin[0];
        const ey = sign.positions[q * 12 + c * 3 + 2] - origin[1];
        const ez = -sign.positions[q * 12 + c * 3 + 1] - origin[2];
        bucket.vertices.push(
          ex,
          ey,
          ez,
          0,
          1,
          0, // normal — beam ignores it
          sign.uvs[q * 8 + c * 2],
          sign.uvs[q * 8 + c * 2 + 1],
          pr,
          pg,
          pb,
          1, // dayPrelit RGB + cone alpha 1 (fsBeam multiplies by cone)
          pr,
          pg,
          pb, // nightPrelit RGB — same colour, so the text stays full-bright at night
          0, // sway
          layerValue,
          1,
          0,
          0.05, // ao / sunVis threshold / softness — unused by beam
        );
        bucket.min[0] = Math.min(bucket.min[0], ex);
        bucket.min[1] = Math.min(bucket.min[1], ey);
        bucket.min[2] = Math.min(bucket.min[2], ez);
        bucket.max[0] = Math.max(bucket.max[0], ex);
        bucket.max[1] = Math.max(bucket.max[1], ey);
        bucket.max[2] = Math.max(bucket.max[2], ez);
      }
      bucket.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    welded += quadCount;
  }

  return welded;
}

/** Encode one bucket's scratch rows into the interleaved payload; true when any emissive mask fired. */
function writeBucketVertices(bucket: WeldBucket, vertexBase: number, view: DataView): boolean {
  let hasEmissive = false;
  const bucketVertices = bucket.vertices.length / WELD_ROW;
  // Per-bucket: a NIGHT-ONLY timed bucket's emissive compares against VOID (see the delta below).
  const dayIsVoid = isNightOnlyWindow(bucket.timed);
  for (let vertex = 0; vertex < bucketVertices; vertex += 1) {
    const row = vertex * WELD_ROW;
    const at = (vertexBase + vertex) * OSCELL_VERTEX_STRIDE;
    view.setFloat32(at, bucket.vertices[row], true);
    view.setFloat32(at + 4, bucket.vertices[row + 1], true);
    view.setFloat32(at + 8, bucket.vertices[row + 2], true);
    view.setInt8(at + 12, snorm(bucket.vertices[row + 3]));
    view.setInt8(at + 13, snorm(bucket.vertices[row + 4]));
    view.setInt8(at + 14, snorm(bucket.vertices[row + 5]));
    // normal.w = sun-vis v2 THRESHOLD elevation (074/07, /1.1-encoded; 1.0 = never lit) — snorm 0..127,
    // gated by the SUN_VIS channel bit. Penumbra softness rides the layer u16 bits 8–14 (below).
    view.setInt8(at + 15, snorm(Math.max(0, Math.min(1, bucket.vertices[row + WELD_SUNVIS]))));
    view.setFloat32(at + 16, bucket.vertices[row + 6], true);
    view.setFloat32(at + 20, bucket.vertices[row + 7], true);
    view.setUint8(at + 24, unorm(bucket.vertices[row + 8]));
    view.setUint8(at + 25, unorm(bucket.vertices[row + 9]));
    view.setUint8(at + 26, unorm(bucket.vertices[row + 10]));
    view.setUint8(at + 27, unorm(bucket.vertices[row + 11]));
    view.setUint8(at + 28, unorm(bucket.vertices[row + 12]));
    view.setUint8(at + 29, unorm(bucket.vertices[row + 13]));
    view.setUint8(at + 30, unorm(bucket.vertices[row + 14]));
    view.setUint8(at + 31, unorm(bucket.vertices[row + 15]));
    // layer u16 = index (bits 0–7) | sun-vis softness ×127/0.5 (bits 8–14, 074/07 v2) | stochastic (bit 15).
    const softness7 = Math.max(0, Math.min(127, Math.round((bucket.vertices[row + WELD_SUNSOFT] / 0.5) * 127)));
    view.setUint16(at + 32, bucket.vertices[row + 16] | (softness7 << 8), true);
    // channels u16 = aoSkyVis | emissive << 8 (074/02). Emissive mask (07): baked night-window detection —
    // the same max-CHANNEL delta the runtime heuristic uses, computed OFFLINE per vertex (refinable later
    // without engine changes). Per channel, not luma: neon night sets are SATURATED — the LV strip's red
    // rope light is 188/37/62 against a flat grey day, and its Rec709 luma sits BELOW the day's, so the
    // luma rule read "not lit". Synthesized night sets (day × ambient) stay below day on every channel →
    // still mask 0. A NIGHT-ONLY timed model (085 row D) compares against VOID, not its day set — by day
    // the model does not exist, so "much brighter at night than by day" is the night set's own brightness
    // (the Fremont `*_nt` facades are lit dressing top to bottom).
    const delta = Math.max(
      bucket.vertices[row + 12] - (dayIsVoid ? 0 : bucket.vertices[row + 8]),
      bucket.vertices[row + 13] - (dayIsVoid ? 0 : bucket.vertices[row + 9]),
      bucket.vertices[row + 14] - (dayIsVoid ? 0 : bucket.vertices[row + 10]),
    );
    const emissive = smoothstep(0.05, 0.32, delta);
    hasEmissive ||= emissive > 0;
    view.setUint16(at + 34, unorm(bucket.vertices[row + WELD_AO]) | (unorm(emissive) << 8), true);
  }

  return hasEmissive;
}
