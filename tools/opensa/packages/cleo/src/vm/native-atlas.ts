import { isNativeToken, TokenTable, type TokenTarget } from './native-tokens';
/**
 * The native atlas (plan 097/05 decisions 2-6): the corpus's ~15 SA 1.0 US addresses as DATA, and
 * `AtlasMemory` — the object-capability facade resolving READ/WRITE/CALL through it. "Memory" is a
 * declarative mapping onto a narrow {@link NativeWorld} the engine (or a test fake) implements; no
 * byte-level emulation, and an address the atlas cannot NAME is not served (it reports instead).
 *
 * Every symbol below is verified against gta-reversed (2026-08-04):
 * - `0x4C5400` CClumpModelInfo::GetFrameFromName
 * - `0x6C2100/0x6C2130` CDamageManager::SetLightStatus/GetLightStatus (`CAutomobile+0x5A0` =
 *   m_damageManager; `eLights` 0 FL, 1 FR, 2 RR, 3 RL; `eLightsState` 0 OK, 1 SMASHED)
 * - `0x59AFA0/0x59AFE0/0x59B020` CMatrix::SetRotateX/Y/ZOnly
 * - `0x59B120` CMatrix::SetRotate(x,y,z) — composition Rz·Rx·Ry (see `sa-matrix.ts`)
 * - `0xB74494` CPools::ms_pVehiclePool
 * - `0xC812F0` CWeather::Wind (float)
 * - `0xB6F118` TheCamera.m_fLODDistMultiplier (TheCamera=0xB6F028 + CCamera+0xF0; the draw-distance
 *   slider multiplier — `VisibilityPlugins.cpp` computes visibility as multiplier × drawDistance,
 *   exactly the Wind Farm formula)
 * - `CVehicle+0x18` CEntity::m_pRwObject · `CAutomobile+0x648` m_aCarNodes (`+0x658` = [4] =
 *   CAR_WHEEL_RB) · `RwFrame+0x10` the modelling CMatrix · CMatrix `+0x10` m_forward, `+0x30` m_pos
 */
import { quatFromSaEuler, quatRotateX, quatRotateY, quatRotateZ } from './sa-matrix';

/** Function/global addresses (SA 1.0 US — the one canonical exe, the perfect-map doctrine). */
export const SA = {
  GET_FRAME_FROM_NAME: 0x4c5400,
  GET_LIGHT_STATUS: 0x6c2130,
  LOD_DIST_MULTIPLIER: 0xb6f118,
  SET_LIGHT_STATUS: 0x6c2100,
  SET_ROTATE_X_ONLY: 0x59afa0,
  SET_ROTATE_XYZ: 0x59b120,
  SET_ROTATE_Y_ONLY: 0x59afe0,
  SET_ROTATE_Z_ONLY: 0x59b020,
  VEHICLE_POOL: 0xb74494,
  WEATHER_WIND: 0xc812f0,
} as const;

/** SA 1.0 US image base — no static address sits below it (the one canonical exe). */
const SA_IMAGE_BASE = 0x400000;

/** Struct offsets the corpus dereferences. */
const VEHICLE_RW_OBJECT = 0x18;
/** `CAutomobile+0x5A0` m_damageManager — the `this` the light-status calls are made on. */
const VEHICLE_DAMAGE_MANAGER = 0x5a0;
const VEHICLE_CAR_NODES = 0x648;
const CAR_NODE_COUNT = 25;
/** RwFrame+0x10 = the modelling CMatrix; within it: +0x10 m_forward, +0x30 m_pos. RwFrame+0x9C is
 *  the `next` sibling pointer — rhino WALKS the frame hierarchy along it (track links are authored
 *  as a sibling chain). */
const FRAME_MATRIX = 0x10;
const FRAME_NEXT_SIBLING = 0x9c;
const MATRIX_FORWARD = 0x10;
const MATRIX_POS = 0x30;

/** eCarNodes → the FRAME names our rigs carry (gta-reversed eCarNodes.h order; wheels use SA's
 *  `_dummy` pivot-frame convention — measured on the rebaked newsvan/rhino rigs, whose wheel frames
 *  are `wheel_rb_dummy` etc). Only the wheel/door/misc nodes the corpus walks are mapped. */
