/**
 * The physics regression pack (plan 081/07 §2) — the driving twin of the perf ritual's gate.
 *
 *   npx tsx scripts/phys-regression.ts <fresh capture log|json> [...more]
 *
 * The reference is the committed matrix of the ACCEPTED feel: every
 * `docs/benchmarks/vehicle-physics/<PACK_PREFIX>-<car>.json`. A fresh sweep of the same cars and scenes is
 * compared lap by lap; a signal outside its band, a lap that went missing, a car nobody swept, and a lap
 * that stopped doing something the pack recorded (braking, reaching 100, flipping) are all failures. The bands are NOT a determinism check — a repeat sweep proved
 * nine of the eleven scenes replay to the second decimal — they are the width of "the feel did not move",
 * widened only on the laps that leave the road, by the spread that repeat measured. See
 * `docs/benchmarks/vehicle-physics/readme.md` for how the pack was recorded and
 * `docs/development/physics-laps.md` for how to produce the fresh sweep.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Capture } from './lib/phys-captures';

import { captureId, loadCaptureMap, loadCaptures } from './lib/phys-captures';

/** Where the reference matrix lives, and the name it goes by (`<prefix>-<car>.json`). */
const PACK_DIR = 'docs/benchmarks/vehicle-physics';
const PACK_PREFIX = '2026-07-27-headless-shipped';

/** A signal passes while `|Δ| ≤ max(abs, rel × |reference|)`. `rel` is 0 unless the signal is a magnitude
 *  whose meaningful move scales with the car (a 3 km/h band is tight on the firetruck, loose on the comet). */
interface Band {
  abs: number;
  rel?: number;
}

/**
 * Per-signal bands, in each field's own unit. **The measured noise floor is ~0.01** — a repeat sweep of the
 * same build reproduced every lap, collisions included, to the second decimal (2026-07-27, recorded in the
 * benchmarks readme). So none of these numbers is about repeatability: each is the width of a move a driver
 * would notice. `topSpeedKmh` 2 % catches a drag or power change while surviving a lap that ran a metre
 * short; the angle bands sit at a few degrees because that is where a roll or a slip stops looking the same.
 */
const BANDS: Record<string, Band> = {
  airborneS: { abs: 0.15 },
  'brake.distanceM': { abs: 1.5, rel: 0.03 },
  'brake.fromKmh': { abs: 2, rel: 0.02 },
  'brake.seconds': { abs: 0.2, rel: 0.03 },
  diveDeg: { abs: 0.5 },
  durationS: { abs: 0.1 },
  'flip.atKmh': { abs: 10 },
  'flip.atS': { abs: 1 },
  frames: { abs: 2 },
  'gLat.max': { abs: 0.15, rel: 0.1 },
  'gLat.min': { abs: 0.15, rel: 0.1 },
  'gLong.max': { abs: 0.15, rel: 0.1 },
  'gLong.min': { abs: 0.15, rel: 0.1 },
  'gVert.max': { abs: 0.3, rel: 0.15 },
  'gVert.min': { abs: 0.3, rel: 0.15 },
  'pitchDeg.max': { abs: 0.5 },
  'pitchDeg.min': { abs: 0.5 },
  pitchUnderBrakeDeg: { abs: 0.5 },
  'rollDeg.max': { abs: 2 },
  'rollDeg.min': { abs: 2 },
  slipMaxDeg: { abs: 3 },
  'step.slipSettledDeg': { abs: 1 },
  'step.speedAtStepKmh': { abs: 2, rel: 0.02 },
  'step.yawOvershoot': { abs: 0.2 },
  'step.yawRiseS': { abs: 0.15 },
  'step.yawSettledDegS': { abs: 3, rel: 0.1 },
  timeTo100S: { abs: 0.15, rel: 0.03 },
  topSpeedKmh: { abs: 2, rel: 0.02 },
  turnedDeg: { abs: 8, rel: 0.05 },
};

/** Anything not named above. Wide on purpose: a new summary field gates loosely until it earns a band. */
const DEFAULT_BAND: Band = { abs: 1, rel: 0.1 };

