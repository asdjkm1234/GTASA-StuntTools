/**
 * World-space endpoint beacons: shaded red spheres with a gently precessing orbit.
 * Each imported endpoint keeps its exact recorded anchor; clusters share one compact density halo.
 * Two persistent GPU sets (solid spheres / fine lines) ignore world depth for visibility.
 * The host supplies an independent animation clock and only enables the layer in free view.
 * Both allocations are recreated together whenever the endpoint count changes.
 */
import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { gtaToEngine } from './math';
import { buildTrackEndpoints } from './track-endpoints';

const MARKER_COLOR: readonly [number, number, number, number] = [1, 0.075, 0.055, 1];
const ORBIT_COLOR: readonly [number, number, number, number] = [0.8, 0.16, 0.11, 1];
const SPHERE_RADIUS = 0.75;
const ORBIT_RADIUS = SPHERE_RADIUS * 1.5;
const CLUSTER_RADIUS = 40;
const HALO_SEGMENTS = 64;
const ORBIT_SEGMENTS = 64;
const HALO_BASE = 4;
const LINE_FLOATS_PER_MARKER = (HALO_SEGMENTS + ORBIT_SEGMENTS) * 6;
const UNIT_SPHERE = buildSphere();
const FLOATS_PER_MARKER = UNIT_SPHERE.length + LINE_FLOATS_PER_MARKER;

export interface EndpointMarkersOptions {
  /** Called after every setTracks/setActive so the host can refresh its probe. */
  onUpdate?: (stats: EndpointMarkerStats) => void;
}

/** What the host reads for its debug probe after every update. Track IDs are import-list positions. */
export interface EndpointMarkerStats {
  readonly activeTrackIndex: number;
  /** Total floats in the solid and line allocations; both are recreated for a changed endpoint count. */
  readonly capacity: number;
  /** Endpoints drawn. Equals the endpoint count from the shared model. */
  readonly count: number;
  /** Largest number of endpoints sharing one cluster (1 = every endpoint is isolated). */
  readonly densityMax: number;
  /** Representative density halos; overlapping endpoints still retain their individual spheres. */
  readonly halos: number;
  /** How many times the paired GPU sets were (re)created; grows when the endpoint count changes. */
  readonly recreates: number;
  /** Import-list positions of the tracks that contributed an endpoint, in endpoint order. */
  readonly trackIds: readonly number[];
}

export class EndpointMarkers {
  /** Engine-space sphere centre of every drawn marker, in marker order — the picking projection input. */
  get markerPositions(): readonly Vec3[] {
    return this.positions;
  }
  /** Import-list position of every drawn marker's track, in marker order. */
  get markerTrackIds(): readonly number[] {
    return this.trackIds;
  }
  private activeTrackIndex = 0;
  private buffer: Float32Array | null = null;
  private capacity = 0;
  private readonly clusterRadius: number;
  private count = 0;
  private densityMax = 0;
  private enabled = false;
  private readonly engine: Engine;
  private haloCounts: number[] = [];
  private halos = 0;
  private lastUpdateSeconds = Number.NaN;
  private lines: Float32Array | null = null;
  private lineSetId: DebugLineSetId | null = null;
  private readonly onUpdate: ((stats: EndpointMarkerStats) => void) | undefined;
  private positions: Vec3[] = [];
  private recreates = 0;
  private seconds = 0;

  private setId: DebugLineSetId | null = null;

  private trackIds: number[] = [];

  constructor(engine: Engine, options: EndpointMarkersOptions = {}, clusterRadius = CLUSTER_RADIUS) {
    this.engine = engine;
    this.onUpdate = options.onUpdate;
    this.clusterRadius = clusterRadius;
  }

  dispose(): void {
    this.release();
  }

  setActive(trackIndex: number): void {
    this.activeTrackIndex = trackIndex;
    this.emit();
  }

