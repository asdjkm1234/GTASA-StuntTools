import { classifyAlpha, isAlphaMask } from '@opensa/cell-weld/alpha';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, gameDir, readBytes } from '../lib/game';

/**
 * The alpha-class census (plan 092): what class every texture of an archive gets, and which ones the mask
 * rule moves out of the blend pass. Answers "which textures render in the depth-writing cutout pass and
 * which land in the blend pass, where the background paints over the foreground".
 *
 * Two readings of the same histogram. `classifyAlpha`'s is absolute: `transparent` = alpha ≤ 5, `opaque` =
 * alpha ≥ 250, `mid` = the rest — cutout when mid ≤ 2 %. The MASK rule's is relative to the alpha TEST
 * vanilla applies (~128): `below` = alpha < 80, `above` = alpha > 176, `near` = the band around the
 * reference. A mask commits its texels to one SIDE of the test and spends only a thin antialiased edge near
 * it (that edge is what A2C renders); a true blend — glass, a shadow ramp, dirty water — either washes the
 * whole sheet across the reference or lives entirely on one side of it.
 *
 * Run: `npx tsx scripts/debug/alpha-class-census.ts [--game original] [--img <path>] [--json <out>]
 *       [--flips] [--below 0.05] [--above 0.05] [--near 0.10] [--txd <substring>]`
 *
 * The archive defaults to `build/<game>/sa/models/gta3.img` — the merged, mods-installed tree, which is the
 * closest standing stand-in for what the pack actually reads (`.work-opensa/opensa-lod`, kept only under `--until`).
 */

/** With no threshold flag the census reports the rule the PACK SHIPS ({@link isAlphaMask}); passing one
 *  re-fits it offline instead, which is how the shipped constants were chosen in the first place. */
const DEFAULTS = { above: 0.05, below: 0.05, near: 0.1 };
const TUNED = ['--above', '--below', '--near'].some((name) => process.argv.includes(name));
/** The alpha-test reference the classes are read against, and the half-width of its transition band. */
const REFERENCE = 128;
const BAND = 48;

interface Row {
  readonly above: number;
  readonly below: number;
  readonly current: 'cutout' | 'opaque' | 'softBlend';
  readonly format: string;
  readonly height: number;
  readonly mask: boolean;
  readonly mid: number;
  readonly near: number;
  readonly opaque: number;
  readonly texture: string;
  readonly transparent: number;
  readonly txd: string;
  readonly width: number;
}

/** A MASK populates both sides of the alpha test and spends only a thin edge on it. */
function candidateCutout(row: Row, thresholds: typeof DEFAULTS): boolean {
  return TUNED
    ? row.below >= thresholds.below && row.above >= thresholds.above && row.near <= thresholds.near
    : row.mask;
}

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : Number.NaN;

  return Number.isFinite(value) ? value : fallback;
}

function shares(rgba: Uint8Array): Pick<Row, 'above' | 'below' | 'mid' | 'near' | 'opaque' | 'transparent'> {
  let above = 0;
  let below = 0;
  let opaque = 0;
  let transparent = 0;
  const texels = rgba.length / 4;
  for (let index = 3; index < rgba.length; index += 4) {
    const alpha = rgba[index];
    if (alpha <= 5) {
      transparent += 1;
    } else if (alpha >= 250) {
      opaque += 1;
    }
    if (alpha < REFERENCE - BAND) {
      below += 1;
    } else if (alpha > REFERENCE + BAND) {
      above += 1;
    }
  }

  return {
    above: above / texels,
    below: below / texels,
    mid: (texels - transparent - opaque) / texels,
    near: (texels - above - below) / texels,
    opaque: opaque / texels,
    transparent: transparent / texels,
  };
}

function stringFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

const game = gameArg();
const imgPath =
  stringFlag('img') ??
  [join('build', game, 'sa', 'models', 'gta3.img'), gameDir(game, 'models', 'gta3.img')].find((path) =>
    existsSync(path),
  );
if (imgPath === undefined) {
  throw new Error(`no archive found for game '${game}' — pass --img <path>`);
}
const thresholds = {
  above: flag('above', DEFAULTS.above),
  below: flag('below', DEFAULTS.below),
  near: flag('near', DEFAULTS.near),
};
const txdFilter = stringFlag('txd')?.toLowerCase();
const archive = openArchive(readBytes(imgPath));
const rows: Row[] = [];
const counts = { cutout: 0, opaque: 0, softBlend: 0, unreadable: 0 };
for (const name of archive.names) {
  if (!name.toLowerCase().endsWith('.txd') || (txdFilter !== undefined && !name.toLowerCase().includes(txdFilter))) {
    continue;
  }
  const buffer = archive.get(name);
  if (!buffer) {
    continue;
  }
  let textures;
  try {
    textures = parseTxd(buffer).textures;
  } catch {
    counts.unreadable += 1; // locked/unparseable dictionaries — the pack skips them too
    continue;
  }
  for (const texture of textures) {
    const base = texture.mipmaps[0];
    if (!base) {
      continue;
    }
    let rgba;
    try {
      rgba =
        texture.format === 'rgba8888'
          ? new Uint8Array(base.data)
          : decodeDxt(texture.format, base.data, base.width, base.height);
    } catch {
      counts.unreadable += 1;
      continue;
    }
    const current = classifyAlpha(rgba, texture.hasAlpha);
    counts[current] += 1;
    if (current === 'opaque') {
      continue; // no alpha channel to reclassify — it can never reach the blend pass
    }
    rows.push({
      ...shares(rgba),
      current,
      format: texture.format,
      height: texture.height,
      mask: isAlphaMask(rgba, REFERENCE),
      texture: texture.name,
      txd: name,
      width: texture.width,
    });
  }
}

const flips = rows.filter((row) => row.current === 'softBlend' && candidateCutout(row, thresholds));
const kept = rows.filter((row) => row.current === 'softBlend' && !candidateCutout(row, thresholds));
const unreached = rows.filter((row) => row.current === 'cutout' && !candidateCutout(row, thresholds));
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

console.log(`archive ${imgPath}`);
console.log(
  TUNED
    ? `re-fit: below ≥ ${thresholds.below}, above ≥ ${thresholds.above}, near ≤ ${thresholds.near}`
    : 'rule: the shipped isAlphaMask',
);
console.log(
  `current: opaque ${counts.opaque}, cutout ${counts.cutout}, softBlend ${counts.softBlend}` +
    (counts.unreadable > 0 ? `, unreadable ${counts.unreadable}` : ''),
);
console.log(`candidate: softBlend → cutout ${flips.length}, stays blend ${kept.length}`);
console.log(
  `already cutout the candidate alone would not reach: ${unreached.length} (the rule is a UNION — they stay)`,
);

if (process.argv.includes('--flips')) {
  const byTxd = new Map<string, Row[]>();
  for (const row of flips) {
    byTxd.set(row.txd, [...(byTxd.get(row.txd) ?? []), row]);
  }
  for (const [txd, group] of [...byTxd].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${txd} (${group.length})`);
    for (const row of group) {
      console.log(
        `  ${row.texture} ${row.width}x${row.height} ${row.format} ` +
          `below=${percent(row.below)} near=${percent(row.near)} above=${percent(row.above)} (mid=${percent(row.mid)})`,
      );
    }
  }
}

const jsonPath = stringFlag('json');
if (jsonPath !== undefined) {
  writeFileSync(jsonPath, JSON.stringify({ counts, rows, thresholds }, null, 1));
  console.log(`\n${rows.length} alpha rows → ${jsonPath}`);
}
