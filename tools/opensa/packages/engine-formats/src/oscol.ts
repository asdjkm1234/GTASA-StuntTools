/**
 * `.oscol` — one CELL's collision, parsed at BUILD time (plan 200/3-01).
 *
 * The browser has no business parsing a 2004 archive format. Reading COL at runtime is the largest named
 * spike cost this project has measured — **9.6–78.3 ms per cell** for the parse alone, on the main thread,
 * plus 5.6–28.1 ms to build the Rapier bodies from it, and a cold district entry pays it ~95 times
 * ([plan 091](../../../docs/plans/091-frame-time-attribution/readme.md)).
 *
 * So the parse moves to the converter and the runtime gets the result: flat typed arrays it can hand to the
 * physics layer without touching a string, an archive or a chunk header.
 *
 * **Surface ids ride along, and that is not optional.** `materials` is one byte per TRIANGLE — the row index
 * into `surfinfo.dat` that says whether a triangle is tarmac, grass or sand. A bake that loses it is a DATA
 * regression however fast it loads: `p_grassmid1 ×0.71` under the wheels is authored design, and the offroad
 * work still owes `SAND` and `ROUGHNESS` to the same table. Absent materials mean "unknown surface" and must
 * never be read as surface 0.
 *
 * Model space is GTA Z-up throughout, like the render; each region carries the WORLD transforms of its
 * instances and the physics layer bakes them, exactly as it does today.
 */
import { ByteReader, ByteWriter } from './binary';

export const OSCOL_MAGIC = 0x4c43534f; // 'OSCL' little-endian
/**
 * 2 — the bake decides breakability.
 *
 * v1 carried no {@link OscolRegion.instanceKeys}, so a reader had to ask the ARCHIVE whether each model
 * shatters, which meant parsing a DFF per model on the very path the bake exists to keep out of the archive.
 * From v2 the writer resolves it and the keys ride along: **present = breakable, absent = not**, with no
 * third meaning. A v1 file is therefore not "an older bake with less detail", it is a bake whose breakability
 * is unknown — so it is refused rather than read as unbreakable, and the caller re-packs (or falls back to
 * parsing COL, which is what the runtime does).
 */
export const OSCOL_VERSION = 2;

/** No surface id for this primitive — distinct from surface 0, which is a real material. */
export const OSCOL_NO_MATERIAL = 0xff;

export interface Oscol {
  regions: OscolRegion[];
}

export interface OscolBox {
  /** SA surface id, or undefined when the source carried none. */
  material?: number;
  max: [number, number, number];
  min: [number, number, number];
}

/** One model's collision plus every placement of it inside this cell. */
export interface OscolRegion {
  boxes: OscolBox[];
  /** Triangle indices into {@link vertices}, 3 per triangle. */
  indices: Uint32Array;
  /** Per-INSTANCE keys for a breakable model (plan 045), aligned with {@link transforms}. Absent when the
   *  model cannot be smashed — its presence is what makes a region breakable, and from {@link OSCOL_VERSION}
   *  2 the WRITER owns that decision so the reader never has to open the model's DFF to ask. */
  instanceKeys?: string[];
  /** SA surface id per TRIANGLE (`indices.length / 3` bytes), or undefined when the source had none. */
  materials?: Uint8Array;
  name: string;
  spheres: OscolSphere[];
  /** Column-major 4×4 world transforms, 16 floats each. */
  transforms: Float32Array[];
  /** Flattened model-space positions (n × 3), GTA Z-up. */
  vertices: Float32Array;
}

export interface OscolSphere {
  center: [number, number, number];
  /** SA surface id, or undefined when the source carried none. */
  material?: number;
  radius: number;
}

export function decodeOscol(bytes: Uint8Array): Oscol {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSCOL_MAGIC) {
    throw new Error(`not an .oscol (magic 0x${magic.toString(16)})`);
  }
  const version = r.u32();
  if (version !== OSCOL_VERSION) {
    throw new Error(
      `unsupported .oscol version ${version} (reader supports ${OSCOL_VERSION}) — re-pack with ` +
        `opensa-pack --bake-collision`,
    );
  }
  const regionCount = r.u32();
  const regions: OscolRegion[] = [];
  for (let index = 0; index < regionCount; index += 1) {
    regions.push(readRegion(r));
  }

  return { regions };
}

export function encodeOscol(cell: Oscol): Uint8Array {
  const w = new ByteWriter(4096);
  w.u32(OSCOL_MAGIC);
  w.u32(OSCOL_VERSION);
  w.u32(cell.regions.length);
  for (const region of cell.regions) {
    writeRegion(w, region);
  }

  return w.bytes();
}

/** Triangles across every region — what a size/pressure comparison against the COL path is read in. */
export function oscolTriangleCount(cell: Oscol): number {
  return cell.regions.reduce((total, region) => total + region.indices.length / 3, 0);
}

