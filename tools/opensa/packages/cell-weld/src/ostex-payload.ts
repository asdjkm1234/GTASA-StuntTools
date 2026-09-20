/**
 * Tight mip rows → the 256-aligned `.ostex` payload (`queue.writeTexture`'s bytes-per-row rule).
 *
 * Extracted from the world TexturePlanner so the PER-MODEL writer (plan opensa-pack/003 phase 2) packs
 * layers exactly the way the world arrays are packed — one repack, one set of alignment rules.
 */
import { type OstexFormatId, ostexLayerBytes, ostexMipLayout, ostexTightRowBytes } from '@opensa/engine-formats';

/** One mip level's tightly-packed bytes (rows back-to-back, no padding). */
export interface TightMip {
  data: Uint8Array;
}

/** Layer-major, mip-minor payload with every mip's rows aligned to {@link OSTEX_ROW_ALIGN}. */
export function packOstexPayload(
  format: OstexFormatId,
  width: number,
  height: number,
  mipCount: number,
  layers: readonly (readonly TightMip[])[],
): Uint8Array {
  const payload = new Uint8Array(ostexLayerBytes(format, width, height, mipCount) * layers.length);
  let offset = 0;
  for (const mips of layers) {
    for (let level = 0; level < mipCount; level += 1) {
      const layout = ostexMipLayout(format, width, height, level);
      const mip = mips[level];
      // The format's own block table, never a copy of it (see `ostexTightRowBytes`).
      const tightRow = ostexTightRowBytes(format, layout.mipWidth);
      for (let row = 0; row < layout.rows; row += 1) {
        payload.set(mip.data.subarray(row * tightRow, (row + 1) * tightRow), offset + row * layout.bytesPerRow);
      }
      offset += layout.totalBytes;
    }
  }

  return payload;
}
