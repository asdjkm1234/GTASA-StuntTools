/**
 * THE data-loss gate for the `.osm` conversion (plan opensa-pack/003 phase 5).
 *
 * Every other test proves a section round-trips. This one proves the CONVERSION does: for one real model
 * per asset class, what the runtime gets from a converted `.osm` must equal what it would have got from the
 * stock DFF/TXD — field by field, byte for byte, on the real assets. A converted build is very hard to
 * debug in-game, so a lost field has to fail here instead.
 *
 * The single deliberate exception is texture PIXELS: `.ostex` re-encodes to BC1/BC3, a measured ~1/255 mean
 * error (plan ledger, phase 2). Everything describing those textures — size, layer count, per-layer alpha
 * class and name — is still compared exactly.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOsm, decodeOsmSkeleton, decodeOstex, fnv1a, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { parseDff } from '@opensa/renderware';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { buildPedModel } from '@opensa/renderware/ped/build-ped-model';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createModelBundles } from './model-bundle';
import { buildModelOsm } from './model-osm';
import { packAnimObjects } from './pack-anim-objects';
import { buildPedOsm } from './ped-osm';

/** The packers log a summary line; these tests do not care about it. */
const quiet = (): void => undefined;

/**
 * Both conversions of one model, on the real asset. The animated script object is a 3.7 MB DFF at 51 840
 * vertices and blows the 5 s default on the row that builds it — deterministic work, just a lot of it, so
 * the answer is a bigger budget rather than a smaller asset (a synthetic one proves nothing here).
 */
const BUILD_TIMEOUT_MS = 30_000;

const FIXTURES = join(process.cwd(), 'fixtures', 'original');

/** One real model per class, with the TXD its IDE row names. */
const MODELS = [
  { dff: 'vehicles/admiral.dff', kind: 'vehicle', model: 'admiral', txd: 'vehicles/admiral.txd', txdName: 'admiral' },
  {
    dff: 'dff/anim-clump/nt_noddonkbase.dff',
    kind: 'animated object',
    model: 'nt_noddonkbase',
    txd: 'dff/anim-clump/des_xoilfield.txd',
    txdName: 'des_xoilfield',
  },
  {
    dff: 'dff/topple/lamppost1.dff',
    kind: 'topple prop',
    model: 'lamppost1',
    txd: 'dff/topple/dynsigns.txd',
    txdName: 'dynsigns',
  },
  {
    dff: 'dff/breakable/binnt08_la.dff',
    kind: 'breakable',
    model: 'binnt08_la',
    txd: 'dff/breakable/labins01_la.txd',
    txdName: 'labins01_la',
  },
  {
    dff: 'dff/clutter/sjmcacti2.dff',
    kind: 'clutter species',
    model: 'sjmcacti2',
    txd: 'dff/clutter/gta_cactus.txd',
    txdName: 'gta_cactus',
  },
  // The only class in the corpus that carries a UVAnimDict (plan 099). Without it the animation
  // comparison below would be `undefined === undefined` on every row — a blind lane, not a gate.
  {
    dff: 'mods/ferriswheel_lights.dff',
    kind: 'UV-animated script object',
    model: 'ferriswheel_lights',
    txd: 'mods/ferriswheel_lights.txd',
    txdName: 'ferriswheel_lights',
  },
] as const;

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** Both sides built ONCE per model — under coverage each build costs seconds, and rebuilding them per
 *  assertion is what pushes a file past vitest's per-test timeout. */
const conversions = new Map<
  string,
  { osm: ReturnType<typeof buildModelOsm>; stock: ReturnType<typeof buildVehicleModel> }
>();
function conversionOf(entry: (typeof MODELS)[number]): {
  osm: ReturnType<typeof buildModelOsm>;
  stock: ReturnType<typeof buildVehicleModel>;
} {
  let pair = conversions.get(entry.model);
  if (!pair) {
    const fs = fsFor(entry);
    pair = {
      osm: buildModelOsm(fs, entry.model, { txd: entry.txdName }),
      stock: buildVehicleModel(
        parseDff(fs.get(`${entry.model}.dff`)!),
        new VehicleTextures([fs.get(`${entry.txdName}.txd`)!]),
      ),
    };
    conversions.set(entry.model, pair);
  }

  return pair;
}

