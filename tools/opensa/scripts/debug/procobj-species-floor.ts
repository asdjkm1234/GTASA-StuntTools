import type { MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { buildCellColliders } from '@opensa/renderware/collision/build-cell-colliders';
import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface, procObjCellBudget, scatterProcObjects } from '@opensa/renderware/map/procobj-scatter';
import { buildWorldGrid } from '@opensa/renderware/map/world-grid';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { readFileSync } from 'node:fs';

import { gameArg, gameDir, loadMapDefs, openGameArchive } from '../lib/game';

/**
 * **Does the per-cell clutter budget drop a species to ZERO?** The sizing task plan 07/01 asks for, on the
 * cap site whose unit that plan calls the useful one: the RUNTIME cell cap (`procObjLotteryCap` +
 * `procObjLimit`, 150 in `engine-canvas-host`), which decides both what is drawn and what is collided.
 *
 * A species is ELIGIBLE in a cell when it has a placement the vanilla density would draw (`lottery < 1`);
 * it is PLACED when it has one below `min(density, cap)`. Eligible-but-not-placed is the defect: terrain
 * that reads as simply having no cacti.
 *
 * Run: `npx tsx scripts/debug/procobj-species-floor.ts [--game original] [--limit 150] [--density 1]
 *       [--stride 7] [--cells 200] [--floor 0]`
 *
 * `--floor N` turns the FIX on (`procObjCellBudget`'s species floor, the engine's `?procobjFloor=<n>`): every
 * eligible species keeps at least `min(N, its eligible count)`. Run it at 0 and at N over the same sample and
 * the two "cells losing at least one species" numbers are the before/after.
 *
 * `--build-time` measures the OTHER cap site instead: `convertProcObj`'s whole-map pass, per species through
 * every stage — candidates → the `lottery < 1` cut → the global `procObjMax` slice. It runs the same
 * functions the converter does, over the same whole-map colliders, so it is the pipeline rather than a model
 * of it; the cost is one full collision build.
 *
 * **Read the corpus line it prints.** `game-src/<game>` is stock: 96 scatter rules. The BUILT tree is not —
 * the generator converts the tall species to static instances and strips them, leaving the runtime path
 * around 8 underwater rules, so a runtime-cap number taken off stock says nothing about what ships.
 */
const CELL_SIZE = 250; // keep in sync with canvas-host's CELL_SIZE
const game = gameArg();
const argValue = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);

  return at < 0 ? undefined : process.argv[at + 1];
};
/** The host's per-cell budget: how many placements a cell may draw+collide (`procObjLimit`). */
const limit = Number(argValue('--limit') ?? 150);
/** Per-category density; the config ships 1 (vanilla) for every category. */
const density = Number(argValue('--density') ?? 1);
/** The species floor under test (plan 012); 0 is the unfixed behaviour. */
const floor = Number(argValue('--floor') ?? 0);
/** Sample every Nth populated cell — a full sweep builds colliders for the whole map. */
const stride = Number(argValue('--stride') ?? 7);
const maxCells = Number(argValue('--cells') ?? 200);

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);
const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog: new Map() };
const grid = buildWorldGrid(defs, CELL_SIZE);
const index = buildCollisionIndex(archive);
/** `--rules <path>` reads a different `procobj.dat` over the same geometry — the built tree's, to ask what
 *  the SHIPPING runtime set does (the generator strips the converted species, leaving the underwater rules). */
const rulesPath = argValue('--rules') ?? gameDir(game, 'data', 'procobj.dat');
const rules = groupRulesBySurface(parseProcObj(readFileSync(rulesPath, 'utf8')));
const surfaceNames = parseSurfaceNames(readFileSync(gameDir(game, 'data', 'surfinfo.dat'), 'utf8'));

const keys = [...grid.keys()].sort();
const ruleCount = [...rules.values()].reduce((sum, list) => sum + list.length, 0);
console.log(
  `corpus ${gameDir(game)} · rules ${rulesPath} — ${ruleCount} on ${rules.size} surfaces, ${keys.length} cells`,
);

if (process.argv.includes('--build-time')) {
  reportBuildTime();
  process.exit(0);
}

const sampled = keys.filter((_, at) => at % stride === 0).slice(0, maxCells);
console.log(
  `${game}: sampling ${sampled.length} cells (stride ${stride}) · runtime cap: procObjLimit ${limit}, ` +
    `density ${density}, species floor ${floor === 0 ? 'OFF' : floor}`,
);

