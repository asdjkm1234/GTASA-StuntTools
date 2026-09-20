/**
 * What the viewer DECIDES about cell residency, asserted through the recording fake `GPUDevice` (plan 077):
 * the weld cache, the unload of a deselected cell, and the rule that costs the most when it is wrong — a
 * texture array that GROWS kills every render bundle recorded against it, so the resident cells are
 * re-created FROM THE CACHE, never re-welded (10 ms against ~200 ms per cell).
 *
 * The welder itself is stubbed: it has its own tests in `@opensa/cell-weld`, and what is under test here is
 * the renderer's POLICY, so the stub hands back real `.oscell` bytes and a texture plan the test grows on
 * demand. Everything downstream of that — the engine's cell store, the bundles, the draws — is real.
 */
import type { Oscell } from '@opensa/engine-formats';
import type { FakeGpu } from '@opensa/engine/test/fake-device';
import type { InstallPlan, InstallSource } from '@opensa/loaders';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '@opensa/renderware';

import { Engine } from '@opensa/engine';
import { encodeOscell, encodeOstex, OSCELL_VERTEX_STRIDE, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { installFakeWebGpu } from '@opensa/engine/test/fake-device';
import { buildWorldGrid } from '@opensa/renderware';
import { Vfs } from '@opensa/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedMap } from '../source/map-source';

import { AssetStore } from '../source/asset-store';
import { CellRenderer } from './cell-renderer';

/** The welder stub's state: how many welds ran, and how many layers the (single) texture array reports. */
const weld = vi.hoisted(() => ({ calls: [] as string[], layers: 1 }));

vi.mock('@opensa/cell-weld', () => ({
  CELL_SIZE: 250,
  TexturePlanner: class {
    build(): {
      bytes: Uint8Array;
      meta: { format: number; height: number; layers: number; width: number };
      ref: number;
    }[] {
      return [
        { bytes: arrayBytes(weld.layers), meta: { format: 0, height: 4, layers: weld.layers, width: 4 }, ref: 0 },
      ];
    }
  },
  weldCell: (
    _fs: unknown,
    _defs: unknown,
    cell: { cx: number; cy: number },
  ): { bytes: Uint8Array; stats: { indices: number; vertices: number } } => {
    weld.calls.push(`${cell.cx},${cell.cy}`);

    return { bytes: cellBytes(), stats: { indices: 3, vertices: 3 } };
  },
}));

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const camera = {
  aspect: 16 / 9,
  eye: [0, 400, 0] as [number, number, number],
  far: 12000,
  fovYRad: Math.PI / 3,
  near: 0.5,
  target: [0, 0, 0] as [number, number, number],
  up: [0, 0, 1] as [number, number, number],
};

/** A 4×4 RGBA8 array with `layers` layers — growing it is what kills the bundles. */
function arrayBytes(layers: number): Uint8Array {
  return encodeOstex({
    format: OstexFormat.RGBA8,
    height: 4,
    layers: Array.from({ length: layers }, (_, index) => ({
      alphaClass: 0,
      cutoutRef: 0,
      nameHash: index + 1,
      wrap: 0,
    })),
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(OstexFormat.RGBA8, 4, 4, 1) * layers),
    premultiplied: false,
    width: 4,
  });
}

async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);

  return engine;
}

