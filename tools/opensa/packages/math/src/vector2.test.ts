import { describe, expect, it } from 'vitest';

import { Vector2 } from './vector2';

/**
 * `Vector2` replaces three's, so what matters is the EDGE semantics a hand-rolled class gets wrong:
 * degenerate normalize, division by zero, and the sign convention of the 2D cross product. The bulk
 * arithmetic is asserted once per operation; the traps get their own cases.
 */
describe('Vector2', () => {
  describe('negative cases', () => {
    it('normalizes a zero vector to zero instead of NaN (three does the same)', () => {
      const zero = new Vector2(0, 0).normalize();
      expect(zero.x).toBe(0);
      expect(zero.y).toBe(0);
    });

    it('divides by zero to Infinity rather than throwing', () => {
      const divided = new Vector2(3, -4).divideScalar(0);
      expect(divided.x).toBe(Infinity);
      expect(divided.y).toBe(-Infinity);
    });

    it('reports unequal for vectors differing in a single component', () => {
      expect(new Vector2(1, 2).equals({ x: 1, y: 2.0000001 })).toBe(false);
    });

    it('reads `undefined` past the end of a short array — NOT NaN, and not a throw', () => {
      // Worth pinning: the field is typed `number`, so a short array yields a value that passes
      // every numeric type check and then poisons arithmetic downstream as NaN.
      const short = new Vector2().fromArray([7]);
      expect(short.x).toBe(7);
      expect(short.y).toBeUndefined();
      expect(Number.isNaN(short.length())).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('defaults to the origin and sets both components', () => {
      expect(new Vector2()).toMatchObject({ x: 0, y: 0 });
      expect(new Vector2().setScalar(3)).toMatchObject({ x: 3, y: 3 });
    });

    it('adds and subtracts, in place and into a target', () => {
      expect(new Vector2(1, 2).add({ x: 10, y: 20 })).toMatchObject({ x: 11, y: 22 });
      expect(new Vector2(1, 2).sub({ x: 10, y: 20 })).toMatchObject({ x: -9, y: -18 });
      expect(new Vector2().addVectors({ x: 1, y: 2 }, { x: 3, y: 4 })).toMatchObject({ x: 4, y: 6 });
      expect(new Vector2().subVectors({ x: 1, y: 2 }, { x: 3, y: 4 })).toMatchObject({ x: -2, y: -2 });
    });

    it('scales and negates', () => {
      expect(new Vector2(2, -3).multiplyScalar(2.5)).toMatchObject({ x: 5, y: -7.5 });
      expect(new Vector2(2, -3).divideScalar(2)).toMatchObject({ x: 1, y: -1.5 });
      expect(new Vector2(2, -3).negate()).toMatchObject({ x: -2, y: 3 });
    });

    it('measures length, squared length and distance', () => {
      expect(new Vector2(3, 4).length()).toBe(5);
      expect(new Vector2(3, 4).lengthSq()).toBe(25);
      expect(new Vector2(1, 1).distanceTo({ x: 4, y: 5 })).toBe(5);
      expect(new Vector2(1, 1).distanceToSquared({ x: 4, y: 5 })).toBe(25);
    });

    it('normalizes to unit length, preserving direction', () => {
      const unit = new Vector2(0, -8).normalize();
      expect(unit.length()).toBeCloseTo(1, 12);
      expect(unit).toMatchObject({ x: 0, y: -1 });
    });

    it('signs the cross product by which side the other vector is on', () => {
      const x = new Vector2(1, 0);
      expect(x.cross({ x: 0, y: 1 })).toBe(1); // counter-clockwise
      expect(x.cross({ x: 0, y: -1 })).toBe(-1); // clockwise
      expect(x.cross({ x: 2, y: 0 })).toBe(0); // collinear
    });

    it('dots to zero for perpendicular vectors', () => {
      expect(new Vector2(3, 4).dot({ x: 4, y: -3 })).toBe(0);
      expect(new Vector2(3, 4).dot({ x: 3, y: 4 })).toBe(25);
    });

    it('lerps between endpoints, inclusive', () => {
      expect(new Vector2(0, 0).lerp({ x: 10, y: 20 }, 0)).toMatchObject({ x: 0, y: 0 });
      expect(new Vector2(0, 0).lerp({ x: 10, y: 20 }, 0.25)).toMatchObject({ x: 2.5, y: 5 });
      expect(new Vector2(0, 0).lerp({ x: 10, y: 20 }, 1)).toMatchObject({ x: 10, y: 20 });
    });

    it('clones and copies without aliasing', () => {
      const source = new Vector2(1, 2);
      const clone = source.clone();
      clone.set(9, 9);
      expect(source).toMatchObject({ x: 1, y: 2 });
      expect(new Vector2().copy(source)).toMatchObject({ x: 1, y: 2 });
    });

    it('round-trips through an array at an offset', () => {
      const array = [0, 0, 0, 0];
      new Vector2(5, 6).toArray(array, 2);
      expect(array).toEqual([0, 0, 5, 6]);
      expect(new Vector2().fromArray(array, 2)).toMatchObject({ x: 5, y: 6 });
    });

    it('returns itself from mutators so calls chain', () => {
      const vector = new Vector2(1, 1);
      expect(vector.add({ x: 1, y: 1 }).multiplyScalar(2).negate()).toBe(vector);
      expect(vector).toMatchObject({ x: -4, y: -4 });
    });
  });
});
