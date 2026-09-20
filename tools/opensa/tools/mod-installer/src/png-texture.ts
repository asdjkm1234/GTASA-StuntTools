import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_NATIVE } from '@opensa/rw-codec/chunk';
import { buildMipChain } from '@opensa/rw-codec/mip';
import { encodeDxtStruct, encodeUncompressedStruct, isCompressedRaster } from '@opensa/rw-codec/texture-native';

import { decodePng } from './png-decode';

/**
 * Build a RenderWare `TextureNative` chunk from a PNG, with a full mip chain. `version` is the host
 * dictionary's RW version, so the new texture stays consistent with the file it joins.
 *
 * `replaced` is the Struct of the texture this PNG takes the place of, when there is one — and it decides
 * the raster format (plan 015): a texture the original ships UNCOMPRESSED stays uncompressed, because the
 * game may read that raster back on the CPU rather than sample it (`platecharset`: `CCustomCarPlateMgr`
 * locks it and copies glyph pixels, so DXT blocks reach the plate as colour — the green plates of
 * 2026-08-20). Everything else — a PNG that ADDS a texture, or one replacing a DXT raster — is compressed
 * as before: **DXT5** when the image has any real alpha, else **DXT1**.
 */
export function pngToTextureNative(
  name: string,
  pngBytes: Uint8Array,
  version: number,
  replaced?: Uint8Array,
): RwChunk {
  const { height, rgba, width } = decodePng(pngBytes);
  const alpha = hasAlpha(rgba);
  const levels = buildMipChain(rgba, width, height, 'gamma'); // installed into the real-SA build
  const data =
    replaced && !isCompressedRaster(replaced)
      ? encodeUncompressedStruct(name, levels, alpha)
      : encodeDxtStruct(name, alpha ? 'dxt5' : 'dxt1', levels);

  return {
    children: [
      { data, type: RW_STRUCT, version },
      { children: [], type: RW_EXTENSION, version },
    ],
    type: RW_TEXTURE_NATIVE,
    version,
  };
}

/** Any pixel with alpha < 255 ⇒ the texture needs a real alpha channel (DXT5). */
function hasAlpha(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) {
      return true;
    }
  }

  return false;
}
