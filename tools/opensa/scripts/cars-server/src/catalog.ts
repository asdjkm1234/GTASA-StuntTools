import type { BuildTarget } from '@opensa/tool-kit/target';
import type { LedgerRow } from '@opensa/vehicle-installer/ledger';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleSlot, resolveVehicleSources, type VehicleSource } from '@opensa/tool-kit/vehicles-dir';
import { ADDS_LEDGER, readAddsRows } from '@opensa/vehicle-installer/ledger';
import { decodeSettings, parseVehicleSettings } from '@opensa/vehicle-installer/settings';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { vehicleTags } from './tags';

export interface Catalog {
  /** One line for the header about the ADDED fleet: where its ids were read from, or why it is absent.
   *  `null` when the game has no added cars at all. */
  readonly addedNote: null | string;
  /** Installed cars with NO screenshot under their slot (`new/` candidates excluded — theirs is withheld on
   *  purpose), in page order — the warning at the top of the page. */
  readonly missingShots: readonly MissingShot[];
  /** The `screenshots/` folders read, one per applied layer in apply order (`common` first) — for the header. */
  readonly screenshotDirs: readonly string[];
  /** Slot → the screenshot's absolute path (only for slots that have one). */
  readonly screenshots: ReadonlyMap<string, string>;
  readonly sections: readonly CatalogSection[];
  /** Slot → the stock car's `data:` URI. */
  readonly stockImages: ReadonlyMap<string, string>;
  /** How the vehicles folder is shaped — a layered one is what makes the target matter. */
  readonly strategy: 'flat' | 'layered' | 'structured';
  readonly total: number;
  /** Cars whose slot the metadata does not know — shown last, under their own heading. */
  readonly unknownSection: string;
}

export interface CatalogCar {
  /** ADDED cars drawn under this one, a size down — the alternatives that name this slot as their base. */
  readonly alternatives?: readonly CatalogCar[];
  /** The mod author — the folder name's third field. */
  readonly author: string;
  /** For an ADDED card: the base slot it is drawn under (one of {@link bases}). */
  readonly base?: string;
  /** For an ADDED car: the stock slot(s) it varies, out of the folder name's `(base)` suffix. */
  readonly bases?: readonly string[];
  /** What the mod actually is — the folder name's second field. */
  readonly carName: string;
  /** The folder name, verbatim. */
  readonly folder: string;
  /** `true` when the stock metadata has a picture for this slot. */
  readonly hasOriginal: boolean;
  /** `true` when a field screenshot was found for this slot. */
  readonly hasShot: boolean;
  /** The `vehicles.ide` id — the mod's own row, else the stock one, else `null`. */
  readonly id: null | number;
  /** For an ADDED card under several bases: `true` on the one it inherits sound and tuning parts from. */
  readonly inherits?: boolean;
  /** `true` when the build takes this car out of `new/` rather than out of `models/`. */
  readonly isCandidate: boolean;
  /** The bases the BUILT ledger records, when they disagree with the folder — the folder's are what is drawn. */
  readonly ledgerBases?: readonly string[];
  /** The game model slot this car takes over. */
  readonly slot: string;
  readonly tags: readonly string[];
  /** An ADDED car the built ledger has no row for: its id is not promised yet, so none is shown. */
  readonly unpromisedId?: boolean;
}

export interface CatalogSection {
  /** URL fragment for the section jump list. */
  readonly anchor: string;
  readonly cars: readonly CatalogCar[];
  readonly name: string;
}

/** The bundled `data/original.json`: section name → the stock cars it holds. */
export type Metadata = Record<string, { items: MetadataItem[] }>;

export interface MissingShot {
  /** The screenshot filename to SAVE — the car's folder name + `.png` (any of {@link SHOT_EXTENSIONS} is read;
   *  matched by SLOT, so a name typo still joins). */
  readonly expectedFile: string;
  /** The car folder, with its layer when there is one (`sa/models/admiral - …`). */
  readonly folder: string;
  /** The section anchor + slot, so the warning can jump to the card. */
  readonly sectionAnchor: string;
  readonly slot: string;
}