  /** One endpoint per track with a finite coordinate, in import order. */
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.activeTrackIndex = activeIndex;
    const endpoints = buildTrackEndpoints(tracks);
    const counts = endpointCounts(endpoints, this.clusterRadius);
    const haloCounts = densityHaloCounts(endpoints, counts, this.clusterRadius);
    const capacity = endpoints.length * FLOATS_PER_MARKER;
    if (capacity !== this.capacity) this.release();
    this.haloCounts = haloCounts;
    this.densityMax = counts.reduce((max, value) => Math.max(max, value), 0);
    this.halos = haloCounts.filter((value) => value >= 2).length;
    this.trackIds = endpoints.map((endpoint) => endpoint.trackIndex);
    this.positions = endpoints.map((endpoint) => gtaToEngine(...endpoint.position));
    this.count = endpoints.length;
    this.capacity = capacity;
    if (this.count > 0) {
      this.buffer ??= new Float32Array(this.count * UNIT_SPHERE.length);
      this.lines ??= new Float32Array(this.count * LINE_FLOATS_PER_MARKER);
      this.lastUpdateSeconds = Number.NaN;
      this.update(this.seconds);
      if (this.setId === null) {
        this.setId = this.engine.createDebugLines(this.buffer, MARKER_COLOR, {
          throughDepth: true,
          triangles: true,
        });
        this.lineSetId = this.engine.createDebugLines(this.lines, ORBIT_COLOR, { throughDepth: true });
        this.engine.setDebugLinesVisible(this.setId, this.enabled);
        this.engine.setDebugLinesVisible(this.lineSetId, this.enabled);
        this.recreates += 1;
      }
    }
    this.emit();
  }

  /** New and rebuilt GPU sets stay hidden until the host explicitly enables free view. */
  setVisible(visible: boolean): void {
    if (this.enabled === visible) return;
    this.enabled = visible;
    if (this.setId !== null) this.engine.setDebugLinesVisible(this.setId, visible);
    if (this.lineSetId !== null) this.engine.setDebugLinesVisible(this.lineSetId, visible);
  }

  stats(): EndpointMarkerStats {
    return {
      activeTrackIndex: this.activeTrackIndex,
      capacity: this.capacity,
      count: this.count,
      densityMax: this.densityMax,
      halos: this.halos,
      recreates: this.recreates,
      trackIds: [...this.trackIds],
    };
  }

  /** Reuse fixed buffers at the supplied animation time, independently of recording playback. */
  update(seconds: number): void {
    this.seconds = Number.isFinite(seconds) ? seconds : 0;
    if (!this.buffer || !this.lines || this.lastUpdateSeconds === this.seconds) return;
    this.positions.forEach((position, index) => {
      const phase = (this.seconds * Math.PI * 2) / 3.6 + index * 0.63;
      const radius = SPHERE_RADIUS * (1 + 0.055 * Math.sin(phase));
      const at = index * UNIT_SPHERE.length;
      for (let vertex = 0; vertex < UNIT_SPHERE.length; vertex += 6) {
        this.buffer![at + vertex] = position[0] + UNIT_SPHERE[vertex] * radius;
        this.buffer![at + vertex + 1] = position[1] + UNIT_SPHERE[vertex + 1] * radius;
        this.buffer![at + vertex + 2] = position[2] + UNIT_SPHERE[vertex + 2] * radius;
        this.buffer![at + vertex + 3] = UNIT_SPHERE[vertex + 3];
        this.buffer![at + vertex + 4] = UNIT_SPHERE[vertex + 4];
        this.buffer![at + vertex + 5] = UNIT_SPHERE[vertex + 5];
      }
      writeRings(this.lines!, index * LINE_FLOATS_PER_MARKER, position, this.haloCounts[index], this.seconds);
    });
    if (this.setId !== null) this.engine.updateDebugLines(this.setId, this.buffer);
    if (this.lineSetId !== null) this.engine.updateDebugLines(this.lineSetId, this.lines);
    this.lastUpdateSeconds = this.seconds;
  }

  private emit(): void {
    this.onUpdate?.(this.stats());
  }

  /** A zero-endpoint layer owns no GPU resources. */
  private release(): void {
    if (this.setId !== null) this.engine.destroyDebugLines(this.setId);
    if (this.lineSetId !== null) this.engine.destroyDebugLines(this.lineSetId);
    this.setId = null;
    this.lineSetId = null;
    this.buffer = null;
    this.lines = null;
    this.capacity = 0;
    this.count = 0;
    this.positions = [];
    this.lastUpdateSeconds = Number.NaN;
  }
}

