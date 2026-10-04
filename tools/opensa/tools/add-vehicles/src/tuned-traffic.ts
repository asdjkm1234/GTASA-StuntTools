/**
 * TUNED traffic — plan 006, the user's call.
 *
 * ModelVariations can spawn a car already wearing its mod-shop parts and one of its paint jobs. That is a
 * separate feature from "an added car appears at all" (004) and it applies to the WHOLE fleet, stock cars
 * included: it is what stops a city of factory-fresh bodies from looking like one.
 *
 *   [blade]
 *   Global=536,paintjob1,…,bnt_b_lr_bl,exh_lr_bl1,…
 *   TuningFullBodykit=1
 *   TuningChance=75
 *   ChangeOnlyParked=0
 *
 * **Everything in `Global` is read off the BUILT tree**, never authored: the model's own id from
 * `vehicles.ide`, one `paintjobN` per `<slot><N>.txd` the archives actually hold, and every part on the
 * model's `carmods.dat` line — which after 005 is the ADDED car's derived parts and after a mod install is
 * whatever bodykit the replacement car shipped. So a car nobody has seen yet is handled by the same rules.
 *
 * The three keys are tunable without touching code (`add-vehicles.json` in the source root), because how
 * often traffic should be tuned is taste, not a fact about the game. The `exclude` list is there for the
 * same reason the plugin ships its own `ExcludeModelsFromInheritance`: police, emergency and trains look
 * wrong tuned.
 *
 * **One family of the line never reaches `Global`: the NITRO upgrades** — see {@link SKIPPED_UPGRADE_PREFIX}.
 */
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { mergeIniKeys, MODEL_VARIATIONS_INI, readIniKey } from '@opensa/vehicle-installer/model-variations';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADDED_VEHICLES_DIR } from './loose-files';
import { extendGlobal } from './traffic';

/**
 * Upgrade ids the tuned-traffic sections DROP, by the prefix SA's own loader classifies them with
 * (`CAtomicModelInfo::SetupVehicleUpgradeFlags` reads a component's prefix, so this is the game's own family
 * name and not a list of ours): `nto_` — `nto_b_l`, `nto_b_s`, `nto_b_tw`.
 *
 * **Why they have no business here** (the user's call, 2026-08-22): tuned traffic exists to stop a city of
 * factory-fresh bodies from looking identical, and nitro shows nothing from outside a car — it is a
 * performance upgrade whose bottles sit inside the shell. So every tuned spawn was asking the plugin to mount
 * three parts that change nothing a passer-by can see. On a fleet where 154 sections carried them and a stock
 * line like `comet, nto_b_l, nto_b_s, nto_b_tw` is nitro and nothing else, that is the majority of the mount
 * work the feature was doing.
 *
 * It is also the family under suspicion in a reproducible crash — `0x007F0BF7`, "frame did not find the
 * child", which is what the game does when a part is installed on a car with no mount for it, and which stops
 * when `ModelVariations` is removed. **That is a suspicion, not a diagnosis**: the crash has not been pinned
 * to a car or a part, and this change is justified on its own ground (nothing visible to gain) rather than as
 * a fix. If it turns out to be the cause, the note here is where to say so.
 */
export const SKIPPED_UPGRADE_PREFIX = 'nto_';

/** The optional config file, beside the added cars. */
export const CONFIG_FILE = 'add-vehicles.json';

/** How ModelVariations should spawn a tuned car; the defaults are the ones the user's earlier build ran. */
export interface TunedTrafficConfig {
  /** `0` = tuned cars anywhere, `1` = only the parked ones. */
  readonly changeOnlyParked: number;
  /** Models never given a tuned section — police, emergency, trains, whatever looks wrong tuned. */
  readonly exclude: readonly string[];
  /** Percent of spawns that are tuned at all. */
  readonly tuningChance: number;
  /** Off = one part at a time, on = the whole kit. */
  readonly tuningFullBodykit: number;
}

export const DEFAULT_TUNED_TRAFFIC: TunedTrafficConfig = {
  changeOnlyParked: 0,
  exclude: [],
  tuningChance: 75,
  tuningFullBodykit: 1,
};

