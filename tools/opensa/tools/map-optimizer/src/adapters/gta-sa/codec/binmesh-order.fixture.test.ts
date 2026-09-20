import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, RW_BIN_MESH_PLG, RW_EXTENSION } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { clumpToIr } from '../read';
import { encodeDff } from './dff';

/**
 * Round 14 of `docs/open-issues/fixed/sa-lod-visibility-budget.md` on the REAL model that showed it: `cehollyhil06`
 * authors its 15 BinMesh splits `0..7, 9..14, 8` — material 8 (the vertex-alpha rock-detail layer) LAST, as
 * RenderWare's mesher orders blended materials. A count-changing re-encode must keep that order; sorting the
 * splits by material drew the detail layer in the middle and smeared it under the reference install's SkyGfx
 * dual pass. Regenerate the fixture with `npm run test:fixtures` (Rockstar asset, not committed).
 */
const fixture = join(process.cwd(), 'fixtures', 'original', 'dff', 'binmesh-order', 'cehollyhil06.dff');

function splitMaterials(dff: Uint8Array): number[] {
  const geometry = collectGeometries(readRw(dff).chunks)[0];
  const bin = geometry.children
    ?.find((child) => child.type === RW_EXTENSION)
    ?.children?.find((child) => child.type === RW_BIN_MESH_PLG)?.data;
  if (!bin) throw new Error('no BinMesh');
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const materials: number[] = [];
  let offset = 12;
  for (let m = 0; m < view.getUint32(4, true); m += 1) {
    const numIndices = view.getUint32(offset, true);
    materials.push(view.getUint32(offset + 4, true));
    offset += 8 + numIndices * 4;
  }

  return materials;
}

describe.skipIf(!existsSync(fixture))('rebuilt BinMesh split order on a real model (round 14)', () => {
  describe('negative cases', () => {
    it('the source really authors the blended split last — the test would prove nothing otherwise', () => {
      const source = new Uint8Array(readFileSync(fixture));
      const order = splitMaterials(source);
      expect(order).toHaveLength(15);
      expect(order[order.length - 1]).toBe(8);
      expect(order).not.toEqual([...order].sort((a, b) => a - b));
    });
  });

  describe('positive cases', () => {
    it('keeps the source split order through a count-changing re-encode (rebuild path)', () => {
      const source = new Uint8Array(readFileSync(fixture));
      const ir = clumpToIr(parseDff(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)));
      // Force the rebuild path the way the smooth-normals split does: duplicate one vertex and point one
      // triangle at the copy — the vertex count moves, so `encodeDff` cannot overlay.
      const mesh = ir.meshes[0];
      const count = mesh.positions.length / 3;
      const dup = (array: Float32Array | null, stride: number): Float32Array | null =>
        array ? new Float32Array([...array, ...array.subarray(0, stride)]) : null;
      mesh.positions = dup(mesh.positions, 3) as Float32Array;
      mesh.normals = dup(mesh.normals, 3);
      mesh.uvs = dup(mesh.uvs, 2);
      mesh.prelitColors = mesh.prelitColors
        ? new Uint8Array([...mesh.prelitColors, ...mesh.prelitColors.subarray(0, 4)])
        : null;
      mesh.nightColors = mesh.nightColors
        ? new Uint8Array([...mesh.nightColors, ...mesh.nightColors.subarray(0, 4)])
        : null;
      const first = mesh.triangles.find((triangle) => triangle.a === 0) ?? mesh.triangles[0];
      first.a = count;

      const rebuilt = encodeDff(source, ir);
      expect(splitMaterials(rebuilt)).toEqual(splitMaterials(source));
      expect(
        parseDff(rebuilt.buffer.slice(rebuilt.byteOffset, rebuilt.byteOffset + rebuilt.byteLength) as ArrayBuffer)
          .geometries[0].positions.length / 3,
      ).toBe(count + 1);
    });
  });
});