/** What {@link addedFleet} hands back: the added cards, sorted into the base that hosts them. */
interface AddedFleet {
  /** Base slot → the added cards drawn under it, a size down. */
  readonly alternatives: ReadonlyMap<string, readonly CatalogCar[]>;
  /** How many added cars the tree holds — every one is a car on the page, hosted or orphan. */
  readonly count: number;
  /** The ledger file the ids came from, or `null` when there is no built tree to promise any. */
  readonly ledger: null | string;
  readonly missing: readonly (Omit<MissingShot, 'sectionAnchor'> & { section: string })[];
  /** Added cars whose base has no card — nothing to hang them off, so they keep their own section. */
  readonly orphans: readonly CatalogCar[];
  /** Slot → screenshot path, for the added cars that have one. */
  readonly shots: ReadonlyMap<string, string>;
}

/** One item of the bundled metadata: the STOCK car, keyed by the slot it occupies. */
interface MetadataItem {
  /** A `data:` URI — the stock car's picture. The bundled `src` (a wiki URL) is deliberately not used. */
  readonly image: string;
  /** The model slot (`admiral`). */
  readonly name: string;
  readonly section: string;
  readonly src?: string;
}

/** Where a car with no metadata section lands, so nothing is silently dropped from the page. */
const UNKNOWN_SECTION = 'Not in the metadata';

/**
 * The ADDED cars' own section. They are not in the stock metadata by definition — they hold ids the game
 * never had — so putting them in the catch-all would read as a fault when it is the whole point of them.
 */
const ADDED_SECTION = 'Added vehicles';

/** What counts as a screenshot; the same slot may be a `.png` in `common/` and a `.jpg` in `sa/`. */
const SHOT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** The pictures folder beside the cars — at the tree's root, or inside EACH build layer of a layered tree. */
const SCREENSHOTS_DIR = 'screenshots';

export interface CatalogOptions {
  /** `mods-src/<game>/add-vehicles` — the ADDED fleet, drawn under the slots it varies (plan 003). */
  readonly addedPath?: string;
  /** `build/<game>/sa` — read for ONE thing: the id the built tree promises each added car. */
  readonly builtPath?: string;
  /** `game-src/<game>` — read for the stock `vehicles.ide` when a mod declares no id of its own. */
  readonly gamePath: string;
  /** The bundled metadata, already parsed. */
  readonly metadata: Metadata;
  /** Which layer of a LAYERED vehicles folder is shown after `common` — the target the page describes. */
  readonly target?: BuildTarget;
  /** `mods-src/<game>/vehicles`. */
  readonly vehiclesPath: string;
}

/**
 * Join the three sources into what the page renders: the bundled stock metadata, the installed fleet
 * (`resolveVehicleSources`, so this is exactly the fleet the build installs) and the field screenshots.
 *
 * **The join key is the SLOT, never the folder name.** All three sets line up 1:1 by slot on the real tree,
 * but five screenshots do not match their folder's name character for character
 * (`at400 - Boeing 727-100 Liveries- carcer.png` lost a space) — a filename join loses those five and looks
 * like missing screenshots.
 *
 * The fleet is the resolver's, `new/` candidates included, because that is what the build installs — but a
 * candidate is MARKED and gets no screenshot: the picture filed under its slot is of the car it displaced.
 *
 * Screenshots follow the layers the fleet does: a flat/structured tree has ONE `screenshots/` at its root; a
 * layered tree has one per layer, and **a car's picture is read from its OWN layer only** — a `sa/models/x`
 * car looks in `sa/screenshots/`, never in `common/screenshots/` (the picture filed there under its slot is of
 * the `common` car it displaced — the same lie a `new/` candidate's incumbent picture would be). A car
 * without a picture in its layer is reported missing. The other target's folder is never read.
 */
