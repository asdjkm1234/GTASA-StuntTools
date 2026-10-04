/**
 * PMTiles v3 — a whole tile pyramid in ONE file on static storage, read by HTTP range requests
 * ([201/6-02](../../../docs/plans/201-dispatch-console/6-display-modes/readme.md)).
 *
 * Why a foreign format in a folder of our own: the flat 2D map is the mode that has to run where nothing
 * else does, and tile HOSTING is the part of a tile map that is normally a server. PMTiles removes it — the
 * pak is already served as static range-friendly files, so the tile pyramid ships the same way and the
 * console reads it with the same `Range` header. It is also read by MapLibre, `pmtiles` and QGIS as it
 * stands, which is worth more than a private layout nobody else can open.
 *
 * What this file is NOT: a general PMTiles library. It writes what our own baker produces (clustered, one
 * tile type, no internal compression) and reads any v3 archive whose directories are uncompressed. A gzipped
 * directory is REFUSED by name rather than mis-parsed — this package has no dependencies and a silent
 * mis-read of a varint stream produces plausible garbage.
 *
 * Ceiling: tile ids are plain numbers, exact to 2^53, which covers every zoom to 26. Past that the writer
 * throws instead of quietly losing the low bits.
 */
import { ByteReader, ByteWriter } from './binary';

export const PMTILES_MAGIC = 'PMTiles';
export const PMTILES_VERSION = 3;
/** The header is a fixed 127 bytes at offset 0 — the spec's number, not ours. */
export const PMTILES_HEADER_BYTES = 127;
/** What a reader fetches first: header + root directory in one request, by the format's own convention. */
export const PMTILES_ROOT_BYTES = 16_384;
/** Beyond this the hilbert id stops being an exact double. */
const MAX_ZOOM = 26;

export const PmtilesCompression = {
  BROTLI: 3,
  GZIP: 2,
  NONE: 1,
  UNKNOWN: 0,
  ZSTD: 4,
} as const;
export type PmtilesCompressionId = (typeof PmtilesCompression)[keyof typeof PmtilesCompression];

export const PmtilesTileType = {
  AVIF: 5,
  JPEG: 3,
  MVT: 1,
  PNG: 2,
  UNKNOWN: 0,
  WEBP: 4,
} as const;
export interface PmtilesArchiveInput {
  readonly bounds: PmtilesBounds;
  /** JSON metadata — the baker's own record of what world this is and how it was rendered. */
  readonly metadata: Record<string, unknown>;
  readonly tiles: readonly PmtilesInputTile[];
  readonly tileType: PmtilesTileTypeId;
}

/**
 * The bounds and centre the header carries.
 *
 * **These are longitude/latitude, and our world is not on Earth.** The format has nowhere else to put an
 * extent, and a reader that ignores it (ours does — the console projects GTA coordinates itself) is not
 * harmed by it, while a reader that does not (QGIS, MapLibre) at least gets a box of the right SHAPE. The
 * baker maps the world square onto the web-mercator square, which is the same choice SanMap made.
 */
export interface PmtilesBounds {
  readonly centerZoom: number;
  readonly maxLat: number;
  readonly maxLon: number;
  readonly minLat: number;
  readonly minLon: number;
}

/** One directory row. `runLength === 0` means "this row points at a LEAF directory", not at a tile. */
export interface PmtilesEntry {
  readonly length: number;
  readonly offset: number;
  readonly runLength: number;
  readonly tileId: number;
}

export interface PmtilesHeader {
  readonly clustered: boolean;
  readonly internalCompression: PmtilesCompressionId;
  readonly leafDirsLength: number;
  readonly leafDirsOffset: number;
  readonly maxZoom: number;
  readonly metadataLength: number;
  readonly metadataOffset: number;
  readonly minZoom: number;
  readonly rootLength: number;
  readonly rootOffset: number;
  readonly tileCompression: PmtilesCompressionId;
  readonly tileDataLength: number;
  readonly tileDataOffset: number;
  readonly tileType: PmtilesTileTypeId;
}

