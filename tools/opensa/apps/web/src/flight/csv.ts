/**
 * Flight CSV reader. The recorder's columns are read by NAME, so older rows and v7 rows all load:
 * a missing column is `null`, never a wrong number. Orientation is built from the recorded right/up/forward
 * basis and interpolated by quaternion SLERP — never by blending the raw matrix, which is what produced the
 * flattened-plane / frozen-heading artefacts.
 */
import type { Quat, Vec3 } from './math';

import { conjugate, normalizeQuat, orientationFromGta, quatMultiply, slerp } from './math';

/** The seven v6 nodes followed by the two Hydra center gear nodes added in v7. */
export const NODE_NAMES = ['rudder', 'elevator_l', 'elevator_r', 'aileron_l', 'aileron_r', 'gear_l', 'gear_r', 'misc_a', 'misc_b'] as const;

export interface FlightRow {
  s: number;
  timeMs: number;
  model: number;
  health: number;
  pos: Vec3;
  heading: number;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  velocity: Vec3;
  steer: number;
  throttle: number;
  brake: number;
  colors: number[];
  gear: number;
  keyQ: number;
  keyA: number;
  keyE: number;
  keyD: number;
  keyUp: number;
  keyDown: number;
  gameHour: number | null;
  gameMinute: number | null;
  gameSecond: number | null;
  weatherNew: number | null;
  weatherOld: number | null;
  weatherForced: number | null;
  nodeStatus: number;
  /** Hydra's game nozzle rotation value (0..5000); absent in older CSVs. */
  nozzleRotation: number | null;
  nozzleRotationPrevious: number | null;
  /** Raw CPlane prop slots 12..15, kept for validating model-specific animation. */
  propNodes: (Quat | null)[];
  smokeActive: boolean | null;
  /** Real local rotation per {@link NODE_NAMES}, or null when the recorder could not read that node. */
  nodes: (Quat | null)[];
  /** Orientation quaternion in engine space, precomputed once. */
  orientation: Quat;
}

export interface FlightTrack {
  name: string;
  version: number;
  model: number;
  rows: FlightRow[];
  events: FlightEvent[];
  duration: number;
  hasRealNodes: boolean;
  axesNote: string;
}

export interface FlightEvent {
  s: number;
  kind: 'explosion';
  pos: Vec3;
}

export interface SampledPose {
  row: FlightRow;
  pos: Vec3;
  orientation: Quat;
  nodes: (Quat | null)[];
  velocity: Vec3;
  speed: number;
}