/**
 * How many paint-job dictionaries each model has in the archives: `<slot>1.txd`, `<slot>2.txd`, … counted
 * upward until one is missing, which is how the game numbers them. Read from the ARCHIVE rather than from
 * the mod folders, so a stock car's own paint jobs count the same as a mod's.
 */
export function countPaintjobs(gameDir: string, models: readonly string[]): Map<string, number> {
  const index = openArchiveIndex(gameDir);
  const counts = new Map<string, number>();
  // An ADDED car's dictionaries are not in any archive: its whole folder goes loose into
  // `modloader/added-vehicles/`, so the count has to look there too or 19 of the fleet's 46 paintjob
  // dictionaries are never offered — four cars lose all of theirs, their base having none to be counted.
  const held = (name: string): boolean =>
    index.archiveOf(name) !== null || existsSync(join(gameDir, ADDED_VEHICLES_DIR, name));
  for (const model of models) {
    let count = 0;
    while (held(`${model}${count + 1}.txd`)) {
      count += 1;
    }
    if (count > 0) {
      counts.set(model, count);
    }
  }

  return counts;
}

/** Read `add-vehicles.json` from the source root; every field optional, missing file = the defaults. */
export function readTunedTrafficConfig(inPath: string): TunedTrafficConfig {
  const path = join(inPath, CONFIG_FILE);
  if (!existsSync(path)) {
    return DEFAULT_TUNED_TRAFFIC;
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<TunedTrafficConfig>;

  return {
    changeOnlyParked: parsed.changeOnlyParked ?? DEFAULT_TUNED_TRAFFIC.changeOnlyParked,
    exclude: (parsed.exclude ?? []).map((model) => model.toLowerCase()),
    tuningChance: parsed.tuningChance ?? DEFAULT_TUNED_TRAFFIC.tuningChance,
    tuningFullBodykit: parsed.tuningFullBodykit ?? DEFAULT_TUNED_TRAFFIC.tuningFullBodykit,
  };
}

/**
 * Give every model that HAS something to show — a paint job or a mod-shop part — its tuned section. Returns
 * how many were written; does nothing at all when the plugin is not in the build (004 has already refused by
 * then, and this feature alone is not worth a second refusal).
 */
export function registerTunedTraffic(
  gameDir: string,
  config: TunedTrafficConfig,
  ids: ReadonlyMap<string, number>,
  /**
   * The slots whose section must be keyed by ID rather than by name — the ADDED cars.
   *
   * Field-proven 2026-08-20, and it is the second half of the same lesson as the variation list: the plugin
   * resolves a section header to a model, and an added car's NAME does not exist when it does that. The name
   * comes from a `vehicles.ide` row Mod Loader merges out of `modloader/added-vehicles/`, so `[059veh]` binds
   * to nothing and the car spawns in traffic untuned while Transfender — which mounts parts itself, without
   * the plugin — shows the same car tuning perfectly. Keyed `[19050]` it works.
   */
  byId: ReadonlySet<string> = new Set(),
): number {
  const path = join(gameDir, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    return 0;
  }
  const carmods = parseCarmods(readFileSync(join(gameDir, 'data', 'carmods.dat'), 'latin1'));
  const paintjobs = countPaintjobs(gameDir, [...ids.keys()]);
  let text = readFileSync(path, 'latin1');
  let written = 0;
  for (const [model, id] of [...ids].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (config.exclude.includes(model)) {
      continue;
    }
    const tokens = [
      ...Array.from({ length: paintjobs.get(model) ?? 0 }, (_, index) => `paintjob${index + 1}`),
      ...(carmods.mods.get(model) ?? []).filter((part) => !part.toLowerCase().startsWith(SKIPPED_UPGRADE_PREFIX)),
    ];
    if (tokens.length === 0) {
      continue;
    }
    const section = byId.has(model) ? String(id) : model;
    text = mergeIniKeys(
      text,
      section,
      new Map([
        ['ChangeOnlyParked', String(config.changeOnlyParked)],
        ['Global', extendGlobal(readIniKey(text, section, 'Global'), id, [], tokens)],
        ['TuningChance', String(config.tuningChance)],
        ['TuningFullBodykit', String(config.tuningFullBodykit)],
      ]),
      `### ${model}`,
    );
    written += 1;
  }
  writeFileSync(path, text, 'latin1');

  return written;
}
