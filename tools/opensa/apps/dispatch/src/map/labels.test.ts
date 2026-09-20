import { describe, expect, it } from 'vitest';

import { CollisionIndex, labelCandidates, labelCeiling, labelRank } from './labels';

const CHIP = { height: 18, width: 80 };

function box(x: number, y: number): { height: number; width: number; x: number; y: number } {
  return { ...CHIP, x, y };
}

describe('CollisionIndex', () => {
  describe('negative cases', () => {
    it('refuses a box that overlaps one already placed', () => {
      const index = new CollisionIndex(400, 300);

      expect(index.place(box(100, 100))).toBe(true);
      expect(index.place(box(140, 108))).toBe(false);
    });

    it('refuses a box that hangs off the canvas — half a label is not a label', () => {
      const index = new CollisionIndex(400, 300);

      expect(index.place(box(-4, 100))).toBe(false);
      expect(index.place(box(340, 100))).toBe(false);
      expect(index.place(box(100, 295))).toBe(false);
    });

    it('answers null when every candidate anchor is taken', () => {
      const index = new CollisionIndex(400, 300);
      for (const candidate of labelCandidates(200, 150, CHIP.width, CHIP.height, 26)) {
        index.place(candidate);
      }

      expect(index.placeFirst(labelCandidates(200, 150, CHIP.width, CHIP.height, 26))).toBeNull();
    });

    it('cannot place more labels than the viewport could hold', () => {
      const index = new CollisionIndex(400, 300);
      for (let i = 0; i < 500; i += 1) {
        index.place(box((i * 7) % 380, (i * 11) % 280));
      }

      expect(index.placed).toBeLessThanOrEqual(labelCeiling(400, 300, CHIP.width, CHIP.height));
    });
  });

  describe('positive cases', () => {
    it('places boxes that only touch at the edge', () => {
      const index = new CollisionIndex(400, 300);

      expect(index.place(box(100, 100))).toBe(true);
      expect(index.place(box(180, 100))).toBe(true);
    });

    it('places boxes far apart without them knowing about each other', () => {
      const index = new CollisionIndex(1000, 800);

      expect(index.place(box(10, 10))).toBe(true);
      expect(index.place(box(900, 700))).toBe(true);
      expect(index.placed).toBe(2);
    });

    it('falls back to the next anchor when the first is taken', () => {
      const index = new CollisionIndex(400, 300);
      const [above] = labelCandidates(200, 150, CHIP.width, CHIP.height, 26);
      index.place(above);
      const placed = index.placeFirst(labelCandidates(200, 150, CHIP.width, CHIP.height, 26));

      expect(placed).not.toBeNull();
      expect(placed?.y).toBeGreaterThan(above.y); // it went below instead
    });

    it('offers above, below, right then left', () => {
      const [above, below, right, left] = labelCandidates(200, 150, 80, 18, 26);

      expect(above.y).toBeLessThan(150);
      expect(below.y).toBeGreaterThan(150);
      expect(right.x).toBeGreaterThan(200);
      expect(left.x).toBeLessThan(200);
    });
  });
});

describe('labelRank', () => {
  describe('negative cases', () => {
    it('never lets distance outrank a band — a far worst-priority call beats a near patrol', () => {
      const farCall = labelRank({ depth: 9000, kind: 'incident', priority: 1, selected: false });
      const nearUnit = labelRank({ depth: 1, kind: 'unit', selected: false, status: 'available' });

      expect(farCall).toBeLessThan(nearUnit);
    });
  });

  describe('positive cases', () => {
    it('puts the selection first, whatever it is', () => {
      const selected = labelRank({ depth: 9000, kind: 'unit', selected: true, status: 'busy' });

      expect(selected).toBeLessThan(labelRank({ depth: 1, kind: 'incident', priority: 1, selected: false }));
    });

    it('orders calls worst priority first', () => {
      const worst = labelRank({ depth: 100, kind: 'incident', priority: 1, selected: false });
      const least = labelRank({ depth: 100, kind: 'incident', priority: 3, selected: false });

      expect(worst).toBeLessThan(least);
    });

    it('puts a committed unit above a free one', () => {
      const enRoute = labelRank({ depth: 100, kind: 'unit', selected: false, status: 'enRoute' });
      const available = labelRank({ depth: 100, kind: 'unit', selected: false, status: 'available' });

      expect(enRoute).toBeLessThan(available);
    });

    it('breaks a tie by distance from the eye', () => {
      const near = labelRank({ depth: 50, kind: 'unit', selected: false, status: 'onScene' });
      const far = labelRank({ depth: 900, kind: 'unit', selected: false, status: 'onScene' });

      expect(near).toBeLessThan(far);
    });

    it('states a ceiling that shrinks with the screen — one rule for a phone and a desk', () => {
      expect(labelCeiling(360, 640, 80, 18)).toBeLessThan(labelCeiling(1920, 1080, 80, 18));
    });
  });
});
