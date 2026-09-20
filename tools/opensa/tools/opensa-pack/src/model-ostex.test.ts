import type { VehicleTextureArray } from '@opensa/renderware/vehicle/types';

import { OstexFormat, readOstexFormat } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { packModelOstex } from './model-ostex';

/** A block-aligned 8×8 dictionary of one layer — `alpha` decides BC1 vs BC3 on the default path. */
function dictionary(alpha: number): VehicleTextureArray {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let texel = 0; texel < 8 * 8; texel += 1) {
    rgba[texel * 4] = 200;
    rgba[texel * 4 + 3] = alpha;
  }

  return { height: 8, layers: 1, names: ['body'], rgba, width: 8 };
}

describe('packModelOstex', () => {
  describe('negative cases', () => {
    // The half `--rgba8` used to miss: a car is not in the pak, so a world converted for a phone still
    // shipped BC dictionaries and threw at the first spawn.
    it('does NOT emit BC when the build asked for a no-BC target', () => {
      expect(readOstexFormat(packModelOstex(dictionary(255), { forceRgba8: true }))).toBe(OstexFormat.RGBA8);
      expect(readOstexFormat(packModelOstex(dictionary(128), { forceRgba8: true }))).toBe(OstexFormat.RGBA8);
    });
  });

  describe('positive cases', () => {
    it('keeps BC by default, because size wins on a desktop build', () => {
      expect(readOstexFormat(packModelOstex(dictionary(255)))).toBe(OstexFormat.BC1);
    });

    it('takes BC3 when a layer needs alpha', () => {
      expect(readOstexFormat(packModelOstex(dictionary(128)))).toBe(OstexFormat.BC3);
    });
  });
});
