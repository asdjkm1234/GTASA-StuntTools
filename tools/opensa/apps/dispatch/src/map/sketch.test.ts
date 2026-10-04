import { describe, expect, it } from 'vitest';

import { formatArea, formatLength, measure, polygonArea, polylineLength, SketchStore } from './sketch';

describe('sketch geometry', () => {
  describe('negative cases', () => {
    it('measures nothing for a polygon that is not yet a triangle', () => {
      expect(
        polygonArea([
          [0, 0],
          [100, 0],
        ]),
      ).toBe(0);
    });

    it('measures nothing for a line with one end', () => {
      expect(polylineLength([[0, 0]], false)).toBe(0);
    });

    it('does not close a two-point ring — there is no area between two points', () => {
      expect(
        polylineLength(
          [
            [0, 0],
            [100, 0],
          ],
          true,
        ),
      ).toBe(100);
    });
  });

  describe('positive cases', () => {
    it('sums a polyline segment by segment', () => {
      expect(
        polylineLength(
          [
            [0, 0],
            [300, 0],
            [300, 400],
          ],
          false,
        ),
      ).toBe(700);
    });

    it('closes a ring when asked, adding the segment back to the first point', () => {
      expect(
        polylineLength(
          [
            [0, 0],
            [300, 0],
            [300, 400],
          ],
          true,
        ),
      ).toBe(1200);
    });

    it('takes a square kilometre out of a square, whichever way it was wound', () => {
      const clockwise = [
        [0, 0],
        [0, 1000],
        [1000, 1000],
        [1000, 0],
      ] as const;

      expect(polygonArea(clockwise)).toBe(1_000_000);
      expect(polygonArea([...clockwise].reverse())).toBe(1_000_000);
    });

    it('reads a circle off its two taps', () => {
      const circle = measure({
        id: 'c',
        kind: 'circle',
        points: [
          [0, 0],
          [0, 250],
        ],
      });

      expect(circle.radius).toBe(250);
      expect(circle.area).toBeCloseTo(Math.PI * 250 * 250, 6);
      expect(circle.length).toBeCloseTo(2 * Math.PI * 250, 6);
    });

    it('shows metres under a kilometre and kilometres over it', () => {
      expect(formatLength(940)).toBe('940 m');
      expect(formatLength(1240)).toBe('1.24 km');
      expect(formatArea(24_500)).toBe('24,500 m²');
      expect(formatArea(2_400_000)).toBe('2.40 km²');
    });
  });
});

describe('SketchStore', () => {
  describe('negative cases', () => {
    it('ignores taps while no tool is active — the map still selects', () => {
      const store = new SketchStore();
      store.addPoint([0, 0]);

      expect(store.pending()).toBeNull();
      expect(store.shapes()).toEqual([]);
    });

    it('refuses to finish a polygon that is still a line', () => {
      const store = new SketchStore();
      store.setTool('area');
      store.addPoint([0, 0]);
      store.addPoint([100, 0]);
      store.finish();

      expect(store.shapes()).toEqual([]);
      expect(store.pending()?.points).toHaveLength(2);
    });

    it('drops an unfinishable shape when the tool changes rather than carrying it into the next one', () => {
      const store = new SketchStore();
      store.setTool('area');
      store.addPoint([0, 0]);
      store.setTool('ruler');

      expect(store.pending()).toBeNull();
      expect(store.shapes()).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('finishes a circle on its second tap — there is nothing more to say about one', () => {
      const store = new SketchStore();
      store.setTool('circle');
      store.addPoint([0, 0]);
      store.addPoint([0, 300]);

      expect(store.shapes()).toHaveLength(1);
      expect(store.pending()).toBeNull();
      expect(store.measurement()?.radius).toBe(300);
    });

    it('measures the shape in progress, so the number moves as the operator taps', () => {
      const store = new SketchStore();
      store.setTool('ruler');
      store.addPoint([0, 0]);
      store.addPoint([500, 0]);

      expect(store.measurement()?.length).toBe(500);

      store.addPoint([500, 500]);

      expect(store.measurement()?.length).toBe(1000);
    });

    it('keeps the last finished measurement on screen once the shape is closed', () => {
      const store = new SketchStore();
      store.setTool('area');
      store.addPoint([0, 0]);
      store.addPoint([0, 200]);
      store.addPoint([200, 200]);
      store.finish();

      expect(store.pending()).toBeNull();
      expect(store.measurement()?.area).toBe(20_000);
    });

    it('undoes one tap, then one whole shape', () => {
      const store = new SketchStore();
      store.setTool('ruler');
      store.addPoint([0, 0]);
      store.addPoint([100, 0]);
      store.finish();
      store.addPoint([0, 0]);
      store.undo();

      expect(store.pending()).toBeNull();
      expect(store.shapes()).toHaveLength(1);

      store.undo();

      expect(store.shapes()).toEqual([]);
    });

    it('clears everything, drawn and being drawn', () => {
      const store = new SketchStore();
      store.setTool('ruler');
      store.addPoint([0, 0]);
      store.addPoint([100, 0]);
      store.finish();
      store.addPoint([50, 50]);
      store.clear();

      expect(store.shapes()).toEqual([]);
      expect(store.pending()).toBeNull();
      expect(store.measurement()).toBeNull();
    });
  });
});
