/**
 * How much of the sky a tree's impostor covers against how much its HD does — the measurement plan 013 steps
 * 03 and 06 pick the card rule with. Renders BOTH from the same poses with the same software rasteriser the
 * bake uses (`core/probe.ts`), so the only difference is the geometry:
 *
 *   npx tsx scripts/debug/impostor-density.ts sm_veg_tree5 [--cards 4,3,2] [--px 64,32] [--azimuths 8]
 *                              [--tex 512] [--ss 2] [--blend] [--ref 100] [--alpha-scale 0.85] [--png <dir>]
 *
 * `--px` is a tree's HEIGHT in pixels, which is what a distance means once the projection is fixed: at SA's
 * ~70° fov on a 900 px viewport a 15 m tree is ~64 px tall at the 150 u HD draw distance and ~32 px at twice
 * that. `--blend` composites each card back-to-front with no depth write (real SA's sorted pass, which is
 * also what `--ref 100` belongs to); without it the cards form a cutout UNION, which is what OpenSA's weld
 * does once the impostor row carries the vegetation bits. `--alpha-scale` thins every card before drawing —
 * the knob the bake now solves per tree — and `--windings 2` draws each card twice, which together with
 * `--ss 1` reproduces the pre-plan-013 impostor.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProbeTri, ProbeView, TreeLodConfig } from '../../tools/lod-trees-generator/src/core';

import { config as defaultConfig } from '../../tools/lod-trees-generator/src/config';
import {
  canopyMass,
  cardTriangles,
  compositeOver,
  encodePng,
  hdTriangles,
  renderImpostor,
  renderProbe,
} from '../../tools/lod-trees-generator/src/core';
import { loadHdTree } from '../lib/vegetation';

/** The cutout both the bake and OpenSA's weld use; SA's sorted pass tests the impostor row at 100. */
const DEFAULT_REFERENCE = 128;
/** The canopy is the upper share of the tree's projected box — below it the trunk dominates. */
const CANOPY_TOP_SHARE = 0.6;

/** Every knob one run varies. */
interface RunOptions {
  alphaScale: number;
  alphaTest: number;
  azimuths: number;
  base: TreeLodConfig;
  blend: boolean;
  candidates: number[];
  pngDir: string | undefined;
  sizes: number[];
  windings: number;
}

/** What one rendered view says about the canopy. */
interface ViewStats {
  /** Share of the canopy box whose alpha survives the target's test. */
  covered: number;
  /** Mean luminance over the covered pixels: how DARK the canopy reads. */
  luma: number;
  /** Mean alpha over the canopy box (0–1): the coverage as rendered, antialiasing included. */
  mass: number;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const models = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (models.length === 0) {
    console.error(
      'usage: npx tsx scripts/debug/impostor-density.ts <model...> [--cards 4,3,2] [--px 64,32] [--azimuths 8] [--tex 512] [--ss 2] [--blend] [--ref 100] [--alpha-scale 0.85] [--windings 2] [--png <dir>]',
    );
    process.exit(1);
  }
  const pngDir = argValue('--png');
  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
  }
  const options: RunOptions = {
    alphaScale: Number(argValue('--alpha-scale') ?? 1),
    alphaTest: Number(argValue('--ref') ?? DEFAULT_REFERENCE) / 255,
    azimuths: Number(argValue('--azimuths') ?? 8),
    base: {
      ...defaultConfig,
      superSample: Number(argValue('--ss') ?? defaultConfig.superSample),
      textureSize: Number(argValue('--tex') ?? 512),
    },
    blend: process.argv.includes('--blend'),
    candidates: numbers('--cards', [defaultConfig.cards, defaultConfig.blendCards]),
    pngDir,
    sizes: numbers('--px', [64, 32]),
    windings: Number(argValue('--windings') ?? 1),
  };

  for (const model of models) {
    report(model, options);
  }
}

/** Mean of a metric over every azimuth. */
function mean(stats: readonly ViewStats[], pick: (s: ViewStats) => number): number {
  return stats.reduce((sum, s) => sum + pick(s), 0) / stats.length;
}