function readMaterial(r: ByteReader): number | undefined {
  const value = r.u8();

  return value === OSCOL_NO_MATERIAL ? undefined : value;
}

function readRegion(r: ByteReader): OscolRegion {
  const name = readString(r);
  const hasMaterials = r.u8() === 1;
  const hasInstanceKeys = r.u8() === 1;
  r.u16(); // pad
  const sphereCount = r.u32();
  const boxCount = r.u32();
  const vertexCount = r.u32();
  const indexCount = r.u32();
  const transformCount = r.u32();

  const spheres: OscolSphere[] = [];
  for (let index = 0; index < sphereCount; index += 1) {
    const center: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    const radius = r.f32();
    const material = readMaterial(r);
    skipPad(r);
    spheres.push({ center, ...(material !== undefined ? { material } : {}), radius });
  }
  const boxes: OscolBox[] = [];
  for (let index = 0; index < boxCount; index += 1) {
    const min: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    const max: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    const material = readMaterial(r);
    skipPad(r);
    boxes.push({ max, ...(material !== undefined ? { material } : {}), min });
  }

  // Typed arrays are COPIED out rather than viewed over the pak bytes: the reader's buffer is a transient
  // (a worker message, a range read) and a view would keep the whole cell alive behind three small arrays.
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertices.length; index += 1) {
    vertices[index] = r.f32();
  }
  const indices = new Uint32Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    indices[index] = r.u32();
  }
  const materials = hasMaterials ? r.raw(indexCount / 3).slice() : undefined;
  if (hasMaterials) {
    skipPad(r);
  }
  const transforms: Float32Array[] = [];
  for (let index = 0; index < transformCount; index += 1) {
    const matrix = new Float32Array(16);
    for (let element = 0; element < 16; element += 1) {
      matrix[element] = r.f32();
    }
    transforms.push(matrix);
  }
  const instanceKeys = hasInstanceKeys ? Array.from({ length: transformCount }, () => readString(r)) : undefined;

  return {
    boxes,
    indices,
    ...(instanceKeys !== undefined ? { instanceKeys } : {}),
    ...(materials !== undefined ? { materials } : {}),
    name,
    spheres,
    transforms,
    vertices,
  };
}

function readString(r: ByteReader): string {
  const length = r.u16();
  const bytes = r.raw(length);
  skipPad(r);

  return new TextDecoder().decode(bytes);
}

/** The reader half of `ByteWriter.align(4)` — every variable-length field is followed by one. */
function skipPad(r: ByteReader): void {
  r.seek(r.position + ((4 - (r.position % 4)) % 4));
}

function writeRegion(w: ByteWriter, region: OscolRegion): void {
  const triangles = region.indices.length / 3;
  if (region.materials !== undefined && region.materials.length !== triangles) {
    throw new Error(
      `${region.name}: ${region.materials.length} materials for ${triangles} triangles — one surface id per ` +
        `TRIANGLE, or none at all`,
    );
  }
  if (region.instanceKeys !== undefined && region.instanceKeys.length !== region.transforms.length) {
    throw new Error(
      `${region.name}: ${region.instanceKeys.length} instance keys for ${region.transforms.length} transforms`,
    );
  }
  writeString(w, region.name);
  w.u8(region.materials !== undefined ? 1 : 0);
  w.u8(region.instanceKeys !== undefined ? 1 : 0);
  w.u16(0); // pad
  w.u32(region.spheres.length);
  w.u32(region.boxes.length);
  w.u32(region.vertices.length / 3);
  w.u32(region.indices.length);
  w.u32(region.transforms.length);

  for (const sphere of region.spheres) {
    w.f32(sphere.center[0]);
    w.f32(sphere.center[1]);
    w.f32(sphere.center[2]);
    w.f32(sphere.radius);
    w.u8(sphere.material ?? OSCOL_NO_MATERIAL);
    w.align(4);
  }
  for (const box of region.boxes) {
    for (const value of [...box.min, ...box.max]) {
      w.f32(value);
    }
    w.u8(box.material ?? OSCOL_NO_MATERIAL);
    w.align(4);
  }
  for (const value of region.vertices) {
    w.f32(value);
  }
  for (const value of region.indices) {
    w.u32(value);
  }
  if (region.materials !== undefined) {
    w.raw(region.materials);
    w.align(4);
  }
  for (const matrix of region.transforms) {
    for (const value of matrix) {
      w.f32(value);
    }
  }
  for (const key of region.instanceKeys ?? []) {
    writeString(w, key);
  }
}

function writeString(w: ByteWriter, value: string): void {
  const bytes = new TextEncoder().encode(value);
  w.u16(bytes.byteLength);
  w.raw(bytes);
  w.align(4);
}
