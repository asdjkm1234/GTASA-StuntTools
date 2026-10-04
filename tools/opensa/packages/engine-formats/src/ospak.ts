/**
 * `.ospak` — the archive (plan 074/02): a JSON manifest + one binary pak of 4 KiB-aligned entries. The runtime
 * reads RANGES only (Cache API / HTTP Range) — the pak is never whole in JS (the 073 memory lesson). Entry
 * hashes (FNV-1a) make converter re-runs incremental and delivery cache-friendly.
 */
import { fnv1a } from './binary';
import { OSTEX_FORMAT_FEATURE, type OstexFormatId } from './ostex';

export const OSPAK_VERSION = 1;
export const OSPAK_ALIGN = 4096;

/**
 * A cell's range plus the texture arrays it needs.
 *
 * `textures` is what makes per-ring texture laziness possible: without it the runtime cannot know which
 * arrays a cell will bind until it has decoded the cell, so the only safe policy was "upload every array in
 * the district before the first cell". With it, the driver loads an array when the first cell that draws
 * with it streams in, and releases it when the last one leaves.
 *
 * **Measured, and smaller than it sounds** (003 phase 4, whole-map convert): a focus keeps a median 84 % of
 * the district's texture bytes resident, because the planner packs arrays GLOBALLY — 17 of 99 arrays are
 * touched by more than a quarter of all cells. Laziness cannot evict a map-wide atlas. The lever for real
 * residency is spatial locality in `TexturePlanner`, not the loading policy.
 *
 * Absent on paks built before this field existed — the runtime then falls back to the eager policy, so old
 * paks keep working unchanged.
 */
export interface OspakCellEntry extends OspakEntry {
  /** World XZ AABB of the cell's TRUE geometry, engine coords `[minX, maxX, minZ, maxZ]` (plan 087):
   *  the streaming rings must test where the geometry actually is — an instance welds into the cell of
   *  its PIVOT, so meshes (bridges, piers) reach past the grid rect (gostown: mean 141 u, max 799 u) and
   *  a grid-rect ring skips cells whose geometry is already inside the fog. Absent on older paks — the
   *  runtime falls back to the grid rect. */
  aabb?: [number, number, number, number];
  /** World Y extent of the cell's TRUE geometry, engine coords `[minY, maxY]` (plan 201/1-05). The XZ
   *  `aabb` answers a RING (a distance on the ground); a VIEW cannot be answered without a height — a
   *  tower streamed out from under a pitched camera is a hole, so a cell that does not state its height
   *  is not view-gated at all. Absent on paks built before this field existed; the runtime then keeps the
   *  rings ({@link OspakManifest.lodPixelThreshold} is the other half of the same switch). */
  aabbY?: [number, number];
  /**
   * World-unit error introduced by drawing THIS entry instead of the finer content it stands for (plan
   * 201/1-05) — the 3D Tiles field, and the number screen-space-error LOD has nothing to compute without.
   * A cell's `lod` entry carries the largest feature its bake does not represent; an `hd` entry is the
   * finest content there is and carries 0.
   *
   * Absent on paks built before the bake wrote it. It is paired with {@link OspakManifest.lodPixelThreshold}
   * — an error is only a verdict against the budget it was baked to — and the runtime falls back to the
   * ring radii when either is missing.
   */
  geometricError?: number;
  textures?: number[];
}

export interface OspakEntry {
  /** Wire encoding of the stored bytes (074/10 A1): absent = raw payload. */
  enc?: OspakWireEnc;
  hash: number;
  length: number;
  offset: number;
  /** Decoded payload size when `enc` is set (progress/validation on the reader side). */
  rawLength?: number;
}