export function buildCatalog(options: CatalogOptions): Catalog {
  const stockImages = new Map<string, string>();
  const sectionOf = new Map<string, string>();
  for (const [section, { items }] of Object.entries(options.metadata)) {
    for (const item of items) {
      const slot = item.name.trim().toLowerCase();
      stockImages.set(slot, item.image);
      sectionOf.set(slot, section);
    }
  }

  const plan = resolveVehicleSources(options.vehiclesPath, options.target);
  // One index per applied layer, keyed by the layer name (`flat` for an unlayered tree); a car reads its own.
  const shotsByLayer = new Map<string, Map<string, string>>();
  const screenshotDirs: string[] = [];
  for (const layer of plan.layers) {
    const directory = join(options.vehiclesPath, layer.subdir ?? '', SCREENSHOTS_DIR);
    screenshotDirs.push(directory);
    shotsByLayer.set(layer.name, indexScreenshots(directory));
  }
  const screenshots = new Map<string, string>();
  const stockIds = stockVehicleIds(options.gamePath);
  const bySection = new Map<string, CatalogCar[]>();
  const missing: (Omit<MissingShot, 'sectionAnchor'> & { section: string })[] = [];
  /** Which section each REPLACED slot's card landed in — where an alternative naming it as base is drawn. */
  const sectionOfSlot = new Map<string, string>();
  let total = 0;
  for (const source of plan.sources) {
    const car = describe(source.folder, source.name, source.slot, stockIds);
    const section = sectionOf.get(source.slot) ?? UNKNOWN_SECTION;
    // A `new/` candidate is shown because the BUILD installs it — dropping it would leave the slot's
    // incumbent on the page under a car the build no longer ships. Its screenshot is withheld: the picture
    // in `screenshots/` is of the car it displaced, and showing that under the candidate is a lie.
    const isCandidate = source.origin === 'new';
    const shot = shotsByLayer.get(source.layer ?? 'flat')?.get(source.slot);
    const hasShot = shot !== undefined;
    if (hasShot) {
      screenshots.set(source.slot, shot);
    }
    if (!isCandidate && !hasShot) {
      missing.push({
        expectedFile: `${source.name}${SHOT_EXTENSIONS[0]}`,
        folder: sourceLabel(source),
        section,
        slot: source.slot,
      });
    }
    bySection.set(section, [
      ...(bySection.get(section) ?? []),
      {
        ...car,
        hasOriginal: stockImages.has(source.slot),
        hasShot: !isCandidate && hasShot,
        isCandidate,
      },
    ]);
    sectionOfSlot.set(source.slot, section);
    total += 1;
  }

  // The ADDED fleet is drawn UNDER the stock slot each car varies (plan 003) — see `addedFleet`.
  const added = addedFleet(options, stockIds, sectionOfSlot);
  for (const [slot, path] of added.shots) {
    screenshots.set(slot, path);
  }
  missing.push(...added.missing);
  if (added.orphans.length > 0) {
    bySection.set(ADDED_SECTION, [...(bySection.get(ADDED_SECTION) ?? []), ...added.orphans]);
  }
  if (options.addedPath !== undefined && added.count > 0) {
    screenshotDirs.push(join(options.addedPath, SCREENSHOTS_DIR));
  }
  total += added.count;

  // Section order is the metadata's own (`Sports Cars` first, as authored), with the catch-all last.
  const ordered = [...Object.keys(options.metadata), ADDED_SECTION, UNKNOWN_SECTION].filter((name) =>
    bySection.has(name),
  );
  const missingShots = ordered.flatMap((section) =>
    missing
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.slot.localeCompare(b.slot, 'en'))
      .map(({ expectedFile, folder, slot }) => ({ expectedFile, folder, sectionAnchor: anchorOf(section), slot })),
  );

  return {
    addedNote: addedNoteFor(options, added.count, added.ledger),
    missingShots,
    screenshotDirs,
    screenshots,
    sections: ordered.map((name) => ({
      anchor: anchorOf(name),
      cars: (bySection.get(name) ?? [])
        .sort((a, b) => a.slot.localeCompare(b.slot, 'en'))
        .map((car) => withAlternatives(car, added.alternatives)),
      name,
    })),
    stockImages,
    strategy: plan.strategy,
    total,
    unknownSection: UNKNOWN_SECTION,
  };
}

