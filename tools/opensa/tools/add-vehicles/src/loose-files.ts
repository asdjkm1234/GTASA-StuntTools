/**
 * Where an added car's MODELS go: `modloader/added-vehicles/`, loose — not into an IMG archive.
 *
 * The archives were the first road and they ran into a wall the game does not warn about. SA registers
 * **8 IMG archives** (`CStreaming::ms_files`, 3 hardcoded + 5 in `gta.dat`) and the built tree already spends
 * six of them on stock content; the added fleet's +1.37 GB pushed the vehicles family to a third file and the
 * build stopped at `assertArchiveSlots` with 9 of 8
 * (`docs/in-reserve/img-archive-limit-lift.md`, the trigger that fired 2026-08-19).
 *
 * Modloader has no such ceiling: it imports a loose `.dff`/`.txd` by NAME at load, which is how the user's
 * earlier build shipped these same cars (`NO_COMMIT/1/build/modloader/Vehicles Added/` — 161 dffs and 161
 * txds, the tuning parts among them and none of them with a dictionary of its own). So the cars ride the road
 * the install already runs `modloader.asi` for, and the archive ceiling stops being this feature's problem.
 *
 * **What this costs, stated rather than discovered**: a loose TXD still takes a streaming id at runtime, and
 * `checkImgIdBudgets` counts ARCHIVE entries — so the FLA TXD pool is under-counted by whatever lands here.
 * The pool has 662 slots of headroom against the 161 files this fleet adds; a fleet that could actually
 * exhaust it would need its own count, and this comment is the trail to it.
 */
import { repairFrameOrder } from '@opensa/vehicle-installer/img-merge';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The folder modloader imports the added fleet from, inside the built game dir. */
export const ADDED_VEHICLES_DIR = join('modloader', 'added-vehicles');

/** What one car's files cost the tree, and what had to be repaired on the way. */
export interface LooseInstall {
  /** File names written (lowercased), under their FINAL names — a re-modelled part's is the derived one. */
  readonly names: readonly string[];
  /** `.dff` names whose frame list was reordered before writing. */
  readonly repaired: readonly string[];
}

/**
 * Empty the folder before a FULL run writes it. A car deleted from the source must not survive in the tree —
 * the persistent-`--out` lesson (`docs/restrictions/architecture.md`), and here it would be a model the game
 * still imports under an id nothing defines any more. A narrowed run (`--only`) never wipes: it speaks for
 * its own cars, exactly as the ledger does.
 */
export function clearLooseFiles(gameDir: string): void {
  rmSync(join(gameDir, ADDED_VEHICLES_DIR), { force: true, recursive: true });
}

/**
 * Copy one car folder's `.dff`/`.txd` into `modloader/added-vehicles/`, applying `renames` (a re-modelled
 * tuning part ships under the name the install gave it, never the stock one) and the same frame-list repair
 * the archive road does — the defect is in the file, not in the transport.
 */
export function installLooseFiles(
  gameDir: string,
  folderPath: string,
  renames: ReadonlyMap<string, string> = new Map(),
): LooseInstall {
  const dest = join(gameDir, ADDED_VEHICLES_DIR);
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  const repaired: string[] = [];
  for (const entry of readdirSync(folderPath, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:dff|txd)$/i.test(entry.name)) {
      continue;
    }
    const source = join(folderPath, entry.name);
    const name = renames.get(entry.name.toLowerCase()) ?? entry.name;
    const fixed = /\.dff$/i.test(entry.name) ? repairFrameOrder(source) : null;
    if (fixed) {
      writeFileSync(join(dest, name), fixed);
      repaired.push(name.toLowerCase());
    } else {
      copyFileSync(source, join(dest, name));
    }
    names.push(name.toLowerCase());
  }

  return { names, repaired };
}

/** The per-car text file Mod Loader matches the data lines out of. */
export const SETTINGS_SUFFIX = '.settings.txt';

/**
 * The ids the tree already carries for added cars, read back out of the settings files beside their models.
 *
 * Nothing else can see them: they are not in a `data/*.ide` (that is the whole point), so the id allocator's
 * "what is already taken" walk and its failed-run recovery would both be blind without this. A run that dies
 * after writing these files must not hand the same ids to different cars next time.
 */
export function readInstalledIds(gameDir: string): Map<string, number> {
  const dir = join(gameDir, ADDED_VEHICLES_DIR);
  const ids = new Map<string, number>();
  if (!existsSync(dir)) {
    return ids;
  }
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(SETTINGS_SUFFIX)) {
      continue;
    }
    for (const line of readFileSync(join(dir, name), 'latin1').split(/\r?\n/)) {
      const row = /^\s*(\d+)\s*,\s*([^,\s]+)/.exec(line);
      if (row) {
        ids.set(row[2].toLowerCase(), Number(row[1]));
        break;
      }
    }
  }

  return ids;
}

/**
 * Write one added car's `vehicles.ide` and `handling.cfg` lines BESIDE its models, for Mod Loader's
 * `std.data` to merge — the shape the field accepted on 2026-08-19.
 *
 * **Why not baked into `data/`**: a `cars` row there is read from `default.dat` while the game boots, and
 * the real install does not survive 115 added ones (it dies before a window appears). The same rows placed
 * here are merged after, by a plugin whose own documentation lists `cars` among the sections it matches out
 * of a readme. **And the file may NOT be named after a stock data file** — Mod Loader takes
 * `vehicles.ide`/`handling.cfg` in a mod folder as a REPLACEMENT, which silently deleted the stock 212 cars
 * and every stock handling line (`LANDSTAL ... cannot be found`) before this shape was found.
 */
export function writeSettingsFile(gameDir: string, slot: string, rows: { handling?: string; ide?: string }): string {
  const dest = join(gameDir, ADDED_VEHICLES_DIR);
  mkdirSync(dest, { recursive: true });
  const path = join(dest, `${slot}${SETTINGS_SUFFIX}`);
  const lines = [
    '; added vehicle - data lines matched by Mod Loader std.data (never name this after a stock data file)',
    ...(rows.ide ? [rows.ide] : []),
    ...(rows.handling ? [rows.handling] : []),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`, 'latin1');

  return path;
}
