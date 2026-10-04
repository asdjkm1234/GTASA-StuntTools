/**
 * The shot scheduler (plan 096/03): which shot is on, when it cuts, and the pose it hands the host.
 *
 * The scene's whole shot list is drawn UP FRONT from the seeded stream (D9 — `?seed=` reproduces the shot
 * list, not just the route), so a field round can be replayed frame for frame. What happens per frame is
 * only: pose the current shot, damp toward it, cap the pan, and watch whether the car is still in frame.
 *
 * Two discontinuities exist by design, and both are DECLARED: the cut between shots, and the hand-over
 * between the director and the shipped follow rig (the `chase` shot). Everything else must be continuous by
 * construction, which is what keeps `watchCameraJump` a real tripwire instead of a muted one (constraint 8).
 *
 * The empty-frame guard is the 080 lesson applied ahead of time: a boolean over rays has no continuous
 * middle, so this one is a CLOCK, not a gate — the car has to be out of the safe frame for
 * {@link EMPTY_FRAME_SECONDS} before the cut fires, and a single frame behind a lamppost changes nothing.
 */
import type { Random } from '@opensa/game/paths/rng';

import { pickWeighted } from '@opensa/game/paths/rng';
import { smoothDamp, type SmoothDampRef } from '@opensa/math';

import type { VideoCamera } from '../camera/engine-camera';
import type { PosedShot, ShotName, ShotPreset, Subject, Vec3 } from './shots';

import {
  aimShot,
  anchorFor,
  isPlanted,
  plantedEyeCandidates,
  projectToScreen,
  shotEye,
  SHOTS,
  SHOTS_PER_SCENE,
  shotSeconds,
} from './shots';

/** What one stepped frame produced — the pose plus everything the scene's report has to state. */
export interface DirectorFrame {
  /** This frame is a DECLARED discontinuity: a cut between shots, or the frame authority changed hands. */
  cut: boolean;
  /** What ended the PREVIOUS shot, on a cut frame; null on every other frame. */
  cutCause: CutCause | null;
  /** The pan-rate cap bit this frame — a ledger counter, and the first thing to read if a pan looks lazy. */
  panClipped: boolean;
  /** The frame video mode owns, or null while `chase` leaves it to the shipped rig. */
  pose: null | VideoCamera;
  /** Where the car landed on screen (0..1 from left/top), or null while the rig owns the frame. */
  screen: null | { x: number; y: number };
  shot: ShotName;
}

export interface DirectorState {
  /** Shot changes so far. The scene's OPENING is not one of them — it is counted in `causes.opening`,
   *  because it changes the frame's owner rather than one shot for another. */
  /** Blocked candidate spots a `static` shot had to step over when planting (096/09). One per rejected
   *  candidate, so a run that never plants into anything reports 0 and a run that gives a shot up entirely
   *  is charged the whole ladder. It measures how often the world is in the way, not a failure. */
  blockedPlants: number;
  /** Set on the frame a cut fires, read back out by the step that reports it. */
  cause: CutCause | null;
  /** What ended each shot so far, counted by cause — the ledger's early-cut breakdown. */
  readonly causes: Record<CutCause, number>;
  cuts: number;
  /** True once the last shot of the list has ended: the scene is over, and the runner reads this. */
  done: boolean;
  /** Seconds into the current shot. */
  elapsed: number;
  eye: [number, number, number] | null;
  eyeVelocity: SmoothDampRef[];
  /** Station slots the survey could not fill, so the plan's own fallback preset played instead. */
  fallbacks: number;
  /** Frames the guard judged (placed shots only — `chase` framing is the rig's business, not the ledger's). */
  framesJudged: number;
  /** The pose has not been damped yet: the first frame of a shot SNAPS, which is what makes a cut a cut. */
  fresh: boolean;
  index: number;
  /** Consecutive sightline probes that came back blocked — two of them end a tripod shot. */
  misses: number;
  /** Seconds the car has been outside the safe frame — the guard's clock. */
  offFrame: number;
  panClips: number;
  /** Last frame's view direction — the pan-rate cap measures against it. */
  panDirection: [number, number, number] | null;
  /** The car is GONE rather than hidden (behind the eye or past the distance ceiling), as of the last judged
   *  frame — which of the two empty-frame clocks the next cut decision uses. */
  passed: boolean;
  readonly plan: readonly ShotPlan[];
  /** Frames the car was inside the safe frame — `safeFrames / framesJudged` is 03's acceptance number. */
  safeFrames: number;
  /** Seconds until the next sightline probe — the live occlusion check runs at {@link SIGHTLINE_SECONDS},
   *  never per frame: it is a discrete verdict, and a per-frame one would be a gate with no middle. */
  sightlineIn: number;
  /** A `static` or `station` shot's planted eye, held for the whole shot; null for every other kind. */
  staticEye: [number, number, number] | null;
  /** Where the car stood when the last pose was written. A car-mounted shot damps its MOUNT rather than its
   *  world position ({@link stepDirector}), and re-basing the damper needs the frame it was written in. */
  subject: [number, number, number] | null;
  /** The preset actually playing when it is NOT the planned one — a station slot the survey could not fill. */
  substitute: null | ShotPreset;
  target: [number, number, number] | null;
  targetVelocity: SmoothDampRef[];
}

