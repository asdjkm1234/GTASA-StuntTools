import { decodePmtilesHeader, PmtilesTileType } from '@opensa/engine-formats';
import { describe, expect, it, vi } from 'vitest';

import type { TileScheme } from '../map/tiles';
import type { BakedTile } from './tile-bake';

import { DEFAULT_TILE_SIZE, SA_TILE_ORIGIN, SA_TILE_SPAN } from '../map/tiles';
import { BAKE_TILE_CAP, bakeTiles, describeBake, planTiles } from './tile-bake';
import { bakeCamera, bakeScheme } from './tile-bake-host';

const SCHEME: TileScheme = {
  maxZoom: 2,
  minZoom: 0,
  origin: SA_TILE_ORIGIN,
  span: SA_TILE_SPAN,
  tileSize: DEFAULT_TILE_SIZE,
};

/** A renderer whose "picture" is the square it was handed, so a test can read which ground was drawn. */
function renderer(
  mime = 'image/webp',
): (extent: { max: readonly number[]; min: readonly number[] }) => Promise<BakedTile> {
  return (extent) =>
    Promise.resolve({
      bytes: new TextEncoder().encode(`${extent.min[0]},${extent.min[1]}→${extent.max[0]},${extent.max[1]}`),
      mime,
    });
}

describe('tile bake', () => {
  describe('negative cases', () => {
    it('refuses a run that cannot finish, naming the count', async () => {
      await expect(
        bakeTiles({ maxZoom: 8, minZoom: 0, scheme: SCHEME, world: 'original' }, renderer()),
      ).rejects.toThrow(new RegExp(`past the ${BAKE_TILE_CAP}`));
    });

    it('declares PNG when the browser could not encode WebP', async () => {
      // Silent by nature: `toBlob` falls back with no error, and an archive that declared WebP would serve
      // pictures no reader can open.
      const { archive } = await bakeTiles(
        { maxZoom: 0, minZoom: 0, scheme: SCHEME, world: 'original' },
        renderer('image/png'),
      );

      expect(decodePmtilesHeader(archive).tileType).toBe(PmtilesTileType.PNG);
    });
  });

  describe('positive cases', () => {
    it('plans every tile of every level, shallowest first', () => {
      const plan = planTiles(SCHEME, 0, 2);

      expect(plan).toHaveLength(1 + 4 + 16);
      expect(plan[0]).toEqual({ x: 0, y: 0, z: 0 });
      expect(plan[plan.length - 1]).toEqual({ x: 3, y: 3, z: 2 });
    });

    it('renders every planned tile and reports what each level cost', async () => {
      const progress = vi.fn();
      const { archive, report } = await bakeTiles(
        { maxZoom: 1, minZoom: 0, scheme: SCHEME, world: 'original' },
        renderer(),
        progress,
      );

      expect(report.tiles).toBe(5);
      expect(report.byZoom.map((level) => level.zoom)).toEqual([0, 1]);
      expect(report.byZoom[1].tiles).toBe(4);
      expect(report.archiveBytes).toBe(archive.byteLength);
      expect(progress).toHaveBeenCalledTimes(5);
      expect(decodePmtilesHeader(archive).tileType).toBe(PmtilesTileType.WEBP);
      expect(describeBake(report)).toMatch(/5 tiles in/);
    });

    it('counts the tiles whose pixels the archive stored only once', async () => {
      const { report } = await bakeTiles({ maxZoom: 1, minZoom: 1, scheme: SCHEME, world: 'original' }, () =>
        Promise.resolve({ bytes: new Uint8Array(64).fill(3), mime: 'image/webp' }),
      );

      expect(report.tiles).toBe(4);
      expect(report.shared).toBe(3);
    });

    it('frames a tile exactly, straight down, with north at the top', () => {
      const camera = bakeCamera({ max: [1000, 2000], min: [0, 1000] });

      expect(camera.target).toEqual([500, 0, -1500]);
      expect(camera.eye[0]).toBe(500);
      expect(camera.eye[2]).toBe(-1500);
      expect(camera.eye[1]).toBeGreaterThan(0);
      expect(camera.orthoHalfHeight).toBe(500);
      expect(camera.aspect).toBe(1);
      expect(camera.up).toEqual([0, 0, -1]);
      // The front plane sits AHEAD of the ground, or a tower taller than the eye would be sliced off.
      expect(camera.near).toBeLessThan(0);
    });

    it('takes the pyramid square from the pak’s own extent', () => {
      const scheme = bakeScheme({ centre: [100, -200], radius: 1500 }, { maxZoom: 3, minZoom: 1, tileSize: 512 });

      expect(scheme).toEqual({ maxZoom: 3, minZoom: 1, origin: [-1400, -1700], span: 3000, tileSize: 512 });
    });
  });
});
