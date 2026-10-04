import { describe, expect, it } from 'vitest';

import type { FreeCameraFocusOptions } from './free-camera';
import type { Vec3 } from './math';

import { FreeCamera } from './free-camera';

const STEP_MS = 1000 / 60;
const START_POSITION: Vec3 = [10, 40, -20];
const START = { focusDistance: 60, pitch: -0.2, position: START_POSITION, yaw: 0.7 };

function cameraAtStart(): FreeCamera {
  return new FreeCamera({ ...START, position: [...START_POSITION] });
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function expectAllFinite(camera: FreeCamera): void {
  for (const value of [...camera.position, camera.yaw, camera.pitch, camera.focusDistance, ...camera.target()]) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

function expectPoseClose(actual: FreeCamera, expected: FreeCamera, digits = 9): void {
  for (let axis = 0; axis < 3; axis += 1) {
    expect(actual.position[axis]).toBeCloseTo(expected.position[axis], digits);
  }
  expect(actual.yaw).toBeCloseTo(expected.yaw, digits);
  expect(actual.pitch).toBeCloseTo(expected.pitch, digits);
  expect(actual.focusDistance).toBeCloseTo(expected.focusDistance, digits);
}

/** The pose an instant `focus(target, options)` takes — the destination every flight must land on. */
function instantFocus(camera: FreeCamera, target: Vec3, options: FreeCameraFocusOptions = {}): FreeCamera {
  const oracle = new FreeCamera({
    focusDistance: camera.focusDistance,
    pitch: camera.pitch,
    position: [...camera.position],
    yaw: camera.yaw,
  });
  oracle.focus(target, options);

  return oracle;
}

/** Ticks the flight at a 60 Hz frame until it ends, returning the simulated elapsed milliseconds. */
function runToEnd(camera: FreeCamera, limit = 1000): number {
  let elapsedMs = 0;
  let steps = 0;
  while (camera.flying() && steps < limit) {
    camera.advance(STEP_MS / 1000);
    elapsedMs += STEP_MS;
    steps += 1;
  }
  expect(steps).toBeLessThan(limit);

  return elapsedMs;
}

describe('FreeCamera.flyTo', () => {
  describe('negative cases', () => {
    it('completes a zero-distance target in one step without NaN', () => {
      const camera = cameraAtStart();
      // `camera.target()` is exactly the point an instant focus would put the eye: the destination of this
      // flight is the pose the camera already has, so there is nothing to animate and no division happens.
      const alreadyThere = camera.target();
      const beforePosition = [...camera.position];
      const beforeYaw = camera.yaw;
      const beforePitch = camera.pitch;

      camera.flyTo(alreadyThere);

      expect(camera.flying()).toBe(false);
      expect(camera.flyProgress()).toBe(1);
      expectAllFinite(camera);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(camera.position[axis]).toBeCloseTo(beforePosition[axis], 9);
      }
      expect(camera.yaw).toBeCloseTo(beforeYaw, 12);
      expect(camera.pitch).toBeCloseTo(beforePitch, 12);
    });

    it('treats a non-positive duration as an immediate, NaN-free completion', () => {
      const camera = cameraAtStart();
      const target: Vec3 = [200, 5, 300];
      const oracle = instantFocus(camera, target);

      camera.flyTo(target, { durationMs: -16 });

      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);
      expectPoseClose(camera, oracle);
    });

    it('re-targets cleanly when interrupted mid-flight', () => {
      const camera = cameraAtStart();
      const firstTarget: Vec3 = [500, 100, 500];
      camera.flyTo(firstTarget, { durationMs: 1000 });
      camera.advance(0.2);
      expect(camera.flying()).toBe(true);

      const midPose = {
        focusDistance: camera.focusDistance,
        pitch: camera.pitch,
        position: [...camera.position] as Vec3,
        yaw: camera.yaw,
      };
      const reference = new FreeCamera(midPose);
      const secondTarget: Vec3 = [-300, 80, 120];
      const oracle = instantFocus(reference, secondTarget);

      camera.flyTo(secondTarget, { durationMs: 800 });

      expect(camera.flying()).toBe(true);
      expect(camera.flyProgress()).toBe(0);
      // The new flight starts exactly where the interrupted one left the camera — no teleport.
      for (let axis = 0; axis < 3; axis += 1) {
        expect(camera.position[axis]).toBeCloseTo(midPose.position[axis], 12);
      }
      expect(camera.yaw).toBeCloseTo(midPose.yaw, 12);

      runToEnd(camera);
      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);
      expectPoseClose(camera, oracle);
      expect(distance(camera.position, midPose.position)).toBeGreaterThan(1);
    });

    it('never overshoots or produces NaN on a huge frame delta', () => {
      const camera = cameraAtStart();
      const target: Vec3 = [-900, 300, 400];
      const oracle = instantFocus(camera, target);
      camera.flyTo(target, { durationMs: 800 });

      camera.advance(1e6);

      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);
      expectPoseClose(camera, oracle);
    });

    it('steps forward by nothing when the frame delta is negative or non-finite', () => {
      const camera = cameraAtStart();
      camera.flyTo([300, 60, -200], { durationMs: 500 });
      const start = [...camera.position];

      camera.advance(-5);
      camera.advance(Number.NaN);

      expect(camera.flying()).toBe(true);
      expect(camera.flyProgress() <= 1).toBe(true);
      expectAllFinite(camera);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(camera.position[axis]).toBeCloseTo(start[axis], 12);
      }
    });
  });

  describe('positive cases', () => {
    it('reaches the destination within the requested duration bounds', () => {
      const camera = cameraAtStart();
      const target: Vec3 = [900, 30, -400];
      const oracle = instantFocus(camera, target);
      const durationMs = 600;

      camera.flyTo(target, { durationMs });
      expect(camera.flying()).toBe(true);

      const elapsedMs = runToEnd(camera);

      expect(camera.flying()).toBe(false);
      expect(elapsedMs).toBeGreaterThanOrEqual(durationMs);
      expect(elapsedMs).toBeLessThanOrEqual(durationMs + STEP_MS + 1e-6);
      expectAllFinite(camera);
      expectPoseClose(camera, oracle);
    });

    it('is monotonic: progress never decreases and the eye only closes on the target', () => {
      const camera = cameraAtStart();
      const target: Vec3 = [-500, 200, 700];
      const oracle = instantFocus(camera, target);
      camera.flyTo(target, { durationMs: 500 });

      let lastProgress = 0;
      let lastDistance = distance(camera.position, oracle.position);
      let samples = 0;
      while (camera.flying() && samples < 1000) {
        camera.advance(STEP_MS / 1000);
        const progress = camera.flyProgress();
        expect(progress).toBeGreaterThanOrEqual(lastProgress);
        expect(progress).toBeLessThanOrEqual(1);
        const remaining = distance(camera.position, oracle.position);
        expect(remaining).toBeLessThanOrEqual(lastDistance + 1e-9);
        lastProgress = progress;
        lastDistance = remaining;
        samples += 1;
      }

      expect(samples).toBeGreaterThan(5);
      expect(lastProgress).toBe(1);
      expect(lastDistance).toBeLessThan(1e-9);
    });

    it('eases direction along the shortest arc across the yaw seam', () => {
      const camera = new FreeCamera({ focusDistance: 60, pitch: 0, position: [0, 0, 0], yaw: 3 });
      const target: Vec3 = [0, 0, -60];
      const shortTurn = Math.abs(((((3 - -3 + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI);
      camera.flyTo(target, { durationMs: 600, pitch: 0, yaw: -3 });

      let sawMidway = false;
      while (camera.flying()) {
        camera.advance(STEP_MS / 1000);
        const turnFromStart = Math.abs(
          ((((camera.yaw - 3 + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI,
        );
        // A long-way flight would pass through 0 yaw on the way; the short arc never turns more than `shortTurn`.
        expect(turnFromStart).toBeLessThanOrEqual(shortTurn + 1e-9);
        if (turnFromStart > shortTurn * 0.4) {
          sawMidway = true;
        }
      }

      expect(sawMidway).toBe(true);
      expect(camera.yaw).toBeCloseTo(-3, 12);
      expectAllFinite(camera);
    });

    it('keeps the eye fixed and only turns when `move: false`', () => {
      const camera = cameraAtStart();
      const startPosition = [...camera.position] as Vec3;
      const target: Vec3 = [-200, 80, 150];
      const oracle = instantFocus(camera, target, { move: false });

      camera.flyTo(target, { durationMs: 400, move: false });
      runToEnd(camera);

      for (let axis = 0; axis < 3; axis += 1) {
        expect(camera.position[axis]).toBeCloseTo(startPosition[axis], 12);
      }
      expectPoseClose(camera, oracle, 6);
      const forward = camera.forward();
      const toTarget: Vec3 = [
        target[0] - camera.position[0],
        target[1] - camera.position[1],
        target[2] - camera.position[2],
      ];
      const length = Math.hypot(...toTarget);
      const dot = (forward[0] * toTarget[0] + forward[1] * toTarget[1] + forward[2] * toTarget[2]) / length;
      expect(dot).toBeCloseTo(1, 6);
    });

    it('caps an unbounded duration request at the hard bound', () => {
      const camera = cameraAtStart();
      camera.flyTo([300, 60, -200], { durationMs: 1e9 });

      camera.advance(4.9);
      expect(camera.flying()).toBe(true);
      camera.advance(0.2);

      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);
    });

    it('keeps focus(), lookAt() and setPose() instant and cancels an active flight', () => {
      const target: Vec3 = [100, 10, 100];

      const focused = cameraAtStart();
      const focusOracle = instantFocus(focused, target);
      focused.flyTo(target, { durationMs: 1000 });
      expect(focused.flying()).toBe(true);
      focused.focus(target);
      expect(focused.flying()).toBe(false);
      expectPoseClose(focused, focusOracle);

      const looked = cameraAtStart();
      looked.flyTo(target, { durationMs: 1000 });
      looked.lookAt([0, 0, 0]);
      expect(looked.flying()).toBe(false);
      expect(looked.flyProgress()).toBe(1);

      const posed = cameraAtStart();
      posed.flyTo(target, { durationMs: 1000 });
      posed.setPose({ position: [1, 2, 3] });
      expect(posed.flying()).toBe(false);
      expect(posed.position).toEqual([1, 2, 3]);
    });

    it('lets the interactive move and rotate paths cancel the flight', () => {
      const camera = cameraAtStart();
      camera.flyTo([300, 60, -200], { durationMs: 1000 });
      camera.moveLocal(1, 0, 0);
      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);

      camera.flyTo([300, 60, -200], { durationMs: 1000 });
      camera.rotateBy(0.1, 0);
      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);

      camera.flyTo([300, 60, -200], { durationMs: 1000 });
      camera.cancelFlyTo();
      expect(camera.flying()).toBe(false);
      expectAllFinite(camera);
    });
  });
});
