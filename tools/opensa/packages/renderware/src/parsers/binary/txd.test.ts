import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { chunk, concat, fixedString, toArrayBuffer, u8, u16, u32 } from '../../test-utils';
import { D3dCompression, RasterFormat, RwSection } from './constants';
import { parseTxd } from './txd';

interface NativeOptions {
  d3dFormat: number;
  depth?: number;
  flags: number;
  height: number;
  mip: Uint8Array;
  name: string;
  palette?: Uint8Array;
  rasterFormat: number;
  width: number;
}

function buildSyntheticTxd(natives: Uint8Array[]): ArrayBuffer {
  const dictStruct = chunk(RwSection.STRUCT, concat(u16(natives.length), u16(0)));

  return toArrayBuffer(chunk(RwSection.TEXTURE_DICTIONARY, concat(dictStruct, ...natives)));
}

function texNative(options: NativeOptions): Uint8Array {
  const header = concat(
    u32(9), // platform (D3D9)
    u32(0x1101), // filter/addressing flags
    fixedString(options.name, 32),
    fixedString('', 32), // mask name
    u32(options.rasterFormat),
    u32(options.d3dFormat),
    u16(options.width),
    u16(options.height),
    u8(options.depth ?? 8), // depth
    u8(1), // numLevels
    u8(4), // rasterType
    u8(options.flags),
  );
  const mipBlock = concat(u32(options.mip.length), options.mip);
  const struct = chunk(RwSection.STRUCT, concat(header, options.palette ?? new Uint8Array(0), mipBlock));

  return chunk(RwSection.TEXTURE_NATIVE, struct);
}

