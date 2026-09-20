import { describe, expect, it } from 'vitest';

import type { Incident, Operations, Unit } from '../ops/types';
import type { ScreenPoint, ScreenProjector } from './projection';

import { SymbologyLayer, warmTextMetrics } from './overlay-2d';

function board(units: number, incidents = 0): Operations {
  return {
    incidents: Array.from({ length: incidents }, (_, i) => call(i)),
    log: [],
    now: 0,
    units: Array.from({ length: units }, (_, i) => unit(i)),
  };
}

function call(index: number): Incident {
  return {
    assigned: [],
    at: [1000 + index, -1000],
    code: '10-50',
    id: `i${index}`,
    opened: 0,
    place: 'Ganton',
    priority: 2,
    remaining: 30,
    status: 'pending',
    title: 'Traffic collision',
  };
}

/** A 2D context that records what was asked of it — the layer's cost is calls, not pixels. */
function fakeContext(): { calls: { font: number; measure: number; text: string[] }; ctx: CanvasRenderingContext2D } {
  const calls = { font: 0, measure: 0, text: [] as string[] };
  const ctx = {
    arc: (): void => undefined,
    arcTo: (): void => undefined,
    beginPath: (): void => undefined,
    closePath: (): void => undefined,
    fill: (): void => undefined,
    fillStyle: '',
    fillText: (text: string): void => {
      calls.text.push(text);
    },
    lineTo: (): void => undefined,
    lineWidth: 0,
    measureText: (text: string): TextMetrics => {
      calls.measure += 1;

      return { width: text.length * 6 } as TextMetrics;
    },
    moveTo: (): void => undefined,
    rect: (): void => undefined,
    restore: (): void => undefined,
    rotate: (): void => undefined,
    save: (): void => undefined,
    stroke: (): void => undefined,
    strokeStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    translate: (): void => undefined,
  };
  Object.defineProperty(ctx, 'font', {
    get: (): string => '',
    set: (): void => {
      calls.font += 1;
    },
  });

  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** Everything lands at the same near point — the layer is being measured, not the camera. */
/** Every point on ONE pixel — the worst case for decluttering, and what most of these tests want. */
function fakeProjector(depth = 100): ScreenProjector {
  return { project: (): ScreenPoint => ({ depth, x: 200, y: 200 }) } as unknown as ScreenProjector;
}

/** Points spread along a grid, so labels have somewhere to go and the placement can be counted (3/03). */
function spreadProjector(depth = 100): ScreenProjector {
  let n = 0;
  const columns = 8;

  return {
    project: (): ScreenPoint => {
      const index = n++;

      return { depth, x: 60 + (index % columns) * 110, y: 40 + Math.floor(index / columns) * 60 };
    },
  } as unknown as ScreenProjector;
}

function unit(index: number): Unit {
  return {
    at: [1000 + index, -1000],
    callsign: `4-XRAY-${index}`,
    elevation: 13,
    heading: 0,
    id: `u${index}`,
    incident: null,
    kind: 'patrol',
    model: 'copcarls',
    status: 'available',
    target: null,
  };
}

const SIZE = { height: 800, width: 1200 };

describe('SymbologyLayer', () => {
  describe('negative cases', () => {
    it('does not re-measure a label it has already drawn — the per-symbol cost 5/02 was written for', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();
      const ops = board(150);

      layer.render(ctx, fakeProjector(), ops, null, SIZE);
      expect(calls.measure).toBe(150);
      expect(layer.counted().measures).toBe(150);

      const first = calls.measure;
      layer.render(ctx, fakeProjector(), ops, null, SIZE);
      layer.render(ctx, fakeProjector(), ops, null, SIZE);

      expect(calls.measure).toBe(first);
      expect(layer.counted().measures).toBe(0);
    });

    it('does not re-measure a stale unit every second — the changing age is measured apart', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();
      const ops = board(150);
      // Every unit stale, ages under a minute so the label's `12s` really does tick every frame. Putting
      // that age inside the measured label makes 150 NEW cache keys per frame, which blows the cap and
      // re-measures everything — 5/02's whole finding undone.
      for (let frame = 0; frame < 400; frame += 1) {
        const ages = new Map(ops.units.map((unit) => [unit.id, 10_000 + (frame % 40) * 1000]));
        layer.render(ctx, fakeProjector(), ops, null, SIZE, ages);
        if (frame === 380) {
          calls.measure = 0;
        }
      }

      expect(calls.measure).toBe(0);
    });

    it('sets the font a fixed number of times per frame, not once per chip', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(4), null, SIZE);
      const small = calls.font;
      layer.render(ctx, fakeProjector(), board(150), null, SIZE);

      expect(calls.font - small).toBe(small);
    });

    it('drops a chip past the depth cut and counts the drop', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(9000), board(10, 2), null, SIZE);

      expect(layer.counted().chips).toBe(0);
      expect(layer.counted().chipsDropped).toBe(12);
      expect(layer.counted().symbols).toBe(12);
    });
  });

  describe('positive cases', () => {
    it('draws every symbol and measures every label, whatever the decluttering then does with them', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(150, 40), null, SIZE);
      const counts = layer.counted();

      // An icon is the datum and is never dropped; a label is what competes (201/3-03).
      expect(counts.symbols).toBe(190);
      expect(counts.chips + counts.chipsDropped).toBe(190);
      expect(counts.measures).toBe(151);
    });

    it('places a label per symbol when they do not collide', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, spreadProjector(), board(24), null, { height: 900, width: 900 });

      expect(layer.counted()).toMatchObject({ chips: 24, chipsDropped: 0, symbols: 24 });
    });

    it('gives the pixels to the selection when everything stacks on one point', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(40), { id: 'u39', kind: 'unit' }, SIZE);

      // The selected unit's callsign is drawn even though 39 others wanted the same pixels.
      expect(calls.text).toContain('4-XRAY-39');
    });

    it('keeps only what fits when every symbol lands on one pixel, and counts the rest as dropped', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(150, 40), null, SIZE);
      const counts = layer.counted();

      // Four anchors around one point is all the room there is — the rest lose and say so.
      expect(counts.chips).toBeLessThanOrEqual(4);
      expect(counts.chipsDropped).toBe(190 - counts.chips);
    });

    it('marks a unit whose fix has aged past one publish interval, and says how old', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();
      const ops = board(3);
      // PCAD publishes every 4 s: 2 s is not late, 90 s is.
      const ages = new Map([
        ['u0', 2000],
        ['u1', 90_000],
        ['u2', 400_000],
      ]);

      layer.render(ctx, fakeProjector(), ops, null, SIZE, ages);

      expect(layer.counted().stale).toBe(2);
      // The age rides on the chip, so a callsign an operator cannot trust says so in the same glance.
      expect(calls.text).toContain('4-XRAY-1 · 1m');
      expect(calls.text).toContain('4-XRAY-2 · 6m');
      expect(calls.text).toContain('4-XRAY-0');
      expect(calls.text).not.toContain('4-XRAY-0 · ');
    });

    it('treats a unit with no recorded fix as fresh rather than as ancient', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(4), null, SIZE, new Map());

      expect(layer.counted().stale).toBe(0);
    });

    it('hit-tests the pixels it last drew', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(1), null, SIZE);

      expect(layer.hitTest(200, 200)).toEqual({ id: 'u0', kind: 'unit' });
      expect(layer.hitTest(2, 2)).toBeNull();
    });

    it('resolves both fonts before a frame is ever timed', () => {
      // The phone's first drawn frame cost 1654.9 ms with 1528.1 of it inside this layer, drawing twelve
      // things over nothing — the family stack is resolved on the first `ctx.font`, and this moves that walk
      // out of the loop. Measuring is what forces it; assigning the shorthand alone can be lazy.
      const { calls, ctx } = fakeContext();

      warmTextMetrics(ctx);

      expect(calls.measure).toBe(2);
    });
  });
});