const num = (value: string | undefined): number | null => {
  if (value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

function quatColumns(map: Map<string, number>, cells: string[], base: string): Quat | null {
  const qx = num(cells[map.get(`${base}_qx`) ?? -1]);
  const qy = num(cells[map.get(`${base}_qy`) ?? -1]);
  const qz = num(cells[map.get(`${base}_qz`) ?? -1]);
  const qw = num(cells[map.get(`${base}_qw`) ?? -1]);
  if (qx === null || qy === null || qz === null || qw === null) {
    return null;
  }

  return normalizeQuat([qx, qy, qz, qw]);
}

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
    const [, seconds, kind, x, y, z] = line.split(',').map((cell) => cell.trim());
    const s = Number(seconds);
    const pos = [Number(x), Number(y), Number(z)] as Vec3;
    if (kind === 'explosion' && Number.isFinite(s) && s >= 0 && pos.every(Number.isFinite)) {
      events.push({ s, kind, pos });
    }
  }
  events.sort((a, b) => a.s - b.s);
  const rows: FlightRow[] = [];
  let baseTime = Number.NaN;
  for (const line of rawRows) {
    const cells = line.split(',');
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
    const right: Vec3 = [num(cells[map.get('right_x') ?? -1]) ?? 1, num(cells[map.get('right_y') ?? -1]) ?? 0, num(cells[map.get('right_z') ?? -1]) ?? 0];
    const up: Vec3 = [num(cells[map.get('up_x') ?? -1]) ?? 0, num(cells[map.get('up_y') ?? -1]) ?? 0, num(cells[map.get('up_z') ?? -1]) ?? 1];
    const forward: Vec3 = [num(cells[map.get('forward_x') ?? -1]) ?? 0, num(cells[map.get('forward_y') ?? -1]) ?? 1, num(cells[map.get('forward_z') ?? -1]) ?? 0];
    const nodes = NODE_NAMES.map((node) => quatColumns(map, cells, node));
    const propNodes = [12, 13, 14, 15].map((index) => quatColumns(map, cells, `prop_${index}`));
    const nozzleRaw = num(cells[map.get('nozzle_rotation') ?? -1]);
    const nozzlePreviousRaw = num(cells[map.get('nozzle_rotation_previous') ?? -1]);
    const smokeRaw = num(cells[map.get('smoke_active') ?? -1]);
    const nodeStatus = num(cells[map.get('node_status') ?? -1]) ?? (nodes.some((q) => q) ? 0x7f : 0);
    const fallbackTime = rows.length === 0 ? 0 : rows[rows.length - 1].s + 0.04;
    rows.push({
      s: captureElapsed !== null && captureElapsed >= 0 ? captureElapsed
        : Number.isNaN(timeMs) || Number.isNaN(baseTime) ? fallbackTime : (timeMs - baseTime) / 1000,
      timeMs: Number.isNaN(timeMs) ? 0 : timeMs,
      model: num(cells[map.get('model') ?? -1]) ?? 0,
      health: num(cells[map.get('health') ?? -1]) ?? 0,
      pos: [x, y, z],
      heading: num(cells[map.get('heading_deg') ?? -1]) ?? 0,
      right, up, forward,
      velocity: [num(cells[map.get('vx') ?? -1]) ?? 0, num(cells[map.get('vy') ?? -1]) ?? 0, num(cells[map.get('vz') ?? -1]) ?? 0],
      steer: num(cells[map.get('steer') ?? -1]) ?? 0,
      throttle: num(cells[map.get('throttle') ?? -1]) ?? 0,
      brake: num(cells[map.get('brake') ?? -1]) ?? 0,
      colors: [num(cells[map.get('color_primary') ?? -1]), num(cells[map.get('color_secondary') ?? -1]), num(cells[map.get('color_tertiary') ?? -1]), num(cells[map.get('color_quaternary') ?? -1])].map((v) => v ?? 0),
      gear: num(cells[map.get('landing_gear_status') ?? -1]) ?? 0,
      keyQ: num(cells[map.get('key_q') ?? -1]) ?? 0,
      keyA: num(cells[map.get('key_a') ?? -1]) ?? 0,
      keyE: num(cells[map.get('key_e') ?? -1]) ?? 0,
      keyD: num(cells[map.get('key_d') ?? -1]) ?? 0,
      keyUp: num(cells[map.get('key_up') ?? -1]) ?? 0,
      keyDown: num(cells[map.get('key_down') ?? -1]) ?? 0,
      gameHour: num(cells[map.get('game_hour') ?? -1]),
      gameMinute: num(cells[map.get('game_minute') ?? -1]),
      gameSecond: num(cells[map.get('game_second') ?? -1]),
      weatherNew: num(cells[map.get('weather_new') ?? -1]),
      weatherOld: num(cells[map.get('weather_old') ?? -1]),
      weatherForced: num(cells[map.get('weather_forced') ?? -1]),
      nodeStatus,
      nozzleRotation: nozzleRaw !== null && nozzleRaw >= 0 ? nozzleRaw : null,
      nozzleRotationPrevious: nozzlePreviousRaw !== null && nozzlePreviousRaw >= 0 ? nozzlePreviousRaw : null,
      propNodes,
      smokeActive: smokeRaw !== null && smokeRaw >= 0 ? smokeRaw !== 0 : null,
      nodes,
      orientation: orientationFromGta(
        legacyAxes ? up : right,
        legacyAxes ? forward : up,
        legacyAxes ? right : forward,
      ),
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
    hasRealNodes: rows.some((row) => row.nodeStatus !== 0 && row.nodes.some((q) => q)),
    model: rows[0].model,
    name,
    rows,
    events,
    version,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
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
    return qa && qb ? slerp(qa, qb, t) : qa ?? qb;
  });
  const row: FlightRow = {
    ...a,
    pos: lerpVec(a.pos, b.pos, t),
    velocity: lerpVec(a.velocity, b.velocity, t),
    heading: lerp(a.heading, b.heading, t),
    health: lerp(a.health, b.health, t),
    gear: lerp(a.gear, b.gear, t),
    gameHour: a.gameHour,
    gameMinute: a.gameMinute,
    weatherNew: a.weatherNew ?? b.weatherNew,
    weatherOld: a.weatherOld ?? b.weatherOld,
    nodeStatus: a.nodeStatus,
    nodes,
    propNodes,
    nozzleRotation: a.nozzleRotation !== null && b.nozzleRotation !== null
      ? lerp(a.nozzleRotation, b.nozzleRotation, t) : a.nozzleRotation ?? b.nozzleRotation,
    nozzleRotationPrevious: a.nozzleRotationPrevious,
    smokeActive: a.smokeActive,
  };

  return buildPose(row, orientation, nodes);
}

function buildPose(row: FlightRow, orientation: Quat, nodes: (Quat | null)[]): SampledPose {
  const speed = Math.hypot(row.velocity[0], row.velocity[1], row.velocity[2]);

  return { nodes, orientation, pos: row.pos, row, speed, velocity: row.velocity };
}

/** The animation rotation to hand `setPartRotation`, given the node's bind rotation. */
export function relativeNodeRotation(bind: Quat, recorded: Quat): Quat {
  return quatMultiply(conjugate(bind), recorded);
}