/** What the run was CONFIGURED with (`speedGrip` dials, the per-wheel springs) is not an outcome and gets no
 *  tolerance beyond float noise: a sweep driven with different dials is a different experiment, and it must
 *  say so instead of showing up as a fleet of moved outcomes. */
const CONFIG_BAND: Band = { abs: 0, rel: 0.001 };

/** The stance is MEASURED, not set — a settled pose, so it gets a real tolerance: 1 % of a wheel load, 2 mm
 *  of spring length. Wide enough to survive a settle that lands a step differently, tight enough that a
 *  changed standing-pose law breaches on every lap of every car. */
const STANCE_BAND: Band = { abs: 0.002, rel: 0.01 };

/**
 * The scenes whose lap LEAVES THE ROAD, with the widening and the measurement behind it. Nine of the eleven
 * scenes replayed to the second decimal in the 2026-07-27 repeat sweep; the two that did not — `u-turn` and
 * `crest-jump` — are the two where the infernus spends seconds airborne and comes down on streamed ground,
 * and what it lands on is not the same twice (see the benchmarks readme). The bands below are ~1.5× the
 * MEASURED spread of that repeat, not a guess; `slalom` and `kerb-strike` replayed but are the same shape of
 * lap and are widened on the same reasoning. The price is stated plainly: on these four scenes the pack sees
 * a large feel change, not a small one. What still gates everywhere is the categorical part — a flip that
 * appeared or vanished, and a lap that stopped braking or stopped reaching 100.
 */
const SCENE_BANDS: Record<string, Record<string, Band>> = {
  // A landing: the touchdown spike and the line it keeps depend on where the wheels meet the ground.
  // Repeat spread: gLat 24, slip 37, turned 21, gLong.max 0.94.
  'crest-jump': {
    'gLat.max': { abs: 35, rel: 0.5 },
    'gLat.min': { abs: 35, rel: 0.5 },
    'gLong.max': { abs: 1.5 },
    'gVert.max': { abs: 3, rel: 0.5 },
    'gVert.min': { abs: 3, rel: 0.5 },
    'rollDeg.max': { abs: 6 },
    'rollDeg.min': { abs: 6 },
    slipMaxDeg: { abs: 55 },
    turnedDeg: { abs: 32, rel: 0.3 },
  },
  // The kerb throws the car off line; where it comes down decides yaw, roll and the vertical spike.
  'kerb-strike': {
    'gVert.max': { abs: 2, rel: 0.5 },
    'gVert.min': { abs: 2, rel: 0.5 },
    'rollDeg.max': { abs: 10 },
    'rollDeg.min': { abs: 10 },
    slipMaxDeg: { abs: 10 },
    turnedDeg: { abs: 30, rel: 0.3 },
  },
  // Metronome steering into (at baseline) a car that goes over: post-flip yaw is a tumble, not a manoeuvre.
  slalom: {
    'rollDeg.max': { abs: 10 },
    'rollDeg.min': { abs: 10 },
    slipMaxDeg: { abs: 10 },
    turnedDeg: { abs: 45, rel: 0.4 },
  },
  // Full lock off the power: the tame cars arc, the sports cars leave the road and tumble. Repeat spread:
  // topSpeed 9 km/h, roll 14°, airborne 0.7 s, gVert 3.7, gLat 3.9, pitch 0.8.
  'u-turn': {
    airborneS: { abs: 1 },
    'gLat.max': { abs: 6, rel: 0.2 },
    'gLat.min': { abs: 6, rel: 0.2 },
    'gVert.max': { abs: 6, rel: 0.3 },
    'gVert.min': { abs: 6, rel: 0.3 },
    'pitchDeg.max': { abs: 2 },
    'pitchDeg.min': { abs: 2 },
    'rollDeg.max': { abs: 20 },
    'rollDeg.min': { abs: 20 },
    topSpeedKmh: { abs: 12, rel: 0.1 },
  },
};

export interface Breach {
  after: null | number;
  band: null | number;
  before: null | number;
  label: string;
}

