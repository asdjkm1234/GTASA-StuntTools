import { describe, expect, it } from 'vitest';

import {
  decodePmtilesDirectory,
  decodePmtilesHeader,
  encodePmtiles,
  encodePmtilesDirectory,
  findPmtilesEntry,
  PMTILES_HEADER_BYTES,
  PMTILES_ROOT_BYTES,
  type PmtilesInputTile,
  pmtilesTileId,
  PmtilesTileType,
  pmtilesTileXyz,
} from './pmtiles';

const BOUNDS = { centerZoom: 3, maxLat: 85, maxLon: 180, minLat: -85, minLon: -180 };

function archive(tiles: readonly PmtilesInputTile[]): Uint8Array {
  return encodePmtiles({ bounds: BOUNDS, metadata: { world: 'test' }, tiles, tileType: PmtilesTileType.PNG });
}

/** Read one tile back out of a finished archive, the way the console's range reader does. */
function readTile(bytes: Uint8Array, z: number, x: number, y: number): null | string {
  const header = decodePmtilesHeader(bytes);
  const id = pmtilesTileId(z, x, y);
  let entry = findPmtilesEntry(
    decodePmtilesDirectory(bytes.subarray(header.rootOffset, header.rootOffset + header.rootLength)),
    id,
  );
  if (entry?.runLength === 0) {
    const at = header.leafDirsOffset + entry.offset;
    entry = findPmtilesEntry(decodePmtilesDirectory(bytes.subarray(at, at + entry.length)), id);
  }
  if (entry === null || entry.runLength === 0) {
    return null;
  }
  const at = header.tileDataOffset + entry.offset;

  return new TextDecoder().decode(bytes.subarray(at, at + entry.length));
}

/** A tile whose bytes are its own name, so a mis-addressed read is visible rather than plausible. */
function tile(z: number, x: number, y: number, fill = `${z}/${x}/${y}`): PmtilesInputTile {
  return { bytes: new TextEncoder().encode(fill), x, y, z };
}

describe('pmtiles', () => {
  describe('negative cases', () => {
    it('rejects a tile outside its own zoom', () => {
      expect(() => pmtilesTileId(2, 4, 0)).toThrow(/outside the pyramid/);
    });

    it('rejects a zoom past the exact-double ceiling', () => {
      expect(() => pmtilesTileId(27, 0, 0)).toThrow(/outside 0\.\.26/);
    });

    it('rejects two tiles with the same address', () => {
      expect(() => archive([tile(1, 0, 0), tile(1, 0, 0, 'again')])).toThrow(/duplicate tile 1\/0\/0/);
    });

    it('rejects bytes that are not an archive', () => {
      expect(() => decodePmtilesHeader(new Uint8Array(PMTILES_HEADER_BYTES))).toThrow(/not a PMTiles archive/);
    });

    it('rejects a version this reader does not know', () => {
      const bytes = archive([tile(0, 0, 0)]);
      bytes[7] = 4;

      expect(() => decodePmtilesHeader(bytes)).toThrow(/version 4 is not v3/);
    });

    it('REFUSES a gzipped directory by name rather than parsing garbage', () => {
      // Silent by nature: a deflate stream is a valid varint stream, so a reader with no inflater would
      // return entries that decode, address real offsets, and serve the wrong bytes.
      const bytes = archive([tile(0, 0, 0)]);
      bytes[97] = 2; // internal compression = gzip

      expect(() => decodePmtilesHeader(bytes)).toThrow(/directory compression 2 is not supported/);
    });

    it('answers null for a tile the archive does not carry', () => {
      expect(readTile(archive([tile(3, 1, 1)]), 3, 2, 2)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('round-trips every tile of a small pyramid', () => {
      const tiles = [tile(0, 0, 0), tile(1, 0, 0), tile(1, 1, 0), tile(1, 0, 1), tile(1, 1, 1), tile(2, 3, 2)];
      const bytes = archive(tiles);

      for (const one of tiles) {
        expect(readTile(bytes, one.z, one.x, one.y)).toBe(`${one.z}/${one.x}/${one.y}`);
      }
    });

    it('states its own extent in the header', () => {
      const header = decodePmtilesHeader(archive([tile(2, 0, 0), tile(5, 3, 4)]));

      expect(header.minZoom).toBe(2);
      expect(header.maxZoom).toBe(5);
      expect(header.tileType).toBe(PmtilesTileType.PNG);
      expect(header.rootOffset).toBe(PMTILES_HEADER_BYTES);
    });

    it('carries the metadata JSON verbatim', () => {
      const bytes = archive([tile(0, 0, 0)]);
      const header = decodePmtilesHeader(bytes);
      const json = new TextDecoder().decode(
        bytes.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength),
      );

      expect(JSON.parse(json)).toEqual({ world: 'test' });
    });

    it('stores identical tiles once — a bake of the sea is one blue square', () => {
      const sea = new Uint8Array(4096).fill(7);
      const tiles = Array.from({ length: 64 }, (_, index) => ({ bytes: sea, x: index % 8, y: index >> 3, z: 3 }));
      const bytes = archive(tiles);
      const header = decodePmtilesHeader(bytes);

      expect(header.tileDataLength).toBe(sea.byteLength);
      expect(readTile(bytes, 3, 5, 5)).toBe(new TextDecoder().decode(sea));
    });

    it('follows leaf directories when the root outgrows the first fetch', () => {
      // z=7 is 16384 tiles: far past what a 16 KB root holds, which is the case a one-level reader gets
      // wrong on a real city rather than in a test.
      const tiles: PmtilesInputTile[] = [];
      for (let x = 0; x < 128; x += 1) {
        for (let y = 0; y < 128; y += 1) {
          tiles.push(tile(7, x, y));
        }
      }
      const bytes = archive(tiles);
      const header = decodePmtilesHeader(bytes);

      expect(header.leafDirsLength).toBeGreaterThan(0);
      expect(header.rootLength).toBeLessThanOrEqual(PMTILES_ROOT_BYTES - PMTILES_HEADER_BYTES);
      expect(readTile(bytes, 7, 0, 0)).toBe('7/0/0');
      expect(readTile(bytes, 7, 63, 99)).toBe('7/63/99');
      expect(readTile(bytes, 7, 127, 127)).toBe('7/127/127');
    });

    it('orders ids on the hilbert curve, and every id says which tile it is', () => {
      expect(pmtilesTileId(0, 0, 0)).toBe(0);
      expect(pmtilesTileId(1, 0, 0)).toBe(1);
      expect(pmtilesTileId(1, 0, 1)).toBe(2);
      expect(pmtilesTileId(1, 1, 1)).toBe(3);
      expect(pmtilesTileId(1, 1, 0)).toBe(4);
      for (const z of [0, 1, 4, 9]) {
        const side = 2 ** z;
        for (const [x, y] of [
          [0, 0],
          [side - 1, 0],
          [side >> 1, side - 1],
        ]) {
          expect(pmtilesTileXyz(pmtilesTileId(z, x, y))).toEqual({ x, y, z });
        }
      }
    });

    it('writes a contiguous run of offsets as the zero the format reserves for it', () => {
      const entries = [
        { length: 10, offset: 0, runLength: 1, tileId: 5 },
        { length: 20, offset: 10, runLength: 1, tileId: 6 },
        { length: 30, offset: 900, runLength: 1, tileId: 7 },
      ];
      const decoded = decodePmtilesDirectory(encodePmtilesDirectory(entries));

      expect(decoded).toEqual(entries);
    });
  });
});
