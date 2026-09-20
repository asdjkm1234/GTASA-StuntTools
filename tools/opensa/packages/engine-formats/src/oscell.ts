/**
 * `.oscell` — one streamed cell (HD or LOD level) in the final GPU layout (plan 074/02). The runtime "codec"
 * is a header parse + `queue.writeBuffer`: vertex/index payloads upload verbatim.
 *
 * Vertex layout v0 — interleaved, stride 36 B (all offsets 4-aligned where WebGPU requires):
 *   0  position  float32x3   cell-local (header carries the cell origin)
 *   12 normal    snorm8x4    .w = baked sunVis 0..1 (074/07; meaningful only with the SUN_VIS channel bit)
 *   16 uv        float32x2   GTA UVs tile far outside [0,1]
 *   24 dayPrelit unorm8x4    RGB day prelight, A = beam/cone alpha where used
 *   28 nightPrelit unorm8x4  RGB night set, A = sway weight (wind)
 *   32 layerChannels uint16x2  [0] = texture-array layer, [1] = aoSkyVis | emissive << 8 (unpacked in WGSL)
 */
import { ByteReader, ByteWriter } from './binary';

export const OSCELL_MAGIC = 0x3143534f; // 'OSC1' little-endian
export const OSCELL_VERSION_MAJOR = 0;
/** Minor 8 (plan 100 field close-out): the cell records how many ROADSIGN GLYPH QUADS it welded. Roadsign
 *  text is baked into an ordinary beam bucket, so once welded it is indistinguishable from any other
 *  geometry — which left "does a plate still draw at LOD range" answerable only by eye, and a 2.4 m plate at
 *  440 u is ~8 px. One number per cell, summed over VISIBLE cells, turns that into a reading. It is a COUNT,
 *  not a table: nothing renders from it.
 *  Minor 6 (074/22 phase 8): the PLACEMENT MAPPER — a row per merged placement range, naming the model it
 *  came from and the index range it owns, plus a per-cell name table. Welding destroys per-object identity
 *  (that is the point: 4.5x fewer draws), so the debugger could not answer "what did I just click". This is
 *  the identity the weld already knows, written down. Same shape as the breakable table, generalised to
 *  EVERY placement and carrying an AABB so a pick is a CPU ray test with no BVH and no ID-buffer readback.
 *  Minor 7 (085 row D): objectTable kind 5 = TIMED UV-SCROLL — a scroller that also carries a tobj window
 *  (casinoblock41_nt: the Fremont facade's stripes exist only 22→5). Minor 6 wrote such a bucket as TWO
 *  rows (kind 0 + kind 4): the scroll drew around the clock and doubled the geometry inside the window.
 *  Same skip rule as every new kind — older readers just never draw it.
 *  Minor 5 (B7·c): objectTable gained kind 4 = UV-SCROLL — a material whose UVs crawl (LV skull sign, conveyor
 *  belts). Its `params` is an INDEX into the pak manifest's `uvAnimations`; the transform is identity (the scroll
 *  rides a runtime uniform, not the vertex). No record layout change — older readers just never draw the kind.
 *  Minor 4 (B7·a): a light knows which smashable placement OWNS it — a smashed traffic light must take its
 *  coronas with it, and they were left hanging in the sky.
 *  Minor 3 (B7·a): the cell gained a BREAKABLE table — the index RANGES of each smashable placement, so the
 *  engine can shatter one crate by degenerating its triangles in place, without rebuilding the immutable
 *  bundle and without splitting the prop out of the merged batch (which measured 4.5x the draw calls).
 *  Minor 2 (B6): the cell gained a PARTICLE table (2dfx type-1 emitter anchors). Readers accept minor 1
 *  paks — they simply carry no particles. */
export const OSCELL_VERSION_MINOR = 8;
export const OSCELL_VERTEX_STRIDE = 36;

/** Header `flags` bits. */
export const OscellFlag = {
  /** Index buffer is uint16 (default uint32). */
  INDEX16: 1 << 0,
} as const;

/** `channelMask` bits — which OPTIONAL vertex data is meaningful (absent ⇒ zeros are placeholders). */
export const OscellChannel = {
  AO_SKY_VIS: 1 << 2,
  EMISSIVE: 1 << 3,
  NIGHT_PRELIT: 1 << 0,
  SUN_VIS: 1 << 4,
  SWAY: 1 << 1,
} as const;

