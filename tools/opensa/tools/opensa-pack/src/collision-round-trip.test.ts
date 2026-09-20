import type { OspakManifest } from '@opensa/engine-formats';
import type { RegionColliders } from '@opensa/renderware';

import { GAME_CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { COLLISION_KEY_PREFIX, PakCollisionSource } from '@opensa/engine';
import { buildOspak, encodeOscol } from '@opensa/engine-formats';
import { GtaSaWorldAdapter, toModelColliders } from '@opensa/game/adapters/gta-sa-world.adapter';
import { Matrix4 } from '@opensa/math';
import { breakableInstanceKey } from '@opensa/renderware/breakable/key';
import { describe, expect, it } from 'vitest';

import { bakeCellCollision } from './pack-collision';

/**
 * The WHOLE chain in one test (plan 200/3-01): regions → bake → `.oscol` → a real `.ospak` → a byte-range
 * read → `PakCollisionSource` → `GtaSaWorldAdapter` → the colliders the physics layer consumes.
 *
 * Every unit on that path is tested on its own; what is only testable HERE is that they agree — the manifest
 * key the writer used is the key the reader asks for, the offset/length the pak recorded slice the entry the
 * decoder expects, and the colliders that come out are the ones the COL path would have built. It lives in
 * the tool because it needs the writer and the runtime in one file (`docs/restrictions/architecture.md`).
 *
 * No game assets: the regions are synthetic, so this runs in CI where `tests/original/` does not exist.
 */

/** The pak worker, minus the worker: the same message contract, serving slices of the pak in memory. */
function fakeWorker(pak: Uint8Array): Worker {
  const listeners: ((event: { data: unknown }) => void)[] = [];

  return {
    addEventListener: (_type: string, listener: (event: { data: unknown }) => void): void => {
      listeners.push(listener);
    },
    postMessage: (message: { key: string; length: number; offset: number; type: string }): void => {
      if (message.type !== 'fetch') {
        return;
      }
      // A transferable copy, exactly like the real worker's `slice` — never a view over the pak.
      const buffer = pak.slice(message.offset, message.offset + message.length).buffer;
      for (const listener of listeners) {
        listener({ data: { buffer, key: message.key, type: 'blob' } });
      }
    },
  } as unknown as Worker;
}

const surface = (material: number): { brightness: number; flag: number; light: number; material: number } => ({
  brightness: 0,
  flag: 0,
  light: 0,
  material,
});

/** An adapter wired to a pak, with an empty archive: anything it returns came out of the pak. */
async function adapterOn(built: { manifest: OspakManifest; pak: Uint8Array }): Promise<GtaSaWorldAdapter> {
  const source = new PakCollisionSource(built.manifest, fakeWorker(built.pak));
  const adapter = new GtaSaWorldAdapter({
    bakedCollision: source,
    cellSize: GAME_CELL_SIZE,
    fs: emptyFs(),
  });
  await adapter.prepare();

  return adapter;
}

/** A pak carrying exactly one baked collision cell, keyed on the GAME grid the runtime streams on. */
function bakedPak(
  cx: number,
  cy: number,
  regions: readonly RegionColliders[],
  isBreakable: (name: string) => boolean = () => false,
): { manifest: OspakManifest; pak: Uint8Array } {
  return buildOspak(
    [{ bytes: encodeOscol(bakeCellCollision(regions, isBreakable)), key: `${cx},${cy}`, kind: 'collision' }],
    {
      cellSize: 250,
      collisionCellSize: GAME_CELL_SIZE,
    },
  );
}

/** An empty install: a `gta.dat` naming no IDE and no IPL, so the world is real but carries nothing. Any
 *  collider the adapter then produces can only have come out of the pak. */
function emptyFs(): { get: () => null; getText: (name: string) => null | string; has: () => boolean; names: [] } {
  return {
    get: (): null => null,
    getText: (name: string): null | string => (name === 'data/gta.dat' ? '' : null),
    has: (): boolean => false,
    names: [],
  };
}

/** Two placements of one model, with a triangle pair carrying two different surface ids. */
function regionColliders(name: string, at: [number, number, number]): RegionColliders {
  return {
    col: {
      bounds: { center: [0.5, 0.5, 0.5], max: [1, 1, 1], min: [0, 0, 0], radius: 2 },
      boxes: [{ max: [1, 2, 3], min: [-1, -2, -3], surface: surface(7) }],
      faces: [
        { a: 0, b: 1, c: 2, light: 0, material: 4 },
        { a: 0, b: 2, c: 3, light: 0, material: 17 },
      ],
      modelId: 42,
      name,
      spheres: [{ center: [0, 0, 2], radius: 1.5, surface: surface(9) }],
      version: 3,
      vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    },
    name,
    transforms: [new Matrix4().setPosition(...at), new Matrix4().setPosition(at[0] + 8, at[1], at[2])],
  } as unknown as RegionColliders;
}

describe('baked collision, writer to runtime', () => {
  describe('negative cases', () => {
    it('falls back to COL for a cell the pak has no entry for', async () => {
      const adapter = await adapterOn(bakedPak(4, -7, [regionColliders('roads32_law2', [12.5, -3, 7])]));

      // 5,-7 is a real neighbouring GAME cell — the pak simply carries nothing for it.
      expect(await adapter.loadCellColliders(5, -7)).toEqual([]);
    });

    it('refuses the pak when its collision grid is not the grid collision streams on', () => {
      const built = buildOspak(
        [{ bytes: encodeOscol({ regions: [] }), key: '4,-7', kind: 'collision' }],
        { cellSize: 250, collisionCellSize: 250 }, // the RENDER grid — the silent trap
      );
      const source = new PakCollisionSource(built.manifest, fakeWorker(built.pak));

      expect(
        () =>
          new GtaSaWorldAdapter({
            bakedCollision: source,
            cellSize: GAME_CELL_SIZE,
            fs: emptyFs(),
          }),
      ).toThrow(/250-unit grid but collision streams on 256/);
    });
  });

  describe('positive cases', () => {
    it('delivers the colliders the COL parse would have built, through the pak', async () => {
      const source = regionColliders('roads32_law2', [12.5, -3, 7]);
      const adapter = await adapterOn(bakedPak(4, -7, [source]));

      const [model] = await adapter.loadCellColliders(4, -7);
      const expected = toModelColliders(source);

      expect(model.name).toBe(expected.name);
      expect(model.shape.indices).toEqual(expected.shape.indices);
      expect(model.shape.materials).toEqual(expected.shape.materials);
      expect(model.shape.vertices).toEqual(expected.shape.vertices);
      expect(model.shape.boxes).toEqual(expected.shape.boxes);
      expect(model.shape.spheres).toEqual(expected.shape.spheres);
      expect(model.transforms.map((matrix) => matrix.elements)).toEqual(
        expected.transforms.map((matrix) => matrix.elements),
      );
    });

    it('carries the breakable keys the bake resolved, one per placement', async () => {
      const adapter = await adapterOn(bakedPak(4, -7, [regionColliders('bin1', [10, 20, 30])], () => true));

      const [model] = await adapter.loadCellColliders(4, -7);

      expect(model.instanceKeys).toEqual([
        breakableInstanceKey('bin1', [10, 20, 30]),
        breakableInstanceKey('bin1', [18, 20, 30]),
      ]);
    });

    it('asks the pak for the range the manifest recorded, under the collision key', async () => {
      const built = bakedPak(4, -7, [regionColliders('roads32_law2', [12.5, -3, 7])]);
      const asked: { key: string; length: number; offset: number }[] = [];
      const worker = fakeWorker(built.pak);
      const spy = {
        ...worker,
        addEventListener: worker.addEventListener.bind(worker),
        postMessage: (message: { key: string; length: number; offset: number; type: string }): void => {
          asked.push({ key: message.key, length: message.length, offset: message.offset });
          worker.postMessage(message);
        },
      };

      await new PakCollisionSource(built.manifest, spy).read(4, -7);

      const entry = built.manifest.collision?.['4,-7'];
      expect(asked).toEqual([{ key: `${COLLISION_KEY_PREFIX}4,-7`, length: entry?.length, offset: entry?.offset }]);
    });
  });
});
