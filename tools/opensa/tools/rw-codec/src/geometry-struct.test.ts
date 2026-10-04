import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { GeometryStruct } from './geometry-struct';

import { readRw } from './chunk';
import { collectGeometryStructs } from './dff';
import { decodeGeometryStruct, encodeGeometryStruct } from './geometry-struct';

const PRELIT_FLAG = 0x0008;
const NORMALS_FLAG = 0x0010;

/** A minimal 3-vertex, 1-triangle, 1-morph Struct with prelit + one UV layer + positions. */
function sampleStruct(withNormals: boolean): GeometryStruct {
  return {
    flags: PRELIT_FLAG | (withNormals ? NORMALS_FLAG : 0),
    morphs: [
      {
        bounds: [0, 0, 0, 1],
        normals: withNormals ? new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) : null,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      },
    ],
    native: 0,
    numTriangles: 1,
    numVertices: 3,
    prelit: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    triangles: [{ a: 0, b: 1, c: 2, material: 0 }],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1])],
  };
}

describe('Geometry Struct codec', () => {
  describe('positive cases', () => {
    it('round-trips encode → decode (synthetic)', () => {
      const struct = sampleStruct(true);
      const decoded = decodeGeometryStruct(encodeGeometryStruct(struct));
      expect(decoded).toEqual(struct);
    });

    it('round-trips real fixture Structs byte-for-byte', () => {
      const bytes = new Uint8Array(readFileSync('fixtures/custom/character/gostown-bmypol1.dff'));
      const structs = collectGeometryStructs(readRw(bytes).chunks);
      expect(structs.length).toBeGreaterThan(0);
      for (const struct of structs) {
        const data = struct.data!;
        expect(Buffer.from(encodeGeometryStruct(decodeGeometryStruct(data))).equals(Buffer.from(data))).toBe(true);
      }
    });

    it('derives the UV-layer count from TEXTURED flags when the byte is 0 (casroyale01_lvs family)', () => {
      // The 2015-era exports write the layer-count byte as 0 with TEXTURED carrying the truth — trusting
      // the bare byte read the triangles out of UV data ("Offset is outside the bounds of the DataView").
      const bytes = new Uint8Array(readFileSync('fixtures/custom/locked-models/casroyale01_lvs.dff'));
      const structs = collectGeometryStructs(readRw(bytes).chunks);
      expect(structs.length).toBe(1);
      const decoded = decodeGeometryStruct(structs[0].data!);
      expect(decoded.uvLayers).toHaveLength(1);
      expect(decoded.numVertices).toBe(1418);
      expect(decoded.numTriangles).toBe(1011);
      expect(decoded.triangles.every((t) => t.a < 1418 && t.b < 1418 && t.c < 1418)).toBe(true);
    });
  });
});
