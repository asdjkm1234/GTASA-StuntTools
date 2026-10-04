import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { ProcObjCategoryName } from '@opensa/renderware/map/procobj-categories';
import type { ProcObjBatch, ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';
import type { ProcObjSampler, ProcObjSlopeConfig } from '@opensa/renderware/map/procobj-scatter';

import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import {
  groupRulesBySurface,
  PROC_OBJ_MAX_DENSITY,
  scatterProcObjects,
  validateSlopeConfig,
} from '@opensa/renderware/map/procobj-scatter';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ProcObjDensityConfig, ProcObjDensityInput } from './density';

import { setIdeDrawDistance } from '../ide';
import { buildPermanentAreas } from '../permanent-areas';
import { disableProcObj, stripProcObj, UNDERWATER_PROCOBJ } from '../procobj-strip';
import { densityCeiling, densityFor, densityProfile, validateDensityProfile } from './density';
import { buildMapDefinitions } from './world';

/**
 * Draw distance the baked clutter is declared at. **299, ProperFixes' number** — one metre under the 300 that
 * puts an object on SA's big-building path, and the value their 57 583-row layer is measured running. Stock
 * declares every procobj species at 59.
 */
export const PROC_OBJ_DRAW_DISTANCE = 299;

/** What one category cost this build — the readable half of decision 8's displacement warning. */
export interface ProcObjCategoryCost {
  category: ProcObjCategoryName;
  /** Survivors of the cutoff that the global `procObjMax` slice then took. */
  dropped: number;
  /** Candidates the scatter produced for this category, before any cutoff. */
  generated: number;
  /** What actually shipped. */
  objects: number;
}

export interface ProcObjConvertOptions {
  archive: ImgArchive;
  /** Base name for the area IPLs (`data/maps/<areaBase><i>.ipl` + their gta.dat lines) — e.g. `plobj`. */
  areaBase: string;
  /**
   * Build-time density CUTOFF on the scatter lottery. Every candidate carries
   * `lottery ∈ [0, PROC_OBJ_MAX_DENSITY)`; keeping `lottery < cutoff` is what picks how many survive, so
   * **1 is vanilla** and the count scales with it until `procObjMax` binds instead.
   *
   * A plain number is the whole map; a {@link ProcObjDensityConfig} sets it per category and per
   * category×surface (plan 010 decision 1). It is a build INPUT so an A/B can state what it was configured
   * with — the self-describing-capture rule.
   */
  density?: ProcObjDensityInput;
  /** `--modloader`: emit `procobj.dat` as **disable rows** (converted species' scatter set to zero, replacing the
   *  stock rule by surface+model on additive merge) instead of a stripped whole file — so the strip survives a
   *  Modloader additive `.dat` merge (which would re-add omitted species from stock). Default (false): strip. */
  disableScatter?: boolean;
  /**
   * Draw distance written onto the baked species' STOCK `data/maps/generic/procobj.ide` rows — the layer's whole
   * range mechanism now that nothing is streamed and nothing has a LOD (plan 014).
   *
   * Stock declares all 107 procobj models at **59**, which is why SA's runtime clutter pops in almost underfoot.
   * ProperFixes ships the same file at **299**, one metre under the 300 threshold that puts an object on SA's
   * big-building path — the default here, because matching a proven configuration comes before improving on it.
   * Per-category distances are the obvious next lever and want a measurement first (014 step 6).
   */
  drawDistance?: number;
  gamePath: string;
  /** Only convert species whose HD bbox is at least this tall (excludes grass/small bushes). 0 = no gate. */
  heightThreshold: number;
  /** Base name for the emitted sidecars (`data/maps/<iplName>.models` manifest) — e.g. `lod_procobj`. */
  iplName: string;
  outPath: string;
  /** Safety cap on total placed objects (HD count); the set is thinned to the lowest-lottery survivors. */
  procObjMax: number;
  /**
   * Where inside a collision triangle a placement lands — `area` (ours, the default) or `corner` (the
   * original's recovered routine). The SAME knob the runtime scatter takes, because it is one `sqrt` inside
   * the shared sampler.
   */
  sampler?: ProcObjSampler;
  /**
   * Slope-aware candidate density (plan 011): scale a face's candidate count by whether it is steep, per
   * category. The SAME config the runtime scatter takes — both targets read it through `scatterProcObjects`,
   * which is the only place a per-FACE signal can be spent.
   */
  slope?: ProcObjSlopeConfig;
  /** sourceName → its stock object id + bbox height (the {@link heightThreshold} gate). */
  species: ReadonlyMap<string, ProcObjSpecies>;
  /**
   * Guarantee every species that scattered a candidate in a {@link PROC_OBJ_FLOOR_CELL} cell at least this many
   * objects there, so a desert patch eligible for ten species shows all ten (plan 012). 0 = off.
   */
  speciesFloor?: number;
}