const CAR_NODE_NAMES: readonly (null | string)[] = [
  null, // 0 NONE
  'chassis',
  'wheel_rf_dummy',
  'wheel_rm_dummy',
  'wheel_rb_dummy',
  'wheel_lf_dummy',
  'wheel_lm_dummy',
  'wheel_lb_dummy',
  'door_rf',
  'door_rr',
  'door_lf',
  'door_lr',
  'bump_front',
  'bump_rear',
  'wing_rf',
  'wing_lf',
  'bonnet',
  'boot',
  'windscreen',
  'exhaust',
  'misc_a',
  'misc_b',
  'misc_c',
  'misc_d',
  'misc_e',
];

/** One unserved access — the coverage surface plan 07 reports (never a silent wrong read). */
export interface AtlasMiss {
  readonly address: number;
  readonly detail: string;
  readonly kind: 'call' | 'read' | 'write';
}

export type NativeArg =
  | { readonly float: number; readonly int: number; readonly kind: 'raw' }
  | { readonly kind: 'float' | 'int'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string };

/** A typed value crossing the memory facade (var writes preserve int/float-ness). */
export type NativeValue = null | { readonly kind: 'float' | 'int'; readonly value: number };

/**
 * What the atlas asks of the world — the WHOLE surface plan 05 serves, scoped to the corpus. The
 * engine implements it over the vehicle registry/weather; tests implement a recording fake.
 */
export interface NativeWorld {
  /** Current door openness 0..1 for `095F` (door 2..5 = SA door ids), or null when unknown. */
  doorAngleRatio(car: number, door: number): null | number;
  /** `CDamageManager::GetLightStatus` — 0 = OK, 1 = SMASHED, per SA's `eLights` index. */
  lightStatus(car: number, light: number): number;
  /** TheCamera.m_fLODDistMultiplier — the draw-distance slider (1.0 when there is no slider). */
  lodDistMultiplier(): number;
  /** The NEXT sibling of a part in the model's frame order (RwFrame+0x9C), or null at chain end. */
  nextSiblingPart(car: number, part: number): null | number;
  /** The part's local rotation as SA's frame m_forward column (rhino reads wheel spin from it). */
  partForward(car: number, part: number): readonly [number, number, number];
  /** Part index by frame name (`misc_a`, `dvan_l`…), or null when the model lacks it. */
  partIndex(car: number, name: string): null | number;
  /** The part's local translation (the matrix m_pos reads — rhino reads track-link positions). */
  partTranslation(car: number, part: number): readonly [number, number, number];
  /** `CDamageManager::SetLightStatus`. SA stores two bits per lamp and only ever writes 0 or 1, so any
   *  non-zero status is SMASHED here — a script that writes 2 must not read back as repaired. */
  setLightStatus(car: number, light: number, status: number): void;
  /** Set a part's local rotation (quaternion, GTA axes) — the SetRotate* family lands here. */
  setPartRotation(car: number, part: number, quat: readonly [number, number, number, number]): void;
  /** Overwrite ONE component (0=x 1=y 2=z) of a part's local translation — the matrix pos writes. */
  setPartTranslationComponent(car: number, part: number, axis: 0 | 1 | 2, value: number): void;
  /** Live script vehicle handles (slot-minted: `slot*256 + counter`, counter bit7 clear). */
  vehicleHandles(): readonly number[];
  /** CWeather::Wind, 0..~1. */
  wind(): number;
}

/** The facade: tokens + atlas rows resolved against a {@link NativeWorld}. */
export class AtlasMemory {
  /** Unserved accesses, deduplicated — F2/coverage reads these (decision 8). */
  readonly misses: AtlasMiss[] = [];

  private readonly missKeys = new Set<string>();
  private readonly tokens = new TokenTable();

  /** `onOp` is the plan 07 tracer's seam: every SERVED op emits one symbolised line ("read
   *  CWeather::Wind -> 0.4"), never a raw address. Absent = zero cost (lines built lazily). */
  constructor(
    private readonly world: NativeWorld,
    private readonly onOp?: (line: string) => void,
  ) {}

