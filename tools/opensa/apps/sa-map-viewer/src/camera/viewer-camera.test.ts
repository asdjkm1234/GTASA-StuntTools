import { TOP_DOWN_HEIGHT, TOP_DOWN_PITCH } from '@opensa/web/ui/camera/fly-rig';
import { describe, expect, it } from 'vitest';

import { MAP_YAW, poseFromQuery, ViewerCamera } from './viewer-camera';

const CENTRE: [number, number] = [1000, -2000];
const degrees = (radians: number): number => Math.round((radians * 180) / Math.PI);

describe('poseFromQuery', () => {
  describe('negative cases', () => {
    it('falls back to the map centre when ?at is absent', () => {
      expect(poseFromQuery('', CENTRE).at).toEqual(CENTRE);
    });

    it('falls back when ?at is malformed (a single number, a word, three parts)', () => {
      for (const search of ['?at=5', '?at=beach', '?at=1,2,3']) {
        expect(poseFromQuery(search, CENTRE).at).toEqual(CENTRE);
      }
    });

    it('ignores a non-numeric height / pitch / yaw rather than producing NaN', () => {
      const pose = poseFromQuery('?h=tall&pitch=down&yaw=north', CENTRE);
      expect(pose.height).toBe(TOP_DOWN_HEIGHT);
      expect(pose.pitch).toBe(TOP_DOWN_PITCH);
      expect(pose.yaw).toBe(MAP_YAW);
    });
  });

  describe('positive cases', () => {
    it('opens top-down over the given point, north up (the map orientation)', () => {
      const pose = poseFromQuery('?at=136,-1715', CENTRE);
      expect(pose.at).toEqual([136, -1715]);
      expect(pose.height).toBe(TOP_DOWN_HEIGHT);
      expect(pose.pitch).toBe(TOP_DOWN_PITCH);
      expect(degrees(pose.yaw)).toBe(180);
    });

    it('reads pitch and yaw in DEGREES', () => {
      const pose = poseFromQuery('?pitch=-45&yaw=90', CENTRE);
      expect(degrees(pose.pitch)).toBe(-45);
      expect(degrees(pose.yaw)).toBe(90);
    });
  });
});

describe('ViewerCamera', () => {
  describe('negative cases', () => {
    it('never lets the eye level out: a pitch above the cap is clamped down', () => {
      // 0° would look at the horizon, and a horizon-level map inspector shows nothing but the skyline.
      const camera = new ViewerCamera({ at: [0, 0], height: 100, pitch: 0, yaw: 0 });
      expect(camera.pose().pitch).toBeLessThan(0);
    });

    it('never passes vertical: a pitch below the floor is clamped up', () => {
      // A perfectly vertical forward has no defined screen basis — TOP_DOWN_PITCH stops just short of it.
      const camera = new ViewerCamera({ at: [0, 0], height: 100, pitch: -Math.PI, yaw: 0 });
      expect(camera.pose().pitch).toBe(TOP_DOWN_PITCH);
    });
  });

  describe('positive cases', () => {
    it('round-trips the pose it was built from', () => {
      const pose = { at: [136, -1715] as [number, number], height: 400, pitch: -Math.PI / 4, yaw: Math.PI };
      const read = new ViewerCamera(pose).pose();
      expect(read.at[0]).toBeCloseTo(pose.at[0]);
      expect(read.at[1]).toBeCloseTo(pose.at[1]);
      expect(read.height).toBeCloseTo(pose.height);
      expect(read.pitch).toBeCloseTo(pose.pitch);
    });

    it('puts the eye above the looked-at point and aims at it', () => {
      const camera = new ViewerCamera({ at: [500, -250], height: 400, pitch: TOP_DOWN_PITCH, yaw: MAP_YAW });
      const { eye, target } = camera.state(1.6);
      // Engine coords: GTA (x, y) → (x, ·, −y). The target IS the ground point; the eye rides above it.
      expect(target[0]).toBeCloseTo(500);
      expect(target[2]).toBeCloseTo(250);
      expect(eye[1]).toBeCloseTo(400, 0);
      expect(Math.hypot(eye[0] - target[0], eye[2] - target[2])).toBeLessThan(10);
    });

    it('orbits around the ground point — the looked-at spot does not move', () => {
      const camera = new ViewerCamera({ at: [100, -100], height: 300, pitch: -Math.PI / 3, yaw: 0 });
      const before = camera.positionGta();
      camera.orbit(120, 40);
      const after = camera.positionGta();
      expect(after[0]).toBeCloseTo(before[0]);
      expect(after[1]).toBeCloseTo(before[1]);
      expect(camera.pose().yaw).not.toBeCloseTo(0);
    });

    it('pans the looked-at point and keeps the eye height', () => {
      const camera = new ViewerCamera({ at: [0, 0], height: 300, pitch: TOP_DOWN_PITCH, yaw: MAP_YAW });
      camera.pan([0.5, 0]);
      const pose = camera.pose();
      expect(Math.hypot(pose.at[0], pose.at[1])).toBeGreaterThan(1);
      expect(pose.height).toBeCloseTo(300);
    });

    it('jumps the looked-at point and leaves the pose alone (the model search)', () => {
      const camera = new ViewerCamera({ at: [0, 0], height: 300, pitch: -Math.PI / 3, yaw: MAP_YAW });
      camera.lookAtGta([136, -1715]);
      const pose = camera.pose();
      expect(pose.at[0]).toBeCloseTo(136);
      expect(pose.at[1]).toBeCloseTo(-1715);
      expect(pose.height).toBeCloseTo(300);
      expect(pose.pitch).toBeCloseTo(-Math.PI / 3);
      expect(pose.yaw).toBeCloseTo(MAP_YAW);
    });

    it('dollies the eye without moving what it looks at', () => {
      const camera = new ViewerCamera({ at: [0, 0], height: 300, pitch: TOP_DOWN_PITCH, yaw: MAP_YAW });
      camera.dolly(1); // wheel away = pull back
      expect(camera.pose().height).toBeGreaterThan(300);
      expect(camera.positionGta()).toEqual([0, 0]);
    });
  });
});