/** One entry of a scene's shot list: which preset, and the seconds it was dealt. */
export interface ShotPlan {
  /** What plays instead when a `station` slot finds no surveyed station. Drawn at PLAN time, from the same
   *  seeded stream, so a scene that falls back is still the scene the seed describes. */
  readonly fallback?: PosedShot;
  readonly preset: ShotPreset;
  readonly seconds: number;
}

/** Where a tripod shot gets its eye, and how it asks whether it can still see the car (096/04). */
export interface StationSource {
  /** Whether the line from `eye` to the car is clear right now. Called at most once per
   *  {@link SIGHTLINE_SECONDS}, and only for a tripod. */
  sightline(eye: Vec3, subject: Vec3): boolean;
  /** The station surveyed for the next tripod shot (engine Y-up), or null when none passed. Taking it
   *  CONSUMES it — the survey starts again for the shot after. */
  take(): null | Vec3;
}

/** Why a shot ended — one word for the ledger, and the priority order the guard resolves in. */
/**
 * Why a shot ended. `scheduled` is a RIDING shot's own 10 s clip running out — the editorial length. A
 * PLANTED shot has no clip: what is supposed to end it is the car leaving its frame (`empty`) or the
 * sightline breaking (`occluded`), so its clock is a WATCHDOG and gets its own name.
 *
 * They were one cause until 096/08, and that hid the question D4 exists to answer. The soak could only bound
 * it: 30 planted shots, 20 of them ended by the guard, so up to 10 MIGHT have run their watchdog out — which
 * is the difference between a safety net and a length nobody chose.
 */
type CutCause = 'empty' | 'occluded' | 'opening' | 'scheduled' | 'watchdog';

/** How long the car may sit outside the safe frame before the shot is cut short (s, D4) — the patient clock,
 *  for a car that may simply be behind something. */
export const EMPTY_FRAME_SECONDS = 1.5;
/**
 * The same clock for a car that has definitively GONE — behind the eye, or past the shot's distance ceiling
 * (s).
 *
 * A planted shot is SUPPOSED to end here: it films the car arriving, passing and leaving, and what the user
 * asked for is that it ends when the car is out of view. Waiting the patient 1.5 s would put a second and a
 * half of empty road at the tail of every such shot — footage to trim by hand. Nothing an obstacle can do
 * puts the car behind the camera, so this verdict needs no patience, only enough to outlast a frame hitch.
 */
export const PASSED_SECONDS = 0.4;
/** The fastest the view direction may swing (rad/s ≈ 60°/s) — above it a drive-past reads as a whip, not a
 *  pan. The answer to a shot that keeps hitting this is the guard cut, never a higher cap (the plan's note). */
export const PAN_RATE_MAX = Math.PI / 3;
/** How far from centre the car may drift and still count as framed (0.45 = the outer tenth of the frame). */
export const SAFE_FRAME = 0.45;
/** How often a tripod asks whether it can still see the car (s), and how many blocked answers in a row end
 *  the shot. Hysteresis lives HERE — in the cadence and the debounce — never in a moving camera. */
export const SIGHTLINE_SECONDS = 1;
export const SIGHTLINE_MISSES = 2;

/** The frame a PLANTED eye is damped in: the world, which does not move. */
const ORIGIN: Vec3 = [0, 0, 0];

export function createDirector(plan: readonly ShotPlan[]): DirectorState {
  return {
    blockedPlants: 0,
    cause: 'opening',
    causes: { empty: 0, occluded: 0, opening: 1, scheduled: 0, watchdog: 0 },
    cuts: 0,
    done: false,
    elapsed: 0,
    eye: null,
    eyeVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
    fallbacks: 0,
    framesJudged: 0,
    fresh: true,
    index: 0,
    misses: 0,
    offFrame: 0,
    panClips: 0,
    panDirection: null,
    passed: false,
    plan,
    safeFrames: 0,
    sightlineIn: SIGHTLINE_SECONDS,
    staticEye: null,
    subject: null,
    substitute: null,
    target: null,
    targetVelocity: [{ velocity: 0 }, { velocity: 0 }, { velocity: 0 }],
  };
}

