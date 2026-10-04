import { buildArchiveBuffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createTextureSource } from './texture-source';

/**
 * The `sm_bush_large_1` regression on REAL assets (plan 004): its `newtreeleaves128` exists in many stock
 * TXDs with different pixels. The def TXD (`badlands`, vegepart.ide) must win over the flat first-wins index
 * (which used to hand the bush `gta_proc_bush`'s green variant). Fixtures: `npm run test:fixtures`.
 */
const BUSH_DFF = 'fixtures/original/world/sm_bush_large_1.dff';
const BADLANDS_TXD = 'fixtures/original/txd/badlands.txd';
const PROC_BUSH_TXD = 'fixtures/original/txd/gta_proc_bush.txd';

const fixturesPresent = [BUSH_DFF, BADLANDS_TXD, PROC_BUSH_TXD].every((path) => existsSync(path));

function bytes(path: string): Uint8Array {
  const data = readFileSync(path);

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

describe.skipIf(!fixturesPresent)('scoped texture resolution (real assets)', () => {
  describe('positive cases', () => {
    it('the bush model references newtreeleaves128, present in BOTH fixture TXDs with different pixels', () => {
      const clump = parseDff(toArrayBuffer(bytes(BUSH_DFF)));
      const names = new Set(
        clump.geometries.flatMap((g) => g.materials.map((m) => m.texture?.name.toLowerCase() ?? '')),
      );
      expect(names.has('newtreeleaves128')).toBe(true);

      // gta_proc_bush indexed first → the flat get() returns ITS variant, not badlands'.
      const archive = openArchive(
        buildArchiveBuffer([
          { data: bytes(PROC_BUSH_TXD), name: 'gta_proc_bush.txd' },
          { data: bytes(BADLANDS_TXD), name: 'badlands.txd' },
        ]),
      );
      const source = createTextureSource([archive]);
      const flat = source.get('newtreeleaves128')!;
      const own = source.getFrom!('badlands', 'newtreeleaves128')!;
      const procBush = source.getFrom!('gta_proc_bush', 'newtreeleaves128')!;

      expect(Buffer.from(flat.rgba).equals(Buffer.from(procBush.rgba))).toBe(true); // flat == first-wins winner
      expect(Buffer.from(own.rgba).equals(Buffer.from(procBush.rgba))).toBe(false); // ≠ the def TXD's variant
    });
  });
});
