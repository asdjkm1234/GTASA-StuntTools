import type { CameraState } from '@opensa/engine';

import { describe, expect, it } from 'vitest';

import { ScreenProjector } from './projection';

/**
 * Defends the seam between the 3D map and the 2D symbology drawn over it: every callsign, call chip and
 * leader line is placed by this class, so a projector that disagrees with the frame puts labels on units
 * that are not there. The orthographic cases are the ones with teeth — an orthographic clip w is 1 for the
 * whole world, so the perspective "is it behind me" test silently passes for everything.
 */
const SIZE = { height: 800, width: 1600 };

/** A camera 500 units up over the origin, looking straight down the −Z axis at a point 500 ahead. */
function camera(orthoHalfHeight?: number): CameraState {
  return {
    aspect: SIZE.width / SIZE.height,
    eye: [0, 0, 500],
    far: 12000,
    fovYRad: Math.PI / 3,
    near: orthoHalfHeight === undefined ? 0.5 : -1000,
    ...(orthoHalfHeight === undefined ? {} : { orthoHalfHeight }),
    target: [0, 0, 0],
    up: [0, 1, 0],
  };
}

describe('ScreenProjector', () => {
  describe('negative cases', () => {
    it('drops a point behind an orthographic camera, where clip w cannot say it is behind', () => {
      const projector = new ScreenProjector();
      projector.update(camera(400), SIZE.width, SIZE.height);

      expect(projector.project([0, 0, 900])).toBeNull();
    });

    it('drops a point behind a perspective camera', () => {
      const projector = new ScreenProjector();
      projector.update(camera(), SIZE.width, SIZE.height);

      expect(projector.project([0, 0, 900])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('puts a point on the view axis in the middle of the overlay, in both projections', () => {
      const projector = new ScreenProjector();
      for (const state of [camera(), camera(400)]) {
        projector.update(state, SIZE.width, SIZE.height);
        const point = projector.project([0, 0, 0]);

        expect(point?.x).toBeCloseTo(SIZE.width / 2, 3);
        expect(point?.y).toBeCloseTo(SIZE.height / 2, 3);
      }
    });

    it('reports the distance ahead of the eye, so labels still fade and sort under a plan view', () => {
      const projector = new ScreenProjector();
      projector.update(camera(400), SIZE.width, SIZE.height);

      expect(projector.project([0, 0, 0])?.depth).toBeCloseTo(500, 3);
      expect(projector.project([0, 0, -300])?.depth).toBeCloseTo(800, 3);
    });

    it('holds a unit at the same screen size however deep it sits, which perspective cannot', () => {
      const projector = new ScreenProjector();
      projector.update(camera(400), SIZE.width, SIZE.height);
      const near = projector.project([200, 0, 0]);
      const far = projector.project([200, 0, -4000]);

      expect(far?.x).toBeCloseTo(near?.x ?? 0, 3);
      // The box is 400 units tall, so 200 units up is half way to the top edge of the overlay.
      expect(projector.project([0, 200, 0])?.y).toBeCloseTo(SIZE.height / 4, 3);
    });

    it('keeps the perspective placement it always had, so switching modes moves nothing else', () => {
      const projector = new ScreenProjector();
      projector.update(camera(), SIZE.width, SIZE.height);
      const near = projector.project([100, 0, 0]);
      const far = projector.project([100, 0, -4000]);

      expect(near).not.toBeNull();
      // Perspective divides: the same world offset reads smaller the farther away it is.
      expect(Math.abs((far?.x ?? 0) - SIZE.width / 2)).toBeLessThan(Math.abs((near?.x ?? 0) - SIZE.width / 2));
    });
  });
});
