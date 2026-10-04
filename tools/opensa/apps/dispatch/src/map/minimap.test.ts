import { describe, expect, it } from 'vitest';

import type { Operations, Selection, Unit } from '../ops/types';
import type { MapPose } from './map-camera';
import type { MinimapFrame, MinimapWorld } from './minimap';

import { MinimapLayer } from './minimap';

const WORLD: MinimapWorld = { boxes: [{ max: [1500, 500], min: [-1500, -500] }], centre: [0, 0], radius: 3000 };

/** A 2D context that records the shapes asked of it — the radar's cost is calls, not pixels. */
function fakeContext(): {
  calls: { arcs: number; clips: number; fills: number; strokes: number };
  ctx: CanvasRenderingContext2D;
} {
  const calls = { arcs: 0, clips: 0, fills: 0, strokes: 0 };
  const ctx = {
    arc: (): void => {
      calls.arcs += 1;
    },
    beginPath: (): void => undefined,
    clearRect: (): void => undefined,
    clip: (): void => {
      calls.clips += 1;
    },
    closePath: (): void => undefined,
    fill: (): void => {
      calls.fills += 1;
    },
    fillStyle: '',
    lineTo: (): void => undefined,
    lineWidth: 0,
    moveTo: (): void => undefined,
    rect: (): void => undefined,
    restore: (): void => undefined,
    save: (): void => undefined,
    stroke: (): void => {
      calls.strokes += 1;
    },
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;

  return { calls, ctx };
}

function frame(overrides: Partial<MinimapFrame> = {}): MinimapFrame {
  return {
    footprint: [
      [-200, -200],
      [200, -200],
      [200, 200],
      [-200, 200],
    ],
    ops: operations([unit('u1', [600, 300])]),
    pose: pose(),
    selection: null,
    size: 120,
    world: WORLD,
    ...overrides,
  };
}

function operations(units: readonly Unit[]): Operations {
  return { incidents: [], log: [], now: 0, units };
}

function pose(at: [number, number] = [0, 0]): MapPose {
  return { at, height: 400, pitch: -1, projection: 'perspective', yaw: Math.PI };
}

function unit(id: string, at: [number, number]): Unit {
  return {
    at,
    callsign: id,
    elevation: 13,
    heading: 0,
    id,
    incident: null,
    kind: 'patrol',
    model: 'copcarls',
    status: 'available',
    target: null,
  };
}

describe('MinimapLayer', () => {
  describe('negative cases', () => {
    it('answers no world point before it has ever drawn', () => {
      expect(new MinimapLayer().hitTest(60, 60)).toBeNull();
    });

    it('answers no world point for a click outside the dial — the corners are not the map', () => {
      const layer = new MinimapLayer();
      layer.render(fakeContext().ctx, frame());

      expect(layer.hitTest(4, 4)).toBeNull();
    });

    it('does not repaint when nothing it draws has moved', () => {
      const layer = new MinimapLayer();
      const same = frame();

      expect(layer.render(fakeContext().ctx, same)).toBe(true);
      expect(layer.render(fakeContext().ctx, same)).toBe(false);
      expect(layer.render(fakeContext().ctx, { ...same })).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('repaints when the board ticks, when the view moves, and when the selection changes', () => {
      const layer = new MinimapLayer();
      const first = frame();
      layer.render(fakeContext().ctx, first);

      expect(layer.render(fakeContext().ctx, { ...first, ops: operations(first.ops.units) })).toBe(true);
      const moved = { ...first, ops: first.ops, pose: pose([100, 0]) };
      layer.render(fakeContext().ctx, moved);

      expect(layer.render(fakeContext().ctx, { ...moved, selection: selected('u1') })).toBe(true);
    });

    it('puts the world centre at the dial centre and north at the top', () => {
      const layer = new MinimapLayer();
      layer.render(fakeContext().ctx, frame());

      expect(layer.hitTest(60, 60)).toEqual([0, 0]);
      // 51 px up from the centre is the dial's top edge (radius 51 at size 120) — the far north of the world.
      const north = layer.hitTest(60, 9);

      expect(north?.[1]).toBeCloseTo(3000, 6);
    });

    it('scales to the world the pak carries, not to a fixed number of units', () => {
      const layer = new MinimapLayer();
      layer.render(fakeContext().ctx, frame({ world: { ...WORLD, radius: 6000 } }));
      const half = layer.hitTest(60, 60 - 25.5);

      // Half the dial's radius on a 6000-unit world is 3000 units, where the same pixel was 1500 before.
      expect(half?.[1]).toBeCloseTo(3000, 6);
    });

    it('clips everything it draws to the circle', () => {
      const { calls, ctx } = fakeContext();
      new MinimapLayer().render(ctx, frame());

      expect(calls.clips).toBe(1);
    });

    it('draws the dial, the units and the ring', () => {
      const { calls, ctx } = fakeContext();
      new MinimapLayer().render(ctx, frame({ ops: operations([unit('a', [0, 0]), unit('b', [100, 100])]) }));

      // Two unit dots plus the dial and the ring — the arcs are what a count can hold onto.
      expect(calls.arcs).toBe(4);
      expect(calls.fills).toBeGreaterThanOrEqual(3);
      expect(calls.strokes).toBeGreaterThanOrEqual(2);
    });
  });
});

function selected(id: string): Selection {
  return { id, kind: 'unit' };
}
