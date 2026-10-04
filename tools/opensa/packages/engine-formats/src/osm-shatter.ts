/**
 * The `.osm` `SHAT` section (plan opensa-pack/003 phase 5): a prop's shatter mesh, baked.
 *
 * Today the first hit on a smashable prop runs `getBreakable` → `getClump` → a full `parseDff` of the model
 * on the MAIN thread, then scans its geometries for the one carrying the RW Breakable plugin — and for the
 * props that ship none (boxes, bags), synthesizes one from the render mesh instead. All of that is decided
 * by data that never changes, so the converter decides it once and this section is what it wrote.
 *
 * The synthesized-vs-authored choice is resolved OFFLINE: whatever the runtime would have picked is what
 * gets baked, so the reader has no fallback branch and no vertex-count cap to re-check.
 *
 * Texture names stay NAMES here, not layer indices: the debris path resolves them against the prop's TXD by
 * name and resamples onto its own 64² shard atlas, which is a different contract from the `meta.x` layer
 * index the model geometry uses.
 */
import { ByteReader, ByteWriter } from './binary';

export interface OsmShatter {
  /** Per-vertex RGBA (vertices × 4). */
  colours: Uint8Array;
  materials: OsmShatterMaterial[];
  /** Vertex positions in GTA model space, flattened (vertices × 3). */
  positions: Float32Array;
  /** Per-triangle material index (triangles). */
  triangleMaterials: Uint16Array;
  /** Triangle vertex indices, flattened (triangles × 3). */
  triangles: Uint16Array;
  /** Vertex UVs, flattened (vertices × 2). */
  uvs: Float32Array;
}

export interface OsmShatterMaterial {
  /** Ambient colour multiplier (RGB 0–1). */
  ambient: [number, number, number];
  /** Mask texture name, '' when none. */
  mask: string;
  texture: string;
}

export function decodeOsmShatter(bytes: Uint8Array): OsmShatter {
  const r = new ByteReader(bytes);
  const vertexCount = r.u32();
  const triangleCount = r.u32();
  const materialCount = r.u32();

  const materials: OsmShatterMaterial[] = [];
  for (let index = 0; index < materialCount; index += 1) {
    const ambient: [number, number, number] = [r.f32(), r.f32(), r.f32()];
    materials.push({ ambient, mask: readString(r), texture: readString(r) });
  }

  // Copy out rather than view: the section may sit at an unaligned offset inside the container.
  const positions = new Float32Array(vertexCount * 3);
  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = r.f32();
  }
  const uvs = new Float32Array(vertexCount * 2);
  for (let index = 0; index < uvs.length; index += 1) {
    uvs[index] = r.f32();
  }
  const colours = r.raw(vertexCount * 4).slice();
  const triangles = new Uint16Array(triangleCount * 3);
  for (let index = 0; index < triangles.length; index += 1) {
    triangles[index] = r.u16();
  }
  const triangleMaterials = new Uint16Array(triangleCount);
  for (let index = 0; index < triangleMaterials.length; index += 1) {
    triangleMaterials[index] = r.u16();
  }

  return { colours, materials, positions, triangleMaterials, triangles, uvs };
}

export function encodeOsmShatter(shatter: OsmShatter): Uint8Array {
  const vertexCount = shatter.positions.length / 3;
  const triangleCount = shatter.triangleMaterials.length;
  const w = new ByteWriter(
    64 +
      shatter.materials.length * 64 +
      shatter.positions.byteLength +
      shatter.uvs.byteLength +
      shatter.colours.byteLength +
      shatter.triangles.byteLength +
      shatter.triangleMaterials.byteLength,
  );
  w.u32(vertexCount);
  w.u32(triangleCount);
  w.u32(shatter.materials.length);

  for (const material of shatter.materials) {
    w.f32(material.ambient[0]);
    w.f32(material.ambient[1]);
    w.f32(material.ambient[2]);
    writeString(w, material.mask);
    writeString(w, material.texture);
  }
  for (const value of shatter.positions) {
    w.f32(value);
  }
  for (const value of shatter.uvs) {
    w.f32(value);
  }
  w.raw(shatter.colours);
  for (const value of shatter.triangles) {
    w.u16(value);
  }
  for (const value of shatter.triangleMaterials) {
    w.u16(value);
  }

  return w.bytes();
}

/** Length-prefixed UTF-8 (texture names are ASCII in practice, but the prefix costs nothing). */
function readString(r: ByteReader): string {
  return new TextDecoder().decode(r.raw(r.u16()));
}

function writeString(w: ByteWriter, value: string): void {
  const encoded = new TextEncoder().encode(value);
  w.u16(encoded.length);
  w.raw(encoded);
}
