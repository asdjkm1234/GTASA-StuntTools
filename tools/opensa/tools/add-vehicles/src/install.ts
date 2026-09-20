/**
 * Install the added cars INTO a built `sa` tree, in place — the part of an added car that is simply a
 * replacement car once it has an id (plan 002).
 *
 * The whole of "install a car" is `vehicle-installer`'s `applyVehicle`, called with the allocated id: the
 * dff/txd into the vehicles archive family, the four data rows merged, `features.txt` declared, `cleo/`
 * carried, and — since plans 012/013 — its ModelVariations section, `.fxt`, audio row and parked spot.
 * Nothing of that is re-implemented here. What IS this tool's is the id: where it comes from, that it never
 * moves, and that the tree still agrees with the ledger afterwards.
 *
 * The tree is edited IN PLACE, like `--rebake --kind sa`, because an added car is added to a build that
 * already exists — there is no source game to copy from and no output to wipe.
 *
 * **The models go LOOSE into `modloader/added-vehicles/`, not into an archive** — see `loose-files.ts` for
 * the ceiling that decided it (the game registers 8 IMG archives and the built tree already spends six).
 */
import type { BuildTarget } from '@opensa/tool-kit/target';

import { ADDED_ID_WINDOW, allocateIds, usedModelIds } from '@opensa/tool-kit/free-ids';
import { applyVehicle } from '@opensa/vehicle-installer/apply-vehicle';
import { writeAudioRows } from '@opensa/vehicle-installer/audio';
import { assertCarmodsCeilings, carmodsHeadroom } from '@opensa/vehicle-installer/carmods-guard';
import {
  type LedgerRow,
  readAddsLedger,
  readAddsRows,
  renameAddsRows,
  writeAddsLedger,
} from '@opensa/vehicle-installer/ledger';
import { vehicleColourWarnings } from '@opensa/vehicle-installer/palette';
import { mergeFeatureTable, requireBuiltGame } from '@opensa/vehicle-installer/rebake-shared';
import { decodeSettings, ID_PLACEHOLDER, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { writeModelSpecialFeatures } from '@opensa/vehicle-installer/special-features';
import { deriveTuning, shippedParts, slotTokens } from '@opensa/vehicle-installer/tuning-derive';
import { installDerivedTuning } from '@opensa/vehicle-installer/tuning-install';
import { assertCarmodsModels, ideModelNames } from '@opensa/vehicle-installer/tuning-parts';
import {
  assertUpgradeCollision,
  PARTS_COL,
  type UpgradePart,
  writeUpgradeCollision,
} from '@opensa/vehicle-installer/upgrade-collision';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  ADDED_VEHICLES_DIR,
  clearLooseFiles,
  installLooseFiles,
  readInstalledIds,
  writeSettingsFile,
} from './loose-files';
import { resolveAddedCarText } from './name';
import { type AddedVehicle, resolveAddedVehicles, stockSlotIds, stockSlots } from './sources';
import { registerTraffic } from './traffic';
import { readTunedTrafficConfig, registerTunedTraffic } from './tuned-traffic';

export interface AddVehiclesOptions {
  /** The BUILT `sa` tree the cars are added to; edited in place. */
  readonly gamePath: string;
  /** The added-vehicles source root. */
  readonly inPath: string;
  /** Narrow the run to these slots; the rest keep whatever the tree already holds. */
  readonly only?: readonly string[];
  readonly target?: BuildTarget;
}

export interface AddVehiclesReport {
  /** What was installed, with the id each car took. */
  readonly installed: readonly LedgerRow[];
  /** Cars the source holds and this run did not touch (`--only`). */
  readonly skipped: number;
  readonly warnings: readonly string[];
}