interface Zeroed {
  cell: string;
  eligible: number;
  lost: { model: string; wouldDraw: number }[];
  placed: number;
}

/**
 * The BUILD-time site, reproduced with the converter's own calls (`convertProcObj`): whole-map colliders,
 * one scatter at cell (0, 0), the `lottery < 1` cut, per-species MINDIST, then the global `procObjMax` slice.
 * Reports every species that reaches zero and at WHICH stage, which is the split the plan asks for.
 *
 * It runs all 96 stock rules, not the converted subset: the height gate that picks that subset is a
 * deliberate exclusion, and a species zeroed by rounding would be zeroed on either side of it.
 */
function reportBuildTime(): void {
  const procObjMax = Number(argValue('--max') ?? 20000);
  console.log(`\nbuild-time pass — whole-map colliders, procObjMax ${procObjMax}`);
  const colliders = buildColliders(index, defs, { center: [0, 0, 0], radius: Infinity });
  const batches = scatterProcObjects(colliders, rules, surfaceNames, 0, 0);
  console.log(`  ${colliders.length} collider groups, ${batches.length} batches`);

  interface Stage {
    afterCut: number;
    candidates: number;
    vanilla: number;
  }
  const stages = new Map<string, Stage>();
  const placed: { lottery: number; model: string }[] = [];
  for (const batch of batches) {
    const stage = stages.get(batch.model) ?? { afterCut: 0, candidates: 0, vanilla: 0 };
    const vanilla = batch.placements.filter((placement) => placement.lottery < 1);
    stage.candidates += batch.placements.length;
    stage.vanilla += vanilla.length;
    stages.set(batch.model, stage);
    for (const placement of vanilla) {
      placed.push({ lottery: placement.lottery, model: batch.model });
    }
  }
  placed.sort((a, b) => a.lottery - b.lottery);
  const final = placed.slice(0, procObjMax);
  for (const { model } of final) {
    stages.get(model)!.afterCut += 1;
  }
  console.log(
    `  placed ${placed.length} → final ${final.length} · the global cut ` +
      (placed.length > procObjMax ? `BINDS (dropped ${placed.length - procObjMax})` : 'never fires'),
  );

  const zeroedByLottery = [...stages].filter(([, s]) => s.candidates > 0 && s.vanilla === 0);
  const zeroedByCut = [...stages].filter(([, s]) => s.vanilla > 0 && s.afterCut === 0);
  console.log(`\n  species with candidates: ${stages.size}`);
  console.log(`  zeroed by the lottery cut (rounding): ${zeroedByLottery.length}`);
  console.log(`  zeroed by the global procObjMax cut:  ${zeroedByCut.length}`);
  for (const [model, stage] of [...zeroedByLottery, ...zeroedByCut]) {
    console.log(`    ${model.padEnd(22)} candidates ${stage.candidates} → vanilla ${stage.vanilla}`);
  }

  console.log('\n  thinnest survivors (species · candidates → vanilla → final):');
  const survivors = [...stages].filter(([, s]) => s.afterCut > 0).sort((a, b) => a[1].afterCut - b[1].afterCut);
  for (const [model, stage] of survivors.slice(0, 15)) {
    console.log(
      `    ${model.padEnd(22)} ${String(stage.candidates).padStart(6)} → ${String(stage.vanilla).padStart(6)} → ` +
        `${stage.afterCut}`,
    );
  }
}
const zeroedCells: Zeroed[] = [];
const lostByModel = new Map<string, { cells: number; instances: number }>();
let cellsWithClutter = 0;
let cellsCapBinding = 0;
let identityFailures = 0;
let drawnTotal = 0;
let tradedInstances = 0;

