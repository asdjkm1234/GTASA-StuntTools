import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { mergeIdeFile } from './ide-merge';
import { applyStreamMergeDir, mergeImgDir } from './img-merge';
import { patchAreaStreams } from './stream-merge';
import { warnUnalignedDxt } from './txd-alignment';
import { mergeTxdFolder } from './txd-folder';

/** Special-cased top-level mod folders — their loose files merge into the matching IMG instead of being copied. */
const IMG_FOLDERS: ReadonlyMap<string, string> = new Map([
  ['cutscene_img', join('models', 'cutscene.img')],
  ['gta3_img', join('models', 'gta3.img')],
  ['gta_int_img', join('models', 'gta_int.img')],
]);

/**
 * Apply one mod over the current `--out`: overlay every top-level entry except the IMG folders (recursively — see
 * {@link applyEntry}, which also turns a PNG folder beside a loose `.txd` into a texture merge), then merge the
 * mod's `gta3_img/` / `gta_int_img/` loose entries into `<out>/models/gta3.img` / `gta_int.img`, and finally
 * apply its `*.merge` data-file edits (after the overlay, so a target this mod also ships is in place first).
 * Returns the copied-entry + merged-IMG counts.
 */
export function applyMod(modPath: string, outPath: string): { copied: number; merged: number } {
  const origin = basename(modPath);
  let copied = 0;
  let merged = 0;
  const merges: { source: string; target: string }[] = [];
  for (const entry of readdirSync(modPath)) {
    if (IMG_FOLDERS.has(entry.toLowerCase())) {
      continue;
    }
    // `CLEO/` → `cleo/`: the canonical on-disk spelling is lowercase (plan 097/06 decision 1); authors ship both.
    const dest = entry.toLowerCase() === 'cleo' ? 'cleo' : entry;
    const result = applyEntry(join(modPath, entry), join(outPath, dest), merges, origin);
    copied += result.copied;
    merged += result.merged;
  }

  for (const [folder, imgPath] of IMG_FOLDERS) {
    const imgDir = join(modPath, folder);
    if (existsSync(imgDir) && statSync(imgDir).isDirectory()) {
      merged += mergeImgDir(imgDir, join(outPath, imgPath), origin);
    }
  }

  for (const merge of merges) {
    if (!existsSync(merge.target)) {
      throw new Error(`.merge target does not exist in the install: ${merge.target}`);
    }
    const { removedInst, warnings } = mergeIdeFile(merge.source, merge.target);
    for (const warning of warnings) {
      console.warn(`mod-installer: ${merge.source}: ${warning}`);
    }
    if (removedInst.length > 0) {
      // mirror the text-row deletions into the area's binary streams (plan 008)
      patchAreaStreams(outPath, merge.target, removedInst);
    }
    merged += 1;
  }

  // Stream merges LAST — their rows are written in the final (post-rebase) index space.
  for (const [folder, imgPath] of IMG_FOLDERS) {
    const imgDir = join(modPath, folder);
    if (existsSync(imgDir) && statSync(imgDir).isDirectory()) {
      merged += applyStreamMergeDir(imgDir, join(outPath, imgPath));
    }
  }

  return { copied, merged };
}

/**
 * Apply one mod entry over `--out`. A **file** is copied (overwrite); a **`*.merge` file** is collected for the
 * post-overlay merge pass instead (it EDITS its suffix-less target — see `ide-merge.ts`). A **directory** whose
 * sibling `<dir>.txd` already exists as a loose file in `--out` is a **texture folder** — its PNGs merge into
 * that `.txd` (add / replace by name) instead of being copied (e.g. `models/generic/vehicle/` →
 * `models/generic/vehicle.txd`); a folder the author named `vehicle.txd/` targets the same file. Otherwise it is a plain folder: recurse, copying **files first then
 * subfolders** so a `.txd` this mod also ships is in place before a sibling folder merges into it.
 */
function applyEntry(
  srcPath: string,
  dstPath: string,
  merges: { source: string; target: string }[],
  origin = 'a mod',
): { copied: number; merged: number } {
  if (!statSync(srcPath).isDirectory()) {
    if (srcPath.toLowerCase().endsWith('.merge')) {
      merges.push({ source: srcPath, target: dstPath.slice(0, -'.merge'.length) });

      return { copied: 0, merged: 0 };
    }
    // A loose `.txd` overlay (`models/generic/vehicle.txd` …) reaches the game as-is, so it is judged too.
    if (srcPath.toLowerCase().endsWith('.txd')) {
      warnUnalignedDxt(basename(srcPath), new Uint8Array(readFileSync(srcPath)), origin);
    }
    cpSync(srcPath, dstPath, { force: true });

    return { copied: 1, merged: 0 };
  }

  // The folder may be named `vehicle` (the documented form) or `vehicle.txd` — authors write both, and the
  // second one used to reach `mkdirSync` over the REAL `vehicle.txd` file and die on a bare EEXIST that named
  // neither the mod nor the rule (mod "55. Tiers faces on the asphalt from GTA 4" ships `models/particle.txd/`).
  const txdPath = /\.txd$/i.test(dstPath) ? dstPath : `${dstPath}.txd`;
  if (existsSync(txdPath) && statSync(txdPath).isFile()) {
    return { copied: 0, merged: mergeTxdFolder(srcPath, txdPath) };
  }

  mkdirSync(dstPath, { recursive: true });
  const entries = readdirSync(srcPath, { withFileTypes: true });
  // A folder of PNGs with no dictionary to patch is the shape the IMG side already warns about: the mod
  // ships a WHOLE dictionary unpacked, and nothing here can create it (`scripts/debug/txd-from-pngs.ts`
  // does). The files are still copied — harmless, and a future rule may make the folder itself valid.
  if (entries.some((entry) => entry.isFile() && /\.png$/i.test(entry.name))) {
    console.warn(`mod-installer: texture folder ${srcPath} — no ${txdPath} to merge into; copying as files`);
  }
  let copied = 0;
  let merged = 0;
  for (const wantDir of [false, true]) {
    for (const entry of entries.filter((e) => e.isDirectory() === wantDir)) {
      const result = applyEntry(join(srcPath, entry.name), join(dstPath, entry.name), merges);
      copied += result.copied;
      merged += result.merged;
    }
  }

  return { copied, merged };
}
