/**
 * Road car placements (074 bench realism): scatter TYPED cars from `vehicles.ide` along the game's OWN
 * road graph (`NODES*.DAT` vehicle path nodes) — dense in cities, sparse in the countryside, deterministic
 * for a seed, so a bench sweep measures a REAL vehicle load instead of an empty street. Renderer-agnostic:
 * the product is plain {@link VehiclePlacement}s for the vehicle-lod system's lazy `register`.
 */
import type { AssetFileSystem, VehiclePathNode } from '@opensa/renderware';

import { parseVehicleDefs, vehiclePathNodes } from '@opensa/renderware';

import type { BenchScene } from '../perf/bench';
import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';

import { pathAreaFiles } from './path-graph';
import { positionSeed } from './popcycle-cars';

export interface RoadCarOptions {
  /** Perpendicular offset to the RIGHT of the heading — a path node marks the road centre, and SA
   *  drives on the right. Default 2.5. */
  laneOffset?: number;
  /** Candidate model names (the caller filters `vehicles.ide` by type — cars only, never a plane). */
  models: readonly string[];
  regions: readonly RoadCarRegion[];
  /** Extra seed mixed into every pick — vary to reshuffle the whole population. Default 0. */
  seed?: number;
}

export interface RoadCarRegion {
  /** Native GTA (x, y, z) the region is centred on (a bench scene's anchor). */
  position: readonly [number, number, number];
  /** Nodes farther than this from the centre are not populated. */
  radius: number;
  /** Minimum distance between two placed cars — the density knob (city ≈ 30, countryside ≈ 90). */
  spacing: number;
}

/**
 * The bench road-car population straight from the game fs — shared by BOTH hosts (three prod and
 * `?engine=opensa`) so a C1 baseline sweep measures the SAME streets: road graph = `data/Paths/NODES*.DAT`
 * loose files, models = TYPE-`car` rows of `vehicles.ide` (never a plane), regions = the scenes' `cars`
 * knobs. `pinnedModel` (`?benchcar=`) pins every spot to one model — the per-model isolation knob (a
 * flipped car is either a bad spot or a bad collider; one model across all spots answers which).
 * Returns `[]` when no scene asks for cars or the game ships no path graph / no car defs.
 */
export function benchRoadCarPlacements(
  fs: AssetFileSystem,
  scenes: readonly BenchScene[],
  pinnedModel?: null | string,
): VehiclePlacement[] {
  const regions = scenes
    .filter((scene) => scene.cars !== undefined)
    .map((scene) => ({ position: scene.anchor, radius: scene.cars!.radius, spacing: scene.cars!.spacing }));
  if (regions.length === 0) {
    return [];
  }
  const areas = pathAreaFiles(fs);
  const defs = parseVehicleDefs(fs.getText('data/vehicles.ide') ?? '');
  const models = pinnedModel
    ? [pinnedModel.toLowerCase()]
    : [...defs.values()].filter((def) => def.type === 'car').map((def) => def.model.toLowerCase());
  if (areas.size === 0 || models.length === 0) {
    return [];
  }

  return roadCarPlacements(vehiclePathNodes(areas), { models, regions });
}

/**
 * Place one car per accepted road node: skip water nodes, keep nodes inside a region, enforce the region's
 * spacing with a grid hash (deterministic — nodes iterate in (area, id) order), pick the model by a
 * position-seeded hash. The same inputs always produce the same street.
 */
export function roadCarPlacements(nodes: readonly VehiclePathNode[], options: RoadCarOptions): VehiclePlacement[] {
  if (options.models.length === 0 || options.regions.length === 0) {
    return [];
  }
  const laneOffset = options.laneOffset ?? 2.5;
  const seed = options.seed ?? 0;
  const ordered = [...nodes].sort((a, b) => a.area - b.area || a.id - b.id);
  const placements: VehiclePlacement[] = [];
  /** One occupancy grid per region (regions may overlap; each enforces its own spacing). Cells KEEP their
   *  accepted points and acceptance checks the 3×3 neighbourhood — a cell-membership test alone let two
   *  opposite-lane nodes a few metres apart across a cell border spawn INSIDE each other (the pair ejected
   *  and froze leaning together — the first bench field run). */
  const occupied = options.regions.map(() => new Map<string, [number, number][]>());
  for (const node of ordered) {
    if (node.boats) {
      continue;
    }
    const regionIndex = regionOf(node.position, options.regions);
    if (regionIndex === -1) {
      continue;
    }
    const region = options.regions[regionIndex];
    if (crowded(occupied[regionIndex], node.position, region.spacing)) {
      continue;
    }
    const cellKey = gridKey(node.position, region.spacing);
    const cell = occupied[regionIndex].get(cellKey) ?? [];
    cell.push([node.position[0], node.position[1]]);
    occupied[regionIndex].set(cellKey, cell);
    const pick = mix(positionSeed(node.position), seed);
    const model = options.models[pick % options.models.length];
    // Right of the heading: forward = (−sinθ, cosθ) about GTA +Z → right = (cosθ, sinθ).
    const x = node.position[0] + Math.cos(node.heading) * laneOffset;
    const y = node.position[1] + Math.sin(node.heading) * laneOffset;
    placements.push({
      groundSnap: true,
      heading: node.heading,
      model,
      position: [x, y, node.position[2]],
    });
  }

  return placements;
}

/** True when an accepted point closer than `spacing` exists in the 3×3 neighbouring cells. */
function crowded(
  occupied: ReadonlyMap<string, [number, number][]>,
  position: readonly [number, number, number],
  spacing: number,
): boolean {
  const cx = Math.floor(position[0] / spacing);
  const cy = Math.floor(position[1] / spacing);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const [x, y] of occupied.get(`${cx + dx},${cy + dy}`) ?? []) {
        if ((x - position[0]) ** 2 + (y - position[1]) ** 2 < spacing * spacing) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Quantise a position to its spacing cell (the `crowded` neighbourhood key). */
function gridKey(position: readonly [number, number, number], spacing: number): string {
  return `${Math.floor(position[0] / spacing)},${Math.floor(position[1] / spacing)}`;
}

/** One extra integer scramble so `seed` reshuffles picks without correlating neighbours. */
function mix(hash: number, seed: number): number {
  let value = (hash ^ Math.imul(seed + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;

  return (value ^ (value >>> 16)) >>> 0;
}

/** Index of the first region containing the point (2D — roads stack rarely enough for the bench), or −1. */
function regionOf(position: readonly [number, number, number], regions: readonly RoadCarRegion[]): number {
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    const dx = position[0] - region.position[0];
    const dy = position[1] - region.position[1];
    if (dx * dx + dy * dy <= region.radius * region.radius) {
      return index;
    }
  }

  return -1;
}
