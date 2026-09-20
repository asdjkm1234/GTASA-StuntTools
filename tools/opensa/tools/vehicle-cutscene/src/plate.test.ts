import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { appendTextures, composePlatePair, PLATE_TOWNS, plateTextFor } from './plate';
import { toArrayBuffer } from './template';
import { emptyTxd, textureNames } from './txd';

const GENERIC = new Uint8Array(readFileSync('fixtures/original/models/generic/vehicle.txd'));

describe('composePlatePair', () => {
  describe('negative cases', () => {
    it('throws when the dictionary has no plate sources', () => {
      expect(() => composePlatePair(emptyTxd(), 'AB12 CDE', 'LA')).toThrow('no plate sources');
    });
  });

  describe('positive cases', () => {
    it('composes the 64×16 text strip and the 64×32 town background', () => {
      const pair = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      expect(pair.carplate.width).toBe(64);
      expect(pair.carplate.height).toBe(16);
      expect(pair.carpback.width).toBe(64);
      expect(pair.carpback.height).toBe(32);
      // The glyph cells carry the charset's texels — a composed strip is never a flat colour.
      const texels = new Set<string>();
      for (let at = 0; at < pair.carplate.rgba.length; at += 4) {
        texels.add(`${pair.carplate.rgba[at]},${pair.carplate.rgba[at + 1]},${pair.carplate.rgba[at + 2]}`);
      }
      expect(texels.size).toBeGreaterThan(4);
    });

    it('selects a different background per town (SF is not LS)', () => {
      const la = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      const sf = composePlatePair(GENERIC, 'AB12 CDE', 'SF');
      expect(sf.carpback.rgba).not.toEqual(la.carpback.rgba);
      expect(sf.carplate.rgba).toEqual(la.carplate.rgba); // the text strip is town-independent
    });
  });
});

describe('plateTextFor', () => {
  describe('negative cases', () => {
    it('cuts an override longer than the eight cells a plate has', () => {
      expect(plateTextFor('csbobcat92', 'TOOLONGTEXT')).toBe('TOOLONGT');
    });
  });

  describe('positive cases', () => {
    it('derives a deterministic game-shaped text per slot — stable across calls, different per slot', () => {
      const bobcat = plateTextFor('csbobcat92');
      expect(plateTextFor('csbobcat92')).toBe(bobcat);
      expect(bobcat).toMatch(/^[A-Z]{2}\d{2} \d[A-Z]{2}$/); // the game's own LLDD DLL mask
      expect(plateTextFor('cstaxi92')).not.toBe(bobcat);
    });

    it('exposes the three town keys the CLI accepts', () => {
      expect(Object.keys(PLATE_TOWNS).sort()).toEqual(['ls', 'lv', 'sf']);
      expect(PLATE_TOWNS['ls']).toBe('LA');
    });
  });
});

describe('appendTextures', () => {
  describe('negative cases', () => {
    it('throws on bytes that are not a texture dictionary', () => {
      const pair = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      expect(() => appendTextures(new Uint8Array(16), [{ name: 'carplate', raster: pair.carplate }])).toThrow();
    });
  });

  describe('positive cases', () => {
    it('appends the pair to an empty dictionary and the result parses with both entries', () => {
      const pair = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      const txd = appendTextures(emptyTxd(), [
        { name: 'carplate', raster: pair.carplate },
        { name: 'carpback', raster: pair.carpback },
      ]);

      expect(textureNames(txd)).toEqual(['carplate', 'carpback']);
      const parsed = parseTxd(toArrayBuffer(txd));
      const carplate = parsed.textures.find((texture) => texture.name === 'carplate')!;
      expect(carplate.width).toBe(64);
      expect(carplate.height).toBe(16);
      expect(carplate.format).toBe('rgba8888');
      // Round-trip: the parser's BGRX→RGBA swizzle must give back the composed RGB exactly.
      const decoded = carplate.mipmaps[0].data;
      for (const at of [0, 400, 2000]) {
        expect(decoded[at * 4]).toBe(pair.carplate.rgba[at * 4]);
        expect(decoded[at * 4 + 1]).toBe(pair.carplate.rgba[at * 4 + 1]);
        expect(decoded[at * 4 + 2]).toBe(pair.carplate.rgba[at * 4 + 2]);
      }
    });

    it('REPLACES a same-named entry instead of duplicating it (a mod shipping carplate gets ours)', () => {
      const pair = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      const once = appendTextures(emptyTxd(), [{ name: 'carplate', raster: pair.carplate }]);
      const twice = appendTextures(once, [{ name: 'carplate', raster: pair.carplate }]);

      expect(textureNames(twice)).toEqual(['carplate']);
      expect(parseTxd(toArrayBuffer(twice)).textures).toHaveLength(1);
    });

    it('keeps every existing entry of the real generic dictionary intact around the appended pair', () => {
      const pair = composePlatePair(GENERIC, 'AB12 CDE', 'LA');
      const before = textureNames(GENERIC);
      const after = textureNames(
        appendTextures(GENERIC, [
          { name: 'carplate', raster: pair.carplate },
          { name: 'carpback', raster: pair.carpback },
        ]),
      );

      // carplate/carpback existed as placeholders — replaced, not duplicated; nothing else moves.
      expect(after.filter((name) => name === 'carplate')).toHaveLength(1);
      expect(new Set(after)).toEqual(new Set(before));
    });
  });
});
