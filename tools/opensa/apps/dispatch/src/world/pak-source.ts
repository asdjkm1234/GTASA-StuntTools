/**
 * Where the world comes from. `?src=` names a built game (a `perfect-map-builder --out`), and this probes the
 * layouts a build can have, exactly as the engine lab does — a dispatcher should not have to know whether the
 * pak sits under `opensa/pak/` or at the root of what was served.
 *
 * The default is `build/original`, because a field run reads `build/<game>/opensa` and nothing else: pointing
 * this at `game-src/` would render a world the game is not running.
 */

/** The default `?src=`, relative to whatever origin serves the app. */
export const DEFAULT_SRC = 'build/original';

/** Resolved location of `manifest.json` / `world.ospak` / `water.bin`. */
export interface PakBase {
  /** The URL base the streaming setup and the water loader both read from. */
  readonly base: string;
  /** The game dir beside the pak — where `data/timecyc.dat` lives, so the map is lit as the game lights it. */
  readonly gameDir: string;
  /** What was probed, for the error message when nothing matched. */
  readonly probed: readonly string[];
}

/**
 * Resolve `?src=` to a products base. An absolute URL passes through (a build served on another port); a bare
 * name is made root-relative to this app's own origin.
 */
export async function resolvePakBase(src: string): Promise<PakBase> {
  const root = rootOf(src);
  const candidates = [`${root}/pak`, `${root}/opensa/pak`, `${root}/opensa`, root];
  for (const candidate of candidates) {
    if (await exists(`${candidate}/manifest.json`)) {
      return { base: candidate, gameDir: candidate.replace(/\/pak$/, ''), probed: candidates };
    }
  }

  throw new Error(
    `no pak manifest under '${src}'. Probed: ${candidates.map((path) => `${path}/manifest.json`).join(', ')}. ` +
      `Build one with \`npm run build:game:original:opensa\`, or pass ?src=<path to a built game>.`,
  );
}

/**
 * The flat map's whole tile pyramid, one file beside the built game (201/6-02).
 *
 * A NAME that carries behaviour, so it is written down in `docs/contracts/`: the console looks for exactly
 * this file and draws the grid instead when it is not there. Misspelling it is silent by nature — a flat map
 * with no tiles looks like one that has not finished loading.
 */
export const TILES_FILE = 'tiles.pmtiles';

/** Where the pyramid is, for a given `?src=`. `?tiles=` overrides it with any URL. */
export function resolveTilesUrl(src: string, override: null | string): string {
  return override === null || override === '' ? `${rootOf(src)}/${TILES_FILE}` : override;
}

async function exists(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/** `?src=` as a URL base: an absolute URL passes through, a bare name is root-relative to this origin. */
function rootOf(src: string): string {
  return /^(?:https?:)?\/\//.test(src) ? src.replace(/\/+$/, '') : `/${src.replace(/^\/+|\/+$/g, '')}`;
}
