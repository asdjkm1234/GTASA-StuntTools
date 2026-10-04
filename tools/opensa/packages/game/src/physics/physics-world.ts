import { Quaternion, Vector3 } from '@opensa/math';

import type { ColliderBox, ColliderSphere, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Rapier } from './rapier';

/** Gravity along GTA −Z (the world is Z-up; the −90°X is display-only). */
const GRAVITY_Z = -9.81;

/** Extra ray length below a body's half-height when testing for ground contact. */
const GROUND_EPSILON = 0.15;

// Raycast-vehicle suspension tuning (shared by every car). Stiff + well-damped so the chassis
// rests at a small compression — the COL hull bottom sits only ~0.13 m above the wheel contact,
// so a soft/under-damped spring lets the hull sink into the road and bounce (rolling the wheels).
const SUSPENSION_REST = 0.15; // spring rest length: wheel hangs this far below its connection
/**
 * The spring, expressed the way the ORIGINAL GAME expresses it (plan 081/03, from the reversed source):
 *
 * ```cpp
 * springForce = (1 - springLength) * mass * fSuspensionForceLevel * 0.016f * timeStep * fSuspensionBias;
 * ```
 *
 * Two structural facts come out of that line, and both are now honoured here rather than approximated:
 *
 * - The force is proportional to **mass** — Rapier multiplies by chassis mass internally too, so neither of
 *   us needs a mass term in the rate.
 * - The compression is **normalised to the car's own travel**. That is why a short-travel car is stiffer in
 *   absolute terms at the same authored level, and it is what a car's STANCE is set by: sag as a FRACTION of
 *   travel depends on the force level alone, never on the car's size or weight.
 *
 * So the rate handed to Rapier — which wants metres — is `SCALE × forceLevel / travel`. The scale absorbs
 * SA's `0.016` and Rapier's own internal factor; it is the one bridging number left, and it is calibrated so
 * a mid-range level (1.1) sits at ~30 % sag, which is where road-car setups live.
 */
const SUSPENSION_LEVEL_SCALE = 5.2;

/**
 * The rate a MID-RANGE car lands on — kept only as the reference the DAMPING ratios were tuned against
 * (see {@link SUSPENSION_COMPRESSION_RATIO}). The rate itself now comes from SA's law above, not from here.
 *
 * History worth keeping: it was 120, and that was two errors at once. It carried a mass term that Rapier
 * already applies (so the rate grew with mass² and a 6.5 t truck sagged 3.3 mm under its own weight), and it
 * was ~7× a real spring — 15 mm of sag, so the braking transfer that moves 94.6 % of the load to the front
 * axle produced 0.59° of pitch. Invisible. That one number sat behind three separate complaints: no dive
 * under braking, 0.05° of roll under a second of held lock, and a kerb's impulse becoming body rotation
 * because a spring that cannot deflect cannot absorb.
 */
const SUSPENSION_STIFFNESS = 34;
/**
 * Damping is DERIVED from the rate, not set beside it: Bullet's `damping = ratio × 2√stiffness`, with the
 * ratios taken from the pair that was tuned in-browser at stiffness 112 (compression 0.567, rebound 0.109).
 * Anything else and softening the spring would leave the damping where a seven-times-stiffer spring needed
 * it. The compression ratio is deliberately high — that is the 074 launch-hop lesson, preserved as a RATIO
 * so it survives every future rate change.
 */
const SUSPENSION_COMPRESSION_RATIO = 0.567;
const SUSPENSION_RELAXATION_RATIO = 0.109;
const SUSPENSION_MAX_TRAVEL = 0.25;
const SUSPENSION_MAX_FORCE = 40000; // carries the chassis at small compression without overshoot
// The per-car derivation (plan 081/02 §3) scales the numbers above off the sedan they were tuned on.
const SUSPENSION_REFERENCE_MASS = 1500;
const SUSPENSION_REFERENCE_FORCE = 1.1; // the mid-range `fSuspensionForceLevel` of the stock car table
const SUSPENSION_FORCE_PER_KG = SUSPENSION_MAX_FORCE / SUSPENSION_REFERENCE_MASS;
const SUSPENSION_DAMPING_REFERENCE = 0.15; // the mid-range `fSuspensionDampingLevel`
/**
 * Static sag = this / stiffness (m) — how far a car settles onto its springs under its own weight.
 *
 * The `1/stiffness` SHAPE is derived: Rapier's force is `stiffness × compression × mass × 1.43`, so the mass
 * cancels against the weight it carries and the sag depends on the rate alone. The CONSTANT is fitted, not
 * derived (2.0 against the analytic 1.72), because the load per wheel is not exactly a quarter of the weight
 * — the centre of mass is offset and the axles do not share equally. Fitted across a 4× rate range, residual
 * under 1 cm; measured with the ride-height probe, not reasoned about.
 *
 * It exists so the wheel sits at its MODEL HUB when the car is standing. Without it, softening the spring
 * (081/03 §1) sank the cars into the asphalt — the field report that produced this constant.
 */
/**
 * Rapier's suspension force per unit of rate, compression and chassis mass, inverted: how far a corner sinks
 * under the weight it carries is `sag = load / (THIS × stiffness × mass)`.
 *
 * **A measured bridge, not a derivation.** A force probe gave 1.43 for the force law, but predicting SAG with
 * it left every car sitting low: solving the same relation from four settled cars (romero front and rear,
 * infernus, admiral — loads 3.4-8.7 kN, rates 12-25) gives **1.06 … 1.21**, and the value below is the middle
 * of that. The residual is ±7 %, i.e. under a centimetre of ride height on these cars. The gap is real
 * (Rapier's settled length is not purely the spring — its damping and relaxation terms are in there too) and
 * closing it properly means solving the controller's own equilibrium rather than probing it.
 *
 * It replaces a constant that assumed **every corner carries a quarter of the car**. That assumption is
 * wrong for any car whose authored centre of mass is off-centre, and spectacularly wrong for the ones that
 * say so loudest: the romero hearse authors its centre 0.8 m back, its rear corners carry 71 % of a 2.5 t
 * body, and with a quarter-mass lift under them the car stood 7 cm low at the back and 5 cm high at the
 * front — 12 cm of rake, which is exactly what the field saw ("the romero is tipped backwards"). Its rear
 * springs had been driven to a NEGATIVE length: compressed past their own rest point and through the stop.
 */
const SUSPENSION_FORCE_PER_STIFFNESS = 1.15;
/**
 * A spring may not sag further than this share of the travel the car actually HAS.
 *
 * Real setups run 25-35 % static sag, and the reason is geometric: a car with 10 cm of travel needs a stiff
 * spring, a car with 47 cm needs a soft one, whatever their authored "force level" says — that number is
 * relative to the car's own geometry, not an absolute rate. The comet proved it in the field: a lowered
 * race Porsche authoring the SOFTEST force (0.64) and the SHORTEST travel (10 cm) came out sagging 10.1 cm,
 * so it stood on its bump stops with its wheels through the road. This floor rescues exactly that case and
 * leaves every car with generous travel untouched.
 */
const SUSPENSION_MAX_SAG_OF_TRAVEL = 0.35;
const SUSPENSION_COMPRESSION_FLOOR = 2; // a floor on the DERIVED value, not a substitute for it
const SUSPENSION_RELAXATION_FLOOR = 0.4;
/**
 * The damping scale is CLAMPED, and the ceiling is the half that was learned the hard way.
 *
 * SA's own `fSuspensionDampingLevel` runs 0.02…0.19 across the stock table, but a MOD can author anything —
 * the admiral in this install ships 0.81. Scaled linearly that made compression 64.8 against a reference 12,
 * and a wheel damped five times too hard cannot follow the road: it skips, the car shivers at rest and never
 * puts its power down. The field report ("the admiral shivers and barely drives") was exactly this.
 *
 * A floor keeps a 0.02 tank off its pogo stick; the ceiling keeps an out-of-range row from freezing a wheel.
 * Both are honest: the authored value still orders the cars, it just cannot leave the range the solver works
 * in. See the 081/02 ledger — this is also the case that proved a capture must record what it ran with.
 */
const SUSPENSION_DAMPING_SCALE_MIN = 0.35;
const SUSPENSION_DAMPING_SCALE_MAX = 2;
/**
 * The tyre (plan 081/05) — **parked at the field-liked baseline, on purpose, pending the 2g experiment.**
 *
 * `fTractionMultiplier` is read here as a friction coefficient (`frictionSlip = TM × axle split`). The
 * 2026-07-27 audit proved that is NOT what the original does — SA's grip is a per-wheel Δv budget
 * (`ProcessCarWheelPair` → `ProcessWheel`: `4.5 (surface.dat road×rubber) × TM × 0.001 × loadFactor`, the
 * load factor = `4 × the wheel's weight share`, capped at 2), which closes to **45 × TM m/s² ≈ 2.25 × TM in
 * units of SA's OWN 20 m/s² gravity**. Two ports of that budget were field-tested the same day:
 *
 * - absolute (`μ = 4.59 × TM` against our 9.81): grip-to-weight came out DOUBLE the original's —
 *   "weightless, uncontrollable, fast" within one round;
 * - dimensionless (`μ = 2.25 × TM`): weight-feel right, but absolute cornering radii ~2× the original's —
 *   the obstacle-avoidance-at-speed complaint stayed, because at 1 g you cannot have both SA's radii and
 *   SA's weight-feel.
 *
 * The decision (audit addendum, round 3): stay on the baseline the field likes. The 2g experiment (081/08)
 * then field-tested the original's WHOLE world and died the same day — the postmortem
 * (`docs/postmortem/081-vehicle-physics/sa-faithful-feel.md`) carries what it proved: the "weak at speed"
 * complaint is a SHAPE, not a scale, and this project's feel target is the field's verdict, not the
 * original's numbers. (10.5, Bullet's demo default, remains the third recorded wrong value.)
 */
/**
 * Speed-growing lateral grip (plan 081/09) — the lever with the complaint's INVERSE shape.
 *
 * A tyre's lateral ceiling `μ × N` is speed-independent while the radius a swerve demands grows with v², so
 * any honest tyre reads strong at 30 km/h and helpless at 130 — and the 081/08 postmortem proved no uniform
 * scale can fix that without breaking the low-speed feel the field likes. So the grip the LATERAL solver
 * sees grows with speed instead:
 *
 * ```
 * boost(v) = min(1 + (v / reference)², cap)
 * ```
 *
 * Downforce-form, but VIRTUAL — a factor on `frictionSlip` only, never a real force: rest weight, springs,
 * stance and jumps see nothing. The engine clamp and the brake cap stay on the UNBOOSTED grip, so launches,
 * acceleration and braking are byte-identical to the field-liked baseline. At the default dials: ≤ ×1.3
 * below 40 km/h (town feel untouched), ×2.5 from ~110 km/h up — entry yaw at 110 goes ~13°/s → ~32°/s, a
 * 3 m swerve needs ~13 m of road instead of ~29.
 *
 * **This is a deliberate assist the original does not have** (SA "solves" the same shape with ~3 g tyres in
 * a 2 g world — field-rejected wholesale in 08), and **the dials belong to the field**: `?gripVd=<m/s>` and
 * `?gripCap=<×>` override per session via {@link PhysicsWorld.tuneSpeedGrip}, every `[phys]` capture
 * records the active values, and the accepted numbers get committed as these defaults.
 */
// Defaults re-aimed after the first tuning round (2026-07-27): the field's pain STARTS at 50 km/h — an
// ordinary street corner at 60 needs ~2 g of lateral, which demands the boost near-full by ~45 km/h, not by
// 110. At 12 m/s reference / cap 3: 30 km/h ×1.5, 50 km/h ×2.3, 60+ km/h ×3 (≈ 0.7 g → 2.1 g — a 60 km/h
// corner radius of ~14 m, streetable without braking). The first round's 20 / 2.5 only bit above ~90 km/h,
// and its field test was additionally masked by the SLIDE_SPEED unit bug (full-lock plow drowned the dials).
const SPEED_GRIP_REFERENCE = 12; // m/s — the speed where the boost reaches ×2
const SPEED_GRIP_CAP = 3;
/** How much of the original's in-air authority a car gets (plan 081/06 §1, `?airCtl=<×>`). 1 = SA's own
 *  strength; the law itself lives in `vehicle/air-control.ts`, which explains what a jump under 9.81 does
 *  with numbers authored for 20. */
const AIR_CONTROL_SCALE = 1;
/**
 * What a LOCKED wheel keeps of its lateral stiffness — 3 %, and it has to be that low for a reason worth
 * knowing.
 *
 * Rapier weighs the two impulses UNEVENLY when it checks the friction circle: `fwd_factor = 0.5`,
 * `side_factor = 1.0`. So a wheel braking at its full grip has spent only half of its circle on the check,
 * and keeps up to 87 % of its lateral capacity — a "locked" rear axle stays planted, which is exactly what
 * the field kept reporting ("Space and H work the same"). The lateral cut therefore has to be explicit, and
 * it has to be nearly total before a skidding tyre behaves like one.
 *
 * Measured on the `handbrake-flick` replay (moderate steering held, lever pulled mid-corner) — body slip
 * before the lever → after it, on an admiral:
 *
 * - 0.15 → **5.7°**: nothing a driver could feel.
 * - 0.03 → **33.0°**, and the car comes round 134° instead of 98°.
 *
 * Not zero: a skidding tyre still scrubs sideways, and an axle with literally no side force spins the car on
 * the spot instead of arcing. Applies ONLY while the lever is up.
 */
