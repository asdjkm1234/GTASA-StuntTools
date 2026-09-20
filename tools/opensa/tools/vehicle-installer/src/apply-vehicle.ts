import type { EditableImg } from '@opensa/tool-kit/archive/img';
import type { BuildTarget } from '@opensa/tool-kit/target';

import { splitRow } from '@opensa/renderware/parsers/text/text-lines';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { applyVehicleAudio, AUDIO_FILE } from './audio';
import { parseFeatures } from './features';
import { applyVehicleText, TEXT_FILE, type TextEntry } from './fxt';
import { stageVehicleImg } from './img-merge';
import { mergeCarcols, mergeCarmods, mergeHandling, mergeIde, removeCarmods } from './merge';
import { resolveVehicleModel } from './model';
import { applyModelVariations, MODEL_VARIATIONS_EXTRA_FILE } from './model-variations';
import { addPaletteColors, resolveColorRefs } from './palette';
import { applyVehicleParked, PARKED_FILE } from './parked';
import { decodeSettings, ID_PLACEHOLDER, parseVehicleSettings, type VehicleSettings } from './settings';
import { applyTuningParts, TUNING_PARTS_FILE } from './tuning-parts';

/** The mod's own feature declaration, by the Modloader/IVF name. */
const FEATURES_FILE = 'features.txt';

/**
 * Every `.txt` a folder may ship that is NOT the settings file. The settings file is found by its
 * `.settings.txt` suffix and only falls back to "the first other `.txt`" for the pre-suffix mods — so every
 * name we know has to be excluded from that fallback, or a car shipping one of these and no settings file
 * has it parsed AS settings and warns "nothing recognised — STOCK".
 */
const KNOWN_TXT_FILES = [
  FEATURES_FILE,
  TUNING_PARTS_FILE,
  MODEL_VARIATIONS_EXTRA_FILE,
  TEXT_FILE,
  AUDIO_FILE,
  PARKED_FILE,
];

/** What one vehicle contributed — its gta3.img entries + the keys `--strip` keeps (model name, handling id). */
export interface AppliedVehicle {
  /** Files carried from the mod's `cleo/` subfolder into `<out>/cleo/` (dest paths relative to it). */
  cleo: string[];
  /** What the mod's `features.txt` declares (uppercased tokens) — empty when it ships none. */
  features: string[];
  /** Handling id (uppercase) from the ide line's col 4 / the handling line / the model — for handling.cfg strip. */
  handlingId?: string;
  /** gta3.img entry names written (lowercased dff/txd). */
  imgNames: string[];
  /** Model name (lowercased, the dff basename) — for vehicles.ide / carcols.dat / carmods.dat strip. */
  model?: string;
  /** What the settings file lost on the way in — every one of these is data the car will run STOCK without. */
  warnings: string[];
}

export interface ApplyVehicleOptions {
  /**
   * The open `models/gta3.img` to stage the folder's `dff`/`txd` into. **The caller owns it and writes it
   * once**, after every vehicle has been staged — one archive rebuild per RUN instead of one per car.
   *
   * Omitted means the archive is not touched at all, which is what a REBAKE wants: its target is a CONVERTED
   * tree, where a car is one `.osm` and the pack has already deleted the `.dff`/`.txd` it was built from.
   * Writing the raw pair back would add entries the game does not read and cannot be told apart from a
   * half-converted archive.
   */
  /**
   * The model id an ADDED car is being installed under (`tools/add-vehicles`). Given, every `<:id>` in the
   * settings file is substituted before the blocks are classified — the ide line then reads like any other.
   * Omitted, the file is used as authored, which is every car of the `vehicles/` root.
   */
  /** GXT entries the caller derived for this car (an added car's display name) — see {@link applyVehicleText}. */
  gxt?: readonly TextEntry[];
  id?: number;
  img?: EditableImg;
  /**
   * Tuning part renames (stock name → derived name) applied to the SETTINGS text before it is parsed: an
   * added car authors its `carmods.dat` line against the stock part names, and the parts it ships are
   * installed under new ones (`tools/add-vehicles` 005). Matched whole-word, so `spl_a_l` never rewrites
   * part of `spl_a_l_b`.
   */
  partRenames?: ReadonlyMap<string, string>;
  /**
   * Take the `vehicles.ide` and `handling.cfg` lines INSTEAD of merging them into `data/`.
   *
   * An ADDED car's two rows may not be baked: a `cars` row in `data/vehicles.ide` is read from
   * `default.dat` at boot and the real game does not survive 115 of them, while the same row placed beside
   * the models is merged by Mod Loader's `std.data` (it matches data lines by SHAPE out of any text file —
   * `cars`, `peds` and `objs` tuning parts, its own documentation's footnote). Field-proven 2026-08-19;
   * `tools/add-vehicles` writes what this hands back.
   */
  redirectRows?: (rows: { handlingLine?: string; ideLine?: string }) => void;
  /** Archive entry renames for this folder's files — see {@link stageVehicleImg}. */
  renames?: ReadonlyMap<string, string>;
  /**
   * Which HOST the tree is being built for. It selects only what is a fact about the host rather than about
   * the mod: `modloader/Model_Variations/` is the real game's plugin and our engine has no such folder, so an
   * `opensa` tree skips that merge instead of warning eight times that a mod it cannot use is missing.
   * Omitted reads as the real game — the host this installer was written for.
   */
  target?: BuildTarget;
}