describe('parseTxd (synthetic)', () => {
  const dxt5 = texNative({
    d3dFormat: D3dCompression.DXT5,
    flags: 0x01, // hasAlpha
    height: 2,
    mip: new Uint8Array(16), // one DXT5 block
    name: 'compressed',
    rasterFormat: RasterFormat.C8888,
    width: 2,
  });

  const uncompressed = texNative({
    d3dFormat: 0,
    flags: 0x01, // A8R8G8B8 with a real alpha channel — the swizzle keeps its alpha
    height: 1,
    mip: u8(10, 20, 30, 40), // single BGRA pixel
    name: 'raw32',
    rasterFormat: RasterFormat.C8888,
    width: 1,
  });

  // X8R8G8B8 / rasterFormat C888 (0x600) — 32-bit; was previously dropped.
  const x8r8g8b8 = texNative({
    d3dFormat: 0x16,
    flags: 0x00,
    height: 1,
    mip: u8(11, 22, 33, 0),
    name: 'raw32x',
    rasterFormat: RasterFormat.C888,
    width: 1,
  });

  const palette = new Uint8Array(256 * 4);
  palette.set([1, 2, 3, 4], 0); // palette entry 0 as BGRA
  const palettized = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 1,
    mip: u8(0), // single index -> palette entry 0
    name: 'paletted',
    palette,
    rasterFormat: RasterFormat.C8888 | RasterFormat.PAL8,
    width: 1,
  });

  // 16-bit rasters (plan 043): R5G6B5 pure red, A1R5G5B5 opaque green, A4R4G4B4 half-alpha blue.
  const rgb565 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x00,
    height: 1,
    mip: u8(0x00, 0xf8), // 0xF800 = R=31 G=0 B=0
    name: 'rgb565',
    rasterFormat: RasterFormat.C565,
    width: 1,
  });

  const argb1555 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x01,
    height: 1,
    mip: u8(0xe0, 0x83), // 0x83E0 = A=1 R=0 G=31 B=0
    name: 'argb1555',
    rasterFormat: RasterFormat.C1555,
    width: 1,
  });

  const argb4444 = texNative({
    d3dFormat: 0,
    depth: 16,
    flags: 0x01,
    height: 1,
    mip: u8(0x0f, 0x80), // 0x800F = A=8 R=0 G=0 B=15
    name: 'argb4444',
    rasterFormat: RasterFormat.C4444,
    width: 1,
  });

  const unsupported = texNative({
    d3dFormat: 0,
    flags: 0x00,
    height: 2,
    mip: new Uint8Array(4),
    name: 'lum8',
    rasterFormat: RasterFormat.LUM8,
    width: 2,
  });

  // DXT2/DXT4 (premultiplied-alpha variants of DXT3/DXT5) — a D3D9 exporter (carcer, a 2026 mod) writes
  // these FourCCs; identical block layout, so they must decode as dxt3/dxt5 (were mis-classified as 16-bit
  // rgba8888 → the whole texture rendered as rainbow noise).
  const dxt2 = texNative({
    d3dFormat: D3dCompression.DXT2,
    flags: 0x01,
    height: 4,
    mip: new Uint8Array(16), // one DXT3 block
    name: 'premul_dxt2',
    rasterFormat: RasterFormat.C8888,
    width: 4,
  });
  const dxt4 = texNative({
    d3dFormat: D3dCompression.DXT4,
    flags: 0x01,
    height: 4,
    mip: new Uint8Array(16), // one DXT5 block
    name: 'premul_dxt4',
    rasterFormat: RasterFormat.C8888,
    width: 4,
  });

  // PAL4: 2 indices/byte against a 16-entry table. expandPalette assumes 8-bit/256-entry, so decoding would
  // emit a half-size, mostly-black image — the decoder REJECTS it instead (docs/open-issues/pal4-textures.md).
  const pal4 = texNative({
    d3dFormat: 0,
    depth: 4,
    flags: 0x00,
    height: 1,
    mip: u8(0x00),
    name: 'pal4',
    palette: new Uint8Array(16 * 4),
    rasterFormat: RasterFormat.C8888 | RasterFormat.PAL4,
    width: 2,
  });

  const dict = parseTxd(
    buildSyntheticTxd([
      dxt5,
      dxt2,
      dxt4,
      uncompressed,
      x8r8g8b8,
      palettized,
      rgb565,
      argb1555,
      argb4444,
      unsupported,
      pal4,
    ]),
  );

  it('skips textures with unsupported pixel formats but keeps the rest', () => {
    expect(dict.textures.map((t) => t.name)).toEqual([
      'compressed',
      'premul_dxt2',
      'premul_dxt4',
      'raw32',
      'raw32x',
      'paletted',
      'rgb565',
      'argb1555',
      'argb4444',
    ]);
  });

  it('rejects PAL4 (4-bit palettized) rather than mis-decoding it half-size', () => {
    expect(dict.textures.find((t) => t.name === 'pal4')).toBeUndefined();
  });

  it('expands 16-bit rasters to RGBA8888 (plan 043: previously dropped)', () => {
    const red = dict.textures.find((t) => t.name === 'rgb565')!;
    expect(red.format).toBe('rgba8888');
    expect(Array.from(red.mipmaps[0].data)).toEqual([255, 0, 0, 255]);

    const green = dict.textures.find((t) => t.name === 'argb1555')!;
    expect(Array.from(green.mipmaps[0].data)).toEqual([0, 255, 0, 255]);

    const blue = dict.textures.find((t) => t.name === 'argb4444')!;
    expect(Array.from(blue.mipmaps[0].data)).toEqual([0, 0, 255, 8 * 17]);
  });

  it('keeps 32-bit X8R8G8B8 / C888 textures (regression: palm trunks went white)', () => {
    const tex = dict.textures.find((t) => t.name === 'raw32x')!;
    expect(tex.format).toBe('rgba8888');
    // X8R8G8B8: the unused X byte (0) is padding, not alpha → forced OPAQUE (was 0 → whole models invisible).
    expect(Array.from(tex.mipmaps[0].data)).toEqual([33, 22, 11, 255]); // BGRX -> RGBA, opaque
  });

  it('classifies DXT5 and preserves raw block data', () => {
    const tex = dict.textures.find((t) => t.name === 'compressed')!;
    expect(tex.format).toBe('dxt5');
    expect(tex.hasAlpha).toBe(true);
    expect(tex.mipmaps).toHaveLength(1);
    expect(tex.mipmaps[0].data.length).toBe(16);
  });

  it('classifies DXT2/DXT4 as dxt3/dxt5 (premultiplied variants, same block layout)', () => {
    const t2 = dict.textures.find((t) => t.name === 'premul_dxt2')!;
    expect(t2.format).toBe('dxt3');
    expect(t2.mipmaps[0].data.length).toBe(16); // raw block preserved, not expanded

    const t4 = dict.textures.find((t) => t.name === 'premul_dxt4')!;
    expect(t4.format).toBe('dxt5');
    expect(t4.mipmaps[0].data.length).toBe(16);
  });

  it('skips trailing zero-size mip levels (WebGL rejects empty compressed data)', () => {
    const header = concat(
      u32(9),
      u32(0x1101),
      fixedString('mips', 32),
      fixedString('', 32),
      u32(RasterFormat.C8888),
      u32(D3dCompression.DXT1),
      u16(4),
      u16(4),
      u8(8),
      u8(2), // numLevels = 2, but the second is empty
      u8(4),
      u8(0x00),
    );
    const level0 = concat(u32(8), new Uint8Array(8)); // one 4x4 DXT1 block
    const level1 = u32(0); // declared mip with zero bytes
    const native = chunk(RwSection.TEXTURE_NATIVE, chunk(RwSection.STRUCT, concat(header, level0, level1)));
    const tex = parseTxd(buildSyntheticTxd([native])).textures.find((t) => t.name === 'mips')!;
    expect(tex.mipmaps).toHaveLength(1);
    expect(tex.mipmaps[0].data.length).toBe(8);
  });

  it('swizzles uncompressed BGRA pixels to RGBA', () => {
    const tex = dict.textures.find((t) => t.name === 'raw32')!;
    expect(tex.format).toBe('rgba8888');
    expect(Array.from(tex.mipmaps[0].data)).toEqual([30, 20, 10, 40]);
  });

  it('expands palettized indices into RGBA', () => {
    const tex = dict.textures.find((t) => t.name === 'paletted')!;
    expect(tex.format).toBe('rgba8888');
    expect(Array.from(tex.mipmaps[0].data)).toEqual([3, 2, 1, 4]);
  });

  it('skips a leading non-dictionary chunk before the TexDictionary (RwStreamFindChunk behaviour)', () => {
    // Some mod/exporter TXDs prepend an empty type-0 chunk before the dictionary.
    const dict = chunk(
      RwSection.TEXTURE_DICTIONARY,
      concat(chunk(RwSection.STRUCT, concat(u16(1), u16(0))), uncompressed),
    );
    const withPrefix = toArrayBuffer(concat(chunk(0, new Uint8Array(0)), dict));
    expect(parseTxd(withPrefix).textures.map((t) => t.name)).toEqual(['raw32']);
  });

  it('rejects non-txd input', () => {
    expect(() => parseTxd(toArrayBuffer(chunk(RwSection.CLUMP, u32(0))))).toThrow(/Not a TXD/);
  });
});