const LOCKED_SIDE_FRICTION = 0.03;
/** How close to its friction circle a wheel must be before it counts as having broken loose. Just under 1:
 *  the solver lands exactly ON the circle when it clamps, and floating-point equality is not a state test. */
const SLIDE_THRESHOLD = 0.98;
/** Standard gravity — the static load a corner carries is its share of `mass × g`. */
const GRAVITY = 9.81;
/** No axle may be given the whole car: a centre of mass authored outside the wheelbase would otherwise put a
 *  negative load on the other end, and a few modded rows do exactly that. */
const MAX_AXLE_SHARE = 0.9;
const TYRE_GRIP_FLOOR = 0.2; // a row authoring 0 (there are 19) would weld the wheels; keep them steerable
const PARKING_BRAKE = 80; // holds a parked car put (released by the driver when throttling)
/**
 * A GUESSED constant the original does not have — kept, for now, on a field verdict.
 *
 * SA's only flat speed losses on a car are air drag (`dragMult × v² / 2000`) and the wheels' own friction,
 * so the honest value here is 0: this adds `0.1 × v` of phantom drag (~3 m/s² at 108 km/h, 3× a sports
 * car's authored figure; the admiral tops ~153 of its authored 180 km/h). The 2026-07-27 audit zeroed it —
 * in the same commit as a 7× grip change — and the round came back "the cars are fast, uncontrollable".
 * Multi-variable change, unreadable verdict; it went back to the field-liked 0.1. Retiring it is owed as
 * its OWN step, measured on a coast-down capture, nothing else moving.
 */
const CHASSIS_LINEAR_DAMPING = 0.1;
/**
 * Angular damping on the chassis — **0.5, which is the original's own value** (081/05).
 *
 * SA damps a car's rotation once per frame in `CPhysical::ApplyAirResistance`: `m_vecTurnSpeed *= 0.99f`. At
 * its 50 Hz that is 0.605 of the yaw left after a second, and the Rapier damping that matches it at our fixed
 * step is 0.5. So this is a translated number, not a taste.
 *
 * It stood at **2** — a band-aid raised to resist the flips a high, emergent centre of mass used to cause,
 * and it deadened honest body rotation along with them: it leaves 14 % of a car's yaw after a second, which
 * is a car that will not turn in however much grip or lock you give it. Three field rounds in a row said
 * "hard to get into a corner" while it was in place.
 *
 * Measured, with the authored mass properties and real tyres underneath (admiral / comet, `turnedDeg` = how
 * far round the lap actually got):
 *
 * - u-turn: 36.9° → **49.2°** and 18.9° → **26.3°**
 * - slalom: 25.9° → **59.6°** and −22.0° → **58.4°**
 *
 * **The cost, stated rather than hidden**: at 2 the band-aid was also masking a real instability, and the
 * comet flipped on the kerb-strike replay without it (20.6° of roll → a full 179°). That is not this
 * constant's job to fix — a raycast wheel cannot see a vertical kerb face until its centre crosses the edge,
 * which is plan 06's kerb probe. Recorded here so nobody re-raises this number instead of fixing the kerb.
 *
 * **That flip no longer reproduces at head** (2026-07-27 regression pack: comet `kerb-strike` peaks at 14.2°
 * of roll, no flip, on any of the five cars). Do not read it as fixed: the capture's new position channel
 * showed the lap never gets to test a kerb — it ends against a traffic light at (2221.8, 1203.3) — so the
 * scene stopped being evidence, not the mechanism. The mechanism itself is still measurable, as the vertical
 * spike a mount delivers (`kerb-mount`, 081/06 §2).
 */
const CHASSIS_ANGULAR_DAMPING = 0.5;
const CHASSIS_FRICTION = 0.4;
const CHASSIS_RESTITUTION = 0.35; // bounce off walls a little instead of sticking dead
const CONTACT_FORCE_THRESHOLD = 400; // min contact force (N) before an impact event is emitted

/**
 * The shared vehicle tuning as the F2 Physics tab prints it (plan 081/01), `[label, value]` rows.
 *
 * Read-only on purpose: every car in the world runs this one set today — an infernus and a firetruck get the
 * same spring and the same grip — and that is exactly what plans 02-06 replace with per-car handling data.
 * Showing the numbers next to the live telemetry is what makes the shared-set problem visible while driving.
 */
export const VEHICLE_PHYSICS_CONSTANTS: readonly (readonly [string, number])[] = [
  ['susp rest (m)', SUSPENSION_REST],
  ['susp stiffness', SUSPENSION_STIFFNESS],
  ['susp compression ratio', SUSPENSION_COMPRESSION_RATIO],
  ['susp rebound ratio', SUSPENSION_RELAXATION_RATIO],
  ['susp max travel (m)', SUSPENSION_MAX_TRAVEL],
  ['susp max force (N)', SUSPENSION_MAX_FORCE],
  ['tyre grip floor', TYRE_GRIP_FLOOR],
  ['speed grip ref (m/s)', SPEED_GRIP_REFERENCE],
  ['speed grip cap', SPEED_GRIP_CAP],
  ['parking brake (N)', PARKING_BRAKE],
  ['chassis lin damping', CHASSIS_LINEAR_DAMPING],
  ['chassis ang damping', CHASSIS_ANGULAR_DAMPING],
  ['chassis friction', CHASSIS_FRICTION],
  ['chassis restitution', CHASSIS_RESTITUTION],
];

/** GTA cars face +Y, are Z-up; axle is left-right (X). Indices for the raycast controller. */
const FORWARD_AXIS = 1; // +Y
const UP_AXIS = 2; // +Z

// Collision groups (`membership << 16 | filter`). Vehicle chassis colliders get their own
// membership bit so the player's collider can be made to ignore them while entering/seated
// (so climbing into the dynamic car doesn't shove it), without affecting on-foot collision.
const VEHICLE_GROUP = 0x0002;
const VEHICLE_GROUPS = ((VEHICLE_GROUP << 16) | 0xffff) >>> 0;
const PROP_GROUP = 0x0004;
/**
 * A knocked-over prop (074/08 B7·a): collides with the WORLD but NOT with vehicles. It is spawned at the very
 * instant a car is embedded in it — the bumper is already inside the pole's volume — so letting the two solve
 * against each other launches the pole through the ground and bogs the car down in it. It falls, it lands, it
 * lies there; the car drives on.
 */
const PROP_GROUPS = ((PROP_GROUP << 16) | (0xffff & ~VEHICLE_GROUP)) >>> 0;
const PLAYER_GROUPS_DEFAULT = 0xffffffff; // collide with everything (incl. standing on a car)
const PLAYER_GROUPS_IGNORE_VEHICLES = ((0xffff << 16) | (0xffff & ~VEHICLE_GROUP)) >>> 0;

/** Kinematic character-controller tuning. */
const CONTROLLER_OFFSET = 0.02; // gap kept between the capsule and obstacles
const STEP_HEIGHT = 0.4; // auto-climb kerbs/stairs up to this
/** SA's rubber-on-road adhesion (`surface.dat`) — the fallback whenever the world ships no matrix, and the
 *  value every other surface is expressed as a share of. The same 4.5 the steering limiter carries. */
const ROAD_ADHESION = 4.5;
/** The wheel-surface probe (081/10): start this far ABOVE the reported contact point so the ray begins
 *  outside the ground it is about to hit, and reach only a little past it — a wheel is on what it touches,
 *  not on whatever lies a metre under a bridge deck. */
const PROBE_LIFT = 0.05;
const PROBE_REACH = 0.35;
const STEP_MIN_WIDTH = 0.1; // minimum landing width to step onto
const SNAP_DISTANCE = 0.4; // stay glued to ground within this (slopes/stairs going down)
const MAX_SLOPE_CLIMB = (50 * Math.PI) / 180; // can't walk up steeper than this
const MIN_SLOPE_SLIDE = (45 * Math.PI) / 180; // slides down slopes steeper than this
/** Capsule is Y-aligned in Rapier; +90° about X stands it along GTA +Z (up). */
const CAPSULE_UPRIGHT: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export interface BodyTransform {
  position: Vec3;
  quaternion: Quat;
}

/** Rapier's kinematic character controller (slide/autostep/snap/slope). */
export type CharacterController = ReturnType<RapierWorld['createCharacterController']>;
/** Result of advancing a kinematic character one step. */
export interface CharacterMove {
  grounded: boolean;
  movement: Vec3;
}

/** A contact-force impact between two bodies in a step (for vehicle collision damage). */
export interface Impact {
  bodyA: null | number;
  bodyB: null | number;
  force: number; // max contact force magnitude (N)
  point: null | Vec3; // world-space contact point (where the hit landed), if available
}
/**
 * A static-collider build in progress (plan 200/3-02) — see
 * {@link PhysicsWorld.beginStaticColliders}.
 */
export interface StaticColliderBuild {
  /** Bodies created SO FAR. A caller abandoning the build removes exactly these. */
  readonly handles: number[];
  /** Create bodies until `budgetMs` is spent; true once the last one exists. */
  step(budgetMs: number): boolean;
}

/** Rapier's raycast vehicle controller (engine/brake/steer, suspension, wheels). */
export type VehicleController = ReturnType<RapierWorld['createVehicleController']>;

/** Which wheels the engine drives (`nDriveType`). */
export type VehicleDriveType = '4' | 'F' | 'R';
/**
 * A vehicle body's AUTHORED mass properties (plan 081/02) — `handling.cfg`'s, not the collision hull's.
 *
 * Until this existed the body took an equal share of its mass per COL primitive, so its centre of mass came
 * out wherever the modeller happened to put the cabin box — high, and different per model. 081/01 measured
 * what that costs: the infernus and the firetruck go over in scenes the admiral drives through, and a 6.5 t
 * truck answers the wheel FASTER than a 1.4 t supercar because its yaw inertia is whatever the hull implies.
 */
export interface VehicleMassProperties {
  /** `CentreOfMass` in MODEL space (m): x right, y forward, z up — the frame the chassis already uses. */
  readonly centreOfMass: readonly [number, number, number];
  /** `fMass` (kg). */
  readonly mass: number;
  /** The car's own springs (`fSuspension*`) — every car shared one set until plan 081/02 §3. */
  readonly suspension: VehicleSuspensionSpec;
  /** The car's own tyres (`fTraction*`) — every car shared one grip constant until plan 081/05. */
  readonly traction: VehicleTractionSpec;
  /** `fTurnMass` (kg·m²) — the yaw inertia, the only one SA authors. */
  readonly turnMass: number;
}

/**
 * One wheel's SPRING SETUP, as the controller holds it (plan 081/02).
 *
 * Constant for the life of a car, so it is read once per capture rather than per frame — and it exists
 * because a run that cannot say what it was configured with cannot be trusted to have applied a change. An
 * in-game A/B of the suspension was abandoned for exactly that reason: single-variable probes disagreed with
 * the whole set, and nothing in the record could tell which run had actually taken effect.
 */
export interface VehicleSpringReading {
  /** Compression damping. */
  readonly compression: number;
  /** Force cap (N). */
  readonly maxForce: number;
  /** Rebound damping. */
  readonly relaxation: number;
  /** Spring rest length (m). */
  readonly restLength: number;
  /** Spring rate. */
  readonly stiffness: number;
  /** Maximum travel (m). */
  readonly travel: number;
}

/**
 * What a car is STANDING on, read once after it has settled (plan 081/05).
 *
 * It exists because of a failure mode nothing else in a capture reveals: a car resting partly on its own
 * COLLISION HULL instead of on its wheels. Its springs simply read light, and since tyre grip is `μ × the
 * load the corner carries`, its wheels quietly stop steering, driving and braking — the car reads as "heavy"
 * and refuses to turn, at any speed, with every other channel looking normal.
 */
export interface VehicleStance {
  /** Chassis mass (kg), as the solver holds it. */
  readonly mass: number;
  /** The share of the car's weight its springs carry. **Below 1 means something else is holding it up.** */
  readonly weightOnGround: number;
  readonly wheels: readonly {
    readonly contact: boolean;
    /** Suspension force this corner carries (N). */
    readonly load: number;
    readonly radius: number;
    readonly restLength: number;
    readonly suspensionLength: number;
  }[];
}

/**
 * A car's authored suspension (plan 081/02 §3).
 *
 * The shared constants it replaces were tuned in-browser on a ~1500 kg sedan, so they stay as the REFERENCE
 * POINT: a mid-range row lands on the numbers already proven to work, and everything else scales from there.
 */
