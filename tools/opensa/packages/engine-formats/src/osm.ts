/**
 * `.osm` — one MODEL in our format (plan opensa-pack/003). The world-scoped formats (`.oscell`/`.ostex`)
 * cover welded cells; this covers the assets the runtime still resolves BY NAME — vehicles, peds, clutter,
 * breakables, animated objects.
 *
 * SECTIONED on purpose. A vehicle's DFF is consumed twice today: the geometry is transferred to the build
 * worker while the MAIN thread parses the same bytes for collision (`gta-sa-world.adapter.ts:619`). With a
 * section table each consumer reads only its own range — the main thread takes `COLL` without touching the
 * geometry, and nothing is parsed twice. Sections are opaque byte ranges here; what is inside each one is
 * the asset class's business.
 *
 * Textures are NOT a section: a model's texture dictionary is a `.ostex` (a `texture2d_array`) beside it in
 * the archive, because that is exactly what `.ostex` already is.
 */
import { ByteReader, ByteWriter } from './binary';

export const OSM_MAGIC = 0x314d534f; // 'OSM1' little-endian
export const OSM_VERSION_MAJOR = 0;
export const OSM_VERSION_MINOR = 1;

/** Sections are 4-byte aligned so a consumer can view typed arrays over a decoded range. */
export const OSM_SECTION_ALIGN = 4;

/**
 * The section tags in use. Values are the 4-character tag read little-endian, so they are legible in a hex
 * dump — a file that lies about what it is costs hours (the reason `.osm` is a visible extension at all).
 */
export const OsmSectionTag = {
  /** Baked collision in ENGINE shape: hulls/bounds ready for physics, no RW COL parse at spawn. */
  COLL: osmTag('COLL'),
  /** Structural description (UTF-8 JSON): parts, submeshes, wheels, doors, buffer layout. */
  DESC: osmTag('DESC'),
  /** Geometry payload: the concatenated vertex/index buffers `DESC` lays out. */
  GEOM: osmTag('GEOM'),
  /** A topple prop's collider point cloud + fallback box — no second clump walk when it is knocked over. */
  HULL: osmTag('HULL'),
  /** A smashable prop's baked shatter mesh — no DFF parse on the first hit (phase 5). */
  SHAT: osmTag('SHAT'),
  /** An animated object's FRAME TREE — the IFP's bones are these frames, matched by name (phase 5). */
  SKEL: osmTag('SKEL'),
  /**
   * The model's texture dictionary: a complete `.ostex` payload, carried INSIDE the container.
   *
   * It was a sibling `<model>.ostex` file until phase 5 measured the archive: a VER2 entry name is capped
   * at 23 bytes, and `.ostex` is two characters longer than `.txd`, so **457 of ~14 900 stock models could
   * not have carried one** (`veg_procgrasspatch.ostex` = 24). `.osm` fits every name. The texture FORMAT is
   * unchanged — this is packaging, not a new dictionary format.
   *
   * The payload is `OsmTextures`: one or more `.ostex` arrays, because a model whose textures disagree on
   * size cannot live in a single `texture2d_array` (23 of 265 stock peds do). See `osm-textures.ts`.
   */
  TEXS: osmTag('TEXS'),
} as const;

export interface Osm {
  /** Tag → payload, in file order. Decoded views alias the source bytes (no copy). */
  sections: Map<number, Uint8Array>;
  versionMajor: number;
  versionMinor: number;
}

export interface OsmSection {
  bytes: Uint8Array;
  tag: number;
}

/** Decode a `.osm` container. Section payloads are VIEWS over `bytes` — copy before mutating. */
export function decodeOsm(bytes: Uint8Array): Osm {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSM_MAGIC) {
    throw new Error(`not a .osm file (magic 0x${magic.toString(16)})`);
  }
  const versionMajor = r.u16();
  const versionMinor = r.u16();
  if (versionMajor !== OSM_VERSION_MAJOR) {
    throw new Error(`.osm major version ${versionMajor} ≠ ${OSM_VERSION_MAJOR}`);
  }
  const count = r.u32();
  const table: { length: number; offset: number; tag: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    // Read into locals FIRST: these are side-effecting reads, and an object literal's property order is
    // not something to trust (the repo's sort-objects autofix will happily reorder it).
    const tag = r.u32();
    const offset = r.u32();
    const length = r.u32();
    table.push({ length, offset, tag });
  }

  const sections = new Map<number, Uint8Array>();
  for (const entry of table) {
    if (entry.offset + entry.length > bytes.byteLength) {
      throw new RangeError(
        `.osm section ${osmTagName(entry.tag)} overruns the file ` +
          `(${entry.offset}+${entry.length} > ${bytes.byteLength})`,
      );
    }
    sections.set(entry.tag, bytes.subarray(entry.offset, entry.offset + entry.length));
  }

  return { sections, versionMajor, versionMinor };
}

/** Assemble a `.osm` from its sections, in the order given. */
export function encodeOsm(sections: readonly OsmSection[]): Uint8Array {
  const seen = new Set<number>();
  for (const section of sections) {
    if (seen.has(section.tag)) {
      throw new Error(`duplicate .osm section ${osmTagName(section.tag)}`);
    }
    seen.add(section.tag);
  }

  const headerBytes = 4 + 2 + 2 + 4 + sections.length * 12;
  const w = new ByteWriter(headerBytes + sections.reduce((sum, s) => sum + s.bytes.byteLength + 4, 0));
  w.u32(OSM_MAGIC);
  w.u16(OSM_VERSION_MAJOR);
  w.u16(OSM_VERSION_MINOR);
  w.u32(sections.length);

  // Offsets are known up front: the table is fixed-size, then each payload is aligned in order.
  let offset = headerBytes;
  for (const section of sections) {
    offset += (OSM_SECTION_ALIGN - (offset % OSM_SECTION_ALIGN)) % OSM_SECTION_ALIGN;
    w.u32(section.tag);
    w.u32(offset);
    w.u32(section.bytes.byteLength);
    offset += section.bytes.byteLength;
  }
  for (const section of sections) {
    w.align(OSM_SECTION_ALIGN);
    w.raw(section.bytes);
  }

  return w.bytes();
}

/** A section's payload, or null when the file does not carry it. */
export function osmSection(osm: Osm, tag: number): null | Uint8Array {
  return osm.sections.get(tag) ?? null;
}

/** `'GEOM'` → the u32 the container stores (little-endian, so hex dumps stay legible). */
export function osmTag(tag: string): number {
  if (tag.length !== 4) {
    throw new Error(`.osm section tags are 4 characters: '${tag}'`);
  }

  return (tag.charCodeAt(0) | (tag.charCodeAt(1) << 8) | (tag.charCodeAt(2) << 16) | (tag.charCodeAt(3) << 24)) >>> 0;
}

/** The inverse of {@link osmTag} — for error messages. */
export function osmTagName(tag: number): string {
  return String.fromCharCode(tag & 0xff, (tag >> 8) & 0xff, (tag >> 16) & 0xff, (tag >>> 24) & 0xff);
}