  /** `0AA5-0AA8`: a call through the functions table. Returns the output value (null = unserved).
   *  `args` arrive in the SA function's own C argument order — `handlers/natives.ts` has already
   *  undone CLEO's reversed push order, so a row indexes them exactly as its signature reads. */
  call(address: number, struct: null | number, args: readonly NativeArg[]): NativeValue {
    switch (address) {
      case SA.GET_FRAME_FROM_NAME:
        return this.getFrameFromName(args);
      case SA.GET_LIGHT_STATUS: {
        const car = this.damageManagerCar(address, struct);
        if (car === null) {
          return null;
        }
        const light = this.intArg(args, 0);
        const status = this.world.lightStatus(car, light);
        this.op(() => `CDamageManager::GetLightStatus(car#${car}, light ${light}) -> ${status}`);

        return { kind: 'int', value: status };
      }
      case SA.SET_LIGHT_STATUS: {
        const car = this.damageManagerCar(address, struct);
        if (car === null) {
          return null;
        }
        const light = this.intArg(args, 0);
        const status = this.intArg(args, 1);
        this.world.setLightStatus(car, light, status);
        this.op(() => `CDamageManager::SetLightStatus(car#${car}, light ${light}, ${status === 0 ? 'OK' : 'SMASHED'})`);

        return { kind: 'int', value: 0 };
      }
      case SA.SET_ROTATE_X_ONLY: {
        const angle = this.angleArg(args, 0);

        return this.setRotate(address, struct, [quatRotateX(angle)], [angle]);
      }
      case SA.SET_ROTATE_XYZ: {
        const angles = [this.angleArg(args, 0), this.angleArg(args, 1), this.angleArg(args, 2)];

        return this.setRotate(address, struct, [quatFromSaEuler(angles[0], angles[1], angles[2])], angles);
      }
      case SA.SET_ROTATE_Y_ONLY: {
        const angle = this.angleArg(args, 0);

        return this.setRotate(address, struct, [quatRotateY(angle)], [angle]);
      }
      case SA.SET_ROTATE_Z_ONLY: {
        const angle = this.angleArg(args, 0);

        return this.setRotate(address, struct, [quatRotateZ(angle)], [angle]);
      }
      default:
        this.miss('call', address, `unknown function 0x${address.toString(16)}`);

        return null;
    }
  }

  /** `0AEB GET_VEHICLE_REF` — token back to script handle, or null (raw ints are not vehicles). */
  handleOf(value: number): null | number {
    const resolved = this.tokens.resolve(value);

    return resolved?.target.kind === 'vehicle' ? resolved.target.car : null;
  }

  /** `0A97 GET_VEHICLE_POINTER` — the token a script stores as the vehicle's "address". */
  pointerOf(car: number): number {
    return this.tokens.mint({ car, kind: 'vehicle' });
  }

  /** `0A8D READ_MEMORY` at a token or absolute address. */
  read(address: number, size: number): NativeValue {
    if (!isNativeToken(address)) {
      return this.readGlobal(address, size);
    }
    const resolved = this.tokens.resolve(address);
    if (!resolved) {
      this.miss('read', address, 'token entry never minted');

      return null;
    }

    return this.readToken(resolved.target, resolved.offset, size, address);
  }

  /** `0A8C WRITE_MEMORY` — engine mutation, or a reported miss. True when served. */
  write(address: number, size: number, value: { float: number; int: number }): boolean {
    const resolved = this.tokens.resolve(address);
    const matrixField = resolved && resolved.target.kind === 'frame' ? resolved.offset - FRAME_MATRIX : null;
    if (
      resolved &&
      resolved.target.kind === 'frame' &&
      matrixField !== null &&
      matrixField >= MATRIX_POS &&
      matrixField < MATRIX_POS + 12 &&
      size === 4
    ) {
      const axis = ((matrixField - MATRIX_POS) / 4) as 0 | 1 | 2;
      this.world.setPartTranslationComponent(resolved.target.car, resolved.target.part, axis, value.float);
      const { car, part } = resolved.target;
      this.op(() => `write frame(car#${car} part#${part}).matrix.pos.${'xyz'[axis]} = ${traceNumber(value.float)}`);

      return true;
    }
    this.miss('write', address, resolved ? `${resolved.target.kind}+0x${resolved.offset.toString(16)}` : 'raw address');

    return false;
  }

  private angleArg(args: readonly NativeArg[], at: number): number {
    const arg = args[at];
    if (!arg || arg.kind === 'string') {
      return 0;
    }

    return arg.kind === 'raw' ? arg.float : arg.value;
  }

  /** `this` for the light-status calls: a vehicle token offset to `CAutomobile+0x5A0`, and nothing else —
   *  the script reached it with plain arithmetic, so a wrong offset must report rather than guess. */
  private damageManagerCar(address: number, struct: null | number): null | number {
    const resolved = struct === null ? null : this.tokens.resolve(struct);
    if (resolved && resolved.target.kind === 'vehicle' && resolved.offset === VEHICLE_DAMAGE_MANAGER) {
      return resolved.target.car;
    }
    this.miss('call', address, 'this is not a vehicle m_damageManager token');

    return null;
  }

