import { describe, expect, it } from 'vitest';

import type { MapPose } from '../map/map-camera';
import type { Operations } from '../ops/types';
import type { FrameSignals } from './render-gate';

import { RenderGate } from './render-gate';

const BOARD: Operations = { incidents: [], log: [], now: 0, units: [] };

function pose(overrides: Partial<MapPose> = {}): MapPose {
  return { at: [1500, -1700], height: 700, pitch: -1.1, projection: 'perspective', yaw: Math.PI, ...overrides };
}

function signals(overrides: Partial<FrameSignals> = {}): FrameSignals {
  return {
    canvas: 1920 * 1080,
    created: 4,
    evicted: 0,
    hour: 10,
    ops: BOARD,
    pending: 0,
    pose: pose(),
    selection: null,
    sketch: 0,
    ...overrides,
  };
}

describe('RenderGate', () => {
  describe('negative cases', () => {
    it('does not draw a second frame when nothing moved', () => {
      const gate = new RenderGate();

      expect(gate.shouldDraw(signals())).toBe(true);
      expect(gate.shouldDraw(signals())).toBe(false);
      expect(gate.shouldDraw(signals())).toBe(false);
      expect(gate.idleFrames).toBe(2);
    });

    it('does not need the same OBJECT — equal values are an equal picture', () => {
      const gate = new RenderGate();
      gate.shouldDraw(signals({ pose: pose() }));

      expect(gate.shouldDraw(signals({ pose: pose() }))).toBe(false);
    });

    it('does not miss a change that arrived while it was skipping — the signal is a value, not an event', () => {
      const gate = new RenderGate();
      gate.shouldDraw(signals());
      gate.shouldDraw(signals());
      gate.shouldDraw(signals());

      // The board ticked at some point during those skipped frames; the next look still sees it.
      expect(gate.shouldDraw(signals({ ops: { ...BOARD } }))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('always draws the first frame', () => {
      expect(new RenderGate().shouldDraw(signals())).toBe(true);
    });

    it('draws when the view moves, in any of its degrees of freedom', () => {
      for (const moved of [
        pose({ at: [1501, -1700] }),
        pose({ height: 701 }),
        pose({ pitch: -1.2 }),
        pose({ yaw: 3 }),
        pose({ projection: 'ortho' }),
      ]) {
        const gate = new RenderGate();
        gate.shouldDraw(signals());

        expect(gate.shouldDraw(signals({ pose: moved }))).toBe(true);
      }
    });

    it('draws when the board ticks, the selection changes or the hour turns', () => {
      for (const change of [
        { ops: { ...BOARD } },
        { selection: { id: 'u1', kind: 'unit' as const } },
        { hour: 11 },
        { sketch: 1 },
        { canvas: 800 * 600 },
      ]) {
        const gate = new RenderGate();
        gate.shouldDraw(signals());

        expect(gate.shouldDraw(signals(change))).toBe(true);
      }
    });

    it('keeps drawing while the world is still arriving', () => {
      const gate = new RenderGate();
      gate.shouldDraw(signals({ pending: 3 }));

      expect(gate.shouldDraw(signals({ pending: 2 }))).toBe(true);
      expect(gate.shouldDraw(signals({ created: 5, pending: 2 }))).toBe(true);
      expect(gate.shouldDraw(signals({ created: 5, evicted: 1, pending: 2 }))).toBe(true);
    });

    it('draws the next frame when woken, whatever the signals say', () => {
      const gate = new RenderGate();
      gate.shouldDraw(signals());

      expect(gate.shouldDraw(signals())).toBe(false);

      gate.wake();

      expect(gate.shouldDraw(signals())).toBe(true);
      expect(gate.shouldDraw(signals())).toBe(false);
    });
  });
});
