/**
 * Compare two `handling.cfg` tables column by column — and say how much of the difference the engine can
 * even SEE (plan 081).
 *
 * The question it answers: a well-calibrated handling mod is installed and the car still feels wrong. Is the
 * mod's intent reaching the physics at all? Today `gta-sa-world.adapter.ts` maps five columns; everything
 * else is parsed and dropped, so a tuning whose edits live in the other thirty-five is invisible by
 * construction. This prints that split as a number instead of an argument.
 *
 * Run: `npx tsx scripts/debug/handling-diff.ts <baseline.cfg> <candidate.cfg> [--rows] [--game original]`
 *   --rows  also list the per-car edits of the biggest-moving columns
 * With one path, the baseline defaults to the **BUILT** table (`build/<game>/opensa/data/handling.cfg`) —
 * what the game actually reads, mods merged. Comparing against `game-src/` instead cost a debugging session
 * in plan 081/02: a modded ADMIRAL row (damping 0.81 against the stock 0.15) was invisible there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gameArg, gameDir, positionalArgs } from '../lib/game';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** SA's standard (car) table, in column order after the id. Names as the community documents them. */
const COLUMNS = [
  'mass',
  'turnmass',
  'dragMult',
  'COM.x',
  'COM.y',
  'COM.z',
  'percentSubmerged',
  'tractionMult',
  'tractionLoss',
  'tractionBias',
  'numberOfGears',
  'maxVelocity',
  'engineAccel',
  'engineInertia',
  'driveType',
  'engineType',
  'brakeDecel',
  'brakeBias',
  'ABS',
  'steeringLock',
  'suspForceLevel',
  'suspDampingLevel',
  'suspHighSpdDamp',
  'suspUpperLimit',
  'suspLowerLimit',
  'suspBiasFrontRear',
  'suspAntiDive',
  'seatOffset',
  'damageMult',
  'monetaryValue',
  'modelFlags',
  'handlingFlags',
  'frontLights',
  'rearLights',
  'animGroup',
];

/** The columns `gta-sa-world.adapter.ts` actually maps into `VehicleHandling` (plan 081/01's finding). */
const READ = new Set([0, 11, 12, 16, 19]);

function parse(path: string): Map<string, string[]> {
  const table = new Map<string, string[]>();
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || !/^[A-Z]/i.test(line)) {
      continue; // comment, blank, or a bike/boat/plane sub-table line
    }
    const [id, ...fields] = line.split(/\s+/);
    table.set(id.toUpperCase(), fields);
  }

  return table;
}

const [first, second] = positionalArgs();
if (!first) {
  console.error('usage: npx tsx scripts/debug/handling-diff.ts [baseline.cfg] <candidate.cfg> [--rows]');
  process.exit(1);
}
const game = gameArg();
const built = join(ROOT, 'build', game, 'opensa', 'data', 'handling.cfg');
const baselinePath = second ? first : existsSync(built) ? built : gameDir(game, 'data', 'handling.cfg');
const candidatePath = second ?? first;
const baseline = parse(baselinePath);
const candidate = parse(candidatePath);
const shared = [...candidate.keys()].filter((id) => baseline.has(id));

console.log(`baseline  ${baselinePath} (${baseline.size} rows)`);
console.log(`candidate ${candidatePath} (${candidate.size} rows)`);
console.log(`shared    ${shared.length} cars\n`);

/** Per column: how many shared cars changed it, and the mean relative move where both sides are numeric. */
const changed = COLUMNS.map(() => 0);
const moved = COLUMNS.map(() => [] as number[]);
const edits = COLUMNS.map(() => [] as string[]);
for (const id of shared) {
  const before = baseline.get(id) ?? [];
  const after = candidate.get(id) ?? [];
  for (let i = 0; i < COLUMNS.length; i += 1) {
    if (before[i] === undefined || after[i] === undefined || before[i] === after[i]) {
      continue;
    }
    const a = Number(before[i]);
    const b = Number(after[i]);
    if (Number.isFinite(a) && Number.isFinite(b) && a === b) {
      continue; // "4" vs "4.0" is not an edit
    }
    changed[i] += 1;
    edits[i].push(`${id}: ${before[i]} → ${after[i]}`);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) {
      moved[i].push(Math.abs((b - a) / a));
    }
  }
}

const order = COLUMNS.map((_, i) => i).sort((a, b) => changed[b] - changed[a]);
console.log(`${'column'.padEnd(20)} ${'cars changed'.padStart(13)} ${'mean move'.padStart(10)}   engine`);
for (const i of order) {
  if (changed[i] === 0) {
    continue;
  }
  const mean =
    moved[i].length > 0 ? `${((moved[i].reduce((s, v) => s + v, 0) / moved[i].length) * 100).toFixed(0)} %` : '—';
  const share = ((changed[i] / shared.length) * 100).toFixed(0);
  console.log(
    `${COLUMNS[i].padEnd(20)} ${`${changed[i]} (${share} %)`.padStart(13)} ${mean.padStart(10)}   ${READ.has(i) ? 'READS' : 'ignores'}`,
  );
}

const totalEdits = changed.reduce((sum, count) => sum + count, 0);
const readEdits = changed.reduce((sum, count, i) => sum + (READ.has(i) ? count : 0), 0);
console.log(
  `\n${totalEdits} column edits across ${shared.length} shared cars — ` +
    `${readEdits} (${((readEdits / totalEdits) * 100).toFixed(0)} %) land in a column the engine reads, ` +
    `${totalEdits - readEdits} (${(((totalEdits - readEdits) / totalEdits) * 100).toFixed(0)} %) are dropped.`,
);

if (process.argv.includes('--rows')) {
  for (const i of order.slice(0, 8)) {
    console.log(`\n${COLUMNS[i]} (${READ.has(i) ? 'READS' : 'ignores'}):`);
    for (const edit of edits[i].slice(0, 12)) {
      console.log(`  ${edit}`);
    }
    if (edits[i].length > 12) {
      console.log(`  … ${edits[i].length - 12} more`);
    }
  }
}
