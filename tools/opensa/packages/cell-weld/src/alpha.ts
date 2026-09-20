/**
 * The offline ALPHA PIPELINE (plan 074/03) — where the alpha-edge open issue dies:
 *   classify → dilate (flood transparent texels' RGB from nearest opaque) → premultiply →
 *   alpha-weighted mip chain with per-mip COVERAGE PRESERVATION for cutouts.
 * Pure RGBA8 raster ops (Uint8Array, row-major, no padding) — unit-tested without any GPU.
 */

export type AlphaClass = 'cutout' | 'opaque' | 'softBlend';

/** Classify by alpha histogram: all ≈255 → opaque; bimodal (≤2 % mid values) → cutout; else soft blend. */
export function classifyAlpha(rgba: Uint8Array, hasAlphaFlag: boolean): AlphaClass {
  if (!hasAlphaFlag) {
    return 'opaque';
  }
  let mid = 0;
  let transparent = 0;
  const texels = rgba.length / 4;
  for (let index = 3; index < rgba.length; index += 4) {
    const alpha = rgba[index];
    if (alpha < 250 && alpha > 5) {
      mid += 1;
    }
    if (alpha <= 5) {
      transparent += 1;
    }
  }
  if (transparent === 0 && mid === 0) {
    return 'opaque';
  }

  return mid / texels <= 0.02 ? 'cutout' : 'softBlend';
}

/** Half-width of the transition band around the alpha-test reference — texels inside it are the EDGE. */
const MASK_BAND = 48;
/** A mask must populate both sides of the test, and spend at most this share of its texels ON it. */
const MASK_SIDE = 0.05;
const MASK_EDGE = 0.1;

/** Fraction of texels whose alpha passes `reference` (the A2C coverage metric). */
export function coverage(rgba: Uint8Array, reference: number): number {
  let passing = 0;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] >= reference) {
      passing += 1;
    }
  }

  return passing / (rgba.length / 4);
}

/** Flood every transparent texel's RGB from its nearest opaque neighbour (full BFS — a capped pass count
 *  left leaf-gap black and the mips re-bled it; learned in the open issue). In place. */
export function dilateEdges(rgba: Uint8Array, width: number, height: number): void {
  const queue: number[] = [];
  const visited = new Uint8Array(width * height);
  const total = width * height;
  for (let texel = 0; texel < total; texel += 1) {
    if (rgba[texel * 4 + 3] > 5) {
      visited[texel] = 1;
      queue.push(texel);
    }
  }
  if (queue.length === 0 || queue.length === width * height) {
    return;
  }
  // Array iterators visit indexes appended during iteration — the BFS frontier grows in place.
  for (const texel of queue) {
    const x = texel % width;
    const y = (texel / width) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const neighbour = ny * width + nx;
      if (visited[neighbour]) {
        continue;
      }
      visited[neighbour] = 1;
      rgba[neighbour * 4] = rgba[texel * 4];
      rgba[neighbour * 4 + 1] = rgba[texel * 4 + 1];
      rgba[neighbour * 4 + 2] = rgba[texel * 4 + 2];
      queue.push(neighbour);
    }
  }
}

/** One 2×-downsample step. Premultiplied data makes the PLAIN average correct for RGB; alpha averages too. */
export function downsample(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const outWidth = Math.max(1, width >> 1);
  const outHeight = Math.max(1, height >> 1);
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x * 2 + 1);
      const y0 = Math.min(height - 1, y * 2);
      const y1 = Math.min(height - 1, y * 2 + 1);
      for (let channel = 0; channel < 4; channel += 1) {
        const sum =
          rgba[(y0 * width + x0) * 4 + channel] +
          rgba[(y0 * width + x1) * 4 + channel] +
          rgba[(y1 * width + x0) * 4 + channel] +
          rgba[(y1 * width + x1) * 4 + channel];
        out[(y * outWidth + x) * 4 + channel] = Math.round(sum / 4);
      }
    }
  }

  return out;
}