export interface VehicleSuspensionSpec {
  /** `fSuspensionBiasBetweenFrontAndRear`, 0..1 — the front axle's share. The original turns it into a
   *  factor of `2 × bias` on the front springs and `2 − 2 × bias` on the rear (`ProcessCarWheelPair`), so
   *  0.5 is neutral and a car authored nose-heavy carries a stiffer front. */
  readonly bias: number;
  /** `fSuspensionDampingLevel` — scales both damping terms about their tuned reference. */
  readonly damping: number;
  /** `fSuspensionForceLevel` — the spring-rate scale, on top of the mass normalisation. */
  readonly force: number;
  /** How far the wheel hangs below its hub at full extension (m): SA's |lower limit|. */
  readonly restLength: number;
  /** How far the spring may compress from rest (m): SA's upper limit. */
  readonly travel: number;
}

/** A car's authored tyre grip (plan 081/05). */
export interface VehicleTractionSpec {
  /** `fTractionBias`, 0..1 — the front axle's share, applied as `2 × bias` front and `2 − 2 × bias` rear. */
  readonly bias: number;
  /** `fTractionLoss`, 0..1 — what a wheel's grip drops to ONCE IT HAS BROKEN LOOSE (0.72…0.85 on cars). */
  readonly loss: number;
  /** `fTractionMultiplier` — the friction coefficient itself. */
  readonly mult: number;
}

/** One wheel's live state, as {@link PhysicsWorld.readVehicleWheels} reads it off the controller. */
export interface VehicleWheelReading {
  readonly contact: boolean;
  /** Tyre force along the wheel this step (Rapier impulse) — drive/brake grip actually delivered. */
  readonly forwardImpulse: number;
  /** Max suspension travel (m) — the denominator when travel is expressed as a compression fraction. */
  readonly maxTravel: number;
  /** Rolling radius (m). */
  readonly radius: number;
  /** Spring rest length (m) — a wheel at rest length is fully extended. */
  readonly restLength: number;
  /** CUMULATIVE roll angle (rad). Rapier accumulates it without wrapping, so its delta is the wheel's spin. */
  readonly rotation: number;
  /** Tyre force across the wheel — cornering grip actually delivered. */
  readonly sideImpulse: number;
  /** Suspension force carried (N) — the corner's normal load. */
  readonly suspensionForce: number;
  /** Current spring length (m); shorter than {@link restLength} means compressed. */
  readonly suspensionLength: number;
}

/** One wheel's demand-over-cap record (089/02) — see {@link PhysicsWorld.readVehicleWheelSlip}. */
export interface VehicleWheelSlip {
  /** How far the brake demand exceeded the tyre's cap (0 = gripping; the handbrake reads exactly 1). */
  readonly brakeExcess: number;
  /** How far the engine's force exceeded the tyre's cap — wheelspin surplus (0 = gripping). */
  readonly spinExcess: number;
}

/** One raycast wheel: its hub position in vehicle space + rolling radius. */
export interface VehicleWheelSpec {
  connection: Vec3;
  /** Front axle? The caller has always known; the springs are the first consumer (the authored axle bias). */
  front: boolean;
  radius: number;
}

type Quat = [number, number, number, number];
type RapierBody = ReturnType<RapierWorld['createRigidBody']>;

type RapierWorld = InstanceType<Rapier['World']>;

/**
 * Thin wrapper over a Rapier world (GTA Z-up). Creates dynamic/static box bodies
 * and reads body transforms back for the ECS. Bodies are addressed by their
 * integer handle, which the `RigidBody` component stores per entity.
 */
export class PhysicsWorld {
  /** The live air-control dial (plan 081/06 §1) — `?airCtl=<×>`, 1 being the original's own strength. It
   *  lives beside the other two vehicle dials so a session tunes them in one place, and every capture reads
   *  them from one place. */
  private airControl = { scale: AIR_CONTROL_SCALE };
  /** Contact-force impacts for the breakable trigger (drained by {@link takeBreakableImpacts}). */
  private breakableImpacts: Impact[] = [];
  private readonly events: InstanceType<Rapier['EventQueue']>;
  /** Contact-force impacts collected during the last {@link step} (drained by {@link takeImpacts}). */
  private impacts: Impact[] = [];
  /** Where {@link step} currently is. A Rapier panic aborts wasm with a bare `unreachable` — no message and
   *  no JS frame — so without this a crash inside the step cannot be attributed to a phase at all. */
  private phase = 'idle';
  private readonly rapier: Rapier;
  /** Messages already said out loud (see {@link reportOnce}). */
  private readonly reported = new Set<string>();
  /** The live speed-grip dials (plan 081/09) — session-tunable, recorded by every capture. */
  private speedGrip = { cap: SPEED_GRIP_CAP, reference: SPEED_GRIP_REFERENCE };
  private surfaceGrip = true;
  /** What each collider is MADE OF (plan 081/10): the SA surface id per triangle for a trimesh, or one id
   *  for a box/sphere. Keyed by collider handle, cleared with the body in {@link removeBodies}. */
  private readonly surfaces = new Map<number, number | Uint8Array>();
  /** What a tyre grips on each collision material (plan 081/10 step 5), and the road cell everything is
   *  expressed against. Null until the world hands them over — and then the tyre keeps its authored grip
   *  everywhere, exactly as it did before this step. `surfaceGrip` is the field's on/off dial (`?surfGrip`). */
  private tyreAdhesion: null | { perMaterial: Float32Array; road: number } = null;
  /** The chassis body handle of every LIVE raycast vehicle → its controller.
   *
   *  A car's chassis removed by a path that never touched its controller leaves that controller reading
   *  FREED wasm memory. {@link removeBodies} checks this map for exactly that, because the corpse does not
   *  announce itself: it reads back as all-NaN. (Rapier handles DO carry a generation — measured: remove a
   *  body, create another, and the new one gets a different bit pattern — so a stale handle does not resolve
   *  to a fresh body. That makes this guard about ORDER within one despawn, not about handle reuse.) */
  private readonly vehicleChassis = new Map<number, VehicleController>();
  /** Every LIVE controller, against the chassis handle it was created with. This is the liveness record
   *  {@link removeVehicle} tests to stay idempotent — a controller missing from it has already been removed
   *  and must never be freed a second time. */
  private readonly vehicleChassisAtBirth = new Map<VehicleController, number>();
  /** Raycast vehicle controllers, advanced before each {@link step}. */
  private readonly vehicles: VehicleController[] = [];
  /** What the raycast vehicle controllers cost in the last {@link step} (ms), READ ONCE: the vehicle half
   *  of the fixed step, which `physicsMs` lumps in with the solver (081/07 §3). Taking it zeroes it, so a
   *  step that never ran (paused, or a menu frame) cannot report the previous step's cost again. */
  private vehicleStepMs = 0;
  /** Per-controller demand-over-cap records (089/02), written by {@link setVehicleControls} each step. */
  private readonly wheelSlip = new WeakMap<VehicleController, Float32Array>();
  private readonly world: RapierWorld;

  constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: 0, z: GRAVITY_Z });
    this.events = new rapier.EventQueue(true);
  }

  /** The active air-control dial — read by the F2 tab and by every `[phys]` capture (self-description). */
  airControlTuning(): { scale: number } {
    return { ...this.airControl };
  }

  /**
   * A RESUMABLE static-collider build (plan 200/3-02).
   *
   * One cell's bodies measured **5.6–28.1 ms** built in a single call (plan 091), which is a frame the player
   * feels. This hands the caller the same work as {@link PhysicsWorld.createStaticColliders} split into
   * budgeted slices, exactly as the texture upload was split when it stalled a frame at 15–85 ms.
   *
   * The build owns `handles`, so a caller that abandons it mid-way removes precisely the bodies it created —
   * a partially built cell must leave nothing behind.
   */
  beginStaticColliders(
    models: readonly ModelColliders[],
    onBreakable?: (key: string, handle: number) => void,
  ): StaticColliderBuild {
    const translation = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const handles: number[] = [];
    let model = 0;
    let placement = 0;

    return {
      handles,
      step: (budgetMs: number): boolean => {
        const started = performance.now();
        while (model < models.length) {
          const entry = models[model];
          if (placement >= entry.transforms.length) {
            model += 1;
            placement = 0;
            continue;
          }
          const matrix = entry.transforms[placement];
          matrix.decompose(translation, rotation, scale);
          const body = this.world.createRigidBody(
            this.rapier.RigidBodyDesc.fixed()
              .setTranslation(translation.x, translation.y, translation.z)
              .setRotation({ w: rotation.w, x: rotation.x, y: rotation.y, z: rotation.z }),
          );
          if (this.addShapes(body, entry.shape) > 0) {
            handles.push(body.handle);
            const key = entry.instanceKeys?.[placement];
            if (key !== undefined) {
              onBreakable?.(key, body.handle);
            }
          } else {
            this.world.removeRigidBody(body); // no usable shape — don't keep an empty body
          }
          placement += 1;
          // Checked AFTER a body, never before: a zero budget must still make progress, or a cell that never
          // finishes is a cell the player never gets collision for.
          if (performance.now() - started >= budgetMs) {
            return model >= models.length;
          }
        }

        return true;
      },
    };
  }

  /** What the solver is actually chewing on — a stall needs a count, not a guess. */
  census(): { bodies: number; colliders: number; vehicles: number } {
    return { bodies: this.world.bodies.len(), colliders: this.world.colliders.len(), vehicles: this.vehicles.length };
  }

  /** A dynamic box (half-extents) at a Z-up position; returns its body handle. */
  createBox(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(...position));
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents), body);

    return body.handle;
  }

  /** A dynamic character box: rotations locked (stays upright) + high friction. */
  createCharacterBody(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .lockRotations(),
    );
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents).setFriction(1), body);

    return body.handle;
  }

  /**
   * Create a kinematic character controller (Z-up) configured for sliding,
   * auto-stepping kerbs/stairs, snapping to ground, and a climbable slope limit.
   */
  createCharacterController(
    offset = CONTROLLER_OFFSET,
    options: { autostep?: boolean; snap?: boolean } = {},
  ): CharacterController {
    const controller = this.world.createCharacterController(offset);
    controller.setUp({ x: 0, y: 0, z: 1 }); // world is Z-up (default is Y-up)
    controller.setSlideEnabled(true);
    if (options.autostep ?? true) {
      controller.enableAutostep(STEP_HEIGHT, STEP_MIN_WIDTH, true);
    }
    if (options.snap ?? true) {
      controller.enableSnapToGround(SNAP_DISTANCE);
    }
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB);
    controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE);
    controller.setApplyImpulsesToDynamicBodies(true);

    return controller;
  }

  /**
   * A **dynamic** vehicle (Z-up) at a position + heading — a GTA-style raycast
   * car. The chassis collider is built from the **model's COL spheres + boxes**
   * (the convex primitives GTA itself uses for the car body; they hug the contour
   * — low hood, high cabin — and collide with the static world trimesh, which a
   * concave trimesh can't). The COL trimesh is skipped here (trimesh-vs-trimesh
   * generates no contacts) but kept by the caller for damage; a convex hull of the
   * vertices is the fallback when a COL has no primitives, then a `halfExtents`
   * box when there's no usable hull either (e.g. a modded DFF with no embedded
   * collision). Gravity + four suspension-raycast wheels rest it on its wheels and
   * collide it with the world; the returned controller drives it (engine/brake/steer).
   */
  createDynamicVehicle(
    position: Vec3,
    heading: number,
    shape: ModelColliders['shape'] | null,
    properties: VehicleMassProperties,
    wheels: readonly VehicleWheelSpec[],
    halfExtents: [number, number, number],
    pitch = 0,
  ): { body: number; controller: VehicleController; wheelLift: readonly number[] } {
    // `pitch` (about the body's LOCAL right axis, nose-up positive) aligns a spawn to a sloped street —
    // a horizontal spawn at a slope break drops nose-first and the parking brake freezes it on its snout
    // (074 bench road cars). Applied AFTER the yaw, in the body frame.
    const q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), heading)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
    // No CCD: on the detailed streamed world trimesh it sweeps the body's leading (front) edge
    // and catches on triangle seams → a launch "pop from the front". The chassis spheres are big
    // and the per-step motion is small, so it can't tunnel anyway.
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .setRotation({ w: q.w, x: q.x, y: q.y, z: q.z })
        .setLinearDamping(CHASSIS_LINEAR_DAMPING)
        .setAngularDamping(CHASSIS_ANGULAR_DAMPING)
        // The AUTHORED mass properties (plan 081/02), set on the DESCRIPTOR. On the body it is a no-op that
        // leaves the car massless — with zero-mass colliders the total came out 0 and nothing fell. So the
        // body is BORN with `handling.cfg`'s mass, its designed centre of mass, and an inertia tensor whose
        // yaw term is `fTurnMass`; the colliders that follow carry shape only.
        .setAdditionalMassProperties(
          properties.mass,
          { x: properties.centreOfMass[0], y: properties.centreOfMass[1], z: properties.centreOfMass[2] },
          principalInertia(properties, halfExtents),
          { w: 1, x: 0, y: 0, z: 0 }, // the principal axes ARE the model axes: a car is symmetric about them
        )
        // Never sleep: a sleeping chassis stops getting suspension forces and slowly sinks into
        // the collision; the first throttle then wakes it and the penetration ejects it ("launch
        // pop" only on the first drive after parking). Keeping it awake holds it on its wheels.
        .setCanSleep(false),
    );
    this.addVehicleHull(body, shape, halfExtents);
    // **A car is born MASSLESS.** Rapier folds a descriptor's mass properties (and its colliders' own
    // contributions) into the body only at the NEXT `world.step` — until then `mass()` reads 0 and the
    // inertia tensor is all zeros. Our step runs `updateVehicle` BEFORE `world.step`, so a car spawned
    // between two steps — which is every streamed car in a moving world — has its first suspension solved
    // against a body with no mass and no inertia, and comes back all-NaN. The NaN then reaches Rapier's own
    // tree walk and panics wasm with a bare `unreachable`, which leaves the body set borrowed for good and
    // kills the session with "recursive use of an object" from whichever innocent reader touches it next
    // (`docs/open-issues/fixed/map-car-generators-poison-physics.md`). Doing the recompute HERE is Rapier's own
    // documented remedy, and it is the only moment where the car is not yet in the step list.
    body.recomputeMassPropertiesFromColliders();

    const controller = this.world.createVehicleController(body);
    controller.indexUpAxis = UP_AXIS;
    controller.setIndexForwardAxis = FORWARD_AXIS;
    const loads = staticWheelLoads(wheels, properties);
    const springs = wheels.map((wheel, i) => suspensionSetup(properties, wheel.front, loads[i]));
    // How far each connection is raised above the model hub. The DRAWN wheel needs it too: its live offset
    // from the hub is `lift − suspensionLength` (the rig's travel channel, plan 081/06 §3).
    const wheelLift = springs.map((spring) => spring.restLength - spring.sag + spring.hubOffset);
    wheels.forEach((wheel, i) => {
      const spring = springs[i];
      const [x, y, z] = wheel.connection;
      // Raised by the rest length MINUS the static sag, PLUS the standing pose the original computes: the
      // wheel rests `hubOffset` from the model hub when the car is STANDING (081/03 §1 put it AT the hub —
      // that pinned every car's body low by |hubOffset|, see `suspensionSetup`; the 2026-07-27 audit moved
      // the pose to SA's own law, and the drawn wheel now follows the physics instead of the dummy).
      controller.addWheel(
        { x, y, z: z + wheelLift[i] },
        { x: 0, y: 0, z: -1 },
        { x: 1, y: 0, z: 0 },
        spring.restLength,
        wheel.radius,
      );
      controller.setWheelSuspensionStiffness(i, spring.stiffness);
      controller.setWheelSuspensionCompression(i, spring.compression);
      controller.setWheelSuspensionRelaxation(i, spring.relaxation);
      controller.setWheelMaxSuspensionTravel(i, spring.travel);
      controller.setWheelMaxSuspensionForce(i, spring.maxForce);
      controller.setWheelFrictionSlip(i, tyreGrip(properties.traction, wheel.front));
      controller.setWheelBrake(i, PARKING_BRAKE); // parked until a driver throttles
    });
    this.vehicles.push(controller);
    this.vehicleChassis.set(body.handle, controller);
    this.vehicleChassisAtBirth.set(controller, body.handle);

    return { body: body.handle, controller, wheelLift };
  }

  /**
   * A knocked-over prop (074/08 B7·a): a dynamic box that keeps the prop's placed heading, falls under
   * gravity, lands on the world — and passes THROUGH vehicles (see {@link PROP_GROUPS}).
   */
  createFalling(
    position: Vec3,
    rotation: Quat,
    mass: number,
    /** The prop's own vertices (MODEL space) — the collider is its convex hull, not a bounding box. */
    hull: Float32Array,
    /** Box fallback (centre + half extents, model space) for a mesh Rapier cannot hull. */
    box: { centre: Vec3; half: Vec3 },
  ): number {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        // Without the placed heading, a lamppost standing at an angle snaps upright the instant it becomes
        // a body.
        .setRotation({ w: rotation[3], x: rotation[0], y: rotation[1], z: rotation[2] }),
    );
    // A CONVEX HULL, because a bounding box lies: a lamppost's arm makes its box 2.8 m wide, so the box came
    // to rest on that phantom face and left the actual pole hanging in the air. The hull is the shape you see.
    //
    // The fallback needs BOTH guards, exactly like `addConvexChassis`: `convexHull` returns a non-null but
    // INVALID descriptor for degenerate input, so `?? box` never fires and `createCollider` throws instead —
    // a prop whose mesh cannot be hulled took the frame down rather than falling back (found by plan 077).
    const finish = (desc: ReturnType<Rapier['ColliderDesc']['cuboid']>): ReturnType<Rapier['ColliderDesc']['cuboid']> =>
      desc.setMass(mass).setCollisionGroups(PROP_GROUPS);
    const desc = hull.length >= 12 ? this.rapier.ColliderDesc.convexHull(hull) : null;
    if (desc) {
      try {
        this.world.createCollider(finish(desc), body);

        return body.handle;
      } catch {
        // degenerate vertices: convexHull yielded an invalid desc — fall through to the box.
      }
    }
    this.world.createCollider(finish(this.rapier.ColliderDesc.cuboid(...box.half).setTranslation(...box.centre)), body);

    return body.handle;
  }

  /**
   * A kinematic, position-based **capsule** body (Z-aligned) at a Z-up position —
   * the player's movement collider. Returns the body + collider handles. Kinematic
   * bodies ignore world gravity; the caller integrates it and drives the body via
   * {@link moveCharacter}.
   */
  createKinematicCapsule(position: Vec3, radius: number, halfHeight: number): { body: number; collider: number } {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(...position),
    );
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.capsule(halfHeight, radius).setRotation({
        w: CAPSULE_UPRIGHT[3],
        x: CAPSULE_UPRIGHT[0],
        y: CAPSULE_UPRIGHT[1],
        z: CAPSULE_UPRIGHT[2],
      }),
      body,
    );

    return { body: body.handle, collider: collider.handle };
  }

  /** A fixed (static) box, e.g. a temporary ground; returns its body handle. */
  createStaticBox(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(...position));
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents), body);

    return body.handle;
  }

  /**
   * Build static colliders for the bound map collision: one fixed body per
   * placement (Z-up translation + rotation decomposed from its matrix) carrying
   * the model's trimesh + box + sphere shapes (model space). Returns the created
   * body **handles** (for {@link removeBodies} when a cell unloads); placements
   * whose shapes were all degenerate create no body. `onBreakable` (plan 045) is
   * called with each created breakable-prop body's instance key + handle, so the
   * caller can drop that one body when the prop is smashed.
   */
  createStaticColliders(
    models: readonly ModelColliders[],
    onBreakable?: (key: string, handle: number) => void,
  ): number[] {
    // Drained in place: every caller that wants the whole cell NOW (tests, the map viewer) keeps its old
    // behaviour, and the budgeted path is opt-in — the same shape as `uploadOstexTexture` over
    // `beginOstexUpload`.
    const build = this.beginStaticColliders(models, onBreakable);
    while (!build.step(Infinity)) {
      // one slice is the whole build at an infinite budget
    }

    return build.handles;
  }

  dispose(): void {
    this.world.free();
  }

  /** Angular velocity of a body (world, rad/s, Z-up). */
  getAngvel(handle: number): Vec3 {
    const w = this.world.getRigidBody(handle).angvel();

    return [w.x, w.y, w.z];
  }

  /** Linear velocity of a body (Z-up). */
  getLinvel(handle: number): Vec3 {
    const v = this.world.getRigidBody(handle).linvel();

    return [v.x, v.y, v.z];
  }

  /** Z of the nearest collision directly below `position` (within `maxDrop`), or null if none — for dropping the
   *  fly-mode player back onto the ground beneath them. `excludeBody` skips a body (e.g. the caster's own
   *  capsule, so the ray can start at the body centre instead of under thin road shells). */
  groundBelow(position: Vec3, maxDrop: number, excludeBody?: number): null | number {
    const ray = new this.rapier.Ray({ x: position[0], y: position[1], z: position[2] }, { x: 0, y: 0, z: -1 });
    const exclude = excludeBody === undefined ? undefined : this.world.getRigidBody(excludeBody);
    const hit = this.world.castRay(ray, maxDrop, true, undefined, undefined, undefined, exclude);

    return hit ? position[2] - hit.timeOfImpact : null;
  }

  /** Surface normal of the nearest collision directly below `position` (within `maxDrop`), or null —
   *  the slope-slide state reads the ground steepness from it (plan 088/08). */
  groundNormalBelow(position: Vec3, maxDrop: number, excludeBody?: number): null | Vec3 {
    const ray = new this.rapier.Ray({ x: position[0], y: position[1], z: position[2] }, { x: 0, y: 0, z: -1 });
    const exclude = excludeBody === undefined ? undefined : this.world.getRigidBody(excludeBody);
    const hit = this.world.castRayAndGetNormal(ray, maxDrop, true, undefined, undefined, undefined, exclude);

    return hit ? [hit.normal.x, hit.normal.y, hit.normal.z] : null;
  }

  /**
   * Pin a (dynamic) body at a fixed transform with zero velocity — used to hold a parked
   * car perfectly still while the player slides in/out, so the kinematic rider can't shove it.
   */
  holdBody(handle: number, position: Vec3, quaternion: Quat): void {
    assertFinite('holdBody', {
      'position.x': position[0],
      'position.y': position[1],
      'position.z': position[2],
      'quaternion.w': quaternion[3],
      'quaternion.x': quaternion[0],
      'quaternion.y': quaternion[1],
      'quaternion.z': quaternion[2],
    });
    const body = this.world.getRigidBody(handle);
    body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    body.setRotation({ w: quaternion[3], x: quaternion[0], y: quaternion[1], z: quaternion[2] }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Make the player's collider ignore (or again collide with) vehicle chassis. Used
   * while entering/seated so climbing into the dynamic car doesn't shove it; restored
   * on foot so the player can stand on / bump a car.
   */
  ignoreVehicles(colliderHandle: number, ignore: boolean): void {
    const groups = ignore ? PLAYER_GROUPS_IGNORE_VEHICLES : PLAYER_GROUPS_DEFAULT;
    this.world.getCollider(colliderHandle).setCollisionGroups(groups);
  }

  /** True if a downward ray from the body hits something within half-height (+ ε). */
  isGrounded(handle: number, halfHeight: number): boolean {
    const body = this.world.getRigidBody(handle);
    const p = body.translation();
    const ray = new this.rapier.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: -1 });
    const hit = this.world.castRay(ray, halfHeight + GROUND_EPSILON, true, undefined, undefined, undefined, body);

    return hit !== null;
  }

  /**
   * Advance a kinematic capsule one step: ask the controller for the
   * collision-corrected movement for `desired` (slides along obstacles, climbs
   * steps, snaps to ground), queue it as the body's next translation, and return
   * the applied movement + whether the character ended up grounded.
   */
  moveCharacter(controller: CharacterController, body: number, collider: number, desired: Vec3): CharacterMove {
    const rigidBody = this.world.getRigidBody(body);
    controller.computeColliderMovement(this.world.getCollider(collider), {
      x: desired[0],
      y: desired[1],
      z: desired[2],
    });
    const m = controller.computedMovement();
    const p = rigidBody.translation();
    rigidBody.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });

    return { grounded: controller.computedGrounded(), movement: [m.x, m.y, m.z] };
  }

  /**
   * True when a heading-aligned box at `position` overlaps ANY collider (074 bench road cars): the
   * pre-spawn "is this spot free" probe. A car spawned intersecting a lamp post or another car is ejected
   * by the solver and lands on its roof — the caller tests before creating the body and slides the spot.
   */
  overlapsBox(position: Vec3, heading: number, halfExtents: Vec3): boolean {
    const shape = new this.rapier.Cuboid(halfExtents[0], halfExtents[1], halfExtents[2]);
    const rotation = { w: Math.cos(heading / 2), x: 0, y: 0, z: Math.sin(heading / 2) };

    return (
      this.world.intersectionWithShape({ x: position[0], y: position[1], z: position[2] }, rotation, shape) !== null
    );
  }

  /** Re-park a vehicle: engine off, wheels straight, parking brake on all wheels. */
  parkVehicle(controller: VehicleController): void {
    const count = controller.numWheels();
    for (let i = 0; i < count; i += 1) {
      controller.setWheelEngineForce(i, 0);
      controller.setWheelBrake(i, PARKING_BRAKE);
      controller.setWheelSteering(i, 0);
    }
  }

  /**
   * True when the straight line `from → to` hits nothing solid (plan 088/09d): the exit sequence
   * probes each egress spot with it — a wall/car inside the ray means that door is blocked, try the
   * next one. `excludeBody` skips the probing car itself (the ray starts inside its chassis);
   * sensors are ignored (the seated rider's capsule IS a sensor and sits exactly at the origin).
   */
  pathClear(from: Vec3, to: Vec3, excludeBody?: number, excludeCollider?: number): boolean {
    const direction = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (length === 0) {
      return true;
    }
    const ray = new this.rapier.Ray(
      { x: from[0], y: from[1], z: from[2] },
      { x: direction[0] / length, y: direction[1] / length, z: direction[2] / length },
    );
    const excludeB = excludeBody === undefined ? undefined : this.world.getRigidBody(excludeBody);
    const excludeC = excludeCollider === undefined ? undefined : this.world.getCollider(excludeCollider);
    const hit = this.world.castRay(
      ray,
      length,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      excludeC,
      excludeB,
    );

    return hit === null;
  }

  /** Set a body's linear velocity (Z-up). */
  /** Spin a dynamic body — a toppling prop is knocked over about a hinge rather than shoved sideways. */
  /**
   * Push a body through its centre of mass — no torque, just a change of velocity.
   *
   * An impulse rather than a force because Rapier keeps added FORCES until they are explicitly reset, while
   * impulses are consumed by the step that follows. A per-step aerodynamic drag written with `addForce` would
   * therefore accumulate into an ever-growing headwind.
   */
  push(handle: number, impulse: Vec3): void {
    assertFinite('push', { 'impulse.x': impulse[0], 'impulse.y': impulse[1], 'impulse.z': impulse[2] });
    this.world.getRigidBody(handle).applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
  }

  /**
   * Shove a dynamic body at a POINT (world space) — the honest way to knock a prop over.
   *
   * Spinning it about its own centre instead drives the bottom half of a tall body straight into the ground:
   * an 8 m lamppost given an angular velocity buries its base, the solver ejects it, and the pole rockets off.
   * A push high up lets the GROUND be the pivot, which is what topples a real post.
   */
  pushAt(handle: number, impulse: Vec3, point: Vec3): void {
    assertFinite('pushAt', {
      'impulse.x': impulse[0],
      'impulse.y': impulse[1],
      'impulse.z': impulse[2],
      'point.x': point[0],
      'point.y': point[1],
      'point.z': point[2],
    });
    this.world
      .getRigidBody(handle)
      .applyImpulseAtPoint(
        { x: impulse[0], y: impulse[1], z: impulse[2] },
        { x: point[0], y: point[1], z: point[2] },
        true,
      );
  }

  /**
   * Distance to the first solid hit along `dir` from `origin`, within `maxDist`, or null (Z-up). The camera
   * collision layer (plan 080/04) casts against the ONE Rapier world, so streamed static geometry AND dynamic
   * bodies (cars, props) occlude for free. `exclude` skips a body — the camera must not collide with its own
   * subject (the player capsule / the seated car). Sensors are ignored (the seated rider's capsule is one).
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, exclude?: number): null | { dist: number } {
    const length = Math.hypot(dir[0], dir[1], dir[2]);
    if (length === 0) {
      return null;
    }
    const ray = new this.rapier.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0] / length, y: dir[1] / length, z: dir[2] / length },
    );
    const excludeBody = exclude === undefined ? undefined : this.world.getRigidBody(exclude);
    const hit = this.world.castRay(
      ray,
      maxDist,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      excludeBody,
    );

    return hit === null ? null : { dist: hit.timeOfImpact };
  }

  readBody(handle: number): BodyTransform {
    const body = this.world.getRigidBody(handle);
    const t = body.translation();
    const r = body.rotation();

    return { position: [t.x, t.y, t.z], quaternion: [r.x, r.y, r.z, r.w] };
  }

  /**
   * A body's live mass properties: total mass and the WORLD-space centre of mass (plan 081/02).
   *
   * Read-only, and the only way to see from outside whether the authored centre of mass actually reached
   * the body — which is the whole of this plan. The F2 Physics tab shows it next to the telemetry so a
   * field round can tell "the car feels planted" from "the number moved".
   *
   * **Reads what the last step computed.** Rapier folds a body's authored mass properties in during
   * `world.step()`, so a body queried before its first step reports mass 0 and a centre of mass at its
   * origin — which looks exactly like the properties having failed to apply, and cost an hour of chasing it.
   */
  readMassProperties(handle: number): { centreOfMass: Vec3; mass: number } {
    const body = this.world.getRigidBody(handle);
    const com = body.worldCom();

    return { centreOfMass: [com.x, com.y, com.z], mass: body.mass() };
  }

  /**
   * Read every wheel's live state off a raycast controller (plan 081/01 telemetry) — contact, spring travel,
   * normal load, the tyre impulses actually delivered, and the CUMULATIVE roll angle whose delta is the wheel's
   * spin. Read-only: this is the instrument, it changes nothing.
   *
   * Rapier returns `null` for an out-of-range wheel index; nothing here can be out of range (the count comes
   * from the controller itself), so the nullish fallbacks are just the type boundary.
   */
  /** Every wheel's spring setup — what the controller was actually configured with. See the type. */
  readVehicleSprings(controller: VehicleController): readonly VehicleSpringReading[] {
    const springs: VehicleSpringReading[] = [];
    for (let i = 0; i < controller.numWheels(); i += 1) {
      springs.push({
        compression: controller.wheelSuspensionCompression(i) ?? 0,
        maxForce: controller.wheelMaxSuspensionForce(i) ?? 0,
        relaxation: controller.wheelSuspensionRelaxation(i) ?? 0,
        restLength: controller.wheelSuspensionRestLength(i) ?? 0,
        stiffness: controller.wheelSuspensionStiffness(i) ?? 0,
        travel: controller.wheelMaxSuspensionTravel(i) ?? 0,
      });
    }

    return springs;
  }

  /**
   * The tyre adhesion under each wheel (plan 081/10 step 5) — SA's absolute cell: 4.5 on tarmac, 3.2 on
   * grass and dirt, 3.0 on sand, 2.8 when wet. Falls back to the ROAD value for a wheel in the air, for
   * ground with no material, and whenever the table or the dial is off, so a caller never has to branch: an
   * unknown surface simply drives like tarmac, which is what it did before this step existed.
   */
  readVehicleWheelAdhesion(controller: VehicleController, chassisBody: number): readonly number[] {
    const table = this.surfaceGrip ? this.tyreAdhesion : null;
    if (table === null) {
      return Array.from({ length: controller.numWheels() }, () => ROAD_ADHESION);
    }

    return this.readVehicleWheelSurfaces(controller, chassisBody).map((surface) =>
      surface === null ? table.road : (table.perMaterial[surface] ?? table.road),
    );
  }

  readVehicleWheels(controller: VehicleController): readonly VehicleWheelReading[] {
    const readings: VehicleWheelReading[] = [];
    for (let i = 0; i < controller.numWheels(); i += 1) {
      readings.push({
        contact: controller.wheelIsInContact(i),
        forwardImpulse: controller.wheelForwardImpulse(i) ?? 0,
        maxTravel: controller.wheelMaxSuspensionTravel(i) ?? 0,
        radius: controller.wheelRadius(i) ?? 0,
        restLength: controller.wheelSuspensionRestLength(i) ?? 0,
        rotation: controller.wheelRotation(i) ?? 0,
        sideImpulse: controller.wheelSideImpulse(i) ?? 0,
        suspensionForce: controller.wheelSuspensionForce(i) ?? 0,
        suspensionLength: controller.wheelSuspensionLength(i) ?? 0,
      });
    }

    return readings;
  }

  /**
   * How far past its tyre this step's DEMAND went, per wheel (089/02 tyre smoke) — recorded by
   * {@link setVehicleControls} at the only moment the caps are known. `brakeExcess` > 0 means the pedal (or
   * the handbrake, which reads exactly 1) asked for more impulse than the tyre could give — SA's locked
   * wheel; `spinExcess` > 0 means the engine force was clamped by the tyre — wheelspin. Null before the
   * first controls application (a parked, never-driven car).
   */
  readVehicleWheelSlip(controller: VehicleController): null | readonly VehicleWheelSlip[] {
    const stored = this.wheelSlip.get(controller);
    if (!stored) {
      return null;
    }
    const slips: VehicleWheelSlip[] = [];
    for (let i = 0; i * 2 < stored.length; i += 1) {
      slips.push({ brakeExcess: stored[i * 2], spinExcess: stored[i * 2 + 1] });
    }

    return slips;
  }

  /**
   * The SA surface id under each wheel (plan 081/10 step 4) — `null` for a wheel in the air, or on ground
   * whose collision carries no material.
   *
   * DRCVC does not report what its OWN suspension ray hit, so this re-casts a short one from just above the
   * contact point it does report — the cheapest place to ask, since the point is already computed. One ray
   * per wheel IN CONTACT: an airborne wheel costs nothing. Priced in 081/07 §3 — four rays are the same
   * order as the whole controller update, so this belongs on the driven car, not on all eighty.
   */
  readVehicleWheelSurfaces(controller: VehicleController, chassisBody: number): readonly (null | number)[] {
    const surfaces: (null | number)[] = [];
    for (let i = 0; i < controller.numWheels(); i += 1) {
      const point = controller.wheelIsInContact(i) ? controller.wheelContactPoint(i) : null;
      surfaces.push(
        point === null ? null : this.surfaceBelow([point.x, point.y, point.z + PROBE_LIFT], PROBE_REACH, chassisBody),
      );
    }

    return surfaces;
  }

  /** Remove static bodies (and their colliders) by handle — e.g. when a cell unloads. */
  removeBodies(handles: readonly number[]): void {
    for (const handle of handles) {
      // Removing a LIVE car's chassis here is always a bug: the only legitimate route is `despawn`, which
      // drops the controller first. Reached any other way (a stale handle Rapier has since re-issued to a
      // car is the way it happens) the controller survives its body and reads freed wasm memory from then
      // on — all-NaN, garbage handle, and a `unreachable` panic that poisons the whole world. Refusing the
      // removal keeps the car and the world intact; the report carries the caller's stack.
      if (this.vehicleChassis.has(handle)) {
        // eslint-disable-next-line no-console -- a car deleted out from under its controller is unrecoverable
        console.error(new Error(`physics: refused to remove body ${handle} — it is a LIVE vehicle chassis`));
        continue;
      }
      const body = this.world.getRigidBody(handle);
      // Drop the surface entries with the colliders themselves — Rapier reuses handles, so a stale entry
      // would answer for whatever is created next, and a streaming world creates constantly.
      for (let i = 0; i < body.numColliders(); i += 1) {
        this.surfaces.delete(body.collider(i).handle);
      }
      this.world.removeRigidBody(body);
    }
  }

  /**
   * Remove a raycast vehicle's controller so it is no longer stepped — call this
   * BEFORE removing its chassis body, or {@link step}'s `updateVehicle` panics on
   * the orphaned controller.
   */
  removeVehicle(controller: VehicleController): void {
    // IDEMPOTENT, and that is the point. The previous version skipped the array splice on a second call but
    // still handed the controller to `removeVehicleController` — freeing an already-freed wasm object. A
    // double free does not throw: it corrupts Rapier's own bookkeeping, after which OTHER controllers' JS
    // wrappers start reading garbage (a stable denormal handle, all-NaN pose) and `world.step` eventually
    // panics `unreachable` while walking a structure that no longer makes sense. Cause and crash are then
    // arbitrarily far apart. The birth record IS the liveness record, so a controller missing from it has
    // already been removed and must not be freed twice.
    if (!this.vehicleChassisAtBirth.has(controller)) {
      this.reportOnce('physics: removeVehicle called AGAIN for an already-removed controller — ignored');

      return;
    }
    const index = this.vehicles.indexOf(controller);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.forgetChassisOf(controller);
    this.world.removeVehicleController(controller);
  }

  /**
   * Seed a small backward planar velocity (along −forward of `heading`) so reverse
   * engages from a dead stop — the raycast controller won't start reverse from rest
   * on its own. Keeps the current vertical velocity.
   */
  seedReverse(handle: number, heading: number, speed: number): void {
    assertFinite('seedReverse', { heading, speed });
    const body = this.world.getRigidBody(handle);
    const v = body.linvel();
    body.setLinvel({ x: Math.sin(heading) * speed, y: -Math.cos(heading) * speed, z: v.z }, true);
  }

  /** Make a collider a sensor (detected but applies no contact force) or solid again. */
  setColliderSensor(handle: number, sensor: boolean): void {
    this.world.getCollider(handle).setSensor(sensor);
  }

  setLinvel(handle: number, velocity: Vec3): void {
    assertFinite('setLinvel', { 'velocity.x': velocity[0], 'velocity.y': velocity[1], 'velocity.z': velocity[2] });
    this.world.getRigidBody(handle).setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  /** The world's tyre-adhesion table (081/10) — one absolute value per collision material, plus the road
   *  cell every other surface is judged against. */
  setTyreAdhesion(perMaterial: Float32Array, road: number): void {
    this.tyreAdhesion = { perMaterial, road };
  }

  /**
   * Apply per-frame driving controls: total `engineForce` and total `brake` each
   * split across all wheels (4WD), and `steer` (rad) on the front wheels.
   */
  /**
   * Hand the controller this step's driving values, each wheel clamped to what its tyre can actually deliver.
   *
   * `engine` is the force ONE DRIVEN WHEEL gets, not a total to share out — that is how the original does it
   * (`CAutomobile::ProcessCarWheelPair` gives every driven wheel the full `acceleration`), and it is why the
   * drive-type divisor exists: dividing the engine by 4 and then pushing with four wheels, or by 2 and
   * pushing with two, comes to the same total. Which wheels push is `drive`, so a rear-drive car launches on
   * the load its REAR axle carries.
   *
   * **The clamp is ours to apply, because Rapier skips it in a straight line.** Its controller computes the
   * friction limit `μ × suspensionForce × dt` and a `skid_info` factor, then applies that factor only
   * `if wheel.side_impulse != 0.0` — so a car accelerating or braking dead ahead has NO longitudinal grip
   * limit at all, and will put any force you hand it into the road. That is a Bullet inheritance, and it is
   * why the fleet launched at 5 g when 081/04 gave first gear its real thrust. The original clamps in exactly
   * this place (`CVehicle::ProcessWheel`: the wheel's force is limited by its adhesion), so this is the
   * original's model, applied where this engine needs it.
   *
   * The lateral half is left to Rapier: once a wheel has any side impulse, its own friction-circle check runs
   * and scales both components together, which is the behaviour we want.
   */
  setVehicleControls(
    controller: VehicleController,
    wheels: readonly { front: boolean }[],
    controls: {
      brake: number;
      /** `fBrakeBias`, 0..1 — the front axle's share, applied the original's way (`2 × bias` front). */
      brakeBias: number;
      drive: VehicleDriveType;
      engine: number;
      /** The lever is up: the REAR wheels lock, the front keeps whatever `brake` asks of it. */
      handbrake: boolean;
      /** Forward speed (m/s, signed) — the lateral grip GROWS with it (plan 081/09, see the boost above). */
      speed: number;
      steer: number;
      step: number;
      /** The car's authored tyre grip — re-read each step because a SLIDING wheel gets less of it. */
      traction: VehicleTractionSpec;
      /** SA's absolute adhesion under each wheel (081/10) — from {@link readVehicleWheelAdhesion}. Omit and
       *  every wheel is treated as tarmac, which is what every car did before surfaces were read. */
      wheelAdhesion?: readonly number[];
    },
  ): void {
    const { brake, brakeBias, drive, engine, handbrake, speed, steer, step, traction, wheelAdhesion } = controls;
    // Guarded ONCE per car, not per wheel: every per-wheel number below is derived from these, so a NaN here
    // is the one the caller produced — and naming the caller's field is the whole point.
    assertFinite('setVehicleControls', { brake, brakeBias, engine, speed, steer, step });
    const roadAdhesion = this.tyreAdhesion?.road ?? ROAD_ADHESION;
    const perBrake = brake / (wheels.length || 1);
    // The 081/09 assist: the LATERAL solver's grip grows with speed; everything longitudinal stays on the
    // unboosted base below, so launches, acceleration and braking never move with the dials.
    const ratio = Math.abs(speed) / this.speedGrip.reference;
    const boost = Math.min(1 + ratio * ratio, this.speedGrip.cap);
    let slip = this.wheelSlip.get(controller);
    if (!slip || slip.length !== wheels.length * 2) {
      slip = new Float32Array(wheels.length * 2);
      this.wheelSlip.set(controller, slip);
    }
    wheels.forEach((wheel, i) => {
      const driven = drive === '4' || (drive === 'F') === wheel.front;
      const load = controller.wheelSuspensionForce(i) ?? 0;
      // **A wheel that has broken loose grips less** (`fTractionLoss`, 0.72…0.85 on cars) — the original
      // applies it in `CVehicle::ProcessWheel` to any wheel whose state is not NORMAL, and it is what makes a
      // slide a slide rather than a slightly-too-fast corner: past the limit the tyre does not merely stop
      // giving MORE, it gives LESS, so the back steps out and stays out until it hooks up again.
      //
      // Rapier does not expose its `skid_info`, but it exposes the impulses, and a wheel sitting on its own
      // friction circle IS the sliding one. That is last step's state driving this step's grip — the same
      // one-frame feedback the original runs on (`bAlreadySkidding`).
      // WHAT the wheel is standing on, as a share of tarmac (081/10 step 5): 1.0 on road, 0.71 on grass and
      // dirt, 0.67 on sand, 0.62 wet. Tarmac is exactly the old number, so only off-road moves.
      const surface = (wheelAdhesion?.[i] ?? roadAdhesion) / roadAdhesion;
      const base = tyreGrip(traction, wheel.front) * surface;
      const lateral = base * boost;
      const used = Math.hypot(controller.wheelForwardImpulse(i) ?? 0, controller.wheelSideImpulse(i) ?? 0);
      // Sliding is judged against the BOOSTED circle — it is the one Rapier actually enforces; judging
      // against the base would flag every wheel at speed and the loss factor would eat the assist.
      const sliding = load > 0 && used >= lateral * load * step * SLIDE_THRESHOLD;
      controller.setWheelFrictionSlip(i, sliding ? lateral * traction.loss : lateral);
      // What this corner's tyre can deliver LONGITUDINALLY right now: the UNBOOSTED μ × the load its spring
      // is carrying. A wheel in the air carries nothing, so it drives and brakes with nothing.
      const grip = (sliding ? base * traction.loss : base) * load;
      // `fBrakeBias` splits the pedal across the axles exactly as the suspension and traction biases do.
      const axle = wheel.front ? 2 * brakeBias : 2 - 2 * brakeBias;
      controller.setWheelEngineForce(i, driven ? clampMagnitude(engine, grip) : 0);
      // Rapier's brake is an IMPULSE cap where its engine force is a FORCE, so the grip limit converts.
      // A LOCKED wheel brakes with everything its tyre has, which leaves the tyre nothing for cornering —
      // that is the whole mechanism of a handbrake turn, and it needs no separate "grip cut" to model.
      const locked = handbrake && !wheel.front;
      controller.setWheelBrake(i, locked ? grip * step : Math.min(perBrake * axle, grip * step));
      // The demand-over-cap record the tyre smoke reads (089/02): only HERE are demand and cap both known.
      // Excess, not saturation: Rapier caps a straight-line brake at the grip, so "the wheel is at its cap"
      // says nothing — "the driver asked for MORE than the cap" is what a locked wheel means.
      const cap = grip * step;
      slip[i * 2] = locked ? 1 : cap > 0 ? Math.max(0, (perBrake * axle) / cap - 1) : 0;
      slip[i * 2 + 1] = driven && grip > 0 ? Math.max(0, Math.abs(engine) / grip - 1) : 0;
      // **A locked tyre has almost no lateral bite** — it is skidding, not rolling, and a skidding tyre goes
      // where the car's momentum sends it. That is the half of the handbrake this engine has to say out loud:
      // the original gets it for free because its wheel states already cut adhesion, while Rapier resolves
      // the side force through a separate stiffness and would otherwise keep the rear axle planted while its
      // brakes are locked. Measured before this: a straight-line stop differed from the foot brake by 25 %
      // and the field could not tell the two controls apart at all.
      controller.setWheelSideFrictionStiffness(i, locked ? LOCKED_SIDE_FRICTION : 1);
      controller.setWheelSteering(i, wheel.front ? steer : 0);
    });
  }

  /** The active speed-grip dials — the F2 tab and every `[phys]` capture read them (self-description). */
  speedGripTuning(): { cap: number; reference: number } {
    return { ...this.speedGrip };
  }

  /**
   * Like {@link raycast} but sweeps a BALL of `radius` — the camera uses this, not a zero-width ray: a ray
   * lets the eye rest ON a wall and the near plane still clips through it, so the sphere must cover the near
   * plane (`radius ≥ near·tan(fov/2)·√(1+aspect²)` — ~0.59 for near 0.5 / fov 60° / 16:9; the shipped default
   * trades a little coverage for keeping the camera closer to walls, tuned in the field). Returns the distance
   * the eye may travel before the near plane would touch geometry.
   *
   * `alsoExclude` is a SECOND body to ignore. Rapier takes only one exclusion directly, so it goes through a
   * filter predicate. The camera needs two: what it frames, and the car the player just climbed out of —
   * otherwise stepping out puts the eye behind the car it is now framing the ped beside, and the cast pulls
   * the camera onto the ped's back (plan 080/06 field round 2).
   *
   * `dynamic` reports whether the hit belongs to a MOVING body (a traffic car, a ped) rather than the world
   * — the camera snaps its pull-in only for static geometry and eases for a passer-by (plan 080/09 §4.2:
   * an instant yank when a car crosses the focus→eye line reads as an unexplained jump).
   */
  sphereCast(
    origin: Vec3,
    dir: Vec3,
    radius: number,
    maxDist: number,
    exclude?: number,
    alsoExclude?: number,
  ): null | { dist: number; dynamic: boolean } {
    const length = Math.hypot(dir[0], dir[1], dir[2]);
    if (length === 0) {
      return null;
    }
    const vel = { x: dir[0] / length, y: dir[1] / length, z: dir[2] / length };
    const shape = new this.rapier.Ball(radius);
    const excludeBody = exclude === undefined ? undefined : this.world.getRigidBody(exclude);
    const hit = this.world.castShape(
      { x: origin[0], y: origin[1], z: origin[2] },
      { w: 1, x: 0, y: 0, z: 0 },
      vel,
      shape,
      0,
      maxDist,
      true,
      this.rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      excludeBody,
      alsoExclude === undefined ? undefined : (collider): boolean => collider.parent()?.handle !== alsoExclude,
    );

    // "Dynamic" here means "can move": dynamic AND kinematic bodies both qualify (a ped is kinematic) —
    // only fixed bodies and bare world colliders are the static geometry a camera may snap against.
    const parent = hit === null ? null : hit.collider.parent();

    return hit === null ? null : { dist: hit.time_of_impact, dynamic: parent !== null && !parent.isFixed() };
  }

  /**
   * Add to a body's angular velocity (world, rad/s) — the in-air attitude control's one write (081/06 §1).
   *
   * Straight onto the velocity, not through a torque impulse, because that is what the original does
   * (`CPhysical::ApplyTurnForce` ends in `m_vecTurnSpeed += cross(point, force) / m_fTurnMass`): it divides
   * by the AUTHORED `fTurnMass`, a single scalar, where a Rapier torque would be divided by the collider's
   * own inertia tensor — a different number per car and per axis, and nothing the handling file could aim.
   * A car in the air has no contacts for the solver to reconcile it against, so there is nothing to fight.
   */
  spin(handle: number, delta: Vec3): void {
    assertFinite('spin', { 'delta.x': delta[0], 'delta.y': delta[1], 'delta.z': delta[2] });
    const body = this.world.getRigidBody(handle);
    const w = body.angvel();
    body.setAngvel({ x: w.x + delta[0], y: w.y + delta[1], z: w.z + delta[2] }, true);
  }

  /**
   * Advance the world one fixed step.
   *
   * `beforeVehicles` runs at the very top, BEFORE the raycast controllers consume their engine/brake/steer
   * (plan 081/02 §4). Driving applied after this point lands one step late — the press and the answer 16 ms
   * apart — and every plan after this one would have tuned against that delay as if it were the car.
   */
  step(dt: number, beforeVehicles?: () => void): void {
    this.world.timestep = dt;
    this.phase = 'beforeVehicles';
    beforeVehicles?.();
    const vehiclesStarted = performance.now();
    for (const [index, vehicle] of this.vehicles.entries()) {
      this.phase = `updateVehicle ${index + 1}/${this.vehicles.length}`;
      // A non-finite pose or velocity makes Rapier's tree traversal panic deep inside wasm — a bare
      // `unreachable`, no message, no JS frame — and that panic leaves the body set BORROWED for good
      // (wasm does not unwind, so the guard never drops). Every later read then dies with "recursive use of
      // an object", naming whichever innocent reader touched it first. Catch the bad number on OUR side of
      // the boundary, where the car and the field can still be named and the world stays healthy.
      const chassis = vehicle.chassis();
      const bad = nonFiniteChassis(chassis);
      if (bad !== null) {
        // DROP it: leaving it in would throw here on every future step and physics would never advance
        // again. One report per distinct message, then the world carries on without the corpse. The INDEX
        // is not an identity (this array is reordered by every spawn and unload) — the handle is.
        //
        // The handle is quoted RAW because its shape is the diagnosis. `chassis()` returns a cached JS
        // object whose `handle` is a plain field written once at creation, so a NON-INTEGER handle cannot
        // come from a removed body — it means the wrapper ITSELF is wrong (a controller built on a body
        // whose handle was already garbage). An INTEGER handle that no longer resolves is the other story:
        // the body really was removed out from under a live controller. They need opposite fixes.
        // NOT a shape test on the number. Rapier hands out handles as an opaque bit pattern (index packed
        // with a generation, reinterpreted as a double), so a "non-integer" handle is the NORMAL case here —
        // the unit suite proved it, after an earlier version of this message had read it as corruption for
        // several debugging rounds. The only honest question is whether the body still resolves.
        const { handle } = chassis;
        const shape =
          this.world.getRigidBody(handle) === undefined
            ? 'the body does NOT resolve any more (it was removed)'
            : 'the body still resolves (so the reads themselves are the problem)';
        this.phase = `updateVehicle ${index + 1}/${this.vehicles.length} REJECTED`;
        this.vehicles.splice(index, 1);
        this.forgetChassisOf(vehicle);
        throw new Error(
          `physics: dropped a dead vehicle — ${shape}; handle=${String(handle)} ` +
            `registered=${String(this.vehicleChassis.has(handle))} live vehicles=${this.vehicles.length}; ${bad}`,
        );
      }
      // The suspension RAYS must respect collision groups too, or the wheels ride on things the chassis
      // passes through — a felled lamppost is invisible to the car's body but the wheels climbed it.
      vehicle.updateVehicle(dt, undefined, VEHICLE_GROUPS); // chassis velocity from suspension/engine
    }
    // The raycast controllers' own cost, separated from the solver's: 081/07 §3 budgets the VEHICLE slice
    // (≤ 0.5 ms/step for eight cars) and `physicsMs` alone cannot say which half a regression landed in.
    this.vehicleStepMs = performance.now() - vehiclesStarted;
    this.phase = 'world.step';
    this.world.step(this.events);
    this.phase = 'drainContactForceEvents';
    this.events.drainContactForceEvents((event) => {
      const c1 = this.world.getCollider(event.collider1());
      const c2 = this.world.getCollider(event.collider2());
      let point: null | Vec3 = null;
      this.world.contactPair(c1, c2, (manifold) => {
        if (manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0); // world-space contact point
          point = [p.x, p.y, p.z];
        }
      });
      const impact: Impact = {
        bodyA: c1.parent()?.handle ?? null,
        bodyB: c2.parent()?.handle ?? null,
        force: event.maxForceMagnitude(),
        point,
      };
      // Two independent buffers so the vehicle-damage and breakable triggers each drain the same
      // contact-force events without one starving the other (no inter-system ordering coupling).
      this.impacts.push(impact);
      this.breakableImpacts.push(impact);
    });
    this.phase = 'idle';
  }

  /** Where {@link step} is, or was when it died — the only attribution a bare wasm `unreachable` leaves. */
  stepPhase(): string {
    return this.phase;
  }

  /**
   * The SA surface id directly below `position` (within `maxDrop`), or null when nothing is hit or the
   * collision that was hit carries no material — plan 081/10's "what is this wheel standing on".
   *
   * The triangle is identified by the ray hit's own `featureId`, which Rapier reports as the trimesh face
   * index; a box or sphere has one material for the whole shape and no feature to read. **Null means
   * UNKNOWN, never surface 0** (`default`): collision built from something without materials must not be
   * read as if it were tarmac.
   */
  surfaceBelow(position: Vec3, maxDrop: number, excludeBody?: number): null | number {
    const ray = new this.rapier.Ray({ x: position[0], y: position[1], z: position[2] }, { x: 0, y: 0, z: -1 });
    const exclude = excludeBody === undefined ? undefined : this.world.getRigidBody(excludeBody);
    const hit = this.world.castRayAndGetNormal(ray, maxDrop, true, undefined, undefined, undefined, exclude);
    if (!hit) {
      return null;
    }
    const surface = this.surfaces.get(hit.collider.handle);
    if (surface === undefined) {
      return null;
    }
    if (typeof surface === 'number') {
      return surface;
    }

    if (hit.featureId === undefined) {
      return null;
    }
    // A hit on the BACK of a triangle comes back as `featureId + triangleCount` — parry's own encoding, and
    // the game's roads are wound so a downward ray lands on exactly that side. Read straight, the id runs
    // off the end of the table and every wheel reports "unknown": measured in-game as featureId 127 and 133
    // against a 106-triangle mesh (081/10 step 4).
    const triangle = hit.featureId % surface.length;

    return surface[triangle] ?? null;
  }

  /** Whether the surface-grip lookup is live AND has a table — recorded by every capture. */
  surfaceGripActive(): boolean {
    return this.surfaceGrip && this.tyreAdhesion !== null;
  }

  suspensionLengths(controller: VehicleController): number[] {
    const lengths: number[] = [];
    for (let i = 0; i < controller.numWheels(); i += 1) {
      lengths.push(controller.wheelSuspensionLength(i) ?? 0);
    }

    return lengths;
  }

  /** Drain the impacts collected since the last call (breakable props read these — plan 045). */
  takeBreakableImpacts(): readonly Impact[] {
    const impacts = this.breakableImpacts;
    this.breakableImpacts = [];

    return impacts;
  }

  /** Drain the impacts collected since the last call (vehicle collision damage reads these). */
  takeImpacts(): readonly Impact[] {
    const impacts = this.impacts;
    this.impacts = [];

    return impacts;
  }

  /** {@link vehicleStepMs}, and zero it — see the field. */
  takeVehicleStepMs(): number {
    const ms = this.vehicleStepMs;
    this.vehicleStepMs = 0;

    return ms;
  }

  /** Immediately move a body to a world position (Z-up) — e.g. seating the player in a car. */
  teleport(handle: number, position: Vec3): void {
    const body = this.world.getRigidBody(handle);
    const p = { x: position[0], y: position[1], z: position[2] };
    body.setTranslation(p, true);
    // Match the kinematic target so the next step doesn't pull the body back (no jitter).
    body.setNextKinematicTranslation(p);
  }

  /** Override the air-control strength for this session (plan 081/06 §1: `?airCtl=<×>`; 0 disables it). */
  tuneAirControl(scale: number | undefined): void {
    if (scale !== undefined && Number.isFinite(scale) && scale >= 0) {
      this.airControl.scale = scale;
    }
  }

  /** Override the speed-grip dials for this session (plan 081/09: `?gripVd=<m/s>&gripCap=<×>`) — the feel
   *  target is the field's, so the field holds the dials; accepted values get committed as the defaults. */
  tuneSpeedGrip(overrides: { cap?: number; reference?: number }): void {
    if (overrides.cap !== undefined && Number.isFinite(overrides.cap) && overrides.cap >= 1) {
      this.speedGrip.cap = overrides.cap;
    }
    if (overrides.reference !== undefined && Number.isFinite(overrides.reference) && overrides.reference > 0) {
      this.speedGrip.reference = overrides.reference;
    }
  }

  /** Turn the surface-grip lookup off for a session (`?surfGrip=0`) — the A/B the field judges it by. */
  tuneSurfaceGrip(enabled: boolean): void {
    this.surfaceGrip = enabled;
  }

  /** Signed forward speed (units/s) of a raycast vehicle (+ = forward). */
  /** Whether ANY wheel is on the ground — the drivetrain asks this to know if the engine can push. */
  vehicleGrounded(controller: VehicleController): boolean {
    for (let i = 0; i < controller.numWheels(); i += 1) {
      if (controller.wheelIsInContact(i)) {
        return true;
      }
    }

    return false;
  }

  vehicleSpeed(controller: VehicleController): number {
    return controller.currentVehicleSpeed();
  }

  /** Per-wheel suspension lengths only — the drawn wheels follow them every fixed step (plan 081/06 §3),
   *  and the full {@link readVehicleWheels} reading would be nine fields of waste per wheel per frame. */
  /** One wheel's contact point (native world space), or null while airborne — the tyre-smoke spawn origin
   *  (089/02). The controller already computed the point this step; this is a read, not a cast. */
  wheelContactPoint(controller: VehicleController, wheel: number): [number, number, number] | null {
    if (!controller.wheelIsInContact(wheel)) {
      return null;
    }
    const point = controller.wheelContactPoint(wheel);

    return point ? [point.x, point.y, point.z] : null;
  }

  /** Which wheels are touching anything, in wheel order — the drawn wheels read it to know whether they turn
   *  with the road or with the engine (plan 081/06). */
  wheelContacts(controller: VehicleController): boolean[] {
    const contacts: boolean[] = [];
    for (let i = 0; i < controller.numWheels(); i += 1) {
      contacts.push(controller.wheelIsInContact(i));
    }

    return contacts;
  }

  private addBox(body: RapierBody, box: ColliderBox): number {
    const hx = (box.max[0] - box.min[0]) / 2;
    const hy = (box.max[1] - box.min[1]) / 2;
    const hz = (box.max[2] - box.min[2]) / 2;
    if (hx <= 0 || hy <= 0 || hz <= 0) {
      return 0;
    }
    const cx = (box.max[0] + box.min[0]) / 2;
    const cy = (box.max[1] + box.min[1]) / 2;
    const cz = (box.max[2] + box.min[2]) / 2;
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz),
      body,
    );
    if (box.material !== undefined) {
      this.surfaces.set(collider.handle, box.material);
    }

    return 1;
  }

  /**
   * Chassis fallback when the COL has no convex primitives: a convex hull of the vertices, else a
   * car-sized `halfExtents` box. Rapier's `convexHull` returns a NON-null but invalid desc for
   * empty/degenerate input — `createCollider` then throws "expected instance of OA" — so we only
   * attempt it with enough points and box-fall-back if it still rejects (a no-COL modded DFF, e.g.
   * the cheetah/yosemite "locked" vehicles, otherwise crashes the spawn).
   */
  private addConvexChassis(body: RapierBody, vertices: Float32Array, halfExtents: [number, number, number]): void {
    const finish = (desc: ReturnType<Rapier['ColliderDesc']['cuboid']>): ReturnType<Rapier['ColliderDesc']['cuboid']> =>
      desc.setMass(0).setFriction(CHASSIS_FRICTION).setCollisionGroups(VEHICLE_GROUPS);

    const hull = vertices.length >= 12 ? this.rapier.ColliderDesc.convexHull(vertices) : null;
    if (hull) {
      try {
        this.world.createCollider(finish(hull), body);

        return;
      } catch {
        // degenerate vertices: convexHull yielded an invalid desc — fall through to the box.
      }
    }
    const [hx, hy, hz] = halfExtents;
    this.world.createCollider(finish(this.rapier.ColliderDesc.cuboid(hx, hy, hz)), body);
  }

  private addShapes(body: RapierBody, shape: ModelColliders['shape']): number {
    let count = this.addTrimesh(body, shape.vertices, shape.indices, shape.materials);
    for (const box of shape.boxes) {
      count += this.addBox(body, box);
    }
    for (const sphere of shape.spheres) {
      count += this.addSphere(body, sphere);
    }

    return count;
  }

  private addSphere(body: RapierBody, sphere: ColliderSphere): number {
    if (sphere.radius <= 0) {
      return 0;
    }
    const [x, y, z] = sphere.center;
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.ball(sphere.radius).setTranslation(x, y, z),
      body,
    );
    if (sphere.material !== undefined) {
      this.surfaces.set(collider.handle, sphere.material);
    }

    return 1;
  }

  private addTrimesh(body: RapierBody, vertices: Float32Array, indices: Uint32Array, materials?: Uint8Array): number {
    if (vertices.length === 0 || indices.length === 0) {
      return 0;
    }
    // Rapier validates NEITHER of these. It builds its acceleration tree from whatever it is handed, and a
    // NaN coordinate or an out-of-range index only shows up LATER, as an `unreachable` panic deep inside a
    // tree traversal during `world.step` — no message, no JS frame, and the panic leaves the whole physics
    // world permanently borrowed. The cause and the crash are then unrelatable by construction, which is
    // exactly how this cost a debugging session. Refuse the mesh instead: one bad collider is a hole in the
    // ground, a poisoned world is the end of the session.
    const badVertex = firstNonFiniteIndex(vertices);
    const vertexCount = vertices.length / 3;
    const badIndex = firstIndexOutOfRange(indices, vertexCount);
    if (badVertex >= 0 || badIndex >= 0) {
      this.reportOnce(
        badVertex >= 0
          ? `physics: SKIPPED a trimesh collider — vertex ${badVertex} is ${String(vertices[badVertex])} (${vertexCount} verts)`
          : `physics: SKIPPED a trimesh collider — index ${badIndex} is ${String(indices[badIndex])}, out of range for ${vertexCount} verts`,
      );

      return 0;
    }
    try {
      const collider = this.world.createCollider(this.rapier.ColliderDesc.trimesh(vertices, indices), body);
      if (materials) {
        // The SAME array for every placement of this model — a reference, never a copy: a cell can hold
        // hundreds of instances of one wall.
        this.surfaces.set(collider.handle, materials);
      }

      return 1;
    } catch {
      return 0; // skip a degenerate trimesh rather than fail the whole region
    }
  }

  private addVehicleHull(
    body: RapierBody,
    shape: ModelColliders['shape'] | null,
    halfExtents: [number, number, number],
  ): void {
    const spheres = (shape?.spheres ?? []).filter((sphere) => sphere.radius > 0);
    const boxes = (shape?.boxes ?? []).filter(
      (box) => box.max[0] > box.min[0] && box.max[1] > box.min[1] && box.max[2] > box.min[2],
    );
    if (spheres.length + boxes.length === 0) {
      this.addConvexChassis(body, shape?.vertices ?? new Float32Array(), halfExtents);

      return;
    }

    for (const sphere of spheres) {
      const [x, y, z] = sphere.center;
      const desc = this.rapier.ColliderDesc.ball(sphere.radius).setTranslation(x, y, z);
      this.world.createCollider(this.vehicleCollider(desc), body);
    }
    for (const box of boxes) {
      const hx = (box.max[0] - box.min[0]) / 2;
      const hy = (box.max[1] - box.min[1]) / 2;
      const hz = (box.max[2] - box.min[2]) / 2;
      const cx = (box.max[0] + box.min[0]) / 2;
      const cy = (box.max[1] + box.min[1]) / 2;
      const cz = (box.max[2] + box.min[2]) / 2;
      const desc = this.rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
      this.world.createCollider(this.vehicleCollider(desc), body);
    }
  }

  /** Drop a controller's chassis registration. Keyed by HANDLE, so it is found by value — the controller's
   *  own `chassis()` cannot be trusted here: by removal time that body may already be freed. */
  private forgetChassisOf(controller: VehicleController): void {
    this.vehicleChassisAtBirth.delete(controller);
    for (const [handle, owner] of this.vehicleChassis) {
      if (owner === controller) {
        this.vehicleChassis.delete(handle);

        return;
      }
    }
  }

  /**
   * Build the dynamic chassis collider from the COL's convex primitives (spheres +
   * boxes), giving each shape an **equal** share of `mass` (not volume-weighted) so a
   * single oversized COL sphere — e.g. the camper's big front sphere — can't drag the
   * centre of mass high/forward and make the car wobble. Each shape keeps its own
   * shape-based inertia (realistic, unlike a single box approximation). Falls back to a
   * convex hull of the vertices when a COL has no primitives, then a `halfExtents` box
   * when there's no usable hull either. The COL trimesh is omitted (it can't collide
   * with the static world trimesh).
   */
  /** Say something ONCE per distinct message — a streaming world would repeat a bad collider every reload. */
  private reportOnce(message: string): void {
    if (this.reported.has(message)) {
      return;
    }
    this.reported.add(message);
    // eslint-disable-next-line no-console -- geometry Rapier cannot survive; silence here costs a session
    console.error(message);
  }

  /**
   * A chassis collider desc: friction + vehicle collision group, a little restitution (bounce off walls),
   * and contact-force events (so collisions report impacts for damage).
   *
   * **Mass ZERO on purpose** (plan 081/02): the primitives are the car's SHAPE, and shape alone. Its mass,
   * its centre of mass and its inertia come from `handling.cfg` via `setAdditionalMassProperties`. Letting
   * the colliders carry mass again would put the centre of mass back wherever the cabin box happens to sit.
   */
  private vehicleCollider(
    desc: ReturnType<Rapier['ColliderDesc']['ball']>,
  ): ReturnType<Rapier['ColliderDesc']['ball']> {
    return desc
      .setMass(0)
      .setFriction(CHASSIS_FRICTION)
      .setCollisionGroups(VEHICLE_GROUPS)
      .setRestitution(CHASSIS_RESTITUTION)
      .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Max)
      .setActiveEvents(this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONTACT_FORCE_THRESHOLD);
  }
}

