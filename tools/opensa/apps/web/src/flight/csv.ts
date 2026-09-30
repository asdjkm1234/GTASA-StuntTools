/**
 * Flight CSV reader. The recorder's columns are read by NAME, so older rows and v7 rows all load:
 * a missing column is `null`, never a wrong number. Orientation is built from the recorded right/up/forward
 * basis and interpolated by quaternion SLERP — never by blending the raw matrix, which is what produced the
 * flattened-plane / frozen-heading artefacts.
 */
import type { Quat, Vec3 } from './math';

import { conjugate, normalizeQuat, orientationFromGta, quatMultiply, slerp } from './math';

/** The seven v6 nodes followed by the two Hydra center gear nodes added in v7. */
export const NODE_NAMES = [
  'rudder',
  'elevator_l',
  'elevator_r',
  'aileron_l',
  'aileron_r',
  'gear_l',
  'gear_r',
  'misc_a',
  'misc_b',
] as const;

export const SURFACE_NAMES = ['rudder', 'elevator_l', 'elevator_r', 'aileron_l', 'aileron_r'] as const;

export interface SurfaceDamage {
  /** Original aircraft 2-bit slots, not the automobile 4-bit panel encoding. */
  raw: null | number;
  source: 'game_memory' | 'unknown';
  /** 0 intact, 1 damaged, 2 detached, 3 preserved raw/other; null unknown. */
  states: (null | number)[];
  validMask: number;
}

/** Every reason the recorder writes on its `# session_end` line. `unknown` means the line was absent or unreadable. */
export const SESSION_END_REASONS = [
  'game_closed',
  'player_left_vehicle_or_vehicle_destroyed',
  'non_target_vehicle',
  'vehicle_changed',
  'quickhome_teleport_detected',
] as const;

export interface FlightEvent {
  /**
   * Peak-hold acceleration magnitude (m/s^2) of an INFERRED collision, derived by the recorder from a health
   * delta plus an acceleration spike. Absent on explosions. It is a derived proxy, not a measured impulse.
   */
  impact?: number;
  kind: 'collision' | 'explosion';
  pos: Vec3;
  s: number;
  /** Source token of an inferred collision, always `inferred`; a measured surface material is never recorded. */
  surface?: 'inferred';
}

export interface FlightRow {
  brake: number;
  colors: number[];
  /**
   * v9 INFERRED engine load, `clamp(max(abs(throttle), abs(brake)), 0, 1)`; the matching
   * `engine_load_source` column is always `inferred`. `null` when the column is absent (pre-v9). Engine
   * rev/RPM is BLOCKED (G3) and is not emitted, so it is never derived here.
   */
  engineLoadInferred: null | number;
  forward: Vec3;
  gameHour: null | number;
  gameMinute: null | number;
  gameSecond: null | number;
  gear: number;
  heading: number;
  health: number;
  keyA: number;
  keyboardStateValid: boolean;
  keyD: number;
  keyDown: number;
  keyE: number;
  /** v11 physical default keys, null when absent, invalid or the game lacked keyboard focus. */
  keyLeft: null | number;
  keyQ: number;
  keyRight: null | number;
  keyS: null | number;
  keyUp: number;
  keyW: null | number;
  model: number;
  /** Real local rotation per {@link NODE_NAMES}, or null when the recorder could not read that node. */
  nodes: (null | Quat)[];
  nodeStatus: number;
  /** Hydra's game nozzle rotation value (0..5000); absent in older CSVs. */
  nozzleRotation: null | number;
  nozzleRotationPrevious: null | number;
  /** Orientation quaternion in engine space, precomputed once. */
  orientation: Quat;
  pos: Vec3;
  /** Raw CPlane prop slots 12..15, kept for validating model-specific animation. */
  propNodes: (null | Quat)[];
  right: Vec3;
  s: number;
  smokeActive: boolean | null;
  steer: number;
  /** v10 measured damage slots; independent of animated-node availability and health. */
  surfaceDamage: SurfaceDamage;
  throttle: number;
  timeMs: number;
  /**
   * v9 INFERRED transmission gear, bounded [0,6] by the recorder's documented speed/throttle heuristic.
   * The matching `transmission_gear_source` column is always `inferred`; a measured gear is never recorded.
   * `null` when the column is absent (pre-v9) — never guessed from the samples.
   */
  transmissionGearInferred: null | number;
  up: Vec3;
  velocity: Vec3;
  weatherForced: null | number;
  weatherNew: null | number;
  weatherOld: null | number;
}

