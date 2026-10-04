/**
 * Video mode's shot presets and the framing math under them (plan 096/03).
 *
 * A shot is a TABLE ROW, never a code path: where the camera stands relative to the car, where the car sits
 * on screen, which lens, how long, how softly it follows. Three behaviours cover every row — `chase` yields
 * the frame back to the shipped follow rig, `tracking` rides the car's own heading frame, `static` plants the
 * eye once and lets the car drive past it.
 *
 * Two rules the numbers obey, both from CLAUDE.md and the 080 chain:
 *
 * - **Offsets are multiples of the CAR's own half-extents**, so a shot composed on the `admiral` frames a bus
 *   and a Bandito the same way. No metre is written against a model.
 * - **Offsets live in the SUBJECT's heading frame**, never the camera's screen frame — a screen-frame offset
 *   rotates while a swing is in flight and reads as a stick-and-jump (`docs/edge-cases/camera-rig.md`).
 *
 * Everything here is pure and engine Y-up: the caller converts at the physics boundary (the 080 two-spaces
 * rule) and hands over an already-converted subject.
 */
import { screenBasis } from '../camera/engine-camera';

/** Where the car should sit on screen: 0..1 from the LEFT and from the TOP edge, 0.5 being dead centre. */
export interface ScreenAnchor {
  x: number;
  y: number;
}

export type ShotName = 'chase' | 'crane' | 'flyby' | 'high' | 'nose' | 'station' | 'top' | 'wing-l' | 'wing-r';

/**
 * One shot. `chase` carries no geometry on purpose: the shipped follow rig IS that shot, so the director
 * writes `null` for those segments and inherits its collision and motion layers for free. `station` carries
 * none either, for the opposite reason: its eye comes from 04's survey of the world, not from the car.
 */
export type ShotPreset = ChaseShot | PosedShot | StationShot;

/** The car being filmed, engine Y-up, as of the frame being composed. */
export interface Subject {
  /** Unit forward — where the car POINTS. Its screen-space direction is what lead room is measured against. */
  forward: Vec3;
  /** The car's own half-extents (m), vehicle space `[lateral, longitudinal, vertical]` — every offset below
   *  is a multiple of these, which is what makes one table fit every model in the slot. */
  halfExtents: Vec3;
  /** The DRAWN position (the interpolated render pose), so the framing is continuous with what is on screen. */
  position: Vec3;
  /** Planar speed (m/s) — below {@link LEAD_SPEED_MIN} there is no motion to leave room for. */
  speed: number;
}

export type Vec3 = readonly [number, number, number];

/**
 * The screen-space crossing speed at which lead room is FULL (m/s) — below it the room is PROPORTIONAL, not
 * absent.
 *
 * This was a threshold once, and a threshold on a signal that hovers near it is a jump: `nose` puts the
 * crossing signal at roughly `0.11 × speed` (its eye rides a few degrees off the car's own axis), so a cruise
 * sat right on 2 m/s and the anchor snapped across 0.24 of the frame's width whenever the speed drifted over
 * it (096 field round 1). The same lesson as the empty-frame guard and the tripod's sightline: a boolean over
 * a continuous signal has no middle, and the middle is where the shot lives.
 */
const LEAD_SPEED_FULL = 2;

/**
 * How long a shot that RIDES the car plays (s).
 *
 * A length, not a range: these shots have no natural end — the car never leaves their frame — so what ends
 * them is an editorial decision, and the user made it. A drawn duration only made two identical wing shots
 * feel arbitrarily different lengths.
 *
 * **FROZEN 2026-08-01**, and the measurement says nothing else can end one: all **41 riding shots** of seed
 * 47 scenes 1-12 ended on this clip, none on the guard. Which is the point — the car cannot leave a frame
 * mounted on it, so this number is the whole of a riding shot's length.
 */
export const TRACKING_SECONDS = 10;

/**
 * The watchdog on a PLANTED shot (s): what ends one is the car leaving its frame, not a clock, so this is
 * only here for the car that never arrives — a wedged autopilot, a route that turned away.
 *
 * Derived rather than picked: the car has to cross from beyond the shot's distance ceiling, past the stand,
 * and out the far side — at most `2 × maxDist` ≈ 140 m for the widest preset, which is ~12 s at a cruise. 15
 * clears that honestly while still bounding a scene that has stopped happening.
 *
 * **FROZEN 2026-08-01 (D4's close-out) on a measurement, not on the derivation.** Once the watchdog got its
 * own cut cause, seed 47 scenes 1-12 ended **8 of 9 planted shots on the guard** (7 the car leaving frame,
 * 1 the sightline) and **1 on this watchdog** — so it is behaving as the safety net it is described as, not
 * as a length. The 40-scene soak could only bound that at ≤ 10 of 30 while the two causes shared a name.
 */