function numbers(flag: string, fallback: number[]): number[] {
  const raw = argValue(flag);

  return raw === undefined ? fallback : raw.split(',').map(Number);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(lod: number, hd: number): string {
  return hd === 0 ? 'n/a' : `×${(lod / hd).toFixed(2)}`;
}

/** One view of the card cage: the cutout union (OpenSA's weld) or the cards composited (SA's sorted pass). */
function renderCards(
  cards: readonly ProbeTri[][],
  bbox: { max: [number, number, number]; min: [number, number, number] },
  azimuth: number,
  px: number,
  options: RunOptions,
  png?: string,
): ViewStats {
  const view = options.blend
    ? compositeOver(cards.map((card) => renderProbe(card, bbox, azimuth, px, options.alphaTest)))
    : renderProbe(cards.flat(), bbox, azimuth, px, options.alphaTest);
  if (png) {
    writeFileSync(png, encodePng(view.rgba, view.width, view.height));
  }

  return viewStats(view);
}

/** Bake one tree and print the HD row plus one row per candidate card count, per requested screen size. */
function report(model: string, options: RunOptions): void {
  const { alphaScale, alphaTest, azimuths, base, blend, candidates, pngDir, sizes, windings } = options;
  const tree = loadHdTree(model);
  const hd = hdTriangles(tree);
  console.log(
    `${model}: ${tree.triangles.length} HD tris · ${azimuths} azimuths · ` +
      `${blend ? 'sorted BLEND, no depth write' : 'cutout'} at ref ${Math.round(alphaTest * 255)}` +
      `${alphaScale === 1 ? '' : ` · card alpha ×${alphaScale}`}${windings > 1 ? ` · ${windings} windings` : ''}`,
  );
  for (const px of sizes) {
    const shot = (kind: string, i: number): string | undefined =>
      pngDir && i === 0 ? join(pngDir, `${model}-${px}px-${kind}.png`) : undefined;
    const views = [...Array(azimuths).keys()].map((i) => (2 * Math.PI * i) / azimuths);
    const hdStats = views.map((a, i) => {
      const view = renderProbe(hd, tree.bbox, a, px, alphaTest);
      const png = shot('hd', i);
      if (png) {
        writeFileSync(png, encodePng(view.rgba, view.width, view.height));
      }

      return viewStats(view);
    });
    console.log(
      `  ${px} px tall — HD: covered ${pct(mean(hdStats, (s) => s.covered))} · mass ${pct(
        mean(hdStats, (s) => s.mass),
      )} (${spread(hdStats, (s) => s.mass)}) · luma ${mean(hdStats, (s) => s.luma).toFixed(0)}`,
    );
    for (const cards of candidates) {
      const impostor = renderImpostor(tree, { ...base, cards });
      if (alphaScale !== 1) {
        for (let i = 3; i < impostor.image.length; i += 4) {
          impostor.image[i] = Math.round(impostor.image[i] * alphaScale);
        }
      }
      const cage = cardTriangles(impostor);
      const drawn = windings > 1 ? cage.flatMap((card) => Array.from({ length: windings }, () => card)) : cage;
      const stats = views.map((a, i) => renderCards(drawn, tree.bbox, a, px, options, shot(`lod${cards}`, i)));
      console.log(
        `  ${px} px tall — LOD ${cards} cards: covered ${pct(mean(stats, (s) => s.covered))} ${ratio(
          mean(stats, (s) => s.covered),
          mean(hdStats, (s) => s.covered),
        )} · mass ${pct(mean(stats, (s) => s.mass))} ${ratio(
          mean(stats, (s) => s.mass),
          mean(hdStats, (s) => s.mass),
        )} (${spread(stats, (s) => s.mass)}) · luma ${mean(stats, (s) => s.luma).toFixed(0)} ${ratio(
          mean(stats, (s) => s.luma),
          mean(hdStats, (s) => s.luma),
        )}`,
      );
    }
  }
}

/**
 * Spread of a metric across the azimuths, as `min..max` of the per-view values over their mean.
 *
 * The MEAN is not the whole question a card rule has to answer: a crossed cage is at its thickest looking
 * down a card and at its thinnest between two, and that swing is what a view-weighted impostor (plan 013
 * phase B) exists to remove. A rule can sit at parity on average and still pump.
 */
function spread(stats: readonly ViewStats[], pick: (s: ViewStats) => number): string {
  const values = stats.map(pick);
  const average = mean(stats, pick);
  if (average === 0) {
    return 'n/a';
  }

  return `${(Math.min(...values) / average).toFixed(2)}..${(Math.max(...values) / average).toFixed(2)}`;
}

/** Coverage, mass and luminance over the upper share of the frame. */
function viewStats(view: ProbeView): ViewStats {
  const rows = Math.max(1, Math.round(view.height * CANOPY_TOP_SHARE));
  const texels = rows * view.width;
  let covered = 0;
  let luma = 0;
  for (let i = 0; i < texels; i += 1) {
    if (view.rgba[i * 4 + 3] >= 128) {
      covered += 1;
      luma += 0.2126 * view.rgba[i * 4] + 0.7152 * view.rgba[i * 4 + 1] + 0.0722 * view.rgba[i * 4 + 2];
    }
  }

  return { covered: covered / texels, luma: covered === 0 ? 0 : luma / covered, mass: canopyMass(view) };
}

main();
