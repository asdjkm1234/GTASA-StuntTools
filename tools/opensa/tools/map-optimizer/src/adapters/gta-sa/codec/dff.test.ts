import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { clumpToIr } from '../read';
import { encodeDff } from './dff';

// Committed mod fixtures (fixtures/custom is tracked); both are full skinned RenderWare clumps.
const FIXTURES = ['fixtures/custom/character/gostown-bmypol1.dff', 'fixtures/custom/character/Shrek.dff'];

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

function load(path: string): { arrayBuffer: ArrayBuffer; bytes: Uint8Array } {
  const buffer = readFileSync(path);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return { arrayBuffer, bytes: new Uint8Array(arrayBuffer) };
}

describe('encodeDff', () => {
  describe('negative cases', () => {
    it('throws when the IR geometry count no longer matches the DFF', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      ir.meshes.push(ir.meshes[0]); // simulate a topology/structure change the in-place patcher can't express

      expect(() => encodeDff(bytes, ir)).toThrow(/geometry count mismatch/);
    });

    it('routes a vertex-count change to rebuild, which refuses a skinned model', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]); // a skinned character
      const ir = clumpToIr(parseDff(arrayBuffer));
      ir.meshes[0].positions = ir.meshes[0].positions.slice(0, -3); // drop a vertex → count change

      expect(() => encodeDff(bytes, ir)).toThrow(/skinned/);
    });

    it('routes a RE-INDEXED triangle (counts unchanged, topology changed) to rebuild, not the overlay', () => {
      // The trap: equal vertex/triangle counts but a triangle pointing at different vertices. The attribute
      // overlay would write stale indices and corrupt the mesh; the topology check must force rebuild (which
      // here refuses skin). A mere PERMUTATION of the list is deliberately not a change — the overlay never
      // writes the index array, and since plan 095 the parser reads triangles in BinMesh order, which is a
      // permutation of this Struct's array in most files.
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      const mesh = ir.meshes.find((candidate) => candidate.triangles.length >= 2)!;
      const vertices = mesh.positions.length / 3;
      const moved = (mesh.triangles[0].a + 1) % vertices;
      mesh.triangles[0] = { ...mesh.triangles[0], a: moved === mesh.triangles[0].b ? (moved + 1) % vertices : moved };

      expect(() => encodeDff(bytes, ir)).toThrow(/skinned/);
    });

    it('keeps the overlay path when the triangle list is only PERMUTED', () => {
      // Skinned on purpose: rebuild would THROW, so re-encoding identically proves the overlay path ran.
      const { arrayBuffer, bytes } = load(FIXTURES[1]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      const mesh = ir.meshes.find((candidate) => candidate.triangles.length >= 2)!;
      [mesh.triangles[0], mesh.triangles[1]] = [mesh.triangles[1], mesh.triangles[0]];

      expect(equal(encodeDff(bytes, ir), bytes)).toBe(true);
    });
  });

  describe('positive cases', () => {
    for (const path of FIXTURES) {
      it(`re-encodes an unchanged ${path.split('/').pop()} identically`, () => {
        const { arrayBuffer, bytes } = load(path);
        const ir = clumpToIr(parseDff(arrayBuffer));
        expect(equal(encodeDff(bytes, ir), bytes)).toBe(true);
      });
    }

    it('writes back a modified normal (topology preserved)', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      const mesh = ir.meshes.find((candidate) => candidate.normals);
      expect(mesh?.normals).toBeTruthy();
      const normals = mesh!.normals!;
      const before = normals[0];
      normals[0] = before + 0.5;

      const encoded = encodeDff(bytes, ir);
      const reparsed = clumpToIr(parseDff(encoded.buffer as ArrayBuffer));
      const sameMesh = reparsed.meshes.find((candidate) => candidate.name === mesh!.name)!;

      expect(equal(encoded, bytes)).toBe(false);
      expect(sameMesh.normals![0]).toBeCloseTo(before + 0.5, 5);
      expect(sameMesh.positions.length).toBe(mesh!.positions.length);
    });
  });
});