export interface Oscell {
  bounds: readonly [number, number, number, number];
  /** Smashable placements (B7·a): index ranges the engine degenerates in place when a prop breaks. */
  breakables: OscellBreakable[];
  channelMask: number;
  groups: OscellGroup[];
  index16: boolean;
  indexCount: number;
  /** uint16 or uint32 raw index payload (see `index16`). */
  indexData: Uint8Array;
  lights: OscellLight[];
  /** Model/TXD names the placement table references by index (minor 6) — deduped per cell. */
  names: string[];
  objects: OscellObject[];
  origin: readonly [number, number, number];
  /** 2dfx PARTICLE emitters (074/06 row 13, B6): factory smoke, fires, fountains, vents, insects. */
  particles: OscellParticle[];
  /** The placement mapper (minor 6): which merged triangles belong to which placed object. */
  placements: OscellPlacement[];
  /** Roadsign glyph quads welded into this cell (minor 8) — a diagnostic COUNT, drawn from no table of its
   *  own. Summed over visible cells it is the only way to ask whether plates survive to LOD range. */
  roadsignQuads: number;
  vertexCount: number;
  /** Interleaved vertex payload, stride {@link OSCELL_VERTEX_STRIDE}. */
  vertexData: Uint8Array;
}

/**
 * One smashable placement's triangles inside the cell's merged index buffer (B7·a).
 *
 * A prop's geometry is split across buckets by material, so ONE placement can own SEVERAL ranges — the table
 * simply carries a row per range, all sharing the placement's `keyHash` (FNV-1a of the same
 * `breakableInstanceKey` the physics collider is tagged with, so a contact event resolves with no lookup).
 */
export interface OscellBreakable {
  indexCount: number;
  indexOffset: number;
  keyHash: number;
}

/** One GPU draw (the unit of offline merging — plan 074/02). */
export interface OscellGroup {
  /** Bounding sphere [x, y, z, r] in cell-local space (sub-cell culling without a format change). */
  bounds: readonly [number, number, number, number];
  indexCount: number;
  indexOffset: number;
  /** 0 opaque | 1 cutout (A2C) | 2 blend | 3 beam | 4 additive (plan 085). */
  pipelineClass: number;
  /** 0 front-side | 1 double-sided. */
  side: number;
  /** Which `.ostex` array this group samples (manifest index). */
  textureArrayRef: number;
}

/** A 2dfx light/corona anchor (transplanted by the existing LOD chain). */
export interface OscellLight {
  color: readonly [number, number, number, number];
  farClip: number;
  /** Key hash of the smashable placement this light belongs to; 0 when nothing can smash it (minor 4). */
  owner: number;
  position: readonly [number, number, number];
  size: number;
}

/** An unmergeable object (rendered OUTSIDE the cell bundle): timed/breakable/animated/roadsign. */
export interface OscellObject {
  groupCount: number;
  groupStart: number;
  /** 0 timed | 1 breakable | 2 animated | 3 roadsign | 4 uvScroll | 5 timed uvScroll (minor 7). */
  kind: number;
  /** kind-specific packed params (timed: onHour | offHour << 8; uvScroll: manifest uvAnimations index;
   *  timed uvScroll: index | onHour << 16 | offHour << 24). */
  params: number;
  /** Row-major 3×4 affine transform (cell-local). */
  transform: readonly number[];
}

/**
 * One 2dfx particle emitter anchor. The FX SYSTEM itself (its keyframed tracks, sprite and blend mode) lives
 * in `effects.fxp`, which the host parses — the cell only says WHERE an emitter of a given name sits. The
 * whole map carries ~113 of these, so the name rides inline rather than through a string table.
 */
export interface OscellParticle {
  /** FX system name, lowercased (`ws_factorysmoke`, `fire`, `water_fountain` …). */
  effectName: string;
  /** Cell-local ENGINE coordinates. */
  position: readonly [number, number, number];
}

/**
 * One placed object's triangles inside the cell's merged index buffer (minor 6) — the debugger's mapper.
 *
 * A placement's geometry is split across buckets by material, exactly like a breakable's, so ONE object can
 * own SEVERAL rows; they share an `id` and each carries its OWN range and AABB (a per-range box picks more
 * precisely than one box around the whole object, and costs nothing extra).
 *
 * `id` is the placement's stable hash — the same FNV-1a of the placement key the breakable table and the
 * physics colliders use, so a row can be cross-referenced with either.
 */