/**
 * Refuse a non-finite number BEFORE it reaches Rapier, naming the writer and the field.
 *
 * A NaN handed to the solver does not fail where it is written — it rides the body until some later step
 * walks the spatial tree with it and Rust hits an `unreachable`. That panic carries no message, no JS frame,
 * and it leaves the body set permanently borrowed, so the visible error ends up on whichever innocent reader
 * touched the world next. These guards are what turn that into "who wrote it, and what".
 */
function assertFinite(where: string, values: Readonly<Record<string, number>>): void {
  for (const name of Object.keys(values)) {
    const value = values[name] ?? Number.NaN;
    if (!Number.isFinite(value)) {
      throw new Error(`physics: ${where} was given a non-finite ${name} (${String(value)})`);
    }
  }
}

/** Clamp to ±limit. */
function clampMagnitude(value: number, limit: number): number {
  return Math.min(Math.max(value, -limit), limit);
}

/** Position of the first index that names a vertex the mesh does not have, or −1. */
function firstIndexOutOfRange(indices: Uint32Array, vertexCount: number): number {
  for (let i = 0; i < indices.length; i += 1) {
    if ((indices[i] ?? 0) >= vertexCount) {
      return i;
    }
  }

  return -1;
}

/** Position of the first non-finite value, or −1. One scan of a mesh at LOAD time, never per frame. */
function firstNonFiniteIndex(values: Float32Array): number {
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) {
      return i;
    }
  }

  return -1;
}

