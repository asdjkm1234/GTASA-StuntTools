import type { ClumpEffect } from '@opensa/lod-common/clump-effects';
import type { MergedMesh } from '@opensa/lod-common/mesh';
import type { ModelSource } from '@opensa/lod-common/model-source';
import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { buildClumpMesh } from '@opensa/lod-common/build-mesh';
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { keepTypesFor } from '@opensa/lod-common/two-dfx-policy';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { Cell } from '../../core/types';

import { collectCellEffects, mergeCell } from './merge';

/** A clump of one atomic → one geometry. */
function clump(geom: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geom],
  };
}

/** A real DFF carrying a type-9 cover point — a type the cell policy drops. */
function coverDff(): Uint8Array {
  const entry = new Uint8Array(20 + 8);
  const view = new DataView(entry.buffer);
  view.setUint32(12, 9, true);
  view.setUint32(16, 8, true);

  return fxDff(entry, [1, 0, 0], 'crate');
}

/** A real DFF of one triangle carrying one 2dfx entry at `position`. */
function fxDff(entry: Uint8Array, position: [number, number, number], texture: string): Uint8Array {
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, texture, { effects: build2dfxSection([{ bytes: entry, position }])! });
}

/** A one-triangle geometry with the given texture, at the given local positions. */
function geometry(texture: string, positions: number[]): RWGeometry {
  return {
    flags: 0,
    lights: [],
    materials: [{ color: [255, 255, 255, 255], texture: { maskName: '', name: texture }, textured: true }],
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** A real DFF: one triangle plus a type-0 light entry at model-local (1, 0, 0) — vertex 1's position. */
function lampDff(): Uint8Array {
  const entry = new Uint8Array(20 + 4);
  const view = new DataView(entry.buffer);
  view.setFloat32(0, 1, true); // position x = 1 (y, z stay 0)
  view.setUint32(12, 0, true); // type 0 — light
  view.setUint32(16, 4, true);
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'pole' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, 'lamp', { effects: build2dfxSection([{ bytes: entry, position: [1, 0, 0] }])! });
}

/** A real DFF carrying a type-7 roadsign entry at a WORLD position, as the stock corpus authors them. */
function signDff(world: [number, number, number]): Uint8Array {
  const entry = new Uint8Array(20 + 88);
  const view = new DataView(entry.buffer);
  view.setUint32(12, 7, true);
  view.setUint32(16, 88, true);
  entry.fill(0xab, 20); // a payload we never decode: an untouched carry must return these bytes verbatim

  return fxDff(entry, world, 'board');
}

function source(models: Record<string, RWClump>): ModelSource {
  return { load: (model) => models[model.toLowerCase()] ?? null };
}

const IDENTITY = [0, 0, 0, 1] as const; // no rotation

// The Burger Shot of LAw (`npm run test:fixtures`): an IDE `anim` clump — the building on the root frame, the
// burger sign (atomic 0) on child frame `burger01_LAw3` at (7.18, −7.30, 1.01). The engine's weld places an
// `anim` def's atomics by their frame hierarchy; the cell merge ignored the frames and baked the sign in the
// middle of the roof (field, 2026-08-17).
const BURGER = 'fixtures/original/dff/anim-clump/burger01_law.dff';
const SIGN_OFFSET = [7.1796875, -7.296875, 1.0078125] as const;

describe('mergeCell', () => {
  describe('negative cases', () => {
    it('carries no type the shared policy drops from cells — the fate is decided in one place', () => {
      const dff = coverDff();
      const models = { crate: parseDff(toArrayBuffer(dff)) };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'crate', position: [128, 128, 0], rotation: IDENTITY, txd: '' }],
      };

      expect(collectCellEffects(cell, 256, () => dff, source(models), new Map())).toEqual([]);
      expect(keepTypesFor('cell').has(9)).toBe(false); // and this is the set it read
    });

    it('emits ONE plate for a model placed twice — a world position does not repeat per instance', () => {
      const dff = signDff([200, 300, 10]);
      const models = { board: parseDff(toArrayBuffer(dff)) };
      const at = (x: number): Cell['instances'][number] => ({
        model: 'board',
        position: [x, 128, 0],
        rotation: IDENTITY,
        txd: '',
      });
      const cell: Cell = { cx: 0, cy: 0, instances: [at(128), at(140)] };

      const effects = collectCellEffects(cell, 256, () => dff, source(models), new Map());

      expect(effects).toHaveLength(1);
    });

    it('skips instances whose model is missing', () => {
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'absent', position: [0, 0, 0], rotation: IDENTITY, txd: '' }],
      };
      const mesh = mergeCell(cell, 256, source({}));
      expect(mesh.positions).toHaveLength(0);
      expect(mesh.groups).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it.skipIf(!existsSync(BURGER))(
      "places an anim def's atomics by their DFF frame — the burger sign sits off the roof centre",
      () => {
        const clumpOf = parseDff(toArrayBuffer(new Uint8Array(readFileSync(BURGER))));
        const cell: Cell = {
          cx: 0,
          cy: 0,
          instances: [{ anim: 'burger01_law', model: 'burger', position: [128, 128, 0], rotation: IDENTITY, txd: '' }],
        };
        const plain: Cell = { ...cell, instances: [{ ...cell.instances[0], anim: undefined }] };

        const framed = mergeCell(cell, 256, source({ burger: clumpOf }));
        const unframed = mergeCell(plain, 256, source({ burger: clumpOf }));

        // Atomic 0 (the sign) is appended first; the SA target's `buildClumpMesh` (plan 009, field-accepted) is
        // the placement the two targets must agree on. Without `anim` the merge stays where it was.
        const reference = buildClumpMesh(clumpOf);
        expect([...framed.positions.slice(0, 3)]).toEqual([...reference.positions.slice(0, 3)]);
        const local = clumpOf.geometries[clumpOf.atomics[0].geometryIndex].positions;
        expect([...unframed.positions.slice(0, 3)]).toEqual([...local.slice(0, 3)]);
        expect(framed.positions[1] - unframed.positions[1]).toBeCloseTo(SIGN_OFFSET[1], 1);
      },
    );

    it('offsets vertices to the cell centre and applies the instance position', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      // cell (0,0) @256 → centre (128,128,0); instance at (130,128,5) → first vertex relative = (2,0,5).
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'box', position: [130, 128, 5], rotation: IDENTITY, txd: '' }],
      };
      const mesh = mergeCell(cell, 256, source(models));
      expect([...mesh.positions.slice(0, 3)]).toEqual([2, 0, 5]);
      expect(mesh.groups).toEqual([{ indices: Uint32Array.of(0, 1, 2), texture: 'wall' }]);
    });

    it('buckets same-named textures from different def TXDs into separate scoped groups (plan 004)', () => {
      const models = {
        bush: clump(geometry('leaves', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
        tree: clump(geometry('leaves', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
      };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [
          { model: 'bush', position: [0, 128, 0], rotation: IDENTITY, txd: 'badlands' },
          { model: 'tree', position: [4, 128, 0], rotation: IDENTITY, txd: 'gta_proc_bush' },
        ],
      };
      const registry = new Map();
      const mesh = mergeCell(cell, 256, source(models), registry);

      // Without the registry these merge into ONE 'leaves' bucket; scoped, each variant keeps its group.
      expect(mesh.groups.map((g) => g.texture).sort()).toEqual(['badlands_leaves', 'gta_proc_bush_leaves']);
      expect(registry.get('badlands_leaves')).toEqual({ name: 'leaves', txd: 'badlands' });
      expect(registry.get('gta_proc_bush_leaves')).toEqual({ name: 'leaves', txd: 'gta_proc_bush' });
    });

    it('merges two instances of one model and re-bases triangle indices', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const at = (x: number): Cell['instances'][number] => ({
        model: 'box',
        position: [x, 128, 0],
        rotation: IDENTITY,
        txd: '',
      });
      const cell: Cell = { cx: 0, cy: 0, instances: [at(128), at(138)] };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.positions).toHaveLength(18); // 2 × 3 verts × 3
      expect([...mesh.groups[0].indices]).toEqual([0, 1, 2, 3, 4, 5]); // second instance re-based
    });

    it('collects cell light effects with the same instance transform as the vertices', () => {
      // The model carries one light at model-local (1, 0, 0); the cache is pre-seeded (raw bytes unused).
      const models = { lamp: clump(geometry('pole', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const cache = new Map<string, ClumpEffect[]>([
        ['lamp', [{ bytes: Uint8Array.of(9, 9, 9), position: [1, 0, 0], type: 0 }]],
      ]);
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'lamp', position: [130, 128, 5], rotation: IDENTITY, txd: '' }],
      };

      const effects = collectCellEffects(cell, 256, () => null, source(models), cache);

      expect(effects).toHaveLength(1);
      // Instance (130,128,5) + local (1,0,0) − cell centre (128,128,0) = (3, 0, 5) — same maths as mergeCell.
      expect(effects[0].position).toEqual([3, 0, 5]);
      expect([...effects[0].bytes]).toEqual([9, 9, 9]); // raw entry bytes untouched
    });

    it('puts a corona on a ROTATED instance exactly where the vertex it sits on lands', () => {
      // The strongest form of "a corona is in the same place on every representation": the light entry sits
      // at the same model-local point as vertex 1, so the carried effect must land on the merged vertex —
      // asserted against the mesh itself, not against a second copy of the transform maths (lod-common/001).
      const dff = lampDff();
      const models = { lamp: parseDff(toArrayBuffer(dff)) };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        // 90° about Z (the IPL quaternion is the inverse; merge conjugates it) at an off-centre position.
        instances: [{ model: 'lamp', position: [130, 140, 5], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], txd: '' }],
      };

      const mesh: MergedMesh = mergeCell(cell, 256, source(models));
      const effects = collectCellEffects(cell, 256, () => dff, source(models), new Map());

      expect(effects).toHaveLength(1);
      const vertex = [mesh.positions[3], mesh.positions[4], mesh.positions[5]]; // vertex 1 = local (1,0,0)
      effects[0].position.forEach((axis, component) => {
        expect(axis).toBeCloseTo(vertex[component], 5);
      });
    });

    it('re-bases a plate on the cell origin alone, even on a rotated instance', () => {
      // The failure this pins: routing a world-space entry through the instance transform, which for
      // `cen_bit_08` would have thrown its plates about a kilometre (plan 100/00). The instance is rotated
      // and off-centre precisely so that any use of its transform shows up.
      const dff = signDff([200, 300, 10]);
      const models = { board: parseDff(toArrayBuffer(dff)) };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'board', position: [130, 140, 5], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], txd: '' }],
      };

      const effects = collectCellEffects(cell, 256, () => dff, source(models), new Map());

      expect(effects).toHaveLength(1);
      // World (200,300,10) − cell centre (128,128,0) = (72, 172, 10). The instance moved nothing.
      expect([...effects[0].position]).toEqual([72, 172, 10]);
      expect([...effects[0].bytes.slice(20)]).toEqual(Array(88).fill(0xab)); // payload never decoded
    });

    it('gives two instances of an emitter-carrying model two emitters, each at its own place', () => {
      // The other half of the space branch: a model-local type stays per-instance — two chimneys, two plumes.
      const cache = new Map<string, ClumpEffect[]>([
        ['chimney', [{ bytes: Uint8Array.of(7, 7), position: [0, 0, 20], type: 1 }]],
      ]);
      const models = { chimney: clump(geometry('brick', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const at = (x: number): Cell['instances'][number] => ({
        model: 'chimney',
        position: [x, 128, 0],
        rotation: IDENTITY,
        txd: '',
      });
      const cell: Cell = { cx: 0, cy: 0, instances: [at(128), at(140)] };

      const effects = collectCellEffects(cell, 256, () => null, source(models), cache);

      expect(effects.map((effect) => effect.type)).toEqual([1, 1]);
      expect(effects.map((effect) => [...effect.position])).toEqual([
        [0, 0, 20],
        [12, 0, 20],
      ]);
    });

    it('groups triangles by texture across materials', () => {
      const models = {
        a: clump(geometry('road', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
        b: clump(geometry('grass', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
      };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [
          { model: 'a', position: [128, 128, 0], rotation: IDENTITY, txd: '' },
          { model: 'b', position: [128, 128, 0], rotation: IDENTITY, txd: '' },
        ],
      };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.groups.map((g) => g.texture).sort()).toEqual(['grass', 'road']);
    });
  });
});
