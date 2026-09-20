import { describe, expect, it } from 'vitest';

import {
  aheadOf,
  engineToGta,
  gtaDistance,
  gtaRootMatrix,
  gtaToEngine,
  headingFromZAngle,
  headingOf,
  stepTowards,
} from './coords';

/** The direction a model's own +y (forward) ends up pointing in engine space, under `matrix`. */
const forwardOf = (matrix: Float32Array): [number, number, number] => [matrix[4], matrix[5], matrix[6]];

describe('coords', () => {
  describe('negative cases', () => {
    it('does not overshoot when the step is longer than the distance', () => {
      expect(stepTowards([0, 0], [10, 0], 999)).toEqual([10, 0]);
    });

    it('returns the target when the two points coincide, rather than dividing by zero', () => {
      expect(stepTowards([5, 5], [5, 5], 3)).toEqual([5, 5]);
    });

    it('does not mirror the map: a GTA round trip is not the identity on the raw tuple', () => {
      // The trap this file exists for — z = −y, so feeding GTA numbers straight to the engine flips the world.
      expect(gtaToEngine([100, 200])).not.toEqual([100, 200, 0]);
    });

    it("does not read SA's z-angle as a bearing: 90° is west, not east", () => {
      // The mirrored-facing trap on the live feed. The game measures counter-clockwise, this map clockwise,
      // so passing the field through unconverted points every unit at its reflection about north-south.
      expect(headingFromZAngle(90)).not.toBeCloseTo(Math.PI / 2);
      expect(headingFromZAngle(90)).toBeCloseTo((3 * Math.PI) / 2);
    });

    it('does not turn a model the way the heading reads: east is not engine −x', () => {
      // The mirrored-yaw trap. Using the heading verbatim as the yaw sends an eastbound car west, and on a
      // top-down map that reads as a plausible car going somewhere else.
      const matrix = new Float32Array(16);
      gtaRootMatrix(matrix, [0, 0], 0, Math.PI / 2);
      expect(forwardOf(matrix)[0]).toBeCloseTo(1);
    });
  });

  describe('positive cases', () => {
    it('round-trips a GTA ground point through engine space', () => {
      expect(engineToGta(gtaToEngine([2495, -1687]))).toEqual([2495, -1687]);
    });

    it('maps GTA y to engine −z and lifts on engine y', () => {
      expect(gtaToEngine([10, 20], 5)).toEqual([10, 5, -20]);
    });

    it('measures ground distance in world units', () => {
      expect(gtaDistance([0, 0], [3, 4])).toBe(5);
    });

    it('reads north as heading 0 and east as a quarter turn', () => {
      expect(headingOf([0, 0], [0, 10])).toBeCloseTo(0);
      expect(headingOf([0, 0], [10, 0])).toBeCloseTo(Math.PI / 2);
    });

    it('stands a model at the engine point under its GTA position, at its own height', () => {
      const matrix = new Float32Array(16);
      gtaRootMatrix(matrix, [2495, -1687], 13, 0);
      expect([matrix[12], matrix[13], matrix[14]]).toEqual([2495, 13, 1687]);
    });

    it('faces a model north on heading 0 and east on a quarter turn', () => {
      const matrix = new Float32Array(16);
      gtaRootMatrix(matrix, [0, 0], 0, 0);
      const north = forwardOf(matrix);
      expect(north[0]).toBeCloseTo(0);
      expect(north[2]).toBeCloseTo(-1); // GTA +y (north) is engine −z
      gtaRootMatrix(matrix, [0, 0], 0, Math.PI / 2);
      const east = forwardOf(matrix);
      expect(east[0]).toBeCloseTo(1);
      expect(east[2]).toBeCloseTo(0);
    });

    it('keeps a model upright: its own up axis is the engine up axis', () => {
      const matrix = new Float32Array(16);
      gtaRootMatrix(matrix, [10, 10], 0, 1.2);
      expect([matrix[8], matrix[9], matrix[10]]).toEqual([0, 1, 0]);
    });

    it("turns SA's z-angle into a bearing, and keeps it inside one turn", () => {
      expect(headingFromZAngle(0)).toBeCloseTo(0); // north either way
      expect(headingFromZAngle(270)).toBeCloseTo(Math.PI / 2); // SA 270° = east
      expect(headingFromZAngle(180)).toBeCloseTo(Math.PI); // south either way
      expect(headingFromZAngle(-90)).toBeCloseTo(Math.PI / 2);
      expect(headingFromZAngle(450)).toBeCloseTo((3 * Math.PI) / 2);
    });

    it("places a car exactly where the game's own vehicle handle places it", () => {
      // `engine-vehicle-handle` writes `[x, z, −y]` from a GTA position and takes the height verbatim. The
      // map must agree with the game a dispatcher is looking at, so this is the pairing rather than a taste.
      const matrix = new Float32Array(16);
      const position: [number, number, number] = [1481.3, -1770.6, 18.79];
      gtaRootMatrix(matrix, [position[0], position[1]], position[2], 0);
      // The matrix is f32, so the fix survives to ~1e-4 world units at Los Santos magnitudes — a tenth of a
      // millimetre, which is the precision floor of the whole path from the packet to the pixel.
      expect(matrix[12]).toBeCloseTo(position[0], 3);
      expect(matrix[13]).toBeCloseTo(position[2], 3);
      expect(matrix[14]).toBeCloseTo(-position[1], 3);
    });

    it('points the CAR and its CHEVRON the same way, at every heading', () => {
      // The 3D model is turned by the root matrix; the 2D symbol takes its angle from a point ahead of the
      // unit. One sign apart, they would draw a car and its own symbol facing differently — and each file
      // would look right on its own. This is the pairing, not either convention.
      const matrix = new Float32Array(16);
      for (let step = 0; step < 16; step += 1) {
        const heading = (step * Math.PI) / 8;
        gtaRootMatrix(matrix, [0, 0], 0, heading);
        const ahead = aheadOf([0, 0], heading, 10);
        // The model's forward is its own +y column, read back into GTA ground (engine z = −y).
        expect(matrix[4]).toBeCloseTo(ahead[0] / 10);
        expect(-matrix[6]).toBeCloseTo(ahead[1] / 10);
      }
    });

    it('steps exactly the requested distance along the line', () => {
      expect(stepTowards([0, 0], [10, 0], 2.5)).toEqual([2.5, 0]);
    });
  });
});
