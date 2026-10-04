import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { FlightRow, FlightTrack } from './csv';
import type { Vec3 } from './math';

import { gtaToEngine } from './math';

export const ROUTE_COLORS = {
  green: [0.12, 1, 0.35, 1],
  red: [1, 0.12, 0.1, 1],
  unknown: [0.65, 0.72, 0.8, 1],
  yellow: [1, 0.8, 0.08, 1],
} as const;
export type RouteState = keyof typeof ROUTE_COLORS;
const ARROW_SPACING = 80;

/** One selected recording, uploaded only on track changes; camera/playback never rebuild the geometry. */
export class FlightRoute {
  counts: Record<RouteState, number> = { green: 0, red: 0, unknown: 0, yellow: 0 };
  private readonly sets: DebugLineSetId[] = [];
  private track: FlightTrack | null = null;
  private visible = false;

  constructor(private readonly engine: Engine) {}

  dispose(): void {
    for (const id of this.sets) this.engine.destroyDebugLines(id);
    this.sets.length = 0;
    this.track = null;
  }

  setTrack(track: FlightTrack): void {
    if (track === this.track) return;
    this.dispose();
    this.track = track;
    const lines = buildFlightRoute(track);
    for (const color of Object.keys(ROUTE_COLORS) as RouteState[]) {
      this.counts[color] = lines[color].length / 6;
      if (!lines[color].length) continue;
      const id = this.engine.createDebugLines(lines[color], ROUTE_COLORS[color], { throughDepth: true });
      this.sets.push(id);
      this.engine.setDebugLinesVisible(id, this.visible);
    }
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const id of this.sets) this.engine.setDebugLinesVisible(id, visible);
  }
}

/** Exact recorded polyline, split at the interpolated health threshold, with spaced direction arrows. */
export function buildFlightRoute(track: FlightTrack): Record<RouteState, Float32Array> {
  const lines: Record<RouteState, number[]> = { green: [], red: [], unknown: [], yellow: [] };
  let distanceToArrow = ARROW_SPACING;
  for (let i = 1; i < track.rows.length; i++) {
    const a = track.rows[i - 1],
      b = track.rows[i];
    if (![...a.pos, ...b.pos].every(Number.isFinite) || b.s <= a.s) continue;
    const end = gtaToEngine(...b.pos),
      start = gtaToEngine(...a.pos);
    const delta = end.map((value, axis) => value - start[axis]) as Vec3;
    const length = Math.hypot(...delta);
    if (length < 0.001) continue;
    const point = (t: number): Vec3 => start.map((value, axis) => value + delta[axis] * t) as Vec3;
    const health = (t: number): number => a.health + (b.health - a.health) * t;
    const crossing = (250 - a.health) / (b.health - a.health);
    const stops = Number.isFinite(crossing) && crossing > 0 && crossing < 1 ? [0, crossing, 1] : [0, 1];
    for (let n = 1; n < stops.length; n++) {
      const from = stops[n - 1],
        to = stops[n];
      lines[routeState(a, health((from + to) / 2))].push(...point(from), ...point(to));
    }
    const forward = delta.map((value) => value / length) as Vec3;
    const sideLength = Math.hypot(forward[0], forward[2]);
    const side: Vec3 = sideLength > 0.001 ? [-forward[2] / sideLength, 0, forward[0] / sideLength] : [1, 0, 0];
    while (distanceToArrow <= length) {
      const t = distanceToArrow / length;
      const tip = point(t);
      const color = routeState(a, health(t));
      for (const sign of [-1, 1]) {
        const tail = tip.map((value, axis) => value - forward[axis] * 5 + side[axis] * sign * 2.5) as Vec3;
        lines[color].push(...tail, ...tip);
      }
      distanceToArrow += ARROW_SPACING;
    }
    distanceToArrow -= length;
  }

  return {
    green: new Float32Array(lines.green),
    red: new Float32Array(lines.red),
    unknown: new Float32Array(lines.unknown),
    yellow: new Float32Array(lines.yellow),
  };
}

/** Red has priority; only five valid, measured intact slots establish green. */
export function routeState(row: FlightRow, health = row.health): RouteState {
  if (Number.isFinite(health) && health < 250) return 'red';
  const damage = row.surfaceDamage;
  if (damage.source !== 'game_memory') return 'unknown';
  const states = Array.from({ length: 5 }, (_, i) => (damage.validMask & (1 << i) ? damage.states[i] : null));
  if (states.some((state) => state !== null && state !== undefined && state > 0)) return 'yellow';

  return states.every((state) => state === 0) ? 'green' : 'unknown';
}
