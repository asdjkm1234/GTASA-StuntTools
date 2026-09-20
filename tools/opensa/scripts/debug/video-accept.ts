/**
 * Video mode's acceptance exam, rolled up off a harness log — the numbers every 096 phase re-sits.
 *
 * Reads the `[video] {json}` scene reports (and counts the `[cam] jump` lines beside them) and prints, per
 * log and in total: directed frames, the share of them the car sat inside the safe frame, cuts and what ended
 * them, how often the pan cap bit, how the scenes ended, and the sequencer's own ledger — regions visited in
 * order, the realised mod-car share, and any scene whose weather target moved mid-shot (D15's leak).
 *
 * **Three scene kinds report differently (096/07)**, and the exam reads all three. A `drive` and a `walk`
 * carry the director's ledger (`shots`); a `fly` has no director at all — no subject, so no safe frame, no
 * pan cap — and carries its passes and its clearance instead. A missing `kind` is a pre-07 capture and is a
 * drive. The counters below are therefore SPLIT: a fly scene contributes no directed frames, and averaging it
 * into the safe-frame share would quietly dilute the one number 03's acceptance rests on.
 *
 * **Two more questions since 096/08**, both read off fields the capture only started carrying then: what the
 * module's own per-frame work COST (`stepMs`, the benchmark number — see `docs/benchmarks/`), and whether the
 * seeded stream ever deals two NEIGHBOURING scenes the same car, hour and weather, which is the variety
 * audit. Older logs simply report neither.
 *
 * Usage: npx tsx scripts/debug/video-accept.ts <harness.log>…
 */
import { readFileSync } from 'node:fs';

/** The half of a `[video]` scene report this exam reads (the capture carries much more). */
interface SceneReport {
  /** The car this scene staged — absent before 096/05. */
  car?: string;
  /** A fly scene has no end condition to report — it plays its five passes out. */
  ended?: string;
  /** The live altitude guard (fly only): probes fired, and how many found something to climb over. */
  guard?: { hits: number; probes: number };
  /** The staged hour slot — absent before 096/08. */
  hour?: number;
  /** Absent in captures taken before 096/07 — those runs were all drives. */
  kind?: 'drive' | 'fly' | 'walk';
  /** Absent in captures taken before 096/05 — those runs had one hardcoded car. */
  modCar?: boolean;
  /** Fly only: what was planned, what flew, and what each pass had to be lifted by. */
  passes?: { casts: number; lifts: number[]; list: string[]; planned: number; rejected: number };
  region: string;
  scene: number;
  /** The director's ledger — `drive` and `walk` only. A flight has no subject to frame. */
  shots?: {
    causes: Record<string, number>;
    cuts: number;
    judged: number;
    panClips: number;
    /** The SHARE of judged frames inside the safe frame, not a count — weight it before summing logs. */
    safe: number;
  };
  /** The module's per-frame cost inside the host loop — absent before 096/08. */
  stepMs?: { frames: number; maxMs: number; meanMs: number; p95Ms: number };
  /** The staged weather name, null for a scene that left it alone — absent before 096/08. */
  weather?: null | string;
}

interface Totals {
  causes: Record<string, number>;
  clips: number;
  cuts: number;
  ends: Record<string, number>;
  /** Fly only: passes flown / planned, the metres of staging lift, and live guard hits over probes. */
  fly: { flown: number; guardHits: number; guardProbes: number; lift: number; planned: number };
  judged: number;
  jumps: number;
  /** Scenes by kind — the acceptance question "did the cycle play all three" is answered off this. */
  kinds: Record<string, number>;
  modCars: number;
  regions: string[];
  safe: number;
  scenes: number;
  /** One row per scene, in play order, for the variety audit. */
  staged: { car: string; hour: number; scene: number; weather: string }[];
  /** Per-frame cost, weighted by the frames each scene contributed. */
  step: { frames: number; maxMs: number; p95Worst: number; weightedMean: number };
}

/** Stand-in car for the scene kinds that have none (fly, walk) — they must not count as a repeat. */
const NO_CAR = '—';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  throw new Error('usage: video-accept.ts <harness.log>…');
}

/** Fold one scene report into the running totals — split by KIND, because the kinds do not report alike. */
function accumulate(scene: SceneReport, into: Totals): void {
  const kind = scene.kind ?? 'drive';
  into.scenes += 1;
  into.kinds[kind] = (into.kinds[kind] ?? 0) + 1;
  into.modCars += scene.modCar ? 1 : 0;
  into.regions.push(`${scene.region}${kind === 'drive' ? '' : `(${kind})`}`);
  if (scene.ended) {
    into.ends[scene.ended] = (into.ends[scene.ended] ?? 0) + 1;
  }
  // The director's half — absent on a flight, and NOT defaulted to zero-safe: a scene with no subject has
  // no opinion about framing, and folding it in as 0 % would read as a failure that never happened.
  if (scene.shots) {
    into.judged += scene.shots.judged;
    into.safe += scene.shots.judged * scene.shots.safe;
    into.cuts += scene.shots.cuts;
    into.clips += scene.shots.panClips;
    for (const [cause, count] of Object.entries(scene.shots.causes)) {
      into.causes[cause] = (into.causes[cause] ?? 0) + count;
    }
  }
  if (scene.passes) {
    into.fly.planned += scene.passes.planned;
    into.fly.flown += scene.passes.planned - scene.passes.rejected;
    into.fly.lift += scene.passes.lifts.reduce((sum, metres) => sum + metres, 0);
  }
  if (scene.guard) {
    into.fly.guardHits += scene.guard.hits;
    into.fly.guardProbes += scene.guard.probes;
  }
  if (scene.stepMs) {
    into.step.frames += scene.stepMs.frames;
    into.step.weightedMean += scene.stepMs.frames * scene.stepMs.meanMs;
    into.step.p95Worst = Math.max(into.step.p95Worst, scene.stepMs.p95Ms);
    into.step.maxMs = Math.max(into.step.maxMs, scene.stepMs.maxMs);
  }
  if (scene.hour !== undefined) {
    into.staged.push({
      car: scene.car ?? NO_CAR,
      hour: scene.hour,
      scene: scene.scene,
      weather: scene.weather ?? 'unchanged',
    });
  }
}