export const PLANTED_CEILING_SECONDS = 15;

/**
 * What a shot costs in ROAD (s), for sizing the route before it is walked.
 *
 * A planted shot is charged its pass, not its watchdog: a car that triggers the watchdog is not moving, so it
 * is not consuming road either. Sizing on the watchdog would ask for a third more road than any scene drives
 * and cost real routes — at a 936 m target San Fierro already accepts only 10 walks in 120.
 */
export const SHOT_ROAD_SECONDS = 12;

/** Shots dealt per scene (the user's decision, 2026-07-31): five cameras, and the scene is as long as they are. */
export const SHOTS_PER_SCENE = 5;

/** The presets, in the order a reader wants them: the free one first, then the placed ones. */
export const SHOTS: readonly ShotPreset[] = [
  { kind: 'chase', name: 'chase', weight: 3 },
  {
    // The car's face, from a little above the bonnet line and off its axis — the shot that shows a mod car.
    anchor: { x: 0.42, y: 0.56 },
    eyeSmooth: 0.22,
    fovYRad: (50 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 40,
    name: 'nose',
    offset: { forward: 3.4, height: 1.4, lateral: 0.9 },
    targetSmooth: 0.18,
    weight: 2,
  },
  {
    // Behind and well above: the road ahead reads, and the car sits low in frame with the city over it.
    anchor: { x: 0.44, y: 0.62 },
    eyeSmooth: 0.3,
    fovYRad: (55 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 40,
    name: 'high',
    offset: { forward: -3.5, height: 4, lateral: -0.6 },
    targetSmooth: 0.25,
    weight: 2,
  },
  {
    // Overhead, riding the car's heading: the road's own drawing, and the line the car takes through it.
    // Anchored a little BELOW centre so the road ahead takes the top half — the same rule as every other
    // preset, applied to a view with no horizon to hang it on.
    anchor: { x: 0.5, y: 0.56 },
    eyeSmooth: 0.28,
    fovYRad: (55 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 40,
    name: 'top',
    // ~12.6 m up and ~4.9 m ahead on a saloon: high enough to read a junction, and deliberately NOT straight
    // down. `screenBasis` derives its roll from the view direction's HORIZONTAL component
    // (`engine-camera.ts`), which vanishes at a perfectly vertical view — a preset that sat on that
    // singularity would have no defined roll and would shiver for exactly the reason field round 1 did. This
    // one holds ~21° off vertical, which reads as overhead and leaves the basis well conditioned.
    offset: { forward: 1.5, height: 18, lateral: 0 },
    targetSmooth: 0.22,
    weight: 2,
  },
  {
    // The crane: `high` taken further up and further back, so the car sits small in a wide plate of city.
    anchor: { x: 0.44, y: 0.6 },
    eyeSmooth: 0.34,
    fovYRad: (50 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 50,
    name: 'crane',
    offset: { forward: -6, height: 7, lateral: -1.2 },
    targetSmooth: 0.28,
    weight: 2,
  },
  {
    anchor: { x: 0.38, y: 0.58 },
    eyeSmooth: 0.18,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 40,
    name: 'wing-l',
    offset: { forward: 0.4, height: 1.6, lateral: -5 },
    targetSmooth: 0.14,
    weight: 2,
  },
  {
    anchor: { x: 0.38, y: 0.58 },
    eyeSmooth: 0.18,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 40,
    name: 'wing-r',
    offset: { forward: 0.4, height: 1.6, lateral: 5 },
    targetSmooth: 0.14,
    weight: 2,
  },
  {
    // Planted ahead of the car and to one side: it arrives, passes, and the guard cuts before the frame empties.
    anchor: { x: 0.42, y: 0.56 },
    eyeSmooth: 0.2,
    fovYRad: (40 * Math.PI) / 180,
    kind: 'static',
    maxDist: 60,
    name: 'flyby',
    // Planted far enough ahead and out that the pass itself stays under the pan cap: at a cruise the angular
    // rate at closest approach is speed/standoff, and the first headless round measured what a 2.7 m standoff
    // does to it (266 clipped frames in one scene).
    offset: { forward: 10, height: 3, lateral: 6 },
    targetSmooth: 0.16,
    weight: 1,
  },
  {
    // The tripod (096/04): a camera on a stand at the roadside, surveyed for a clear line before the shot
    // starts. Its standoff is the survey's business — this row only says how the car is framed from there.
    anchor: { x: 0.4, y: 0.55 },
    eyeSmooth: 0.2,
    fovYRad: (38 * Math.PI) / 180,
    kind: 'station',
    maxDist: 70,
    name: 'station',
    targetSmooth: 0.18,
    weight: 3,
  },
];

/**
 * The pedestrian table (096/07) — the same nine roles, sized for a person instead of a car.
 *
 * It is a SECOND TABLE rather than a scale factor on the first, because the two subjects differ in more than
 * size. A ped's half-extents are ~0.35 m across against a saloon's ~1.0, so a shared table would put every
 * lateral shot inside the walker; and the distances that read for a car (40-70 m) make a person a speck, so
 * every `maxDist` here is roughly a third of its driving twin. The OFFSETS are still multiples of the
 * subject's own half-extents — the rule does not change, only what it multiplies.
 *
 * The framing is deliberately closer and lower than the car table's: at 2 m/s there is no motion to leave
 * lead room for, and a shot that would read as "following a car through a city" reads as "lost the person"
 * at the same distance.
 */
export const WALK_SHOTS: readonly ShotPreset[] = [
  { kind: 'chase', name: 'chase', weight: 3 },
  {
    // Ahead of the walker at head height, a little off his axis — the face, and the street coming at him.
    anchor: { x: 0.42, y: 0.5 },
    eyeSmooth: 0.24,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 16,
    name: 'nose',
    // ~1.6 m ahead, ~1.4 m up, ~0.5 m to the side on a stock ped.
    offset: { forward: 4.6, height: 1.55, lateral: 1.4 },
    targetSmooth: 0.2,
    weight: 2,
  },
  {
    // Over the shoulder and above: the walk reads against the pavement ahead of him.
    anchor: { x: 0.44, y: 0.58 },
    eyeSmooth: 0.3,
    fovYRad: (50 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 16,
    name: 'high',
    offset: { forward: -5.7, height: 3.3, lateral: -1.7 },
    targetSmooth: 0.26,
    weight: 2,
  },
  {
    // Overhead, and off vertical for the SAME reason the car's `top` is (`screenBasis`'s roll singularity):
    // ~6.3 m up, ~1.1 m ahead holds it about 10° off the pole — enough for a defined roll at this height.
    anchor: { x: 0.5, y: 0.54 },
    eyeSmooth: 0.28,
    fovYRad: (55 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 18,
    name: 'top',
    offset: { forward: 3.2, height: 7, lateral: 0 },
    targetSmooth: 0.24,
    weight: 1,
  },
  {
    // The crane: back and well up, the walker small against the block he is crossing.
    anchor: { x: 0.46, y: 0.62 },
    eyeSmooth: 0.34,
    fovYRad: (45 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 24,
    name: 'crane',
    offset: { forward: -10, height: 5.5, lateral: -2.9 },
    targetSmooth: 0.3,
    weight: 2,
  },
  {
    anchor: { x: 0.4, y: 0.52 },
    eyeSmooth: 0.2,
    fovYRad: (40 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 14,
    name: 'wing-l',
    offset: { forward: 1.1, height: 1.7, lateral: -7.1 },
    targetSmooth: 0.16,
    weight: 2,
  },
  {
    anchor: { x: 0.4, y: 0.52 },
    eyeSmooth: 0.2,
    fovYRad: (40 * Math.PI) / 180,
    kind: 'tracking',
    maxDist: 14,
    name: 'wing-r',
    offset: { forward: 1.1, height: 1.7, lateral: 7.1 },
    targetSmooth: 0.16,
    weight: 2,
  },
  {
    // Planted ahead and to one side; he walks into it and out of it. The standoff is wider than the walker
    // needs, because the pan rate at closest approach is speed/standoff and a tight plant whips even at 2 m/s.
    anchor: { x: 0.42, y: 0.52 },
    eyeSmooth: 0.22,
    fovYRad: (38 * Math.PI) / 180,
    kind: 'static',
    maxDist: 22,
    name: 'flyby',
    offset: { forward: 11.4, height: 1.9, lateral: 8.6 },
    targetSmooth: 0.18,
    weight: 1,
  },
  {
    // The tripod, surveyed against the world exactly as the driving one is — only the framing lives here.
    anchor: { x: 0.42, y: 0.5 },
    eyeSmooth: 0.2,
    fovYRad: (36 * Math.PI) / 180,
    kind: 'station',
    maxDist: 26,
    name: 'station',
    targetSmooth: 0.2,
    weight: 3,
  },
];

/** Any shot the director poses itself — everything needed to FRAME a car, whatever put the eye where it is. */
export type PlacedShot = PosedShot | StationShot;

/** A shot whose eye comes from the CAR: `tracking` re-places it every frame, `static` plants it once. */
export type PosedShot = FramedShot & {
  readonly kind: 'static' | 'tracking';
  readonly offset: ShotOffset;
};

/** Camera offset in the CAR's heading frame, as multiples of its half-extents (forward/lateral/height). */
export interface ShotOffset {
  readonly forward: number;
  readonly height: number;
  readonly lateral: number;
}

type ChaseShot = ShotBase & { readonly kind: 'chase' };

type FramedShot = {
  /** Where the car sits on screen before lead room mirrors it ({@link anchorFor}). */
  readonly anchor: ScreenAnchor;
  /** `smoothDamp` time constants (s) for the eye and the look point — the shot's whole feel. */
  readonly eyeSmooth: number;
  readonly fovYRad: number;
  /** Beyond this the car is too far to read and the guard treats the frame as empty (m). */
  readonly maxDist: number;
  readonly targetSmooth: number;
} & ShotBase;

interface ShotBase {
  readonly name: ShotName;
  /** Relative weight in the seeded pick. */
  readonly weight: number;
}

/** A tripod: the eye comes from 096/04's surveyed station, so the preset carries only the framing. */
type StationShot = FramedShot & { readonly kind: 'station' };

/**
 * The look point that puts `subject` at `anchor` on screen, given where the camera stands.
 *
 * The aim depends on the basis, and the basis depends on the aim — so it is solved, not derived: start with
 * the camera looking straight at the car, offset the look point along that basis, then re-solve once on the
 * basis that offset produced. Two passes land the anchor inside a hundredth of the frame at every distance
 * and lens the presets use (pinned by the tests); a third buys nothing.
 */
export function aimShot(
  eye: Vec3,
  subject: Vec3,
  anchor: ScreenAnchor,
  fovYRad: number,
  aspect: number,
): [number, number, number] {
  const tanHalf = Math.tan(fovYRad / 2);
  // NDC of the wanted anchor: x right, y UP — the screen anchor counts y down, hence the flip.
  const ndcX = 2 * anchor.x - 1;
  const ndcY = 1 - 2 * anchor.y;
  let target: Vec3 = subject;
  for (let pass = 0; pass < 2; pass += 1) {
    const forward = normalize(sub(target, eye));
    const { right, up } = screenBasis(forward);
    // How far the car is ALONG the view — the screen offset scales with it, not with the straight-line range.
    const depth = Math.max(0.01, dot(sub(subject, eye), forward));
    const dx = ndcX * tanHalf * aspect * depth;
    const dy = ndcY * tanHalf * depth;
    target = [
      subject[0] - right[0] * dx - up[0] * dy,
      subject[1] - right[1] * dx - up[1] * dy,
      subject[2] - right[2] * dx - up[2] * dy,
    ];
  }

  return [target[0], target[1], target[2]];
}

/**
 * The anchor a shot actually uses this frame: the car sits on the side OPPOSITE its screen-space travel (D4's
 * "drives into the frame"), by an amount PROPORTIONAL to how fast it is crossing the frame. A car crossing to
 * the right is framed left, with the road it is heading into taking the open half.
 *
 * The authored `anchor.x` says how much room the shot wants (its distance from centre); which SIDE that room
 * goes on is the motion's business, never the table's — a side authored against the motion would fight it.
 * With no crossing motion there is no lead to give and the car sits centred; the authored `y` is never
 * mirrored, so it still holds the car low in frame with the city over it.
 */
export function anchorFor(shot: PlacedShot, eye: Vec3, subject: Subject): ScreenAnchor {
  const { right } = screenBasis(normalize(sub(subject.position, eye)));
  const screenMotion = dot(subject.forward, right) * subject.speed;
  const room = Math.abs(shot.anchor.x - 0.5);

  return { x: 0.5 - room * leadShare(screenMotion / LEAD_SPEED_FULL), y: shot.anchor.y };
}

/** Unit forward in ENGINE space for a GTA heading (0 faces +Y, counter-clockwise about +Z). */
export function forwardFromHeading(heading: number): [number, number, number] {
  return [-Math.sin(heading), 0, -Math.cos(heading)];
}

/**
 * Whether this shot is PLANTED — a fixed eye the car drives through, rather than one that rides it.
 *
 * The one predicate the two kinds are told apart by, and it was written out inline in four places before
 * 096/08 gave the planted watchdog its own cut cause.
 */
export function isPlanted(shot: ShotPreset): boolean {
  return shot.kind === 'static' || shot.kind === 'station';
}

/**
 * The spots a PLANTED shot may stand at, best first (096/09).
 *
 * A `static` shot derives its spot from the car's geometry and NOTHING else, so nothing has ever stopped it
 * landing inside a wall — 096 shipped and was field-accepted with that hole open, and not being planted in a
 * wall in the scenes watched was never evidence that it could not be. The fix is not a different spot but a
 * CHOICE of spots: the director walks this list and takes the first with a clear line to the car
 * ({@link stepDirector}), the same answer the tripod already gets from its survey.
 *
 * Every variant is the authored offset re-signed or scaled, never a constant of its own, so it stays a
 * multiple of the subject's own half-extents — a mod car of a different size gets a differently-sized ladder
 * for free, and a shot whose authored spot is already clear never moves.
 *
 * The order encodes what a camera operator would try: the other side of the road first (a street is usually
 * blocked from one side only), then higher — over whatever is in the way.
 *
 * **The length is a BUDGET, not a taste.** Each candidate costs one cast, they are all spent on the single
 * frame the shot starts, and 080's standing rule is ≤ 5 casts/frame for the whole game with the follow rig
 * already spending 2. Three is what fits. A longer ladder would find a spot slightly more often and blow the
 * frame it found it on, which is the trade 080 already settled once.
 */
export function plantedEyeCandidates(shot: PosedShot, subject: Subject): [number, number, number][] {
  const { forward, height, lateral } = shot.offset;

  return [shot.offset, { forward, height, lateral: -lateral }, { forward, height: height * 2, lateral }].map((offset) =>
    eyeAt(offset, subject),
  );
}

/**
 * Where a world point lands on screen (0..1 from the left and the top), and whether it is BEHIND the camera —
 * which the empty-frame guard has to tell apart from "off to the side", because a point behind the eye
 * projects to a perfectly plausible pair of numbers.
 */
export function projectToScreen(
  eye: Vec3,
  target: Vec3,
  fovYRad: number,
  aspect: number,
  point: Vec3,
): { behind: boolean; x: number; y: number } {
  const forward = normalize(sub(target, eye));
  const { right, up } = screenBasis(forward);
  const delta = sub(point, eye);
  const depth = dot(delta, forward);
  if (depth <= 0.01) {
    return { behind: true, x: 0.5, y: 0.5 };
  }
  const tanHalf = Math.tan(fovYRad / 2);
  const ndcX = dot(delta, right) / (tanHalf * aspect * depth);
  const ndcY = dot(delta, up) / (tanHalf * depth);

  return { behind: false, x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
}

/**
 * Where a shot's camera stands this frame: the car's position plus the preset's offset in the car's own
 * heading frame, each component scaled by the matching half-extent.
 *
 * The car's right is `forward × up` exactly — the same right the ped-offset spawn uses, so "lateral +1" is
 * the passenger side in every module that talks about this car.
 */
export function shotEye(shot: PosedShot, subject: Subject): [number, number, number] {
  return eyeAt(shot.offset, subject);
}

/**
 * How long this shot is SCHEDULED for (s) — {@link TRACKING_SECONDS} for a shot that rides the car, the
 * watchdog for one that is planted.
 *
 * The two kinds end for different reasons, and the difference is the whole of the user's 2026-07-31 model: a
 * riding shot has no natural end, so it runs a fixed clip; a planted shot ends when the car has left its
 * frame, and its number here is only the ceiling that stops a scene which has stopped happening.
 */
export function shotSeconds(shot: ShotPreset): number {
  return isPlanted(shot) ? PLANTED_CEILING_SECONDS : TRACKING_SECONDS;
}

function eyeAt(offset: ShotOffset, subject: Subject): [number, number, number] {
  const forward = normalize(subject.forward);
  const right = cross(forward, UP);
  const [hx, hy, hz] = subject.halfExtents;
  const lateral = offset.lateral * hx;
  const ahead = offset.forward * hy;
  const height = offset.height * hz;

  return [
    subject.position[0] + right[0] * lateral + forward[0] * ahead,
    subject.position[1] + height,
    subject.position[2] + right[2] * lateral + forward[2] * ahead,
  ];
}

const UP: Vec3 = [0, 1, 0];

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * How much of a shot's lead room this crossing speed earns, signed: 0 at a standstill, ±1 once the car is
 * crossing at {@link LEAD_SPEED_FULL}. Smoothstepped rather than clamped linearly so SATURATION is not a kink
 * either — the shot most likely to sit near the top of the ramp is the one that sat on the old threshold.
 */
function leadShare(ratio: number): number {
  const share = Math.min(1, Math.abs(ratio));

  return Math.sign(ratio) * share * share * (3 - 2 * share);
}

function normalize(v: Vec3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