export interface ProcObjConvertResult {
  /** Per-category cost, sorted by category — see {@link ProcObjCategoryCost}. */
  categories: ProcObjCategoryCost[];
  datLines: string[];
  /** Species whose stock IDE draw distance was raised, and any this tool refused to guess at (plan 014). */
  drawDistance: { changed: number; skipped: string[] };
  /** Placements the global `procObjMax` slice took, all categories. */
  dropped: number;
  /** Objects the species floor promoted — candidates the density lottery had turned down (0 when off). */
  floored: number;
  /** Area text IPLs carrying `inst` rows — one of SA's 40 `IplEntityIndexArrays` slots each. */
  instBearingFiles: number;
  /** HD objects shipped. */
  objects: number;
  /** Permanent text-IPL rows — one per object now, so this is what the `CBuilding` pool pays. */
  rows: number;
  /** Area files from an earlier run that this one deleted — the in-place bake cleaning up after itself. */
  staleAreasRemoved: number;
}

/** Per converted species: the stock object id it is placed under + its bbox height (the gate). */
export interface ProcObjSpecies {
  hdId: number;
  height: number;
}

/** One placement that survived the density cutoff, with the category it was judged under. */
export interface SelectedPlacement {
  category: ProcObjCategoryName;
  model: string;
  placement: ProcObjPlacement;
}

/**
 * Emit the placements as **permanent text IPLs** — one row per object, `lod = -1`, no binary streams and no LOD
 * twin (plan 014). ProperFixes' shape, and the only one that fits SA at this density.
 *
 * Why the twin went: `CIplStore` loads a stream's IPL slot only inside its bounding box grown by 190 units, so a
 * streamed row cannot draw past ~190 m whatever the IDE says — and the LOD that used to buy the range recovered
 * ~0.2 % of a hand-modelled bush's geometry for the price of a whole entity. Range now comes from the IDE
 * instead (see {@link ProcObjConvertOptions.drawDistance}).
 *
 * `rows` is the layer's PRICE and is now simply the object count: every placement is a permanent row, so what it
 * spends is the `CBuilding` pool rather than an int16 index our asi lifts.
 */
export function buildPermanentIpl(
  final: readonly { model: string; placement: ProcObjPlacement }[],
  species: ReadonlyMap<string, ProcObjSpecies>,
  areaBase: string,
): { datLines: string[]; files: [string, string][]; instBearingFiles: number; rows: number } {
  const placements = final.map(({ model, placement }) => ({
    id: species.get(model)!.hdId,
    interior: 0,
    model,
    position: placement.position,
    rotation: iplQuaternion(placement.rotation),
  }));

  return { ...buildPermanentAreas(placements, areaBase), rows: placements.length };
}

