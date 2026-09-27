/**
 * 3D endpoint marker layer: one red marker per imported recording endpoint, drawn as engine debug lines.
 *
 * `createDebugLines(..., { throughDepth: true })` compiles to the depth-always pipeline, so a marker is
 * readable over the city even from far away or through a building — the same property the dispatch beacons
 * rely on. Nothing here goes through the DOM or a sprite/points pipeline.
 *
 * ONE Float32Array is allocated for the current endpoint count and RECREATED (never grown) whenever that
 * count changes: `updateDebugLines` writes into the GPU buffer `createDebugLines` sized from the array it was
 * given, so a re-used larger array would overrun a smaller allocation. Density is shown as a ground halo
 * whose radius scales with the cluster count; every endpoint still gets its own pillar and cross, so no
 * individual point is ever hidden or dropped.
 */
import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { gtaToEngine } from './math';
import { buildTrackEndpoints } from './track-endpoints';

/** Marker red. One colour for the whole set — clusters are told apart by halo size, not by hue. */
const MARKER_COLOR: readonly [number, number, number, number] = [1, 0.13, 0.13, 1];
/** Pillar height in engine units, above the endpoint's own altitude. */
const PILLAR_HEIGHT = 140;
/** Half-length of the two ground cross segments through the endpoint. */
const CROSS = 12;
/** Endpoints whose 2D ground separation is at or under this radius belong to the same cluster. */
const CLUSTER_RADIUS = 40;
/** Halo circle segments; each is one line-list segment (6 floats). */
const HALO_SEGMENTS = 20;
/** Halo radius at a 2-endpoint cluster; grows logarithmically with the count. */
const HALO_BASE = 26;
/** Floats per marker: pillar (6) + ground cross (12) + halo ring (HALO_SEGMENTS * 6). */
const FLOATS_PER_MARKER = 18 + HALO_SEGMENTS * 6;

export interface EndpointMarkersOptions {
  /** Called after every setTracks/setActive so the host can refresh its probe. */
  onUpdate?: (stats: EndpointMarkerStats) => void;
}

/** What the host reads for its debug probe after every update. Track IDs are import-list positions. */
export interface EndpointMarkerStats {
  readonly activeTrackIndex: number;
  /** Floats the current GPU allocation was sized for — proof the buffer was recreated for this endpoint set. */
  readonly capacity: number;
  /** Endpoints drawn. Equals the endpoint count from the shared model. */
  readonly count: number;
  /** Largest number of endpoints sharing one cluster (1 = every endpoint is isolated). */
  readonly densityMax: number;
  /** Endpoints that took a density halo (cluster count >= 2). */
  readonly halos: number;
  /** How many times the debug-line set was (re)created; grows whenever the endpoint count changes. */
  readonly recreates: number;
  /** Import-list positions of the tracks that contributed an endpoint, in endpoint order. */
  readonly trackIds: readonly number[];
}

export class EndpointMarkers {
  /** Engine-space anchor (pillar base) of every drawn marker, in marker order — the picking projection input. */
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
  private readonly engine: Engine;
  private halos = 0;
  private readonly onUpdate: ((stats: EndpointMarkerStats) => void) | undefined;
  private positions: Vec3[] = [];
  private recreates = 0;

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

  /**
   * Active selection does not change marker geometry; it re-uploads the same buffer (a cheap no-op write) so
   * a host that only knows about setActive still stays in step with the layer and its probe.
   */
  setActive(trackIndex: number): void {
    this.activeTrackIndex = trackIndex;
    if (this.buffer && this.setId !== null) {
      this.engine.updateDebugLines(this.setId, this.buffer);
    }
    this.emit();
  }

  /** Rebuild from the current import list. One endpoint per track with a finite coordinate, in import order. */
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.activeTrackIndex = activeIndex;
    const endpoints = buildTrackEndpoints(tracks);
    const counts = endpointCounts(endpoints, this.clusterRadius);
    this.densityMax = counts.reduce((max, value) => Math.max(max, value), 0);
    this.halos = counts.filter((value) => value >= 2).length;
    this.trackIds = endpoints.map((endpoint) => endpoint.trackIndex);
    if (endpoints.length === 0) {
      this.release();
    } else {
      const buffer = new Float32Array(endpoints.length * FLOATS_PER_MARKER);
      endpoints.forEach((endpoint, index) =>
        writeMarker(buffer, index * FLOATS_PER_MARKER, endpoint.position, counts[index]),
      );
      this.upload(buffer);
      // Read the anchors back out of the buffer that is actually drawn: picking tests the same engine-space
      // point the pillar starts from, with no second GTA→engine conversion that could drift from the layer.
      // AFTER upload(): a changed count recreates the line set, and that release clears `positions`.
      this.positions = [];
      for (let index = 0; index < endpoints.length; index += 1) {
        const at = index * FLOATS_PER_MARKER;
        this.positions.push([buffer[at], buffer[at + 1], buffer[at + 2]] as Vec3);
      }
    }
    this.emit();
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

  private emit(): void {
    this.onUpdate?.(this.stats());
  }

  /** Destroy the debug-line set; a zero-endpoint layer owns no GPU resources. */
  private release(): void {
    if (this.setId !== null) {
      this.engine.destroyDebugLines(this.setId);
    }
    this.setId = null;
    this.buffer = null;
    this.capacity = 0;
    this.count = 0;
    this.positions = [];
  }

  /**
   * A changed endpoint count means a different allocation is required, so the set is destroyed and recreated
   * at the new size rather than written through the old GPU buffer.
   */
  private upload(buffer: Float32Array): void {
    if (this.setId === null || this.capacity !== buffer.length) {
      this.release();
      this.setId = this.engine.createDebugLines(buffer, MARKER_COLOR, { throughDepth: true });
      this.recreates += 1;
    }
    this.buffer = buffer;
    this.capacity = buffer.length;
    this.count = buffer.length / FLOATS_PER_MARKER;
    if (this.setId !== null) {
      this.engine.updateDebugLines(this.setId, buffer);
    }
  }
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

/** Pillar from the endpoint upward, a cross through it, and a halo ring whose radius reads as density. */
function writeMarker(out: Float32Array, at: number, position: Vec3, clusterCount: number): void {
  const [x, y, z] = gtaToEngine(position[0], position[1], position[2]);
  out.set([x, y, z, x, y + PILLAR_HEIGHT, z], at);
  out.set([x - CROSS, y, z, x + CROSS, y, z], at + 6);
  out.set([x, y, z - CROSS, x, y, z + CROSS], at + 12);
  if (clusterCount < 2) {
    return;
  }
  const radius = HALO_BASE * (1 + Math.log2(clusterCount));
  const ring = y + 1;
  let segment = at + 18;
  for (let i = 0; i < HALO_SEGMENTS; i += 1) {
    const a0 = (i / HALO_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / HALO_SEGMENTS) * Math.PI * 2;
    out.set(
      [
        x + Math.cos(a0) * radius,
        ring,
        z + Math.sin(a0) * radius,
        x + Math.cos(a1) * radius,
        ring,
        z + Math.sin(a1) * radius,
      ],
      segment,
    );
    segment += 6;
  }
}