const txdPath = join(process.cwd(), 'fixtures', 'original', 'txd', 'junk.txd');
const txdExists = existsSync(txdPath);
// Read lazily: describe.skipIf still evaluates the suite body during collection.
const realDict = txdExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(txdPath)))) : null;

describe.skipIf(!txdExists)('parseTxd (real asset junk.txd)', () => {
  it('parses its two textures', () => {
    expect(realDict!.textures).toHaveLength(2);
  });

  it('only contains DXT1-compressed formats', () => {
    const formats = new Set(realDict!.textures.map((t) => t.format));
    expect([...formats]).toEqual(['dxt1']);
  });

  it('exposes junk_tyre as a 64x64 opaque DXT1 texture', () => {
    expect(realDict!.textures.map((t) => t.name).sort()).toEqual(['junk_tyre', 'tyretread_64H']);
    const tex = realDict!.textures.find((t) => t.name === 'junk_tyre')!;
    expect([tex.width, tex.height]).toEqual([64, 64]);
    expect(tex.format).toBe('dxt1');
    expect(tex.hasAlpha).toBe(false);
    expect(tex.mipmaps.length).toBeGreaterThan(0);
  });
});

// A real mod TXD (yosemite / Ford F350) with two anti-rip quirks: a leading empty type-0 chunk before the
// dictionary (broke `readDictHeader`), AND inflated TEXTURE_NATIVE sizes that swallow following textures
// (declares 20, a boundary walk finds 10) — the count-based recovery restores all 20, incl. the F350_mix body.
const yosemitePath = join(process.cwd(), 'fixtures', 'custom', 'txd', 'yosemite.txd');
const yosemiteExists = existsSync(yosemitePath);
const yosemiteDict = yosemiteExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(yosemitePath)))) : null;

