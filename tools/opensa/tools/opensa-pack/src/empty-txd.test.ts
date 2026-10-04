/**
 * Stock SA's EMPTY texture dictionaries (plan opensa-pack/003 phase 5g).
 *
 * Eleven map models point at a TXD that is a valid dictionary chunk in one 2 048-byte IMG sector with
 * nothing inside — `faketarget`, `fake_mule_col`, `fuckknows`, `mine`, … — all of them collision markers or
 * debug leftovers that need no texture. They are byte-identical in the stock and the modded game, so this is
 * Rockstar's own convention, not a data loss and not an anti-rip lock.
 *
 * The game renders such a material with its own colour over a white stand-in. `mine` is the awkward case:
 * its material NAMES a texture (`mine_64`) the empty dictionary cannot supply, which is exactly where a
 * "missing texture" rule would paint it magenta.
 */
import { decodeOsmTextures, decodeOstex, OstexFormat } from '@opensa/engine-formats';
import { parseDff } from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildModelOsm } from './model-osm';

const FIXTURES = join(process.cwd(), 'fixtures', 'original', 'dff', 'empty-txd');

function fileOf(name: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, name));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

const files = new Map<string, ArrayBuffer>([
  ['mine.dff', fileOf('mine.dff')],
  ['mine.txd', fileOf('mine.txd')],
]);

const fs = {
  get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
  getText: (): null => null,
  has: (name: string): boolean => files.has(name.toLowerCase()),
  names: [...files.keys()],
};

describe('an empty stock TXD', () => {
  describe('negative cases', () => {
    it('does not read as a broken file — an empty dictionary is still a dictionary', () => {
      expect(() => parseTxd(files.get('mine.txd')!)).not.toThrow();
      expect(parseTxd(files.get('mine.txd')!).textures).toHaveLength(0);
    });

    it('does not stop the model converting', () => {
      expect(() =>
        buildModelOsm(fs, 'mine', { rawDictionary: { txdParents: new Map<string, string>() } }),
      ).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('gives the NAMED texture a white stand-in, the way the game does — not a magenta marker', () => {
      const osm = buildModelOsm(fs, 'mine', { rawDictionary: { txdParents: new Map<string, string>() } });
      const dictionary = decodeOstex(decodeOsmTextures(osm.ostex).arrays[0]);

      // The material names `mine_64`; with nothing to supply it the layer must be plain white, so the
      // material's own colour comes through the multiply exactly as it does in SA.
      expect(parseDff(files.get('mine.dff')!).geometries[0].materials[0].texture?.name).toBe('mine_64');
      expect(dictionary.format).toBe(OstexFormat.RGBA8);
      expect(dictionary.layers).toHaveLength(1);
      expect([...new Uint8Array(dictionary.payload.buffer, dictionary.payload.byteOffset, 4)]).toEqual([
        255, 255, 255, 255,
      ]);
    });
  });
});
