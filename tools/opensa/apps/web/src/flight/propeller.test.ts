import { describe, expect, it } from 'vitest';

import type { FlightTrack } from './csv';

import { visualPropellerMotion } from './propeller';

const track = (health = [1000, 1000, 0, 0, 1000, 1000]): FlightTrack =>
  ({ model: 476, rows: health.map((value, s) => ({ health: value, s })) }) as FlightTrack;

describe('Rustler display propeller', () => {
  it('uses capture time with deterministic pause and reverse seeking', () => {
    const recording = track();
    const initial = visualPropellerMotion(recording, 0.3);
    expect(initial?.source).toBe('inferred');
    expect(initial?.spinning).toBe(true);
    expect(visualPropellerMotion(recording, 0.4)?.phase).not.toBe(initial?.phase);
    visualPropellerMotion(recording, 4.6);
    expect(visualPropellerMotion(recording, 0.3)).toEqual(initial);
    expect(visualPropellerMotion(recording, 0.3)).toEqual(initial);
  });

  it('freezes the phase when destroyed and resumes without a discontinuity', () => {
    const recording = track();
    const stopped = visualPropellerMotion(recording, 2);
    expect(stopped?.spinning).toBe(false);
    expect(visualPropellerMotion(recording, 3.99)).toEqual(stopped);
    expect(visualPropellerMotion(recording, 4)?.phase).toBe(stopped?.phase);
    expect(visualPropellerMotion(recording, 4.1)?.phase).not.toBe(stopped?.phase);
    expect(visualPropellerMotion(recording, 1.999)?.phase).toBeCloseTo(stopped!.phase - 0.037);
  });

  it('keeps tracks independent, clamps endpoints and excludes other models', () => {
    const alive = track();
    const dead = track([0, 0, 0]);
    expect(visualPropellerMotion(dead, 1.5)).toMatchObject({ phase: 0, spinning: false });
    expect(visualPropellerMotion(alive, -1)).toEqual(visualPropellerMotion(alive, 0));
    expect(visualPropellerMotion(alive, 90)).toEqual(visualPropellerMotion(alive, 5));
    expect(visualPropellerMotion({ ...alive, model: 520 }, 1)).toBeNull();
    expect(visualPropellerMotion({ ...alive, rows: [] }, 1)).toBeNull();
    expect(visualPropellerMotion(alive, NaN)).toBeNull();
  });
});
