import type { TreeLodConfig } from './core';

/** Default bake knobs (overridable via `--tex` / `--cards` / `--draw`). Tuned per the SA reference (`lodCedar1_hi`). */
export const config: TreeLodConfig = {
  // Trees taller than 2× their width bake into a portrait (width × 2*width) atlas so vertical detail isn't
  // squashed into a square tile. Below this they stay square.
  aspectThreshold: 2,
  // 4 for the class that unions the cards, 3 for the class that stacks them: measured against the HD's own
  // canopy at the LOD switch — 4 cards are ×0.97 of it in a cutout pass and ×1.36 in SA's sorted blend,
  // where 3 thinned cards land at ×1.00 and cost a quarter less overdraw (plan 013 step 06).
  blendCards: 3,
  cards: 4,
  drawDistance: 1500,
  // 2×2 sub-samples per atlas texel. Measured on the plan-013 reference trees: it takes the isolated-texel
  // share (the white speckle) from 6.0 %/3.7 % to under 1 % together with the mip-aware sampling, at ~4× the
  // bake — 4×4 buys another fraction of a percent for 4× more (`docs/benchmarks/`).
  superSample: 2,
  // 128 px DXT5 per tree — matches the reference LOD mod and keeps the shared TXD small enough for SA to load
  // (256 px would be ~4× larger). Override with `--tex` if you accept a bigger TXD.
  textureSize: 128,
};
