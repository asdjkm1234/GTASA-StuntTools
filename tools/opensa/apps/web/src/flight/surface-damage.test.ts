import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseFlightCsv, sampleTrack } from './csv';

const header =
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,surface_damage_valid,surface_damage_source,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage';
function fixture(model = 520, version = 10, damage = '31,game_memory,80128,1,2,3,0,1'): string {
  return (
    `# gtasa_flight_recorder,version=${version},sample_hz=25\n${header}\n` +
    `2026-01-01T00:00:00.000,${model},1000,0,0,20,0,${damage}\n` +
    `2026-01-01T00:00:00.040,${model},1000,1,0,20,0.04,31,game_memory,34304,2,1,0,2,0\n` +
    `2026-01-01T00:00:00.080,${model},1000,2,0,20,0.08,0,unknown,-1,-1,-1,-1,-1,-1\n`
  );
}

describe('measured v10 aircraft surface damage', () => {
  it.each([520, 476])('reads five independent slots for model %i without health or node evidence', (model) => {
    const track = parseFlightCsv(fixture(model), 'damage.csv');
    expect(track.rows[0].nodeStatus).toBe(0);
    expect(track.rows[0].surfaceDamage).toEqual({
      raw: 80128,
      source: 'game_memory',
      states: [1, 2, 3, 0, 1],
      validMask: 31,
    });
    expect(track.rows[1].surfaceDamage.states).toEqual([2, 1, 0, 2, 0]);
    expect(track.rows[2].surfaceDamage).toEqual({
      raw: null,
      source: 'unknown',
      states: Array(5).fill(null),
      validMask: 0,
    });
  });

  it('steps damage at recorded times and does not interpolate or carry a state across unknown', () => {
    const track = parseFlightCsv(fixture(), 'damage.csv');
    expect(sampleTrack(track, 0.02).row.surfaceDamage.states).toEqual([1, 2, 3, 0, 1]);
    expect(sampleTrack(track, 0.04).row.surfaceDamage.states).toEqual([2, 1, 0, 2, 0]);
    expect(sampleTrack(track, 0.08).row.surfaceDamage.states).toEqual(Array(5).fill(null));
    expect(sampleTrack(track, 0).row.surfaceDamage.states).toEqual([1, 2, 3, 0, 1]);
  });

  it.each([4, 5, 6, 7, 8, 9])('keeps v%i damage unknown even with stray new columns', (version) => {
    expect(parseFlightCsv(fixture(520, version), 'old.csv').rows[0].surfaceDamage.source).toBe('unknown');
  });

  it.each([
    '31,inferred,80128,1,2,3,0,1',
    '0,game_memory,80128,1,2,3,0,1',
    '32,game_memory,80128,1,2,3,0,1',
    '31,game_memory,-1,1,2,3,0,1',
    '31,game_memory,4294967296,1,2,3,0,1',
  ])('rejects invalid source, mask or packed data: %s', (damage) => {
    expect(parseFlightCsv(fixture(520, 10, damage), 'bad.csv').rows[0].surfaceDamage.source).toBe('unknown');
  });

  it('invalidates only inconsistent slots and honors the validity mask', () => {
    const damage = parseFlightCsv(fixture(520, 10, '15,game_memory,80128,0,2,3,0,1'), 'partial.csv').rows[0]
      .surfaceDamage;
    expect(damage.validMask).toBe(14);
    expect(damage.states).toEqual([null, 2, 3, 0, null]);
  });

  it('does not interpret automobile panel slots as aircraft damage', () => {
    expect(parseFlightCsv(fixture(400), 'car.csv').rows[0].surfaceDamage.source).toBe('unknown');
  });

  const recorderFixture = new URL('../../../../captures/recorder-v11-damage-keys.csv', import.meta.url);
  it.skipIf(!existsSync(recorderFixture))('reads the C++ recorder writer fixture with matching columns', () => {
    const track = parseFlightCsv(readFileSync(recorderFixture, 'utf8'), 'recorder-v11-damage-keys.csv');
    expect(track.version).toBe(11);
    expect(track.rows[0].surfaceDamage.states).toEqual([1, 2, 3, 0, 1]);
    expect(track.rows[1].surfaceDamage.states).toEqual([2, 1, 0, 2, 0]);
    expect(track.rows[2].surfaceDamage.source).toBe('unknown');
  });
});
