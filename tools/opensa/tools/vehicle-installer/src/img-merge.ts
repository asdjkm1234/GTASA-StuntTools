import type { EditableImg } from '@opensa/tool-kit/archive/img';

import { reorderFrameList } from '@opensa/renderware/parsers/binary/frame-order';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How much of a `.dff` is read to ask whether its frame list is ordered. The list sits at the head of the
 * clump — a 61-frame car spends about 5 KB on it — so this answers for every real model without pulling the
 * file, which is the whole reason {@link stageVehicleImg} stages by PATH.
 */
const FRAME_LIST_PROBE_BYTES = 64 * 1024;

/** What a folder put into the archive, and what had to be repaired on the way in. */
export interface StagedVehicleImg {
  /** Lowercased entry names staged (used by `--strip`). */
  names: string[];
  /** Lowercased `.dff` names whose frame list was reordered before staging. */
  repaired: string[];
}

/**
 * Drop the STOCK texture set of a slot a mod is taking over: `<slot>.txd` and every `<slot><n>.txd` the
 * folder does not itself ship.
 *
 * A car's dictionary and its paintjob dictionaries are one bundle — the game finds the paintjobs by the
 * `<car><n>` convention off the car's own name, and nothing else names them (the user's call, 2026-08-20).
 * So a mod that replaces the car replaces the bundle: keeping a stock paintjob beside a modded body offers
 * the player artwork drawn for different UVs. What the mod ships is staged over these by name a moment
 * later; what it does not ship has no owner left and goes.
 *
 * **A folder that ships no `.txd` for the slot is left alone and reported.** It does not own the slot's
 * textures — pruning would leave its car with no dictionary at all, which is worse than a stale paintjob.
 * (Every one of the original's 212 folders ships one, so this is the door being closed, not one in use.)
 *
 * In stock, no two cars share a dictionary and no car's dictionary is named other than after it (measured
 * 2026-08-20 over `vehicles.ide`: 0 and 0), which is what makes the name rule safe to delete by.
 */
export function pruneReplacedSlotTextures(img: EditableImg, slot: string, folderFiles: readonly string[]): string[] {
  const shipped = new Set(folderFiles.map((file) => file.toLowerCase()).filter((file) => file.endsWith('.txd')));
  const owned = new RegExp(`^${slot.toLowerCase()}\\d*\\.txd$`);
  if (![...shipped].some((file) => owned.test(file))) {
    return [];
  }
  const dropped: string[] = [];
  for (const name of img.names()) {
    const entry = name.toLowerCase();
    if (owned.test(entry) && !shipped.has(entry)) {
      img.delete(name);
      dropped.push(entry);
    }
  }

  return dropped;
}

/**
 * Repaired bytes for a `.dff` whose frame list declares a parent AFTER the child it belongs to, or `null`
 * when the file is already ordered — which is the answer for every stock model and all but one of the 212
 * vehicle folders measured on 2026-08-19.
 *
 * The real game cannot read such a file: RenderWare parents each frame in the pass that creates it, so a
 * forward reference reads an unwritten array slot and either faults in `RwFrameAddChild` (`0x007F0BF7`) or
 * corrupts memory quietly, decided by whatever was there. **Nothing else catches it** — byte-faithful
 * staging ships a mod's file as authored, and OpenSA's own reader resolves parents by index, so a model
 * that renders perfectly here still kills the target. Measurement:
 * `docs/gta-sa-original/rw-frame-list-parent-order.md`.
 *
 * The repair is a permutation and the file keeps its length; a mod's geometry is not re-encoded.
 *
 * Exported because a vehicle's files do not always go into an archive: `tools/add-vehicles` writes its cars
 * LOOSE into `modloader/`, and a file that reaches the game by that road needs the same repair — the defect
 * is in the file, not in the transport.
 */
export function repairFrameOrder(path: string): null | Uint8Array {
  const handle = openSync(path, 'r');
  const probe = Buffer.alloc(FRAME_LIST_PROBE_BYTES);
  let read = 0;
  try {
    read = readSync(handle, probe, 0, FRAME_LIST_PROBE_BYTES, 0);
  } finally {
    closeSync(handle);
  }
  const head = probe.buffer.slice(probe.byteOffset, probe.byteOffset + read);
  try {
    if (reorderFrameList(head) === null) {
      return null;
    }
  } catch {
    // The frame list ran past the probe, or the head is not something we can reason about — fall through
    // and let the whole file answer rather than guessing from a fragment.
  }
  const whole = readFileSync(path);

  return reorderFrameList(whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength));
}

/**
 * ARCHIVE ENTRY names that more than one vehicle folder stages, with the folders in install order and the
 * size each of them ships. The archive holds one entry per name, so the LAST folder wins and every other car
 * on that name wears its file — silently, unless whoever stages them says so.
 *
 * The name asked about is the entry a file is staged UNDER, not the name on disk: since 014 a part belonging
 * to another car is renamed on the way in, so `renames` (folder path → the derivation's file → entry map)
 * has to be the same one `stageVehicleImg` is given. Two folders left on one name after that is either the
 * SAME file shipped twice — harmless, and the sizes say so — or two different models, which is the defect
 * this exists to name.
 */
