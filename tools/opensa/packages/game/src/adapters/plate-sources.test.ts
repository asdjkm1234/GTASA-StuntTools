import type { RWTexture, RWTextureDictionary } from '@opensa/renderware/parsers/binary/types';

import { describe, expect, it } from 'vitest';

import { extractPlateSources } from './plate-sources';

function dictionary(...names: string[]): RWTextureDictionary {
  return { textures: names.map((name) => texture(name)) };
}

/** The stock sizes: the charset is 32×256, every background 64×32. */
function texture(name: string, width?: number, height?: number): RWTexture {
  const isCharset = name.toLowerCase() === 'platecharset';
  const w = width ?? (isCharset ? 32 : 64);
  const h = height ?? (isCharset ? 256 : 32);

  return {
    format: 'rgba8888',
    hasAlpha: false,
    height: h,
    maskName: '',
    mipmaps: [{ data: new Uint8Array(w * h * 4), height: h, width: w }],
    name,
    width: w,
  };
}

describe('extractPlateSources', () => {
  describe('negative cases', () => {
    it('returns null when the charset is missing', () => {
      expect(extractPlateSources(dictionary('plateback1', 'plateback2', 'plateback3'))).toBeNull();
    });

    it('returns null when a background is missing', () => {
      expect(extractPlateSources(dictionary('platecharset', 'plateback1', 'plateback2'))).toBeNull();
    });

    it('returns null for a dictionary with no plate rasters at all', () => {
      expect(extractPlateSources(dictionary('vehiclegrunge256'))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('decodes the charset with the grid derived from its size', () => {
      const sources = extractPlateSources(dictionary('platecharset', 'plateback1', 'plateback2', 'plateback3'));
      expect(sources?.charset).toMatchObject({ cellHeight: 16, cellWidth: 8, height: 256, width: 32 });
    });

    it('keeps the three backgrounds in plateback1..3 order', () => {
      const sources = extractPlateSources(dictionary('plateback3', 'platecharset', 'plateback1', 'plateback2'));
      expect(sources?.backgrounds).toHaveLength(3);
    });

    it('takes a modded background at whatever size it ships', () => {
      const txd: RWTextureDictionary = {
        textures: [
          texture('platecharset'),
          texture('plateback1', 512, 256),
          texture('plateback2', 512, 256),
          texture('plateback3', 512, 256),
        ],
      };
      expect(extractPlateSources(txd)?.backgrounds[0]).toMatchObject({ height: 256, width: 512 });
    });

    it('software-decodes a DXT background — what the BUILT pak actually ships', () => {
      // The stock dictionary is uncompressed, but the installed pack's is DXT1, so this branch is the one
      // production takes. One 4×4 block: colour0 = white, every index 0 → sixteen white texels.
      const block = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const compressed: RWTexture = {
        format: 'dxt1',
        hasAlpha: false,
        height: 4,
        maskName: '',
        mipmaps: [{ data: block, height: 4, width: 4 }],
        name: 'plateback1',
        width: 4,
      };
      const txd: RWTextureDictionary = {
        textures: [texture('platecharset'), compressed, texture('plateback2'), texture('plateback3')],
      };

      const decoded = extractPlateSources(txd)?.backgrounds[0];
      expect(decoded).toMatchObject({ height: 4, width: 4 });
      expect(decoded?.rgba).toHaveLength(4 * 4 * 4);
      expect([...decoded!.rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    });

    it('matches textures case-insensitively', () => {
      const txd: RWTextureDictionary = {
        textures: [texture('PlateCharset'), texture('PLATEBACK1'), texture('plateback2'), texture('plateback3')],
      };
      expect(extractPlateSources(txd)).not.toBeNull();
    });
  });
});