export interface FlightTrack {
  axesNote: string;
  duration: number;
  /** Why the recorder closed the session; `unknown` when the line is absent or unreadable — never guessed. */
  endReason: SessionEndReason;
  events: FlightEvent[];
  hasRealNodes: boolean;
  model: number;
  name: string;
  rows: FlightRow[];
  version: number;
}

export interface SampledPose {
  nodes: (null | Quat)[];
  orientation: Quat;
  pos: Vec3;
  row: FlightRow;
  speed: number;
  velocity: Vec3;
}

/** Why a recording ended. `unknown` is never guessed from the samples — only read from the session line. */
export type SessionEndReason = 'unknown' | (typeof SESSION_END_REASONS)[number];

const num = (value: string | undefined): null | number => {
  if (value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

/** Parse one recorder CSV. Throws a human message when the file is not a recorder CSV. */
export function parseFlightCsv(text: string, name: string): FlightTrack {
  const lines = text.trim().split(/\r?\n/);
  const meta = lines.filter((line) => line.startsWith('#'));
  const headerIndex = lines.findIndex((line) => line.startsWith('local_timestamp,'));
  if (headerIndex < 0) {
    throw new Error(`${name} 不是 FlightRecorder CSV（缺少表头）`);
  }
  const header = lines[headerIndex].split(',').map((cell) => cell.trim());
  const map = new Map(header.map((cell, index) => [cell, index]));
  const version = Number(/(?:^|,)version=(\d+)/.exec(meta.join('\n'))?.[1] ?? 5);
  const legacyAxes = version <= 4;

  const rawRows = lines.slice(headerIndex + 1).filter((line) => line && !line.startsWith('#'));
  const events: FlightEvent[] = [];
  for (const line of meta) {
    if (!line.startsWith('# event,')) continue;
    const event = parseEventLine(line);
    // Collisions are a v9 signal; a stray collision line in an older file is ignored, never misread.
    if (event && (event.kind !== 'collision' || version >= 9)) {
      events.push(event);
    }
  }
  events.sort((a, b) => a.s - b.s);
  const rows: FlightRow[] = [];
  let baseTime = Number.NaN;
  for (const line of rawRows) {
    const cells = line.split(',');
    const keyboard = parseKeyboard(map, cells, version);
    const timeMs = Date.parse(cells[map.get('local_timestamp') ?? 0]);
    const captureElapsed = num(cells[map.get('capture_elapsed_s') ?? -1]);
    const x = num(cells[map.get('x') ?? -1]);
    const y = num(cells[map.get('y') ?? -1]);
    const z = num(cells[map.get('z') ?? -1]);
    if (x === null || y === null || z === null) {
      continue;
    }
    if (Number.isNaN(baseTime) && !Number.isNaN(timeMs)) {
      baseTime = timeMs;
    }
    const right: Vec3 = [
      num(cells[map.get('right_x') ?? -1]) ?? 1,
      num(cells[map.get('right_y') ?? -1]) ?? 0,
      num(cells[map.get('right_z') ?? -1]) ?? 0,
    ];
    const up: Vec3 = [
      num(cells[map.get('up_x') ?? -1]) ?? 0,
      num(cells[map.get('up_y') ?? -1]) ?? 0,
      num(cells[map.get('up_z') ?? -1]) ?? 1,
    ];
    const forward: Vec3 = [
      num(cells[map.get('forward_x') ?? -1]) ?? 0,
      num(cells[map.get('forward_y') ?? -1]) ?? 1,
      num(cells[map.get('forward_z') ?? -1]) ?? 0,
    ];
    const nodes = NODE_NAMES.map((node) => quatColumns(map, cells, node));
    const propNodes = [12, 13, 14, 15].map((index) => quatColumns(map, cells, `prop_${index}`));
    const nozzleRaw = num(cells[map.get('nozzle_rotation') ?? -1]);
    const nozzlePreviousRaw = num(cells[map.get('nozzle_rotation_previous') ?? -1]);
    const smokeRaw = num(cells[map.get('smoke_active') ?? -1]);
    const nodeStatus = num(cells[map.get('node_status') ?? -1]) ?? (nodes.some((q) => q) ? 0x7f : 0);
    const fallbackTime = rows.length === 0 ? 0 : rows[rows.length - 1].s + 0.04;
    rows.push({
      brake: num(cells[map.get('brake') ?? -1]) ?? 0,
      colors: [
        num(cells[map.get('color_primary') ?? -1]),
        num(cells[map.get('color_secondary') ?? -1]),
        num(cells[map.get('color_tertiary') ?? -1]),
        num(cells[map.get('color_quaternary') ?? -1]),
      ].map((v) => v ?? 0),
      engineLoadInferred: num(cells[map.get('engine_load_inferred') ?? -1]),
      forward,
      gameHour: num(cells[map.get('game_hour') ?? -1]),
      gameMinute: num(cells[map.get('game_minute') ?? -1]),
      gameSecond: num(cells[map.get('game_second') ?? -1]),
      gear: num(cells[map.get('landing_gear_status') ?? -1]) ?? 0,
      heading: num(cells[map.get('heading_deg') ?? -1]) ?? 0,
      health: num(cells[map.get('health') ?? -1]) ?? 0,
      keyA: num(cells[map.get('key_a') ?? -1]) ?? 0,
      keyboardStateValid: keyboard.valid,
      keyD: num(cells[map.get('key_d') ?? -1]) ?? 0,
      keyDown: num(cells[map.get('key_down') ?? -1]) ?? 0,
      keyE: num(cells[map.get('key_e') ?? -1]) ?? 0,
      keyLeft: keyboard.left,
      keyQ: num(cells[map.get('key_q') ?? -1]) ?? 0,
      keyRight: keyboard.right,
      keyS: keyboard.s,
      keyUp: num(cells[map.get('key_up') ?? -1]) ?? 0,
      keyW: keyboard.w,
      model: num(cells[map.get('model') ?? -1]) ?? 0,
      nodes,
      nodeStatus,
      nozzleRotation: nozzleRaw !== null && nozzleRaw >= 0 ? nozzleRaw : null,
      nozzleRotationPrevious: nozzlePreviousRaw !== null && nozzlePreviousRaw >= 0 ? nozzlePreviousRaw : null,
      orientation: orientationFromGta(legacyAxes ? up : right, legacyAxes ? forward : up, legacyAxes ? right : forward),
      pos: [x, y, z],
      propNodes,
      right,
      s:
        captureElapsed !== null && captureElapsed >= 0
          ? captureElapsed
          : Number.isNaN(timeMs) || Number.isNaN(baseTime)
            ? fallbackTime
            : (timeMs - baseTime) / 1000,
      smokeActive: smokeRaw !== null && smokeRaw >= 0 ? smokeRaw !== 0 : null,
      steer: num(cells[map.get('steer') ?? -1]) ?? 0,
      surfaceDamage: parseSurfaceDamage(map, cells, version, num(cells[map.get('model') ?? -1]) ?? 0),
      throttle: num(cells[map.get('throttle') ?? -1]) ?? 0,
      timeMs: Number.isNaN(timeMs) ? 0 : timeMs,
      transmissionGearInferred: num(cells[map.get('transmission_gear_inferred') ?? -1]),
      up,
      velocity: [
        num(cells[map.get('vx') ?? -1]) ?? 0,
        num(cells[map.get('vy') ?? -1]) ?? 0,
        num(cells[map.get('vz') ?? -1]) ?? 0,
      ],
      weatherForced: num(cells[map.get('weather_forced') ?? -1]),
      weatherNew: num(cells[map.get('weather_new') ?? -1]),
      weatherOld: num(cells[map.get('weather_old') ?? -1]),
    });
  }
  if (rows.length < 2) {
    throw new Error(`${name} 没有足够的采样`);
  }
  // Older CSVs have only wall-clock timestamps. A clock step must not break binary search.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].s < rows[i - 1].s) {
      rows[i].s = rows[i - 1].s + 0.001;
    }
  }

  return {
    axesNote: legacyAxes ? '完整矩阵（v4 轴兼容）' : `完整矩阵（v${version}）`,
    duration: rows[rows.length - 1].s,
    endReason: parseEndReason(meta),
    events,
    hasRealNodes: rows.some((row) => row.nodeStatus !== 0 && row.nodes.some((q) => q)),
    model: rows[0].model,
    name,
    rows,
    version,
  };
}