/** Install every added car `--in` resolves to onto the built tree at `--game`. */
export function addVehicles(options: AddVehiclesOptions): AddVehiclesReport {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  requireBuiltGame(gamePath);

  const { sources } = resolveAddedVehicles(inPath, gamePath, options.target ?? 'sa');
  const only = options.only ? new Set(options.only.map((slot) => slot.toLowerCase())) : null;
  const selected = only ? sources.filter((source) => only.has(source.slot)) : sources;
  if (selected.length === 0) {
    return { installed: [], skipped: sources.length, warnings: [] };
  }
  const warnings = selected.flatMap(requireIdPlaceholder);
  if (warnings.length > 0) {
    throw new Error(
      `${warnings.length} added car(s) do not leave their model id to this tool:\n  ${warnings.join('\n  ')}`,
    );
  }
  // What each car re-models of its base's tuning parts, decided BEFORE any id is handed out: the parts need
  // ids of their own, out of the same window and just as stable (a part id is in the save too).
  // The tokens their names end in come from the WHOLE slot table — the tree's plus every added slot of the
  // source, `--only` or not — so a narrowed run can no more shift a token than it can shift an id.
  const tokens = slotTokens([...stockSlots(gamePath), ...sources.map((source) => source.slot)]);
  const tuning = new Map(
    sources.map((source) => [
      source.slot,
      deriveTuning({
        base: source.base,
        gameDir: gamePath,
        shipped: shippedParts(source.folder, source.slot),
        slot: source.slot,
        token: tokens.get(source.slot)!,
      }),
    ]),
  );
  // A part the 014 scheme renamed is the same part: its ledger row moves with the name so the id it already
  // promised to a save is kept, instead of the part taking a fresh one and the old row reserving one forever.
  const renamed = renameAddsRows(
    gamePath,
    new Map(
      sources.flatMap((source) =>
        [...(tuning.get(source.slot)?.renames ?? [])].map(([file, entry]) => [
          `${stem(file)}_${source.slot}`,
          stem(entry),
        ]),
      ),
    ),
  );
  // Every car of the SOURCE is allocated for, not only the selected ones: an `--only` run must not hand a
  // free id to one car that a full run would give to another. The ledger pins what is already promised.
  const slots = sources.flatMap((source) => [
    source.slot,
    ...(tuning.get(source.slot)?.rows ?? []).map((row) => row.name),
  ]);
  const ids = allocateIds({
    ledger: promisedIds(gamePath, slots),
    slots,
    used: new Set([...usedModelIds(gamePath), ...readInstalledIds(gamePath).values()]),
  });

  // A FULL run rebuilds the folder from the source; a narrowed one writes only its own cars into it.
  if (!only) {
    clearLooseFiles(gamePath);
  }
  const installed: LedgerRow[] = [];
  const declared = new Map<string, readonly string[]>();
  const runWarnings: string[] = renamed.map((move) => `ledger: ${move}`);
  for (const source of selected) {
    const id = ids.get(source.slot)!;
    // The name and the inherited sound are decided BEFORE the car is applied: both read the tree as it is
    // (the base's audio row, the keys `american.gxt` already defines), and the name rides in with the install.
    const text = resolveAddedCarText(source, gamePath, ideLineOf(source.folder, id));
    runWarnings.push(...text.warnings);
    // The parts FIRST: the carmods line the settings merge is about to write names them, and
    // `assertCarmodsModels` refuses a token no IDE row defines.
    const parts = tuning.get(source.slot)!;
    runWarnings.push(...parts.warnings.map((warning) => `${source.name}: ${warning}`));
    const written = installDerivedTuning({ derived: parts, gameDir: gamePath, ids, source: source.name });
    runWarnings.push(...written.warnings);
    installed.push(...written.rows);
    // No `img`: `applyVehicle` merges the data and carries the `cleo/` folder, and the MODELS are written
    // loose below instead of staged into an archive.
    // The car's ide and handling rows do NOT go into `data/`: they are written beside its models for Mod
    // Loader to merge (`loose-files.ts` carries why, and the field verdict that settled it).
    const applied = applyVehicle(source.folder, gamePath, {
      ...(text.name ? { gxt: [text.name] } : {}),
      id,
      partRenames: new Map([...parts.renames].map(([file, entry]) => [stem(file), stem(entry)])),
      redirectRows: (rows) =>
        writeSettingsFile(gamePath, source.slot, {
          ...(rows.handlingLine === undefined ? {} : { handling: rows.handlingLine }),
          ...(rows.ideLine === undefined ? {} : { ide: rows.ideLine }),
        }),
      target: 'sa',
    });
    applied.warnings.forEach((warning) => runWarnings.push(`${source.name}: ${warning}`));
    const loose = installLooseFiles(gamePath, source.folder, parts.renames);
    loose.repaired.forEach((name) =>
      runWarnings.push(`${source.name}: ${name}: frame list declared a parent after its child — reordered`),
    );
    if (text.audio !== null) {
      runWarnings.push(...writeAudioRows(gamePath, [text.audio], `${source.slot} (inherited from ${source.base})`));
    }
    if (applied.features.length > 0 && applied.model) {
      declared.set(applied.model, applied.features);
    }
    installed.push({ bases: source.bases, folder: source.name, id, kind: 'car', slot: source.slot });
  }
  if (declared.size > 0) {
    mergeFeatureTable(gamePath, declared);
    runWarnings.push(...writeModelSpecialFeatures(gamePath, declared, new Set(declared.keys())).warnings);
  }
  // The added cars' own names are declared beside their models now, not in a `data/*.ide` the guard walks —
  // so they are handed to it explicitly, or every added car's carmods line would read as an unknown token.
  assertCarmodsModels(gamePath, new Set(sources.map((source) => source.slot)));
  // The two fixed-size arrays behind carmods.dat. Refuses NAMING `asi/perfect-vehicle`, which is the plugin
  // that lifts them — every added car re-modelling its base's wings costs one of the seven spare link pairs.
  assertCarmodsCeilings(gamePath);
  // Every part derived here is a model the game has no collision for, and anything that SPAWNS one as an
  // object dies on a null `m_pColModel` — field-proven at 1194 and 19051, both carrying the flag that was
  // once thought to excuse it. So each gets a bounds-only model of its own, read from the file it ships as.
  const collision = writeUpgradeCollision(
    gamePath,
    installed
      .filter(({ kind }) => kind === 'part')
      .map(({ slot }): UpgradePart => ({ dff: join(gamePath, ADDED_VEHICLES_DIR, `${slot}.dff`), name: slot })),
  );
  if (collision.length > 0) {
    console.log(`add-vehicles: ${collision.length} part(s) have collision in ${PARTS_COL}`);
  }
  runWarnings.push(...assertUpgradeCollision(gamePath));
  const headroom = carmodsHeadroom(gamePath);
  console.log(
    `add-vehicles: carmods headroom — ${headroom.links} link pair(s), ${headroom.partsPerCar} part(s) on the fullest car`,
  );
  runWarnings.push(...vehicleColourWarnings(gamePath));
  assertIdsLanded(gamePath, installed);

  // Last: a ledger written before the tree agreed with it would promise ids the build does not carry.
  writeAddsLedger(gamePath, installed);
  // Traffic speaks for the WHOLE tree, read back off the ledger — an `--only` run must not drop the other
  // cars out of their base's variation list (plan 004).
  runWarnings.push(...registerTraffic(gamePath, readAddsRows(gamePath), stockSlotIds(gamePath)));
  // Tuned traffic is fleet-wide and derived from the tree, so it runs LAST — over the rows this run merged
  // and the sections 004 just wrote, into the same one-section-per-model (plan 006).
  const tuned = registerTunedTraffic(
    gamePath,
    readTunedTrafficConfig(inPath),
    allModelIds(gamePath),
    new Set(
      readAddsRows(gamePath)
        .filter(({ kind }) => kind === 'car')
        .map(({ slot }) => slot),
    ),
  );
  console.log(`add-vehicles: ${tuned} model(s) given a tuned-traffic section`);

  return { installed, skipped: sources.length - selected.length, warnings: runWarnings };
}

