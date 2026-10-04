import { describe, expect, it } from 'vitest';

import type { FlightTrack } from './csv';

import { parseFlightCsv, sampleTrack } from './csv';
import { gtaToEngine, quatFromColumns, quatMultiply } from './math';
import { cropShotAudio } from './shot-audio';
import {
  captureExteriorShot,
  type ExteriorShotView,
  followAt,
  recommendShots,
  segmentInspectTime,
  segmentShot,
  shotCameraState,
  shotHeading,
  shotRecordingId,
  validShotForTrack,
  validShotRange,
  validShotView,
} from './shot-camera';
import { saveShotSegment } from './shot-segment-editor';

function fixture(): FlightTrack {
  const track = parseFlightCsv(
    [
      '# synthetic,shot_camera_tests',
      '# gtasa_flight_recorder,version=12',
      'local_timestamp,model,health,x,y,z,capture_elapsed_s',
      ...[0, 1, 2, 3].map((s) => `2026-10-04T00:00:0${s}.000,520,1000,${100 + s * 10},${200 + s * 20},100,${s}`),
    ].join('\n'),
    'test.csv',
  );
  const base = quatFromColumns([1, 0, 0], [0, 0, -1], [0, 1, 0]);
  track.rows.forEach((row, i) => {
    row.orientation = quatMultiply(base, [0, Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)]);
  });

  return track;
}