export interface OspakInput {
  /** World XZ geometry AABB (kind 'cell') — see {@link OspakCellEntry.aabb}. */
  aabb?: [number, number, number, number];
  /** World Y geometry extent (kind 'cell') — see {@link OspakCellEntry.aabbY}. */
  aabbY?: [number, number];
  bytes: Uint8Array;
  /** Wire encoding the producer applied to `bytes` (the reader inflates before use). */
  enc?: OspakWireEnc;
  /** World-unit error of drawing this entry instead of its finer content (kind 'cell') — see
   *  {@link OspakCellEntry.geometricError}. */
  geometricError?: number;
  key: string;
  kind: 'cell' | 'collision' | 'texture';
  /** Texture meta (required for kind 'texture'). */
  meta?: { format: number; height: number; layers: number; width: number };
  /** Decoded size of `bytes` when `enc` is set. */
  rawLength?: number;
  /** Texture-array refs this CELL draws with (kind 'cell') — see {@link OspakCellEntry.textures}. */
  textures?: number[];
}

export interface OspakManifest {
  /** Root `package.json` version of the app that built this pak (plan 086 phase 1) — the fetch client
   *  pairs it with `game` for cache keying. Absent on older paks or builds outside the repo. */
  appVersion?: string;
  /** Wall-clock build time stamped by opensa-pack (`HH:mm DD-MM-YYYY`, local) — shown in the debugger so the
   *  running pak version is visible at a glance. Absent for a pak built before the field existed. It makes
   *  `manifest.json` non-reproducible by design (the pak `world.ospak` stays byte-identical). */
  buildTime?: string;
  /** Byte size of the pak file (sanity for range readers). */
  byteLength: number;
  /** Cell entries: `"x,y,hd"` / `"x,y,lod"` → range + the texture arrays the cell draws with. */
  cells: Record<string, OspakCellEntry>;
  /** World-grid cell size (engine units) — key "cx,cy,…" → engine-space centre mapping for streaming. */
  cellSize: number;
  /**
   * Baked cell collision (plan 200/3-01): `"cx,cy"` → range of one `.oscol`.
   *
   * **Keyed on {@link OspakManifest.collisionCellSize}, not on {@link OspakManifest.cellSize}.** Collision
   * streams on the GAME grid (256) while render cells are 250 — two tessellations of one world, and a reader
   * that assumes the render grid gets the WRONG cell's colliders rather than none. Absent on a pak built
   * without the bake; the runtime then parses COL as it always did.
   */
  collision?: Record<string, OspakEntry>;
  /** The grid {@link OspakManifest.collision} is keyed on — stated rather than implied, because it is NOT
   *  `cellSize` and the difference is invisible until someone falls through the world. */
  collisionCellSize?: number;
  /**
   * The world's named districts (201/5-03): a LOOSE `districts.json` beside the manifest, holding
   * `info.zon`'s boxes with their `american.gxt` text **already resolved**.
   *
   * It is baked rather than looked up because a surface streaming a pak has no game dir: `info.zon` carries
   * GXT KEYS and the GXT is a separate `text/` file, so neither is reachable at runtime
   * (`docs/restrictions/build-vs-runtime.md`). See `tools/opensa-pack/src/districts.ts` for the writer.
   *
   * Absent when the game ships no `info.zon` (a total conversion may not) or when the pak predates the
   * field — a consumer must have an answer for "this world has no district names".
   */
  districts?: { count: number; file: string };
  /** Fetch game id (plan 086 phase 1): the `game-src/<id>` folder name this pak was built from
   *  (`original`, `gostown`, …). Absent on older paks. */
  game?: string;
  /**
   * The screen-error budget the cell LODs were BAKED to, in pixels (plan 201/1-05): `opensa-lod-generator`
   * drops from a cell LOD what subtends fewer than this many pixels at the closest distance a LOD is drawn,
   * so it is the bake's own promise about how wrong the far view is allowed to look — and therefore the
   * threshold the runtime compares {@link OspakCellEntry.geometricError} against.
   *
   * It is carried rather than re-derived because the alternative is two copies of one number in two
   * repositories' worth of code, agreeing until somebody retunes the bake (SILENT: every pak still loads,
   * the HD ring just stops meaning what the LOD was built for). Absent on paks built before the field —
   * the runtime keeps the ring radii.
   */
  lodPixelThreshold?: number;
  /** Colour stand-in layers the planner minted for MISSING textures (plan 085 row B): 4×4 RGBA8 layers the
   *  runtime can repaint magenta when the missing-texture highlight is on. `color` is the PACKED texel, so
   *  toggling off restores the quiet material colour without re-fetching the array. Absent when the whole
   *  map resolved. */
  missingLayers?: { array: number; color: [number, number, number, number]; layer: number }[];
  /** Texture-array entries: `"array-<id>"` → range; meta mirrors the .ostex headers for scheduling. */
  textures: Record<string, OspakEntry & { format: number; height: number; layers: number; width: number }>;
  /** UV-scroll animations (B7·c / plan 074/18): the whole map's UVAnimDict entries, de-duped by name in
   *  encounter order. A cell's kind-4 objectTable entry stores an INDEX into this array; the runtime advances
   *  them globally in sync (SA's dict names are global identifiers) and feeds each visible scroller its
   *  current transform. Absent when no converted model carries the plugin. */
  uvAnimations?: OspakUvAnimation[];
  version: number;
  /** Water mesh (074/06 row 12, through plan 075): a LOOSE binary next to the manifest — tessellated
   *  water.dat polygons with the baked per-vertex depth field. Stride-20 (5 floats/vertex):
   *  [u32 V][u32 I][f32×5 × V: x, y, z, depth, class][u32 × I], where `class` (plan 075) splits SEA (0)
   *  from inland water. See tools/opensa-pack/src/water.ts for the authoritative writer. */
  water?: { file: string; indexCount: number; vertexCount: number };
}