/**
 * The added cars, each one a card hanging off the stock slot it varies: the `(base)` suffix of the folder
 * name is the relation (`tools/add-vehicles`' own rule), and a base with a card of its own takes the car as
 * an ALTERNATIVE. One naming several bases appears under each, marked on the one it inherits sound and
 * tuning parts from; one whose base nobody replaced has nowhere to hang and stays an orphan in its own
 * section. The id comes from the BUILT tree's ledger and nowhere else — an added car has no stock row to
 * fall back on, and a folder the last build never saw holds no id rather than a plausible-looking one.
 */
function addedFleet(
  options: CatalogOptions,
  stockIds: ReadonlyMap<string, number>,
  sectionOfSlot: ReadonlyMap<string, string>,
): AddedFleet {
  const sources = addedSources(options.addedPath, options.target);
  const shotsOnDisk = indexScreenshots(join(options.addedPath ?? '', SCREENSHOTS_DIR));
  const ledger = readLedger(options.builtPath);
  const alternatives = new Map<string, CatalogCar[]>();
  const missing: AddedFleet['missing'][number][] = [];
  const orphans: CatalogCar[] = [];
  const shots = new Map<string, string>();
  for (const source of sources) {
    const shot = shotsOnDisk.get(source.slot);
    if (shot !== undefined) {
      shots.set(source.slot, shot);
    }
    const row = ledger.rows.get(source.slot);
    const card: CatalogCar = {
      ...describe(source.folder, source.name, source.slot, stockIds),
      bases: source.bases,
      hasOriginal: false,
      hasShot: shot !== undefined,
      id: row?.id ?? null,
      isCandidate: source.origin === 'new',
      ledgerBases: row !== undefined && row.bases.join(',') !== source.bases.join(',') ? row.bases : undefined,
      unpromisedId: row === undefined,
    };
    const hosts = source.bases.filter((base) => sectionOfSlot.has(base));
    for (const base of hosts) {
      alternatives.set(base, [
        ...(alternatives.get(base) ?? []),
        { ...card, base, inherits: base === source.bases[0] },
      ]);
    }
    if (hosts.length === 0) {
      orphans.push(card);
    }
    if (shot === undefined) {
      missing.push({
        expectedFile: `${source.name}${SHOT_EXTENSIONS[0]}`,
        folder: sourceLabel(source),
        section: sectionOfSlot.get(hosts[0] ?? '') ?? ADDED_SECTION,
        slot: source.slot,
      });
    }
  }

  return { alternatives, count: sources.length, ledger: ledger.source, missing, orphans, shots };
}

/** The header's one line about the added fleet — where its ids came from, or why there are none on screen. */
function addedNoteFor(options: CatalogOptions, shown: number, ledgerSource: null | string): null | string {
  if (options.addedPath === undefined || !existsSync(options.addedPath)) {
    return null;
  }
  if (options.target === 'opensa') {
    return 'Added cars are not shown: they are an SA-only feature, and the opensa build installs none of them.';
  }
  if (ledgerSource === null) {
    return `${shown} added car(s), drawn under the slot each one varies. No built tree was found, so no ids are shown — an added car's id is promised by the build, not by its folder.`;
  }

  return `${shown} added car(s), drawn under the slot each one varies; ids from ${ledgerSource}.`;
}

/**
 * The added fleet, resolved the same way the replacement fleet is — empty when no root was given, and empty
 * on any target but `sa`: `resolveAddedVehicles` refuses the others outright (ModelVariations, FLA's audio
 * loader and Parked Maker are the real game's), so an `opensa` build installs none of these cars and a page
 * that listed them would be describing a build nobody gets. The header says so rather than just dropping them.
 */
function addedSources(addedPath: string | undefined, target: BuildTarget | undefined): readonly VehicleSource[] {
  if (addedPath === undefined || !existsSync(addedPath) || target === 'opensa') {
    return [];
  }

  return resolveVehicleSources(addedPath, target).sources;
}