/** One tile as the baker hands it over. `z/x/y` is the usual XYZ scheme — the hilbert id is computed here. */
export interface PmtilesInputTile {
  readonly bytes: Uint8Array;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type PmtilesTileTypeId = (typeof PmtilesTileType)[keyof typeof PmtilesTileType];

/** Deserialize one directory (root or leaf). */
export function decodePmtilesDirectory(bytes: Uint8Array): readonly PmtilesEntry[] {
  const cursor = { at: 0 };
  const count = readVarint(bytes, cursor);
  const ids = new Array<number>(count);
  const runs = new Array<number>(count);
  const lengths = new Array<number>(count);
  const offsets = new Array<number>(count);
  let last = 0;
  for (let index = 0; index < count; index += 1) {
    last += readVarint(bytes, cursor);
    ids[index] = last;
  }
  for (let index = 0; index < count; index += 1) {
    runs[index] = readVarint(bytes, cursor);
  }
  for (let index = 0; index < count; index += 1) {
    lengths[index] = readVarint(bytes, cursor);
  }
  for (let index = 0; index < count; index += 1) {
    const value = readVarint(bytes, cursor);
    offsets[index] = value === 0 && index > 0 ? offsets[index - 1] + lengths[index - 1] : value - 1;
  }

  return ids.map((tileId, index) => ({
    length: lengths[index],
    offset: offsets[index],
    runLength: runs[index],
    tileId,
  }));
}

/** Parse the fixed header. Throws by NAME on anything this reader cannot honour. */
export function decodePmtilesHeader(bytes: Uint8Array): PmtilesHeader {
  if (bytes.byteLength < PMTILES_HEADER_BYTES) {
    throw new Error(`pmtiles: header needs ${PMTILES_HEADER_BYTES} bytes, got ${bytes.byteLength}`);
  }
  const reader = new ByteReader(bytes);
  const magic = new TextDecoder().decode(reader.raw(7));
  if (magic !== PMTILES_MAGIC) {
    throw new Error(`pmtiles: not a PMTiles archive (magic "${magic}")`);
  }
  const version = reader.u8();
  if (version !== PMTILES_VERSION) {
    throw new Error(`pmtiles: version ${version} is not v${PMTILES_VERSION}`);
  }
  const rootOffset = reader.u64();
  const rootLength = reader.u64();
  const metadataOffset = reader.u64();
  const metadataLength = reader.u64();
  const leafDirsOffset = reader.u64();
  const leafDirsLength = reader.u64();
  const tileDataOffset = reader.u64();
  const tileDataLength = reader.u64();
  reader.u64(); // addressed tiles
  reader.u64(); // tile entries
  reader.u64(); // tile contents
  const clustered = reader.u8() === 1;
  const internalCompression = reader.u8() as PmtilesCompressionId;
  const tileCompression = reader.u8() as PmtilesCompressionId;
  const tileType = reader.u8() as PmtilesTileTypeId;
  const minZoom = reader.u8();
  const maxZoom = reader.u8();
  if (internalCompression !== PmtilesCompression.NONE) {
    throw new Error(
      `pmtiles: directory compression ${internalCompression} is not supported (this reader has no inflater)`,
    );
  }

  return {
    clustered,
    internalCompression,
    leafDirsLength,
    leafDirsOffset,
    maxZoom,
    metadataLength,
    metadataOffset,
    minZoom,
    rootLength,
    rootOffset,
    tileCompression,
    tileDataLength,
    tileDataOffset,
    tileType,
  };
}

/**
 * Build the archive.
 *
 * Identical tiles share one payload — a bake of the sea produces thousands of the same blue square, and
 * writing each of them would be the whole point of the mode thrown away. The dedupe is by CONTENT, so it
 * needs no knowledge of what a tile means.
 */
export function encodePmtiles(input: PmtilesArchiveInput): Uint8Array {
  const sorted = [...input.tiles]
    .map((tile) => ({ ...tile, id: pmtilesTileId(tile.z, tile.x, tile.y) }))
    .sort((a, b) => a.id - b.id);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].id === sorted[index - 1].id) {
      throw new Error(`pmtiles: duplicate tile ${sorted[index].z}/${sorted[index].x}/${sorted[index].y}`);
    }
  }

  const data = new ByteWriter(1 << 20);
  const seen = new Map<string, { length: number; offset: number }>();
  const entries: PmtilesEntry[] = [];
  for (const tile of sorted) {
    const key = contentKey(tile.bytes);
    let placed = seen.get(key);
    if (!placed) {
      placed = { length: tile.bytes.byteLength, offset: data.offset };
      data.raw(tile.bytes);
      seen.set(key, placed);
    }
    entries.push({ length: placed.length, offset: placed.offset, runLength: 1, tileId: tile.id });
  }

  const metadata = new TextEncoder().encode(JSON.stringify(input.metadata));
  const { leaves, root } = packDirectories(entries);
  const rootOffset = PMTILES_HEADER_BYTES;
  const metadataOffset = rootOffset + root.byteLength;
  const leafDirsOffset = metadataOffset + metadata.byteLength;
  const tileDataOffset = leafDirsOffset + leaves.byteLength;
  const zooms = sorted.map((tile) => tile.z);

  const header = writeHeader({
    addressedTiles: sorted.length,
    bounds: input.bounds,
    contents: seen.size,
    entries: entries.length,
    header: {
      clustered: true,
      internalCompression: PmtilesCompression.NONE,
      leafDirsLength: leaves.byteLength,
      leafDirsOffset,
      maxZoom: zooms.length > 0 ? Math.max(...zooms) : 0,
      metadataLength: metadata.byteLength,
      metadataOffset,
      minZoom: zooms.length > 0 ? Math.min(...zooms) : 0,
      rootLength: root.byteLength,
      rootOffset,
      tileCompression: PmtilesCompression.NONE,
      tileDataLength: data.offset,
      tileDataOffset,
      tileType: input.tileType,
    },
  });

  const out = new Uint8Array(tileDataOffset + data.offset);
  out.set(header, 0);
  out.set(root, rootOffset);
  out.set(metadata, metadataOffset);
  out.set(leaves, leafDirsOffset);
  out.set(data.bytes(), tileDataOffset);

  return out;
}

