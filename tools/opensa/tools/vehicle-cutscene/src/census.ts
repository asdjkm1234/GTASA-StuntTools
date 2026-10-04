import type { BuildTarget } from '@opensa/tool-kit/target';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { cleanLines, sectionedParse } from '@opensa/renderware/parsers/text/text-lines';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The census of one `--game` tree: every cutscene VEHICLE model, plus the txdcut.ide rows that point at
 * nothing (stock ships two: the `csopcarla` typo and the cut-content `csandrom92`).
 */
export interface Census {
  /** txdcut.ide cs names with no `<name>.dff` in cutscene.img — dead rows, reported not patched. */
  deadTxdcutRows: string[];
  /** One entry per cutscene model (`cszr350` and `cszr350b` are two entries on one donor slot). */
  slots: CutsceneSlot[];
}

/** IDE `type` column → which rig-transform branch converts the slot. */
export type CutsceneBranch = 'bike' | 'boat' | 'car';

/**
 * Slots whose converted model drops its WINDOW-PANE glass entirely — **empty, and meant to stay empty**
 * (retired 2026-08-14; the story is `docs/hacks/retired/cutscene-window-pane-suppression.md`).
 *
 * It existed because the 2004 cutscene path draws a car inline in sector-scan order with z-write on, so a
 * rendered pane erased any actor drawn after it and the only data-side answer was to ship the car
 * unglazed, as R* did. `asi/perfect-cutscene` defers cutscene cars into the engine's own sorted entity
 * pass instead, which draws them after every actor — field-verified on both scenes that forced this hack
 * (RIOT_4B and SYND_3A, 2026-08-14: actors visible AND the tint over them).
 *
 * The list stays as the seam: a slot may go back in if some scene ever loses a roulette the ASI does not
 * cover. **Anything added here ships a car with no windows, so it needs a field verdict saying why.**
 */
export const PANE_SUPPRESSED_SLOTS: ReadonlySet<string> = new Set([]);

/** One cutscene vehicle model matched to its `vehicles.ide` donor slot. */
export interface CutsceneSlot {
  branch: CutsceneBranch;
  /** Cutscene DFF entry name without extension, e.g. `csbobcat92`. */
  csName: string;
  /** Byte size of the model's own `cs*.txd` entry (0 when the archive carries none). */
  csTxdBytes: number;
  /**
   * Whether `data/txdcut.ide` carries a txdp row for this cs model. The empty-TXD route (plan 002 step 6)
   * needs one; `false` marks the rows the tool patches in (`cscopcarsf`, `csdinghy`).
   */
  hasTxdcutRow: boolean;
  /** `vehicles.ide` `type` column (car / mtruck / bmx / boat …). */
  ideType: string;
  /** `vehicles.ide` model name (8-char) — also the donor mod's model name. */
  model: string;
  /** `vehicles.ide` txd name (equals `model` on every stock cutscene slot). */
  txd: string;
}

/** A slot's readiness against the `--in` mod folders. */
export interface SlotReadiness {
  /** Mod folder name (relative to `--in`) shipping the donor model, when one does. */
  folder?: string;
  slot: CutsceneSlot;
  status: SlotStatus;
}

/** Readiness of a slot against the `--in` mod folders. */
export type SlotStatus = 'mod incomplete' | 'no mod' | 'ready';

interface VehicleRow {
  model: string;
  txd: string;
  type: string;
}

/**
 * Match cutscene.img entries against `vehicles.ide` + `txdcut.ide`.
 *
 * Matching is deliberately exact — no prefix heuristics. A `cs*` entry is a vehicle when either its
 * txdcut.ide row's parent names an IDE row (covers the 8-char truncations: `csremington92` → `remingtn`,
 * whose stem matches NO prefix rule), or its bare stem equals an IDE model name (covers the three models
 * R* left out of txdcut: `cscopcarla` typo'd, `cscopcarsf` and `csdinghy` missing). Everything else —
 * peds (`csho`), props, the suffix trap (`csfirela` is slot `firela`, not `firetruk` + `la`) — falls out
 * without a special case.
 */
export function buildCensus(input: {
  /** Lowercased cutscene.img entry name → byte size. */
  cutsceneEntries: ReadonlyMap<string, number>;
  txdcutText: string;
  vehiclesIdeText: string;
}): Census {
  const txdcut = parseTxdcut(input.txdcutText);
  const { byModel, byTxd } = parseVehicleRows(input.vehiclesIdeText);

  const slots: CutsceneSlot[] = [];
  for (const entry of input.cutsceneEntries.keys()) {
    if (!entry.startsWith('cs') || !entry.endsWith('.dff')) {
      continue;
    }
    const csName = entry.slice(0, -'.dff'.length);
    const parent = txdcut.get(csName);
    const row = (parent ? (byTxd.get(parent) ?? byModel.get(parent)) : undefined) ?? byModel.get(csName.slice(2));
    if (!row) {
      continue;
    }
    slots.push({
      branch: branchOf(row.type),
      csName,
      csTxdBytes: input.cutsceneEntries.get(`${csName}.txd`) ?? 0,
      hasTxdcutRow: parent !== undefined,
      ideType: row.type,
      model: row.model,
      txd: row.txd,
    });
  }
  slots.sort((a, b) => a.csName.localeCompare(b.csName));

  const deadTxdcutRows = [...txdcut.keys()].filter((cs) => !input.cutsceneEntries.has(`${cs}.dff`)).sort();

  return { deadTxdcutRows, slots };
}