/**
 * Which of a chassis body's state is not a finite number, or null when all of it is — the guard
 * {@link PhysicsWorld.step} runs before handing a car to Rapier.
 *
 * One NaN or Infinity anywhere in a pose or a velocity is enough: Rapier walks its spatial tree with those
 * numbers, and a comparison against NaN sends the traversal down a branch the Rust code proves cannot
 * happen, which compiles to a bare `unreachable`. The panic carries no message, no JS frame, and it leaves
 * the body set permanently borrowed — so the FIRST honest report of it is this one.
 */
function nonFiniteChassis(chassis: {
  angvel: () => { x: number; y: number; z: number };
  linvel: () => { x: number; y: number; z: number };
  rotation: () => { w: number; x: number; y: number; z: number };
  translation: () => { x: number; y: number; z: number };
}): null | string {
  const t = chassis.translation();
  const r = chassis.rotation();
  const v = chassis.linvel();
  const w = chassis.angvel();
  const fields: readonly [string, number][] = [
    ['position.x', t.x],
    ['position.y', t.y],
    ['position.z', t.z],
    ['rotation.x', r.x],
    ['rotation.y', r.y],
    ['rotation.z', r.z],
    ['rotation.w', r.w],
    ['linvel.x', v.x],
    ['linvel.y', v.y],
    ['linvel.z', v.z],
    ['angvel.x', w.x],
    ['angvel.y', w.y],
    ['angvel.z', w.z],
  ];
  // EVERY bad field, not the first: whether the velocities went with the position is what separates a bad
  // WRITE (position alone) from a bad FORCE the solver then integrated (velocity too).
  const bad = fields.filter(([, value]) => !Number.isFinite(value));

  return bad.length === 0 ? null : bad.map(([name, value]) => `${name}=${String(value)}`).join(' ');
}

