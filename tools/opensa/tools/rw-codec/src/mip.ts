/**
 * Mipmap downsampling on tightly-packed RGBA buffers (plan 010). A 2×2 box average per level, halving each
 * dimension (min 1), down to 1×1. RGB is **alpha-weighted** (Σ rgb·a / Σ a): transparent texels' RGB carries
 * background garbage (white/black fill under alpha-cutout foliage, impostor atlas padding), and a plain
 * average bleeds it into the visible texels — every mip level gets progressively LIGHTER/washed out (the
 * lod-procobj joshua / lod-trees far-texture complaint). Alpha itself stays a plain average.
 *
 * `math` picks the colour space of the average — it must match the TARGET RENDERER, not taste
 * (lod-trees plan 012):
 * - `'linear'` — sRGB → linear → mean → sRGB. Modern linear pipelines (OpenSA/three.js) decode sRGB
 *   textures before filtering; averaging raw bytes instead darkens mid-tones ~15–20 %.
 * - `'gamma'`  — plain byte mean. Real SA (RenderWare/D3D9 era) samples and filters textures in gamma
 *   space; linear-averaged mips render LIGHTER than the HD next to them there.
 */

/** Which renderer convention the averages target (see module doc). */
export type MipColorMath = 'gamma' | 'linear';

/** One RGBA level: tightly-packed `width * height * 4` bytes. */
export interface MipLevel {
  data: Uint8Array;
  height: number;
  width: number;
}

/** sRGB byte → linear (LUT) — the space the `'linear'` average happens in. */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, byte) => {
  const c = byte / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** The full chain starting at the given base level (inclusive), down to 1×1. */
export function buildMipChain(base: Uint8Array, width: number, height: number, math: MipColorMath): MipLevel[] {
  const levels: MipLevel[] = [{ data: base, height, width }];
  let current = levels[0];
  while (current.width > 1 || current.height > 1) {
    current = downsample(current.data, current.width, current.height, math);
    levels.push(current);
  }

  return levels;
}

/** Halve an RGBA image (2×2 box; alpha-weighted RGB in the `math` colour space), dimensions floored at 1. */
export function downsample(rgba: Uint8Array, width: number, height: number, math: MipColorMath): MipLevel {
  const dstWidth = Math.max(1, width >> 1);
  const dstHeight = Math.max(1, height >> 1);
  const data = new Uint8Array(dstWidth * dstHeight * 4);
  const linear = math === 'linear';

  for (let y = 0; y < dstHeight; y += 1) {
    for (let x = 0; x < dstWidth; x += 1) {
      const x0 = Math.min(x * 2, width - 1);
      const x1 = Math.min(x * 2 + 1, width - 1);
      const y0 = Math.min(y * 2, height - 1);
      const y1 = Math.min(y * 2 + 1, height - 1);
      const at = [(y0 * width + x0) * 4, (y0 * width + x1) * 4, (y1 * width + x0) * 4, (y1 * width + x1) * 4];
      const dst = (y * dstWidth + x) * 4;
      const alphaSum = at.reduce((sum, index) => sum + rgba[index + 3], 0);
      for (let c = 0; c < 3; c += 1) {
        // Alpha-weighted colour; a fully-transparent quad keeps the plain average (nothing visible to weight).
        const value = (index: number): number => (linear ? SRGB_TO_LINEAR[rgba[index + c]] : rgba[index + c]);
        const mean =
          alphaSum > 0
            ? at.reduce((sum, index) => sum + value(index) * rgba[index + 3], 0) / alphaSum
            : at.reduce((sum, index) => sum + value(index), 0) / 4;
        data[dst + c] = linear ? linearToSrgbByte(mean) : Math.round(mean);
      }
      data[dst + 3] = Math.round(alphaSum / 4);
    }
  }

  return { data, height: dstHeight, width: dstWidth };
}

/** Linear 0–1 → sRGB byte. */
function linearToSrgbByte(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;

  return Math.round(srgb * 255);
}
