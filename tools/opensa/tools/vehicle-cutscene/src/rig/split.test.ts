import { readRw, RW_BIN_MESH_PLG, RW_EXTENSION, RW_STRUCT } from '@opensa/rw-codec/chunk';
import { decodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { geometryBodyHasTranslucency } from '../materials';
import { type ClumpModel, type OpaqueChunk, readClump } from './clump-io';
import { splitGeometryByTranslucency } from './split';

const BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.dff'));

function binMeshOf(body: Uint8Array): { indices: number; materials: number[] } {
  const extension = readRw(body).chunks.find((chunk) => chunk.type === RW_EXTENSION);
  const bin = extension!.children!.find((chunk) => chunk.type === RW_BIN_MESH_PLG)!;
  const view = new DataView(bin.data!.buffer, bin.data!.byteOffset, bin.data!.byteLength);
  const numMeshes = view.getUint32(4, true);
  const materials: number[] = [];
  let offset = 12;
  for (let mesh = 0; mesh < numMeshes; mesh += 1) {
    const numIndices = view.getUint32(offset, true);
    materials.push(view.getUint32(offset + 4, true));
    offset += 8 + numIndices * 4;
  }

  return { indices: view.getUint32(8, true), materials };
}

function geometryOf(model: ClumpModel, frameName: string): OpaqueChunk {
  const index = model.frames.findIndex((frame) => frame.name === frameName);
  const atomic = model.atomics.find((entry) => entry.frameIndex === index)!;

  return model.geometries[atomic.geometryIndex];
}

function structOf(body: Uint8Array): ReturnType<typeof decodeGeometryStruct> {
  return decodeGeometryStruct(readRw(body).chunks.find((chunk) => chunk.type === RW_STRUCT)!.data!);
}

describe('splitGeometryByTranslucency', () => {
  describe('negative cases', () => {
    it('returns null for a fully opaque geometry', () => {
      const model = readClump(BOBCAT);
      expect(splitGeometryByTranslucency(geometryOf(model, 'bonnet_ok'))).toBeNull();
    });

    it('returns null when every triangle is translucent (nothing opaque to keep)', () => {
      const model = readClump(BOBCAT);
      expect(splitGeometryByTranslucency(geometryOf(model, 'windscreen_ok'))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('splits a mixed door into an opaque copy and a translucent twin, byte-narrow', () => {
      // The stock bobcat door embeds its 128-alpha glass — the sabre's in-door pane shape.
      const model = readClump(BOBCAT);
      const source = geometryOf(model, 'door_lf_ok');
      const split = splitGeometryByTranslucency(source)!;
      expect(split).not.toBeNull();

      // Classifiers read each copy as what it is — the pipeline stamp and pane order key off this.
      expect(geometryBodyHasTranslucency(split.opaque.body)).toBe(false);
      expect(geometryBodyHasTranslucency(split.translucent.body)).toBe(true);

      // The triangle list partitions; the vertex arrays stay whole on both sides.
      const before = structOf(source.body);
      const opaque = structOf(split.opaque.body);
      const translucent = structOf(split.translucent.body);
      expect(opaque.numTriangles + translucent.numTriangles).toBe(before.numTriangles);
      expect(opaque.numVertices).toBe(before.numVertices);
      expect(translucent.numVertices).toBe(before.numVertices);
      expect(opaque.prelit).toEqual(before.prelit);
      expect(translucent.prelit).toEqual(before.prelit);

      // The BinMesh entries partition by material — winding/strip bytes untouched, counts follow.
      const binBefore = binMeshOf(source.body);
      const binOpaque = binMeshOf(split.opaque.body);
      const binTranslucent = binMeshOf(split.translucent.body);
      expect(binOpaque.indices + binTranslucent.indices).toBe(binBefore.indices);
      expect([...binOpaque.materials, ...binTranslucent.materials].sort()).toEqual([...binBefore.materials].sort());
      expect(binTranslucent.materials).toEqual([7]); // the door's glass material alone
    });
  });
});