/**
 * Every way this lap left its band. A signal the reference HAS and the candidate does not (the lap never
 * braked, never reached 100, no longer flips) is a breach in its own right, printed with a `null` side —
 * "the car stopped doing this" is the loudest kind of regression and must never diff as a zero. The
 * asymmetry is deliberate: a signal only the CANDIDATE has is a field the pack predates, not a change.
 */
export function breaches(reference: Capture, candidate: Capture): Breach[] {
  const before = new Map([...flatten(reference.summary), ...configOf(reference)]);
  const after = new Map([...flatten(candidate.summary), ...configOf(candidate)]);
  const found: Breach[] = [];
  for (const [label, value] of before) {
    const other = after.get(label);
    if (other === undefined) {
      found.push({ after: null, band: null, before: value, label });
      continue;
    }
    const band = configBand(label) ?? bandFor(candidate.key, label);
    const width = Math.max(band.abs, (band.rel ?? 0) * Math.abs(value));
    if (Math.abs(other - value) > width) {
      found.push({ after: other, band: width, before: value, label });
    }
  }
  // A signal the CANDIDATE has and the reference does not is NOT a breach: the pack simply predates it.
  // (The reverse — a signal the reference had and the lap stopped reporting — is caught above, and that one
  // matters: "the car stopped braking" is a regression.) Reporting a newly added field as a breach made
  // every lap fail the day the capture learned to name its surfaces, which is noise, not a finding: the
  // pack has no reference value to compare against until it is deliberately re-recorded.

  return found;
}

function bandFor(scene: string, label: string): Band {
  return SCENE_BANDS[scene]?.[label] ?? BANDS[label] ?? DEFAULT_BAND;
}

/** The band a `config.…` row is held to, or `undefined` when the row is an outcome and the scene bands rule. */
function configBand(label: string): Band | undefined {
  if (label.startsWith('config.stance.')) {
    return STANCE_BAND;
  }

  return label.startsWith('config.') ? CONFIG_BAND : undefined;
}

/**
 * The capture's own statement of what it was configured with and how the car stood, as `config.…` rows: the
 * speed-grip dials, the air-control dial, every wheel's spring, and — on `rest` ONLY — the stance. The stance belongs here because
 * no summary signal carries it: the `rest` lap reads zero on every channel whether the car sits at its SA
 * pose or 10 cm into its bump stops, so the standing-pose law (2026-07-27) would otherwise be ungated. It is
 * read on no other scene because it is sampled when the lap REPORTS — on a crest lap that is mid-landing,
 * and comparing two mid-air poses says nothing. A capture from before a field existed contributes no row.
 */
function configOf(capture: Capture): Map<string, number> {
  const rows = new Map<string, number>();
  for (const [dial, value] of Object.entries(capture.speedGrip ?? {})) {
    if (typeof value === 'number') {
      rows.set(`config.speedGrip.${dial}`, value);
    }
  }
  for (const [dial, value] of Object.entries(capture.airControl ?? {})) {
    if (typeof value === 'number') {
      rows.set(`config.airControl.${dial}`, value);
    }
  }
  (capture.springs ?? []).forEach((spring, wheel) => {
    for (const [field, value] of Object.entries(spring)) {
      if (typeof value === 'number') {
        rows.set(`config.springs[${wheel}].${field}`, value);
      }
    }
  });
  const stance = capture.key === 'rest' ? capture.stance : undefined;
  if (stance) {
    for (const field of ['mass', 'weightOnGround'] as const) {
      if (typeof stance[field] === 'number') {
        rows.set(`config.stance.${field}`, stance[field]);
      }
    }
    (stance.wheels ?? []).forEach((wheel, index) => {
      for (const [field, value] of Object.entries(wheel)) {
        if (typeof value === 'number') {
          rows.set(`config.stance.wheels[${index}].${field}`, value);
        }
      }
    });
  }

  return rows;
}

/** Flatten one summary field to `[label, value]` rows — plain numbers pass through, the nested groups
 *  (`brake`, `flip`, `step`, the ranges) expand one row per member. A null group contributes nothing. */