/** Serialize one directory. */
export function encodePmtilesDirectory(entries: readonly PmtilesEntry[]): Uint8Array {
  const out = new ByteWriter(256 + entries.length * 8);
  writeVarint(out, entries.length);
  let last = 0;
  for (const entry of entries) {
    writeVarint(out, entry.tileId - last);
    last = entry.tileId;
  }
  for (const entry of entries) {
    writeVarint(out, entry.runLength);
  }
  for (const entry of entries) {
    writeVarint(out, entry.length);
  }
  for (const [index, entry] of entries.entries()) {
    const previous = index > 0 ? entries[index - 1] : null;
    const contiguous = previous !== null && entry.offset === previous.offset + previous.length;
    writeVarint(out, contiguous ? 0 : entry.offset + 1);
  }

  return new Uint8Array(out.bytes());
}

/**
 * The row covering `tileId`, or null.
 *
 * A run covers a span of ids with ONE payload, so "the largest row at or below the id" is the answer and a
 * plain equality search would miss every deduplicated tile.
 */
export function findPmtilesEntry(entries: readonly PmtilesEntry[], tileId: number): null | PmtilesEntry {
  let low = 0;
  let high = entries.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entries[middle].tileId <= tileId) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found < 0) {
    return null;
  }
  const entry = entries[found];
  if (entry.runLength === 0) {
    return entry; // a leaf pointer: the caller follows it
  }

  return tileId < entry.tileId + entry.runLength ? entry : null;
}

/** XYZ tile coordinates → the hilbert id PMTiles orders its directories by. */
export function pmtilesTileId(z: number, x: number, y: number): number {
  if (z < 0 || z > MAX_ZOOM || !Number.isInteger(z)) {
    throw new RangeError(`pmtiles: zoom ${z} outside 0..${MAX_ZOOM}`);
  }
  const side = 2 ** z;
  if (x < 0 || y < 0 || x >= side || y >= side || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new RangeError(`pmtiles: tile ${z}/${x}/${y} outside the pyramid`);
  }
  let rx = 0;
  let ry = 0;
  let index = 0;
  let px = x;
  let py = y;
  for (let span = side / 2; span >= 1; span /= 2) {
    rx = (px & span) > 0 ? 1 : 0;
    ry = (py & span) > 0 ? 1 : 0;
    index += span * span * ((3 * rx) ^ ry);
    // Rotate the quadrant so the curve stays continuous across it.
    if (ry === 0) {
      if (rx === 1) {
        px = span - 1 - px;
        py = span - 1 - py;
      }
      const swap = px;
      px = py;
      py = swap;
    }
  }

  return zoomBase(z) + index;
}

