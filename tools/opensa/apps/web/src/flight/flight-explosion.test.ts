import { describe, expect, it } from 'vitest';

import type { FlightTrack } from './csv';

import { cockpitInstrumentState } from './cockpit-instrument-data';
import { parseFlightCsv, sampleTrack } from './csv';
import {
  EXPLOSION_REPLAY_SECONDS,
  ExplosionAnimationClock,
  explosionExportDuration,
  prepareExplosionReplay,
} from './flight-explosion';
import { buildTrackEndpoints } from './track-endpoints';

const fixture = [
  '# gtasa_flight_recorder,version=12,sample_hz=25',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  '2026-10-03T00:00:00.000,520,1000,0,0,40,0,10,0,0',
  '2026-10-03T00:00:01.000,520,800,10,0,40,1,10,0,0',
  '2026-10-03T00:00:02.000,520,0,20,0,40,2,8,1,0',
  '2026-10-03T00:00:03.000,520,0,40,5,35,3,7,1,-1',
  '2026-10-03T00:00:12.000,520,0,180,60,20,12,3,0,-1',
].join('\n');

describe('measured explosion replay ending', () => {
  it('removes drifting motion, preserves the source, and ends the recording at the explosion', () => {
    const source = parseFlightCsv(`${fixture}\n# event,2,explosion,20,0,40`, 'wreck.csv');
    const raw = structuredClone(source);
    const replay = prepareExplosionReplay(source);

    expect(source).toEqual(raw);
    expect(replay.duration).toBe(2);
    expect(explosionExportDuration(replay)).toBe(2 + EXPLOSION_REPLAY_SECONDS);
    expect(replay.explosionReplay).toEqual({ explosionSeconds: 2, recordedDuration: 12, removedSamples: 2 });
    expect(replay.rows.map((row) => row.s)).toEqual([0, 1, 2]);
    expect(sampleTrack(replay, 0.5)).toEqual(sampleTrack(source, 0.5));
    for (const seconds of [2, 2.1, 3.5, replay.duration, 100, 2.1]) {
      const pose = sampleTrack(replay, seconds);
      expect(pose.pos).toEqual([20, 0, 40]);
      expect(pose.orientation).toEqual(source.rows[2].orientation);
      expect(pose.velocity).toEqual([0, 0, 0]);
      expect(pose.row.health).toBe(0);
      expect(pose.row.smokeActive).toBe(false);
    }
    expect(buildTrackEndpoints([replay])[0].position).toEqual([20, 0, 40]);
    expect(cockpitInstrumentState(replay, sampleTrack(replay, replay.duration), replay.duration).healthDisplay).toBe(0);
    expect(prepareExplosionReplay(replay)).toBe(replay);
  });

  it('holds the latest actual node pose at an event between samples, never the later wreck pose', () => {
    const source = parseFlightCsv(`${fixture}\n# event,2.04,explosion,20,0,40`, 'between.csv');
    source.rows[2].nodes[0] = [0, 0, 0, 1];
    source.rows[3].nodes[0] = [0, 0, 1, 0];
    source.rows[3].orientation = [0, 1, 0, 0];
    const replay = prepareExplosionReplay(source);
    for (const seconds of [2.04, 3, replay.duration]) {
      expect(sampleTrack(replay, seconds).nodes[0]).toEqual([0, 0, 0, 1]);
      expect(sampleTrack(replay, seconds).orientation).toEqual(source.rows[2].orientation);
    }
  });

  it('plays a complete explosion even when its event was recorded just after the last sample', () => {
    const source = parseFlightCsv(`${fixture}\n# event,12.04,explosion,180,60,20`, 'short.csv');
    const replay = prepareExplosionReplay(source);
    expect(replay.duration).toBe(12.04);
    expect(replay.events[0].s).toBe(12.04);
    expect(sampleTrack(replay, 12.5).pos).toEqual([180, 60, 20]);
  });

  it('uses the first measured explosion and drops later wreck events', () => {
    const source = parseFlightCsv(
      `${fixture}\n# event,3,explosion,40,5,35\n# event,2,explosion,20,0,40\n# event,3.5,collision,inferred,5,40,5,35`,
      'multiple.csv',
    );
    const replay = prepareExplosionReplay(source);
    expect(replay.explosionReplay?.explosionSeconds).toBe(2);
    expect(replay.events).toEqual([{ kind: 'explosion', pos: [20, 0, 40], s: 2 }]);
  });

  it('does not guess explosions from damage, zero health, collision or a session-end reason', () => {
    const source = parseFlightCsv(
      `${fixture}\n# event,2,collision,inferred,20,20,0,40\n# session_end,player_left_vehicle_or_vehicle_destroyed`,
      'no-explosion.csv',
    );
    expect(prepareExplosionReplay(source)).toBe(source);
    expect(source.duration).toBe(12);
    expect(sampleTrack(source, 3).pos).toEqual([40, 5, 35]);
  });
});

describe('independent explosion animation clock', () => {
  const replay = (): FlightTrack =>
    prepareExplosionReplay(parseFlightCsv(`${fixture}\n# event,2,explosion,20,0,40`, 'wreck.csv'));

  it('advances while the progress bar stays at the end, then expires without looping', () => {
    const track = replay();
    const clock = new ExplosionAnimationClock();
    expect(clock.sample(track, 1, 500)).toEqual({ age: null, seconds: 1 });
    expect(clock.sample(track, 2, 1000)).toEqual({ age: 0, seconds: 2 });
    expect(clock.sample(track, 2, 1500)).toEqual({ age: 0.5, seconds: 2.5 });
    expect(clock.sample(track, 2, 7000)).toEqual({ age: 4, seconds: 6 });
    expect(clock.sample(track, 2, 10000)).toEqual({ age: 4, seconds: 6 });
    expect(track.duration).toBe(2);
  });

  it('clears on rewind, restarts on another arrival, and isolates track switches and explicit replay', () => {
    const a = replay(),
      b = replay();
    const clock = new ExplosionAnimationClock();
    clock.sample(a, 2, 1000);
    expect(clock.sample(a, 1, 2000).age).toBeNull();
    expect(clock.sample(a, 2, 3000).age).toBe(0);
    expect(clock.sample(b, 2, 4000).age).toBe(0);
    expect(clock.sample(b, 2, 4500).age).toBe(0.5);
    clock.reset();
    expect(clock.sample(b, 2, 5000).age).toBe(0);
  });

  it('leaves recordings with no measured explosion on the capture clock', () => {
    const track = parseFlightCsv(fixture, 'no-explosion.csv');
    const clock = new ExplosionAnimationClock();
    expect(clock.sample(track, 12, 10000)).toEqual({ age: null, seconds: 12 });
    expect(explosionExportDuration(track)).toBe(12);
  });
});