function blank(): Totals {
  return {
    causes: {},
    clips: 0,
    cuts: 0,
    ends: {},
    fly: { flown: 0, guardHits: 0, guardProbes: 0, lift: 0, planned: 0 },
    judged: 0,
    jumps: 0,
    kinds: {},
    modCars: 0,
    regions: [],
    safe: 0,
    scenes: 0,
    staged: [],
    step: { frames: 0, maxMs: 0, p95Worst: 0, weightedMean: 0 },
  };
}

/** One log's scenes, deduped: the harness echoes every report line twice (live, then the end-of-run dump). */
function readLog(path: string, into: Totals): void {
  const seen = new Set<number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.includes('[cam] jump')) {
      into.jumps += 1;
    }
    const at = line.indexOf('[video] {');
    if (at < 0) {
      continue;
    }
    const scene = JSON.parse(line.slice(at + '[video] '.length)) as SceneReport;
    if (seen.has(scene.scene)) {
      continue;
    }
    seen.add(scene.scene);
    accumulate(scene, into);
  }
}

function report(label: string, totals: Totals): void {
  const share = (part: number): string => `${((100 * part) / Math.max(1, totals.judged)).toFixed(2)}%`;
  const kinds = Object.entries(totals.kinds)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(', ');
  console.log(
    `${label}: ${totals.scenes} scenes (${kinds}) · ${totals.judged} directed frames · safe ${share(totals.safe)} · ` +
      `${totals.cuts} cuts · pan clipped ${share(totals.clips)} · ${totals.jumps} [cam] jump lines · ` +
      `mod cars ${totals.scenes === 0 ? 0 : ((100 * totals.modCars) / totals.scenes).toFixed(0)}%`,
  );
  if (totals.step.frames > 0) {
    // Note when reading this: `performance.now()` is coarsened (0.1 ms in headless Chrome), so a single
    // frame's reading is 0 or 0.1 and only the MEAN over thousands of frames is a measurement.
    console.log(
      `  step cost: mean ${(totals.step.weightedMean / totals.step.frames).toFixed(4)} ms over ` +
        `${totals.step.frames} frames · worst scene p95 ${totals.step.p95Worst} ms · max ${totals.step.maxMs} ms`,
    );
  }
  if (totals.fly.planned > 0) {
    // The flight's own acceptance (096/07 B): every pass flown, nothing lifted at staging, and a live guard
    // that never had to intervene. A non-zero `guard hits` means the staging clearance was wrong about something.
    console.log(
      `  flights: ${totals.fly.flown}/${totals.fly.planned} passes flown · ${totals.fly.lift} m staging lift · ` +
        `guard ${totals.fly.guardHits} hits / ${totals.fly.guardProbes} probes`,
    );
  }
}

const all = blank();
for (const path of paths) {
  const one = blank();
  readLog(path, one);
  readLog(path, all);
  report(path.split('/').pop() ?? path, one);
  // The cycle in the order it played: the acceptance question "did it visit every region, in order" is one a
  // log can answer, which is why the drive spine's order is fixed and the other kinds' regions are not.
  console.log(`  regions ${one.regions.join(' → ')}`);
}

if (paths.length > 1) {
  console.log('');
  report('TOTAL', all);
}
console.log(`cut causes ${JSON.stringify(all.causes)}\nscene ends ${JSON.stringify(all.ends)}`);
variety(all);

/**
 * The variety audit (096/08 task A2): does the seeded stream ever put two NEIGHBOURING scenes in the same car,
 * hour AND weather? All three matching is the case that reads as a repeat on screen; any two is coincidence.
 * Reported rather than asserted — the fix (reroll once) is only worth adding if the rate says so.
 */
function variety(totals: Totals): void {
  const rows = [...totals.staged].sort((a, b) => a.scene - b.scene);
  if (rows.length < 2) {
    return;
  }
  const repeats: string[] = [];
  let sameCar = 0;
  let sameHour = 0;
  let sameWeather = 0;
  let carPairs = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    sameHour += previous.hour === current.hour ? 1 : 0;
    sameWeather += previous.weather === current.weather ? 1 : 0;
    // A fly or a walk scene has no car, and counting two of them in a row as "the same car" would report a
    // repeat the viewer cannot see — and would let a pair of them satisfy ALL THREE by having no car at all.
    if (previous.car === NO_CAR || current.car === NO_CAR) {
      continue;
    }
    carPairs += 1;
    sameCar += previous.car === current.car ? 1 : 0;
    if (previous.car === current.car && previous.hour === current.hour && previous.weather === current.weather) {
      repeats.push(`${previous.scene}→${current.scene} (${current.car} ${current.hour}h ${current.weather})`);
    }
  }
  const cars = new Set(rows.map((row) => row.car).filter((car) => car !== NO_CAR));
  console.log(
    `variety over ${rows.length} staged scenes: hour repeats ${sameHour}/${rows.length - 1} pairs, ` +
      `weather ${sameWeather}/${rows.length - 1} · car ${sameCar}/${carPairs} car-carrying pairs · ` +
      `ALL THREE ${repeats.length}${repeats.length > 0 ? ` — ${repeats.join(', ')}` : ''} · ` +
      `distinct cars ${cars.size}`,
  );
}