/** The animation rotation to hand `setPartRotation`, given the node's bind rotation. */
export function relativeNodeRotation(bind: Quat, recorded: Quat): Quat {
  return quatMultiply(conjugate(bind), recorded);
}

/** Sample the track at `s` seconds: lerp position/scalars, SLERP orientation and node rotations. */
export function sampleTrack(track: FlightTrack, s: number): SampledPose {
  const rows = track.rows;
  const clamped = Math.min(Math.max(0, s), track.duration);
  if (clamped <= 0) {
    return buildPose(rows[0], rows[0].orientation, rows[0].nodes);
  }
  const last = rows[rows.length - 1];
  if (clamped >= track.duration) {
    return buildPose(last, last.orientation, last.nodes);
  }
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].s <= clamped) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = rows[lo];
  const b = rows[hi];
  const t = (clamped - a.s) / Math.max(1e-6, b.s - a.s);
  const orientation = slerp(a.orientation, b.orientation, t);
  const nodes = a.nodes.map((qa, index) => {
    const qb = b.nodes[index];
    if (!qa || !qb) {
      return qa ?? qb;
    }

    return slerp(qa, qb, t);
  });
  const propNodes = a.propNodes.map((qa, index) => {
    const qb = b.propNodes[index];

    return qa && qb ? slerp(qa, qb, t) : (qa ?? qb);
  });
  const row: FlightRow = {
    ...a,
    gameHour: a.gameHour,
    gameMinute: a.gameMinute,
    gear: lerp(a.gear, b.gear, t),
    heading: lerp(a.heading, b.heading, t),
    health: lerp(a.health, b.health, t),
    nodes,
    nodeStatus: a.nodeStatus,
    nozzleRotation:
      a.nozzleRotation !== null && b.nozzleRotation !== null
        ? lerp(a.nozzleRotation, b.nozzleRotation, t)
        : (a.nozzleRotation ?? b.nozzleRotation),
    nozzleRotationPrevious: a.nozzleRotationPrevious,
    pos: lerpVec(a.pos, b.pos, t),
    propNodes,
    smokeActive: a.smokeActive,
    velocity: lerpVec(a.velocity, b.velocity, t),
    weatherNew: a.weatherNew ?? b.weatherNew,
    weatherOld: a.weatherOld ?? b.weatherOld,
  };

  return buildPose(row, orientation, nodes);
}