export function convertProcObj(options: ProcObjConvertOptions): null | ProcObjConvertResult {
  const {
    archive,
    areaBase,
    density = 1,
    disableScatter,
    drawDistance = PROC_OBJ_DRAW_DISTANCE,
    gamePath,
    heightThreshold,
    iplName,
    outPath,
    procObjMax,
    sampler,
    slope,
    species,
    speciesFloor = 0,
  } = options;
  const profile = densityProfile(density);
  validateDensityProfile(profile, PROC_OBJ_MAX_DENSITY);
  if (slope) {
    validateSlopeConfig(slope);
  }
  // The scatter must GENERATE against the same headroom the cutoffs are read against, or a cutoff above the
  // default would keep candidates that were never rolled.
  const ceiling = densityCeiling(profile, PROC_OBJ_MAX_DENSITY);
  const procObjText = readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8');

  // Candidate species: clear the optional height gate and are not the never-touch underwater set.
  const eligible = new Set(
    [...species]
      .filter(([model, s]) => s.height >= heightThreshold && !UNDERWATER_PROCOBJ.has(model.toLowerCase()))
      .map(([model]) => model),
  );
  const rules = parseProcObj(procObjText).filter((rule) => eligible.has(rule.model));
  if (rules.length === 0) {
    return null;
  }
  const converted = new Set(rules.map((rule) => rule.model));

  // Scatter over the whole map at `density`, then a global lowest-lottery cap. Nothing thins by MINDIST: the
  // column is a camera radius, not an inter-object spacing (`docs/gta-sa-original/procedural-objects.md`).
  const defs = buildMapDefinitions(gamePath, archive);
  const colliders = buildColliders(buildCollisionIndex(archive), defs, { center: [0, 0, 0], radius: Infinity });
  const surfaceNames = parseSurfaceNames(readFileSync(join(gamePath, 'data', 'surfinfo.dat'), 'utf8'));
  const batches = scatterProcObjects(colliders, groupRulesBySurface(rules), surfaceNames, 0, 0, ceiling, {
    sampler,
    slope,
  });
  const { categories, dropped, final, floored } = selectPlacements(batches, profile, procObjMax, speciesFloor);

  const { datLines, files, instBearingFiles, rows } = buildPermanentIpl(final, species, areaBase);
  for (const [file, text] of files) {
    writeText(join(outPath, 'data', 'maps', file), text);
  }
  const orphans = removeStaleAreas(outPath, areaBase, new Set(files.map(([file]) => file.toLowerCase())));
  // Model-name manifest for downstream generators (pmb `collectGeneratedModels`).
  const placedModels = [...new Set(final.map(({ model }) => model))].sort();
  writeText(join(outPath, 'data', 'maps', `${iplName}.models`), placedModels.join('\r\n') + '\r\n');

  // The layer's RANGE: raise the baked species' stock IDE draw distance (59 → 299). Nothing here is streamed and
  // nothing has a LOD, so this row is the only thing deciding how far the clutter is visible.
  const distance = raiseDrawDistance(gamePath, outPath, placedModels, drawDistance);

  // Stop the converted species scattering at runtime (they're now static). `--out` strips them from a whole-file
  // procobj.dat; `--modloader` emits disable rows instead, so a Modloader additive `.dat` merge can't re-add them.
  writeText(
    join(outPath, 'data', 'procobj.dat'),
    disableScatter
      ? disableProcObj(procObjText, (m) => converted.has(m))
      : stripProcObj(procObjText, (m) => !converted.has(m.toLowerCase())).text,
  );

  return {
    categories,
    datLines,
    drawDistance: distance,
    dropped,
    floored,
    instBearingFiles,
    objects: final.length,
    rows,
    staleAreasRemoved: orphans,
  };
}