/**
 * The final class, from two independent upgrades of a softBlend verdict (opaque/cutout are already right):
 *
 * - `mask` — the texture itself is alpha-tested geometry ({@link isAlphaMask}), whoever draws it. This is
 *   the general rule; it needs no caller and no name.
 * - `preferCutout` — the VEGETATION welds' request, which survives the general rule because it covers the
 *   case the histogram cannot reach: a mod canopy authored at alpha ≈ 0.5 EVERYWHERE is not mask-shaped, yet
 *   vanilla alpha-tests foliage regardless (074, trees showed through trees). Those textures are the ones
 *   that then need {@link sharpenAlpha}; a mask has a thin edge already and keeps its authored alpha.
 */
export function effectiveAlphaClass(classified: AlphaClass, preferCutout: boolean, mask = false): AlphaClass {
  return (preferCutout || mask) && classified === 'softBlend' ? 'cutout' : classified;
}

/**
 * Is this texture an alpha MASK — geometry the game alpha-TESTS — rather than a translucent surface?
 * (plan 092, the field bug: the Watts Towers' lattice showed its own far side through the near one.)
 *
 * {@link classifyAlpha} reads the histogram against 0 and 255, which asks the wrong question: a chain-link
 * mesh whose holes sit at alpha ≈ 10 has no FULLY transparent texel, while a soft shadow is mostly fully
 * transparent around its blob. What decides the look is the alpha TEST vanilla applies at `reference`: a
 * mask commits its texels to one SIDE of it and spends only a thin antialiased edge on it — and that edge is
 * what alpha-to-coverage exists to render. A true blend either washes across the reference (glass, a shadow
 * ramp) or lives entirely on one side of it (a uniform film).
 *
 * The 10 % edge bound is the KNEE of the measured distribution over the map's 2 201 two-sided soft-blend
 * textures (bins fall 564 → 553 → 340 → 145 and then flatten), not a fit to any one texture.
 */
export function isAlphaMask(rgba: Uint8Array, reference = 128): boolean {
  let above = 0;
  let below = 0;
  const texels = rgba.length / 4;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] < reference - MASK_BAND) {
      below += 1;
    } else if (rgba[index] > reference + MASK_BAND) {
      above += 1;
    }
  }

  return below / texels >= MASK_SIDE && above / texels >= MASK_SIDE && (texels - above - below) / texels <= MASK_EDGE;
}

/** Alpha-test-style remap gain for UPGRADED cutouts: band 128 ± 128/gain stays a gradient (A2C antialiases
 *  it), everything outside snaps to 0/255 — vanilla SA alpha-tested this foliage at ~128. */
export const SHARPEN_GAIN = 8;

/** RGB ×= A — after this, filtering/blending are mathematically correct (the fringe fix's core). In place. */
export function premultiply(rgba: Uint8Array): void {
  for (let texel = 0; texel < rgba.length; texel += 4) {
    const alpha = rgba[texel + 3] / 255;
    rgba[texel] = Math.round(rgba[texel] * alpha);
    rgba[texel + 1] = Math.round(rgba[texel + 1] * alpha);
    rgba[texel + 2] = Math.round(rgba[texel + 2] * alpha);
  }
}

/** Scale a mip's alpha so its coverage matches `target` (the classic fix for foliage thinning with
 *  distance). Binary-search the scale; RGB stays premultiplied-consistent (it encodes ×original-alpha —
 *  the small mismatch is invisible; correctness of the CUT is what matters). In place. */
export function preserveCoverage(rgba: Uint8Array, reference: number, target: number): void {
  if (target <= 0) {
    return;
  }
  let low = 0.5;
  let high = 4;
  for (let step = 0; step < 12; step += 1) {
    const scale = (low + high) / 2;
    let passing = 0;
    for (let index = 3; index < rgba.length; index += 4) {
      if (Math.min(255, rgba[index] * scale) >= reference) {
        passing += 1;
      }
    }
    if (passing / (rgba.length / 4) < target) {
      low = scale;
    } else {
      high = scale;
    }
  }
  const scale = (low + high) / 2;
  for (let index = 3; index < rgba.length; index += 4) {
    rgba[index] = Math.min(255, Math.round(rgba[index] * scale));
  }
}

