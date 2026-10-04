import type { MipLevel } from '@opensa/rw-codec/mip';

/**
 * Game-agnostic types for the tree-LOD generator. The core renders + packs + emits; everything game-specific
 * (DFF/TXD/IDE I/O, encoding) lives behind a {@link TreeLodAdapter} so a future game plugs in without touching
 * the core (cf. opensa-lod-generator's core/adapter split).
 */

/** A decoded source texture as raw RGBA (`width*height*4`), ready for software sampling. */
export interface DecodedTexture {
  hasAlpha: boolean;
  height: number;
  /** Box-filtered chain over {@link rgba} (level 0 = the base), attached by `withMipChain` on FIRST use: the
   *  rasterizer samples the level matching one sub-sample's footprint instead of point-sampling the base
   *  (plan 013). Absent → the base level is sampled, as before. Memoised here rather than in a wrapper
   *  because one texture map is shared by every tree of the stage. */
  mips?: readonly MipLevel[];
  rgba: Uint8Array;
  width: number;
}

/** A loaded HD tree: its triangle soup + decoded textures + bounding box. */
export interface HdTree {
  bbox: { max: Vec3; min: Vec3 };
  /** Average DAY prelit of the source (per channel) — becomes the impostor's vertex prelit, while the atlas
   *  keeps only the normalized per-texel variation (`tex × prelit/dayAvg`). This makes the impostor behave
   *  like a NORMAL prelit model: whatever the target renderer multiplies prelit models by (SA ×1, skygfx
   *  PS2 building pipe ×2, OpenSA's linear pipeline) applies equally to the HD and the LOD, so the pair
   *  matches under any pipeline (plan 012). Absent when the source has no prelit (bake stays un-normalized,
   *  vertices stay white). */
  dayAvg?: Rgba;
  name: string;
  /** Average NIGHT (`0x253F2F9`) colour of the source — written verbatim as the impostor's night set, so the
   *  engine's own day↔night vertex blend drives the impostor exactly like a stock model. Absent when the
   *  source has no night colours (then the HD stays day-lit at night too, so the impostor should as well). */
  nightAvg?: Rgba;
  textures: Map<string, DecodedTexture>;
  triangles: HdTriangle[];
}

/** One HD triangle flattened for rasterising: 3 positions (native Z-up), 3 UVs, optional prelit colors, and the
 *  material's texture name (lowercased) — `null` when the material is untextured. */
export interface HdTriangle {
  colors: [Rgba, Rgba, Rgba] | null;
  positions: [Vec3, Vec3, Vec3];
  texture: null | string;
  uvs: [Vec2, Vec2, Vec2];
}

/** A baked tree impostor: the per-tree atlas image (RGBA, `width*height*4`) + the cards (placement + UV rect) the
 *  LOD DFF will reference. The atlas is square for ~square trees, portrait (`height = 2*width`) for tall ones, so
 *  texels stay ~square in world space (no vertical under-sampling). One {@link Impostor} → one named TXD texture. */
export interface Impostor {
  bbox: { max: Vec3; min: Vec3 };
  /** The factor every atlas texel's alpha was scaled by so the COMPOSITED cage covers what the HD covers —
   *  solved per tree (`card-alpha.ts`). 1 on the set whose target unions the cards. */
  cardAlpha: number;
  cards: ImpostorCard[];
  /** DAY prelit for every card vertex (the source's {@link HdTree.dayAvg}; white when the source had none) —
   *  the mean lighting level lives HERE, not in the atlas, so the target renderer's prelit pipeline applies
   *  to the impostor exactly as to the HD. */
  dayColor: Rgba;
  height: number;
  /** The normalized atlas in the REAL-SA convention: `tex × prelit/dayAvg` multiplied in raw sRGB bytes
   *  (gamma pipeline — D3D9-era RenderWare filters and modulates in gamma space). */
  image: Uint8Array;
  /** The same atlas in the LINEAR convention for OpenSA/three.js: `lin2srgb(srgb2lin(tex) × prelit/dayAvg)`
   *  — modern pipelines decode sRGB before multiplying. The pmb opensa split swaps this variant in. */
  imageLinear: Uint8Array;
  name: string;
  /** Absolute night vertex colour ({@link HdTree.nightAvg}); absent → no night set emitted (impostor stays
   *  day-lit at night, matching a night-less HD). */
  nightColor?: Rgba;
  width: number;
}

/** One crossed-billboard card: angle around vertical Z, world extents (tangent `u` rel. to centre, absolute
 *  `z`), and its pixel rect in the atlas image. */
export interface ImpostorCard {
  angle: number;
  uvRect: { h: number; w: number; x: number; y: number };
  worldU: [number, number];
  worldZ: [number, number];
}

/** RGBA byte color (0–255). */
export type Rgba = [number, number, number, number];

/** Game-specific I/O for the generator. */
export interface TreeLodAdapter {
  /** Encode + write the baked impostors to `--out`: the `primary` set is what the built tree carries (the
   *  real-SA shape), the `alternate` set goes to a sidecar the OpenSA split swaps in — the two differ in
   *  card count and card alpha because their targets composite the cage differently (plan 013 step 06). */
  finalize: (primary: Impostor[], alternate: Impostor[]) => void;
  /** HD tree model names to process (from `--in`). */
  listInputs: () => string[];
  /** Parse + decode one HD tree (geometry + textures, resolved against `--game`). */
  loadTree: (name: string) => HdTree;
}

/** Bake knobs (the "how big / how many" of the impostor). */
export interface TreeLodConfig {
  /** `bboxHeight / bboxWidth` above which the atlas goes portrait (`width × 2*width`) instead of square. */
  aspectThreshold: number;
  /** Cards for a target whose class STACKS them: real SA composites the impostor in its sorted pass whatever
   *  the flags say, so the same four cards measure ×1.36 the tree's own canopy there. Baked as a SECOND set
   *  (plan 013 step 06), with each card thinned by {@link Impostor.cardAlpha}. */
  blendCards: number;
  /** Cards in the cage for a target whose alpha class UNIONS them — OpenSA welds the impostor CUTOUT once
   *  its row carries the vegetation bits (plan 013 step 02), so four crossed cards read as one canopy. */
  cards: number;
  /** Emitted LOD draw distance (world units) — the visibility gate for the LOD def. */
  drawDistance: number;
  /** Sub-samples per atlas texel on each axis (a power of two; 1 = off). The card bake is a software
   *  rasterizer with no MSAA, so a thin leaf quad either takes a texel whole or misses it — the isolated
   *  white twig texels plan 013 measured. Bake-time cost only, and it grows with the SQUARE. */
  superSample: number;
  /** Per-tree texture size (px) in the shared atlas — the N card views tile inside it. */
  textureSize: number;
}

export type Vec2 = [number, number];

export type Vec3 = [number, number, number];
