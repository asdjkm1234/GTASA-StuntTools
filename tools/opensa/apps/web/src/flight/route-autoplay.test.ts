import { describe, expect, it } from 'vitest';

import type { CameraStateOut } from './camera';

import { RouteAutoplay, travelCamera } from './route-autoplay';

const from: CameraStateOut = {
  aspect: 16 / 9,
  eye: [0, 100, 0],
  far: 2000,
  fovYRad: 1,
  near: 0.1,
  target: [0, 100, -10],
  up: [0, 1, 0],
};
const to: CameraStateOut = { ...from, eye: [1000, 200, -500], target: [1010, 200, -500], up: [0, -1, 0] };
describe('route autoplay', () => {
  it('waits two real seconds, prepares once and resumes only after travel completes', () => {
    const sequence = new RouteAutoplay();
    sequence.enabled = true;
    sequence.end(100, true, from);
    expect(sequence.prepare(2099)).toBe(false);
    expect(sequence.prepare(2100)).toBe(true);
    expect(sequence.prepare(2200)).toBe(false);
    expect(sequence.camera(9000)).toEqual(from);
    sequence.travel(to, 10000);
    expect(sequence.camera(10000)).toEqual(from);
    expect(sequence.finish(11199)).toBe(false);
    expect(sequence.camera(11200)).toEqual(to);
    expect(sequence.finish(11200)).toBe(true);
    expect(sequence.phase).toBe('idle');
  });
  it('cancels delays and never wraps the last route', () => {
    const sequence = new RouteAutoplay();
    sequence.end(0, true, from);
    expect(sequence.phase).toBe('idle');
    sequence.enabled = true;
    sequence.end(0, false, from);
    expect(sequence.phase).toBe('idle');
    sequence.end(0, true, from);
    sequence.cancel();
    expect(sequence.prepare(5000)).toBe(false);
  });
  it('moves continuously with finite orthogonal views through rolled cameras', () => {
    expect(travelCamera(from, to, 0)).toEqual(from);
    expect(travelCamera(from, to, 1)).toEqual(to);
    let previous = from;
    for (let i = 1; i <= 120; i++) {
      const state = travelCamera(from, to, i / 120);
      expect([...state.eye, ...state.target, ...state.up].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...state.eye.map((n, k) => n - previous.eye[k]))).toBeLessThan(15);
      const direction = state.target.map((n, k) => n - state.eye[k]);
      expect(direction.reduce((sum, n, k) => sum + n * state.up[k], 0)).toBeCloseTo(0, 5);
      previous = state;
    }
  });
});
