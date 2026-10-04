import { describe, expect, it } from 'vitest';

import type { Quat } from './math';

import { cockpitInstrumentState } from './cockpit-instrument-data';
import { parseFlightCsv, sampleTrack } from './csv';
import { pedalPresses, surfaceFeedback } from './surface-feedback';
import { showSurfaceFeedback } from './surface-feedback-hud';

const identity: Quat = [0, 0, 0, 1];
const x = (a: number): Quat => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const z = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const binds = Array.from({ length: 5 }, () => identity);

describe('measured body-local controls', () => {
  it('presses only the indicated pedal and keeps unavailable feedback unknown', () => {
    expect(pedalPresses(-0.5)).toEqual({ left: 0.5, right: 0 });
    expect(pedalPresses(0.75)).toEqual({ left: 0, right: 0.75 });
    expect(pedalPresses(0)).toEqual({ left: 0, right: 0 });
    expect(pedalPresses(null)).toEqual({ left: null, right: null });
    expect(pedalPresses(NaN)).toEqual({ left: null, right: null });
    expect(pedalPresses(4)).toEqual({ left: 0, right: 1 });
  });
  it('maps pull/right/right pedal consistently and ignores common aileron travel', () => {
    const f = surfaceFeedback([z(0.4), x(-0.3), x(-0.3), x(0.4), x(-0.4)], binds);
    expect(f.pitch.value).toBeGreaterThan(0);
    expect(f.roll.value).toBeGreaterThan(0);
    expect(f.yaw.value).toBeGreaterThan(0);
    expect(surfaceFeedback([identity, identity, identity, x(0.4), x(0.4)], binds).roll.value).toBe(0);
    expect(surfaceFeedback([identity, x(0.001), x(0.001)], binds).pitch.value).toBe(0);
  });
  it('uses readable surviving nodes, excludes detached/raw-other nodes, and warns for damage', () => {
    const nodes = [z(0.4), x(0.3), x(-0.2), x(0.4), x(-0.4)];
    const f = surfaceFeedback(nodes, binds, [2, 2, 1, 3, 0]);
    expect(f.yaw).toMatchObject({ source: 'unknown', value: null });
    expect(f.pitch.source).toBe('partial');
    expect(f.pitch.angle).toBeCloseTo(0.2);
    expect(f.roll.source).toBe('partial');
    expect(f.roll.angle).toBeCloseTo(0.4);
    expect(f.damaged).toBe(true);
    expect(f.damageUnknown).toBe(false);
    expect(surfaceFeedback([], binds).pitch.value).toBeNull();
    expect(surfaceFeedback([[0, 0, 0, 0]], binds).yaw.value).toBeNull();
  });
  it('shows feedback only in chase modes', () => {
    for (const mode of ['chase-near', 'chase-mid', 'chase-far']) expect(showSurfaceFeedback(mode)).toBe(true);
    for (const mode of ['first-person', 'cockpit', 'cockpit-look', 'free'])
      expect(showSurfaceFeedback(mode)).toBe(false);
  });
  it('does not fill an unreadable sample with the next recorded node', () => {
    const csv =
      '# gtasa_flight_recorder,version=12\nlocal_timestamp,model,x,y,z,capture_elapsed_s,node_status,rudder_qx,rudder_qy,rudder_qz,rudder_qw\n' +
      '2026-10-01,520,0,0,100,0,0,nan,nan,nan,nan\n2026-10-01,520,0,0,100,1,1,0,0,0,1\n';
    const t = parseFlightCsv(csv, 'gap.csv');
    expect(sampleTrack(t, 0).nodes[0]).toBeNull();
    expect(sampleTrack(t, 0.5).nodes[0]).toBeNull();
    expect(sampleTrack(t, 1).nodes[0]).toEqual(identity);
  });
  it('accepts v12 W/S alone, rejects conflict/focus/corruption, and needs no removed keys', () => {
    const header =
      '# gtasa_flight_recorder,version=12\nlocal_timestamp,model,x,y,z,capture_elapsed_s,key_w,key_s,keyboard_state_valid\n';
    const t = parseFlightCsv(
      header +
        [
          [0, 0, 1],
          [1, 0, 1],
          [0, 1, 1],
          [1, 1, 1],
          [-1, -1, 0],
          [2, 0, 1],
        ]
          .map((keys, i) => `2026-10-01,520,0,0,100,${i},${keys.join(',')}`)
          .join('\n'),
      'v12.csv',
    );
    expect(t.rows[0].keyboardStateValid).toBe(true);
    expect(t.rows[0].keyLeft).toBeNull();
    expect(t.rows.map((r, i) => cockpitInstrumentState(t, sampleTrack(t, i)).throttle)).toEqual([
      0.5,
      1,
      0,
      null,
      null,
      null,
    ]);
  });
});
