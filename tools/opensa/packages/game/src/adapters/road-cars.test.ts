import type { AssetFileSystem, VehiclePathNode } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import type { BenchScene } from '../perf/bench';

import { benchRoadCarPlacements, roadCarPlacements } from './road-cars';

function node(x: number, y: number, extra: Partial<VehiclePathNode> = {}): VehiclePathNode {
  return { area: 0, boats: false, heading: 0, id: 0, linkCount: 1, links: [], position: [x, y, 5], ...extra };
}

const REGION = { position: [0, 0, 5] as const, radius: 200, spacing: 50 };

/** A minimal `NODES0.DAT`: header + 28-byte vehicle nodes, no ped/navi/link tables. */
function nodesFile(nodes: readonly { x: number; y: number }[]): ArrayBuffer {
  const buffer = new ArrayBuffer(20 + nodes.length * 28);
  const view = new DataView(buffer);
  view.setUint32(0, nodes.length, true); // total nodes
  view.setUint32(4, nodes.length, true); // vehicle nodes
  nodes.forEach((entry, index) => {
    const at = 20 + index * 28;
    view.setInt16(at + 8, entry.x * 8, true); // ×8 fixed-point position
    view.setInt16(at + 10, entry.y * 8, true);
    view.setInt16(at + 12, 5 * 8, true);
    view.setUint16(at + 20, index, true); // id (flags stay 0 — no links, not a boat)
  });

  return buffer;
}

const VEHICLES_IDE = [
  'cars',
  '400, landstal, landstal, car, LANDSTAL, LANDSTAL, null, ignore, 10, 0, 0, -1, 0.7, 0.7, 0',
  '460, skimmer, skimmer, plane, SEAPLANE, SKIMMER, null, ignore, 10, 0, 0, -1, 0.7, 0.7, 0',
  'end',
].join('\n');

function benchFs(files: Record<string, ArrayBuffer | string>): AssetFileSystem {
  return {
    get: (name): ArrayBuffer | null => {
      const file = files[name];

      return file instanceof ArrayBuffer ? file : null;
    },
    getText: (name): null | string => {
      const file = files[name];

      return typeof file === 'string' ? file : null;
    },
    has: (name) => name in files,
    names: [],
  };
}

function scene(cars?: BenchScene['cars']): BenchScene {
  return {
    anchor: [0, 0, 5],
    cars,
    durationS: 10,
    hour: 12,
    key: 'test',
    path: [
      { look: [0, 0, 5], pos: [0, 0, 10] },
      { look: [0, 0, 5], pos: [10, 0, 10] },
    ],
    weather: 0,
  };
}

describe('roadCarPlacements', () => {
  describe('negative cases', () => {
    it('skips water nodes and nodes outside every region', () => {
      const placements = roadCarPlacements([node(0, 0, { boats: true }), node(1000, 1000)], {
        models: ['landstal'],
        regions: [REGION],
      });

      expect(placements).toHaveLength(0);
    });

    it('returns nothing without models or regions', () => {
      expect(roadCarPlacements([node(0, 0)], { models: [], regions: [REGION] })).toHaveLength(0);
      expect(roadCarPlacements([node(0, 0)], { models: ['landstal'], regions: [] })).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('enforces the region spacing (one car per spacing cell) — the density knob', () => {
      const dense = [node(0, 0), node(10, 0, { id: 1 }), node(120, 0, { id: 2 })];
      const placements = roadCarPlacements(dense, { models: ['landstal'], regions: [REGION] });

      expect(placements).toHaveLength(2); // 0 and 120 survive; 10 shares the 50-unit cell with 0
    });

    it('is deterministic and offsets the car to the RIGHT of the heading (lane, not road centre)', () => {
      const east = node(0, 0, { heading: -Math.PI / 2 }); // facing +X
      const first = roadCarPlacements([east], { models: ['a', 'b', 'c'], regions: [REGION] });
      const second = roadCarPlacements([east], { models: ['a', 'b', 'c'], regions: [REGION] });

      expect(first).toEqual(second);
      // Facing +X, right = −Y (cos(−π/2), sin(−π/2)) → the car sits south of the node.
      expect(first[0].position[1]).toBeCloseTo(-2.5, 5);
      expect(first[0].groundSnap).toBe(true);
    });
  });
});

describe('benchRoadCarPlacements', () => {
  const NODES = nodesFile([
    { x: 0, y: 0 },
    { x: 120, y: 0 },
  ]);

  describe('negative cases', () => {
    it('returns nothing when no scene asks for cars (the ocean scene)', () => {
      const fs = benchFs({ 'data/paths/nodes0.dat': NODES, 'data/vehicles.ide': VEHICLES_IDE });

      expect(benchRoadCarPlacements(fs, [scene()])).toHaveLength(0);
    });

    it('returns nothing when the game ships no path graph or no car defs', () => {
      const scenes = [scene({ radius: 200, spacing: 50 })];

      expect(benchRoadCarPlacements(benchFs({ 'data/vehicles.ide': VEHICLES_IDE }), scenes)).toHaveLength(0);
      expect(benchRoadCarPlacements(benchFs({ 'data/paths/nodes0.dat': NODES }), scenes)).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('places TYPE-car models from vehicles.ide on the road graph around the scene anchor', () => {
      const fs = benchFs({ 'data/paths/nodes0.dat': NODES, 'data/vehicles.ide': VEHICLES_IDE });
      const placements = benchRoadCarPlacements(fs, [scene({ radius: 200, spacing: 50 })]);

      expect(placements).toHaveLength(2);
      for (const placement of placements) {
        expect(placement.model).toBe('landstal'); // the plane never drives
        expect(placement.groundSnap).toBe(true);
      }
    });

    it('pins every spot to one model with pinnedModel (?benchcar= isolation knob)', () => {
      const fs = benchFs({ 'data/paths/nodes0.dat': NODES, 'data/vehicles.ide': VEHICLES_IDE });
      const placements = benchRoadCarPlacements(fs, [scene({ radius: 200, spacing: 50 })], 'Infernus');

      expect(placements.map((placement) => placement.model)).toEqual(['infernus', 'infernus']);
    });
  });
});
