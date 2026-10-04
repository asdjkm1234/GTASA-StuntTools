import { describe, expect, it } from 'vitest';

import { samplePath } from './bench';

const PATH = [
  { look: [0, 0, 0], pos: [0, 0, 0] },
  { look: [10, 0, 0], pos: [10, 0, 0] },
  { look: [10, 10, 0], pos: [10, 10, 0] },
] as const;

describe('samplePath', () => {
  describe('negative cases', () => {
    it('clamps t outside [0, 1] to the endpoints', () => {
      expect(samplePath(PATH, -1).pos).toEqual([0, 0, 0]);
      expect(samplePath(PATH, 2).pos).toEqual([10, 10, 0]);
    });

    it('returns the single keyframe for a one-point path', () => {
      expect(samplePath([PATH[0]], 0.5)).toBe(PATH[0]);
    });
  });

  describe('positive cases', () => {
    it('interpolates piecewise-linearly across segments', () => {
      expect(samplePath(PATH, 0.25).pos).toEqual([5, 0, 0]); // middle of segment 1
      expect(samplePath(PATH, 0.5).pos).toEqual([10, 0, 0]); // exactly keyframe 2
      expect(samplePath(PATH, 0.75).pos).toEqual([10, 5, 0]); // middle of segment 2
    });
  });
});
