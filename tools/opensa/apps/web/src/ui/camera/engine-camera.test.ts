import { describe, expect, it } from 'vitest';

import { CAMERA_FOV_Y, createChordWatcher, cursorRay, forwardFrom, resolveCamera } from './engine-camera';
import { TOP_DOWN_PITCH } from './fly-rig';

const FORWARD = [0, 0, -1] as const; // looking down −Z
const TARGET = [10, 2, 30] as const;

describe('resolveCamera', () => {
  const base = {
    aspect: 1.5,
    bench: null,
    distance: 7,
    flyEye: null,
    forward: FORWARD,
    fovYRad: CAMERA_FOV_Y,
    target: TARGET,
    video: null,
  };
  const video = {
    eye: [3, 3, 3] as [number, number, number],
    target: [4, 4, 4] as [number, number, number],
  };

  describe('negative cases', () => {
    it('ignores the photo camera while a bench owns the frame', () => {
      const bench = { eye: [1, 1, 1] as [number, number, number], target: [2, 2, 2] as [number, number, number] };
      const camera = resolveCamera({ ...base, bench, flyEye: [9, 9, 9] });

      expect(camera.eye).toEqual([1, 1, 1]);
      expect(camera.target).toEqual([2, 2, 2]);
    });

    it('ignores video mode while a bench owns the frame — bench numbers stay untouchable', () => {
      const bench = { eye: [1, 1, 1] as [number, number, number], target: [2, 2, 2] as [number, number, number] };
      const camera = resolveCamera({ ...base, bench, video });

      expect(camera.eye).toEqual([1, 1, 1]);
    });

    it('does not invent a lens for a shot that chose none — the rig keeps its live FOV', () => {
      const camera = resolveCamera({ ...base, fovYRad: 1.1, video });

      expect(camera.fovYRad).toBe(1.1);
    });
  });

  describe('positive cases', () => {
    it('trails the follow target by the zoom distance', () => {
      const camera = resolveCamera(base);

      expect(camera.eye).toEqual([10, 2, 37]); // pulled back along −forward
      expect(camera.target).toEqual([10, 2, 30]);
      expect(camera.aspect).toBe(1.5);
    });

    it('sits at the photo eye and looks one unit ahead of it', () => {
      const camera = resolveCamera({ ...base, flyEye: [4, 5, 6] });

      expect(camera.eye).toEqual([4, 5, 6]);
      expect(camera.target).toEqual([4, 5, 5]);
    });

    it('carries the field of view it was handed (picking unprojects through the SAME value)', () => {
      expect(resolveCamera({ ...base, fovYRad: 1.1 }).fovYRad).toBe(1.1);
    });

    it('gives video mode the frame over the photo camera and the follow rig', () => {
      const camera = resolveCamera({ ...base, flyEye: [9, 9, 9], video });

      expect(camera.eye).toEqual([3, 3, 3]);
      expect(camera.target).toEqual([4, 4, 4]);
    });

    it('shoots a video shot on its own lens', () => {
      const camera = resolveCamera({ ...base, video: { ...video, fovYRad: 0.7 } });

      expect(camera.fovYRad).toBe(0.7);
    });
  });
});

describe('forwardFrom', () => {
  describe('positive cases', () => {
    it('looks down +Z at yaw 0 and down −X at yaw −pi/2', () => {
      const [ax, ay, az] = forwardFrom(0, 0);
      expect([ax, ay, az].map((value) => Number(value.toFixed(6)))).toEqual([0, 0, 1]);

      const [bx, , bz] = forwardFrom(-Math.PI / 2, 0);
      expect(bx).toBeCloseTo(-1, 6);
      expect(bz).toBeCloseTo(0, 6);
    });

    it('stays unit length across the pitch range', () => {
      for (const pitch of [-1.2, -0.25, 0, 0.9]) {
        expect(Math.hypot(...forwardFrom(2.3, pitch))).toBeCloseTo(1, 12);
      }
    });
  });
});

describe('createChordWatcher', () => {
  describe('negative cases', () => {
    it('does not fire on one key alone', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');

      expect(chord.down('KeyK')).toBe(false);
      expect(chord.down('KeyA')).toBe(false);
    });

    it('does not re-fire while both keys stay held (key repeat)', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyK');

      expect(chord.down('KeyM')).toBe(true);
      expect(chord.down('KeyM')).toBe(false);
      expect(chord.down('KeyK')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('fires once per press, in either key order', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyM');
      expect(chord.down('KeyK')).toBe(true);

      chord.up('KeyK');
      chord.up('KeyM');
      chord.down('KeyK');
      expect(chord.down('KeyM')).toBe(true);
    });

    it('re-arms after only one of the two keys is released', () => {
      const chord = createChordWatcher('KeyK', 'KeyM');
      chord.down('KeyK');
      chord.down('KeyM');

      chord.up('KeyM'); // K still held
      expect(chord.down('KeyM')).toBe(true);
    });
  });
});

describe('cursorRay', () => {
  const close = (a: readonly number[], b: readonly number[]): void => {
    a.forEach((value, at) => expect(value).toBeCloseTo(b[at], 6));
  };

  describe('negative cases', () => {
    it('returns the forward vector unchanged at screen centre', () => {
      close(cursorRay([0, 0, 1], [0, 0], 16 / 9, Math.PI / 3), [0, 0, 1]);
    });

    it('stays unit length off-centre, so the pick ray has no implicit scale', () => {
      const dir = cursorRay([0, 0, 1], [0.8, -0.6], 16 / 9, Math.PI / 3);

      expect(Math.hypot(...dir)).toBeCloseTo(1, 6);
    });

    it('survives the near-vertical top-down forward the viewer rests at', () => {
      // A perfectly vertical forward has no screen basis; the viewer's pitch stops just short of it.
      const forward: [number, number, number] = [Math.cos(TOP_DOWN_PITCH), Math.sin(TOP_DOWN_PITCH), 0];
      const dir = cursorRay(forward, [0.5, 0.5], 1, Math.PI / 3);

      expect(Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && Number.isFinite(dir[2])).toBe(true);
      expect(Math.hypot(...dir)).toBeCloseTo(1, 6);
    });
  });

  describe('positive cases', () => {
    it('aims along the camera RIGHT for a cursor on the right edge', () => {
      // Looking down +Z, `mat4LookAt`'s screen right is −X; a right-edge cursor must lean that way.
      const dir = cursorRay([0, 0, 1], [1, 0], 1, Math.PI / 3);

      expect(dir[0]).toBeLessThan(0);
      expect(dir[1]).toBeCloseTo(0, 6);
      expect(dir[2]).toBeGreaterThan(0);
    });

    it('aims UP for a cursor above centre', () => {
      const dir = cursorRay([0, 0, 1], [0, 1], 1, Math.PI / 3);

      expect(dir[1]).toBeGreaterThan(0);
    });

    it('widens with the aspect ratio — the same NDC x reaches further on a wide canvas', () => {
      const narrow = cursorRay([0, 0, 1], [1, 0], 1, Math.PI / 3);
      const wide = cursorRay([0, 0, 1], [1, 0], 2, Math.PI / 3);

      expect(Math.abs(wide[0])).toBeGreaterThan(Math.abs(narrow[0]));
    });
  });
});
