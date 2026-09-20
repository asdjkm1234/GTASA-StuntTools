import { describe, expect, it } from 'vitest';

import { TouchInputSource } from './touch-input-source';

describe('TouchInputSource', () => {
  describe('negative cases', () => {
    it('is neutral before any input', () => {
      const source = new TouchInputSource();
      expect(source.move()).toEqual({ x: 0, y: 0 });
      expect(source.isActive('jump')).toBe(false);
      expect(source.isActive('run')).toBe(false);
      expect(source.consumeLook()).toEqual({ x: 0, y: 0 });
      expect(source.consumeZoom()).toBe(0);
    });

    it('does not run below the move threshold', () => {
      const source = new TouchInputSource();
      source.setMove(0.5, 0.5); // magnitude ≈ 0.71 < 0.85
      expect(source.isActive('run')).toBe(false);
    });

    it('does not walk with the stick at rest, nor at full deflection', () => {
      const source = new TouchInputSource();
      expect(source.isActive('walk')).toBe(false);
      source.setMove(0, 1);
      expect(source.isActive('walk')).toBe(false); // full deflection is the run gait
    });

    it('a held sprint button overrides the partial-deflection walk', () => {
      const source = new TouchInputSource();
      source.setMove(0.5, 0.5);
      source.setAction('sprint', true);
      expect(source.isActive('walk')).toBe(false);
      expect(source.isActive('sprint')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('exposes the move vector and runs at full deflection', () => {
      const source = new TouchInputSource();
      source.setMove(0, 1);
      expect(source.move()).toEqual({ x: 0, y: 1 });
      expect(source.isActive('run')).toBe(true); // magnitude 1 > 0.85
    });

    it('a partial deflection walks (the analog slow gait, 088/03)', () => {
      const source = new TouchInputSource();
      source.setMove(0.5, 0.5); // magnitude ≈ 0.71 ≤ 0.85
      expect(source.isActive('walk')).toBe(true);
    });

    it('holds and releases button actions', () => {
      const source = new TouchInputSource();
      source.setAction('jump', true);
      expect(source.isActive('jump')).toBe(true);
      source.setAction('jump', false);
      expect(source.isActive('jump')).toBe(false);
    });

    it('turns look-joystick deflection into a per-frame look delta that holds while deflected', () => {
      const source = new TouchInputSource();
      source.setLookRate(1, -0.5);
      const first = source.consumeLook();
      const second = source.consumeLook();
      expect(first).toEqual(second); // a rate holds (not cleared)
      expect(first.x).toBeGreaterThan(0);
      expect(first.y).toBeLessThan(0);

      source.setLookRate(0, 0); // release
      expect(source.consumeLook()).toEqual({ x: 0, y: 0 });
    });

    it('accumulates zoom and clears it on read', () => {
      const source = new TouchInputSource();
      source.addZoom(10);
      source.addZoom(5);
      expect(source.consumeZoom()).toBe(15);
      expect(source.consumeZoom()).toBe(0);
    });
  });
});