describe('shot cameras and original capture time', () => {
  it('uses capture-time world segments for fixed/tracking with continuous positions and shortest yaw', () => {
    const track = fixture();
    for (const kind of ['fixed', 'tracking'] as const) {
      const view: ExteriorShotView = {
        fovYDeg: 60,
        kind,
        pitch: 0,
        position: [0, 50, 0],
        segments: [
          {
            end: 1,
            fovYDeg: 60,
            pitch: 0,
            position: [10, 50, 30],
            start: 0,
            transition: 0,
            yaw: (170 * Math.PI) / 180,
          },
          {
            end: 3,
            fovYDeg: 80,
            pitch: 0.2,
            position: [110, 150, 130],
            start: 1,
            transition: 1,
            yaw: (-170 * Math.PI) / 180,
          },
        ],
        yaw: 0,
      };
      expect(validShotForTrack(view, 3)).toBe(true);
      expect(shotCameraState(view, track, 1, 16 / 9)!.eye).toEqual([10, 50, 30]);
      const mid = shotCameraState(view, track, 1.5, 16 / 9)!;
      expect(mid.eye).toEqual([60, 100, 80]);
      expect(mid.fovYRad).toBeCloseTo((70 * Math.PI) / 180);
      if (kind === 'fixed') {
        expect(mid.target[0]).toBeCloseTo(mid.eye[0]);
        expect(mid.target[2]).toBeGreaterThan(mid.eye[2]);
      } else expect(mid.target).toEqual(gtaToEngine(...sampleTrack(track, 1.5).pos));
      expect(shotCameraState(view, track, 2, 16 / 9)!.eye).toEqual([110, 150, 130]);
      shotCameraState(view, track, 3, 16 / 9);
      shotCameraState(view, track, 0, 16 / 9);
      expect(shotCameraState(view, track, 1.5, 16 / 9)).toEqual(mid);
      expect(shotCameraState(segmentShot(view, 1), track, 1.25, 16 / 9)!.eye).toEqual([110, 150, 130]);
      const bad = structuredClone(view);
      bad.segments![1].start = 0.9;
      expect(validShotView(bad)).toBe(false);
      bad.segments![1].start = 1;
      if (bad.kind !== 'follow') bad.segments![1].position[0] = Infinity;
      expect(validShotView(bad)).toBe(false);
      expect(validShotForTrack(view, 2)).toBe(false);
    }
  });
  it('saves only the placed exterior segment and chooses a time after its transition inside its own span', () => {
    const track = fixture(),
      views = recommendShots(track, { end: 3, start: 0 });
    for (const kind of ['fixed', 'tracking', 'follow'] as const) {
      const view = views[kind] as ExteriorShotView;
      if (view.kind === 'follow')
        view.segments = [
          { end: 1, fovYDeg: 60, heading: 'aircraft', offset: [10, 20, 5], start: 0, transition: 0 },
          { end: 3, fovYDeg: 60, heading: 'aircraft', offset: [10, 20, 5], start: 1, transition: 1 },
        ];
      else
        view.segments = [
          { end: 1, fovYDeg: 60, pitch: 0, position: [10, 20, 30], start: 0, transition: 0, yaw: 0 },
          { end: 3, fovYDeg: 60, pitch: 0, position: [10, 20, 30], start: 1, transition: 1, yaw: 0 },
        ];
      const first = structuredClone(view.segments[0]);
      const camera = shotCameraState(view, track, 2.5, 16 / 9)!;
      camera.eye[0] += 25;
      const captured = captureExteriorShot(kind, camera, track, 2.5) as ExteriorShotView;
      saveShotSegment(view, captured, track, 2.5);
      expect(view.segments[0]).toEqual(first);
      expect(shotCameraState(view, track, 2.5, 16 / 9)!.eye[0]).toBeCloseTo(camera.eye[0]);
      expect(validShotView(JSON.parse(JSON.stringify(view)))).toBe(true);
    }
    const time = segmentInspectTime({ end: 1.2, start: 1, transition: 0.2 });
    expect(time).toBeGreaterThan(1.19);
    expect(time).toBeLessThan(1.2);
    expect(validShotView({ ...views.cockpit, segments: [{}] })).toBe(false);
  });
  it('blends segments on the shortest arc without crossing the aircraft and repeats on seek', () => {
    const track = fixture();
    const view = recommendShots(track, { end: 3, start: 0 }).follow;
    if (view.kind !== 'follow') throw new Error('follow fixture');
    const offset = (degrees: number): [number, number, number] => [
      Math.sin((degrees * Math.PI) / 180) * 30,
      Math.cos((degrees * Math.PI) / 180) * 30,
      8,
    ];
    view.segments = [
      { end: 1, fovYDeg: 60, heading: 'world', offset: offset(170), start: 0, transition: 0 },
      { end: 3, fovYDeg: 80, heading: 'world', offset: offset(-170), start: 1, transition: 1 },
    ];
    expect(validShotForTrack(view, 3)).toBe(true);
    const middle = followAt(view, track, 1.5);
    expect(middle.angle).toBeCloseTo(Math.PI);
    expect(middle.distance).toBeCloseTo(30);
    expect(middle.fovYDeg).toBe(70);
    expect(shotCameraState(segmentShot(view, 1), track, 2.5, 16 / 9)).toEqual(
      shotCameraState(view, track, 2.5, 16 / 9),
    );
    const expected = shotCameraState(view, track, 1.5, 16 / 9);
    shotCameraState(view, track, 2.9, 16 / 9);
    shotCameraState(view, track, 0, 16 / 9);
    expect(shotCameraState(view, track, 1.5, 16 / 9)).toEqual(expected);
    expect(followAt(view, track, 2).angle).toBeCloseTo(followAt(view, track, 3).angle);
    const malformed = structuredClone(view);
    malformed.segments![1].start = 0.5;
    expect(validShotView(malformed)).toBe(false);
    expect(validShotForTrack(view, 2)).toBe(false);
  });
  it('validates saved cameras and identifies recordings by content rather than filename', () => {
    const track = fixture(),
      renamed = structuredClone(track);
    renamed.name = 'renamed.csv';
    expect(shotRecordingId(renamed)).toBe(shotRecordingId(track));
    renamed.rows[1].pos[0] += 1;
    expect(shotRecordingId(renamed)).not.toBe(shotRecordingId(track));
    const shots = recommendShots(track, { end: 3, start: 0 });
    expect(Object.values(shots).every(validShotView)).toBe(true);
    for (const value of [
      null,
      { ...shots.fixed, fovYDeg: 180 },
      { ...shots.follow, offset: [0, 0, 0] },
      { ...shots.tracking, position: [1, Infinity, 2] },
      { ...shots.cockpit, cockpitLookPose: { lateral: 100, pitch: 0, yaw: 0 } },
    ])
      expect(validShotView(value)).toBe(false);
  });
  it('keeps a fixed camera fixed and a tracking camera aimed at the actual interpolated aircraft', () => {
    const track = fixture(),
      views = recommendShots(track, { end: 2.6, start: 0.4 });
    const first = shotCameraState(views.fixed, track, 0.4, 16 / 9)!;
    expect(shotCameraState(views.fixed, track, 2.6, 16 / 9)).toEqual(first);
    const start = shotCameraState(views.tracking, track, 0.4, 16 / 9)!;
    const end = shotCameraState(views.tracking, track, 2.6, 16 / 9)!;
    expect(end.eye).toEqual(start.eye);
    expect(end.target).toEqual(gtaToEngine(...sampleTrack(track, 2.6).pos));
    expect(end.target).not.toEqual(start.target);
  });

  it('round-trips a user placed follow camera and preserves the horizon through a full roll', () => {
    const track = fixture();
    const state = shotCameraState(recommendShots(track, { end: 3, start: 0 }).follow, track, 1.25, 16 / 9)!;
    const view = captureExteriorShot('follow', state, track, 1.25);
    expect(shotCameraState(view, track, 1.25, 16 / 9)!.eye).toEqual(state.eye);
    for (const time of [2.75, 0, 1.5, 3, 2.75]) {
      const sampled = shotCameraState(view, track, time, 16 / 9)!;
      expect(sampled.up).toEqual([0, 1, 0]);
      expect(sampled.eye.map((v, i) => v - sampled.target[i])).toEqual(state.eye.map((v, i) => v - state.target[i]));
    }
  });

  it('uses prefix heading during vertical flight and produces finite views regardless of seek order', () => {
    const track = fixture();
    track.rows[1].orientation = [0, 0, 0, 1];
    track.rows[2].orientation = [0, 0, 0, 1];
    const view = recommendShots(track, { end: 3, start: 0 }).follow;
    const expected = shotCameraState(view, track, 1.8, 16 / 9);
    shotCameraState(view, track, 3, 16 / 9);
    shotCameraState(view, track, 0.1, 16 / 9);
    expect(shotCameraState(view, track, 1.8, 16 / 9)).toEqual(expected);
    expect(shotHeading(track, 1.8)).toBeCloseTo(shotHeading(track, 0));
    expect([...expected!.eye, ...expected!.target, ...expected!.up].every(Number.isFinite)).toBe(true);
    const axial = shotCameraState(
      { fovYDeg: 60, kind: 'tracking', pitch: 0, position: [100, 120, -200], yaw: 0 },
      track,
      0,
      16 / 9,
    )!;
    expect(axial.up).toEqual([0, 0, 1]);
  });

  it('rejects empty, reversed, negative and out-of-track ranges', () => {
    for (const range of [
      { end: 1, start: 1 },
      { end: 1, start: 2 },
      { end: 1, start: -1 },
      { end: 4, start: 0 },
      { end: 2, start: NaN },
    ])
      expect(validShotRange(range, 3)).toBe(false);
    expect(validShotRange({ end: 3, start: 0.25 }, 3)).toBe(true);
  });

  it('crops stereo PCM at capture time while rebasing the WAV to zero', () => {
    const pcm = new Int16Array(Array.from({ length: 40 }, (_, i) => i * 100));
    const wav = cropShotAudio({ channels: 2, pcm, sampleRateHz: 10 }, { end: 1.1, start: 0.3 });
    const data = new DataView(wav.buffer);
    expect(data.getUint32(40, true)).toBe(8 * 2 * 2);
    expect(data.getInt16(44, true)).toBe(pcm[6]);
    expect(data.getInt16(wav.length - 2, true)).toBe(pcm[21]);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
  });
});
