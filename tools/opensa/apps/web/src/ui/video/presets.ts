/**
 * The sequencer's tables (plan 096/05): what a cycle plays, where, in what light, and in which car.
 *
 * Everything here is DATA and pure functions over it — no engine, no host, no clock. That is what lets the
 * whole of D2/D3/D6/D7/D10 be pinned by unit tests, and what keeps `engine-video-runs.ts` about staging.
 *
 * The one rule these tables obey: a pool is DERIVED from what the game ships, never hand-listed. The weather
 * sets are filtered out of the parsed timecyc names by their region suffix, so a modded timecyc that renames
 * or adds a row is followed rather than contradicted (the derive-from-the-asset rule in CLAUDE.md).
 */

import type { City } from '@opensa/game/zones/city';

import { mulberry32, type Random } from '@opensa/game/paths/rng';

/** One entry of the program: what kind of scene, and the region it plays in. */
export interface ProgramEntry {
  readonly kind: SceneKind;
  readonly region: City;
}

/** The scene kinds D3 names. Only `drive` exists until 07 lands; the sequencer skips the rest with a notice. */
type SceneKind = 'drive' | 'fly' | 'walk';

/**
 * The region cycle (D2), in the user's order: Los Santos → Las Venturas → San Fierro → Country → Desert.
 *
 * The tokens are the game's own — `City` is what the zone data classifies a point into, and the timecyc
 * weather names carry the same suffix — so one token indexes the route filter AND the weather pool.
 */
export const REGION_CYCLE: readonly City[] = ['LA', 'VEGAS', 'SF', 'COUNTRYSIDE', 'DESERT'];

/** The debugger's own preset hours (D6) — a showcase run stands in the light the game was authored for. */
export const HOUR_SLOTS: readonly number[] = [0, 6, 12, 18, 21];

/** Scenes of each kind per cycle (D3): a drive in every region, then two flythroughs, then one walk. */
const FLY_SCENES = 2;
const WALK_SCENES = 1;

/**
 * How many scenes a run plays before it stops (D2, revised 2026-07-31 — the cycle was endless in v1).
 *
 * A run is a SEQUENCE with a name: `?seed=47` is scenes 1 to {@link SCENE_LIMIT} of seed 47, and it ends. The
 * ceiling is the ceiling, not just the default — a longer sequence is a future decision, not a URL a field
 * round can talk itself into.
 */
export const SCENE_LIMIT = 100;

/**
 * Scenes in one cycle — the length {@link buildProgram} always returns.
 *
 * It is a constant rather than a measurement of the returned array because the runner needs it BEFORE it can
 * build anything: a run that starts at `?scene=58` has to know which lap that scene belongs to in order to
 * build that lap's program, and a program built from the wrong lap would hand scene 58 a different region.
 */
export const PROGRAM_LENGTH = REGION_CYCLE.length + FLY_SCENES + WALK_SCENES;

/**
 * The scenes of one cycle: a drive in every region in {@link REGION_CYCLE} order, then the flythroughs and
 * the walk, each in a seeded region.
 *
 * The drives are the spine and their order is fixed, because "did it visit every region, in order" is an
 * acceptance question a log can answer. Where the other kinds play is variety, so it comes from the seeded
 * stream — a cycle is still reproducible, it is just not the same cycle every time.
 */
export function buildProgram(random: Random): ProgramEntry[] {
  const program: ProgramEntry[] = REGION_CYCLE.map((region) => ({ kind: 'drive', region }));
  for (let scene = 0; scene < FLY_SCENES + WALK_SCENES; scene += 1) {
    program.push({
      kind: scene < FLY_SCENES ? 'fly' : 'walk',
      region: REGION_CYCLE[Math.min(REGION_CYCLE.length - 1, Math.floor(random() * REGION_CYCLE.length))],
    });
  }

  return program;
}

/**
 * How many scenes `?scenes=` asks for, clamped into `1 … SCENE_LIMIT`.
 *
 * Anything unreadable takes the full run rather than refusing to start: a showcase run is something a user
 * points a screen recorder at, and a typo in a URL must cost the typo, not the session.
 */
export function parseSceneLimit(value: null | string): number {
  // `?scenes=` with nothing after it is `''`, and `Number('')` is 0 — a bare flag would otherwise ask for a
  // one-scene run, which is the opposite of what someone typing it means.
  const asked = Number(value?.trim());
  if (value === null || value.trim() === '' || !Number.isFinite(asked)) {
    return SCENE_LIMIT;
  }

  return Math.min(SCENE_LIMIT, Math.max(1, Math.floor(asked)));
}

/**
 * Which scene of the sequence `?scene=` starts at, clamped into `1 … SCENE_LIMIT`. Absent → the first.
 *
 * A run of 100 scenes is over an hour long, so the scene a field note names has to be reachable without
 * playing everything before it: `?seed=47&scene=57&scenes=1` is exactly scene 57 of seed 47, and it is the
 * SAME scene it would have been in the full run — the identity is `(seed, index)` and neither depends on
 * where the run began. Unreadable input starts at the beginning, for `parseSceneLimit`'s reason.
 */