/** GTA IPL rotation quaternion for a yaw around Z (conjugated, the IPL convention; align is unused). */
export function iplQuaternion(yaw: number): [number, number, number, number] {
  return [0, 0, -Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

/**
 * Delete `<areaBase><n>.ipl` files this run did NOT write, returning how many went.
 *
 * The bake runs IN PLACE on the `sa` tree (plan 014), and that tree is not wiped between runs, so a run that
 * emits fewer areas than the last one leaves the surplus on disk. They are unregistered — `gta.dat` is rebuilt
 * from this run's `datLines`, so the game never reads them — but "the game ignores it" is not the same as
 * harmless: a build measured on the artifact then counts rows from two different scatters. It read 95 584 rows
 * across 46 files where the run had written 91 092 across 10, and that is exactly the kind of number that gets
 * published. The layer owns these names, so it cleans up after itself.
 */
export function removeStaleAreas(outPath: string, areaBase: string, written: ReadonlySet<string>): number {
  const maps = join(outPath, 'data', 'maps');
  if (!existsSync(maps)) {
    return 0;
  }
  const mine = new RegExp(`^${areaBase}\\d+\\.ipl$`, 'i');
  let removed = 0;
  for (const entry of readdirSync(maps)) {
    if (mine.test(entry) && !written.has(entry.toLowerCase())) {
      rmSync(join(maps, entry), { force: true });
      removed += 1;
    }
  }

  return removed;
}

/**
 * The cell the species floor counts a roster in — the SAME 250 u grid the runtime scatter streams on
 * (`engine-canvas-host`'s `CELL_SIZE`), so the two targets guarantee a roster over the same patch of ground.
 */
export const PROC_OBJ_FLOOR_CELL = 250;

/**
 * Apply the density profile to the scattered batches, then the global `procObjMax` slice — the whole of what a
 * profile DOES, with no file or collision work in it, which is what makes it testable without a game dir.
 *
 * `dropped` is the honest half of the cap (decision 7): once `procObjMax` binds, raising a cutoff stops adding
 * objects and starts DISPLACING them, because the slice keeps the lowest lotteries across every category at
 * once. A measurement that does not state the drop is measuring the cap and calling it the density — and the
 * per-category breakdown is what makes displacement readable, since "bushes +8 000, rocks −8 000" and
 * "+0 objects" are the same total.
 *
 * **`speciesFloor` guarantees the ROSTER of a cell** (plan 012, the `sa` half): every species that scattered a
 * candidate on that patch of ground keeps at least `min(N, its candidates)` objects. **It is a different gate
 * from the runtime floor's, and deliberately so**: there the budget cap is what zeroes a species, here nothing
 * caps anything (the global slice does not bind at the shipped density), so the only thing that can empty a
 * species locally is the density LOTTERY — a species with 3 candidates on a desert patch rolls all three above
 * the cutoff 30 % of the time. Widening the gate from "survived the density" to "had a candidate at all" is
 * what makes "ten species on this surface, all ten present" true rather than probable.
 *
 * Floored placements are kept AHEAD of the lottery order, so a `procObjMax` that ever binds displaces ordinary
 * objects rather than silently undoing the guarantee.
 */
export function selectPlacements(
  batches: readonly ProcObjBatch[],
  profile: ProcObjDensityConfig,
  procObjMax: number,
  speciesFloor = 0,
): { categories: ProcObjCategoryCost[]; dropped: number; final: SelectedPlacement[]; floored: number } {
  const generated = new Map<ProcObjCategoryName, number>();
  const placed: SelectedPlacement[] = [];
  /** cell×model → the candidates that lost the lottery, lowest first — the floor's reserve pool. */
  const spare = new Map<string, SelectedPlacement[]>();
  /** cell×model → how many already survived the cutoff. */
  const kept = new Map<string, number>();
  const cellKey = (placement: ProcObjPlacement, model: string): string =>
    `${Math.floor(placement.position[0] / PROC_OBJ_FLOOR_CELL)},${Math.floor(placement.position[1] / PROC_OBJ_FLOOR_CELL)} ${model}`;

  for (const batch of batches) {
    // A batch is one model on one SURFACE, so `densityFor` can answer on either axis without the converter
    // knowing which one a profile used.
    const cutoff = densityFor(profile, batch.category, batch.surface);
    generated.set(batch.category, (generated.get(batch.category) ?? 0) + batch.placements.length);
    for (const placement of batch.placements) {
      const entry = { category: batch.category, model: batch.model, placement };
      if (placement.lottery < cutoff) {
        placed.push(entry);
        if (speciesFloor > 0) {
          const key = cellKey(placement, batch.model);
          kept.set(key, (kept.get(key) ?? 0) + 1);
        }
      } else if (speciesFloor > 0) {
        const key = cellKey(placement, batch.model);
        const pool = spare.get(key);
        if (pool) {
          pool.push(entry);
        } else {
          spare.set(key, [entry]);
        }
      }
    }
  }

  const promoted: SelectedPlacement[] = [];
  for (const [key, pool] of spare) {
    const owed = speciesFloor - (kept.get(key) ?? 0);
    if (owed <= 0) {
      continue;
    }
    // Its own lowest lotteries — the most vanilla of the ones the cutoff turned down.
    pool.sort((a, b) => a.placement.lottery - b.placement.lottery);
    promoted.push(...pool.slice(0, owed));
  }
  placed.sort((a, b) => a.placement.lottery - b.placement.lottery);
  const final = [...promoted, ...placed].slice(0, procObjMax);

  return {
    categories: categoryCosts(generated, [...promoted, ...placed], final),
    dropped: promoted.length + placed.length - final.length,
    final,
    floored: promoted.length,
  };
}

/** Per category: candidates generated, survivors of the cutoff, and how many of those the global cap took. */
function categoryCosts(
  generated: ReadonlyMap<ProcObjCategoryName, number>,
  placed: readonly { category: ProcObjCategoryName }[],
  final: readonly { category: ProcObjCategoryName }[],
): ProcObjCategoryCost[] {
  const kept = new Map<ProcObjCategoryName, number>();
  for (const entry of placed) {
    kept.set(entry.category, (kept.get(entry.category) ?? 0) + 1);
  }
  const shipped = new Map<ProcObjCategoryName, number>();
  for (const entry of final) {
    shipped.set(entry.category, (shipped.get(entry.category) ?? 0) + 1);
  }

  return [...generated.keys()].sort().map((category) => ({
    category,
    dropped: (kept.get(category) ?? 0) - (shipped.get(category) ?? 0),
    generated: generated.get(category) ?? 0,
    objects: shipped.get(category) ?? 0,
  }));
}

/**
 * Rewrite the baked species' draw distance in `data/maps/generic/procobj.ide`, reading the STOCK file from
 * `gamePath` and writing the result under `outPath`.
 *
 * A missing file is a loud warning rather than a throw: a total conversion need not ship SA's procobj set, and
 * the placements are still correct without the raise — they would just keep whatever range the TC declared. A
 * model the editor refuses to guess at is named, because an unchanged draw distance is invisible until somebody
 * measures the range in the field.
 */
function raiseDrawDistance(
  gamePath: string,
  outPath: string,
  models: readonly string[],
  distance: number,
): { changed: number; skipped: string[] } {
  const relative = join('data', 'maps', 'generic', 'procobj.ide');
  const source = join(gamePath, relative);
  if (!existsSync(source)) {
    console.warn(`map-placement: no ${relative} under ${gamePath} — baked clutter keeps its declared draw distance`);

    return { changed: 0, skipped: [] };
  }
  const wanted = new Set(models.map((model) => model.toLowerCase()));
  const result = setIdeDrawDistance(readFileSync(source, 'utf8'), wanted, distance);
  writeText(join(outPath, relative), result.text);
  if (result.skipped.length > 0) {
    console.warn(
      `map-placement: ${relative} — ${result.skipped.length} row(s) not in the 5-cell objs form, draw distance ` +
        `left as authored: ${result.skipped.slice(0, 8).join(', ')}`,
    );
  }

  return { changed: result.changed.length, skipped: result.skipped };
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
