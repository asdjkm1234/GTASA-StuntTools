/**
 * The station supply (plan 096/04): the live half of the tripod survey — it watches the shot list for the
 * next tripod slot, surveys candidates against the REAL world a few casts at a time while the preceding shot
 * plays, and hands the director an eye the moment that shot cuts.
 *
 * Split from `stations.ts` on purpose: that file is pure (candidates, prediction, scoring against a probe
 * interface) and this one owns the wiring — when to start, what the budget is, and the two space conversions.
 * The director never sees GTA coordinates and never sees a cast.
 */
import type { Random } from '@opensa/game/paths/rng';
import type { Route } from '@opensa/game/paths/route-builder';

import type { StationSource } from './director';
import type { StationProbes, StationSurvey, SurveyOptions } from './stations';

import { gtaFromEngine } from '../camera/camera-collision';
import {
  createSurvey,
  predictAlong,
  SPEED_SCALE_MAX,
  SPEED_SCALE_MIN,
  stationCandidates,
  stepSurvey,
  windowSamples,
} from './stations';

export interface StationSupply extends StationSource {
  /** Start a new frame's budget. */
  beginFrame(): void;
  /** Casts spent since the last {@link StationSupply.beginFrame} — the budget check, per frame. */
  frameCasts(): number;
  /** What the scene's report says about the survey (096/04's ledger). */
  ledger(): StationLedger;
  /** Spend this frame's survey budget. Returns the casts used. */
  step(): number;
}

export interface StationSupplyDeps {
  /** The car's GTA position right now — the prediction error is measured against it. */
  carGta(): readonly [number, number, number];
  /** The car's planar speed right now (m/s) — how well it is keeping the route's target speeds is what
   *  makes the prediction honest over an eight-second horizon. */
  carSpeed(): number;
  /** How far along the route the car is, as a fractional point index. */
  cursor(): number;
  /** The car's rigid body, excluded from the sightline (the ray ends INSIDE the car it is aimed at). */
  excludeBody(): number | undefined;
  /** Offsets from the driven line a tripod may stand at (m). Absent → the driving set; the walk scene
   *  (096/07) passes its own, because 8-18 m of pavement is a different shot on a person. */
  laterals?: readonly number[];
  probes: StationProbes;
  /** The scene's seeded stream — candidate order and heights are part of what `?seed=` reproduces (D9). */
  random: Random;
  route: Route;
  /** The thresholds a candidate is judged on. Absent → {@link SURVEY_DEFAULTS}. */
  survey?: SurveyOptions;
  /** GTA Z-up → engine Y-up, the host's own conversion. */
  toEngine(gta: readonly [number, number, number]): [number, number, number];
  /** The next tripod slot in the shot list, or null when none is coming. */
  upcoming(): null | { index: number; seconds: number; startsIn: number };
}

interface StationLedger {
  /** Casts spent on surveys and sightlines together. */
  casts: number;
  /** Worst single frame's cast count — what the ≤ 3/frame budget is judged on. */
  castsMax: number;
  empty: number;
  /** Surveys that produced a station, and surveys that produced nothing. */
  filled: number;
  /** Frames from a survey's first cast to its verdict — the amortisation's own cost. */
  latencyMax: number;
  /** How far the prediction was off when a station was actually taken (m) — the survey's own error bar. */
  predictionErrorMax: number;
  rejected: { dwell: number; ground: number; sight: number };
}

/** How early a survey starts before the tripod shot it is for (s).
 *
 * Short on purpose: the prediction decays with the horizon, and the survey itself is fast — an open street
 * settles in 2-4 frames, and even ten candidates at six casts apiece fit in a third of a second at three
 * casts a frame. Every second of extra lead buys nothing and costs accuracy. */
const SURVEY_LEAD_SECONDS = 4;
/** The module's whole per-frame cast budget (080's rig spends 2 of the 5 the game allows). */
const SURVEY_CASTS_PER_FRAME = 3;
/** The share of the route's target speed at which the car counts as up to speed — below it, its current
 *  speed says more about the launch than about the road ahead. */
const LAUNCH_READY = 0.8;
/** …and the point at which there is no more time to wait for that (s before the shot starts). */
const LAST_CALL_SECONDS = 1.5;