/**
 * The next TRIPOD slot in the shot list and how far off it is — what the survey needs to know to start
 * probing during the shot before it. Null when the plan holds none.
 *
 * A shot already RUNNING is skipped: a tripod takes its eye when its shot starts, and a survey for it would
 * arrive too late to be anything but a second answer to a settled question. One that has not started yet is
 * not skipped, which is what lets a scene OPENING on a tripod be surveyed behind the black overlay — the
 * first field run played four such slots as fallbacks purely for want of somewhere to do the casts.
 */
export function nextStationSlot(state: DirectorState): null | { index: number; seconds: number; startsIn: number } {
  const current = state.plan[state.index];
  if (state.fresh && current.preset.kind === 'station') {
    return { index: state.index, seconds: current.seconds, startsIn: 0 };
  }
  let startsIn = Math.max(0, current.seconds - state.elapsed);
  // Up to and INCLUDING a full lap: a list whose only tripod is the shot in play still has one coming, on the
  // next time round, and the survey has all of that lap to find it a stand.
  for (let step = 1; step <= state.plan.length; step += 1) {
    const at = (state.index + step) % state.plan.length;
    const entry = state.plan[at];
    if (entry.preset.kind === 'station') {
      return { index: at, seconds: entry.seconds, startsIn };
    }
    startsIn += entry.seconds;
  }

  return null;
}

/**
 * The scene's shot list: exactly {@link SHOTS_PER_SCENE} DISTINCT shots drawn from the seeded stream —
 * weighted picks, no preset twice in one scene, and `chase` guaranteed at least once, because a scene of
 * nothing but placed shots never shows the game as it is played.
 *
 * The list IS the scene (user, 2026-07-31): five cameras, and the scene lasts exactly as long as they do. A
 * duration is no longer drawn — it is a property of the KIND ({@link shotSeconds}), because the two kinds end
 * for different reasons. Nothing wraps: the fifth shot ending ends the scene.
 */
export function planShots(random: Random, presets: readonly ShotPreset[] = SHOTS): ShotPlan[] {
  const plan: ShotPlan[] = [];
  const used = new Set<ShotName>();
  for (let slot = 0; slot < SHOTS_PER_SCENE; slot += 1) {
    // FIVE CAMERAS, not five shots: a preset already in this scene is out of the draw, so a scene shows the
    // drive from five different angles instead of spending a slot on a second helping of one. (With nine
    // presets and five slots this always has something left to pick; the max() below is the defensive floor.)
    const weights = presets.map((preset) => (used.has(preset.name) ? 0 : preset.weight));
    const pick = presets[Math.max(0, pickWeighted(random, weights))];
    // A tripod slot draws its stand-in NOW, from the same stream: a scene whose survey finds nothing still
    // plays the scene the seed describes, and the fallback is never a runtime coin flip.
    plan.push(
      pick.kind === 'station'
        ? { fallback: posedFallback(random, presets), preset: pick, seconds: shotSeconds(pick) }
        : { preset: pick, seconds: shotSeconds(pick) },
    );
    used.add(pick.name);
  }
  if (!plan.some((entry) => entry.preset.kind === 'chase')) {
    const chase = presets.find((preset) => preset.kind === 'chase');
    if (chase) {
      const at = Math.min(plan.length - 1, Math.floor(random() * plan.length));
      plan[at] = { preset: chase, seconds: shotSeconds(chase) };
    }
  }

  return plan;
}

/**
 * Advance the director by one rendered frame and hand back the pose for it.
 *
 * `subject` is the car as it is DRAWN this frame, already in engine space — the director never touches the
 * physics pose or the GTA axes (the 080 one-space rule).
 */
