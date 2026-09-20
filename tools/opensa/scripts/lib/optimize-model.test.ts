import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  describeGeometries,
  forceRebuild,
  optimizeModel,
  restripBinMeshes,
  stripNormals,
  variantFromArgv,
} from './optimize-model';

const fixture = join(process.cwd(), 'fixtures', 'original', 'dff', 'binmesh-order', 'cehollyhil06.dff');
const load = (): Uint8Array => new Uint8Array(readFileSync(fixture));
const triangles = (dff: Uint8Array): string[] =>
  parseDff(dff.buffer.slice(dff.byteOffset, dff.byteOffset + dff.byteLength) as ArrayBuffer)
    .geometries[0].triangles.map((t) => {
      const r = [t.a, t.b, t.c];
      while (r[0] !== Math.min(...r)) r.push(r.shift() as number);

      return `${r.join(',')}|${t.materialIndex}`;
    })
    .sort();

describe('variantFromArgv', () => {
  describe('negative cases', () => {
    it('refuses two variants at once', () => {
      expect(() => variantFromArgv(['x', '--raw', '--restrip'])).toThrow(/pick one/);
    });
  });

  describe('positive cases', () => {
    it('defaults to chain and maps each flag', () => {
      expect(variantFromArgv(['x'])).toBe('chain');
      expect(variantFromArgv(['x', '--strip-normals-after'])).toBe('strip-normals-after');
      expect(variantFromArgv(['x', '--list-only'])).toBe('list-only');
    });
  });
});

describe.skipIf(!existsSync(fixture))('optimize-model variants on cehollyhil06', () => {
  describe('negative cases', () => {
    it('raw returns the source bytes untouched', () => {
      const source = load();
      expect(optimizeModel('cehollyhil06', source, 'raw', undefined)).toBe(source);
    });
  });

  describe('positive cases', () => {
    it('list-only re-encodes to a trilist with the same triangles, vertices and prelit', () => {
      const source = load();
      const out = forceRebuild(source);
      const [before] = describeGeometries(source);
      const [after] = describeGeometries(out);
      expect(before.flags & 0x01).toBe(0x01);
      expect(after.flags & 0x01).toBe(0);
      expect(after.vertices).toBe(before.vertices);
      expect(triangles(out)).toEqual(triangles(source));
    });

    it('restrip draws exactly the chain triangles with the chain winding, as a strip', () => {
      const chain = optimizeModel('cehollyhil06', load(), 'chain', undefined);
      const restrip = restripBinMeshes(chain);
      expect(describeGeometries(chain)[0].flags & 0x01).toBe(0);
      expect(describeGeometries(restrip)[0].flags & 0x01).toBe(0x01);
      expect(triangles(restrip)).toEqual(triangles(chain));
    });

    it('strip-normals-after clears NORMALS and keeps the rebuild (list, split vertices)', () => {
      const source = load();
      const chain = optimizeModel('cehollyhil06', source, 'chain', undefined);
      const stripped = stripNormals(chain);
      const [c] = describeGeometries(chain);
      const [s] = describeGeometries(stripped);
      expect(c.flags & 0x10).toBe(0x10);
      expect(s.flags & 0x10).toBe(0);
      expect(s.vertices).toBe(c.vertices);
      expect(s.bytes).toBeLessThan(c.bytes);
    });
  });
});