/** Read the census inputs from a `--game` tree (models/cutscene.img + data/txdcut.ide + data/vehicles.ide). */
export function loadCensus(gamePath: string): Census {
  const archive = openArchive(new Uint8Array(readFileSync(join(gamePath, 'models', 'cutscene.img'))));
  const cutsceneEntries = new Map<string, number>();
  for (const name of archive.names) {
    cutsceneEntries.set(name.toLowerCase(), archive.get(name)?.byteLength ?? 0);
  }

  return buildCensus({
    cutsceneEntries,
    txdcutText: readFileSync(join(gamePath, 'data', 'txdcut.ide'), 'utf8'),
    vehiclesIdeText: readFileSync(join(gamePath, 'data', 'vehicles.ide'), 'utf8'),
  });
}

/**
 * Match census slots against the `--in` mod folders (vehicle-installer layout: each immediate subfolder
 * ships `<model>.dff` + `<model>.txd`). Two folders shipping the same model: the alphabetically last
 * wins, matching the installer's apply order.
 */
export function matchMods(slots: readonly CutsceneSlot[], inPath: string, target?: BuildTarget): SlotReadiness[] {
  const mods = indexModFolders(inPath, target);

  return slots.map((slot) => {
    const mod = mods.get(slot.model);
    if (!mod) {
      return { slot, status: 'no mod' };
    }

    return { folder: mod.folder, slot, status: mod.hasTxd ? 'ready' : 'mod incomplete' };
  });
}

function branchOf(ideType: string): CutsceneBranch {
  if (ideType === 'boat') {
    return 'boat';
  }

  return ideType === 'bike' || ideType === 'bmx' ? 'bike' : 'car';
}

/**
 * Which folders are in the build is `resolveVehicleSources`' call — the SAME one `vehicle-installer` makes,
 * so a structured `--in` (`models/` overridden per slot by `new/`) gives the cutscene fleet exactly the cars
 * the driving fleet got (vehicle-installer plan 007). Reading the tree here on its own terms is how a
 * cutscene set drifts from the game it belongs to.
 *
 * The MODEL still comes from the `.dff` basename, never from the folder name: a slot is matched to whoever
 * ships its donor geometry, and one folder can ship several models.
 */
function indexModFolders(inPath: string, target?: BuildTarget): Map<string, { folder: string; hasTxd: boolean }> {
  const mods = new Map<string, { folder: string; hasTxd: boolean }>();
  for (const source of resolveVehicleSources(inPath, target).sources) {
    const files = readdirSync(source.folder).map((file) => file.toLowerCase());
    for (const file of files) {
      if (!file.endsWith('.dff')) {
        continue;
      }
      const model = file.slice(0, -'.dff'.length);
      mods.set(model, { folder: relative(inPath, source.folder), hasTxd: files.includes(`${model}.txd`) });
    }
  }

  return mods;
}

/** txdcut.ide `txdp` rows: cs txd name → parent txd name (lowercased; duplicate rows keep the first). */
function parseTxdcut(text: string): Map<string, string> {
  const rows = new Map<string, string>();
  sectionedParse(cleanLines(text), {
    txdp: (row) => {
      if (row.length < 2 || row[0] === '' || rows.has(row[0].toLowerCase())) {
        return;
      }
      rows.set(row[0].toLowerCase(), row[1].toLowerCase());
    },
  });

  return rows;
}

/**
 * All `cars`-section rows with at least `id, model, txd, type` — deliberately NOT the shared
 * `parseVehicleDefs`, whose column-count guard drops every boat row (the 098 recon's finding); the
 * census needs `csdinghy`'s donor.
 */
function parseVehicleRows(text: string): { byModel: Map<string, VehicleRow>; byTxd: Map<string, VehicleRow> } {
  const byModel = new Map<string, VehicleRow>();
  const byTxd = new Map<string, VehicleRow>();
  sectionedParse(cleanLines(text), {
    cars: (row) => {
      if (row.length < 4) {
        return;
      }
      const parsed: VehicleRow = { model: row[1].toLowerCase(), txd: row[2].toLowerCase(), type: row[3].toLowerCase() };
      byModel.set(parsed.model, parsed);
      if (!byTxd.has(parsed.txd)) {
        byTxd.set(parsed.txd, parsed);
      }
    },
  });

  return { byModel, byTxd };
}
