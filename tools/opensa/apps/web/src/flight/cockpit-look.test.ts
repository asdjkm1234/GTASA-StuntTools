import { describe, expect, it } from 'vitest';

import { CockpitLookCamera } from './cockpit-look';
import { FreeCamera } from './free-camera';

const frame = { aspect: 16 / 9, eye: [0, 0, 0] as [number, number, number],
  forward: [0, 0, -1] as [number, number, number],
  right: [1, 0, 0] as [number, number, number],
  up: [0, 1, 0] as [number, number, number] };

describe('CockpitLookCamera', () => {
  it('leans forward only when looking back, keeping the instrument view at the pilot eye', () => {
    const input = new FreeCamera({ pitch: 0 });
    const look = new CockpitLookCamera(input);
    const front = look.state(frame);
    expect(front.eye).toEqual([0, 0, 0]);
    expect(front.near).toBe(0.03);

    input.rotateBy(Math.PI, 0);
    const back = look.state(frame);
    expect(back.eye[2]).toBeCloseTo(-0.55);
    expect(back.target[2]).toBeGreaterThan(back.eye[2]);

    input.rotateBy(-Math.PI, 0);
    expect(look.state(frame).eye).toEqual([0, 0, 0]);
  });

  it('limits position nudges to the cockpit even when free-camera input is large', () => {
    const input = new FreeCamera({ pitch: 0 });
    const look = new CockpitLookCamera(input);
    look.state(frame);
    input.position = [100, 100, -100];
    const nudged = look.state(frame);
    expect(nudged.eye).toEqual([0.1, 0.08, -0.12]);
  });

  it('maps W and D from the viewing direction even when the input camera faces across the aircraft', () => {
    const input = new FreeCamera({ pitch: 0, yaw: Math.PI / 2 });
    const look = new CockpitLookCamera(input);
    look.state(frame);

    input.moveLevel(10, 0, 0);
    const ahead = look.state(frame);
    expect(ahead.eye[2]).toBeCloseTo(-0.05);
    expect(ahead.eye[0]).toBeCloseTo(0);

    input.rotateBy(Math.PI, 0);
    const rear = look.state(frame);
    input.moveLevel(10, 0, 0);
    const rearForward = look.state(frame);
    expect(rearForward.eye[2]).toBeGreaterThan(rear.eye[2]);

    input.moveLevel(0, 10, 0);
    const rearRight = look.state(frame);
    expect(rearRight.eye[0]).toBeLessThan(rearForward.eye[0]);
  });
});
