import { describe, expect, it, vi } from 'vitest';

import type { EnginePoint } from './coords';
import type { ScreenProjector } from './projection';
import type { TileSource } from './tile-source';
import type { TileScheme } from './tiles';

import { drawTileLayer } from './tile-layer';
import { DEFAULT_TILE_SIZE, SA_TILE_ORIGIN, SA_TILE_SPAN, tileKey } from './tiles';

const SCHEME: TileScheme = {
  maxZoom: 5,
  minZoom: 0,
  origin: SA_TILE_ORIGIN,
  span: SA_TILE_SPAN,
  tileSize: DEFAULT_TILE_SIZE,
};

const SIZE = { height: 600, width: 800 };

interface Painted {
  readonly transform: readonly number[];
}

function fakeContext(): { calls: Painted[]; ctx: CanvasRenderingContext2D } {
  const calls: Painted[] = [];
  let transform: readonly number[] = [1, 0, 0, 1, 0, 0];
  const ctx = {
    drawImage: (): void => {
      calls.push({ transform });
    },
    restore: (): void => undefined,
    save: (): void => undefined,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number): void => {
      transform = [a, b, c, d, e, f];
    },
  } as unknown as CanvasRenderingContext2D;

  return { calls, ctx };
}

/** A top-down orthographic projector: `scale` CSS pixels per world unit, north up, centred on the origin. */
function projector(scale: number): ScreenProjector {
  return {
    project: (world: EnginePoint) => ({
      depth: 100,
      x: world[0] * scale + SIZE.width / 2,
      y: world[2] * scale + SIZE.height / 2,
    }),
  } as unknown as ScreenProjector;
}

/** A source that has every tile already, and remembers what was asked of it. */
function source(
  held: (tile: string) => boolean = () => true,
  scheme: TileScheme = SCHEME,
): { asked: string[]; source: TileSource } {
  const asked: string[] = [];

  return {
    asked,
    source: {
      absentCount: 0,
      get: (tile: { x: number; y: number; z: number }) => {
        asked.push(tileKey(tile));

        return held(tileKey(tile)) ? ({} as CanvasImageSource) : null;
      },
      meta: { built: 'now', scheme, world: 'original' },
      pendingCount: 3,
    } as unknown as TileSource,
  };
}

/** A square view, 2000 world units across, centred on the origin. */
const FOOTPRINT = [
  [-1000, -1000],
  [1000, -1000],
  [1000, 1000],
  [-1000, 1000],
] as const;

describe('tile layer', () => {
  describe('negative cases', () => {
    it('draws nothing under perspective, and says why', () => {
      const { calls, ctx } = fakeContext();
      const status = drawTileLayer({
        context: ctx,
        dpr: 1,
        footprint: FOOTPRINT,
        projection: 'perspective',
        projector: projector(0.4),
        source: source().source,
        wake: vi.fn(),
      });

      expect(calls).toHaveLength(0);
      expect(status.reason).toMatch(/plan view/);
      expect(status.zoom).toBe(-1);
    });

    it('draws nothing when the view has no ground under it', () => {
      const status = drawTileLayer({
        context: fakeContext().ctx,
        dpr: 1,
        footprint: [],
        projection: 'ortho',
        projector: projector(0.4),
        source: source().source,
        wake: vi.fn(),
      });

      expect(status.reason).toMatch(/not over the ground/);
    });

    it('reports the tiles still in flight rather than an empty map', () => {
      const status = drawTileLayer({
        context: fakeContext().ctx,
        dpr: 1,
        footprint: FOOTPRINT,
        projection: 'ortho',
        projector: projector(0.4),
        source: source(() => false).source,
        wake: vi.fn(),
      });

      expect(status.drawn).toBe(0);
      expect(status.pending).toBe(3);
      expect(status.reason).toBe('no tile here yet');
    });
  });

  describe('positive cases', () => {
    it('paints the tiles the view covers, at the level its pixels ask for', () => {
      const { calls, ctx } = fakeContext();
      const held = source();
      const status = drawTileLayer({
        context: ctx,
        dpr: 1,
        footprint: FOOTPRINT,
        projection: 'ortho',
        projector: projector(0.4),
        source: held.source,
        wake: vi.fn(),
      });

      // 2000 world units over 800 px is 2.5 world/px; zoom 3 gives 6000/8/256 = 2.93, zoom 4 gives 1.46.
      expect(status.zoom).toBe(3);
      expect(status.drawn).toBe(calls.length);
      expect(held.asked.length).toBeGreaterThan(0);
      expect(held.asked.every((key) => key.startsWith('3/'))).toBe(true);
    });

    it('places a tile by the transform between its own projected corners', () => {
      const { calls, ctx } = fakeContext();
      drawTileLayer({
        context: ctx,
        dpr: 2,
        footprint: [
          [-3000, -3000],
          [3000, -3000],
          [3000, 3000],
          [-3000, 3000],
        ],
        projection: 'ortho',
        projector: projector(800 / 6000),
        source: source(() => true, { ...SCHEME, maxZoom: 0 }).source,
        wake: vi.fn(),
      });

      // Zoom 0: one tile covering the whole square. Its north-west corner is world (-3000, 3000), which the
      // projector puts at x = -3000·(800/6000) + 400 = 0, y = -3000·(800/6000) + 300 = -100 — and the layer
      // multiplies by the device pixel ratio.
      const [first] = calls;
      expect(first.transform[4]).toBeCloseTo(0);
      expect(first.transform[5]).toBeCloseTo(-200);
      // 6000 world units across 256 tile pixels, at 800/6000 px per unit, doubled for dpr.
      expect(first.transform[0]).toBeCloseTo((2 * 800) / 256);
      expect(first.transform[1]).toBeCloseTo(0);
      expect(first.transform[2]).toBeCloseTo(0);
      expect(first.transform[3]).toBeCloseTo((2 * 800) / 256);
    });

    it('leaves the context on the caller’s own device-pixel transform', () => {
      const { ctx } = fakeContext();
      let last: readonly number[] = [];
      ctx.setTransform = ((a: number, b: number, c: number, d: number, e: number, f: number): void => {
        last = [a, b, c, d, e, f];
      }) as CanvasRenderingContext2D['setTransform'];
      drawTileLayer({
        context: ctx,
        dpr: 2,
        footprint: FOOTPRINT,
        projection: 'ortho',
        projector: projector(0.4),
        source: source().source,
        wake: vi.fn(),
      });

      expect(last).toEqual([2, 0, 0, 2, 0, 0]);
    });
  });
});