/** Every drivable model the built tree defines, added cars included — what tuned traffic is written over. */
function allModelIds(gameDir: string): Map<string, number> {
  const cars = readAddsRows(gameDir).filter(({ kind }) => kind === 'car');

  // The added cars too, each keyed by its OWN slot: its section is where its own paintjobs and its own
  // derived parts belong. Putting them in the base's section instead is what had a 1958 Pontiac wearing the
  // blade's spare wheel (`docs/open-issues/fixed/added-car-inherits-its-base-tuning.md`).
  return new Map([...stockSlotIds(gameDir), ...cars.map(({ id, slot }): [string, number] => [slot, id])]);
}

/**
 * Refuse a tree where an installed car's model does NOT hold the id we allocated. The merges are
 * replace-by-model, so a stock slot sharing the added car's model name would silently take the row instead —
 * and the ledger would then promise an id nothing in the tree defines.
 */
function assertIdsLanded(gamePath: string, installed: readonly LedgerRow[]): void {
  // A car's row is in its settings file beside the models; a PART's is in `veh_mods.ide` under `data/`.
  const names = new Map([...ideModelNames(gamePath), ...readInstalledIds(gamePath)]);
  const wrong = installed.filter((row) => names.get(row.slot) !== row.id);
  if (wrong.length > 0) {
    throw new Error(
      `${wrong.length} added car(s) did not land on the id they were allocated: ` +
        wrong
          .map((row) => `${row.slot} wanted ${row.id}, the tree says ${names.get(row.slot) ?? 'nothing'}`)
          .join('; '),
    );
  }
}

