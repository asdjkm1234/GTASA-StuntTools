/**
 * The per-model dictionary and the `meta.x` remap, on a REAL modded map object (plan opensa-pack/003 5g).
 *
 * The point of planning from the raw TXD is the MIP CHAIN: 95 % of the textures the mod packs ship carry
 * one, map-optimizer authors it deliberately, and the path map objects would otherwise take
 * (`packModelOstex` over `buildVehicleModel`'s output) writes a single level. A stock fixture cannot prove
 * this — the stock game barely ships mips — so the fixture is a Chinatown building from `mods-src`.
 *
 * The remap is index surgery: it rewrites every vertex's layer, and a mistake retextures the whole model
 * without failing anything. So it is checked against the ONE thing that survives both sides — the texture
 * NAME, which the `.ostex` carries per layer as a hash.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOstex, fnv1a } from '@opensa/engine-formats';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { parseDff } from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildModelOsm } from './model-osm';
import { type ModelTextureSlot, planModelTextures, remapModelLayers } from './model-textures';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const MODEL = 'chinatown_sfe1';
const TXD = 'chinatownsfe';

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const files = new Map<string, ArrayBuffer>([
  [`${MODEL}.dff`, fileOf('mods/chinatown_sfe1.dff')],
  [`${TXD}.txd`, fileOf('mods/chinatownsfe.txd')],
]);

const fs: AssetFileSystem = {
  get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
  getText: () => null,
  has: (name: string): boolean => files.has(name.toLowerCase()),
  names: [...files.keys()],
};

/** Build the model the way the converter will — one shared result, since a rebuild costs seconds. */
const built = buildVehicleModel(parseDff(files.get(`${MODEL}.dff`)!), new VehicleTextures([files.get(`${TXD}.txd`)!]));
const names = built.texture.names;
// Planned ONCE as well: re-encoding a building's dictionary per assertion blows vitest's per-test timeout
// under coverage, and the plan is pure — every test reads the same result.
const planned = planModelTextures(fs, new Map<string, string>(), names, TXD);
const plan = (): typeof planned => planned;

/** The source chain length per texture NAME, straight from the TXD. */
function sourceMips(): Map<string, number> {
  const out = new Map<string, number>();
  for (const texture of parseTxd(files.get(`${TXD}.txd`)!).textures) {
    out.set(texture.name.toLowerCase(), texture.mipmaps.length);
  }

  return out;
}

const key = (slot: ModelTextureSlot): string => `${slot.array}:${slot.layer}`;

describe('planModelTextures on a real modded map object', () => {
  describe('negative cases', () => {
    it('never collapses the model onto a single array when its textures disagree', () => {
      const { arrays } = plan();

      // The whole reason (array, layer) exists: one array is one size AND one format AND one mip count.
      expect(arrays.length).toBeGreaterThan(1);
    });

    it('leaves no hole in the array list — every slot a submesh can index exists', () => {
      const { arrays, slots } = plan();

      expect(arrays.every((bytes) => bytes !== undefined && bytes.byteLength > 0)).toBe(true);
      for (const slot of slots) {
        expect(arrays[slot.array]).toBeDefined();
        expect(decodeOstex(arrays[slot.array]).layers.length).toBeGreaterThan(slot.layer);
      }
    });
  });

  describe('positive cases', () => {
    it('PRESERVES the source mip chain — the thing packModelOstex drops', () => {
      const source = sourceMips();
      const { arrays, slots } = plan();
      let checked = 0;

      slots.forEach((slot, layer) => {
        const mips = source.get(names[layer]);
        if (mips === undefined || mips < 2) {
          return; // flat colours and single-level textures prove nothing here
        }
        // Opaque well-formed DXT passes through untouched; anything re-processed regenerates a FULL chain.
        // Either way the converted texture must not come out with one level.
        expect(decodeOstex(arrays[slot.array]).mipCount).toBeGreaterThan(1);
        checked += 1;
      });

      expect(checked).toBeGreaterThan(4); // the fixture really does carry chained textures
    });

    it('plans one slot per BUILDER LAYER, in the builder’s order', () => {
      const { slots } = plan();

      expect(slots).toHaveLength(names.length);
      expect(names.length).toBeGreaterThan(1);
    });

    it('lands each layer on the texture the builder NAMED it after', () => {
      const { arrays, slots } = plan();
      const firstClaim = new Map<string, number>();
      let checked = 0;

      slots.forEach((slot, layer) => {
        // Content dedup means a slot is named after its FIRST claimant; a later layer sharing it is only
        // ever a byte-identical texture, so the claim itself is the assertion for those.
        const claimed = firstClaim.get(key(slot));
        if (claimed !== undefined) {
          expect(names[claimed]).not.toBe(names[layer]);

          return;
        }
        firstClaim.set(key(slot), layer);
        if (names[layer] === 'white') {
          return; // the untextured stand-in is planned as a flat colour, and carries that name
        }
        expect(decodeOstex(arrays[slot.array]).layers[slot.layer].nameHash).toBe(fnv1a(names[layer]));
        checked += 1;
      });

      expect(checked).toBeGreaterThan(4);
    });
  });
});

