import type { DecodedTexture, HdTree, Impostor, Rgba, Vec2, Vec3 } from './types';

import { buildCardGeometry as buildCards } from './cards';
import { createRaster, rasterizeTriangle, resolveRaster, withMipChain } from './raster';

/**
 * A probe render: the HD mesh or a baked card cage, drawn from one azimuth at the size a tree really has on
 * screen, so the two can be compared as the game sees them (plan 013 steps 03 and 06). Used by the bake
 * itself — `card-alpha.ts` solves each tree's card alpha against its own HD — and by
 * `scripts/debug/impostor-density.ts`.
 */

/** Sub-samples per probe pixel: the metric is a coverage, so the render that produces it is antialiased. */
const SUPERSAMPLE = 4;
/** The canopy is the upper share of the tree's projected box — below it the trunk dominates. */
const CANOPY_TOP_SHARE = 0.6;

/** One triangle to draw, in world space, with the texture its material names. */
export interface ProbeTri {
  colors: [Rgba, Rgba, Rgba] | null;
  positions: [Vec3, Vec3, Vec3];
  texture: DecodedTexture | null;
  uvs: [Vec2, Vec2, Vec2];
}

/** A rendered probe view. */
export interface ProbeView {
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** Mean alpha over the canopy box (0–1) — the coverage as rendered, antialiasing included. */
export function canopyMass(view: ProbeView): number {
  const rows = Math.max(1, Math.round(view.height * CANOPY_TOP_SHARE));
  const texels = rows * view.width;
  let sum = 0;
  for (let i = 0; i < texels; i += 1) {
    sum += view.rgba[i * 4 + 3];
  }

  return sum / (texels * 255);
}

/** The baked card cage as world triangles over its atlas, ONE list per card (a blend pass draws them apart). */
export function cardTriangles(impostor: Impostor): ProbeTri[][] {
  const geometry = buildCards(impostor);
  const atlas = withMipChain({
    hasAlpha: true,
    height: impostor.height,
    rgba: impostor.image,
    width: impostor.width,
  });
  const colour = impostor.dayColor;
  const at = (i: number): Vec3 => [
    geometry.positions[i * 3],
    geometry.positions[i * 3 + 1],
    geometry.positions[i * 3 + 2],
  ];
  const uvAt = (i: number): Vec2 => [geometry.uvs[i * 2], geometry.uvs[i * 2 + 1]];
  const tris = geometry.triangles.map((triangle) => ({
    colors: [colour, colour, colour] as [Rgba, Rgba, Rgba],
    positions: [at(triangle.a), at(triangle.b), at(triangle.c)] as [Vec3, Vec3, Vec3],
    texture: atlas,
    uvs: [uvAt(triangle.a), uvAt(triangle.b), uvAt(triangle.c)] as [Vec2, Vec2, Vec2],
  }));
  const perCard = tris.length / impostor.cards.length;

  return impostor.cards.map((_, i) => tris.slice(i * perCard, (i + 1) * perCard));
}

/** Composite `layers` back-to-front with no depth write: `over` per pixel, exactly a sorted alpha pass. */
export function compositeOver(layers: readonly ProbeView[]): ProbeView {
  const out = new Uint8Array(layers[0].rgba.length);
  for (const layer of layers) {
    for (let i = 0; i < out.length; i += 4) {
      const src = layer.rgba[i + 3] / 255;
      const dst = out[i + 3] / 255;
      const alpha = src + dst * (1 - src);
      if (alpha === 0) {
        continue;
      }
      for (let c = 0; c < 3; c += 1) {
        out[i + c] = Math.round((layer.rgba[i + c] * src + out[i + c] * dst * (1 - src)) / alpha);
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }

  return { height: layers[0].height, rgba: out, width: layers[0].width };
}

/** The HD mesh as world triangles, its textures mipped (memoised on the texture — see `withMipChain`). */
export function hdTriangles(tree: HdTree): ProbeTri[] {
  return tree.triangles.map((triangle) => {
    const source = triangle.texture ? (tree.textures.get(triangle.texture) ?? null) : null;

    return {
      colors: triangle.colors,
      positions: triangle.positions,
      texture: source ? withMipChain(source) : null,
      uvs: triangle.uvs,
    };
  });
}

/**
 * Render `tris` from one azimuth with the tree standing at a given HEIGHT in pixels — which is what a
 * distance means once the projection is fixed (at SA's ~70° fov on a 900 px viewport a 15 m tree is ~64 px
 * tall at the 150 u switch). The frame is fit to the bbox's half-DIAGONAL so the tree occupies the same
 * frame from every azimuth; a per-azimuth fit would rescale the picture and make coverages incomparable.
 */
export function renderProbe(
  tris: readonly ProbeTri[],
  bbox: { max: Vec3; min: Vec3 },
  azimuth: number,
  pxHeight: number,
  alphaTest: number,
): ProbeView {
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const zSpan = Math.max(1e-3, bbox.max[2] - bbox.min[2]);
  const radius = Math.max(1e-3, 0.5 * Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1]));
  const width = Math.max(1, Math.round(((2 * radius) / zSpan) * pxHeight));
  const raster = createRaster(width, pxHeight, SUPERSAMPLE);
  const tx = -Math.sin(azimuth);
  const ty = Math.cos(azimuth);
  const nx = Math.cos(azimuth);
  const ny = Math.sin(azimuth);
  const toPx = (p: Vec3): [number, number, number] => [
    (((p[0] - cx) * tx + (p[1] - cy) * ty + radius) / (2 * radius)) * (raster.sampleWidth - 1),
    ((bbox.max[2] - p[2]) / zSpan) * (raster.sampleHeight - 1),
    (p[0] - cx) * nx + (p[1] - cy) * ny,
  ];

  for (const tri of tris) {
    rasterizeTriangle(
      raster,
      {
        colors: tri.colors,
        pixels: [toPx(tri.positions[0]), toPx(tri.positions[1]), toPx(tri.positions[2])],
        uvs: tri.uvs,
      },
      tri.texture,
      alphaTest,
    );
  }

  return { height: raster.height, rgba: resolveRaster(raster).color, width: raster.width };
}