/** Outward-wound unit sphere; no degenerate pole triangles and no texture uploads. */
function buildSphere(): Float32Array {
  const vertices: number[] = [];
  const point = (latitude: number, longitude: number): Vec3 => {
    const theta = (latitude * Math.PI) / 20;
    const phi = (longitude * Math.PI * 2) / 32;

    return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
  };
  for (let latitude = 0; latitude < 20; latitude += 1) {
    for (let longitude = 0; longitude < 32; longitude += 1) {
      const a = point(latitude, longitude);
      const b = point(latitude + 1, longitude);
      const c = point(latitude + 1, longitude + 1);
      const d = point(latitude, longitude + 1);
      if (latitude > 0) vertices.push(...a, ...a, ...d, ...d, ...b, ...b);
      if (latitude < 19) vertices.push(...d, ...d, ...c, ...c, ...b, ...b);
    }
  }

  return new Float32Array(vertices);
}

/**
 * Give each local group one halo at its densest recorded endpoint, without merging any spheres.
 * Stable import order breaks ties; covered neighbours do not each draw the same oversized ring.
 */
function densityHaloCounts(
  endpoints: readonly { position: Vec3 }[],
  counts: readonly number[],
  radius: number,
): number[] {
  const halos = endpoints.map(() => 0);
  const covered = new Set<number>();
  const order = endpoints.map((_, index) => index).sort((a, b) => counts[b] - counts[a] || a - b);
  for (const index of order) {
    if (counts[index] < 2 || covered.has(index)) continue;
    const neighbours = endpoints.flatMap((endpoint, other) => {
      const dx = endpoint.position[0] - endpoints[index].position[0];
      const dy = endpoint.position[1] - endpoints[index].position[1];

      return !covered.has(other) && dx * dx + dy * dy <= radius * radius ? [other] : [];
    });
    if (neighbours.length < 2) continue;
    halos[index] = neighbours.length;
    neighbours.forEach((neighbour) => covered.add(neighbour));
  }

  return halos;
}

/** 2D ground cluster count per endpoint, including the endpoint itself. O(n²), n = imported tracks. */
function endpointCounts(endpoints: readonly { position: Vec3 }[], radius: number): number[] {
  return endpoints.map((endpoint) => {
    let count = 0;
    for (const other of endpoints) {
      const dx = other.position[0] - endpoint.position[0];
      const dy = other.position[1] - endpoint.position[1];
      if (dx * dx + dy * dy <= radius * radius) {
        count += 1;
      }
    }

    return count;
  });
}

/** A tilted orbital arc precesses slowly; the density footprint stays at the exact anchor. */
function writeRings(out: Float32Array, at: number, position: Vec3, clusterCount: number, seconds: number): void {
  const [x, y, z] = position;
  const turn = (seconds * Math.PI * 2) / 9;
  const orbitPoint = (angle: number): Vec3 => {
    const u = Math.cos(angle) * ORBIT_RADIUS;
    const v = Math.sin(angle) * ORBIT_RADIUS;

    return [
      x + u * Math.cos(turn) - v * 0.6 * Math.sin(turn),
      y + v * 0.8,
      z + u * Math.sin(turn) + v * 0.6 * Math.cos(turn),
    ];
  };
  for (let i = 0; i < ORBIT_SEGMENTS; i += 1) {
    // Small opening reads as a moving orbit instead of a second sphere outline.
    const angle = turn + (i * Math.PI * 1.75) / ORBIT_SEGMENTS;
    out.set([...orbitPoint(angle), ...orbitPoint(angle + (Math.PI * 1.75) / ORBIT_SEGMENTS)], at + i * 6);
  }
  const haloAt = at + ORBIT_SEGMENTS * 6;
  const radius = clusterCount < 2 ? 0 : HALO_BASE * (1 + Math.log2(clusterCount));
  for (let i = 0; i < HALO_SEGMENTS; i += 1) {
    const a = (i * Math.PI * 2) / HALO_SEGMENTS;
    const b = ((i + 1) * Math.PI * 2) / HALO_SEGMENTS;
    out.set(
      [
        x + Math.cos(a) * radius,
        y + 1,
        z + Math.sin(a) * radius,
        x + Math.cos(b) * radius,
        y + 1,
        z + Math.sin(b) * radius,
      ],
      haloAt + i * 6,
    );
  }
}
