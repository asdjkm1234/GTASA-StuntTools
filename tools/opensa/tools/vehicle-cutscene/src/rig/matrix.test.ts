import { describe, expect, it } from 'vitest';

import { compose, IDENTITY_ROTATION, invert, isIdentityRotation, transformPoint, Z180_ROTATION } from './matrix';

describe('matrix', () => {
  describe('negative cases', () => {
    it('rejects a rotated matrix as identity', () => {
      expect(isIdentityRotation(Z180_ROTATION)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('composes a hinge transform over a z-180 rotation', () => {
      const hinge = { position: [1, 2, 3] as [number, number, number], rotation: [...Z180_ROTATION] };
      const local = { position: [0.5, 0, 0] as [number, number, number], rotation: [...IDENTITY_ROTATION] };
      const composed = compose(hinge, local);
      expect(composed.position[0]).toBeCloseTo(0.5, 6);
      expect(composed.position[1]).toBeCloseTo(2, 6);
      expect(composed.position[2]).toBeCloseTo(3, 6);
      expect(isIdentityRotation(composed.rotation)).toBe(false);
    });

    it('inverts an orthonormal transform back to identity', () => {
      const transform = { position: [4, -2, 1] as [number, number, number], rotation: [...Z180_ROTATION] };
      const roundTrip = compose(invert(transform), transform);
      expect(isIdentityRotation(roundTrip.rotation)).toBe(true);
      expect(roundTrip.position.every((value) => Math.abs(value) < 1e-6)).toBe(true);
    });

    it('transforms a point through rotation + translation', () => {
      const transform = { position: [10, 0, 0] as [number, number, number], rotation: [...Z180_ROTATION] };
      const [x, y, z] = transformPoint(transform, [1, 1, 1]);
      expect(x).toBeCloseTo(9, 6);
      expect(y).toBeCloseTo(-1, 6);
      expect(z).toBeCloseTo(1, 6);
    });
  });
});
