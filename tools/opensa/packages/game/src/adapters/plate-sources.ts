import type { RWTexture, RWTextureDictionary } from '@opensa/renderware/parsers/binary/types';

import { decodeDxt } from '@opensa/renderware/textures/dxt';

import type { PlateRaster, PlateSources } from '../vehicle/plate-raster';

/**
 * The GTA-SA half of plates (plan 082/01): lift the plate rasters out of `models/generic/vehicle.txd`
 * and hand the game layer plain RGBA. Lives here because only `adapters/` may reach renderware.
 */
import { charsetFromRaster } from '../vehicle/plate-raster';

const BACKGROUND_NAMES = ['plateback1', 'plateback2', 'plateback3'] as const;
const CHARSET_NAME = 'platecharset';

/**
 * Decode the plate rasters out of a parsed `models/generic/vehicle.txd`. Returns `null` when the
 * dictionary is modded past recognition (a missing charset or background) — plates then stay stock
 * instead of crashing, the format-level graceful-degradation rule.
 *
 * The dictionary survives packing untouched (measured in the plan's phase 0), so this reads the same
 * bytes in a built pak as in a stock install — at whatever size a mod ships them.
 */
export function extractPlateSources(txd: RWTextureDictionary): null | PlateSources {
  const charsetTexture = findTexture(txd, CHARSET_NAME);
  if (!charsetTexture) {
    return null;
  }
  const backgrounds: PlateRaster[] = [];
  for (const name of BACKGROUND_NAMES) {
    const texture = findTexture(txd, name);
    if (!texture) {
      return null;
    }
    backgrounds.push(toRaster(texture));
  }

  return { backgrounds, charset: charsetFromRaster(toRaster(charsetTexture)) };
}

/** Decode a texture's base mip to RGBA8888 (DXT decodes in software; rgba passes through). */
function decodeBaseMip(texture: RWTexture): Uint8Array {
  const mip = texture.mipmaps[0];
  if (texture.format === 'rgba8888') {
    return mip.data;
  }

  return decodeDxt(texture.format, mip.data, texture.width, texture.height);
}

function findTexture(txd: RWTextureDictionary, name: string): RWTexture | undefined {
  return txd.textures.find((texture) => texture.name.toLowerCase() === name);
}

function toRaster(texture: RWTexture): PlateRaster {
  return { height: texture.height, rgba: decodeBaseMip(texture), width: texture.width };
}