export interface OscellPlacement {
  /** Cell-local AABB, `[minX, minY, minZ, maxX, maxY, maxZ]` — the pick test. */
  bounds: readonly number[];
  id: number;
  indexCount: number;
  indexOffset: number;
  /** Index into {@link Oscell.names} — the model name. */
  nameRef: number;
  /** Index into {@link Oscell.names} — the TXD name. */
  txdRef: number;
}

const GROUP_RECORD_BYTES = 32;
const OBJECT_RECORD_BYTES = 64;
const LIGHT_RECORD_BYTES = 28;
/** Placement mapper row: id u32 + nameRef/txdRef u16 + range 2xu32 + AABB 6xf32. */
const PLACEMENT_RECORD_BYTES = 40;

export function decodeOscell(bytes: Uint8Array): Oscell {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSCELL_MAGIC) {
    throw new Error(`not an .oscell (magic 0x${magic.toString(16)})`);
  }
  const major = r.u16();
  const minor = r.u16();
  if (major !== OSCELL_VERSION_MAJOR) {
    throw new Error(`unsupported .oscell major ${major} (reader supports ${OSCELL_VERSION_MAJOR})`);
  }
  const flags = r.u32();
  const channelMask = r.u32();
  const bounds = [r.f32(), r.f32(), r.f32(), r.f32()] as const;
  const origin = [r.f32(), r.f32(), r.f32()] as const;
  r.f32(); // pad
  const vertexCount = r.u32();
  const indexCount = r.u32();
  const groupCount = r.u32();
  const objectCount = r.u32();
  const lightCount = r.u32();
  // Minor 2 (B6) inserted the particle count here. Minor-1 paks simply have no particles — read them as 0
  // and DO NOT consume a word, or every offset after this point shifts.
  const particleCount = minor >= 2 ? r.u32() : 0;
  // Minor 3 (B7) appends the breakable count on the same rule — an older pak has none, and must not lose a word.
  const breakableCount = minor >= 3 ? r.u32() : 0;
  // Minor 6 appends the placement count on the same rule — a pre-mapper pak reads 0 and keeps every
  // following offset where it is. The debugger's Map screen degrades to "no picking" on such a pak.
  const placementCount = minor >= 6 ? r.u32() : 0;
  // Minor 8 appends the roadsign glyph-quad COUNT on the same rule — a pre-minor-8 pak reads 0, which is
  // "unknown" rather than "none", and every following offset stays where it is.
  const roadsignQuads = minor >= 8 ? r.u32() : 0;
  const vertexOffset = r.u32();
  const indexOffset = r.u32();
  const tableOffset = r.u32();

  const index16 = (flags & OscellFlag.INDEX16) !== 0;
  r.seek(vertexOffset);
  const vertexData = r.raw(vertexCount * OSCELL_VERTEX_STRIDE);
  r.seek(indexOffset);
  const indexData = r.raw(indexCount * (index16 ? 2 : 4));

  r.seek(tableOffset);
  const groups: OscellGroup[] = [];
  for (let index = 0; index < groupCount; index += 1) {
    const pipelineClass = r.u8();
    const side = r.u8();
    const textureArrayRef = r.u16();
    const groupIndexOffset = r.u32();
    const groupIndexCount = r.u32();
    const groupBounds = [r.f32(), r.f32(), r.f32(), r.f32()] as const;
    r.u32(); // pad
    groups.push({
      bounds: groupBounds,
      indexCount: groupIndexCount,
      indexOffset: groupIndexOffset,
      pipelineClass,
      side,
      textureArrayRef,
    });
  }
  const objects = readObjects(r, objectCount);
  const lights = readLights(r, lightCount, minor);
  const particles = readParticles(r, particleCount);
  const breakables = readBreakables(r, breakableCount);
  const placements = readPlacements(r, placementCount);
  const names = placementCount > 0 ? readNames(r) : [];

  return {
    bounds,
    breakables,
    channelMask,
    groups,
    index16,
    indexCount,
    indexData,
    lights,
    names,
    objects,
    origin,
    particles,
    placements,
    roadsignQuads,
    vertexCount,
    vertexData,
  };
}

