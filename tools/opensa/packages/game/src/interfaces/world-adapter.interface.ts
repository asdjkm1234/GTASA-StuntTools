import type { CellCoord } from '../streaming/grid';
import type { ModelColliders } from './collider.interface';

/**
 * How one axle is built, from `handling.cfg`'s `modelFlags` (plan 081/06 §3).
 *
 * The file's own legend gives the hex column two axle nibbles — the 5th digit for the FRONT axle, the 6th for
 * the REAR — each carrying `1 NOTILT · 2 SOLID · 4 MCPHERSON · 8 REVERSE`. 26 of the 210 stock rows use them
 * (11 with a solid rear axle: the pickups, the trucks, the tractor), and a row that names nothing gets
 * `independent`, which is how a car without an authored axle has always been drawn.
 */
export interface AxleSetup {
  /** SA's `AXLE_*_REVERSE`: the model's wheel dummies are mirrored, so the lean flips with them. It is a
   *  MODIFIER, not a type — five stock rows carry it with no type beside it. */
  readonly reverse: boolean;
  readonly type: AxleType;
}

export type AxleType = 'independent' | 'mcpherson' | 'notilt' | 'solid';

/** Request for one streamed grid cell's HD (`lod=false`) or LOD (`lod=true`) meshes. */
export interface CellRequest {
  cx: number;
  cy: number;
  lod: boolean;
}

export interface RegionRequest {
  center: Vec3;
  geometry: 'lods' | 'map';
  radius: number;
}

/**
 * One row of the world's surface table (plan 081/10) — the engine-side shape of what a collision material
 * MEANS. Deliberately structural: the GTA adapter's parsed `surfinfo.dat` rows satisfy it as they are, so
 * nothing is copied or converted, and the `game` layer still names no renderware type.
 */
export interface SurfaceRecord {
  /** `rubber` · `hard` · `road` · `loose` · `sand` · `wet` — the row into the adhesion matrix. */
  readonly adhesionGroup: string;
  readonly name: string;
  /** `default` · `sandy` · `muddy` — which mark a sliding tyre leaves (plan 089). */
  readonly skidmark: string;
  /** Per-surface grip override; 1.0 everywhere in stock SA data. */
  readonly tyreGrip: number;
  /** Rain modifier on the tyre grip. */
  readonly wetGrip: number;
  /** Which wheel effect this surface throws up (plan 089). */
  readonly wheelDust: boolean;
  readonly wheelGrass: boolean;
  readonly wheelGravel: boolean;
  readonly wheelMud: boolean;
  readonly wheelSand: boolean;
  readonly wheelSpray: boolean;
}

export type Vec3 = [number, number, number];

/** Raw driving feel from `handling.cfg` (the gameplay layer scales these into its model). */
/**
 * One car's row of `handling.cfg`, typed (plan 081/02).
 *
 * **Column order is the game's own, verified against its legend** (`handling.cfg`'s FIELD DESCRIPTIONS
 * block) AND against real rows — the legend lists a "(not used)" column that the shipped file does not
 * actually carry, so it is the DATA that pins the indices. The legend's ranges are stale (it claims
 * `fMaxVelocity [5..150]` while the infernus authors 240); its names are not.
 *
 * Values are as AUTHORED. Turning an authored number into a force, a spring or a top speed is the consuming
 * plan's decision and belongs with the evidence for it — this type only stops the data being thrown away,
 * which is what it was until 081/01 measured the cost: 35 of 40 columns unread, and a realism handling mod
 * losing 58 % of its edits on the way in.
 */