/** The inverse — every id in an archive answers which tile it is, which is what makes a listing possible. */
export function pmtilesTileXyz(id: number): { readonly x: number; readonly y: number; readonly z: number } {
  let z = 0;
  while (z <= MAX_ZOOM && id >= zoomBase(z + 1)) {
    z += 1;
  }
  let index = id - zoomBase(z);
  const side = 2 ** z;
  let x = 0;
  let y = 0;
  for (let span = 1; span < side; span *= 2) {
    const rx = 1 & (index / 2);
    const ry = 1 & (index ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = span - 1 - x;
        y = span - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
    x += span * rx;
    y += span * ry;
    index = Math.floor(index / 4);
  }

  return { x, y, z };
}

function contentKey(bytes: Uint8Array): string {
  // Length plus a checksum: the pair is what makes two different pictures colliding vanishingly unlikely,
  // and a collision here would serve one tile's pixels under another tile's name.
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `${bytes.byteLength}:${hash >>> 0}`;
}

/**
 * Split the entries into a root directory that fits the format's 16 KB first fetch, plus leaves when it does
 * not. A root that overflows is not an error in the spec — it is a file every reader fetches twice.
 */
function packDirectories(entries: readonly PmtilesEntry[]): { leaves: Uint8Array; root: Uint8Array } {
  const flat = encodePmtilesDirectory(entries);
  if (flat.byteLength <= PMTILES_ROOT_BYTES - PMTILES_HEADER_BYTES) {
    return { leaves: new Uint8Array(0), root: flat };
  }
  // Grow the leaf size until the root of leaf POINTERS fits. Doubling converges in a few passes and keeps
  // the leaves near the size the format's own tooling produces.
  for (let perLeaf = 512; perLeaf <= 1 << 20; perLeaf *= 2) {
    const leafBytes = new ByteWriter(1 << 16);
    const pointers: PmtilesEntry[] = [];
    for (let start = 0; start < entries.length; start += perLeaf) {
      const slice = entries.slice(start, start + perLeaf);
      const encoded = encodePmtilesDirectory(slice);
      pointers.push({ length: encoded.byteLength, offset: leafBytes.offset, runLength: 0, tileId: slice[0].tileId });
      leafBytes.raw(encoded);
    }
    const root = encodePmtilesDirectory(pointers);
    if (root.byteLength <= PMTILES_ROOT_BYTES - PMTILES_HEADER_BYTES) {
      return { leaves: new Uint8Array(leafBytes.bytes()), root };
    }
  }
  throw new Error('pmtiles: the pyramid does not fit a two-level directory');
}

function readVarint(bytes: Uint8Array, cursor: { at: number }): number {
  let value = 0;
  let shift = 1;
  for (;;) {
    if (cursor.at >= bytes.byteLength) {
      throw new RangeError('pmtiles: varint runs past the end of the directory');
    }
    const byte = bytes[cursor.at];
    cursor.at += 1;
    value += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) {
      return value;
    }
    shift *= 128;
    if (shift > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('pmtiles: varint wider than an exact double');
    }
  }
}

function writeHeader(input: {
  addressedTiles: number;
  bounds: PmtilesBounds;
  contents: number;
  entries: number;
  header: PmtilesHeader;
}): Uint8Array {
  const { bounds, header } = input;
  const out = new ByteWriter(PMTILES_HEADER_BYTES);
  out.raw(new TextEncoder().encode(PMTILES_MAGIC));
  out.u8(PMTILES_VERSION);
  for (const value of [
    header.rootOffset,
    header.rootLength,
    header.metadataOffset,
    header.metadataLength,
    header.leafDirsOffset,
    header.leafDirsLength,
    header.tileDataOffset,
    header.tileDataLength,
    input.addressedTiles,
    input.entries,
    input.contents,
  ]) {
    out.u64(value);
  }
  out.u8(header.clustered ? 1 : 0);
  out.u8(header.internalCompression);
  out.u8(header.tileCompression);
  out.u8(header.tileType);
  out.u8(header.minZoom);
  out.u8(header.maxZoom);
  out.i32(Math.round(bounds.minLon * 1e7));
  out.i32(Math.round(bounds.minLat * 1e7));
  out.i32(Math.round(bounds.maxLon * 1e7));
  out.i32(Math.round(bounds.maxLat * 1e7));
  out.u8(bounds.centerZoom);
  out.i32(Math.round(((bounds.minLon + bounds.maxLon) / 2) * 1e7));
  out.i32(Math.round(((bounds.minLat + bounds.maxLat) / 2) * 1e7));

  return new Uint8Array(out.bytes());
}

function writeVarint(out: ByteWriter, value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    out.u8((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.u8(rest);
}

/** Ids per zoom, summed: `(4^z − 1) / 3`. */
function zoomBase(z: number): number {
  return (4 ** z - 1) / 3;
}