/**
 * One UV-scroll animation from a DFF UVAnimDict (B7·c / plan 074/18). Stored verbatim from the parser so the
 * runtime lerp matches prod exactly: keyframe `uv` params are `[rotation, scaleX, scaleY, skew, tX, tY]`
 * (only translate/scale are consumed by known SA assets). Global by `name` — every material referencing it,
 * in any cell, scrolls together.
 */
export interface OspakUvAnimation {
  /** Loop duration in seconds. */
  duration: number;
  keyframes: { time: number; uv: number[] }[];
  /** Dict-entry name the objectTable slot resolves to. */
  name: string;
}

/** Wire encodings a pak entry can carry (074/10 A1 / 074/14 stage 2). */
export type OspakWireEnc = 'deflate-raw' | 'oswire-deflate-raw';

/** Assemble a pak deterministically: entries sorted by key, 4 KiB aligned, zero-padded. */
export function buildOspak(
  inputs: readonly OspakInput[],
  options: {
    cellSize?: number;
    /** Required whenever any input is `kind: 'collision'` — the GAME grid those keys are on. */
    collisionCellSize?: number;
    /** The bake's screen-error budget — see {@link OspakManifest.lodPixelThreshold}. */
    lodPixelThreshold?: number;
    missingLayers?: OspakManifest['missingLayers'];
    uvAnimations?: OspakUvAnimation[];
  } = {},
): { manifest: OspakManifest; pak: Uint8Array } {
  const sorted = [...inputs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const cells: OspakManifest['cells'] = {};
  const collision: Record<string, OspakEntry> = {};
  const textures: OspakManifest['textures'] = {};
  let offset = 0;
  const spans: { bytes: Uint8Array; offset: number }[] = [];
  for (const input of sorted) {
    const entry: OspakEntry = {
      ...(input.enc !== undefined ? { enc: input.enc, rawLength: input.rawLength ?? 0 } : {}),
      hash: fnv1a(input.bytes),
      length: input.bytes.byteLength,
      offset,
    };
    if (input.kind === 'cell') {
      addCell(cells, input, entry);
    } else if (input.kind === 'collision') {
      if (collision[input.key]) {
        throw new Error(`duplicate collision key ${input.key}`);
      }
      collision[input.key] = entry;
    } else {
      addTexture(textures, input, entry);
    }
    spans.push({ bytes: input.bytes, offset });
    offset += Math.ceil(input.bytes.byteLength / OSPAK_ALIGN) * OSPAK_ALIGN;
  }
  const pak = new Uint8Array(offset);
  for (const span of spans) {
    pak.set(span.bytes, span.offset);
  }

  // A collision entry whose grid nobody stated is unreadable: 250 and 256 both "work" and one of them is
  // silently wrong, so the writer refuses rather than defaulting.
  if (Object.keys(collision).length > 0 && options.collisionCellSize === undefined) {
    throw new Error('collision entries need collisionCellSize — the GAME grid they are keyed on (never cellSize)');
  }

  return {
    manifest: {
      byteLength: pak.byteLength,
      cells,
      cellSize: options.cellSize ?? 250,
      ...(Object.keys(collision).length > 0 ? { collision, collisionCellSize: options.collisionCellSize } : {}),
      ...(options.lodPixelThreshold !== undefined ? { lodPixelThreshold: options.lodPixelThreshold } : {}),
      textures,
      ...(options.missingLayers !== undefined && options.missingLayers.length > 0
        ? { missingLayers: options.missingLayers }
        : {}),
      ...(options.uvAnimations !== undefined && options.uvAnimations.length > 0
        ? { uvAnimations: options.uvAnimations }
        : {}),
      version: OSPAK_VERSION,
    },
    pak,
  };
}

/**
 * The GPU features this world DEMANDS, derived from the formats its texture arrays are stored in.
 *
 * Derived, never stored: the manifest already records every array's format, so a declared field could only
 * drift from the payload it describes. This reads on every pak ever built, including the ones from before the
 * question was asked.
 *
 * It answers only for the WORLD. Vehicles and peds live outside the pak entirely (`<model>.osm` resolved by
 * name), so a build's full demand is this ∪ the model dictionaries' — see the packer's build-time check.
 */
export function ospakRequiredFeatures(manifest: OspakManifest): string[] {
  const features = new Set<string>();
  for (const entry of Object.values(manifest.textures)) {
    const feature = OSTEX_FORMAT_FEATURE[entry.format as OstexFormatId];
    if (feature !== undefined) {
      features.add(feature);
    }
  }

  return [...features].sort();
}

/** Validate a manifest a runtime just fetched (shape + version + range sanity). Throws with specifics. */
export function validateOspakManifest(manifest: OspakManifest): void {
  if (manifest.version !== OSPAK_VERSION) {
    throw new Error(`unsupported .ospak manifest version ${manifest.version} (reader supports ${OSPAK_VERSION})`);
  }
  if (manifest.collision !== undefined && manifest.collisionCellSize === undefined) {
    throw new Error('manifest carries collision entries without collisionCellSize (the grid they are keyed on)');
  }
  const all: [string, OspakEntry][] = [
    ...Object.entries(manifest.cells),
    ...Object.entries(manifest.collision ?? {}),
    ...Object.entries(manifest.textures),
  ];
  for (const [key, entry] of all) {
    if (entry.offset % OSPAK_ALIGN !== 0) {
      throw new Error(`entry ${key} offset ${entry.offset} not ${OSPAK_ALIGN}-aligned`);
    }
    if (entry.offset + entry.length > manifest.byteLength) {
      throw new Error(`entry ${key} range overruns pak (${entry.offset}+${entry.length}>${manifest.byteLength})`);
    }
  }
}

/** One cell entry: its range plus the de-duplicated, sorted refs of the arrays it draws with. */
function addCell(cells: OspakManifest['cells'], input: OspakInput, entry: OspakEntry): void {
  if (cells[input.key]) {
    throw new Error(`duplicate cell key ${input.key}`);
  }
  cells[input.key] = {
    ...entry,
    ...(input.aabb !== undefined ? { aabb: input.aabb } : {}),
    ...(input.aabbY !== undefined ? { aabbY: input.aabbY } : {}),
    ...(input.geometricError !== undefined ? { geometricError: input.geometricError } : {}),
    ...(input.textures !== undefined ? { textures: [...new Set(input.textures)].sort((a, b) => a - b) } : {}),
  };
}

/** One texture entry: its range plus the `.ostex` header meta the runtime schedules uploads with. */
function addTexture(textures: OspakManifest['textures'], input: OspakInput, entry: OspakEntry): void {
  if (!input.meta) {
    throw new Error(`texture entry ${input.key} missing meta`);
  }
  if (textures[input.key]) {
    throw new Error(`duplicate texture key ${input.key}`);
  }
  textures[input.key] = { ...entry, ...input.meta };
}
