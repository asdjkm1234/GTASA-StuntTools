import { buildMipChain, downsample, type MipColorMath, type MipLevel } from '@opensa/rw-codec/mip';

import type { DecodedTexture, Rgba } from './types';

/**
 * A tiny software rasterizer: fills textured triangles into a shared RGBA image with a z-buffer + alpha. Used to
 * bake the impostor card views (orthographic, so UV/colour interpolate **affinely** — exact, no perspective
 * divide). Background stays α=0; the texture's own alpha drives the foliage cutout.
 *
 * The grid is **supersampled** (`samples` sub-samples per output texel on each axis) and the source texture is
 * sampled at the mip level matching one sub-sample's footprint: a 1024² leaf texture on a 256 px card packs a
 * ~16×16-texel footprint into one texel, and taking a single point of it is what left the atlas speckled with
 * isolated white twig texels (plan 013). {@link resolveRaster} folds the grid back down — the output texel's
 * alpha is its coverage, its colour the covered mean.
 */
export interface Raster {
  /** The real-SA (gamma) encoding: `tex × prelit/dayAvg` in raw sRGB bytes — on the SUB-SAMPLE grid. */
  color: Uint8Array;
  /** The OpenSA (linear) encoding of the SAME fragments — on the sub-sample grid. */
  colorLinear: Uint8Array;
  depth: Float32Array;
  /** Output height in texels (`sampleHeight / samples`). */
  height: number;
  sampleHeight: number;
  /** Sub-samples per output texel on each axis; a power of two (the resolve halves the grid). */
  samples: number;
  /** Sub-sample grid size — what {@link rasterizeTriangle} draws into and what pixel coordinates mean. */
  sampleWidth: number;
  /** Output width in texels (`sampleWidth / samples`). */
  width: number;
}

/** A triangle already projected to SUB-SAMPLE space: pixel `[x, y, depth]`, UV, and per-vertex colour (×3). */
export interface RasterTri {
  colors: [Rgba, Rgba, Rgba] | null;
  pixels: [Vec3px, Vec3px, Vec3px];
  uvs: [[number, number], [number, number], [number, number]];
}

type Vec3px = [number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];

/** Per-fragment scratch. The bake runs this loop `samples²` times per atlas texel over every triangle of a
 *  5 000-triangle tree, and allocating four small arrays per fragment there is most of its cost — measured
 *  1.7× on the reference trees. Written and consumed inside one call; nothing retains them. */
const SCRATCH_TEX: Rgba = [0, 0, 0, 0];
const SCRATCH_MIP: Rgba = [0, 0, 0, 0];
const SCRATCH_VC: Rgba = [0, 0, 0, 0];
const SCRATCH_GAMMA: Rgba = [0, 0, 0, 0];
const SCRATCH_LINEAR: Rgba = [0, 0, 0, 0];

/** The alpha at which a source texel counts as drawn — the same 0.5 the bake's own cutout uses. */
const CUTOUT_ALPHA = 128;

/** sRGB byte → linear (LUT): the space GPUs decode textures into before any math. */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, byte) => {
  const c = byte / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export function createRaster(width: number, height: number, samples = 1): Raster {
  if (!Number.isInteger(samples) || samples < 1 || (samples & (samples - 1)) !== 0) {
    throw new Error(`raster supersampling must be a power of two, got ${samples}`);
  }
  const sampleWidth = width * samples;
  const sampleHeight = height * samples;

  return {
    color: new Uint8Array(sampleWidth * sampleHeight * 4),
    colorLinear: new Uint8Array(sampleWidth * sampleHeight * 4),
    depth: new Float32Array(sampleWidth * sampleHeight).fill(-Infinity),
    height,
    sampleHeight,
    samples,
    sampleWidth,
    width,
  };
}

/** Rasterise one triangle. `alphaTest` (0–1) discards fragments below it (binary foliage cutout). */
export function rasterizeTriangle(
  raster: Raster,
  tri: RasterTri,
  texture: DecodedTexture | null,
  alphaTest: number,
  normalize: Rgba = WHITE,
): void {
  const [a, b, c] = tri.pixels;
  let area = edge(a, b, c);
  if (area === 0) {
    return; // degenerate
  }
  const flip = area < 0 ? -1 : 1;
  area *= flip;
  const lod = texture ? textureLod(tri, texture) : 0;

  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(raster.sampleWidth - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(raster.sampleHeight - 1, Math.ceil(Math.max(a[1], b[1], c[1])));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p: Vec3px = [x + 0.5, y + 0.5, 0];
      const w0 = edge(b, c, p) * flip;
      const w1 = edge(c, a, p) * flip;
      const w2 = edge(a, b, p) * flip;
      if (w0 < 0 || w1 < 0 || w2 < 0) {
        continue; // outside
      }
      const l0 = w0 / area;
      const l1 = w1 / area;
      const l2 = w2 / area;
      const depth = a[2] * l0 + b[2] * l1 + c[2] * l2;
      const di = y * raster.sampleWidth + x;
      if (depth <= raster.depth[di]) {
        continue; // behind an already-drawn fragment
      }

      const [gamma, linear] = blend(tri, texture, l0, l1, l2, normalize, lod);
      if (gamma[3] < alphaTest * 255) {
        continue; // cutout
      }
      raster.depth[di] = depth;
      const o = di * 4;
      raster.color[o] = gamma[0];
      raster.color[o + 1] = gamma[1];
      raster.color[o + 2] = gamma[2];
      raster.color[o + 3] = gamma[3];
      raster.colorLinear[o] = linear[0];
      raster.colorLinear[o + 1] = linear[1];
      raster.colorLinear[o + 2] = linear[2];
      raster.colorLinear[o + 3] = gamma[3];
    }
  }
}