/**
 * The inertia tensor a car gets from its authored numbers (plan 081/02).
 *
 * SA authors ONE rotational number, `fTurnMass`, and it is the YAW inertia — the axis a car actually turns
 * about. Pitch and roll come from a solid-box model on the chassis half-extents, scaled so the model's own
 * yaw term equals the authored one. That keeps the three axes in a physically consistent ratio instead of
 * inventing two more numbers, and the scale lands near 1 on real cars: the stock infernus authors 2725
 * against a box model's 2637.
 *
 * Axes are the model frame — x right (pitch), y forward (roll), z up (yaw).
 */
function principalInertia(
  properties: VehicleMassProperties,
  halfExtents: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const [hx, hy, hz] = halfExtents;
  const box = (a: number, b: number): number => (properties.mass / 3) * (a * a + b * b);
  const boxYaw = box(hx, hy);
  const scale = boxYaw > 0 ? properties.turnMass / boxYaw : 1;

  return { x: box(hy, hz) * scale, y: box(hx, hz) * scale, z: properties.turnMass };
}

/**
 * A car's springs, derived from its authored suspension row (plan 081/02 §3).
 *
 * Stiffness and the force cap are MASS-NORMALISED: a rate that carries 1500 kg leaves a 6.5 t truck on its
 * bump stops, which is what one shared spring meant. Damping keeps its tuned RATIO — compression sits far
 * above the Bullet-standard rebound because it damps the launch hop (074 field lesson) — and both have a
 * floor, because a tank authors 0.02 and honouring that literally makes it a pogo stick. Geometry is
 * literal: the wheel hangs |lower limit| below its hub, the spring compresses by the upper limit.
 */