export function stepDirector(
  state: DirectorState,
  subject: Subject,
  dt: number,
  aspect: number,
  stations?: StationSource,
): DirectorFrame {
  state.elapsed += dt;
  const ending = shotEnding(state);
  if (ending !== null) {
    advance(state, ending);
  }
  const cut = state.fresh;
  const cause = cut ? state.cause : null;
  const shot = shotPlaying(state, subject, stations);
  if (shot.kind === 'chase') {
    // Hand the frame back to the rig — and forget the damped pose, so the next placed shot starts from its
    // own geometry instead of easing out of wherever the last one stood.
    state.eye = null;
    state.target = null;
    state.subject = null;
    state.panDirection = null;
    state.fresh = false;

    return { cut, cutCause: cause, panClipped: false, pose: null, screen: null, shot: shot.name };
  }

  if (shot.kind === 'static' && state.staticEye === null) {
    state.staticEye = shotEye(shot, subject);
  }
  // A tripod's eye came from the survey when the shot started ({@link shotPlaying}); a slot with no station
  // plays a car-anchored fallback instead, so the defensive default below is unreachable by construction.
  const wantedEye: [number, number, number] =
    shot.kind === 'tracking'
      ? shotEye(shot, subject)
      : (state.staticEye ?? [subject.position[0], subject.position[1], subject.position[2]]);
  const anchor = anchorFor(shot, wantedEye, subject);
  const wantedTarget = aimShot(wantedEye, subject.position, anchor, shot.fovYRad, aspect);
  // A car-mounted shot damps its MOUNT, never its world position. Damped in world space against a car at a
  // cruise, the eye carries a permanent lag (measured ~1.1 m at 12 m/s) whose per-frame catch-up step is
  // proportional to `dt` — so an irregular frame moves the eye by a different amount and the mount buzzes
  // ALONG THE TRAVEL AXIS. On a wing shot that axis is perpendicular to the view, which is the 6.0 px/frame²
  // of horizontal shiver the first field round reported (the diagnosis is in the 096 ledger).
  //
  // Re-based against the car, a constant-speed drive leaves the damper nothing to do: the smoothing then eases
  // only what genuinely changes — the heading the mount hangs off, and the anchor. A PLANTED eye (`static`,
  // `station`) re-bases against the world and so is untouched by this: it is not mounted on anything.
  const from = shot.kind === 'tracking' ? (state.subject ?? subject.position) : ORIGIN;
  const to = shot.kind === 'tracking' ? subject.position : ORIGIN;
  const eye = state.fresh
    ? wantedEye
    : dampVec(state.eye ?? wantedEye, wantedEye, from, to, state.eyeVelocity, shot.eyeSmooth, dt);
  const damped = state.fresh
    ? wantedTarget
    : dampVec(state.target ?? wantedTarget, wantedTarget, from, to, state.targetVelocity, shot.targetSmooth, dt);
  const { panClipped, target } = capPan(state, eye, damped, dt);
  state.eye = eye;
  state.target = target;
  state.subject = [subject.position[0], subject.position[1], subject.position[2]];
  state.fresh = false;

  const screen = projectToScreen(eye, target, shot.fovYRad, aspect, subject.position);
  const range = Math.hypot(subject.position[0] - eye[0], subject.position[1] - eye[1], subject.position[2] - eye[2]);
  // "Readable" is one predicate over three ways of losing the car: behind the eye, out at the frame edge,
  // or simply too far away to be a subject at all.
  const gone = screen.behind || range > shot.maxDist;
  const safe = !gone && Math.abs(screen.x - 0.5) <= SAFE_FRAME && Math.abs(screen.y - 0.5) <= SAFE_FRAME;
  state.framesJudged += 1;
  state.safeFrames += safe ? 1 : 0;
  state.offFrame = safe ? 0 : state.offFrame + dt;
  // GONE, not merely off-frame: the car is behind the eye or past the distance ceiling. Kept for the next
  // step's cut decision, which is patient with a car that might be behind a lamppost and not with one that
  // has driven away.
  state.passed = !safe && gone;
  state.panClips += panClipped ? 1 : 0;
  stepSightline(state, shot.kind === 'station' ? stations : undefined, eye, subject.position, dt);

  return {
    cut,
    cutCause: cause,
    panClipped,
    pose: { eye, fovYRad: shot.fovYRad, target },
    screen: { x: screen.x, y: screen.y },
    shot: shot.name,
  };
}

/**
 * End the current shot: count WHY it ended, then either move to the next one or finish the scene. A cut
 * declares itself through {@link DirectorState.fresh}, which the next step reports and the host's watchdog
 * reads.
 *
 * The cause is recorded before the finish check, always — the last shot of a scene ends for a reason like any
 * other, and a ledger that stopped counting at the fifth would under-report one cut per scene.
 */
