import type { DxtFormat } from './dxt';
import type { MipLevel } from './mip';

import { encodeDxt } from './dxt-encode';

/**
 * Write a `TextureNative` Struct as uncompressed **A8R8G8B8** with a full mip chain (plan 010, Phase 1 — no
 * DXT encoder). Preserves the original's platform / filter / name / maskName / rasterType; overrides the
 * format fields and level data. Pixels are stored **BGRA** (the engine's parser swizzles back to RGBA).
 *
 * Struct header (mirrors `src/.../txd.ts`): `platform u32, filter u32, name[32], maskName[32], rasterFormat
 * u32, d3dFormat u32, width u16, height u16, depth u8, numLevels u8, rasterType u8, flags u8`, then per level
 * `size u32 + data`.
 */

const HEADER_SIZE = 88;
const RASTER_C8888 = 0x0500;
const RASTER_MIPMAP = 0x8000;
const D3DFMT_A8R8G8B8 = 21;
const ALPHA_FLAG = 0x01;

export function encodeRgba8888Struct(original: Uint8Array, levels: readonly MipLevel[], hasAlpha: boolean): Uint8Array {
  const dataSize = levels.reduce((sum, level) => sum + 4 + level.data.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  out.set(original.subarray(0, 72), 0); // platform + filter + name + maskName, verbatim

  const view = new DataView(out.buffer);
  view.setUint32(72, RASTER_C8888 | RASTER_MIPMAP, true);
  view.setUint32(76, D3DFMT_A8R8G8B8, true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = 32; // depth
  out[85] = levels.length; // numLevels
  out[86] = original[86]; // rasterType (preserve)
  out[87] = hasAlpha ? original[87] | ALPHA_FLAG : original[87] & ~ALPHA_FLAG;

  writeBgraLevels(out, view, levels);

  return out;
}

/**
 * Re-encode a TextureNative Struct keeping its **format unchanged** (used for DXT: no palette) — copy the
 * 88-byte header verbatim, set `numLevels` + the mipmap flag, and append the given pre-compressed level data.
 * The base level should be the original bytes (lossless); only the added mips are re-encoded.
 */
export function encodeSameFormatStruct(original: Uint8Array, levels: readonly { data: Uint8Array }[]): Uint8Array {
  const dataSize = levels.reduce((sum, level) => sum + 4 + level.data.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  out.set(original.subarray(0, HEADER_SIZE), 0);

  const view = new DataView(out.buffer);
  view.setUint32(72, view.getUint32(72, true) | RASTER_MIPMAP, true);
  out[85] = levels.length;

  let offset = HEADER_SIZE;
  for (const level of levels) {
    view.setUint32(offset, level.data.length, true);
    offset += 4;
    out.set(level.data, offset);
    offset += level.data.length;
  }

  return out;
}

// From-scratch DXT struct header. OUR parser keys the format off `d3dFormat`, which is why `rasterFormat` was
// treated as decorative for a year — the real game is not our parser, and the fields below are written to
// match what SA's own content carries (measured, see RASTER_FORMAT).
const PLATFORM_D3D9 = 9;
const FILTER_LINEAR_MIP = 0x1106; // trilinear + wrap/wrap
const RASTER_TYPE_TEXTURE = 4;
/**
 * `rasterFormat`, written the way SA's OWN content writes it — measured across `game-src/original`, not read
 * off a wiki: DXT1 declares **565** (`0x0200`), DXT3 declares **4444** (`0x0300`), and the mipmap bit
 * (`0x8000`) is set only when the texture actually ships more than one level.
 *
 * It used to be a constant `0x8300` for everything — 4444 on DXT1 data, and the mip bit set even on a single
 * level. Stock does that nowhere in 3 978 dictionaries, and a raster the game creates from the declared
 * colour format and then fills with blocks of another is exactly the kind of thing that fails inside the
 * loader with nothing to see afterwards.
 */
const RASTER_FORMAT: Record<DxtFormat, number> = { dxt1: 0x0200, dxt3: 0x0300, dxt5: 0x0300 };
const RASTER_EXT_MIPMAP = 0x8000;
const DXT_DEPTH = 16;
const FLAG_DXT = 0x08; // "compressed" bit
const FLAG_ALPHA = 0x01;
const D3DFMT: Record<DxtFormat, number> = { dxt1: 0x31545844, dxt3: 0x33545844, dxt5: 0x35545844 };

/**
 * Build a complete TextureNative Struct **from scratch** (no original to copy): DXT-compress each RGBA mip level
 * and write the 88-byte header. `dxt1` for opaque, `dxt3` for alpha — the two formats stock SA ships. Pairs
 * with the `RW_TEXTURE_NATIVE` wrapper to add a brand-new texture to a dictionary.
 */
export function encodeDxtStruct(name: string, format: DxtFormat, levels: readonly MipLevel[]): Uint8Array {
  const blocks = levels.map((level) => encodeDxt(format, level.data, level.width, level.height));
  const dataSize = blocks.reduce((sum, block) => sum + 4 + block.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, PLATFORM_D3D9, true);
  view.setUint32(4, FILTER_LINEAR_MIP, true);
  writeName(out, 8, name); // name[32]
  // maskName stays EMPTY, as stock's own DXT1 rasters leave it. We used to duplicate the texture name into
  // it, which names a mask that does not exist — one more thing our dictionaries did that the game's content
  // never does.
  writeName(out, 40, ''); // maskName[32]
  view.setUint32(72, RASTER_FORMAT[format] | (levels.length > 1 ? RASTER_EXT_MIPMAP : 0), true);
  view.setUint32(76, D3DFMT[format], true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = DXT_DEPTH;
  out[85] = levels.length;
  out[86] = RASTER_TYPE_TEXTURE;
  out[87] = format === 'dxt1' ? FLAG_DXT : FLAG_DXT | FLAG_ALPHA;

  let offset = HEADER_SIZE;
  for (const block of blocks) {
    view.setUint32(offset, block.length, true);
    offset += 4;
    out.set(block, offset);
    offset += block.length;
  }

  return out;
}

const RASTER_C888 = 0x0600;
const D3DFMT_X8R8G8B8 = 22;
/** Linear + wrap/wrap: what every one of stock's 867 uncompressed rasters carries (all single-level). */
const FILTER_LINEAR = 0x1101;

/**
 * Build a complete UNCOMPRESSED 32-bit TextureNative Struct **from scratch** — the sibling of
 * {@link encodeDxtStruct} for a texture that must not be block-compressed, such as a raster the game reads
 * back on the CPU (mod-installer plan 015). Opaque rasters are written `X8R8G8B8` / `C888` and rasters with
 * alpha `A8R8G8B8` / `C8888`, the pairing stock's own uncompressed content uses.
 *
 * The mip chain is the CALLER's decision and the header follows it: more than one level declares the mipmap
 * bit and a trilinear filter, because a level nothing is allowed to sample is only dead weight. Stock has no
 * example to copy here — it ships every uncompressed raster single-level.
 */
export function encodeUncompressedStruct(name: string, levels: readonly MipLevel[], hasAlpha: boolean): Uint8Array {
  const dataSize = levels.reduce((sum, level) => sum + 4 + level.data.length, 0);
  const out = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(out.buffer);
  const mipped = levels.length > 1;

  view.setUint32(0, PLATFORM_D3D9, true);
  view.setUint32(4, mipped ? FILTER_LINEAR_MIP : FILTER_LINEAR, true);
  writeName(out, 8, name); // name[32]
  writeName(out, 40, ''); // maskName[32] — empty, as stock's own rasters leave it
  view.setUint32(72, (hasAlpha ? RASTER_C8888 : RASTER_C888) | (mipped ? RASTER_EXT_MIPMAP : 0), true);
  view.setUint32(76, hasAlpha ? D3DFMT_A8R8G8B8 : D3DFMT_X8R8G8B8, true);
  view.setUint16(80, levels[0].width, true);
  view.setUint16(82, levels[0].height, true);
  out[84] = 32; // depth
  out[85] = levels.length;
  out[86] = RASTER_TYPE_TEXTURE;
  out[87] = hasAlpha ? ALPHA_FLAG : 0;

  writeBgraLevels(out, view, levels);

  return out;
}

/** `DXT` — the first three bytes of every block-compressed `d3dFormat` FourCC (`DXT1`…`DXT5`). */
const DXT_FOURCC_PREFIX = 0x545844;

/**
 * Does a TextureNative Struct carry DXT blocks? Read off `d3dFormat`, the field OUR parser classifies by:
 * a FourCC spelling `DXT…` when compressed, a small `D3DFORMAT` enum value when not.
 *
 * A Struct too short to hold a header answers **true** — a header we cannot read is not evidence of an
 * uncompressed raster, and compressed is what every caller here does by default.
 */
export function isCompressedRaster(struct: Uint8Array): boolean {
  if (struct.length < HEADER_SIZE) {
    return true;
  }
  const d3dFormat = new DataView(struct.buffer, struct.byteOffset, struct.byteLength).getUint32(76, true);

  return (d3dFormat & 0xffffff) === DXT_FOURCC_PREFIX;
}

/** A TextureNative Struct's texture name (offset 8, 32-byte NUL-terminated). */
export function readTextureName(struct: Uint8Array): string {
  let end = 8;
  while (end < 40 && struct[end] !== 0) {
    end += 1;
  }

  return new TextDecoder().decode(struct.subarray(8, end));
}

/** Append each level as `size u32 + BGRA pixels` from `HEADER_SIZE` on (RGBA in, the raster's order out). */
function writeBgraLevels(out: Uint8Array, view: DataView, levels: readonly MipLevel[]): void {
  let offset = HEADER_SIZE;
  for (const level of levels) {
    view.setUint32(offset, level.data.length, true);
    offset += 4;
    for (let i = 0; i < level.data.length; i += 4) {
      out[offset + i] = level.data[i + 2]; // B
      out[offset + i + 1] = level.data[i + 1]; // G
      out[offset + i + 2] = level.data[i]; // R
      out[offset + i + 3] = level.data[i + 3]; // A
    }
    offset += level.data.length;
  }
}

function writeName(out: Uint8Array, offset: number, name: string): void {
  for (let i = 0; i < Math.min(name.length, 31); i += 1) {
    out[offset + i] = name.charCodeAt(i);
  }
}
