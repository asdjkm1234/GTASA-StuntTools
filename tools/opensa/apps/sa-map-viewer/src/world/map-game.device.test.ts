/**
 * `ViewerMapGame`'s decisions, on the recording fake `GPUDevice` (plan 077): the cell-set queue that must
 * never interleave two sets, the click that becomes a pick in GTA coordinates, hide/restore, the water gate
 * and the search jump. The welder is stubbed exactly as in `cell-renderer.device.test.ts` — what is under
 * test is this class, and everything below it (the engine's cell store, the placement mapper, the picking
 * ray) is real.
 */
import type { Oscell } from '@opensa/engine-formats';
import type { WorldObjectInfo } from '@opensa/game';
import type { InstallPlan, InstallSource } from '@opensa/loaders';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '@opensa/renderware';

import { Engine } from '@opensa/engine';
import { encodeOscell, encodeOstex, OSCELL_VERTEX_STRIDE, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { installFakeWebGpu } from '@opensa/engine/test/fake-device';
import { buildWorldGrid } from '@opensa/renderware';
import { Vfs } from '@opensa/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedMap } from '../source/map-source';

import { ViewerCamera } from '../camera/viewer-camera';
import { AssetStore } from '../source/asset-store';
import { CellRenderer } from './cell-renderer';
import { ViewerMapGame } from './map-game';

const weld = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@opensa/cell-weld', () => ({
  CELL_SIZE: 250,
  TexturePlanner: class {
    build(): {
      bytes: Uint8Array;
      meta: { format: number; height: number; layers: number; width: number };
      ref: number;
    }[] {
      return [{ bytes: arrayBytes(), meta: { format: 0, height: 4, layers: 1, width: 4 }, ref: 0 }];
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

function arrayBytes(): Uint8Array {
  return encodeOstex({
    format: OstexFormat.RGBA8,
    height: 4,
    layers: [{ alphaClass: 0, cutoutRef: 0, nameHash: 1, wrap: 0 }],
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(OstexFormat.RGBA8, 4, 4, 1)),
    premultiplied: false,
    width: 4,
  });
}

/** A booted viewer: engine + camera over the first cell + the game under test. */
async function bootedGame(): Promise<{
  camera: ViewerCamera;
  engine: Engine;
  events: (null | WorldObjectInfo)[];
  game: ViewerMapGame;
  map: LoadedMap;
}> {
  const engine = new Engine();
  await engine.init(harness.canvas);
  engine.cells.picking = true; // the viewer sets this before the first load; picking needs the mapper
  const map = loadedMap();
  const camera = new ViewerCamera({ at: [125, 125], height: 400, pitch: -Math.PI / 2 + 0.01, yaw: Math.PI });
  const game = new ViewerMapGame(engine, map, camera, new CellRenderer(engine, map), vi.fn(), vi.fn());
  const events: (null | WorldObjectInfo)[] = [];
  game.events.on('select', (info) => {
    events.push(info);
  });

  return { camera, engine, events, game, map };
}

/** A cell carrying ONE placement — a 20 u box around the cell centre, which is what a click has to find. */
function cellBytes(overrides: Partial<Oscell> = {}): Uint8Array {
  return encodeOscell({
    bounds: [125, 0, -125, 400],
    breakables: [],
    channelMask: 0,
    groups: [
      { bounds: [125, 0, -125, 400], indexCount: 3, indexOffset: 0, pipelineClass: 0, side: 0, textureArrayRef: 0 },
    ],
    index16: false,
    indexCount: 3,
    indexData: new Uint8Array(new Uint32Array([0, 1, 2]).buffer),
    lights: [],
    names: ['house', 'housetxd'],
    objects: [],
    origin: [0, 0, 0],
    particles: [],
    placements: [
      { bounds: [115, 0, -135, 135, 10, -115], id: 7, indexCount: 3, indexOffset: 0, nameRef: 0, txdRef: 1 },
    ],
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

/** The most recent `select` payload — `Array.prototype.at` is not in this project's lib. */
function last(events: readonly (null | WorldObjectInfo)[]): null | WorldObjectInfo {
  return events.length > 0 ? (events[events.length - 1] ?? null) : null;
}

/** Two cells, and a `tower` placed twice — the search jump needs a name with more than one placement. */
function loadedMap(): LoadedMap {
  const defs: MapDefinitions = {
    catalog: new Map([
      [1, def(1, 'house')],
      [2, def(2, 'tower')],
    ]),
    imgDirs: [],
    instances: [inst(1, [125, 125, 0]), inst(1, [375, 125, 0]), inst(2, [130, 130, 5]), inst(2, [1300, 1300, 5])],
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

/** Let the queued cell work drain (each set is one microtask chain through the stubbed welder). */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 8; tick += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  harness = installFakeWebGpu();
  weld.calls = [];
});

afterEach(() => {
  harness.restore();
});

describe('ViewerMapGame', () => {
  describe('negative cases', () => {
    it('reports no hit for a ray that misses everything, and clears the panel', async () => {
      const { engine, events, game } = await bootedGame();
      game.setManualCells([[0, 0]]);
      await settle();
      engine.frame(cameraState()); // the pick only tests VISIBLE cells

      game.pickAt([0.95, 0.95], 16 / 9);

      expect(last(events)).toBeNull();
    });

    it('answers null for a model the map does not place, and does not move the camera', async () => {
      const { camera, game } = await bootedGame();
      const before = camera.pose();

      expect(game.focusModel('nothing_here')).toBeNull();
      expect(camera.positionGta()).toEqual([before.at[0], before.at[1]]);
    });

    it('never interleaves two cell sets — a set arriving mid-weld replaces the queued one', async () => {
      const { engine, game, map } = await bootedGame();
      // Hold the first set inside its asset read, then queue two more while it waits.
      let release: () => void = () => undefined;
      const gate = new Promise<number>((resolve) => {
        release = (): void => resolve(0);
      });
      const ensure = vi.spyOn(map.assets, 'ensure').mockReturnValueOnce(gate);

      game.setManualCells([[0, 0]]);
      game.setManualCells([
        [0, 0],
        [1, 0],
      ]);
      game.setManualCells([[1, 0]]); // the last word
      release();
      ensure.mockRestore();
      await settle();

      expect(engine.cells.count).toBe(1);
      expect(weld.calls).toEqual(['0,0', '1,0']); // each cell welded once, in order, never twice at a time
    });
  });

  describe('positive cases', () => {
    it('picks the placement under the CURSOR and reports it in GTA coordinates', async () => {
      const { engine, events, game } = await bootedGame();
      game.setManualCells([[0, 0]]);
      await settle();
      engine.frame(cameraState());

      game.pickAt([0, 0], 16 / 9); // screen centre — the camera looks straight down at the placement

      const hit = last(events);
      expect(hit?.modelName).toBe('house');
      expect(hit?.txdName).toBe('housetxd');
      // Engine (x, y, z) → GTA (x, −z, y): the box centre is (125, 5, −125) engine = (125, 125, 5) GTA.
      expect(hit?.position.map(Math.round)).toEqual([125, 125, 5]);
    });

    it('hides the picked object and restores it from cache — no re-weld', async () => {
      const { engine, events, game } = await bootedGame();
      game.setManualCells([[0, 0]]);
      await settle();
      engine.frame(cameraState());
      game.pickAt([0, 0], 16 / 9);

      expect(game.hideSelectedObject()).toBe(1);
      expect(last(events)).toBeNull(); // the panel must not still describe what is gone

      expect(game.restoreHiddenObjects()).toBe(0);
      expect(weld.calls).toEqual(['0,0']); // restoring is the upload, not the weld
      expect(engine.cells.count).toBe(1);
    });

    it('centres on the nearest placement of a searched model and answers its cell', async () => {
      const { camera, game } = await bootedGame();

      expect(game.searchModels('tow')).toEqual([{ count: 2, name: 'tower' }]);
      expect(game.focusModel('tower')).toEqual([0, 0]);
      expect(camera.positionGta().map(Math.round)).toEqual([130, 130]);
      expect(camera.pose().height).toBeCloseTo(400); // the jump moves the point, never the pose

      expect(game.focusModel('tower')).toEqual([5, 5]); // pressing again walks to the far one
    });

    it('gates the water draw without unloading the surface', async () => {
      const { engine, game } = await bootedGame();

      game.setShowWater(false);
      expect(engine.waterEnabled).toBe(false);

      game.setShowWater(true);
      expect(engine.waterEnabled).toBe(true);
    });

    it('reports the cell under the camera as the view cell', async () => {
      const { game } = await bootedGame();
      expect(game.viewCell()).toEqual([0, 0]);
    });
  });
});

/** The camera state a frame is drawn with — straight down over the first cell's centre. */
function cameraState(): Parameters<Engine['frame']>[0] {
  return {
    aspect: 16 / 9,
    eye: [125, 400, -125],
    far: 12000,
    fovYRad: Math.PI / 3,
    near: 0.5,
    target: [125, 0, -125],
    up: [0, 1, 0],
  };
}
