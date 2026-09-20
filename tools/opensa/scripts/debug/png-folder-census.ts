import { decodePng } from '@opensa/mod-installer/png-decode';
import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE } from '@opensa/rw-codec/chunk';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { gameArg, openGameArchive } from '../lib/game';

/**
 * What every PNG texture folder in a game's mods actually DOES to the dictionary it patches — per PNG:
 * the image size, the stock texture it replaces (size, format, level count) or "adds", and for a
 * replacement of an uncompressed raster the bytes both encodings cost over the whole mip chain.
 *
 * The census behind `docs/contracts/mods.md`'s inherit rule and mod-installer plan 015: a PNG that
 * REPLACES a texture is encoded in that raster's compression class, because the game reads some of them
 * back on the CPU. Run it before changing that policy — it is what turns "the plates are broken" into
 * "19 of 24 replacements are uncompressed in stock, and following them costs 15.2 MB".
 *
 * Run: `npx tsx scripts/debug/png-folder-census.ts [--game original]`.
 */
const GAME = gameArg();
const ROOT = `mods-src/${GAME}`;
const archive = openGameArchive(GAME);

interface Raster {
  d3d: number;
  height: number;
  levels: number;
  width: number;
}

const rasters = (bytes: Uint8Array): Map<string, Raster> => {
  const out = new Map<string, Raster>();
  const dict = readRw(bytes).chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  for (const native of dict?.children?.filter((chunk) => chunk.type === RW_TEXTURE_NATIVE) ?? []) {
    const struct = native.children?.find((chunk) => chunk.type === RW_STRUCT)?.data;
    if (!struct || struct.length < 88) {
      continue;
    }
    const view = new DataView(struct.buffer, struct.byteOffset, struct.byteLength);
    let end = 8;
    while (end < 40 && struct[end] !== 0) {
      end += 1;
    }
    out.set(new TextDecoder().decode(struct.subarray(8, end)).toLowerCase(), {
      d3d: view.getUint32(76, true),
      height: view.getUint16(82, true),
      levels: struct[85],
      width: view.getUint16(80, true),
    });
  }

  return out;
};

/** The stock dictionary a folder merges into: a loose `<folder>.txd`, else the same-named archive entry. */
const targetTxd = (folder: string): null | Uint8Array => {
  const loose = join('game-src', GAME, `${folder.replace(/\.txd$/i, '')}.txd`);
  if (statSync(loose, { throwIfNoEntry: false })) {
    return new Uint8Array(readFileSync(loose));
  }
  const entry = archive.get(
    `${folder
      .split('/')
      .pop()!
      .replace(/\.txd$/i, '')}.txd`,
  );

  return entry ? new Uint8Array(entry) : null;
};

/** Bytes of a full mip chain, both encodings — the comparison the format decision is made on. */
const chainBytes = (width: number, height: number, alpha: boolean): { dxt: number; raw: number } => {
  let dxt = 0;
  let raw = 0;
  for (let h = height, w = width; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    raw += w * h * 4;
    dxt += alpha ? Math.max(16, w * h) : Math.max(8, (w * h) / 2);
    if (w === 1 && h === 1) {
      break;
    }
  }

  return { dxt, raw };
};

const walk = (dir: string, out: string[]): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walk(join(dir, entry.name), out);
    } else if (/\.png$/i.test(entry.name)) {
      out.push(dir);
    }
  }

  return out;
};

const folders = [...new Set(walk(ROOT, []))].filter((dir) => !dir.includes('screenshots')).sort();
let dxtTotal = 0;
let rawTotal = 0;
let replaced = 0;
let added = 0;
let followed = 0;
for (const folder of folders) {
  const parts = relative(ROOT, folder).split('/');
  const rel = parts.slice(
    parts.findIndex((part) => part === 'gta3_img' || part === 'gta_int_img' || part === 'models'),
  );
  const target = rel.join('/').replace(/^gta3_img\/|^gta_int_img\//, '');
  const txd = targetTxd(target);
  console.log(`\n${relative(ROOT, folder)}  →  ${txd ? target : 'NO STOCK TARGET'}`);
  const stock = txd ? rasters(txd) : new Map<string, Raster>();
  for (const file of readdirSync(folder).filter((name) => /\.png$/i.test(name))) {
    const name = file.replace(/\.png$/i, '');
    const { height, rgba, width } = decodePng(new Uint8Array(readFileSync(join(folder, file))));
    const existing = stock.get(name.toLowerCase());
    if (!existing) {
      added += 1;
      console.log(`  ${name.padEnd(24)} png ${width}x${height}  ADDS (no stock texture to follow)`);
      continue;
    }
    replaced += 1;
    const compressed = existing.d3d > 0xffff;
    let alpha = false;
    for (let i = 3; i < rgba.length; i += 4) {
      alpha ||= rgba[i] < 255;
    }
    const { dxt, raw } = chainBytes(width, height, alpha);
    if (!compressed) {
      followed += 1;
      dxtTotal += dxt;
      rawTotal += raw;
    }
    console.log(
      `  ${name.padEnd(24)} png ${width}x${height}  stock ${existing.width}x${existing.height} ` +
        `${compressed ? 'DXT' : 'uncompressed'} levels=${existing.levels}` +
        `${compressed ? '' : `  → kept uncompressed: ${Math.round(dxt / 1024)} → ${Math.round(raw / 1024)} KB`}`,
    );
  }
}
console.log(
  `\n${folders.length} folders · ${added} additions · ${replaced} replacements, ${followed} of them of an ` +
    `uncompressed raster: ${Math.round(dxtTotal / 1024)} KB as DXT, ${Math.round(rawTotal / 1024)} KB as they ` +
    `ship (+${((rawTotal - dxtTotal) / 1024 / 1024).toFixed(1)} MB), mip chains included`,
);
