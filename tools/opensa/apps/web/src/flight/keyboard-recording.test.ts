import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { cockpitInstrumentState } from './cockpit-instrument-data';
import { parseFlightCsv, sampleTrack } from './csv';

function fixture(version = 11): string {
  const header =
    'local_timestamp,model,x,y,z,capture_elapsed_s,key_q,key_w,key_e,key_a,key_s,key_d,key_up,key_down,key_left,key_right,keyboard_state_valid';
  const rows = [
    '1,1,0,0,0,0,1,0,1,0,1',
    '0,0,1,1,1,0,0,1,0,1,1',
    '0,0,0,0,0,0,0,0,0,0,1',
    '0,1,0,0,1,0,0,0,0,0,1',
    '0,-1,0,0,-1,0,0,0,-1,-1,0',
  ];

  return (
    `# gtasa_flight_recorder,version=${version}\n${header}\n` +
    rows.map((keys, i) => `2026-09-30T00:00:00.000,520,0,0,100,${i * 0.04},${keys}`).join('\n')
  );
}
describe('v11 default keyboard recording', () => {
  it('retains ten independent keys and three throttle levels at discrete sampled times', () => {
    const t = parseFlightCsv(fixture(), 'keys.csv');
    expect(t.rows[0]).toMatchObject({
      keyA: 0,
      keyboardStateValid: true,
      keyD: 0,
      keyDown: 0,
      keyE: 0,
      keyLeft: 1,
      keyQ: 1,
      keyRight: 0,
      keyS: 0,
      keyUp: 1,
      keyW: 1,
    });
    const get = (s: number): ReturnType<typeof cockpitInstrumentState> =>
      cockpitInstrumentState(t, sampleTrack(t, s), s);
    expect(get(0.02)).toMatchObject({ throttle: 1, throttleInferred: true, throttleSource: 'keys' });
    expect(get(0.04)).toMatchObject({ throttle: 0, throttleSource: 'keys' });
    expect(get(0.08).throttle).toBe(0.5);
    expect(get(0.12).throttle).toBe(0.5);
    expect(get(0.16)).toMatchObject({ throttle: null, throttleSource: 'unknown' });
    expect(t.rows[4]).toMatchObject({
      keyboardStateValid: false,
      keyLeft: null,
      keyRight: null,
      keyS: null,
      keyW: null,
    });
    expect(get(0).throttle).toBe(1);
  });
  it('keeps unrecorded legacy keys unknown and rejects corrupt keyboard states', () => {
    const old = parseFlightCsv(fixture(10), 'old.csv');
    expect(old.rows[0]).toMatchObject({ keyboardStateValid: false, keyS: null, keyW: null });
    const bad = parseFlightCsv(fixture().replace('1,1,0,0,0,0,1,0,1,0,1', '1,2,0,0,0,0,1,0,1,0,1'), 'bad.csv');
    expect(bad.rows[0].keyboardStateValid).toBe(false);
    expect(cockpitInstrumentState(bad, sampleTrack(bad, 0)).throttle).toBeNull();
  });
  const emitted = new URL('../../../../captures/recorder-v11-damage-keys.csv', import.meta.url);
  it.skipIf(!existsSync(emitted))('consumes the real C++ writer output without shifting damage columns', () => {
    const t = parseFlightCsv(readFileSync(emitted, 'utf8'), 'emitted.csv');
    expect(t.version).toBe(11);
    expect(t.rows[0].keyW).toBe(1);
    expect(t.rows[1].keyS).toBe(1);
    expect(t.rows[0].keyLeft).toBe(1);
    expect(t.rows[1].keyRight).toBe(1);
    expect(t.rows[0].surfaceDamage.states).toEqual([1, 2, 3, 0, 1]);
    expect(cockpitInstrumentState(t, sampleTrack(t, 0)).throttle).toBe(1);
    expect(cockpitInstrumentState(t, sampleTrack(t, 0.04)).throttle).toBe(0);
    expect(cockpitInstrumentState(t, sampleTrack(t, 0.08)).throttle).toBeNull();
  });
});