/** The full chain for one alpha texture: dilate → premultiply → mips (+ coverage preservation for cutouts).
 *  Returns mip levels (level 0 first), each tightly packed RGBA8. */
export function processAlphaTexture(
  rgba: Uint8Array,
  width: number,
  height: number,
  alphaClass: AlphaClass,
  cutoutRef = 128,
  mipCount = 1,
  sharpen = false,
): Uint8Array[] {
  const base: Uint8Array = new Uint8Array(rgba);
  if (sharpen) {
    sharpenAlpha(base, cutoutRef);
  }
  dilateEdges(base, width, height);
  premultiply(base);
  const targetCoverage = alphaClass === 'cutout' ? coverage(base, cutoutRef) : 0;
  const mips: Uint8Array[] = [base];
  let current = base;
  let w = width;
  let h = height;
  for (let level = 1; level < mipCount; level += 1) {
    current = downsample(current, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    if (alphaClass === 'cutout') {
      preserveCoverage(current, cutoutRef, targetCoverage);
    }
    mips.push(current);
  }

  return mips;
}

/**
 * Bilinear resample to pow2 (kills WebGPU BC alignment problems at the root; odd sizes like 62×62 — and the
 * real game's D3D9 refuses a DXT raster that is not block-aligned, `docs/restrictions/dxt-raster-dimensions.md`).
 * `round` picks the side: `'nearest'` (default) for our own downscaled atlases, `'up'` when the texels are an
 * author's and none may be lost. `maxSize` (0 = uncapped) then caps the longest edge — the `--max-texture`
 * lever that makes an RGBA8 pak affordable; it halves both axes together, so the aspect ratio survives.
 */
export function resampleToPow2(
  rgba: Uint8Array,
  width: number,
  height: number,
  round: 'nearest' | 'up' = 'nearest',
  maxSize = 0,
): {
  height: number;
  rgba: Uint8Array;
  width: number;
} {
  const pow2 = (value: number): number => 2 ** (round === 'up' ? Math.ceil : Math.round)(Math.log2(value));
  let outWidth = Math.max(4, pow2(width));
  let outHeight = Math.max(4, pow2(height));
  // `maxSize` (0 = uncapped) halves BOTH axes together until each fits, so a capped texture keeps its aspect
  // ratio — clamping the axes independently would squash every non-square sheet in the game.
  while (maxSize > 0 && (outWidth > maxSize || outHeight > maxSize) && (outWidth > 4 || outHeight > 4)) {
    outWidth = Math.max(4, outWidth >> 1);
    outHeight = Math.max(4, outHeight >> 1);
  }
  if (outWidth === width && outHeight === height) {
    return { height, rgba: new Uint8Array(rgba), width };
  }
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const sx = (x / (outWidth - 1)) * (width - 1);
      const sy = (y / (outHeight - 1)) * (height - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = rgba[(y0 * width + x0) * 4 + channel] * (1 - fx) + rgba[(y0 * width + x1) * 4 + channel] * fx;
        const bottom = rgba[(y1 * width + x0) * 4 + channel] * (1 - fx) + rgba[(y1 * width + x1) * 4 + channel] * fx;
        out[(y * outWidth + x) * 4 + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }

  return { height: outHeight, rgba: out, width: outWidth };
}

/** Steepen alpha around `reference` (in place). For preferCutout-upgraded textures whose alpha is broadly
 *  semi-transparent (hipoly mod canopies ≈ 0.5 everywhere): raw mid alpha through A2C = a uniform
 *  screen-door stipple over the whole crown, worsening down the mip chain. Run BEFORE premultiply so RGB
 *  scales by the remapped alpha. Naturally-bimodal cutouts are untouched by their callers. */
export function sharpenAlpha(rgba: Uint8Array, reference = 128, gain = SHARPEN_GAIN): void {
  for (let index = 3; index < rgba.length; index += 4) {
    rgba[index] = Math.max(0, Math.min(255, Math.round((rgba[index] - reference) * gain + reference)));
  }
}
