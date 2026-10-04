import { mergeTxdBytes } from '@opensa/mod-installer/txd-folder';
import { type ImgArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readBytes } from './game';

/**
 * Offline mirror of the build's per-file asset resolution (mod-installer's ordering) for debug
 * scripts that need "the DFF/TXD the build actually used" WITHOUT a build: the last mod shipping a
 * file wins (numeric folder order), PNG texture-folders patch the dictionary in place, vanilla is
 * the base. Covers `gta3_img`/`gta_int_img` trees only — loose `models/` overlays and bake-mod
 * loaders are out of scope (world models all travel through the IMG folders).
 */

export interface ModAssets {
  /** basename (no ext) → absolute path of the LAST mod's dff. */
  dff: Map<string, string>;
  /** txd basename (no ext) → ordered replace/patch events across mods. */
  txd: Map<string, { kind: 'file' | 'png'; path: string }[]>;
}

/** Walk every mod's gta3_img trees once, in install order, indexing dff replacements + txd events. */
export function indexModAssets(modsDir: string): ModAssets {
  const assets: ModAssets = { dff: new Map(), txd: new Map() };
  if (!existsSync(modsDir)) return assets;
  const pushTxd = (base: string, event: { kind: 'file' | 'png'; path: string }): void => {
    let events = assets.txd.get(base);
    if (!events) assets.txd.set(base, (events = []));
    events.push(event);
  };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const pngs = readdirSync(full).some((f) => f.toLowerCase().endsWith('.png'));
        if (pngs) {
          pushTxd(entry.name.toLowerCase().replace(/\.txd$/, ''), { kind: 'png', path: full });
        } else {
          walk(full);
        }
      } else {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.dff')) assets.dff.set(lower.slice(0, -4), full);
        else if (lower.endsWith('.txd')) pushTxd(lower.slice(0, -4), { kind: 'file', path: full });
      }
    }
  };
  for (const mod of sortMods(readdirSync(modsDir).filter((n) => statSync(join(modsDir, n)).isDirectory()))) {
    for (const imgFolder of ['gta3_img', 'gta_int_img']) {
      const root = join(modsDir, mod, imgFolder);
      if (existsSync(root)) walk(root);
    }
  }

  return assets;
}

/** Chain-resolve one DFF: the last mod shipping the file wins, else the vanilla archive. */
export function resolveDff(
  model: string,
  mods: ModAssets,
  vanilla: ImgArchive,
): null | { bytes: Uint8Array; from: string } {
  const modPath = mods.dff.get(model);
  if (modPath) return { bytes: readBytes(modPath), from: modFolderOf(modPath) };
  const vanillaBytes = vanilla.get(`${model}.dff`);

  return vanillaBytes ? { bytes: new Uint8Array(vanillaBytes), from: 'vanilla' } : null;
}

/** Chain-resolve one TXD: vanilla base, then each mod's whole-file replace or PNG-folder patch in order. */
export function resolveTxd(txd: string, mods: ModAssets, vanilla: ImgArchive): null | Uint8Array {
  const vanillaBytes = vanilla.get(`${txd}.txd`);
  let current: null | Uint8Array = vanillaBytes ? new Uint8Array(vanillaBytes) : null;
  for (const event of mods.txd.get(txd) ?? []) {
    if (event.kind === 'file') current = readBytes(event.path);
    else if (current) current = mergeTxdBytes(event.path, current, `${txd}.txd`).bytes;
  }

  return current;
}

/** Numeric-aware mod folder order — mirrors mod-installer's sortMods. */
export function sortMods(names: string[]): string[] {
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en', { numeric: true }));
}

/** The `N. Name` mod folder a `<mod>/gta3_img/**` asset path belongs to. */
function modFolderOf(assetPath: string): string {
  const parts = assetPath.split('/');
  const index = parts.findIndex((p) => p === 'gta3_img' || p === 'gta_int_img');

  return index > 0 ? parts[index - 1] : basename(assetPath);
}