export function encodeOscell(cell: Oscell): Uint8Array {
  if (cell.vertexData.byteLength !== cell.vertexCount * OSCELL_VERTEX_STRIDE) {
    throw new Error(
      `vertexData ${cell.vertexData.byteLength} B ≠ vertexCount ${cell.vertexCount} × stride ${OSCELL_VERTEX_STRIDE}`,
    );
  }
  const indexBytesPer = cell.index16 ? 2 : 4;
  if (cell.indexData.byteLength !== cell.indexCount * indexBytesPer) {
    throw new Error(`indexData ${cell.indexData.byteLength} B ≠ indexCount ${cell.indexCount} × ${indexBytesPer}`);
  }
  const w = new ByteWriter(cell.vertexData.byteLength + cell.indexData.byteLength + 4096);
  w.u32(OSCELL_MAGIC);
  w.u16(OSCELL_VERSION_MAJOR);
  w.u16(OSCELL_VERSION_MINOR);
  w.u32(cell.index16 ? OscellFlag.INDEX16 : 0);
  w.u32(cell.channelMask);
  for (const value of cell.bounds) {
    w.f32(value);
  }
  for (const value of cell.origin) {
    w.f32(value);
  }
  w.f32(0); // pad
  w.u32(cell.vertexCount);
  w.u32(cell.indexCount);
  w.u32(cell.groups.length);
  w.u32(cell.objects.length);
  w.u32(cell.lights.length);
  w.u32(cell.particles.length);
  w.u32(cell.breakables.length);
  w.u32(cell.placements.length);
  w.u32(cell.roadsignQuads);
  const vertexOffsetSlot = w.reserveU32();
  const indexOffsetSlot = w.reserveU32();
  const tableOffsetSlot = w.reserveU32();

  w.align(4);
  w.patchU32(vertexOffsetSlot, w.offset);
  w.raw(cell.vertexData);
  w.align(4);
  w.patchU32(indexOffsetSlot, w.offset);
  w.raw(cell.indexData);
  w.align(4);
  w.patchU32(tableOffsetSlot, w.offset);
  for (const group of cell.groups) {
    w.u8(group.pipelineClass);
    w.u8(group.side);
    w.u16(group.textureArrayRef);
    w.u32(group.indexOffset);
    w.u32(group.indexCount);
    for (const value of group.bounds) {
      w.f32(value);
    }
    w.u32(0); // pad to GROUP_RECORD_BYTES
  }
  for (const object of cell.objects) {
    w.u8(object.kind);
    w.u8(0);
    w.u16(0);
    w.u32(object.params);
    w.u32(object.groupStart);
    w.u32(object.groupCount);
    if (object.transform.length !== 12) {
      throw new Error(`object transform must be 12 floats (3×4), got ${object.transform.length}`);
    }
    for (const value of object.transform) {
      w.f32(value);
    }
  }
  writeLights(w, cell.lights);
  writeParticles(w, cell.particles);
  for (const breakable of cell.breakables) {
    w.u32(breakable.keyHash);
    w.u32(breakable.indexOffset);
    w.u32(breakable.indexCount);
  }
  writePlacements(w, cell.placements, cell.names);

  return w.bytes();
}

/** Record sizes exported for the tool's budget math. */
export const OSCELL_RECORD_BYTES = {
  group: GROUP_RECORD_BYTES,
  light: LIGHT_RECORD_BYTES,
  object: OBJECT_RECORD_BYTES,
  placement: PLACEMENT_RECORD_BYTES,
} as const;

function readBreakables(r: ByteReader, count: number): OscellBreakable[] {
  const breakables: OscellBreakable[] = [];
  for (let index = 0; index < count; index += 1) {
    // Read into locals FIRST. Reads are side-effecting and an object literal evaluates its values in KEY
    // order, which the linter sorts alphabetically — writing them inline silently rotated the three fields
    // (the key hash landed in `indexCount`) and every hit missed. Same rule as every other reader here.
    const keyHash = r.u32();
    const indexOffset = r.u32();
    const indexCount = r.u32();
    breakables.push({ indexCount, indexOffset, keyHash });
  }

  return breakables;
}