export function parseSceneStart(value: null | string): number {
  const asked = Number(value?.trim());
  if (value === null || value.trim() === '' || !Number.isFinite(asked)) {
    return 1;
  }

  return Math.min(SCENE_LIMIT, Math.max(1, Math.floor(asked)));
}

/**
 * The car a scene drives: a mod car whenever the ledger offers ANY, else any road car the game ships. Null
 * when there is nothing to drive at all.
 *
 * D10 as revised 2026-08-03 — mod cars ONLY, not merely first. A build that installed vehicle mods is a build
 * whose owner wants to see them: one stock car in five was read in the field as the mods not being picked up
 * at all. The ledger is the switch, and it is all-or-nothing — there is no share to tune and no stock
 * fallback while a single mod slot is present.
 *
 * `candidates` is already the filtered roster (road cars whose model is actually present — a slot with no
 * `.osm` throws at spawn), which is why an intersection that comes back EMPTY still falls through to stock: a
 * ledger naming only slots this build has no model for offers nothing drivable. `modCars` is 096/06's ledger;
 * an absent ledger is an empty set and every scene takes a stock car.
 *
 * Exactly ONE roll is taken either way, so the seeded stream advances identically whether or not this game
 * has a ledger — a seed's scene list must not depend on which mods are installed.
 */
export function pickCar(random: Random, candidates: readonly string[], modCars: ReadonlySet<string>): null | string {
  if (candidates.length === 0) {
    return null;
  }
  const mods = candidates.filter((model) => modCars.has(model));
  const pool = mods.length > 0 ? mods : candidates;

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * The program entry scene `scene` of `seed` plays — the sequencer's whole lookup.
 *
 * A PURE function of `(seed, scene)`, which is what makes a run startable in the middle (`?scene=N`): the
 * entry cannot depend on where the run began because nothing about where it began is an argument. The lap's
 * program is keyed on that lap's FIRST scene (`scene - at`), never on this one — keyed on this one, scene 58
 * would build a program off its own seed and land the flythroughs and the walk in regions the full run did
 * not put them in (the drive spine is a fixed order of fixed regions, so it is only ever those three).
 *
 * Rebuilding the lap per scene rather than caching it across eight is deliberate: a program is eight entries
 * and a handful of `random()` calls, once per 40-second scene, and the cached version was a variable whose
 * correctness depended on the loop that owned it.
 */
export function sceneProgramEntry(seed: number, scene: number): ProgramEntry {
  const at = (scene - 1) % PROGRAM_LENGTH;

  return buildProgram(mulberry32(sceneSeed(seed, -(scene - at))))[at];
}

/**
 * The seed for scene `index` of a run, from the run's master seed.
 *
 * Per-scene rather than one stream through the whole run, so scene 7 is the same scene whether the run
 * reached it after six others or was resumed at it — which is what makes a field report about ONE scene
 * something the next run can reproduce. The mix is the golden-ratio odd constant, the usual choice for
 * spreading consecutive integers across the 32-bit space.
 */
export function sceneSeed(master: number, index: number): number {
  return (Math.imul(index + 1, 0x9e3779b9) ^ (master >>> 0)) >>> 0;
}

/**
 * The same URL with `seed` and `scene` naming the scene now playing — what the runner writes into the address
 * bar as the sequence advances.
 *
 * A live run has NOWHERE else to say where it is: D12 keeps every piece of chrome out of the frame, and the
 * console line scrolls past. The address bar is outside the recording, so it can carry the answer for free.
 *
 * `seed` is written alongside because a run that was not given one derives it from the clock — a URL naming
 * only the scene would name a DIFFERENT scene on reload, which is worse than naming none. With both, the bar
 * is a resumable pointer at every instant: copy it, and `(seed, scene)` reproduces exactly this scene.
 *
 * `scenes` is a COUNT, not an end, so it is rewritten to keep the run ending where it was going to end — and
 * only when it was already there, since its absence already means "to the ceiling". Returned relative
 * (`pathname + search + hash`), which is what `replaceState` wants and what keeps the origin out of it.
 */
export function sceneUrl(current: string, seed: number, scene: number, last: number): string {
  const url = new URL(current);
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('scene', String(scene));
  if (url.searchParams.has('scenes')) {
    url.searchParams.set('scenes', String(Math.max(1, last - scene + 1)));
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The weather rows a region authors, as indices into `weatherNames` (D7 — an LS scene gets LA weathers).
 *
 * SA authors every type per region (`CLOUDY_LA`, `RAINY_SF`, …) and the suffix IS the region token, so this
 * is a filter rather than a table. Empty when the game authors none for that region: the caller then leaves
 * the weather alone rather than inventing one.
 */
export function weatherPool(weatherNames: readonly string[], region: City): number[] {
  const suffix = `_${region}`;
  const pool: number[] = [];
  weatherNames.forEach((name, index) => {
    if (name.endsWith(suffix)) {
      pool.push(index);
    }
  });

  return pool;
}
