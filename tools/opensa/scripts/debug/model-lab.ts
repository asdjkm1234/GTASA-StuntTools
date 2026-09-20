import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { encodeHalvedTxd } from '@opensa/lod-common/encode-txd';
import { createTextureSource, resolveFrom, type TextureSource } from '@opensa/lod-common/texture-source';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { openLazyVer2 } from '@opensa/tool-kit/archive/layout';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { LodLink } from '../../tools/sa-lod-generator/src/core/types';

import { type BuildStats, cloneLodDff } from '../../tools/sa-lod-generator/src/adapters/gta-sa/finalize';
import { resolveLodLinks } from '../../tools/sa-lod-generator/src/adapters/gta-sa/resolve';
import { perObjectLinks } from '../../tools/sa-lod-generator/src/core/report';
import { config as lodConfig } from '../../tools/sa-lod-generator/src/lod.config';
import { findArchivesWithEntry, patchImgEntry, readImgEntry } from '../lib/img-patch';
import { optimizeModel, type OptimizeVariant, printGeometryDiff, variantFromArgv } from '../lib/optimize-model';

/**
 * ONE model, the whole `sa` pipeline the field sees, in seconds: take an HD DFF (vanilla, from any game dir's
 * archives, or a loose file out of a mod), run the map-optimizer geometry chain in a named variant
 * (`scripts/lib/optimize-model.ts`), cut its clone LOD from the RESULT the way `sa-lod-generator` does
 * (`cloneLodDff` — the run config's decimate budget, 2dfx policy, verbatim otherwise), and patch exactly what
 * the built tree needs — the HD `.dff`, the LOD `.dff` and, when a texture is given, the HD `.txd` plus a
 * regenerated clone TXD (`texScale` DXT, full atlas under the LOD's current `salodNNNN` name) — into that
 * tree's archives in place (`scripts/lib/img-patch.ts`). Clones are cut FROM the HD, so an HD-side variant
 * has to reach the LOD too or the far view keeps the old defect: that is what this script exists for.
 *
 * The HD↔LOD link is read from the built tree's own IDE/IPL (`resolveLodLinks`), so the LOD name, its clone
 * TXD and the HD's atlas are whatever the build actually shipped. An HD whose LOD the build left stock
 * (shared / dual-role / tiny / hole) gets its HD patched and a note; nothing else moves.
 *
 * Run:
 *   npx tsx scripts/debug/model-lab.ts <model> --tree build/bisect-nomods/sa
 *       (--src game-src/original | --dff <file.dff> [--txd <file.txd>])
 *       [--no-add-normals | --strip-normals-after | --list-only | --restrip | --raw] [--crease <deg>] [--out build/model-lab] [--dry]
 * `--dry` writes the outputs and prints the plan without touching the tree. Undo:
 *   npx tsx scripts/debug/img-patch.ts restore <hd>.dff --game <tree>   (and <lod>.dff, the .txds)
 */
interface Options {
  readonly crease: number | undefined;
  readonly dff: string | undefined;
  readonly dry: boolean;
  readonly model: string;
  readonly out: string;
  readonly src: string | undefined;
  readonly tree: string;
  readonly txd: string | undefined;
  readonly variant: OptimizeVariant;
}

interface Patch {
  readonly bytes: Uint8Array;
  readonly entry: string;
}

function atlasView(source: TextureSource, hdTxd: string): TextureSource {
  return {
    get: (name) => resolveFrom(source, hdTxd, name),
    getFrom: (txd, name) => source.getFrom?.(txd, name) ?? null,
  };
}

function emptyBuildStats(): BuildStats {
  return {
    clonedLods: 0,
    decimatedLods: 0,
    filledHoles: 0,
    filledInstances: 0,
    generatedTxds: 0,
    mergedLods: 0,
    missingHd: 0,
    missingTxd: 0,
    parentTextures: 0,
    retransformedLods: 0,
    skippedHoles: 0,
    skippedShared: 0,
  };
}

/** The tree's link for this HD model, or null when the build has no per-object clone LOD for it. */
function findLink(tree: string, model: string): { link: LodLink | null; note: string } {
  const gta3 = openLazyVer2(join(tree, 'models', 'gta3.img'));
  if (!gta3) throw new Error(`${tree}/models/gta3.img is not a VER2 archive`);
  const resolved = resolveLodLinks(join(tree, 'data'), gta3);
  const all = resolved.links.filter((link) => link.hdModel === model);
  if (all.length === 0) return { link: null, note: 'no LOD link in the tree (HD only)' };
  const perObject = perObjectLinks(resolved.links).filter((link) => link.hdModel === model);
  if (perObject.length === 0) {
    return { link: null, note: `LOD ${all[0].lodModel} is shared by several HDs — the build left it stock` };
  }
  const link = perObject[0];
  if (!link.lodTxd.startsWith('salod')) {
    return { link: null, note: `LOD ${link.lodModel} keeps its stock txd ${link.lodTxd} — the build did not clone it` };
  }

  return { link, note: `LOD ${link.lodModel} (txd ${link.lodTxd}, HD atlas ${link.hdTxd})` };
}