/**
 * Fold the sub-sample grid down to the output image: an alpha-weighted box average per texel — the texel's
 * alpha is the sub-samples' coverage and its colour their covered mean, so a canopy edge lands as partial
 * coverage instead of a coin flip on the 0.5 test. The average is taken in each atlas's OWN convention
 * (gamma bytes for real SA, linear light for OpenSA — plan 012), which is what {@link downsample} already
 * does for the mip chain.
 */
export function resolveRaster(raster: Raster): { color: Uint8Array; colorLinear: Uint8Array } {
  return {
    color: reduce(raster.color, raster, 'gamma'),
    colorLinear: reduce(raster.colorLinear, raster, 'linear'),
  };
}

/**
 * The texture with the mip chain {@link rasterizeTriangle} samples, **memoised on the texture itself**.
 *
 * The memo is the point, not an optimisation: the stage hands ONE folder-wide texture map to every tree
 * (`io.loadTree` stores it verbatim), so a per-tree wrap rebuilds every chain in the folder per tree — 148
 * textures × 286 trees took the `trees` stage from 83 s to 32 min. Returning a copy is what made that
 * invisible, so this returns the same object.
 */
export function withMipChain(texture: DecodedTexture): DecodedTexture {
  if (texture.mips) {
    return texture;
  }
  // The chain is built over CUTOUT alpha (0 or 255), because `downsample` weights colour by alpha and the
  // atlas texel stands for the texels the cutout KEEPS. Weighting by raw alpha instead lets a leaf's
  // sub-threshold edge texels — dark, and never drawn — pull the mean down (measured: −6 green on
  // `sm_veg_tree7vbig`, plan 013 step 01). The alpha itself is still sampled from the base texture.
  const cutout = new Uint8Array(texture.rgba);
  for (let i = 3; i < cutout.length; i += 4) {
    cutout[i] = cutout[i] >= CUTOUT_ALPHA ? 255 : 0;
  }

  // Gamma math: the chain stands in for this rasterizer's own bilinear filter, which has always averaged raw
  // bytes for both encodings. The per-encoding difference lives in `blend`'s product (plan 012), not here.
  texture.mips = buildMipChain(cutout, texture.width, texture.height, 'gamma');

  return texture;
}

/** Bilinear sample of ONE mip level, with wrapping (matches the engine's RepeatWrapping), into `out`. */
function bilinear(level: MipLevel, u: number, v: number, out: Rgba): Rgba {
  const { data, height, width } = level;
  const fx = (u - Math.floor(u)) * width - 0.5;
  const fy = (v - Math.floor(v)) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;
  const ya = ((y0 % height) + height) % height;
  const yb = (ya + 1) % height;

  for (let c = 0; c < 4; c += 1) {
    const top = lerp(data[(ya * width + xa) * 4 + c], data[(ya * width + xb) * 4 + c], tx);
    const bottom = lerp(data[(yb * width + xa) * 4 + c], data[(yb * width + xb) * 4 + c], tx);
    out[c] = lerp(top, bottom, ty);
  }

  return out;
}

/**
 * Fragment colour = texture × the NORMALIZED prelit (`prelit / normalize`, where `normalize` is the tree's
 * average day prelit that instead rides the card VERTICES — plan 012). Only the per-texel variation lands
 * in the atlas, so the impostor behaves like a stock prelit model under any renderer multiplier. Emitted in
 * BOTH conventions at once:
 * - gamma (`[0]`): raw sRGB-byte product — what real SA's D3D9-era pipeline shows;
 * - linear (`[1]`): `lin2srgb(srgb2lin(tex) × factor)` — what OpenSA/three.js (linear pipeline) shows.
 * Alpha is coverage, not colour — a plain product, shared by both encodings.
 */