/**
 * Install one vehicle over `--out`: stage its `dff`/`txd` (+ extra txds) into `models/gta3.img` (replace by name),
 * carry its `cleo/` subfolder (scripts + `.ini` sidecars) into `<out>/cleo/`, then merge its `*.settings.txt`
 * lines into `data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat}`. Returns the archive entries written +
 * the model name / handling id (so a `--strip` run knows what to keep). A rebake re-runs the same path, so
 * changed scripts re-copy with the mod (plan 097/06 decision 3).
 */
export function applyVehicle(folderPath: string, outPath: string, options: ApplyVehicleOptions = {}): AppliedVehicle {
  const entries = readdirSync(folderPath);
  const staged = options.img === undefined ? null : stageVehicleImg(folderPath, options.img, options.renames);
  const imgNames = staged?.names ?? [];
  const cleo = carryCleoFolder(folderPath, entries, outPath);
  // The slot the folder NAME states, confirmed against the `.dff`s it ships — a bodykit folder ships several
  // and the first of them is not the car (see `resolveVehicleModel`). Without the archive step the file list
  // comes from the folder itself, which is what a rebake wants.
  const { model, warning: modelWarning } = resolveVehicleModel(
    basename(folderPath),
    options.img === undefined ? entries : imgNames,
  );

  // `features.txt` sits in the same folder and also ends in `.txt` — taking the FIRST `.txt` picked it over
  // `previon.settings.txt` (alphabetical order) and the car lost its whole settings file.
  const featuresFile = entries.find((name) => name.toLowerCase() === FEATURES_FILE);
  // Same decode as the settings file: a features file saved as UTF-16 must not read as a wall of NULs.
  const features = featuresFile ? parseFeatures(decodeSettings(readFileSync(join(folderPath, featuresFile)))) : [];
  const settingsFile =
    entries.find((name) => name.toLowerCase().endsWith('.settings.txt')) ??
    entries.find((name) => name.toLowerCase().endsWith('.txt') && !KNOWN_TXT_FILES.includes(name.toLowerCase()));
  const warnings: string[] = modelWarning ? [modelWarning] : [];
  // Reported, not silent: the file the mod ships would have crashed the real game on the model read, and
  // whoever owns the mod should know its export is wrong rather than find out from a bug report.
  for (const name of staged?.repaired ?? []) {
    warnings.push(`${name}: frame list declared a parent after its child — reordered before staging`);
  }
  // New tuning parts (IDE rows + shop entries) — independent of the settings file, and applied FIRST so
  // the carmods line merged below never names a part the tree does not define.
  warnings.push(...applyTuningParts(folderPath, entries, outPath));
  const settings =
    settingsFile === undefined
      ? undefined
      : parseVehicleSettings(
          renamedParts(
            withId(decodeSettings(readFileSync(join(folderPath, settingsFile))), options.id),
            options.partRenames,
          ),
          (message) => warnings.push(`${settingsFile}: ${message}`),
        );
  if (settings !== undefined) {
    mergeSettings(outPath, model, settings, options, settingsFile, warnings);
  }
  // The kinds that write OUTSIDE `data/*`, after the settings merge — a `{{name}}` naming this car's own slot,
  // and `parked.txt`'s id lookup, then resolve against the ide row it just wrote. Three of the four speak to
  // plugins of the REAL game (ModelVariations, FLA's audio loader, Parked Maker), so they are merged only
  // when that is the host being built for; the `.fxt` rides along with the mod's own `cleo/` either way.
  if (options.target !== 'opensa') {
    warnings.push(...applyModelVariations(folderPath, entries, outPath));
    warnings.push(...applyVehicleAudio(folderPath, entries, outPath, model));
    warnings.push(...applyVehicleParked(folderPath, entries, outPath, model, options.id));
  }
  warnings.push(...applyVehicleText(folderPath, entries, outPath, model, options.gxt));

  return {
    cleo,
    features,
    handlingId: settings === undefined ? undefined : handlingId(settings, model),
    imgNames,
    model,
    warnings,
  };
}

/**
 * Copy the mod's `cleo`/`CLEO` subfolder into `<out>/cleo/` (canonical lowercase, author-relative structure
 * preserved — `.ini` sidecars ride along). Returns the dest paths relative to `<out>/cleo/`.
 */
