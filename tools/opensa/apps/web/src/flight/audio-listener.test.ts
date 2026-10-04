import { expect, it } from 'vitest';

import { type AudioBankManifest, buildAudioTimeline } from './audio-engine';
import { aircraftVelocityAt, audioCameraCuts, cameraAudioListenerAt } from './audio-listener';
import { type CameraStateOut } from './camera';
import { parseFlightCsv } from './csv';
import { shotCameraState, type ShotView } from './shot-camera';
import { programShotAt, type ShotSequence } from './shot-sequence';

const track = parseFlightCsv(
  [
    '# gtasa_flight_recorder,version=12',
    'local_timestamp,capture_elapsed_s,model,health,x,y,z,vx,vy,vz,throttle,brake',
    ...[0, 1, 2].map((s) => `2026-10-05T00:00:0${s}.000,${s},520,1000,${s * 50 - 50},0,100,1,0,0,1,0`),
  ].join('\n'),
  'synthetic-flyby.csv',
);
const fixed: ShotView = { fovYDeg: 60, kind: 'fixed', pitch: 0, position: [0, 100, 10], yaw: 0 };
const manifest: AudioBankManifest = {
  samples: [
    {
      bankName: 'synthetic',
      category: 'engine front',
      file: 'tone.wav',
      globalBankId: 138,
      headroom: 0,
      kind: 'jet',
      layer: 'front',
      loopStartFrame: 0,
      model: 520,
      packageBankIndex: 131,
      pcmBytes: 100,
      rate: 1,
      sampleRateHz: 44100,
      setSoundCount: 45,
      slotId: 19,
      slotName: 'synthetic',
      soundIndex: 10,
      step: 1,
      wavBytes: 144,
      wavFrames: 50,
    },
  ],
  source: 'synthetic',
  version: 8,
};

it('uses position/capture-time m/s rather than the recorder game-velocity units', () => {
  expect(track.rows[0].velocity).toEqual([1, 0, 0]);
  expect(aircraftVelocityAt(track, 0.5)).toEqual([50, 0, 0]);
});

it('fixed flyby pans left to right and Doppler drops after passing; following has no relative Doppler', () => {
  const observer = cameraAudioListenerAt(2, (s) => shotCameraState(fixed, track, s, 16 / 9)!);
  const timeline = buildAudioTimeline(track, manifest);
  const before = timeline.frameAt(0.4, observer(0.4)).engine!;
  const after = timeline.frameAt(1.6, observer(1.6)).engine!;
  expect(observer(0.5).velocity).toEqual([0, 0, 0]);
  expect(before.layers[0].pan).toBeLessThan(0);
  expect(after.layers[0].pan).toBeGreaterThan(0);
  expect(before.playbackRate / before.pitch).toBeCloseTo(340 / 305);
  expect(after.playbackRate / after.pitch).toBeCloseTo(340 / 375);
  const follow: ShotView = { fovYDeg: 60, kind: 'follow', offset: [-30, -10, 5] };
  const moving = cameraAudioListenerAt(2, (s) => shotCameraState(follow, track, s, 16 / 9)!);
  expect(moving(0.5).velocity[0]).toBeCloseTo(50);
  const own = timeline.frameAt(0.5, moving(0.5)).engine!;
  expect(own.playbackRate / own.pitch).toBeCloseTo(1);
});

it('hard cuts select the next camera exactly without interpolating a travel or a velocity spike', () => {
  const sequence: ShotSequence = {
    clips: [
      { end: 0.735, start: 0, view: fixed },
      { end: 2, start: 0.735, view: { ...fixed, position: [1000, 200, 500] } },
    ],
    kind: 'sequence',
  };
  const observer = cameraAudioListenerAt(
    2,
    (s) => shotCameraState(programShotAt(sequence, s), track, s, 16 / 9)!,
    audioCameraCuts(sequence),
  );
  expect(observer(0.734999).pos).toEqual([0, -10, 100]);
  expect(observer(0.735).pos).toEqual([1000, -500, 200]);
  expect(observer(0.734999).velocity).toEqual([0, 0, 0]);
  expect(observer(0.735).velocity).toEqual([0, 0, 0]);
  expect(observer(1.8)).toEqual(observer(1.8));
});

it('continuous camera travel retains velocity, while zero-transition saved segments split the path', () => {
  const stateAt = (s: number): CameraStateOut => ({
    aspect: 1,
    eye: [10 * s, 0, 0],
    far: 1000,
    fovYRad: 1,
    near: 0.1,
    target: [10 * s, 0, -1],
    up: [0, 1, 0],
  });
  const observer = cameraAudioListenerAt(0.025, stateAt);
  expect(observer(0.012).velocity[0]).toBeCloseTo(10);
  expect(observer(0.012).pos[0]).toBeCloseTo(0.12);
  expect(observer(0.025).velocity[0]).toBeCloseTo(10);
  const view: ShotView = {
    ...fixed,
    segments: [
      { end: 1, fovYDeg: 60, pitch: 0, position: fixed.position, start: 0, transition: 0, yaw: 0 },
      { end: 2, fovYDeg: 60, pitch: 0, position: [20, 100, 10], start: 1, transition: 0, yaw: 0 },
    ],
  };
  expect(audioCameraCuts(view)).toEqual([1]);
  view.segments![1].transition = 0.3;
  expect(audioCameraCuts(view)).toEqual([]);
  expect(cameraAudioListenerAt(0, stateAt)(0).velocity).toEqual([0, 0, 0]);
});
