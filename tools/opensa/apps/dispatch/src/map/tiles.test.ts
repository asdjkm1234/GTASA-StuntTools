import { describe, expect, it } from 'vitest';

import type { TileScheme } from './tiles';

import {
  DEFAULT_TILE_SIZE,
  SA_TILE_ORIGIN,
  SA_TILE_SPAN,
  tileAt,
  tileExtent,
  tileKey,
  tileResolution,
  tilesInBox,
  tileSpan,
  zoomForResolution,
} from './tiles';

const SA: TileScheme = {
  maxZoom: 6,
  minZoom: 0,
  origin: SA_TILE_ORIGIN,
  span: SA_TILE_SPAN,
  tileSize: DEFAULT_TILE_SIZE,
};

describe('tiles', () => {
  describe('negative cases', () => {
    it('clamps a point outside the square into the pyramid rather than addressing a tile that is not there', () => {
      expect(tileAt(SA, [-99_000, 99_000], 3)).toEqual({ x: 0, y: 0, z: 3 });
      expect(tileAt(SA, [99_000, -99_000], 3)).toEqual({ x: 7, y: 7, z: 3 });
    });

    it('answers the lowest zoom for a resolution that is not a number', () => {
      expect(zoomForResolution(SA, Number.NaN)).toBe(SA.minZoom);
      expect(zoomForResolution(SA, 0)).toBe(SA.minZoom);
    });

    it('never resolves past what the archive carries', () => {
      expect(zoomForResolution(SA, 0.0001)).toBe(SA.maxZoom);
      expect(zoomForResolution(SA, 1e9)).toBe(SA.minZoom);
    });

    it('caps how many tiles one view may ask for', () => {
      const all = tilesInBox(SA, { max: [3000, 3000], min: [-3000, -3000] }, 6, 12);

      expect(all).toHaveLength(12);
    });
  });

  describe('positive cases', () => {
    it('puts the whole world in one tile at zoom 0', () => {
      expect(tileSpan(SA, 0)).toBe(SA_TILE_SPAN);
      expect(tileExtent(SA, { x: 0, y: 0, z: 0 })).toEqual({ max: [3000, 3000], min: [-3000, -3000] });
    });

    it('counts y from the north edge down, the way every tile reader does', () => {
      // The north-west quarter is 1/0/0; the south-west quarter is 1/0/1.
      expect(tileExtent(SA, { x: 0, y: 0, z: 1 })).toEqual({ max: [0, 3000], min: [-3000, 0] });
      expect(tileExtent(SA, { x: 0, y: 1, z: 1 })).toEqual({ max: [0, 0], min: [-3000, -3000] });
      expect(tileAt(SA, [-1500, 1500], 1)).toEqual({ x: 0, y: 0, z: 1 });
      expect(tileAt(SA, [1500, -1500], 1)).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('halves the world unit per pixel with every level', () => {
      expect(tileResolution(SA, 0)).toBeCloseTo(6000 / 256);
      expect(tileResolution(SA, 4)).toBeCloseTo(6000 / 256 / 16);
    });

    it('picks the level whose texels are nearest the screen pixels', () => {
      expect(zoomForResolution(SA, tileResolution(SA, 3))).toBe(3);
      // A retina screen wants twice the texels for the same view.
      expect(zoomForResolution(SA, tileResolution(SA, 3), 2)).toBe(4);
    });

    it('asks for the tiles under the eye first', () => {
      const box = { max: [2000, 2000] as const, min: [-2000, -2000] as const };
      const tiles = tilesInBox(SA, box, 4);
      const centre = tileAt(SA, [0, 0], 4);

      expect(tileKey(tiles[0])).toBe(tileKey(centre));
      expect(tiles.length).toBeGreaterThan(4);
    });

    it('covers exactly the tiles a view touches', () => {
      const tiles = tilesInBox(SA, { max: [2999, 2999], min: [1, 1] }, 1);

      expect(tiles.map(tileKey).sort()).toEqual(['1/1/0']);
    });
  });
});