  private getFrameFromName(args: readonly NativeArg[]): NativeValue {
    // C order is (clump, name), but this row identifies BY SHAPE deliberately: a string arg and a
    // token arg are unmistakable, and tolerating either order costs nothing while a mod that lists
    // them the other way stays servable instead of silently resolving a null frame.
    const name = args.find((arg) => arg.kind === 'string')?.value;
    const intOf = (arg: NativeArg): null | number =>
      arg.kind === 'raw' ? arg.int : arg.kind === 'string' ? null : arg.value;
    const clumpArg = args.map(intOf).find((value) => value !== null && isNativeToken(value));
    const clump = clumpArg === undefined || clumpArg === null ? null : this.tokens.resolve(clumpArg);
    if (name === undefined || !clump || clump.target.kind !== 'clump') {
      this.miss('call', SA.GET_FRAME_FROM_NAME, `args did not carry a clump token + name`);

      return null;
    }
    const car = clump.target.car;
    const part = this.world.partIndex(car, name);
    if (part === null) {
      this.op(() => `GetFrameFromName(car#${car}, '${name}') -> null frame (model lacks it)`);

      // A name the model lacks → null frame — real CLEO would crash on the deref; scripts guard it.
      return { kind: 'int', value: 0 };
    }
    this.op(() => `GetFrameFromName(car#${car}, '${name}') -> part ${part}`);

    return { kind: 'int', value: this.tokens.mint({ car, kind: 'frame', part }) };
  }

  /** An integer parameter (a `raw` arg carries both readings; a float one is truncated as the ABI does). */
  private intArg(args: readonly NativeArg[], at: number): number {
    const arg = args[at];
    if (!arg || arg.kind === 'string') {
      return 0;
    }

    return arg.kind === 'raw' ? arg.int : Math.trunc(arg.value);
  }

  private miss(kind: AtlasMiss['kind'], address: number, detail: string): void {
    const key = `${kind}:${address}:${detail}`;
    if (!this.missKeys.has(key)) {
      this.missKeys.add(key);
      this.misses.push({ address, detail, kind });
      this.op(() => `atlas miss: ${kind} 0x${address.toString(16)} — ${detail}`);
    }
  }

  /** Build a trace line only when someone listens — the hot path pays one undefined check. */
  private op(build: () => string): void {
    if (this.onOp) {
      this.onOp(build());
    }
  }

  private readFrameToken(target: Extract<TokenTarget, { kind: 'frame' }>, offset: number, size: number): NativeValue {
    if (size !== 4) {
      return null;
    }
    const label = `frame(car#${target.car} part#${target.part})`;
    if (offset === FRAME_NEXT_SIBLING) {
      const sibling = this.world.nextSiblingPart(target.car, target.part);
      this.op(() => `read ${label}.next -> ${sibling === null ? 'end of chain' : `part ${sibling}`}`);

      return {
        kind: 'int',
        value: sibling === null ? 0 : this.tokens.mint({ car: target.car, kind: 'frame', part: sibling }),
      };
    }
    const field = offset - FRAME_MATRIX;
    if (field >= MATRIX_FORWARD && field < MATRIX_FORWARD + 12) {
      const axis = (field - MATRIX_FORWARD) / 4;
      const value = this.world.partForward(target.car, target.part)[axis];
      this.op(() => `read ${label}.matrix.forward.${'xyz'[axis]} -> ${traceNumber(value)}`);

      return { kind: 'float', value };
    }
    if (field >= MATRIX_POS && field < MATRIX_POS + 12) {
      const axis = (field - MATRIX_POS) / 4;
      const value = this.world.partTranslation(target.car, target.part)[axis];
      this.op(() => `read ${label}.matrix.pos.${'xyz'[axis]} -> ${traceNumber(value)}`);

      return { kind: 'float', value };
    }

    return null;
  }

  private readGlobal(address: number, size: number): NativeValue {
    switch (address) {
      case SA.LOD_DIST_MULTIPLIER: {
        const value = this.world.lodDistMultiplier();
        this.op(() => `read TheCamera.m_fLODDistMultiplier -> ${traceNumber(value)}`);

        return { kind: 'float', value };
      }
      case SA.VEHICLE_POOL:
        this.op(() => 'read CPools::ms_pVehiclePool -> pool');

        return { kind: 'int', value: this.tokens.mint({ kind: 'pool' }) };
      case SA.WEATHER_WIND: {
        const value = this.world.wind();
        this.op(() => `read CWeather::Wind -> ${traceNumber(value)}`);

        return { kind: 'float', value };
      }
      default: {
        // Below SA's image base nothing static lives — such an address is an opaque host token
        // (e.g. GET_MODEL_INFO's) plus an offset, and the LABEL must not embed it: token values
        // differ between the mock and the field, and the declared-tier key has to match both.
        const label = address >= SA_IMAGE_BASE ? `unknown global 0x${address.toString(16)}` : 'non-native address';
        this.miss('read', address, `${label} (size ${size})`);

        return null;
      }
    }
  }

