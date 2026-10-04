import { encodePmtiles, PmtilesTileType } from '@opensa/engine-formats';
import { describe, expect, it, vi } from 'vitest';

import type { TileScheme } from './tiles';

import { httpRange, type RangeFetch, type TileDecode, TileSource } from './tile-source';
import { DEFAULT_TILE_SIZE, SA_TILE_ORIGIN, SA_TILE_SPAN } from './tiles';

const SCHEME: TileScheme = {
  maxZoom: 2,
  minZoom: 0,
  origin: SA_TILE_ORIGIN,
  span: SA_TILE_SPAN,
  tileSize: DEFAULT_TILE_SIZE,
};

/** The tile's own address as its bytes, so a mis-addressed read is readable rather than plausible. */
function archive(
  metadata: Record<string, unknown> = { built: '2026-08-23', scheme: SCHEME, world: 'original' },
): Uint8Array {
  const tiles = [
    { bytes: new TextEncoder().encode('0/0/0'), x: 0, y: 0, z: 0 },
    { bytes: new TextEncoder().encode('1/0/0'), x: 0, y: 0, z: 1 },
    { bytes: new TextEncoder().encode('1/1/1'), x: 1, y: 1, z: 1 },
  ];

  return encodePmtiles({
    bounds: { centerZoom: 1, maxLat: 85, maxLon: 180, minLat: -85, minLon: -180 },
    metadata,
    tiles,
    tileType: PmtilesTileType.PNG,
  });
}

/** Range reads straight out of a buffer, counting requests — the network is what this file is careful about. */
function ranges(bytes: Uint8Array): { calls: number[]; range: RangeFetch } {
  const calls: number[] = [];

  return {
    calls,
    range: (offset, length): Promise<Uint8Array> => {
      calls.push(offset);

      return Promise.resolve(bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)));
    },
  };
}

/** "Decoding" a tile hands back its own text, so a test can assert WHICH tile was drawn. */
const decode: TileDecode = (bytes) =>
  Promise.resolve({ text: new TextDecoder().decode(bytes) } as unknown as CanvasImageSource);

function textOf(image: CanvasImageSource | null): string {
  return (image as unknown as null | { text: string })?.text ?? '';
}

describe('tile source', () => {
  describe('negative cases', () => {
    it('refuses an archive that does not say which world square it was baked over', async () => {
      const { range } = ranges(archive({ world: 'original' }));

      await expect(TileSource.open(range, decode)).rejects.toThrow(/carries no world square/);
    });

    it('answers null for a tile the archive does not carry, and asks only once', async () => {
      const { calls, range } = ranges(archive());
      const source = await TileSource.open(range, decode);
      const wake = vi.fn();

      expect(source.get({ x: 1, y: 0, z: 1 }, wake)).toBeNull();
      await vi.waitFor(() => expect(wake).toHaveBeenCalled());
      const after = calls.length;

      expect(source.get({ x: 1, y: 0, z: 1 }, wake)).toBeNull();
      expect(calls).toHaveLength(after);
      expect(source.absentCount).toBe(1);
    });

    it('slices the body itself when the server ignores Range', async () => {
      // Silent by nature: a 200 hands back the WHOLE archive, and a reader that trusts it decodes the
      // header as a picture.
      const bytes = archive();
      const onWhole = vi.fn();
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
          ok: true,
          status: 200,
        } as Response),
      );
      const source = await TileSource.open(httpRange('/tiles.pmtiles', onWhole), decode);
      const wake = vi.fn();
      source.get({ x: 0, y: 0, z: 0 }, wake);
      await vi.waitFor(() => expect(wake).toHaveBeenCalled());

      expect(onWhole).toHaveBeenCalledWith(bytes.byteLength);
      expect(textOf(source.get({ x: 0, y: 0, z: 0 }, wake))).toBe('0/0/0');
      // One request for the whole file, and nothing after it.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('reports a server that refuses the request rather than drawing an empty map', async () => {
      globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 } as Response));

      await expect(TileSource.open(httpRange('/tiles.pmtiles'), decode)).rejects.toThrow(/answered 404/);
    });
  });

  describe('positive cases', () => {
    it('opens header, root directory and metadata in ONE request', async () => {
      const { calls, range } = ranges(archive());
      const source = await TileSource.open(range, decode);

      expect(calls).toEqual([0]);
      expect(source.meta.world).toBe('original');
      expect(source.meta.scheme.span).toBe(SA_TILE_SPAN);
    });

    it('serves a tile the second time from memory', async () => {
      const { calls, range } = ranges(archive());
      const source = await TileSource.open(range, decode);
      const wake = vi.fn();

      expect(source.get({ x: 1, y: 1, z: 1 }, wake)).toBeNull();
      await vi.waitFor(() => expect(wake).toHaveBeenCalled());
      const after = calls.length;

      expect(textOf(source.get({ x: 1, y: 1, z: 1 }, wake))).toBe('1/1/1');
      expect(calls).toHaveLength(after);
    });

    it('drops every decoded tile when the mode is left', async () => {
      const { range } = ranges(archive());
      const source = await TileSource.open(range, decode);
      const wake = vi.fn();
      source.get({ x: 0, y: 0, z: 0 }, wake);
      await vi.waitFor(() => expect(wake).toHaveBeenCalled());
      source.dispose();

      expect(source.get({ x: 0, y: 0, z: 0 }, vi.fn())).toBeNull();
    });
  });
});
