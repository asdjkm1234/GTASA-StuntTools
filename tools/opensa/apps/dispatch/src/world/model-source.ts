/**
 * Where a unit's MODEL comes from (201/5-04).
 *
 * The pak carries cells, textures and collision — and nothing about a vehicle
 * (`docs/restrictions/build-vs-runtime.md`: *"the roster is TEXT, a spawn resolves `<model>.osm` by name"*).
 * So the console resolves a car the way the game does: by NAME, out of the archives of the same built game
 * the pak was made from, which is already served beside it — `PakBase.gameDir` is how `data/timecyc.dat`
 * reaches the map.
 *
 * The whole read is Range requests. `openLazyVer2` holds the archive DIRECTORY (32 bytes an entry) and
 * slices one entry when it is asked for, so a board of six unit types costs six model reads and never the
 * gigabyte the archive is. That is the same primitive the engine lab uses to inspect one model over HTTP —
 * no console-only format, no whole-archive download.
 *
 * Everything here degrades to NOTHING rather than to an error: `?demo=1` has no game dir, a pak served on
 * its own has no archives beside it, and a build converted without `--vehicles` has no `.osm` for a car.
 * Each of those is a unit that keeps its symbol and a line in the log, never a hole where a unit should be.
 */
import type { LazyImgArchive } from '@opensa/loaders/asset-local-loader/img-reader';
import type { OptimizedModel } from '@opensa/loaders/model-osm';

import { openLazyVer2, urlRangeSource } from '@opensa/loaders/asset-local-loader/img-reader';
import { readModelOsm } from '@opensa/loaders/model-osm';

/**
 * The archives a unit's model can live in, in resolution order.
 *
 * `vehicles.img` first because that is what a unit is today, and `gta3.img` last because it is the big one:
 * ~14 900 stock entries is ~477 kB of directory, and a board that only ever draws cars must not pay it. They
 * are opened one at a time, on the first read that needs them.
 */
const ARCHIVES = ['models/vehicles.img', 'models/vehicles2.img', 'models/peds.img', 'models/gta3.img'] as const;

/** One converted model, by bare name. */
export interface ModelSource {
  /** Names asked for that no archive carried — what the log and the report say went undrawn. */
  readonly missing: ReadonlySet<string>;
  /** `null` when this build carries no such model. Throws only when the bytes are there and unreadable. */
  read(name: string): Promise<null | OptimizedModel>;
}

/**
 * Open the model source for a served game dir. `null` when there is no game dir at all (the demo) — the
 * archives themselves are probed lazily, because a missing one is the normal case for a pak-only deploy.
 */
export function openModelSource(gameDir: string): ModelSource | null {
  if (gameDir === '') {
    return null;
  }
  const opened = new Map<string, Promise<LazyImgArchive | null>>();
  const missing = new Set<string>();
  const archive = (path: string): Promise<LazyImgArchive | null> => {
    const cached = opened.get(path);
    if (cached) {
      return cached;
    }
    const opening = openArchive(`${gameDir}/${path}`);
    opened.set(path, opening);

    return opening;
  };

  return {
    missing,
    async read(name: string): Promise<null | OptimizedModel> {
      const entry = `${name.toLowerCase()}.osm`;
      for (const path of ARCHIVES) {
        const source = await archive(path);
        const bytes = await source?.read(entry);
        if (bytes) {
          return readModelOsm(name, bytes);
        }
      }
      missing.add(name);

      return null;
    },
  };
}

/** Open one archive over Range requests, or `null` when it is not served (a pak deployed without its game). */
async function openArchive(url: string): Promise<LazyImgArchive | null> {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = Number(head.headers.get('content-length') ?? 0);
    if (!head.ok || size === 0) {
      return null;
    }

    return await openLazyVer2(urlRangeSource(url, size));
  } catch {
    return null; // an archive that cannot be opened is one the board draws symbols for
  }
}