/** This car's `vehicles.ide` row with the id already in it — what the install is about to merge. */
function ideLineOf(folder: string, id: number): string {
  const file = readdirSync(folder).find((name) => name.toLowerCase().endsWith('.settings.txt'));
  if (file === undefined) {
    return '';
  }
  const text = decodeSettings(readFileSync(join(folder, file)))
    .split(ID_PLACEHOLDER)
    .join(String(id));

  return parseVehicleSettings(text).ideLine ?? '';
}

/**
 * The ids already promised to these slots: the ledger, and — under it — whatever the TREE already defines
 * them as inside the window.
 *
 * The tree half is what makes a FAILED run safe. A run that refuses late (the carmods ceilings are checked
 * after every row is merged) leaves the ide rows in place and no ledger; reading only the ledger, the next
 * run would see those ids as taken by strangers and hand the whole fleet new ones — renumbering it, which is
 * the one thing the ledger exists to prevent.
 */
function promisedIds(gameDir: string, slots: readonly string[]): Map<string, number> {
  const names = new Map([...ideModelNames(gameDir), ...readInstalledIds(gameDir)]);
  const promised = new Map<string, number>();
  for (const slot of slots) {
    const id = names.get(slot.toLowerCase());
    if (id !== undefined && id >= ADDED_ID_WINDOW.first && id <= ADDED_ID_WINDOW.last) {
      promised.set(slot, id);
    }
  }
  // The ledger is the record; the tree is only the fallback for what a failed run left behind. Only the
  // slots THIS run allocates are taken from it: since 014 the file also carries a replacement car's derived
  // parts, whose ids come out of another window (`MOD_PART_ID_WINDOW`) and would read here as strays. Their
  // ids are protected anyway — their IDE rows are in the tree, so `usedModelIds` sees them.
  const wanted = new Set(slots.map((slot) => slot.toLowerCase()));
  for (const [slot, id] of readAddsLedger(gameDir)) {
    if (wanted.has(slot.toLowerCase())) {
      promised.set(slot, id);
    }
  }

  return promised;
}

/** An added car must leave its id to the allocator — a literal one is an author guessing at the window. */
function requireIdPlaceholder(source: AddedVehicle): string[] {
  const file = readdirSync(source.folder).find((name) => name.toLowerCase().endsWith('.settings.txt'));
  if (file === undefined) {
    return [`${source.name}: no *.settings.txt — an added car needs at least its vehicles.ide row`];
  }
  // Decoded, not read as bytes: most of these files are UTF-16, where the ASCII placeholder never matches.
  const text = decodeSettings(readFileSync(join(source.folder, file)));

  return text.includes(ID_PLACEHOLDER)
    ? []
    : [`${source.name}: ${file} has no '${ID_PLACEHOLDER}' — the id is allocated over the built tree, never authored`];
}

/** `wg_l_lr_rem1.dff` → `wg_l_lr_rem1`. */
function stem(file: string): string {
  return file.replace(/\.dff$/i, '');
}
