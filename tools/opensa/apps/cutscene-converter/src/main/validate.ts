import {
  checkCoverage,
  checkDirectory,
  checkGameFolder,
  checkSaExe,
  checkWritable,
  collect,
  type Verdict,
  type VerdictReport,
} from '@opensa/validation';
/**
 * The three validations behind the three folder pickers. Every SA question is ASKED of the tool that owns
 * the data (`@opensa/vehicle-cutscene`'s census); `@opensa/validation` only shapes the answers.
 */
import { loadCensus, matchMods } from '@opensa/vehicle-cutscene/census';
import { readdirSync, statfsSync } from 'node:fs';
import { resolve } from 'node:path';

/** One measured fleet: cutscene.img 321 MB + cuts.img 257 MB, plus room to write them. */
const NEEDED_BYTES = 1024 ** 3;

export function validateCars(gamePath: string, carsPath: string): VerdictReport {
  const folder = checkDirectory(carsPath, 'cars folder');

  if (folder[0].level === 'error') {
    return collect(folder);
  }

  const loose = checkLooseCars(carsPath);

  if (loose.length > 0) {
    return collect([...folder, ...loose]);
  }

  try {
    const census = loadCensus(gamePath);
    const readiness = matchMods(census.slots, carsPath);

    return collect([
      ...folder,
      ...checkCoverage(
        {
          items: readiness.map((entry) => ({
            id: entry.slot.csName,
            ready: entry.status === 'ready',
            reason: entry.status,
          })),
        },
        'cutscene slots',
      ),
    ]);
  } catch (error: unknown) {
    const unreadable: Verdict = {
      code: 'cars.unreadable',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Choose a folder of car mods — one subfolder per car, each holding its .dff and .txd.',
      level: 'error',
      message: 'That folder could not be read as a set of car mods.',
    };

    return collect([...folder, unreadable]);
  }
}

export function validateGame(gamePath: string): VerdictReport {
  const folder = checkGameFolder(gamePath);

  // No point fingerprinting an exe in a folder that is not a game — the file list already said so.
  return collect(folder.some((verdict) => verdict.level === 'error') ? folder : [...folder, ...checkSaExe(gamePath)]);
}

export function validateOut(gamePath: string, outPath: string): VerdictReport {
  if (samePath(gamePath, outPath)) {
    return collect([
      {
        code: 'out.is-game',
        detail: outPath,
        fix: 'Choose an empty folder. Copy the result into the game yourself once you have looked at it.',
        level: 'error',
        message: 'The output folder is the game folder.',
      },
    ]);
  }

  const folder = checkDirectory(outPath, 'output folder');

  if (folder[0].level === 'error') {
    return collect(folder);
  }

  return collect([...folder, ...checkWritable(outPath, 'output folder'), ...checkFreeSpace(outPath)]);
}

/**
 * `cutscene.img` + `cuts.img` are ~600 MB, and the run only discovers a full disk half-way through. A
 * WARNING rather than a block: the figure is what one fleet measured, not a law, and the user may know
 * their disk better than we do.
 */
function checkFreeSpace(path: string): Verdict[] {
  const free = statfsSync(path);
  const bytes = free.bavail * free.bsize;

  if (bytes >= NEEDED_BYTES) {
    return [];
  }

  return [
    {
      code: 'out.low-space',
      detail: `${gigabytes(bytes)} free at ${path}`,
      fix: `Free up some space or choose another disk — a converted fleet is about ${gigabytes(NEEDED_BYTES)}.`,
      level: 'warning',
      message: `That disk has ${gigabytes(bytes)} free.`,
    },
  ];
}

/**
 * The one shape mistake that reads as "your cars are wrong". A vehicles folder is resolved from its
 * SUBFOLDERS (`resolveVehicleSources`), so `.dff`s dropped straight into it match nothing and the only thing
 * said is "0 of 23 cutscene slots are covered" — which sends the user off checking file names. Say what is
 * actually wrong, and only in the unambiguous case: no subfolders at all, and loose models sitting there.
 */
function checkLooseCars(carsPath: string): Verdict[] {
  const entries = readdirSync(carsPath, { withFileTypes: true });

  if (entries.some((entry) => entry.isDirectory())) {
    return [];
  }

  const dffs = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.dff'));

  if (dffs.length === 0) {
    return [];
  }

  return [
    {
      code: 'cars.loose-files',
      detail: `${carsPath} holds ${dffs.length} .dff file(s) and no subfolders`,
      fix: 'Give every car its own subfolder — "bobcat - 1988 GMC Sierra 1500" holding bobcat.dff and bobcat.txd.',
      level: 'error',
      message: 'The cars are loose files, not one folder per car.',
    },
  ];
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Windows compares paths case-insensitively, and this refusal is the one protecting the user's install. */
function samePath(a: string, b: string): boolean {
  const [left, right] = [resolve(a), resolve(b)];

  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