function flatten(summary: Record<string, unknown>): Map<string, number> {
  const rows = new Map<string, number>();
  for (const [field, value] of Object.entries(summary)) {
    if (typeof value === 'number') {
      rows.set(field, value);
    } else if (value !== null && typeof value === 'object') {
      for (const [member, inner] of Object.entries(value as Record<string, unknown>)) {
        if (typeof inner === 'number') {
          rows.set(`${field}.${member}`, inner);
        }
      }
    }
  }

  return rows;
}

function format(value: null | number): string {
  return value === null ? '—' : value.toFixed(2);
}

function main(): void {
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (paths.length === 0) {
    console.error('usage: npx tsx scripts/phys-regression.ts <fresh capture log|json> [...more]');
    process.exitCode = 2;

    return;
  }
  const packFiles = readdirSync(PACK_DIR)
    .filter((name) => name.startsWith(`${PACK_PREFIX}-`) && name.endsWith('.json'))
    .map((name) => join(PACK_DIR, name));
  if (packFiles.length === 0) {
    console.error(`no reference captures at ${PACK_DIR}/${PACK_PREFIX}-*.json`);
    process.exitCode = 2;

    return;
  }
  const reference = loadCaptureMap(packFiles);
  const candidate = new Map(
    paths.flatMap((path) => loadCaptures(path)).map((capture) => [captureId(capture), capture]),
  );
  console.log(`pack ${packFiles.length} files · ${reference.size} reference laps · ${candidate.size} fresh laps`);

  const swept = new Set([...candidate.values()].map((capture) => capture.car));
  const unswept = reportUnswept(reference, swept);
  let failed = 0;
  for (const [id, expected] of reference) {
    const actual = candidate.get(id);
    if (!actual) {
      if (swept.has(expected.car)) {
        console.log(`❌ ${id.padEnd(28)} MISSING — the car was swept but this lap never reported`);
        failed += 1;
      }
      continue;
    }
    failed += reportLap(id, expected, actual) ? 1 : 0;
  }
  const extra = [...candidate.keys()].filter((id) => !reference.has(id));
  if (extra.length > 0) {
    console.log(`\nnot in the pack (ignored): ${extra.join(', ')}`);
  }
  const checked = reference.size - unswept;
  if (failed > 0) {
    console.log(`\n❌ ${failed} of ${checked} checked laps out of band — investigate, or re-record the pack`);
  } else if (unswept > 0) {
    console.log(`\n⚠️  ${checked} laps in band, ${unswept} never swept — the pack is not answered until all are`);
  } else {
    console.log(`\n✅ the pack replays: ${checked} laps in band`);
  }
  process.exitCode = failed === 0 && unswept === 0 ? 0 : 1;
}

/** Print one lap's verdict, with every breach under it; `true` when the lap left its bands. */
function reportLap(id: string, expected: Capture, actual: Capture): boolean {
  const found = breaches(expected, actual);
  if (found.length === 0) {
    console.log(`✅ ${id}`);

    return false;
  }
  console.log(`❌ ${id}`);
  for (const breach of found) {
    const band = breach.band === null ? 'appeared/vanished' : `band ${breach.band.toFixed(2)}`;
    console.log(`     ${breach.label.padEnd(22)} ${format(breach.before)} → ${format(breach.after)}  (${band})`);
  }

  return true;
}

/** A car nobody swept is a COVERAGE hole, not 11 regressions: it is said once, and it still fails the run —
 *  a gate answered on a third of the fleet is not a gate. Returns the laps left unchecked. */
function reportUnswept(reference: Map<string, Capture>, swept: Set<string>): number {
  const laps = [...reference.values()];
  let unswept = 0;
  for (const car of new Set(laps.map((capture) => capture.car))) {
    if (!swept.has(car)) {
      const count = laps.filter((capture) => capture.car === car).length;
      console.log(`⚠️  ${car.padEnd(10)} not in this sweep — ${count} laps unchecked`);
      unswept += count;
    }
  }

  return unswept;
}

// Only when this file IS the command — the band logic above is imported by `phys-regression.test.ts`, and a
// `main()` that ran on import would set the test run's exit code to its own usage error.
if (process.argv[1]?.endsWith('phys-regression.ts')) {
  main();
}