function fsFor(entry: (typeof MODELS)[number]): AssetFileSystem {
  const files = new Map<string, ArrayBuffer>([
    [`${entry.model}.dff`, fileOf(entry.dff)],
    [`${entry.txdName}.txd`, fileOf(entry.txd)],
  ]);

  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: () => null,
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe('the .osm conversion loses nothing', () => {
  describe('positive cases', () => {
    it(
      'the corpus still carries a UV-ANIMATED model — the animation compare is blind without one',
      () => {
        // Every `uvAnimations` assertion below passes trivially on a model that has none. This names the
        // one row that makes them mean something, so removing it fails HERE instead of quietly.
        const animated = MODELS.filter((entry) => (conversionOf(entry).stock.uvAnimations?.length ?? 0) > 0);

        expect(animated.map((entry) => entry.model)).toEqual(['ferriswheel_lights']);
      },
      BUILD_TIMEOUT_MS,
    );

    it.each(MODELS)(
      '$kind: $model keeps every geometry buffer, byte for byte',
      (entry) => {
        const pair = conversionOf(entry);
        const stock = toRigidModelInit(pair.stock);

        const { model } = readModelOsm(entry.model, pair.osm.bytes);

        expect(model.vertexCount).toBe(stock.vertexCount);
        expect(model.indexCount).toBe(stock.indexCount);
        expect(model.positions).toEqual(stock.positions);
        expect(model.normals).toEqual(stock.normals);
        expect(model.uvs).toEqual(stock.uvs);
        expect(model.colors).toEqual(stock.colors);
        expect(model.night).toEqual(stock.night);
        expect(model.reflect).toEqual(stock.reflect);
        expect(model.indices).toEqual(stock.indices);
        // `meta.x`/`.y` are REMAPPED onto the size-bucketed dictionary (that is the fix that keeps a 2048²
        // body texture from taxing every layer), so the bytes may differ — but each vertex must still land
        // on the SAME texture, by name. `.z`/`.w` carry flags the remap must never touch.
        const arrays = model.textures.map((texture) =>
          decodeOstex(texture.kind === 'ostex' ? texture.bytes : new Uint8Array()),
        );
        const indexBytes = model.indices.slice().buffer;
        const indices = model.index16 ? new Uint16Array(indexBytes) : new Uint32Array(indexBytes);
        for (const submesh of model.submeshes) {
          const array = arrays[submesh.array ?? 0];
          for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
            const vertex = indices[at];
            expect(array.layers[model.meta[vertex * 4]].nameHash).toBe(
              fnv1a(pair.stock.texture.names[stock.meta[vertex * 4]].toLowerCase()),
            );
            expect(model.meta[vertex * 4 + 2]).toBe(stock.meta[vertex * 4 + 2]);
            expect(model.meta[vertex * 4 + 3]).toBe(stock.meta[vertex * 4 + 3]);
          }
        }
      },
      BUILD_TIMEOUT_MS,
    );

    it.each(MODELS)(
      '$kind: $model keeps every structural field (parts, submeshes, doors, dummies, wheels)',
      (entry) => {
        const pair = conversionOf(entry);
        const stock = pair.stock;

        const { fixture } = readModelOsm(entry.model, pair.osm.bytes);

        expect(fixture.parts).toEqual(stock.parts);
        // Submeshes gain the `array` field of the size-bucketed dictionary; everything else is verbatim
        // (`toEqual` treats an explicit `array: undefined` and an absent key as equal on both sides).
        expect(fixture.submeshes.map((submesh) => ({ ...submesh, array: undefined }))).toEqual(
          stock.submeshes.map((submesh) => ({ ...submesh, array: undefined })),
        );
        fixture.submeshes.forEach((submesh) => {
          expect(submesh.array ?? 0).toBeGreaterThanOrEqual(0);
        });
        expect(fixture.doors).toEqual(stock.doors);
        expect(fixture.dummies).toEqual(stock.dummies);
        expect(fixture.wheels).toEqual(stock.wheels);
        // UV animations (plan 099) — the per-submesh `uvAnim` slot rides in the verbatim compare above,
        // and this is the list it indexes. Both sides must also agree with what the RUNTIME lane gets,
        // which is a third path: `toRigidModelInit` off the DFF build, never through the `.osm` at all.
        expect(fixture.uvAnimations).toEqual(stock.uvAnimations);
        expect(toRigidModelInit(stock).uvAnimations).toEqual(stock.uvAnimations);
      },
      BUILD_TIMEOUT_MS,
    );

    it.each(MODELS)(
      '$kind: $model keeps the dictionary shape (pixels are BC, by design)',
      (entry) => {
        const pair = conversionOf(entry);
        const stock = pair.stock;

        const { model } = readModelOsm(entry.model, pair.osm.bytes);
        const arrays = model.textures.map((texture) =>
          decodeOstex(texture.kind === 'ostex' ? texture.bytes : new Uint8Array()),
        );

        // Not one layer lost, however the buckets split them; the largest bucket is the largest source,
        // which is the size the legacy single array carried.
        expect(arrays.reduce((sum, array) => sum + array.layers.length, 0)).toBe(stock.texture.names.length);
        expect(Math.max(...arrays.map((array) => array.width))).toBe(stock.texture.width);
        expect(Math.max(...arrays.map((array) => array.height))).toBe(stock.texture.height);
      },
      BUILD_TIMEOUT_MS,
    );

    it('an animated object keeps its whole frame tree, verbatim — through the real packer', () => {
      const entry = MODELS[1];
      const fs = fsFor(entry);
      const bundles = createModelBundles();
      const defs = {
        catalog: new Map([
          [1, { anim: 'counxref', drawDistance: 300, flags: 0, id: 1, modelName: entry.model, txdName: entry.txdName }],
        ]),
      };

      const report = packAnimObjects(fs, defs, bundles, quiet);
      const insert = bundles.inserts().find((entry_) => entry_.name === `${entry.model}.osm`)!;
      const section = osmSection(decodeOsm(insert.bytes), OsmSectionTag.SKEL)!;
      const baked = decodeOsmSkeleton(section).frames;
      const raw = getClump(fs, entry.model).frames;

      expect(report.models).toBe(1);
      expect(baked).toHaveLength(raw.length);
      expect(baked).toEqual(
        raw.map((frame) => ({
          boneId: frame.boneId ?? -1,
          name: frame.name,
          parentIndex: frame.parentIndex,
          position: [frame.position[0], frame.position[1], frame.position[2]],
          rotation: [...frame.rotation],
        })),
      );
    });

    it('an animated object that another class already bundled gains ONLY its skeleton', () => {
      const entry = MODELS[1];
      const fs = fsFor(entry);
      const bundles = createModelBundles();
      const defs = {
        catalog: new Map([
          [1, { anim: 'counxref', drawDistance: 300, flags: 0, id: 1, modelName: entry.model, txdName: entry.txdName }],
        ]),
      };
      // Pretend the clutter/prop pass already contributed the rigid sections.
      bundles.add(entry.model, { sections: buildModelOsm(fs, entry.model, { txd: entry.txdName }).sections });

      expect(() => packAnimObjects(fs, defs, bundles, quiet)).not.toThrow();

      const insert = bundles.inserts().find((entry_) => entry_.name === `${entry.model}.osm`)!;
      const sections = decodeOsm(insert.bytes);
      expect(osmSection(sections, OsmSectionTag.SKEL)).not.toBeNull();
      expect(osmSection(sections, OsmSectionTag.GEOM)).not.toBeNull();
    });
  });
});

