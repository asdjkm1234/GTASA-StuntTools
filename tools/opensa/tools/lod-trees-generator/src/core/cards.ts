import type { Impostor } from './types';

/** Flat geometry arrays for the LOD card cage — fed into the game adapter's DFF encoder. */
export interface CardGeometry {
  positions: Float32Array;
  prelit: Uint8Array;
  triangles: { a: number; b: number; c: number }[];
  uvs: Float32Array;
}

/**
 * Build the crossed-billboard geometry from a baked {@link Impostor}: per card, a quad spanning its world
 * extents (tangent `u` around the trunk centre, absolute `z`), UV-mapped to its atlas tile. Prelit = the source
 * tree's average day colour ({@link Impostor.dayColor}) — the atlas is normalized (plan 012), so the mean
 * lighting level rides the vertices like on any stock prelit model.
 *
 * **One winding per card, not two.** Both faces are needed, but the IDE row already says
 * `DISABLE_BACKFACE_CULLING` (`map-placement/ide.ts` `DEFAULT_FLAGS`) and BOTH engines read that bit — real SA
 * on the model info, OpenSA in the weld. A mirrored copy therefore does not add a face, it draws the same one
 * twice: in a blend path with no depth write every partial-coverage texel composites twice (plan 013, cause 1),
 * and it doubles the impostor's triangles for nothing. 8 triangles per tree, not 16.
 */
export function buildCardGeometry(impostor: Impostor): CardGeometry {
  const cx = (impostor.bbox.min[0] + impostor.bbox.max[0]) / 2;
  const cy = (impostor.bbox.min[1] + impostor.bbox.max[1]) / 2;
  const { height, width } = impostor;
  const positions: number[] = [];
  const uvs: number[] = [];
  const triangles: { a: number; b: number; c: number }[] = [];

  let base = 0;
  for (const card of impostor.cards) {
    const tx = -Math.sin(card.angle);
    const ty = Math.cos(card.angle);
    const [uMin, uMax] = card.worldU;
    const [zMin, zMax] = card.worldZ;
    const uL = card.uvRect.x / width;
    const uR = (card.uvRect.x + card.uvRect.w) / width;
    const vT = card.uvRect.y / height;
    const vB = (card.uvRect.y + card.uvRect.h) / height;

    // Corners: 0 = (uMin,zMax) TL, 1 = (uMax,zMax) TR, 2 = (uMin,zMin) BL, 3 = (uMax,zMin) BR.
    positions.push(cx + tx * uMin, cy + ty * uMin, zMax);
    positions.push(cx + tx * uMax, cy + ty * uMax, zMax);
    positions.push(cx + tx * uMin, cy + ty * uMin, zMin);
    positions.push(cx + tx * uMax, cy + ty * uMax, zMin);
    uvs.push(uL, vT, uR, vT, uL, vB, uR, vB);

    // Two triangles, one winding — the row's DISABLE_BACKFACE_CULLING supplies the back face.
    triangles.push({ a: base, b: base + 1, c: base + 2 }, { a: base + 2, b: base + 1, c: base + 3 });
    base += 4;
  }

  const prelit = new Uint8Array((positions.length / 3) * 4);
  for (let v = 0; v < positions.length / 3; v += 1) {
    prelit.set(impostor.dayColor, v * 4);
  }

  return {
    positions: new Float32Array(positions),
    prelit,
    triangles,
    uvs: new Float32Array(uvs),
  };
}