/** One valid triangle cell referencing array 0 — the only array the stubbed plan builds. */
function cellBytes(overrides: Partial<Oscell> = {}): Uint8Array {
  return encodeOscell({
    bounds: [0, 0, 0, 400],
    breakables: [],
    channelMask: 0,
    groups: [{ bounds: [0, 0, 0, 400], indexCount: 3, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 }],
    index16: false,
    indexCount: 3,
    indexData: new Uint8Array(new Uint32Array([0, 1, 2]).buffer),
    lights: [],
    names: [],
    objects: [],
    origin: [0, 0, 0],
    particles: [],
    placements: [],
    roadsignQuads: 0,
    vertexCount: 3,
    vertexData: new Uint8Array(3 * OSCELL_VERTEX_STRIDE),
    ...overrides,
  });
}

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function inst(id: number, position: [number, number, number]): IplInstance {
  return { id, interior: 0, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

/** A two-cell map: (0,0) and (1,0). Assets resolve to nothing — the welder is stubbed. */
function loadedMap(): LoadedMap {
  const defs: MapDefinitions = {
    catalog: new Map([[1, def(1, 'house')]]),
    imgDirs: [],
    instances: [inst(1, [10, 10, 0]), inst(1, [260, 10, 0])],
  };
  const plan: InstallPlan = { loose: [], models: [], others: [], textures: [] };
  const install = { gta3: { names: [], read: () => Promise.resolve(null) }, gtaInt: null } as unknown as InstallSource;
  const fs = new Vfs();

  return {
    assets: new AssetStore(install, plan, fs, defs),
    defs,
    fs,
    grid: buildWorldGrid(defs, 250),
    label: 'test',
    models: { dff: 1, osm: 0 },
  };
}

/** Draws issued from the world pass this frame (the swapchain blit of the post pass is not one). */
function worldDraws(engine: Engine): number {
  gpu.reset();
  engine.frame(camera);

  return gpu.passes.find((pass) => pass.label.includes('world'))?.bundles.length ?? 0;
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
  weld.calls = [];
  weld.layers = 1;
});

afterEach(() => {
  harness.restore();
});

describe('CellRenderer residency', () => {
  describe('negative cases', () => {
    it('welds nothing for a coordinate the grid has no cell for', async () => {
      const renderer = new CellRenderer(await bootedEngine(), loadedMap());
      const stats = await renderer.setCells([{ cx: 9, cy: 9 }], false);

      expect(weld.calls).toEqual([]);
      expect(stats.cells).toBe(0);
    });

    it('does not re-weld a cell it already holds', async () => {
      const renderer = new CellRenderer(await bootedEngine(), loadedMap());
      await renderer.setCells([{ cx: 0, cy: 0 }], false);
      await renderer.setCells([{ cx: 0, cy: 0 }], false);

      expect(weld.calls).toEqual(['0,0']); // the second call came from the cache
    });

    it('unloads a cell that left the set, so residency is the TARGET set and not the union', async () => {
      const engine = await bootedEngine();
      const renderer = new CellRenderer(engine, loadedMap());
      await renderer.setCells(
        [
          { cx: 0, cy: 0 },
          { cx: 1, cy: 0 },
        ],
        false,
      );
      expect(engine.cells.count).toBe(2);

      const stats = await renderer.setCells([{ cx: 0, cy: 0 }], false);
      expect(engine.cells.count).toBe(1);
      expect(stats.cells).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('loads a welded cell into the engine and draws it', async () => {
      const engine = await bootedEngine();
      const renderer = new CellRenderer(engine, loadedMap());
      await renderer.setCells([{ cx: 0, cy: 0 }], false);

      expect(engine.cells.count).toBe(1);
      expect(worldDraws(engine)).toBeGreaterThan(0);
    });

    it('re-creates the resident cells FROM CACHE when a texture array grows — never re-welds', async () => {
      const engine = await bootedEngine();
      const renderer = new CellRenderer(engine, loadedMap());
      await renderer.setCells([{ cx: 0, cy: 0 }], false);
      expect(weld.calls).toEqual(['0,0']);

      // The second cell brings a new texture with it: the array gains a layer, so every bundle recorded
      // against the old one is dead and each resident cell has to be created again.
      weld.layers = 2;
      await renderer.setCells(
        [
          { cx: 0, cy: 0 },
          { cx: 1, cy: 0 },
        ],
        false,
      );

      expect(weld.calls).toEqual(['0,0', '1,0']); // cell (0,0) was NOT welded a second time
      expect(engine.cells.count).toBe(2); // …and it is resident again, from its cached bytes
      expect(worldDraws(engine)).toBeGreaterThan(0);
    });

    it('reload() re-creates the same cells from cache — the way hiding is undone', async () => {
      const engine = await bootedEngine();
      const renderer = new CellRenderer(engine, loadedMap());
      await renderer.setCells([{ cx: 0, cy: 0 }], false);

      renderer.reload();

      expect(weld.calls).toEqual(['0,0']); // the upload, not the weld
      expect(engine.cells.count).toBe(1);
    });

    it('clear() empties the world but keeps the cache, so re-selecting costs no weld', async () => {
      const engine = await bootedEngine();
      const renderer = new CellRenderer(engine, loadedMap());
      await renderer.setCells([{ cx: 0, cy: 0 }], false);

      renderer.clear();
      expect(engine.cells.count).toBe(0);

      await renderer.setCells([{ cx: 0, cy: 0 }], false);
      expect(weld.calls).toEqual(['0,0']);
      expect(engine.cells.count).toBe(1);
    });
  });
});