function readLights(r: ByteReader, count: number, minor: number): OscellLight[] {
  const lights: OscellLight[] = [];
  for (let index = 0; index < count; index += 1) {
    // Read into locals: an object literal evaluates its values in KEY order, which the linter sorts — inlining
    // side-effecting reads once rotated three fields of the breakable table and cost a field round.
    const position = [r.f32(), r.f32(), r.f32()] as const;
    const color = [r.u8(), r.u8(), r.u8(), r.u8()] as const;
    const size = r.f32();
    const farClip = r.f32();
    const owner = minor >= 4 ? r.u32() : 0;
    lights.push({ color, farClip, owner, position, size });
  }

  return lights;
}

/** The placement table's name pool: u16 count, then length-prefixed ASCII (model + TXD names are both ASCII). */
function readNames(r: ByteReader): string[] {
  const count = r.u16();
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = r.u8();
    let name = '';
    for (let at = 0; at < length; at += 1) {
      name += String.fromCharCode(r.u8());
    }
    names.push(name);
  }

  return names;
}

function readObjects(r: ByteReader, count: number): OscellObject[] {
  const objects: OscellObject[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind = r.u8();
    r.u8();
    r.u16();
    const params = r.u32();
    const groupStart = r.u32();
    const groupCountOwn = r.u32();
    const transform: number[] = [];
    for (let component = 0; component < 12; component += 1) {
      transform.push(r.f32());
    }
    objects.push({ groupCount: groupCountOwn, groupStart, kind, params, transform });
  }

  return objects;
}

/** The 2dfx emitter anchors (B6): position + an inline effect name (the map carries only ~113 of them). */
function readParticles(r: ByteReader, count: number): OscellParticle[] {
  const particles: OscellParticle[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = [r.f32(), r.f32(), r.f32()] as const;
    const nameLength = r.u8();
    let effectName = '';
    for (let at = 0; at < nameLength; at += 1) {
      effectName += String.fromCharCode(r.u8());
    }
    particles.push({ effectName, position });
  }

  return particles;
}

function readPlacements(r: ByteReader, count: number): OscellPlacement[] {
  const placements: OscellPlacement[] = [];
  for (let index = 0; index < count; index += 1) {
    // Locals first — the linter sorts object keys, and inlining side-effecting reads once rotated the
    // breakable table's three fields (see readBreakables).
    const id = r.u32();
    const nameRef = r.u16();
    const txdRef = r.u16();
    const indexOffset = r.u32();
    const indexCount = r.u32();
    const bounds = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32()];
    placements.push({ bounds, id, indexCount, indexOffset, nameRef, txdRef });
  }

  return placements;
}

function writeLights(w: ByteWriter, lights: readonly OscellLight[]): void {
  for (const light of lights) {
    for (const value of light.position) {
      w.f32(value);
    }
    for (const value of light.color) {
      w.u8(value);
    }
    w.f32(light.size);
    w.f32(light.farClip);
    w.u32(light.owner);
  }
}

function writeNames(w: ByteWriter, names: readonly string[]): void {
  w.u16(names.length);
  for (const raw of names) {
    const name = raw.slice(0, 255);
    w.u8(name.length);
    for (let at = 0; at < name.length; at += 1) {
      w.u8(name.charCodeAt(at));
    }
  }
}

function writeParticles(w: ByteWriter, particles: readonly OscellParticle[]): void {
  for (const particle of particles) {
    for (const value of particle.position) {
      w.f32(value);
    }
    const name = particle.effectName.slice(0, 255);
    w.u8(name.length);
    for (let at = 0; at < name.length; at += 1) {
      w.u8(name.charCodeAt(at));
    }
  }
}

/** The mapper rows, followed by their name pool — the pool is written only when rows reference it. */
function writePlacements(w: ByteWriter, placements: readonly OscellPlacement[], names: readonly string[]): void {
  for (const placement of placements) {
    if (placement.bounds.length !== 6) {
      throw new Error(`placement bounds must be 6 floats (min+max), got ${placement.bounds.length}`);
    }
    w.u32(placement.id);
    w.u16(placement.nameRef);
    w.u16(placement.txdRef);
    w.u32(placement.indexOffset);
    w.u32(placement.indexCount);
    for (const value of placement.bounds) {
      w.f32(value);
    }
  }
  if (placements.length > 0) {
    writeNames(w, names);
  }
}