export function createStationSupply(deps: StationSupplyDeps): StationSupply {
  let survey: null | StationSurvey = null;
  /** The plan slot the running (or finished) survey belongs to — a slot is surveyed exactly once. */
  let surveyedSlot: null | number = null;
  let pending: null | { position: [number, number, number]; predictedStart: readonly [number, number, number] } = null;
  let frameCasts = 0;
  let latency = 0;
  const ledger: StationLedger = {
    casts: 0,
    castsMax: 0,
    empty: 0,
    filled: 0,
    latencyMax: 0,
    predictionErrorMax: 0,
    rejected: { dwell: 0, ground: 0, sight: 0 },
  };

  const spend = (casts: number): void => {
    frameCasts += casts;
    ledger.casts += casts;
    ledger.castsMax = Math.max(ledger.castsMax, frameCasts);
  };

  return {
    beginFrame: (): void => {
      frameCasts = 0;
    },
    frameCasts: (): number => frameCasts,
    ledger: (): StationLedger => ledger,
    sightline: (eye, subject): boolean => {
      spend(1);

      return deps.probes.pathClear(gtaFromEngine(eye), gtaFromEngine(subject), deps.excludeBody());
    },
    step: (): number => {
      const slot = deps.upcoming();
      if (survey === null) {
        // Nothing to do until a tripod slot is close enough to predict for — and each slot is surveyed once,
        // whatever its verdict was, so a scene cannot spin on a spot with no station in it.
        if (slot && !readyToPredict(deps, slot.startsIn)) {
          return 0;
        }
        if (!slot || slot.startsIn > SURVEY_LEAD_SECONDS) {
          // A slot that has come round again on a later lap of the list is a NEW slot: re-arm, or a long
          // scene would play every tripod after the first as a fallback.
          if (slot && surveyedSlot === slot.index && slot.startsIn > SURVEY_LEAD_SECONDS) {
            surveyedSlot = null;
          }

          return 0;
        }
        if (surveyedSlot === slot.index) {
          return 0;
        }
        const points = deps.route.points;
        const cursor = deps.cursor();
        const scale = speedScale(points, cursor, deps.carSpeed());
        const midpoint = slot.startsIn + slot.seconds / 2;
        const samples = windowSamples(points, cursor, slot.startsIn, slot.seconds, scale);
        const { index: at } = predictAlong(points, cursor, midpoint, scale);
        survey = createSurvey(stationCandidates(points, at, deps.random, deps.laterals), samples, deps.survey);
        surveyedSlot = slot.index;
        latency = 0;
      }
      latency += 1;
      // What is LEFT of the frame's budget, not the whole of it. A planted shot's occlusion check (096/09)
      // spends from the same allowance on the frame it starts, and the survey is the thing that can always
      // wait one more frame — so it yields, and the module's per-frame ceiling stays a real ceiling.
      const casts = stepSurvey(survey, deps.probes, Math.max(0, SURVEY_CASTS_PER_FRAME - frameCasts));
      spend(casts);
      const done = survey.station !== null || survey.at >= survey.candidates.length;
      if (!done) {
        return casts;
      }
      ledger.latencyMax = Math.max(ledger.latencyMax, latency);
      ledger.rejected.dwell += survey.rejected.dwell;
      ledger.rejected.ground += survey.rejected.ground;
      ledger.rejected.sight += survey.rejected.sight;
      if (survey.station) {
        ledger.filled += 1;
        pending = { position: survey.station.position, predictedStart: survey.samples[0] };
      } else {
        ledger.empty += 1;
      }
      survey = null;

      return casts;
    },
    take: (): [number, number, number] | null => {
      if (!pending) {
        return null;
      }
      const car = deps.carGta();
      const error = Math.hypot(car[0] - pending.predictedStart[0], car[1] - pending.predictedStart[1]);
      ledger.predictionErrorMax = Math.max(ledger.predictionErrorMax, error);
      const eye = deps.toEngine(pending.position);
      pending = null;

      return eye;
    },
  };
}

/**
 * Whether the car's speed is worth predicting FROM yet.
 *
 * A car still pulling away is the one case where its own speed misleads: three of 096/04's stations were
 * surveyed during a launch and landed ~13 m off, because 5 m/s at that moment meant "accelerating", not
 * "this is the pace". Waiting costs nothing — the survey needs a quarter of a second — and the wait ends
 * either when the car is up to speed or when the shot is about to start, whichever comes first.
 */
function readyToPredict(deps: StationSupplyDeps, startsIn: number): boolean {
  if (startsIn <= LAST_CALL_SECONDS) {
    return true;
  }
  const points = deps.route.points;
  const target = points[Math.min(points.length - 1, Math.max(0, Math.floor(deps.cursor())))]?.speed ?? 0;

  return target <= 0.5 || Math.abs(deps.carSpeed()) >= target * LAUNCH_READY;
}

/** How well the car is keeping the route's target speed right here, bounded. */
function speedScale(points: readonly { speed: number }[], cursor: number, carSpeed: number): number {
  const target = points[Math.min(points.length - 1, Math.max(0, Math.floor(cursor)))]?.speed ?? 0;
  if (target <= 0.5) {
    return 1;
  }

  return Math.min(SPEED_SCALE_MAX, Math.max(SPEED_SCALE_MIN, Math.abs(carSpeed) / target));
}
