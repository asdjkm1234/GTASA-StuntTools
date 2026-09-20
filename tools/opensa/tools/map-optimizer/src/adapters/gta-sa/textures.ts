import type { RwChunk } from '@opensa/rw-codec/chunk';
import type { DxtFormat } from '@opensa/rw-codec/dxt';

import { resampleToPow2 } from '@opensa/cell-weld/alpha';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { encodeDxt } from '@opensa/rw-codec/dxt-encode';
import { buildMipChain } from '@opensa/rw-codec/mip';
import {
  encodeDxtStruct,
  encodeRgba8888Struct,
  encodeSameFormatStruct,
  readTextureName,
} from '@opensa/rw-codec/texture-native';

const DXT_FORMATS = new Set<string>(['dxt1', 'dxt3', 'dxt5']);

/** Outcome of optimizing one TXD: the rebuilt bytes + how many textures got mips vs were left as-is. */
export interface TxdResult {
  bytes: Uint8Array;
  processed: number;
  /** DXT textures whose top level was not a multiple of 4 on both sides, resampled to a power of two. */
  resized: number;
  skipped: number;
}

/**
 * Generate mip chains for the single-level, power-of-two textures in a TXD and write them back natively
 * (DXT → uncompressed 8888; uncompressed → 8888 + mips). Textures left untouched keep their exact bytes (the
 * chunk codec preserves them). Decodes pixels via `../src` `parseTxd` read-only; matches the chunk tree's
 * TextureNatives to it **by name**.
 */
export function optimizeTxd(txdBytes: Uint8Array): TxdResult {
  const dictionary = parseTxd(toArrayBuffer(txdBytes));
  const byName = new Map(dictionary.textures.map((texture) => [texture.name.toLowerCase(), texture]));
  const file = readRw(txdBytes);
  let processed = 0;
  let resized = 0;
  let skipped = 0;

  for (const native of textureNatives(file.chunks)) {
    const struct = native.children?.find((child) => child.type === RW_STRUCT && child.data);
    const texture = struct?.data ? byName.get(readTextureName(struct.data).toLowerCase()) : undefined;
    if (!struct?.data || !texture) {
      skipped += 1;
      continue;
    }
    if (DXT_FORMATS.has(texture.format) && !blockAligned(texture.width, texture.height)) {
      // A DXT raster whose top level is not a multiple of 4 on both sides never loads in the real game — and
      // it takes the WHOLE dictionary with it, so every model on that TXD is never drawn (field, 2026-08-17:
      // a mod's 932×358 DXT1 airport sign, our 62×62 / 64×38 / 224×207 clone atlases; the same textures at a
      // power of two load). Stock ships 26 004 textures and not one NPOT, so that is the shape written back:
      // decode, resample to the nearest power of two, full mips, same DXT format, header rebuilt from scratch.
      // `docs/restrictions/dxt-raster-dimensions.md`.
      const format = texture.format as DxtFormat;
      const decoded = decodeDxt(format, texture.mipmaps[0].data, texture.width, texture.height);
      const sized = resampleToPow2(decoded, texture.width, texture.height, 'up'); // an author's texels: never fewer
      const levels = buildMipChain(sized.rgba, sized.width, sized.height, 'gamma');
      struct.data = encodeDxtStruct(texture.name, format, levels);
      resized += 1;
      processed += 1;
      continue;
    }
    if (!shouldMip(texture.mipmaps.length, texture.width, texture.height)) {
      skipped += 1;
      continue;
    }
    if (DXT_FORMATS.has(texture.format)) {
      const format = texture.format as DxtFormat;
      const rgba = buildMipChain(
        decodeDxt(format, texture.mipmaps[0].data, texture.width, texture.height),
        texture.width,
        texture.height,
        'gamma', // the optimizer edits the REAL-SA game build — D3D9-era gamma filtering (plan 012)
      );
      // Keep the original base level (lossless); re-encode only the downsampled mips to the same DXT format.
      const levels = [
        { data: texture.mipmaps[0].data },
        ...rgba.slice(1).map((level) => ({ data: encodeDxt(format, level.data, level.width, level.height) })),
      ];
      struct.data = encodeSameFormatStruct(struct.data, levels);
    } else {
      struct.data = encodeRgba8888Struct(
        struct.data,
        buildMipChain(texture.mipmaps[0].data, texture.width, texture.height, 'gamma'),
        texture.hasAlpha,
      );
    }
    processed += 1;
  }

  return { bytes: writeRw(file), processed, resized, skipped };
}

/** DXT stores 4×4 blocks; a top level that is not a multiple of 4 on both sides is the raster D3D9 refuses. */
function blockAligned(width: number, height: number): boolean {
  return width % 4 === 0 && height % 4 === 0;
}

function isPow2(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** A texture earns mips when it has exactly one stored level, is power-of-two, and isn't already 1×1. */
function shouldMip(levelCount: number, width: number, height: number): boolean {
  return levelCount === 1 && isPow2(width) && isPow2(height) && (width > 1 || height > 1);
}

function textureNatives(chunks: readonly RwChunk[]): RwChunk[] {
  const natives: RwChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.type === RW_TEXTURE_DICTIONARY) {
      for (const child of chunk.children ?? []) {
        if (child.type === RW_TEXTURE_NATIVE) {
          natives.push(child);
        }
      }
    }
  }

  return natives;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