export function sharedVehicleFiles(
  sources: readonly { readonly folder: string; readonly name: string }[],
  renames?: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Map<string, { name: string; size: number }[]> {
  const owners = new Map<string, { name: string; size: number }[]>();
  for (const source of sources) {
    for (const entry of readdirSync(source.folder, { withFileTypes: true })) {
      if (entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name)) {
        const file = entry.name.toLowerCase();
        const key = renames?.get(source.folder)?.get(file) ?? file;
        const { size } = statSync(join(source.folder, entry.name));
        owners.set(key, [...(owners.get(key) ?? []), { name: source.name, size }]);
      }
    }
  }

  return new Map([...owners].filter(([, staged]) => staged.length > 1));
}

/**
 * Stage a vehicle folder's `.dff` + `.txd` files into `gta3.img`, **replacing by name** (adding if new). This
 * includes any extra numbered txds (`<model>1.txd`, …) — they ship in the archive, though using them in-game is
 * out of scope (plan 002). Returns the lowercased entry names staged (used by `--strip`).
 *
 * **Staged, not written.** The caller owns the archive and writes it ONCE, because this used to open, rebuild
 * and write the whole `gta3.img` per car: 212 cars over a growing multi-GB file, and the last write crossed
 * `writeFileSync`'s 2 GiB ceiling mid-stage (`ERR_OUT_OF_RANGE`, 2 168 825 856 B, 2026-08-15). Files stay on
 * disk until the write pulls them, so staging a 3 GB mod set costs paths rather than buffers.
 */
export function stageVehicleImg(
  folderPath: string,
  img: EditableImg,
  /**
   * File name (lowercased, with extension) → the entry name to stage it UNDER. An added car ships its base's
   * tuning parts under the STOCK names, and staging those would overwrite the stock part for every car that
   * uses it — so `tools/add-vehicles` renames them here, at the one point where a file becomes an entry.
   */
  renames: ReadonlyMap<string, string> = new Map(),
): StagedVehicleImg {
  const files = readdirSync(folderPath, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name),
  );
  const repaired: string[] = [];
  const names: string[] = [];
  for (const file of files) {
    const path = join(folderPath, file.name);
    const entry = renames.get(file.name.toLowerCase()) ?? file.name;
    names.push(entry.toLowerCase());
    // Only a `.dff` carries a frame list, and only a broken one is ever read whole — everything else keeps
    // the staged-by-path route this function exists for.
    const fixed = /\.dff$/i.test(file.name) ? repairFrameOrder(path) : null;
    if (fixed) {
      img.set(entry, fixed);
      repaired.push(entry.toLowerCase());
    } else {
      img.setFile(entry, path);
    }
  }

  return { names, repaired };
}

/**
 * A function saying which CAR an archive entry belongs to, so the family writer keeps a car whole rather
 * than leaving its `.dff` in one sibling and its `.txd` in the next (148 of 201 cars, 2026-08-20 — plan 103).
 *
 * Derived from the built tree's own tables: `vehicles.ide` gives the car names, and a `veh_mods.ide` part is
 * keyed by the car its TXD column names — the same column that says whose part it is everywhere else
 * (`docs/contracts/vehicles.md`). A paintjob dictionary follows its car by the `<car><n>.txd` convention,
 * which no row states. Anything else answers null and is placed on its own.
 */
export function vehicleCohortKey(gameDir: string): (name: string) => null | string {
  const cars = new Set<string>();
  let section = '';
  const idePath = join(gameDir, 'data', 'vehicles.ide');
  if (existsSync(idePath)) {
    for (const raw of readFileSync(idePath, 'latin1').split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      const cells = line.split(',').map((cell) => cell.trim());
      if (line === '') {
        continue;
      }
      if (!/^\d+$/.test(cells[0])) {
        section = line.toLowerCase();
      } else if (section === 'cars' && cells[1]) {
        cars.add(cells[1].toLowerCase());
      }
    }
  }
  const partOwner = new Map<string, string>();
  const modsPath = join(gameDir, 'data', 'maps', 'veh_mods', 'veh_mods.ide');
  if (existsSync(modsPath)) {
    for (const raw of readFileSync(modsPath, 'latin1').split(/\r?\n/)) {
      const cells = raw
        .split('#')[0]
        .split(',')
        .map((cell) => cell.trim().toLowerCase());
      if (/^\d+$/.test(cells[0]) && cells[1] && cells[2] && cars.has(cells[2])) {
        partOwner.set(cells[1], cells[2]);
      }
    }
  }

  return (entry: string): null | string => {
    const name = entry.toLowerCase();
    const stem = name.replace(/\.(?:dff|txd)$/, '');
    if (stem === name) {
      return null;
    }

    if (cars.has(stem)) {
      return stem;
    }
    const owner = partOwner.get(stem);
    if (owner !== undefined) {
      return owner;
    }
    // `<car>3.txd` — a paintjob dictionary, which no row names.
    const paintjob = name.endsWith('.txd') ? /^([^.]*[^.\d])\d+$/.exec(stem)?.[1] : undefined;

    return paintjob !== undefined && cars.has(paintjob) ? paintjob : null;
  };
}