/** The clone LOD (and, with a loose TXD, the HD + clone TXDs) for an HD result — the sa stage's decisions. */
function lodPatches(options: Options, hd: Uint8Array, hdTxdBytes: null | Uint8Array): Patch[] {
  const { link, note } = findLink(options.tree, options.model);
  console.log(`  ${note}`);
  if (!link) {
    return hdTxdBytes
      ? [{ bytes: hdTxdBytes, entry: `${basename(options.txd as string, '.txd').toLowerCase()}.txd` }]
      : [];
  }
  if (options.txd && basename(options.txd, '.txd').toLowerCase() !== link.hdTxd) {
    console.warn(`  ⚠ --txd is ${basename(options.txd)} but the tree's IDE names ${link.hdTxd}.txd for this model`);
  }
  const hdTxdSource = hdTxdBytes ?? readTreeEntry(options.tree, `${link.hdTxd}.txd`);
  const textures = hdTxdSource ? createTextureSource([singleTxdArchive(link.hdTxd, hdTxdSource)]) : null;
  const budget = lodConfig.decimateBudget ?? 0;
  const decimate = textures && budget > 0 ? createBudgetedDecimate({ pixelBudget: budget }) : null;
  const stats = emptyBuildStats();
  const atlas: TextureSource = textures ? atlasView(textures, link.hdTxd) : { get: () => null };
  const lod = cloneLodDff(hd, link, decimate, atlas, stats, lodConfig.keepParticles ?? true);
  console.log(
    `  LOD ${link.lodModel}: ${lod.length} B (${stats.decimatedLods ? 'decimated' : stats.mergedLods ? 'merged multi-atomic' : 'verbatim clone'})`,
  );
  const patches: Patch[] = [{ bytes: lod, entry: `${link.lodModel}.dff` }];
  if (hdTxdBytes && textures) {
    const halvings = Math.max(0, Math.round(Math.log2(1 / (lodConfig.texScale ?? 0.25))));
    const names = parseTxd(toArrayBuffer(hdTxdBytes)).textures.map((texture) => texture.name);
    const cloneTxd = encodeHalvedTxd(names, atlas, halvings, 'gamma');
    console.log(
      `  clone TXD ${link.lodTxd}: ${names.length} textures at ${lodConfig.texScale}× → ${cloneTxd.length} B`,
    );
    patches.push({ bytes: hdTxdBytes, entry: `${link.hdTxd}.txd` }, { bytes: cloneTxd, entry: `${link.lodTxd}.txd` });
  }

  return patches;
}

function main(): void {
  const options = parseArgs();
  mkdirSync(options.out, { recursive: true });
  const hdSource = readHdSource(options);
  const hdTxdBytes = options.txd ? new Uint8Array(readFileSync(options.txd)) : null;
  const hd = optimizeModel(options.model, hdSource, options.variant, options.crease);
  printGeometryDiff(`${options.model} [${options.variant}]`, hdSource, hd);
  const patches: Patch[] = [{ bytes: hd, entry: `${options.model}.dff` }, ...lodPatches(options, hd, hdTxdBytes)];
  for (const patch of patches) {
    const outPath = join(options.out, `${patch.entry.slice(0, -4)}.${options.variant}.${patch.entry.slice(-3)}`);
    writeFileSync(outPath, patch.bytes);
    console.log(`  → ${outPath}`);
    if (options.dry) continue;
    const archives = findArchivesWithEntry(options.tree, patch.entry);
    if (archives.length === 0) throw new Error(`${patch.entry} is in no archive of ${options.tree}`);
    for (const img of archives) {
      const { appendedAt } = patchImgEntry(img, patch.entry, patch.bytes);
      console.log(`  patched ${patch.entry} → ${img} (appended at ${appendedAt})`);
    }
  }
}

function parseArgs(): Options {
  const values = ['--tree', '--src', '--dff', '--txd', '--crease', '--out'].map((flag) => argValue(flag));
  const flagValues = new Set(values);
  const positionals = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
  const [tree, src, dff, txd, crease, out] = values;
  if (positionals.length !== 1 || !tree)
    throw new Error('usage: model-lab.ts <model> --tree <built dir> (--src <dir> | --dff <file>) …');
  if ((src === undefined) === (dff === undefined))
    throw new Error('give exactly one of --src <game dir> / --dff <file>');

  return {
    crease: crease === undefined ? undefined : Number(crease),
    dff: dff === undefined ? undefined : fromCwd(dff),
    dry: process.argv.includes('--dry'),
    model: positionals[0].toLowerCase(),
    out: fromCwd(out ?? 'build/model-lab'),
    src: src === undefined ? undefined : fromCwd(src),
    tree: fromCwd(tree),
    txd: txd === undefined ? undefined : fromCwd(txd),
    variant: variantFromArgv(),
  };
}

function readHdSource(options: Options): Uint8Array {
  if (options.dff) {
    if (!existsSync(options.dff)) throw new Error(`${options.dff} does not exist`);

    return new Uint8Array(readFileSync(options.dff));
  }
  const src = options.src as string;
  const archives = findArchivesWithEntry(src, `${options.model}.dff`);
  if (archives.length === 0) throw new Error(`${options.model}.dff is in no archive of ${src}`);

  return readImgEntry(archives[archives.length - 1], `${options.model}.dff`);
}

function readTreeEntry(tree: string, entry: string): null | Uint8Array {
  const archives = findArchivesWithEntry(tree, entry);

  return archives.length === 0 ? null : readImgEntry(archives[archives.length - 1], entry);
}

/** One name → bytes archive, so `createTextureSource` indexes ONE atlas instead of the whole `gta3.img`. */
function singleTxdArchive(txdName: string, bytes: Uint8Array): ImgArchive {
  const entry = `${txdName}.txd`.toLowerCase();

  return {
    get: (name) => (name.toLowerCase() === entry ? toArrayBuffer(bytes) : null),
    names: [entry],
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
