import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { warnDroppedCollisions } from './col-replace';
import { applyStreamMerge, isStreamMerge } from './stream-merge';
import { warnUnalignedDxt } from './txd-alignment';
import { mergeTxdBytes } from './txd-folder';

/**
 * Apply a mod's `<name>.ipl.merge` stream edits from an IMG folder onto the archive's entries (add/remove/
 * replace instances — `stream-merge.ts`). Runs AFTER the mod's data merges. Returns the number applied.
 */
export function applyStreamMergeDir(imgDir: string, imgPath: string): number {
  const merges = readdirSync(imgDir, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && isStreamMerge(entry.name),
  );
  if (merges.length === 0) {
    return 0;
  }
  if (!existsSync(imgPath)) {
    throw new Error(`stream merge target archive does not exist: ${imgPath}`);
  }
  const img = openImg(readBytes(imgPath));
  for (const merge of merges) {
    const entryName = merge.name.slice(0, -'.merge'.length);
    const entry = img.get(entryName);
    if (!entry) {
      throw new Error(`stream merge target entry does not exist in ${imgPath}: ${entryName}`);
    }
    const { bytes, warnings } = applyStreamMerge(entry, readFileSync(join(imgDir, merge.name), 'utf8'), entryName);
    for (const warning of warnings) {
      console.warn(`mod-installer: ${warning}`);
    }
    img.set(entryName, bytes);
  }
  writeImgFile(img, imgPath);

  return merges.length;
}

/**
 * Set `name → bytes` entries into the `.img` at `imgPath` (add new / replace existing by name), rebuild + write;
 * seeds a fresh archive if `imgPath` is absent. Used both by {@link mergeImgDir} (a `gta3_img/`/`gta_int_img/`
 * folder) and by the Modloader baker (scattered `.dff`/`.txd`/`.col`/`.ifp` collected by bare name). Returns the
 * number of operations applied.
 */
export function injectImgEntries(entries: ReadonlyMap<string, Uint8Array>, imgPath: string, origin = 'a mod'): number {
  if (entries.size === 0) {
    return 0;
  }
  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const [name, bytes] of entries) {
    warnDroppedCollisions(name, img.get(name) ?? undefined, bytes);
    warnUnalignedDxt(name, bytes, origin);
    img.set(name, bytes);
  }
  writeImgFile(img, imgPath);

  return entries.size;
}

/**
 * Merge a mod's loose IMG-folder files (`gta3_img/` → `gta3.img`, `gta_int_img/` → `gta_int.img`) into the
 * archive at `imgPath`: `set` each file as an entry (adding new ones, replacing existing by name), then rebuild +
 * write. If `imgPath` doesn't exist yet, the loose files seed a fresh archive. (The `*_img/` folder is the
 * generic "loose IMG entries" convention — a binary `.img` can't be patched file-by-file, so a mod ships a
 * folder.) `<name>.ipl.merge` files are NOT entries — they EDIT the named stream entry (plan 008) and are
 * applied by {@link applyStreamMergeDir} in a later pass (after the mod's data merges, whose inst removals
 * rebase the streams first).
 *
 * Subfolders (plan 009):
 * - A subfolder containing PNGs is a **texture folder for an IMG-internal `.txd`**: its PNGs merge into the
 *   entry `<folder>.txd` (add/replace by texture name — the loose-txd convention of plan 003, reaching inside
 *   the archive). Applied AFTER this mod's file entries, so a `.txd` the mod also ships is patched, not lost.
 *   A texture folder whose entry is missing is a LOUD warning, not a silent skip.
 * - Any other subfolder is organisational: recurse, collecting files by bare name (real packs ship
 *   `gta3_img/LV/…` layouts — these were silently ignored before plan 009). **`Remove original/` is one of
 *   them** — its files are REPLACEMENTS, not a delete list (`docs/contracts/mods.md`; field-found 2026-08-10).
 *
 * Returns the number of operations applied.
 */
export function mergeImgDir(imgDir: string, imgPath: string, origin = 'a mod'): number {
  const entries = new Map<string, Uint8Array>();
  const textureFolders: { name: string; path: string }[] = [];
  const collect = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isFile()) {
        if (!isStreamMerge(entry.name)) {
          entries.set(entry.name, readBytes(entryPath));
        }
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (readdirSync(entryPath, { withFileTypes: true }).some((e) => e.isFile() && /\.png$/i.test(e.name))) {
        textureFolders.push({ name: entry.name, path: entryPath });
      } else {
        collect(entryPath);
      }
    }
  };
  collect(imgDir);
  if (entries.size === 0 && textureFolders.length === 0) {
    return 0;
  }

  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const [name, bytes] of entries) {
    warnDroppedCollisions(name, img.get(name) ?? undefined, bytes);
    warnUnalignedDxt(name, bytes, origin);
    img.set(name, bytes);
  }
  let merged = 0;
  for (const folder of textureFolders) {
    // Same tolerance as the loose-file path: `previon/` and `previon.txd/` both target the `previon.txd` entry.
    const entryName = /\.txd$/i.test(folder.name) ? folder.name : `${folder.name}.txd`;
    const existing = img.get(entryName);
    if (!existing) {
      console.warn(`mod-installer: texture folder ${folder.path} — no entry ${entryName} in ${imgPath}`);
      continue;
    }
    const result = mergeTxdBytes(folder.path, new Uint8Array(existing), entryName);
    if (result.merged > 0) {
      // OUR encoder, the mod's PNG: a 250×250 PNG becomes a 250×250 DXT — the same dead dictionary.
      warnUnalignedDxt(entryName, result.bytes, `${origin} (texture folder ${folder.name})`);
      img.set(entryName, result.bytes);
      merged += result.merged;
    }
  }
  writeImgFile(img, imgPath);

  return entries.size + merged;
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
