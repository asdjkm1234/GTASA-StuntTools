import type { AssetFileSystem } from '@opensa/renderware';

import { gxtKeyHash } from '@opensa/renderware';
import { describe, expect, it } from 'vitest';

import { buildDistrictTable } from './districts';

const INFO_ZON = [
  'zone',
  'GANTON, 0, 2222.6, -1852.9, -89.0, 2632.8, -1722.3, 110.0, 0, GAN',
  'EASTLS, 0, 2222.6, -1722.3, -89.0, 2632.8, -1330.6, 110.0, 0, EBAY',
  'LOSSANTOS, 0, 44.6, -2892.9, -242.9, 2997.0, -768.0, 900.0, 0, LOSSANTOS',
  'end',
].join('\n');

function fakeFs(files: Readonly<Record<string, ArrayBuffer | string>>): AssetFileSystem {
  return {
    get: (name) => {
      const found = files[name];

      return typeof found === 'string' || found === undefined ? null : found;
    },
    getText: (name) => {
      const found = files[name];

      return typeof found === 'string' ? found : null;
    },
    has: (name) => name in files,
    names: Object.keys(files),
  };
}

/** A 1-entry GXT is enough: the parser is tested next door, this is about the RESOLUTION. */
function fakeGxt(entries: readonly (readonly [string, string])[]): ArrayBuffer {
  const strings: number[] = [];
  const offsets = entries.map(([, text]) => {
    const at = strings.length;
    for (const char of text) {
      strings.push(char.charCodeAt(0));
    }
    strings.push(0);

    return at;
  });
  const keyBytes = entries.length * 8;
  const size = 4 + 4 + 4 + 12 + 4 + 4 + keyBytes + 4 + 4 + strings.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const write = (at: number, tag: string): void => {
    for (let i = 0; i < 4; i += 1) {
      bytes[at + i] = tag.charCodeAt(i);
    }
  };
  bytes.set([4, 0, 8, 0], 0); // version header
  write(4, 'TABL');
  view.setUint32(8, 12, true); // one table entry
  write(12, 'MAIN'); // char[8] name, NUL-padded
  view.setUint32(20, 24, true); // the table's data offset
  write(24, 'TKEY');
  view.setUint32(28, keyBytes, true);
  entries.forEach(([key], index) => {
    view.setUint32(32 + index * 8, offsets[index], true);
    view.setUint32(36 + index * 8, gxtKeyHash(key), true);
  });
  write(32 + keyBytes, 'TDAT');
  view.setUint32(36 + keyBytes, strings.length, true);
  bytes.set(strings, 40 + keyBytes);

  return bytes.buffer;
}

describe('buildDistrictTable', () => {
  describe('negative cases', () => {
    it('returns null when the game ships no info.zon — a total conversion may not', () => {
      expect(buildDistrictTable(fakeFs({}))).toBeNull();
    });

    it('returns null rather than an empty table when info.zon holds no boxes', () => {
      expect(buildDistrictTable(fakeFs({ 'data/info.zon': 'zone\nend' }))).toBeNull();
    });

    it('ships the GXT KEY as the name when the GXT has no row for it', () => {
      const table = buildDistrictTable(fakeFs({ 'data/info.zon': INFO_ZON }));

      expect(table?.gxt).toBeNull();
      expect(table?.districts.map((district) => district.name)).toEqual(['GAN', 'EBAY', 'LOSSANTOS']);
    });
  });

  describe('positive cases', () => {
    it('resolves each box through the GXT and records which GXT it read', () => {
      const table = buildDistrictTable(
        fakeFs({
          'data/info.zon': INFO_ZON,
          'text/american.gxt': fakeGxt([
            ['GAN', 'Ganton'],
            ['EBAY', 'East Los Santos'],
          ]),
        }),
      );

      expect(table?.gxt).toBe('text/american.gxt');
      expect(table?.districts.map((district) => district.name)).toEqual([
        'Ganton',
        'East Los Santos',
        'LOSSANTOS', // no GXT row — falls back to its key rather than shipping an empty name
      ]);
      expect(table?.districts[0].key).toBe('GAN');
      expect(table?.districts[0].min).toEqual([2222.6, -1852.9]);
    });
  });
});
