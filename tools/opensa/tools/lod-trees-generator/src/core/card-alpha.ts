import type { HdTree, Impostor } from './types';

import { canopyMass, cardTriangles, compositeOver, hdTriangles, renderProbe } from './probe';

/**
 * How opaque each card of a STACKED impostor may be — solved per tree against its own HD (plan 013 step 06).
 *
 * A target whose alpha class composites the crossed cards (real SA draws the impostor in its sorted pass
 * whatever the IDE flags say) sees every card of the cage at once, so a cage whose cards each carry the
 * canopy's full coverage reads far denser than the tree: measured ×1.36 and ×1.30 on the plan's two
 * reference trees. Thinning each card fixes it, and the factor may not be a constant — it depends on how
 * much of ITS OWN canopy each tree's cards cover, so the bake solves it per tree by rendering both.
 *
 * The probe is taken BETWEEN two cards (the angle where the stack is deepest) and at the size the tree has
 * on screen at the LOD switch, with the target's own alpha reference — below which SA discards a texel
 * rather than fading it, which is what puts a floor under the answer.
 */

/** Tree height in pixels at the LOD switch — SA's ~70° fov, 900 px viewport, a ~15 m tree at 150 units. */
const PROBE_PX = 64;
/** Bisection bounds and steps: 8 halvings of [0.4, 1] resolve the factor to ~0.002. */
const MIN_ALPHA = 0.4;
const STEPS = 8;

/** Scale every atlas texel's alpha in place (the gamma atlas is its own encode, so only that target moves). */
export function applyCardAlpha(impostor: Impostor, scale: number): void {
  if (scale >= 1) {
    return;
  }
  for (let i = 3; i < impostor.image.length; i += 4) {
    impostor.image[i] = Math.round(impostor.image[i] * scale);
  }
}

/**
 * The per-card alpha at which the composited cage covers what the HD covers, in `[MIN_ALPHA, 1]`.
 * `reference` is the target's alpha test (SA tests the impostor row at 100/255).
 */
export function solveCardAlpha(tree: HdTree, impostor: Impostor, reference: number): number {
  // Between two cards: with N cards at π/N the deepest stack sits half a step off a card normal.
  const azimuth = Math.PI / (2 * impostor.cards.length);
  const target = canopyMass(renderProbe(hdTriangles(tree), tree.bbox, azimuth, PROBE_PX, reference));
  if (target === 0) {
    return 1;
  }

  const massAt = (scale: number): number => {
    const scaled = withScaledAlpha(impostor, scale);
    const layers = cardTriangles(scaled).map((card) => renderProbe(card, tree.bbox, azimuth, PROBE_PX, reference));

    return canopyMass(compositeOver(layers));
  };
  if (massAt(1) <= target) {
    return 1; // already at or under the tree — nothing to thin
  }

  let low = MIN_ALPHA;
  let high = 1;
  for (let step = 0; step < STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (massAt(mid) > target) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return (low + high) / 2;
}

/** A copy of the impostor whose atlas alpha is scaled — the solver may not mutate what it is measuring. */
function withScaledAlpha(impostor: Impostor, scale: number): Impostor {
  const image = new Uint8Array(impostor.image);
  for (let i = 3; i < image.length; i += 4) {
    image[i] = Math.round(image[i] * scale);
  }

  return { ...impostor, image };
}