describe.skipIf(!yosemiteExists)('parseTxd (real asset yosemite.txd — leading chunk + inflated sizes)', () => {
  it('recovers all 20 textures the inflated sizes hid (past the leading empty chunk)', () => {
    expect(yosemiteDict!.textures).toHaveLength(20);
    const names = yosemiteDict!.textures.map((t) => t.name);
    expect(names).toContain('F350_interior');
    expect(names).toContain('F350_mix'); // the body texture a boundary walk misses
  });
});

// A real mod TXD (gostown's lodveg.txd) with an "obfuscated wrapper" anti-rip lock: NO readable TexDictionary
// (0x16) header at all (zeroed leading sector) — every standard tool, incl. Magic.TXD, rejects it — but the
// inner TEXTURE_NATIVE (0x15) chunks are intact. The byte-scan recovery restores the LOD vegetation textures.
const lodvegPath = join(process.cwd(), 'fixtures', 'custom', 'txd', 'lodveg.txd');
const lodvegExists = existsSync(lodvegPath);
const lodvegDict = lodvegExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(lodvegPath)))) : null;

describe.skipIf(!lodvegExists)('parseTxd (real asset lodveg.txd — locked, no TexDictionary wrapper)', () => {
  it('recovers the textures by scanning for TEXTURE_NATIVE chunks despite the missing 0x16 wrapper', () => {
    expect(lodvegDict!.textures).toHaveLength(6);
    const names = lodvegDict!.textures.map((t) => t.name);
    expect(names).toContain('Gp_Grandpalm1');
    expect(names).toContain('Gp_petitpalm1');
    // recovered textures carry real pixel data (mips), not empty placeholders
    expect(lodvegDict!.textures.every((t) => t.mipmaps.length > 0)).toBe(true);
  });
});

// Real D3D9-platform mod TXDs (Carcer City, a 2026 mod). Its exporter ships two formats stock SA never does,
// both of which our decoder mis-read until fixed: DXT4 (a premultiplied-alpha DXT5 FourCC) rendered as rainbow
// noise (classified as 16-bit and expand16'd), and X8R8G8B8 rendered invisible (the unused X byte was copied
// as alpha 0). Whole models (telewires, sewer, police station) were affected.
const wiresPath = join(process.cwd(), 'fixtures', 'custom', 'txd', 'carcer-wires-dxt4.txd');
const wiresExists = existsSync(wiresPath);
const wiresDict = wiresExists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(wiresPath)))) : null;

describe.skipIf(!wiresExists)('parseTxd (real asset carcer wires.txd — DXT4)', () => {
  it('classifies the DXT4 textures as dxt5 and preserves the raw compressed blocks', () => {
    const tex = wiresDict!.textures.find((t) => t.name === 'telewireslong')!;
    expect(tex.format).toBe('dxt5'); // DXT4 FourCC → dxt5 (premultiplied variant, same block layout)
    expect(tex.mipmaps[0].data.length).toBe((tex.width * tex.height) / 1); // dxt5 = 1 byte/px raw block data
    expect(wiresDict!.textures.every((t) => t.format === 'dxt5')).toBe(true);
  });
});

const x888Path = join(process.cwd(), 'fixtures', 'custom', 'txd', 'carcer-x8r8g8b8.txd');
const x888Exists = existsSync(x888Path);
const x888Dict = x888Exists ? parseTxd(toArrayBuffer(new Uint8Array(readFileSync(x888Path)))) : null;

describe.skipIf(!x888Exists)('parseTxd (real asset carcer X8R8G8B8 — opaque padding byte)', () => {
  it('decodes the uncompressed 32-bit texture fully OPAQUE (X byte is padding, not alpha)', () => {
    const tex = x888Dict!.textures.find((t) => t.name === 'chromepipe2_32hv')!;
    expect(tex.format).toBe('rgba8888');
    expect(tex.hasAlpha).toBe(false);
    const rgba = tex.mipmaps[0].data;
    let minAlpha = 255;
    for (let i = 3; i < rgba.length; i += 4) {
      minAlpha = Math.min(minAlpha, rgba[i]);
    }
    expect(minAlpha).toBe(255); // every texel opaque — the fix (was 0 → the whole model rendered invisible)
  });
});