describe('remapModelLayers', () => {
  describe('negative cases', () => {
    it('throws rather than mis-sample when a vertex indexes an unplanned layer', () => {
      const meta = new Uint8Array([7, 0, 0, 0]);

      expect(() => remapModelLayers(meta, [{ array: 0, layer: 3 }])).toThrow(/no planned slot/);
    });

    it('throws when a lamps-on twin lands in another array — a per-vertex swap cannot cross arrays', () => {
      const meta = new Uint8Array([0, 1, 0, 0]);

      expect(() =>
        remapModelLayers(meta, [
          { array: 0, layer: 2 },
          { array: 1, layer: 4 },
        ]),
      ).toThrow(/another array|landed in array/);
    });

    it('throws when a twin lands on planned layer 0, which the runtime reads as "no twin"', () => {
      const meta = new Uint8Array([0, 1, 0, 0]);

      expect(() =>
        remapModelLayers(meta, [
          { array: 0, layer: 2 },
          { array: 0, layer: 0 },
        ]),
      ).toThrow(/no twin/);
    });
  });

  describe('positive cases', () => {
    it('leaves a zero twin alone — 0 means "none", not layer 0', () => {
      const meta = new Uint8Array([1, 0, 5, 9]);

      remapModelLayers(meta, [
        { array: 0, layer: 7 },
        { array: 0, layer: 3 },
      ]);

      expect([...meta]).toEqual([3, 0, 5, 9]); // paint slot and tags untouched
    });

    it('gives every submesh of the real model an array its layer actually exists in', () => {
      // The end-to-end shape: convert with the raw dictionary, read it back the way the engine does, and
      // check the pair a draw uses — the submesh's ARRAY plus its vertices' LAYER — resolves to the texture
      // the builder named. This is the assertion that a wrongly-remapped index cannot survive.
      const osm = buildModelOsm(fs, MODEL, { rawDictionary: { txdParents: new Map<string, string>() }, txd: TXD });
      const { model } = readModelOsm(MODEL, osm.bytes);
      const dictionaries = model.textures.map((texture) =>
        decodeOstex(texture.kind === 'ostex' ? texture.bytes : new Uint8Array()),
      );
      const indices = new Uint16Array(model.indices.buffer, model.indices.byteOffset, model.indexCount);

      expect(model.textures.length).toBeGreaterThan(1);
      expect(model.submeshes.length).toBeGreaterThan(1);
      model.submeshes.forEach((submesh, index) => {
        const array = submesh.array ?? 0;

        expect(dictionaries[array]).toBeDefined();
        // The builder is deterministic, so the untouched build above still holds the PRE-remap layers for
        // the same submesh — which is what makes "went where it was planned to" checkable at all.
        const source = built.submeshes[index];
        const planned = plan().slots[built.meta[built.indices[source.indexOffset] * 4]];

        expect(array).toBe(planned.array);
        for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
          expect(model.meta[indices[at] * 4]).toBe(planned.layer);
          expect(dictionaries[array].layers.length).toBeGreaterThan(planned.layer);
        }
      });
    });

    it('sends every vertex of the real model to the slot its NAME was planned into', () => {
      const { slots } = plan();
      const before = new Uint8Array(built.meta);
      const meta = new Uint8Array(built.meta);

      remapModelLayers(meta, slots);

      expect(meta.length).toBeGreaterThan(0);
      for (let at = 0; at < meta.length; at += 4) {
        expect(meta[at]).toBe(slots[before[at]].layer);
      }
    });
  });
});