function carryCleoFolder(folderPath: string, entries: string[], outPath: string): string[] {
  const cleoDir = entries.find(
    (name) => name.toLowerCase() === 'cleo' && statSync(join(folderPath, name)).isDirectory(),
  );
  if (cleoDir === undefined) {
    return [];
  }
  const carried: string[] = [];
  const copyTree = (srcDir: string, rel: string): void => {
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
      const src = join(srcDir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        copyTree(src, relPath);
      } else {
        const dest = join(outPath, 'cleo', relPath);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(src));
        carried.push(relPath);
        console.log(`vehicle-installer: cleo → cleo/${relPath}`);
      }
    }
  };
  copyTree(join(folderPath, cleoDir), '');

  return carried;
}

function editFile(path: string, edit: (text: string) => string): void {
  if (existsSync(path)) {
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
  }
}

/** The handling id this vehicle keys into handling.cfg: the ide line's col 4, else the handling line's id, else
 *  the model uppercased. */
function handlingId(settings: ReturnType<typeof parseVehicleSettings>, model: string | undefined): string | undefined {
  const fromIde = settings.ideLine === undefined ? undefined : splitRow(settings.ideLine)[4];
  const fromHandling = settings.handlingLine?.trim().split(/\s+/)[0];

  return (fromIde || fromHandling || model)?.toUpperCase();
}

/**
 * Merge one car's four settings blocks into the built `data/*`. Split out of {@link applyVehicle} to keep
 * that function readable — it is the only caller.
 *
 * The ide and handling rows are the pair an ADDED car takes elsewhere (`options.redirectRows`): baked into
 * `data/vehicles.ide` they are read from `default.dat` while the game boots, and the real install does not
 * survive 115 of them.
 */
function mergeSettings(
  outPath: string,
  /** The slot this folder takes over — the key of the `carmods.dat` line it may have to REMOVE; absent when
   *  the folder's own name and its `.dff`s disagree, and then nothing is removed rather than the wrong line. */
  model: string | undefined,
  settings: VehicleSettings,
  options: ApplyVehicleOptions,
  settingsFile: string | undefined,
  warnings: string[],
): void {
  // Nothing at all recognised is the loud case: the file exists, the mod meant something by it, and the car is
  // about to run stock data under a mod model.
  if (Object.keys(settings).length === 0) {
    warnings.push(`${settingsFile}: nothing recognised — the car keeps STOCK handling/ide/carcols`);
  }
  const data = (name: string): string => join(outPath, 'data', name);

  if (options.redirectRows) {
    options.redirectRows({
      ...(settings.handlingLine === undefined ? {} : { handlingLine: settings.handlingLine }),
      ...(settings.ideLine === undefined ? {} : { ideLine: settings.ideLine }),
    });
  } else {
    if (settings.ideLine !== undefined) {
      editFile(data('vehicles.ide'), (text) => mergeIde(text, settings.ideLine!));
    }
    if (settings.handlingLine !== undefined) {
      editFile(data('handling.cfg'), (text) => mergeHandling(text, settings.handlingLine!));
    }
  }
  // Palette + carcols both edit carcols.dat: append any custom colours (assigning ids), then merge the carcols
  // line with its `newN` refs resolved to those ids.
  if (settings.palette?.length || settings.carcolsLine !== undefined) {
    editFile(data('carcols.dat'), (text) => {
      const { idByName, text: withColors } = addPaletteColors(text, settings.palette ?? []);

      return settings.carcolsLine === undefined
        ? withColors
        : mergeCarcols(withColors, resolveColorRefs(settings.carcolsLine, idByName));
    });
  }
  // A car that says nothing about tuning gets the stock line REMOVED rather than inherited (plan 015): that
  // line describes the model that used to hold the slot, and a universal part whose `ug_*` dummy the new
  // model does not carry crashes the game where it is installed. Measured when the rule was taken: no
  // inheriting car in the fleet ships part `.dff`s, so nothing that was buyable stops being buyable.
  if (settings.carmodsLine !== undefined) {
    editFile(data('carmods.dat'), (text) => mergeCarmods(text, settings.carmodsLine!));
  } else if (model !== undefined) {
    editFile(data('carmods.dat'), (text) => removeCarmods(text, model));
  }
}

/** The settings text with every stock part name replaced by the name its re-modelled copy is installed under. */
function renamedParts(text: string, renames: ReadonlyMap<string, string> | undefined): string {
  if (renames === undefined || renames.size === 0) {
    return text;
  }
  let out = text;
  for (const [stock, derived] of renames) {
    out = out.replace(new RegExp(`\\b${stock}\\b`, 'g'), derived);
  }

  return out;
}

/** The settings text with `<:id>` resolved — unchanged when the car is a replacement (no id to put there). */
function withId(text: string, id: number | undefined): string {
  return id === undefined ? text : text.split(ID_PLACEHOLDER).join(String(id));
}