function advance(state: DirectorState, cause: CutCause): void {
  state.causes[cause] += 1;
  if (state.index + 1 >= state.plan.length) {
    // The list IS the scene: the last shot ending ends the scene rather than wrapping to the first. The
    // runner sees `done` on this frame and brings the overlay down.
    state.done = true;

    return;
  }
  state.index += 1;
  state.cause = cause;
  state.elapsed = 0;
  state.fresh = true;
  state.misses = 0;
  state.offFrame = 0;
  state.sightlineIn = SIGHTLINE_SECONDS;
  state.staticEye = null;
  state.subject = null;
  state.substitute = null;
  state.panDirection = null;
  state.cuts += 1;
  for (const ref of [...state.eyeVelocity, ...state.targetVelocity]) {
    ref.velocity = 0;
  }
}

/**
 * Hold the view direction's angular rate under {@link PAN_RATE_MAX} by pulling the look point back around the
 * eye — the aim slows, the framing distance does not. A fresh shot has no previous direction and is never
 * capped: a cut IS the discontinuity.
 */
function capPan(
  state: DirectorState,
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  dt: number,
): { panClipped: boolean; target: [number, number, number] } {
  const wanted = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const previous = state.panDirection;
  const range = Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
  if (previous === null || dt <= 0) {
    state.panDirection = wanted;

    return { panClipped: false, target: [target[0], target[1], target[2]] };
  }
  const cosine = Math.min(1, Math.max(-1, previous[0] * wanted[0] + previous[1] * wanted[1] + previous[2] * wanted[2]));
  const angle = Math.acos(cosine);
  const allowed = PAN_RATE_MAX * dt;
  if (angle <= allowed) {
    state.panDirection = wanted;

    return { panClipped: false, target: [target[0], target[1], target[2]] };
  }
  // Rotate EXACTLY `allowed` toward the wanted direction, about the axis the two span (Rodrigues). A
  // normalized lerp along the chord was the first cut and it overshoots the cap by a hair on a fast pass —
  // small, but a cap a test cannot pin to its own value is not a cap.
  const axis = cross(previous, wanted);
  // Collinear directions span no axis — a straight reversal, which nothing here can produce and no cap could
  // describe. Take the wanted aim rather than inventing a swing side.
  const limited =
    Math.hypot(axis[0], axis[1], axis[2]) < 1e-9 ? wanted : rotateAbout(previous, normalize(axis), allowed);
  state.panDirection = limited;

  return {
    panClipped: true,
    target: [eye[0] + limited[0] * range, eye[1] + limited[1] * range, eye[2] + limited[2] * range],
  };
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * `smoothDamp` per axis with one velocity ref each — the same caller-owned-state shape the rig uses — done in
 * a frame that MOVES: `current` is read relative to `from` (where that frame stood when it was written) and
 * the result is handed back relative to `to` (where it stands now).
 *
 * With `from`/`to` both the origin this is a plain world-space damp. With both the car's position it is the
 * same filter applied to the shot's MOUNT, which is what a rigid shot needs: the car's own travel passes
 * straight through instead of becoming a lag for the frame clock to modulate.
 */
function dampVec(
  current: readonly [number, number, number],
  wanted: readonly [number, number, number],
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  velocity: SmoothDampRef[],
  smoothTime: number,
  dt: number,
): [number, number, number] {
  const axis = (index: number): number =>
    to[index] +
    smoothDamp(
      current[index] - from[index],
      wanted[index] - to[index],
      velocity[index],
      smoothTime,
      Number.POSITIVE_INFINITY,
      dt,
    );

  return [axis(0), axis(1), axis(2)];
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Where a `static` shot plants, checked (096/09).
 *
 * Until this existed the eye went wherever the car's geometry said and could be planted inside a wall — the
 * one gap 096 shipped with. The check is the SAME probe the tripod uses, asked a handful of times ONCE, at
 * the moment the shot starts; a planted eye never moves afterwards, so there is nothing to re-check and no
 * per-frame cost.
 *
 * With no probe available (a test, or a run with no station supply) the behaviour is exactly what it was:
 * the authored spot, unchecked. That keeps the director usable without a physics world.
 *
 * A shot whose every candidate is blocked does NOT film a wall — it hands back null and the caller
 * substitutes, which is what the tripod already does when its survey finds nothing.
 */
function plantEye(state: DirectorState, shot: PosedShot, subject: Subject, stations: StationSource): boolean {
  const candidates = plantedEyeCandidates(shot, subject);
  const clear = candidates.findIndex((eye) => stations.sightline(eye, subject.position));
  if (clear < 0) {
    state.blockedPlants += candidates.length;

    return false;
  }
  state.blockedPlants += clear;
  state.staticEye = candidates[clear];

  return true;
}

/** A car-anchored stand-in for a tripod slot the survey could not fill, drawn from the seeded stream. */
function posedFallback(random: () => number, presets: readonly ShotPreset[]): PosedShot {
  const posed = presets.filter((preset): preset is PosedShot => preset.kind === 'static' || preset.kind === 'tracking');
  if (posed.length === 0) {
    throw new Error('the shot table has no car-anchored preset to fall back on');
  }

  return posed[Math.min(posed.length - 1, Math.floor(random() * posed.length))];
}

/** Rodrigues: spin a UNIT vector by `angle` about a UNIT axis perpendicular to it. */
function rotateAbout(
  v: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number,
): [number, number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpendicular = cross(axis, v);

  return [
    v[0] * cos + perpendicular[0] * sin,
    v[1] * cos + perpendicular[1] * sin,
    v[2] * cos + perpendicular[2] * sin,
  ];
}

/**
 * Why the current shot ends this frame, or null to keep playing — the early-cut policy in ONE place and in
 * priority order (096/04 task 4).
 *
 * A blocked tripod outranks a frame the car has left (it is the more certain verdict), and both outrank the
 * shot's own clock. For a PLANTED shot that clock is only a watchdog: what is supposed to end one is exactly
 * the car driving out of its frame (the user's 2026-07-31 model).
 *
 * Which is why GONE and HIDDEN are two different clocks. A car behind the eye or past the distance ceiling
 * has passed, and nothing an obstacle can do produces that reading, so it needs no patience — waiting the
 * full {@link EMPTY_FRAME_SECONDS} would leave a second of empty road at the tail of every drive-past. A car
 * merely off to the side of the frame might be behind something, and that one is given the patient clock.
 */
function shotEnding(state: DirectorState): CutCause | null {
  if (state.misses >= SIGHTLINE_MISSES) {
    return 'occluded';
  }
  if (state.offFrame > (state.passed ? PASSED_SECONDS : EMPTY_FRAME_SECONDS)) {
    return 'empty';
  }

  if (state.elapsed < state.plan[state.index].seconds) {
    return null;
  }

  return isPlanted(state.plan[state.index].preset) ? 'watchdog' : 'scheduled';
}

/**
 * The preset actually playing this frame.
 *
 * A tripod takes its surveyed eye on the shot's FIRST frame and never asks again — the eye is fixed for the
 * whole shot by design (the occlusion verdict may cut away from it, it may never move it). A slot the survey
 * could not fill plays the plan's own fallback instead: a missing station costs variety, never a scene.
 */
function shotPlaying(state: DirectorState, subject: Subject, stations?: StationSource): ShotPreset {
  if (state.substitute) {
    return state.substitute;
  }
  const planned = state.plan[state.index].preset;
  if (!state.fresh) {
    return planned;
  }
  if (planned.kind === 'station') {
    const eye = stations?.take() ?? null;
    if (eye) {
      state.staticEye = [eye[0], eye[1], eye[2]];

      return planned;
    }

    return substituteFor(state);
  }
  // A planted car-anchored shot (096/09): the same question the tripod's survey answers, asked of the spots
  // this shot can reach. Without a probe it plants unchecked, exactly as it did before the check existed.
  if (planned.kind === 'static' && stations && !plantEye(state, planned, subject, stations)) {
    return substituteFor(state);
  }

  return planned;
}

/**
 * The live occlusion check: one probe per {@link SIGHTLINE_SECONDS}, and {@link SIGHTLINE_MISSES} blocked
 * answers in a row end the shot. It is asked ONLY for a tripod, and its only possible effect is a declared
 * cut — the camera never moves in response to it (the 080 multi-ray postmortem's whole lesson).
 */
function stepSightline(
  state: DirectorState,
  stations: StationSource | undefined,
  eye: Vec3,
  subject: Vec3,
  dt: number,
): void {
  if (!stations) {
    state.misses = 0;

    return;
  }
  state.sightlineIn -= dt;
  if (state.sightlineIn > 0) {
    return;
  }
  state.sightlineIn = SIGHTLINE_SECONDS;
  state.misses = stations.sightline(eye, subject) ? 0 : state.misses + 1;
}

function substituteFor(state: DirectorState): ShotPreset {
  state.fallbacks += 1;
  state.substitute = state.plan[state.index].fallback ?? posedFallback(() => 0, SHOTS);

  return state.substitute;
}
