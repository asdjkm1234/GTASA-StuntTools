/**
 * SA sprite quirks (B6). Two of them cost a field round each, so they live here as named facts rather than
 * as a line buried in a host.
 */

/** Below this an alpha byte counts as real transparency (the same 250 cut the vehicle textures use). */
const ALPHA_CUT = 250;

/**
 * SA's glow sprites carry their SHAPE in RGB on a black field and leave the alpha channel at 255 —
 * `coronastar`, `coronamoon` and several effectsPC sprites all do. Sampled naively that is a fully OPAQUE
 * SQUARE: the moon renders as a featureless white disc, a street lamp's corona as a white ball.
 *
 * Where a sprite has no authored transparency, derive its alpha from its luminance, so every consumer
 * downstream can simply trust the alpha channel. Mutates in place; leaves genuinely alpha-shaped sprites
 * (the smoke puffs, which DO have real alpha) untouched.
 */
export function normalizeSpriteAlpha(rgba: Uint8Array): void {
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] < ALPHA_CUT) {
      return;
    }
  }
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at + 3] = Math.round(0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]);
  }
}