export interface VehicleHandling {
  /** ABS flag (`bABS`), 0/1 as authored. */
  abs: boolean;
  /** How the FRONT axle is built (`modelFlags`) — it decides how the drawn wheels lean (081/06 §3). */
  axleFront: AxleSetup;
  /** How the REAR axle is built — the loud one: a solid rear axle keeps both wheels parallel. */
  axleRear: AxleSetup;
  /** Brake front/rear split (`fBrakeBias`), 0..1 = share on the FRONT axle. */
  brakeBias: number;
  /** Braking deceleration (`fBrakeDeceleration`), authored units. */
  brakeDecel: number;
  /**
   * Authored centre of mass in MODEL space (m): x right, y forward, z up — the same frame the chassis
   * uses. Today the body derives one from its collision primitives instead, which puts it high; that is
   * the flip complaint's root (081/01 measured it: the infernus authors −0.25 and goes over, the admiral
   * −0.05 and never does).
   */
  centreOfMass: readonly [number, number, number];
  /** Damage scaling (`fCollisionDamageMultiplier`). */
  collisionDamageMult: number;
  /** Aerodynamic drag scale (`fDragMult`). */
  dragMult: number;
  /** Which wheels are driven (`nDriveType`): front, rear or all four. Every car is `4` today. */
  drive: '4' | 'F' | 'R';
  /** Engine acceleration (`fEngineAcceleration`), authored units. */
  engineAccel: number;
  /** Engine inertia (`fEngineInertia`) — how eagerly revs rise. */
  engineInertia: number;
  /** Petrol / diesel / electric (`nEngineType`). */
  engineType: 'D' | 'E' | 'P';
  /** Gearbox ratio count (`nNumberOfGears`). No gearbox exists yet — one continuous ramp instead. */
  gears: number;
  /** Mass (kg) — heavier = less agile. */
  mass: number;
  /** Top speed (`fMaxVelocity`), authored units. */
  maxVelocity: number;
  /** Steering lock, degrees (`fSteeringLock`). */
  steeringLock: number;
  /** Anti-dive multiplier (`fSuspensionAntiDiveMultiplier`), 0..1. */
  suspAntiDive: number;
  /** Front/rear suspension split (`fSuspensionBias`), 0..1 = share on the FRONT axle. */
  suspBias: number;
  /** Damping level (`fSuspensionDampingLevel`). */
  suspDamping: number;
  /** Spring force level (`fSuspensionForceLevel`). */
  suspForce: number;
  /** High-speed compression damping (`fSuspensionHighSpdComDamp`) — usually 0. */
  suspHighSpeedDamp: number;
  /** Suspension lower limit (m, negative = below the hub). */
  suspLower: number;
  /** Suspension upper limit (m). */
  suspUpper: number;
  /** Grip front/rear split (`fTractionBias`), 0..1 = share on the FRONT axle. */
  tractionBias: number;
  /** How grip breaks away (`fTractionLoss`). */
  tractionLoss: number;
  /** Per-car grip (`fTractionMultiplier`). Every car runs one shared friction slip today. */
  tractionMult: number;
  /** Yaw inertia (`fTurnMass`, kg·m²). Unmodelled today — which is why a 6.5 t fire truck answers the
   *  wheel FASTER than a 1.4 t supercar (081/01 step-steer: 0.07 s vs 0.08 s). */
  turnMass: number;
}

/** One raycast wheel for the physics vehicle: hub position in vehicle space, radius, axle. */
export interface VehicleWheelPlacement {
  /** Wheel hub position in vehicle space `[x, y, z]`. */
  connection: [number, number, number];
  /** Front wheels steer; all wheels are powered/braked per the drive type. */
  front: boolean;
  /** Rolling radius (world units). */
  radius: number;
}

/**
 * The seam between the generic `game` engine and a concrete world implementation
 * (GTA SA / renderware). Implemented only under `game/adapters/**`; returns plain
 * three.js objects so the engine never names a `.dff`/`.txd`/IPL.
 */
export interface WorldAdapter {
  /** Edge length of a streaming grid cell, in world units. */
  readonly cellSize: number;
  /** Every grid cell that holds content (for the debug section inspector). */
  listCells(): CellCoord[];
  /** Build one grid cell's collision (its HD instances), for streaming the physics colliders. */
  loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]>;
  /**
   * Load a painted, wheeled vehicle by model name (native Z-up; place under the streaming root).
   * `colour` overrides the paint with carcols palette indices (e.g. `'34,34'` or `'1,31,1,0'`); the
   * first two indices become the primary/secondary paint. Omit to use the car's default carcol combo.
  /** Download/parse everything needed; reports progress 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
  /**
   * The world's surface table, indexed by the material id collision carries — what a wheel is standing on
   * (plan 081/10). Null until {@link WorldAdapter.prepare} has run, and null for a world that has no such
   * table: a caller must treat "no table" as "unknown surface", never as a default one.
   */
  surfaces(): null | readonly SurfaceRecord[];
}

/** What a picked instance is (debug click-inspect). */
export interface WorldObjectInfo {
  /** Render diagnostics: the material's shader-variant cache key + whether the geometry carries the
   *  `nightColor` attribute — tells which day/night path the instance actually takes at runtime. */
  material?: string;
  modelName: string;
  position: Vec3;
  txdName: string;
}
