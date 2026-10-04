import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { cockpitInstrumentState, speedFromTrack } from './cockpit-instrument-data';
import { ATLAS_SIZE, buildCockpitInstrumentMesh, dashboardPoint } from './cockpit-instrument-mesh';
import { type FlightTrack, parseFlightCsv, sampleTrack } from './csv';
import { orientationFromGta, quatMultiply } from './math';

function track(): FlightTrack {
  return parseFlightCsv(
    '# gtasa_flight_recorder,version=10\nlocal_timestamp,model,x,y,z,capture_elapsed_s,brake,throttle,gear_status,health\n2026-09-30T00:00:00.000,520,0,0,100,0,0,0,0,1000\n2026-09-30T00:00:01.000,520,10,0,100,1,0.5,0,0,500\n2026-09-30T00:00:02.000,520,20,0,100,2,1,0,0,250',
    'fixture.csv',
  );
}
const root = orientationFromGta([1, 0, 0], [0, 0, 1], [0, 1, 0]);
function levelTrack(): FlightTrack {
  const t = track(),
    row = t.rows[0];
  t.version = 11;
  t.rows = [0, 0.5, 0.6, 0.8, 1, 1.4, 1.6, 2].map((s) => ({
    ...row,
    health: s < 0.5 ? 1000 : s < 1 ? 200 : 700,
    keyboardStateValid: s !== 1.4,
    keyS: s === 0.5 ? 1 : 0,
    keyW: s < 1.4 ? (s === 0.5 ? 0 : 1) : 0,
    s,
  }));
  t.duration = 2;

  return t;
}
function motionTrack(position: (s: number) => number, hz = 25): FlightTrack {
  const t = track(),
    row = t.rows[0];
  t.rows = Array.from({ length: hz * 6 + 1 }, (_, i) => ({ ...row, pos: [position(i / hz), 0, 100], s: i / hz }));
  t.duration = 6;

  return t;
}
describe('cockpit data and layout', () => {
  it('converts positional motion to game km/h, independently of raw GTA velocity', () => {
    const t = track(),
      pose = sampleTrack(t, 0.5);
    pose.row.velocity = [999, 999, 999];
    const s = cockpitInstrumentState(t, pose, 0.5);
    expect(s.speedKmh).toBeCloseTo(36);
    expect(s.altitude).toBe(100);
    expect(s.health).toBeCloseTo(0.75);
    expect(s.s).toBe(0.5);
    expect(s.heading).toBeCloseTo(0);
    expect(s.pitch).toBeCloseTo(0);
    expect(s.roll).toBeCloseTo(0);
  });
  it('damps 268-272 km/h sampling jitter without snapping the speed to a preset maximum', () => {
    const t = motionTrack((s) => 75 * s + 0.024 * Math.sin(10 * Math.PI * s));
    const values = t.rows.filter((r) => r.s >= 2 && r.s < 5).map((r) => speedFromTrack(t, r.s) * 3.6);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.2);
    expect(values.reduce((sum, v) => sum + v, 0) / values.length).toBeCloseTo(270, 1);
    for (const kmh of [36, 272, 350]) {
      const steady = motionTrack((s) => (kmh / 3.6) * s);
      expect(speedFromTrack(steady, 0) * 3.6).toBeCloseTo(kmh);
      expect(speedFromTrack(steady, 5) * 3.6).toBeCloseTo(kmh);
    }
  });
  it('responds to acceleration and stopping, with identical results after seeking or pausing', () => {
    const t = motionTrack((s) => 20 * Math.min(s, 2) + 75 * Math.max(0, Math.min(s - 2, 2)));
    const read = (s: number): number => cockpitInstrumentState(t, sampleTrack(t, s), s).speedKmh;
    const early = read(2.1);
    expect(early).toBeGreaterThan(72);
    expect(early).toBeLessThan(150);
    expect(read(3.2)).toBeGreaterThan(260);
    expect(read(5.2)).toBeLessThan(15);
    expect(read(0)).toBeCloseTo(72);
    expect(read(2.1)).toBe(early);
    expect(read(2.1)).toBe(early);
  });
  it('uses capture time rather than the number of rendering or recording frames', () => {
    const position = (s: number): number => 30 * s + 4 * s * s;
    const results = [10, 25, 50].map((hz) => speedFromTrack(motionTrack(position, hz), 3.6) * 3.6);
    expect(Math.max(...results) - Math.min(...results)).toBeLessThan(1.5);
    const irregular = track();
    irregular.rows = [0, 0.04, 0.09, 0.17, 0.6, 1.1, 2.3].map((s) => ({
      ...irregular.rows[0],
      pos: [75 * s, 0, 100],
      s,
    }));
    expect(speedFromTrack(irregular, 1.8) * 3.6).toBeCloseTo(270);
  });
  it('preserves world altitude above the dial range and below zero', () => {
    const t = track(),
      p = sampleTrack(t, 1);
    for (const z of [-15, 800, 1000, 1250]) {
      p.pos[2] = z;
      expect(cockpitInstrumentState(t, p, 1).altitude).toBe(z);
    }
  });
  it('animates damage and repair causally, while keeping actual health separate', () => {
    const read = (s: number): ReturnType<typeof cockpitInstrumentState> =>
        cockpitInstrumentState(t, sampleTrack(t, s), s),
      t = levelTrack();
    expect(read(0.49).healthDisplay).toBe(1);
    expect(read(0.5)).toMatchObject({ health: 0.2, healthDisplay: 1 });
    expect(read(0.6).healthDisplay).toBeGreaterThan(0.2);
    expect(read(0.6).healthDisplay).toBeLessThan(1);
    expect(read(0.9).healthDisplay).toBeCloseTo(0.2);
    expect(read(1).healthDisplay).toBeCloseTo(0.2);
    expect(read(1.2).healthDisplay).toBeGreaterThan(0.2);
    expect(read(1.2).healthDisplay).toBeLessThan(0.7);
    expect(read(1.4).healthDisplay).toBeCloseTo(0.7);
    const midway = read(0.65);
    read(1.5);
    expect(read(0.65)).toEqual(midway);
    expect(read(0.65)).toEqual(midway);
  });
  it('retargets throttle during a transition without jumping and reaches exact endpoints', () => {
    const read = (s: number): ReturnType<typeof cockpitInstrumentState> =>
        cockpitInstrumentState(t, sampleTrack(t, s), s),
      t = levelTrack();
    expect(read(0.5)).toMatchObject({ throttle: 0, throttleDisplay: 1 });
    const at = read(0.6);
    expect(at.throttle).toBe(1);
    expect(at.throttleDisplay).toBeGreaterThan(0);
    expect(at.throttleDisplay).toBeLessThan(1);
    expect(at.throttleDisplay).toBeCloseTo(read(0.6 - 1e-8).throttleDisplay!, 6);
    expect(read(0.7).throttleDisplay).toBeGreaterThan(at.throttleDisplay!);
    expect(read(0.9).throttleDisplay).toBe(1);
    expect(read(0.6).throttleDisplay).toBe(at.throttleDisplay);
  });
  it('clears unknown throttle immediately and does not interpolate across loss of focus', () => {
    const read = (s: number): ReturnType<typeof cockpitInstrumentState> =>
        cockpitInstrumentState(t, sampleTrack(t, s), s),
      t = levelTrack();
    expect(read(1.399).throttleDisplay).toBe(1);
    expect(read(1.4)).toMatchObject({ throttle: null, throttleDisplay: null });
    expect(read(1.5).throttleDisplay).toBeNull();
    expect(read(1.6)).toMatchObject({ throttle: 0.5, throttleDisplay: 0.5 });
  });
  it('measures nose-up pitch and right-wing-down bank, including inverted flight', () => {
    const t = track(),
      p = sampleTrack(t, 0);
    p.orientation = quatMultiply(root, [Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)]);
    expect(cockpitInstrumentState(t, p).pitch).toBeCloseTo(30);
    p.orientation = quatMultiply(root, [0, Math.sin(Math.PI / 6), 0, Math.cos(Math.PI / 6)]);
    expect(cockpitInstrumentState(t, p).roll).toBeCloseTo(60);
    p.orientation = quatMultiply(root, [0, 1, 0, 0]);
    expect(Math.abs(cockpitInstrumentState(t, p).roll)).toBeCloseTo(180);
    p.orientation = orientationFromGta([0, -1, 0], [0, 0, 1], [1, 0, 0]);
    expect(cockpitInstrumentState(t, p).heading).toBeCloseTo(90);
  });
  it('marks inferred throttle and treats negative landing gear travel as transit', () => {
    const t = track(),
      p = sampleTrack(t, 1);
    p.row.gear = -0.6;
    expect(cockpitInstrumentState(t, p)).toMatchObject({ gear: 'MOVING', throttle: 0.5, throttleInferred: true });
    p.row.gear = -1;
    expect(cockpitInstrumentState(t, p).gear).toBe('UP');
    const recorded = track();
    recorded.rows[1].throttle = 0.7;
    expect(cockpitInstrumentState(recorded, sampleTrack(recorded, 1))).toMatchObject({
      throttle: 0.7,
      throttleInferred: false,
    });
  });
  it('keeps glass transparent and faces strictly in front of the measured panel', () => {
    const mesh = buildCockpitInstrumentMesh(new Uint8Array(ATLAS_SIZE ** 2 * 4));
    expect(mesh.submeshes.map((s) => s.translucent)).toEqual([false, true]);
    const vertices = new Float32Array(mesh.positions.buffer);
    for (let i = 0; i < vertices.length - 12; i += 3) {
      expect(Math.abs(vertices[i])).toBeLessThanOrEqual(0.34);
      expect(vertices[i + 2]).toBeLessThan(0.54);
    }
    const indices = new Uint16Array(mesh.indices.buffer);
    expect(Math.max(...indices)).toBeLessThan(mesh.vertexCount);
    const a = dashboardPoint(0, 0.2, 0),
      b = dashboardPoint(0, 0.2, 0.015);
    expect(b[1]).toBeLessThan(a[1]);
    expect(b[2]).toBeGreaterThan(a[2]);
    expect(() => dashboardPoint(0.35, 0.2)).toThrow('exceeds');
  });
  const live = new URL(
    '../../../../../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv',
    import.meta.url,
  );
  it.skipIf(!existsSync(live))('drives the right aileron lamp from the new real recording and resets on rewind', () => {
    const t = parseFlightCsv(readFileSync(live, 'utf8'), 'actual-v10.csv');
    const read = (s: number): ReturnType<typeof cockpitInstrumentState> =>
      cockpitInstrumentState(t, sampleTrack(t, s), s);
    expect(read(116.9).damage).toEqual([0, 0, 0, 0, 0]);
    expect(read(117.1).damage).toEqual([0, 0, 0, 0, 1]);
    expect(read(117.1).health).toBeLessThan(0.9);
    expect(read(116.9).damage).toEqual([0, 0, 0, 0, 0]);
  });
});