/**
 * How much of the car's weight each wheel carries when it is standing still (N).
 *
 * The lever rule about the AUTHORED centre of mass, which is the only honest source: a hearse is rear-heavy
 * because its row says its mass sits 0.8 m back, not because anything was special-cased for hearses. Verified
 * against the solver rather than assumed — the rule predicts the romero's 29 % front against a measured
 * 29.4 %.
 *
 * Axles are grouped by the wheels' own `front` flag (which comes from the model's `wheel_?f` / `wheel_?b`
 * dummy names), so a six-wheeler's middle axle rides with the rear. Left/right split evenly: SA authors a
 * lateral centre offset almost nowhere, and where it does, the same lever rule applies about x.
 */
function staticWheelLoads(wheels: readonly VehicleWheelSpec[], properties: VehicleMassProperties): readonly number[] {
  const weight = properties.mass * GRAVITY;
  const front = wheels.filter((wheel) => wheel.front);
  const rear = wheels.filter((wheel) => !wheel.front);
  if (front.length === 0 || rear.length === 0) {
    return wheels.map(() => weight / (wheels.length || 1));
  }
  const mean = (group: readonly VehicleWheelSpec[]): number =>
    group.reduce((total, wheel) => total + wheel.connection[1], 0) / group.length;
  const yFront = mean(front);
  const yRear = mean(rear);
  const span = yFront - yRear;
  // A degenerate row (both axles at one y) gets an even split rather than a division by zero.
  const frontShare =
    span === 0
      ? 0.5
      : Math.min(MAX_AXLE_SHARE, Math.max(1 - MAX_AXLE_SHARE, (properties.centreOfMass[1] - yRear) / span));

  return wheels.map((wheel) =>
    wheel.front ? (weight * frontShare) / front.length : (weight * (1 - frontShare)) / rear.length,
  );
}

function suspensionSetup(
  properties: VehicleMassProperties,
  front: boolean,
  load: number,
): {
  compression: number;
  /** Where the wheel RESTS relative to the model hub (m, ≤ 0 = below it) — the original's own standing pose. */
  hubOffset: number;
  maxForce: number;
  relaxation: number;
  restLength: number;
  /** How far THIS corner's spring compresses under the weight it actually carries (m). */
  sag: number;
  stiffness: number;
  travel: number;
} {
  const { bias, damping, force, restLength, travel } = properties.suspension;
  // The axle split, exactly as the original writes it: front springs get 2 × bias, rear 2 − 2 × bias.
  const axle = front ? 2 * bias : 2 - 2 * bias;
  const dampingScale = Math.min(
    SUSPENSION_DAMPING_SCALE_MAX,
    Math.max(SUSPENSION_DAMPING_SCALE_MIN, damping / SUSPENSION_DAMPING_REFERENCE),
  );

  const usableTravel = travel > 0 ? travel : SUSPENSION_MAX_TRAVEL;
  const level = force > 0 ? force : SUSPENSION_REFERENCE_FORCE;
  // **Where the wheel stands, by the original's own law (2026-07-27 audit).** SA rests a car near full
  // droop: `SetupSuspensionLines` computes the standing compression as `1 − 1/(4 × forceLevel)` of the span
  // `upper − lower` — per corner, `weightShare / (forceLevel × axleBias)` of it, measured from full
  // extension. So the wheel rests `|lower| − thatDeflection` BELOW its dummy (SA models author wheels high
  // in the arches; the game drops them). The old rule pinned the wheel AT the dummy, which slammed every
  // car by exactly that distance — proportional to |lower|, so the turismo (−0.20, the stock table's
  // largest) sat ~12 cm low while the infernus (−0.10) looked nearly right. That gradient is why seven
  // field rounds passed the fleet and still called the turismo out.
  const usableRest = restLength > 0 ? restLength : SUSPENSION_REST;
  const span = usableRest + usableTravel;
  const share = load / (properties.mass * GRAVITY);
  const rawFraction = share / (level * axle);
  // A degenerate row (axle bias 0 or 1) divides by zero; the pose falls back to the dummy, not to NaN.
  const fraction = Number.isFinite(rawFraction) ? Math.min(1, Math.max(0, rawFraction)) : usableRest / span;
  const hubOffset = fraction * span - usableRest;
  // SA's own law, converted into Rapier's units — see SUSPENSION_LEVEL_SCALE. A car's stance comes from its
  // authored force level alone; its geometry decides what that level means in metres.
  const wanted = (SUSPENSION_LEVEL_SCALE * level * axle) / usableTravel;
  // …and a bump stop, because SA has one and we do not: a spring may not eat more than this share of the
  // travel just standing still, or nothing is left to absorb a bump. It is fed the load this corner ACTUALLY
  // carries — a rear-heavy car's back springs have to be told they are holding up 71 % of a hearse.
  const softest =
    load / (SUSPENSION_FORCE_PER_STIFFNESS * properties.mass * usableTravel * SUSPENSION_MAX_SAG_OF_TRAVEL);
  const stiffness = Math.max(wanted, softest);
  const critical = 2 * Math.sqrt(stiffness); // Bullet's damping scale for a rate

  return {
    compression: Math.max(SUSPENSION_COMPRESSION_FLOOR, SUSPENSION_COMPRESSION_RATIO * critical * dampingScale),
    hubOffset,
    maxForce: properties.mass * SUSPENSION_FORCE_PER_KG,
    relaxation: Math.max(SUSPENSION_RELAXATION_FLOOR, SUSPENSION_RELAXATION_RATIO * critical * dampingScale),
    restLength: usableRest,
    sag: load / (SUSPENSION_FORCE_PER_STIFFNESS * properties.mass * stiffness),
    stiffness,
    travel: usableTravel,
  };
}

/** The wheel's friction coefficient: the authored multiplier, split across the axles the way SA splits it.
 *  The BASELINE scale — the tyre-scale decision comment in the constants block explains why it is parked
 *  here pending the 081/08 2g experiment. */
function tyreGrip(traction: VehicleTractionSpec, front: boolean): number {
  const axle = front ? 2 * traction.bias : 2 - 2 * traction.bias;

  return Math.max(TYRE_GRIP_FLOOR, traction.mult * axle);
}