/**
 * The ped gate. A ped's `.osm` has its own shape (no colours/meta/reflect; joints, weights, a skin-order
 * skeleton with real inverse binds, a posed `minZ`), so it needs its own comparison against the builder.
 */
describe('the ped conversion loses nothing', () => {
  const MODEL = 'bmypol1';
  const TXD = 'bmypol1';

  const pedFs = (): AssetFileSystem => {
    const files = new Map<string, ArrayBuffer>([
      [`${MODEL}.dff`, fileOf('character/bmypol1.dff')],
      [`${TXD}.txd`, fileOf('character/bmypol1.txd')],
    ]);

    return {
      get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
      getText: () => null,
      has: (name: string): boolean => files.has(name.toLowerCase()),
      names: [...files.keys()],
    };
  };

  describe('positive cases', () => {
    it('keeps every skinned buffer, byte for byte', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const read = readPedOsm(MODEL, buildPedOsm(fs, MODEL, TXD).bytes);

      expect(read.fixture.vertexCount).toBe(stock.positions.length / 3);
      expect(read.fixture.indexCount).toBe(stock.indices.length);
      expect(new Float32Array(read.geometry.positions.slice().buffer)).toEqual(stock.positions);
      expect(new Float32Array(read.geometry.normals.slice().buffer)).toEqual(stock.normals);
      expect(new Float32Array(read.geometry.uvs.slice().buffer)).toEqual(stock.uvs);
      expect(new Uint16Array(read.geometry.indices.slice().buffer)).toEqual(stock.indices);
      expect(read.geometry.joints).toEqual(stock.joints);
      expect(read.geometry.weights).toEqual(stock.weights);
    });

    it('keeps the whole skeleton — skin order, parents, bone ids and inverse binds', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const read = readPedOsm(MODEL, buildPedOsm(fs, MODEL, TXD).bytes);

      expect(read.fixture.bones).toEqual(stock.bones);
      expect(read.fixture.minZ).toBe(stock.minZ);
    });

    it('carries EVERY texture, resolving each submesh to an (array, layer) slot', () => {
      const fs = pedFs();
      const stock = buildPedModel(parseDff(fs.get(`${MODEL}.dff`)!), [fs.get(`${TXD}.txd`)!])!;

      const built = buildPedOsm(fs, MODEL, TXD);
      const read = readPedOsm(MODEL, built.bytes);
      const layers = read.textureArrays.reduce((sum, array) => sum + decodeOstex(array).layers.length, 0);

      // Not one texture lost, however much their sizes disagree.
      expect(layers).toBe(stock.textures.length);
      expect(read.fixture.submeshes).toHaveLength(stock.submeshes.length);
      read.fixture.submeshes.forEach((submesh, index) => {
        expect(submesh.indexCount).toBe(stock.submeshes[index].indexCount);
        expect(submesh.indexOffset).toBe(stock.submeshes[index].indexOffset);
        expect(submesh.texture).toBe(stock.submeshes[index].texture);
        expect(read.textureArrays[submesh.array]).toBeDefined();
        expect(decodeOstex(read.textureArrays[submesh.array]).layers.length).toBeGreaterThan(submesh.layer);
      });
    });
  });
});
