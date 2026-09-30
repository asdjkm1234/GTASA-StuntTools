import { describe, expect, it } from 'vitest';

import { ReplayCamera, type CameraFrame } from './camera';

const frame: CameraFrame = {
  aspect: 16 / 9,
  cockpitPosition: [10, 20, 30],
  dt: 1 / 60,
  firstPersonPosition: [10, 20, 30],
  forward: [0, 0, 1],
  model: 520,
  modelLength: 14,
  modelTop: 3,
  position: [0, 0, 0],
  snap: true,
  up: [0, 1, 0],
  velocity: [0, 0, 0],
};

describe('ReplayCamera cockpit', () => {
  it('places the visible cockpit camera exactly at the driver eye', () => {
    const camera = new ReplayCamera();
    camera.mode = 'cockpit';

    const view = camera.state(frame);
    expect(view.eye).toEqual(frame.firstPersonPosition);
    expect(view.target).toEqual([10, 20, 115]);
    expect(view.near).toBe(0.03);
  });

  it('keeps a fallback when no seat or canopy anchor is available', () => {
    const camera = new ReplayCamera();
    camera.mode = 'cockpit';

    const view = camera.state({ ...frame, cockpitPosition: undefined, firstPersonPosition: undefined });
    expect(view.eye).toEqual([0, 0.3, 0.6]);
  });
});