/** URL fragment for a section heading. */
function anchorOf(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Read one car folder: the three name fields, the id it declares, and what it ships. */
function describe(
  folderPath: string,
  folderName: string,
  slot: string,
  stockIds: ReadonlyMap<string, number>,
): Omit<CatalogCar, 'hasOriginal' | 'hasShot' | 'isCandidate'> {
  const [, carName = '', author = ''] = folderName.split(' - ').map((field) => field.trim());
  const dirents = readdirSync(folderPath, { withFileTypes: true });
  const entries = dirents.map((entry) => entry.name);
  const settingsFile = entries.find((name) => name.toLowerCase().endsWith('.settings.txt'));
  const settings = settingsFile
    ? parseVehicleSettings(decodeSettings(readFileSync(join(folderPath, settingsFile))), ignoreWarning)
    : {};
  const declaredId = Number(settings.ideLine?.split(',')[0]?.trim());

  return {
    author,
    carName,
    folder: folderName,
    id: Number.isFinite(declaredId) ? declaredId : (stockIds.get(slot) ?? null),
    slot,
    tags: vehicleTags(
      {
        entries,
        hasCleo: dirents.some((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'cleo'),
        slot,
      },
      settings,
    ),
  };
}

/** The page reports what a mod SHIPS, not what its settings file failed to parse — that is the installer's job. */
function ignoreWarning(): void {
  return undefined;
}

/** Slot → screenshot path. Matched on the slot, so a name typo in the picture still finds its car. */
function indexScreenshots(directory: string): Map<string, string> {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return new Map();
  }
  const shots = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (!entry.isFile() || !SHOT_EXTENSIONS.includes(extension)) {
      continue;
    }
    shots.set(parseVehicleSlot(entry.name.slice(0, entry.name.lastIndexOf('.'))), join(directory, entry.name));
  }

  return shots;
}

/** The ids the BUILT tree promises each added car, by slot, plus the file they were read from. */
function readLedger(builtPath: string | undefined): { rows: ReadonlyMap<string, LedgerRow>; source: null | string } {
  if (builtPath === undefined || !existsSync(join(builtPath, ADDS_LEDGER))) {
    return { rows: new Map(), source: null };
  }
  // Only `car` rows: the rest are a replacement car's derived tuning PARTS, which share the id window and
  // the file but are not cars and have no card.
  const rows = readAddsRows(builtPath).filter((row) => row.kind === 'car');

  // Relative to the cwd: the header prints it, and an absolute path there is a line of noise nobody reads.
  return {
    rows: new Map(rows.map((row) => [row.slot, row])),
    source: relative(process.cwd(), join(builtPath, ADDS_LEDGER)),
  };
}

/** `sa/models/<name>` for a layered source, `models/<name>` for a structured one, the name for a flat one. */
function sourceLabel(source: VehicleSource): string {
  return [source.layer, source.origin === 'flat' ? undefined : source.origin, source.name]
    .filter((part): part is string => part !== undefined)
    .join('/');
}

/** The stock `vehicles.ide` ids, so a mod that declares no ide row still shows the id it takes over. */
function stockVehicleIds(gamePath: string): Map<string, number> {
  const path = join(gamePath, 'data', 'vehicles.ide');
  if (!existsSync(path)) {
    return new Map();
  }
  const ids = new Map<string, number>();
  for (const def of parseVehicleDefs(readFileSync(path, 'utf8')).values()) {
    ids.set(def.model.toLowerCase(), def.id);
  }

  return ids;
}

/** A base card, with the alternatives that name it — sorted by slot, as every other list on the page is. */
function withAlternatives(car: CatalogCar, alternatives: ReadonlyMap<string, readonly CatalogCar[]>): CatalogCar {
  const attached = alternatives.get(car.slot);

  return attached === undefined
    ? car
    : { ...car, alternatives: [...attached].sort((a, b) => a.slot.localeCompare(b.slot, 'en')) };
}