function blend(
  tri: RasterTri,
  texture: DecodedTexture | null,
  l0: number,
  l1: number,
  l2: number,
  normalize: Rgba,
  lod: number,
): [Rgba, Rgba] {
  const u = tri.uvs[0][0] * l0 + tri.uvs[1][0] * l1 + tri.uvs[2][0] * l2;
  const v = tri.uvs[0][1] * l0 + tri.uvs[1][1] * l1 + tri.uvs[2][1] * l2;
  const tex = texture ? sample(texture, u, v, lod) : WHITE;
  const vc = tri.colors ? lerpColor(tri.colors, l0, l1, l2) : WHITE;
  const alpha = (tex[3] * vc[3]) / 255;
  for (let c = 0; c < 3; c += 1) {
    const factor = vc[c] / Math.max(1, normalize[c]);
    SCRATCH_GAMMA[c] = Math.min(255, Math.round(tex[c] * factor));
    SCRATCH_LINEAR[c] = linearToSrgbByte(srgbToLinear(tex[c]) * factor);
  }
  SCRATCH_GAMMA[3] = alpha;
  SCRATCH_LINEAR[3] = alpha;

  return [SCRATCH_GAMMA, SCRATCH_LINEAR];
}

function edge(p: Vec3px, q: Vec3px, r: Vec3px): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(colors: [Rgba, Rgba, Rgba], l0: number, l1: number, l2: number): Rgba {
  for (let c = 0; c < 4; c += 1) {
    SCRATCH_VC[c] = colors[0][c] * l0 + colors[1][c] * l1 + colors[2][c] * l2;
  }

  return SCRATCH_VC;
}

/** Linear 0–1 → sRGB byte — the encoding the atlas is stored (and later sampled) in. */
function linearToSrgbByte(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;

  return Math.round(srgb * 255);
}

/** Halve the sub-sample grid until it is the output size (a no-op copy-free return when `samples === 1`). */
function reduce(data: Uint8Array, raster: Raster, math: MipColorMath): Uint8Array {
  let level: MipLevel = { data, height: raster.sampleHeight, width: raster.sampleWidth };
  while (level.width > raster.width) {
    level = downsample(level.data, level.width, level.height, math);
  }

  return level.data;
}

/**
 * COLOUR from the mip level matching the sub-sample footprint (trilinear between the two bracketing levels),
 * ALPHA from the base level.
 *
 * The split is not a shortcut, it is the measurement: the cutout decision has to stay at full resolution.
 * Alpha averaged down a mip chain and then put through the 0.5 test dissolves the canopy — 51 % → 20 % fill
 * on `sm_veg_tree5`, with the survivors MORE speckled than before (plan 013 step 01). Coverage is recovered
 * instead by the sub-samples, which vote on the same full-resolution decision `samples²` times per texel.
 */
function sample(texture: DecodedTexture, u: number, v: number, lod: number): Rgba {
  const levels = texture.mips;
  const base = bilinear({ data: texture.rgba, height: texture.height, width: texture.width }, u, v, SCRATCH_TEX);
  if (!levels || lod <= 0) {
    return base;
  }
  const clamped = Math.min(levels.length - 1, lod);
  const low = Math.floor(clamped);
  const high = Math.min(levels.length - 1, low + 1);
  const t = clamped - low;
  const alpha = base[3];
  const a = bilinear(levels[low], u, v, SCRATCH_TEX);
  if (high === low || t === 0) {
    base[3] = alpha;

    return base;
  }
  const b = bilinear(levels[high], u, v, SCRATCH_MIP);
  base[0] = lerp(a[0], b[0], t);
  base[1] = lerp(a[1], b[1], t);
  base[2] = lerp(a[2], b[2], t);
  base[3] = alpha;

  return base;
}

/** sRGB byte (possibly fractional, from bilinear sampling) → linear, interpolating the LUT. */
function srgbToLinear(byte: number): number {
  const low = Math.max(0, Math.min(255, Math.floor(byte)));
  const high = Math.min(255, low + 1);

  return lerp(SRGB_TO_LINEAR[low], SRGB_TO_LINEAR[high], byte - low);
}

/**
 * The mip level whose texels match ONE sub-sample: `log2` of the widest texel footprint of a sample step.
 * The card view is orthographic, so the UV↔pixel map is affine and the level is constant over the triangle —
 * one solve per triangle instead of per-fragment derivatives.
 */
function textureLod(tri: RasterTri, texture: DecodedTexture): number {
  const [a, b, c] = tri.pixels;
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (det === 0) {
    return 0;
  }
  const du1 = tri.uvs[1][0] - tri.uvs[0][0];
  const du2 = tri.uvs[2][0] - tri.uvs[0][0];
  const dv1 = tri.uvs[1][1] - tri.uvs[0][1];
  const dv2 = tri.uvs[2][1] - tri.uvs[0][1];
  const dudx = (du1 * (c[1] - a[1]) - du2 * (b[1] - a[1])) / det;
  const dudy = (du2 * (b[0] - a[0]) - du1 * (c[0] - a[0])) / det;
  const dvdx = (dv1 * (c[1] - a[1]) - dv2 * (b[1] - a[1])) / det;
  const dvdy = (dv2 * (b[0] - a[0]) - dv1 * (c[0] - a[0])) / det;
  const footprint = Math.max(
    Math.hypot(dudx * texture.width, dvdx * texture.height),
    Math.hypot(dudy * texture.width, dvdy * texture.height),
  );

  return footprint > 1 ? Math.log2(footprint) : 0;
}
