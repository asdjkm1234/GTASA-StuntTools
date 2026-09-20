import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { buildMipChain, downsample, type MipColorMath, type MipLevel } from '@opensa/rw-codec/mip';
import { encodeDxtStruct } from '@opensa/rw-codec/texture-native';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import { gameArg, openGameArchive } from '../lib/game';
import { decodeToRgba } from '../lib/texture';

/**
 * Retune a mod's `.txd`: resize every texture to the dimensions a REFERENCE dictionary carries (normally the
 * stock one), and pull in textures an earlier mod added that this one would otherwise drop.
 *
 * Two problems it exists for, both found on `56. 2dfx Snack Vending Machine`:
 *
 * 1. **HD retextures cost far more than they look.** That mod ships `cj_commercial.txd` at 5.6 MB against a
 *    stock 106 KB — every texture upscaled 8×, for interior props. Matching stock sizes gives the same
 *    silhouette back at a fraction of the streaming cost.
 * 2. **A later mod silently drops what an earlier one added.** Mods are applied in order and a whole `.txd`
 *    overwrites its predecessor, so a texture an earlier mod ADDED to a shared dictionary disappears — and
 *    the model that needs it renders untextured. The pak build already reports these
 *    (`report.json` → `textures.missing`); `--add` is how you put one back.
 *
 * The reference is resolved as a filesystem path first, then as an entry in the game's archives, so
 * `--match cj_commercial.txd` finds the stock dictionary wherever it lives.
 *
 * Dry run by default — it prints the plan and the size it would save. Pass `--write` to apply.
 *
 * ```sh
 * # what would change, and by how much
 * npx tsx scripts/debug/txd-retune.ts "mods-src/original/mods/56. …/gta_int_img/cj_commercial.txd" \
 *   --match cj_commercial.txd
 * # apply, and restore the texture mod 3 added
 * npx tsx scripts/debug/txd-retune.ts "…/cj_commercial.txd" --match cj_commercial.txd \
 *   --add "mods-src/original/mods/3. Global Textures Fixes/gta_int_img/cj_commercial.txd#CJ_FRAME_Glass2" --write
 * ```
 *
 * Flags: `--match <txd|entry>` reference sizes, and a FLOOR nothing is shrunk below · `--halve <n>` shrink
 * every texture n power-of-two steps (floored by `--match` when both are given) · `--add <txd>#<name>`
 * (repeatable) · `--max <n>` cap every side · `--no-mips` drop the mip chain · `--math gamma|linear` (default `gamma`
 * — real SA filters in gamma space; use `linear` for a dictionary only OpenSA reads) · `--write`.
 */

const RW_VERSION = 0x1803ffff;

interface Retuned {
  format: 'dxt1' | 'dxt3' | 'dxt5';
  height: number;
  name: string;
  rgba: Uint8Array;
  source: string;
  wasHeight: number;
  wasWidth: number;
  width: number;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

/** A DXT format for the output: keep the source's when it has one, else pick by alpha. */
function formatOf(source: string, hasAlpha: boolean): 'dxt1' | 'dxt3' | 'dxt5' {
  if (source === 'dxt1' || source === 'dxt3' || source === 'dxt5') {
    return source;
  }

  return hasAlpha ? 'dxt5' : 'dxt1';
}

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);

  return at >= 0 ? process.argv[at + 1] : undefined;
}

function options(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, at) => {
    if (arg === name && process.argv[at + 1]) {
      out.push(process.argv[at + 1]);
    }
  });

  return out;
}

/** Read a `.txd` from disk, or from the game's archives by entry name. */
function readDictionary(target: string): ArrayBuffer | null {
  if (existsSync(target) && statSync(target).isFile()) {
    const file = readFileSync(target);

    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  }

  return openGameArchive(gameArg()).get(target);
}

/** Halve toward the target — box filter, exactly the mip path, so scaling and mips agree. */
function resize(
  rgba: Uint8Array,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
  math: MipColorMath,
): MipLevel {
  let level: MipLevel = { data: rgba, height, width };
  while (level.width > toWidth || level.height > toHeight) {
    const next = downsample(level.data, level.width, level.height, math);
    if (next.width < toWidth || next.height < toHeight) {
      break; // never overshoot below the target — a non-power-of-two ratio stops at the nearest step above
    }
    level = next;
  }

  return level;
}

const [input] = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && arg.endsWith('.txd'));
if (!input || !existsSync(input)) {
  console.error('usage: npx tsx scripts/debug/txd-retune.ts <mod.txd> [--match <txd|entry>] [--add <txd>#<name>] …');
  process.exit(1);
}

const math: MipColorMath = option('--math') === 'linear' ? 'linear' : 'gamma';
const keepMips = !flag('--no-mips');
const maxSide = option('--max') ? Number(option('--max')) : undefined;
/** How many power-of-two steps to shrink by. `--match` still acts as a floor (see `targetSize`). */
const halvings = option('--halve') ? Number(option('--halve')) : 0;

const sourceBytes = readDictionary(input)!;
const source = parseTxd(sourceBytes);

// Reference sizes: the dictionary this mod is replacing.
const referenceArg = option('--match');
const reference = new Map<string, { height: number; width: number }>();
if (referenceArg) {
  const bytes = readDictionary(referenceArg);
  if (!bytes) {
    console.error(`--match: cannot read ${referenceArg}`);
    process.exit(1);
  }
  for (const texture of parseTxd(bytes).textures) {
    reference.set(texture.name.toLowerCase(), { height: texture.height, width: texture.width });
  }
}

