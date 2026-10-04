import { describe, expect, it } from 'vitest';

import type { HdTree, Vec3 } from './types';

import { applyCardAlpha, solveCardAlpha } from './card-alpha';
import { canopyMass, cardTriangles, compositeOver, hdTriangles, renderProbe } from './probe';
import { renderImpostor } from './render';

/** SA's own reference for the impostor row — what the solver works to. */
const REFERENCE = 100 / 255;
const CONFIG = { aspectThreshold: 2, blendCards: 3, cards: 4, drawDistance: 1500, superSample: 2, textureSize: 128 };

/** Canopy mass of the cage composited as a sorted blend pass, from between two cards. */
function compositeMass(tree: HdTree, impostor: ReturnType<typeof renderImpostor>): number {
  const azimuth = Math.PI / (2 * impostor.cards.length);
  const layers = cardTriangles(impostor).map((card) => renderProbe(card, tree.bbox, azimuth, 64, REFERENCE));

  return canopyMass(compositeOver(layers));
}

/** A leafy tree: opaque quads scattered through a cylinder, so its projection has GAPS like a canopy does.
 *  Deterministic (a fixed LCG), because a solver that renders must be measured against the same tree twice. */
function leafyTree(leaves = 90): HdTree {
  const triangles: HdTree['triangles'] = [];
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;

    return seed / 2147483648;
  };
  for (let i = 0; i < leaves; i += 1) {
    const angle = next() * Math.PI * 2;
    const radius = 1 + next() * 3;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = 3 + next() * 5;
    const s = 0.35;
    const a: Vec3 = [x - s, y, z - s];
    const b: Vec3 = [x + s, y, z - s];
    const c: Vec3 = [x + s, y, z + s];
    const d: Vec3 = [x - s, y, z + s];
    triangles.push(
      {
        colors: null,
        positions: [a, b, c],
        texture: null,
        uvs: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      },
      {
        colors: null,
        positions: [a, c, d],
        texture: null,
        uvs: [
          [0, 0],
          [1, 1],
          [0, 1],
        ],
      },
    );
  }

  return { bbox: { max: [4, 4, 8], min: [-4, -4, 0] }, name: 'leafy', textures: new Map(), triangles };
}

describe('solveCardAlpha', () => {
  describe('negative cases', () => {
    it('leaves an empty cage alone — there is nothing to thin', () => {
      const tree = leafyTree();
      const impostor = renderImpostor(tree, { ...CONFIG, cards: 3 });
      impostor.image.fill(0);

      expect(solveCardAlpha(tree, impostor, REFERENCE)).toBe(1);
    });

    it('never returns above 1 — a cage may be thinned, never strengthened', () => {
      const tree = leafyTree(8); // a sparse tree: three cards of it cover less than the tree itself
      const impostor = renderImpostor(tree, { ...CONFIG, cards: 3 });

      expect(solveCardAlpha(tree, impostor, REFERENCE)).toBeLessThanOrEqual(1);
    });
  });

  describe('positive cases', () => {
    it('thins a stacked cage until it covers what the tree covers', () => {
      const tree = leafyTree();
      const impostor = renderImpostor(tree, { ...CONFIG, cards: 3 });
      const hd = canopyMass(renderProbe(hdTriangles(tree), tree.bbox, Math.PI / 6, 64, REFERENCE));

      expect(compositeMass(tree, impostor) / hd).toBeGreaterThan(1.1); // the cage over-covers before

      const scale = solveCardAlpha(tree, impostor, REFERENCE);
      expect(scale).toBeLessThan(1);
      applyCardAlpha(impostor, scale);

      expect(compositeMass(tree, impostor) / hd).toBeCloseTo(1, 1);
    });

    it('applies the scale to the gamma atlas only — the linear sidecar is a separate encode', () => {
      const tree = leafyTree(20);
      const impostor = renderImpostor(tree, { ...CONFIG, cards: 3 });
      const linear = new Uint8Array(impostor.imageLinear);
      applyCardAlpha(impostor, 0.5);

      expect(impostor.imageLinear).toEqual(linear);
    });
  });
});
