/**
 * Bake one or more HD trees into impostor atlases IN PROCESS and measure what plan 013 judges the bake on:
 * canopy fill per card, the isolated-opaque-texel share (the white speckle) and the atlas mean RGB — seconds,
 * against a ~10 min pmb `trees` stage. Run:
 *   npx tsx scripts/debug/impostor-atlas-census.ts sm_veg_tree5 sm_veg_tree7vbig [--tex 512] [--ss 4] [--png <dir>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { HdTree, Impostor, TreeLodConfig } from '../../tools/lod-trees-generator/src/core';

import { config as defaultConfig } from '../../tools/lod-trees-generator/src/config';
import { encodePng, renderImpostor } from '../../tools/lod-trees-generator/src/core';
import { loadHdTree } from '../lib/vegetation';
/** A texel counts as canopy when the game's own alpha test would keep it (SA's foliage reference). */
const OPAQUE = 128;
/** The canopy is the upper share of a card's silhouette box — below it the trunk dominates. */
const CANOPY_TOP_SHARE = 0.6;

/** Running totals over a card's texels — filled by {@link accumulate}, closed by {@link tileStats}. */
interface Accumulator {
  alphaSum: number;
  canopyAlpha: number;
  canopyCovered: number;
  canopyTexels: number;
  covered: number;
  isolated: number;
  lumas: number[];
  speckle: number;
  sum: [number, number, number];
  weighted: [number, number, number];
}

interface TileStats {
  /** Share of the canopy box whose alpha survives SA's own test — what the `sa` target actually draws. */
  canopyFill: number;
  /** Mean alpha over the canopy box (0–1): the coverage as AUTHORED, whatever the target does with it.
   *  Antialiasing moves texels from `canopyFill` into partial alpha, so only this stays comparable. */
  canopyMass: number;
  coverage: number;
  /** Share of surviving texels that stand alone: ≤ 1 surviving 4-neighbour (the binary measure plan 013
   *  baselined) — kept so a before/after against the point-sampled bake is like for like. */
  isolated: number;
  meanRgb: [number, number, number];
  /** Median luminance over surviving texels — unlike a mean it does not move when a bright tail (the
   *  isolated twig texels) is filtered away, so the pair mean-vs-median says WHICH of the two happened. */
  medianLuma: number;
  /** Share of surviving texels whose 4-neighbours average below half the test — a bright dot against
   *  nothing, measured on CONTINUOUS alpha (the binary one over-counts once edges carry partial coverage). */
  speckle: number;
  /** Mean colour weighted by alpha over the WHOLE tile (Σ rgb·α / Σ α) — the colour the card actually
   *  contributes, and unlike `meanRgb` it does not move when texels cross the 128 threshold. */
  weightedRgb: [number, number, number];
}