for (const key of sampled) {
  const [cx, cy] = key.split(',').map((part) => Number(part));
  const colliders = buildCellColliders(index, defs, grid, cx, cy);
  const batches = scatterProcObjects(colliders, rules, surfaceNames, cx, cy);
  if (batches.length === 0) {
    continue;
  }
  // The engine's own decision function — density knobs, the cell cap and the floor resolved together.
  const densityOf = (): number => density;
  const keep = procObjCellBudget(batches, { densityOf, limit, speciesFloor: floor });
  // What the floor COSTS: the budget is conserved, so its price is placements traded from the abundant
  // species to the rare ones. Counted against the same cell decided with the floor off.
  const unfloored = floor > 0 ? procObjCellBudget(batches, { densityOf, limit }) : keep;
  for (let at = 0; at < batches.length; at += 1) {
    tradedInstances += Math.max(0, keep[at] - unfloored[at]);
  }
  // Counted per MODEL, which is the unit the floor protects and the unit a player sees: 19 of the 56 models
  // scatter on several surfaces and are several batches, and a bush drawn from the neighbouring surface has
  // not gone missing from the cell.
  const perModel = new Map<string, { drawn: number; vanilla: number }>();
  let drawn = 0;
  let wouldDrawTotal = 0;
  for (let at = 0; at < batches.length; at += 1) {
    const batch = batches[at];
    // Placements are sorted by lottery ascending, so a count is a scan to the first value at or above.
    const atVanilla = batch.placements.filter((placement) => placement.lottery < density).length;
    wouldDrawTotal += atVanilla;
    drawn += keep[at];
    const row = perModel.get(batch.model) ?? { drawn: 0, vanilla: 0 };
    row.drawn += keep[at];
    row.vanilla += atVanilla;
    perModel.set(batch.model, row);
  }
  const lost: { model: string; wouldDraw: number }[] = [];
  let eligible = 0;
  let placed = 0;
  for (const [model, row] of perModel) {
    if (row.vanilla === 0) {
      continue;
    }
    eligible += 1;
    if (row.drawn > 0) {
      placed += 1;
    } else {
      lost.push({ model, wouldDraw: row.vanilla });
    }
  }
  if (eligible === 0) {
    continue;
  }
  cellsWithClutter += 1;
  drawnTotal += drawn;
  // Self-check: the cap IS the budget. It BINDS only when more placements sit below the density than the
  // budget allows (a cell can hold more than `limit` candidates and still have its 150th lottery above 1 —
  // then density is the cutoff and the cap costs nothing). Binding ⇒ exactly `limit` drawn; not binding ⇒
  // everything vanilla would draw. **The floor does not change this** — it is paid for at the top of the
  // lottery order — except where the floor alone over-subscribes the budget, which is what a failure here
  // would be reporting. A failure means the budget rule has been read wrong and every count below measures
  // something else.
  const binding = wouldDrawTotal > limit;
  const expected = binding ? limit : wouldDrawTotal;
  if (drawn !== expected) {
    identityFailures += 1;
  }
  if (binding) {
    cellsCapBinding += 1;
  }
  if (lost.length > 0) {
    zeroedCells.push({ cell: key, eligible, lost, placed });
    for (const { model, wouldDraw } of lost) {
      const row = lostByModel.get(model) ?? { cells: 0, instances: 0 };
      row.cells += 1;
      row.instances += wouldDraw;
      lostByModel.set(model, row);
    }
  }
}

console.log(
  `\ncells with clutter: ${cellsWithClutter} · cap BINDING in ${cellsCapBinding} ` +
    `(${((100 * cellsCapBinding) / Math.max(1, cellsWithClutter)).toFixed(1)} %)`,
);
console.log(`self-check: ${identityFailures} cells where drawn != the budget (must be 0)`);
console.log(
  `cells losing at least one species to the cap: ${zeroedCells.length} ` +
    `(${((100 * zeroedCells.length) / Math.max(1, cellsWithClutter)).toFixed(1)} % of cells with clutter)`,
);
if (floor > 0) {
  console.log(
    `the floor's price: ${tradedInstances} of ${drawnTotal} drawn placements traded from the abundant ` +
      `species to the rare ones (${((100 * tradedInstances) / Math.max(1, drawnTotal)).toFixed(2)} %) — ` +
      'the budget itself is unchanged',
  );
}

if (lostByModel.size > 0) {
  console.log('\nspecies dropped to zero (cells, and the instances vanilla would have drawn):');
  for (const [model, row] of [...lostByModel].sort((a, b) => b[1].cells - a[1].cells)) {
    console.log(`  ${model.padEnd(22)} ${String(row.cells).padStart(4)} cells   ${row.instances} instances`);
  }
  console.log('\nworst cells (species placed / eligible):');
  for (const entry of zeroedCells.sort((a, b) => a.placed / a.eligible - b.placed / b.eligible).slice(0, 12)) {
    const [cx, cy] = entry.cell.split(',').map((part) => Number(part));
    const at = `${(cx * CELL_SIZE + CELL_SIZE / 2).toFixed(0)},${(cy * CELL_SIZE + CELL_SIZE / 2).toFixed(0)}`;
    console.log(
      `  cell ${entry.cell.padEnd(9)} (~${at.padEnd(12)}) ${entry.placed}/${entry.eligible} — lost ` +
        entry.lost.map(({ model, wouldDraw }) => `${model} (${wouldDraw})`).join(', '),
    );
  }
}