/**
 * The size a texture should end at. `--match` is a FLOOR as well as a target: a reference size is never
 * undercut, so `--halve` on a mod that already carries some textures at stock size shrinks only the ones
 * that are actually oversized instead of pushing the rest below what the game shipped.
 */
function targetSize(name: string, width: number, height: number): { height: number; width: number } {
  const target = reference.get(name.toLowerCase());
  let toWidth = target?.width ?? width;
  let toHeight = target?.height ?? height;
  for (let step = 0; step < halvings; step += 1) {
    toWidth = Math.max(1, toWidth >> 1);
    toHeight = Math.max(1, toHeight >> 1);
  }
  if (target) {
    toWidth = Math.max(toWidth, target.width);
    toHeight = Math.max(toHeight, target.height);
  }
  if (maxSide) {
    while (toWidth > maxSide || toHeight > maxSide) {
      toWidth = Math.max(1, toWidth >> 1);
      toHeight = Math.max(1, toHeight >> 1);
    }
  }

  return { height: Math.min(toHeight, height), width: Math.min(toWidth, width) };
}

const planned: Retuned[] = [];
for (const texture of source.textures) {
  const { height: toHeight, width: toWidth } = targetSize(texture.name, texture.width, texture.height);
  const level = resize(decodeToRgba(texture), texture.width, texture.height, toWidth, toHeight, math);
  planned.push({
    format: formatOf(texture.format, texture.hasAlpha),
    height: level.height,
    name: texture.name,
    rgba: level.data,
    source: 'own',
    wasHeight: texture.height,
    wasWidth: texture.width,
    width: level.width,
  });
}

// Textures an earlier mod added that this dictionary lacks.
const have = new Set(planned.map((entry) => entry.name.toLowerCase()));
for (const spec of options('--add')) {
  const hash = spec.lastIndexOf('#');
  const [from, wanted] = hash < 0 ? [spec, ''] : [spec.slice(0, hash), spec.slice(hash + 1)];
  const bytes = readDictionary(from);
  if (!bytes) {
    console.error(`--add: cannot read ${from}`);
    process.exit(1);
  }
  for (const texture of parseTxd(bytes).textures) {
    if (wanted && texture.name.toLowerCase() !== wanted.toLowerCase()) {
      continue;
    }
    if (have.has(texture.name.toLowerCase())) {
      console.log(`  --add ${texture.name}: already present, skipped`);
      continue;
    }
    const target = reference.get(texture.name.toLowerCase());
    const toWidth = target?.width ?? (maxSide ? Math.min(texture.width, maxSide) : texture.width);
    const toHeight = target?.height ?? (maxSide ? Math.min(texture.height, maxSide) : texture.height);
    const level = resize(decodeToRgba(texture), texture.width, texture.height, toWidth, toHeight, math);
    planned.push({
      format: formatOf(texture.format, texture.hasAlpha),
      height: level.height,
      name: texture.name,
      rgba: level.data,
      source: from,
      wasHeight: texture.height,
      wasWidth: texture.width,
      width: level.width,
    });
    have.add(texture.name.toLowerCase());
  }
}

console.log(
  `${input}\n  ${source.textures.length} textures in, ${planned.length} out, math=${math}, mips=${keepMips}\n`,
);
for (const entry of planned) {
  const from = `${entry.wasWidth}x${entry.wasHeight}`;
  const to = `${entry.width}x${entry.height}`;
  let note = entry.source === 'own' ? (from === to ? '' : '  resized') : `  ADDED from ${entry.source}`;
  // Halving cannot reach a reference whose ASPECT differs — the author redrew the texture at another
  // ratio, and squashing it to the reference would distort what they drew. Stop at the nearest step that
  // is not smaller than the reference in either dimension, and say so rather than pretend it matched.
  const target = reference.get(entry.name.toLowerCase());
  if (target && (target.width !== entry.width || target.height !== entry.height)) {
    note += `  (reference is ${target.width}x${target.height} — different aspect, kept the author's)`;
  }
  console.log(`  ${entry.name.padEnd(22)} ${from.padEnd(11)} -> ${to.padEnd(11)} ${entry.format}${note}`);
}

const natives = planned.map((entry) => {
  const levels = keepMips
    ? buildMipChain(entry.rgba, entry.width, entry.height, math)
    : [{ data: entry.rgba, height: entry.height, width: entry.width }];

  return {
    children: [
      { data: encodeDxtStruct(entry.name, entry.format, levels), type: RW_STRUCT, version: RW_VERSION },
      { children: [], type: RW_EXTENSION, version: RW_VERSION },
    ],
    type: RW_TEXTURE_NATIVE,
    version: RW_VERSION,
  };
});
const count = new Uint8Array(4);
new DataView(count.buffer).setUint16(0, natives.length, true);
const encoded = writeRw({
  chunks: [
    {
      children: [
        { data: count, type: RW_STRUCT, version: RW_VERSION },
        ...natives,
        { children: [], type: RW_EXTENSION, version: RW_VERSION },
      ],
      type: RW_TEXTURE_DICTIONARY,
      version: RW_VERSION,
    },
  ],
  trailing: new Uint8Array(0),
});

const before = sourceBytes.byteLength;
const after = encoded.byteLength;
const percent = ((100 * (before - after)) / before).toFixed(1);
console.log(`\n  ${before.toLocaleString()} B -> ${after.toLocaleString()} B  (-${percent} %)`);

if (!flag('--write')) {
  console.log('  DRY RUN — pass --write to apply');
  process.exit(0);
}
writeFileSync(input, encoded);
console.log('  written');