/** Fold one texel into the totals: its colour, its coverage, and how alone it stands. */
function accumulate(acc: Accumulator, image: Uint8Array, at: number, canopy: boolean, neighbours: number[]): void {
  const alpha = image[at + 3];
  acc.alphaSum += alpha;
  acc.weighted[0] += image[at] * alpha;
  acc.weighted[1] += image[at + 1] * alpha;
  acc.weighted[2] += image[at + 2] * alpha;
  if (canopy) {
    acc.canopyTexels += 1;
    acc.canopyAlpha += alpha;
  }
  if (alpha < OPAQUE) {
    return;
  }
  acc.covered += 1;
  acc.canopyCovered += canopy ? 1 : 0;
  acc.sum[0] += image[at];
  acc.sum[1] += image[at + 1];
  acc.sum[2] += image[at + 2];
  acc.lumas.push(0.2126 * image[at] + 0.7152 * image[at + 1] + 0.0722 * image[at + 2]);
  if (neighbours.filter((value) => value >= OPAQUE).length <= 1) {
    acc.isolated += 1;
  }
  if (neighbours.reduce((total, value) => total + value, 0) / neighbours.length < OPAQUE / 2) {
    acc.speckle += 1;
  }
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function bake(model: string, config: TreeLodConfig): { impostor: Impostor; ms: number; tree: HdTree } {
  const tree = loadHdTree(model);
  const started = performance.now();
  const impostor = renderImpostor(tree, config);

  return { impostor, ms: performance.now() - started, tree };
}

/** Close the totals into the reported shares (every one guarded for an empty card). */
function close(acc: Accumulator, texels: number): TileStats {
  const { covered } = acc;
  const share = (part: number): number => (covered === 0 ? 0 : part / covered);
  const canopy = (part: number): number => (acc.canopyTexels === 0 ? 0 : part / acc.canopyTexels);
  const mean = (sums: [number, number, number], total: number): [number, number, number] =>
    total === 0 ? [0, 0, 0] : [sums[0] / total, sums[1] / total, sums[2] / total];

  return {
    canopyFill: canopy(acc.canopyCovered),
    canopyMass: canopy(acc.canopyAlpha / 255),
    coverage: covered / texels,
    isolated: share(acc.isolated),
    meanRgb: mean(acc.sum, covered),
    medianLuma: acc.lumas.length === 0 ? 0 : acc.lumas.sort((a, b) => a - b)[acc.lumas.length >> 1],
    speckle: share(acc.speckle),
    weightedRgb: mean(acc.weighted, acc.alphaSum),
  };
}

function main(): void {
  const models = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (models.length === 0) {
    console.error(
      'usage: npx tsx scripts/debug/impostor-atlas-census.ts <model...> [--tex 512] [--cards 4] [--ss 4] [--png <dir>]',
    );
    process.exit(1);
  }
  const config: TreeLodConfig = {
    ...defaultConfig,
    cards: Number(argValue('--cards') ?? defaultConfig.cards),
    superSample: Number(argValue('--ss') ?? defaultConfig.superSample),
    // The pmb `sa`/`opensa` stage bakes at 512 (`treeTex`), not the 128 CLI default — measure what ships.
    textureSize: Number(argValue('--tex') ?? 512),
  };
  const pngDir = argValue('--png');
  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
  }

  for (const model of models) {
    const { impostor, ms, tree } = bake(model, config);
    console.log(
      `${model}: ${tree.triangles.length} HD tris → atlas ${impostor.width}×${impostor.height}, ${impostor.cards.length} cards, bake ${ms.toFixed(0)} ms`,
    );
    const totals: TileStats[] = [];
    impostor.cards.forEach((card, index) => {
      const stats = tileStats(impostor.image, impostor.width, card.uvRect);
      totals.push(stats);
      console.log(
        `  card ${index} ${card.uvRect.w}×${card.uvRect.h}: canopy fill ${pct(stats.canopyFill)} · mass ${pct(stats.canopyMass)} · coverage ${pct(stats.coverage)} · isolated ${pct(stats.isolated)} · speckle ${pct(stats.speckle)} · mean RGB ${stats.meanRgb.map((c) => c.toFixed(0)).join('/')} · weighted RGB ${stats.weightedRgb.map((c) => c.toFixed(0)).join('/')} · median luma ${stats.medianLuma.toFixed(0)}`,
      );
    });
    const mean = (pick: (stats: TileStats) => number): number =>
      totals.reduce((sum, s) => sum + pick(s), 0) / totals.length;
    console.log(
      `  ALL: canopy fill ${pct(mean((s) => s.canopyFill))} · mass ${pct(mean((s) => s.canopyMass))} · isolated ${pct(mean((s) => s.isolated))} · speckle ${pct(mean((s) => s.speckle))} · mean RGB ${[0, 1, 2].map((c) => mean((s) => s.meanRgb[c]).toFixed(0)).join('/')} · weighted RGB ${[0, 1, 2].map((c) => mean((s) => s.weightedRgb[c]).toFixed(0)).join('/')} · median luma ${mean((s) => s.medianLuma).toFixed(0)}`,
    );
    if (pngDir) {
      writeFileSync(join(pngDir, `${impostor.name}.png`), encodePng(impostor.image, impostor.width, impostor.height));
      // The one to LOOK at: a viewer paints transparent texels white, and a sparse dark canopy on white reads
      // as a white-leaved tree — the picture that nearly became a diagnosis in session 36.
      writeFileSync(
        join(pngDir, `${impostor.name}.grey.png`),
        encodePng(overGrey(impostor.image), impostor.width, impostor.height),
      );
    }
  }
}

/** The atlas composited over mid-grey — alpha resolved, so what is dark is dark and what is gone is grey. */
function overGrey(image: Uint8Array): Uint8Array {
  const out = new Uint8Array(image.length);
  for (let i = 0; i < image.length; i += 4) {
    const alpha = image[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.round(image[i + c] * alpha + 128 * (1 - alpha));
    }
    out[i + 3] = 255;
  }

  return out;
}
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Stats over one card's rect in the atlas image. */
function tileStats(image: Uint8Array, width: number, rect: { h: number; w: number; x: number; y: number }): TileStats {
  const alphaAt = (x: number, y: number): number => image[((rect.y + y) * width + rect.x + x) * 4 + 3];
  const acc: Accumulator = {
    alphaSum: 0,
    canopyAlpha: 0,
    canopyCovered: 0,
    canopyTexels: 0,
    covered: 0,
    isolated: 0,
    lumas: [],
    speckle: 0,
    sum: [0, 0, 0],
    weighted: [0, 0, 0],
  };
  const canopyRows = Math.round(rect.h * CANOPY_TOP_SHARE);

  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const neighbours = [
        x > 0 ? alphaAt(x - 1, y) : 0,
        x + 1 < rect.w ? alphaAt(x + 1, y) : 0,
        y > 0 ? alphaAt(x, y - 1) : 0,
        y + 1 < rect.h ? alphaAt(x, y + 1) : 0,
      ];
      accumulate(acc, image, ((rect.y + y) * width + rect.x + x) * 4, y < canopyRows, neighbours);
    }
  }

  return close(acc, rect.w * rect.h);
}

main();