  private readPoolByte(offset: number, size: number): NativeValue {
    if (size !== 1) {
      return null;
    }
    // One slot byte: counter (bit7 clear) when occupied, 0x80 when free — the walk's contract.
    const handle = this.world.vehicleHandles().find((h) => h >> 8 === offset);
    this.op(() => `read pool slot ${offset} -> ${handle === undefined ? 'free' : `counter ${handle & 0xff}`}`);

    return { kind: 'int', value: handle === undefined ? 0x80 : handle & 0xff };
  }

  private readToken(target: TokenTarget, offset: number, size: number, address: number): NativeValue {
    const value =
      target.kind === 'frame'
        ? this.readFrameToken(target, offset, size)
        : target.kind === 'pool' && offset === 4
          ? { kind: 'int' as const, value: this.tokens.mint({ kind: 'poolBytes' }) }
          : target.kind === 'poolBytes'
            ? this.readPoolByte(offset, size)
            : target.kind === 'vehicle'
              ? this.readVehicleToken(target, offset, size)
              : null;
    if (value === null) {
      this.miss('read', address, `${target.kind}+0x${offset.toString(16)} (size ${size})`);
    }

    return value;
  }

  private readVehicleToken(
    target: Extract<TokenTarget, { kind: 'vehicle' }>,
    offset: number,
    size: number,
  ): NativeValue {
    if (size !== 4) {
      return null;
    }
    if (offset === VEHICLE_RW_OBJECT) {
      this.op(() => `read vehicle#${target.car}.m_pRwObject -> clump`);

      return { kind: 'int', value: this.tokens.mint({ car: target.car, kind: 'clump' }) };
    }
    const node = offset - VEHICLE_CAR_NODES;
    if (node >= 0 && node < CAR_NODE_COUNT * 4 && node % 4 === 0) {
      const name = CAR_NODE_NAMES[node / 4];
      const part = name === null || name === undefined ? null : this.world.partIndex(target.car, name);
      this.op(
        () =>
          `read vehicle#${target.car}.m_aCarNodes[${name ?? node / 4}] -> ${part === null ? 'no frame' : `part ${part}`}`,
      );

      return { kind: 'int', value: part === null ? 0 : this.tokens.mint({ car: target.car, kind: 'frame', part }) };
    }

    return null;
  }

  private setRotate(
    address: number,
    struct: null | number,
    [quat]: readonly [readonly [number, number, number, number]],
    angles: readonly number[],
  ): NativeValue {
    const resolved = struct === null ? null : this.tokens.resolve(struct);
    // `this` is the modelling CMatrix: the frame token + 16 (firela adds it with PLAIN arithmetic).
    if (resolved && resolved.target.kind === 'frame' && resolved.offset === FRAME_MATRIX) {
      const { car, part } = resolved.target;
      this.world.setPartRotation(car, part, quat);
      this.op(
        () =>
          `${CALL_SYMBOLS[address] ?? 'call'}(frame(car#${car} part#${part}), ${angles.map(traceNumber).join(', ')} rad)`,
      );

      return { kind: 'int', value: 0 };
    }
    this.miss('call', address, 'this is not a frame matrix token');

    return null;
  }
}

/** Trace symbols for the functions table — the tracer never prints a raw address (decision 2). */
const CALL_SYMBOLS: Readonly<Record<number, string>> = {
  [SA.GET_LIGHT_STATUS]: 'CDamageManager::GetLightStatus',
  [SA.SET_LIGHT_STATUS]: 'CDamageManager::SetLightStatus',
  [SA.SET_ROTATE_X_ONLY]: 'CMatrix::SetRotateXOnly',
  [SA.SET_ROTATE_XYZ]: 'CMatrix::SetRotate',
  [SA.SET_ROTATE_Y_ONLY]: 'CMatrix::SetRotateYOnly',
  [SA.SET_ROTATE_Z_ONLY]: 'CMatrix::SetRotateZOnly',
};

/** Short numbers for trace lines: integers plain, fractions to 3 places. */
function traceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
