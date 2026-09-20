/**
 * Where the lab reads a district from (opensa-pack 003 phase 4).
 *
 * `?src=` now names an opensa-pack `--out`, which is a GAME DIR with our products under `opensa/`. That is
 * what lets the manifest stop carrying `timecyc`: the game's own `data/timecyc*.dat` sits right there, so
 * the lab reads the same file the production host reads instead of a copy frozen at convert time (the
 * 2026-07-18 black-night / fog-divergence class of bug).
 *
 * A `?src=` that points straight at a products directory — every pak under `apps/engine-lab/public/` today —
 * still loads; it simply has no game dir beside it, and the environment falls back to the parametric driver.
 */

import { resolveTimecycSourceAsync, type TimecycSource } from '@opensa/renderware/parsers/text/timecyc-source';

/** Timecyc text plus which of the three names supplied it — prod's order, resolved the same way here. */
export type LabTimecyc = TimecycSource;

export interface PakSource {
  /** Where `manifest.json` / `world.ospak` live. */
  base: string;
  /** The game dir holding `data/`, or null for a bare products directory. */
  gameDir: null | string;
}

/** The game's timecyc, through prod's own candidate order (`TIMECYC_SOURCES`, plan 104/01). */
export async function loadLabTimecyc(source: PakSource): Promise<LabTimecyc | null> {
  const gameDir = source.gameDir;
  if (gameDir === null) {
    return null;
  }

  return resolveTimecycSourceAsync((path) => text(`${gameDir}/${path}`));
}

/** Resolve `?src=` to a products base. Probes, in order: a SELF-CONTAINED game dir (`<src>/pak/manifest.json`,
 *  plan 086 phase 8), a pmb BUILD ROOT (`<src>/opensa/pak/manifest.json`), the short-lived phase-7 sibling
 *  (`<src>/opensa-pack/manifest.json`), the legacy nested pak (`<src>/opensa/manifest.json`), else `<src>`
 *  IS the products dir. An absolute URL (a build served cross-origin, e.g. `http://localhost:3001/build/...`)
 *  passes through as-is; a bare name is made root-relative to the lab's own origin. */
export async function resolvePakSource(src: string): Promise<PakSource> {
  const root = /^(?:https?:)?\/\//.test(src) ? src.replace(/\/+$/, '') : `/${src.replace(/^\/+|\/+$/g, '')}`;
  if (await exists(`${root}/pak/manifest.json`)) {
    return { base: `${root}/pak`, gameDir: root };
  }
  if (await exists(`${root}/opensa/pak/manifest.json`)) {
    return { base: `${root}/opensa/pak`, gameDir: `${root}/opensa` };
  }
  if (await exists(`${root}/opensa-pack/manifest.json`)) {
    return { base: `${root}/opensa-pack`, gameDir: `${root}/opensa` };
  }
  if (await exists(`${root}/opensa/manifest.json`)) {
    return { base: `${root}/opensa`, gameDir: root };
  }

  return { base: root, gameDir: null };
}

async function exists(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

async function text(url: string): Promise<null | string> {
  try {
    const response = await fetch(url);

    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}