function buildPose(row: FlightRow, orientation: Quat, nodes: (null | Quat)[]): SampledPose {
  const speed = Math.hypot(row.velocity[0], row.velocity[1], row.velocity[2]);

  return { nodes, orientation, pos: row.pos, row, speed, velocity: row.velocity };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** `# session_end,<reason>,<timestamp>` → a known reason, else `unknown` for an absent, blank or truncated line. */
function parseEndReason(meta: readonly string[]): SessionEndReason {
  const line = meta.find((entry) => entry === '# session_end' || entry.startsWith('# session_end,'));
  if (!line) {
    return 'unknown';
  }
  const reason = line.split(',')[1]?.trim();
  const known = SESSION_END_REASONS.find((candidate) => candidate === reason);

  return known ?? 'unknown';
}

/**
 * `# event,<seconds>,explosion,<x>,<y>,<z>` or `# event,<seconds>,collision,inferred,<impact>,<x>,<y>,<z>`.
 * A malformed or truncated line returns null (never throws). A collision whose surface token is anything but
 * `inferred` is rejected outright, so a measured material name can never reach the replay.
 */
function parseEventLine(line: string): FlightEvent | null {
  const cells = line.split(',').map((cell) => cell.trim());
  const s = Number(cells[1]);
  if (!Number.isFinite(s) || s < 0) {
    return null;
  }
  if (cells[2] === 'explosion') {
    const pos = [Number(cells[3]), Number(cells[4]), Number(cells[5])] as Vec3;

    return pos.every(Number.isFinite) ? { kind: 'explosion', pos, s } : null;
  }
  if (cells[2] === 'collision') {
    const impact = Number(cells[4]);
    const pos = [Number(cells[5]), Number(cells[6]), Number(cells[7])] as Vec3;
    if (cells[3] !== 'inferred' || !Number.isFinite(impact) || impact < 0 || !pos.every(Number.isFinite)) {
      return null;
    }

    return { impact, kind: 'collision', pos, s, surface: 'inferred' };
  }

  return null;
}

function parseKeyboard(
  map: Map<string, number>,
  cells: string[],
  version: number,
): {
  left: null | number;
  right: null | number;
  s: null | number;
  valid: boolean;
  w: null | number;
} {
  const at = (key: string): null | number => num(cells[map.get(`key_${key}`) ?? -1]);
  const valid =
    version >= 11 &&
    num(cells[map.get('keyboard_state_valid') ?? -1]) === 1 &&
    ['q', 'w', 'e', 'a', 's', 'd', 'up', 'down', 'left', 'right'].every((key) => at(key) === 0 || at(key) === 1);

  return {
    left: valid ? at('left') : null,
    right: valid ? at('right') : null,
    s: valid ? at('s') : null,
    valid,
    w: valid ? at('w') : null,
  };
}

function parseSurfaceDamage(map: Map<string, number>, cells: string[], version: number, model: number): SurfaceDamage {
  const unknown: SurfaceDamage = { raw: null, source: 'unknown', states: SURFACE_NAMES.map(() => null), validMask: 0 };
  if (version < 10 || (model !== 520 && model !== 476)) return unknown;
  const source = cells[map.get('surface_damage_source') ?? -1];
  const valid = num(cells[map.get('surface_damage_valid') ?? -1]);
  const raw = num(cells[map.get('plane_damage_raw') ?? -1]);
  if (
    source !== 'game_memory' ||
    valid === null ||
    !Number.isInteger(valid) ||
    valid < 1 ||
    valid > 31 ||
    raw === null ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > 0xffffffff
  )
    return unknown;
  let validMask = 0;
  const states = SURFACE_NAMES.map((name, i) => {
    const state = num(cells[map.get(`${name}_damage`) ?? -1]);
    if (!(valid & (1 << i)) || state === null || !Number.isInteger(state) || state !== ((raw >>> (8 + i * 2)) & 3)) {
      return null;
    }
    validMask |= 1 << i;

    return state;
  });

  return validMask ? { raw, source: 'game_memory', states, validMask } : unknown;
}

function quatColumns(map: Map<string, number>, cells: string[], base: string): null | Quat {
  const qx = num(cells[map.get(`${base}_qx`) ?? -1]);
  const qy = num(cells[map.get(`${base}_qy`) ?? -1]);
  const qz = num(cells[map.get(`${base}_qz`) ?? -1]);
  const qw = num(cells[map.get(`${base}_qw`) ?? -1]);
  if (qx === null || qy === null || qz === null || qw === null) {
    return null;
  }

  return normalizeQuat([qx, qy, qz, qw]);
}
