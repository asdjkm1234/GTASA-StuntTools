import type { RwChunk } from '@opensa/rw-codec/chunk';

import { resampleToPow2 } from '@opensa/cell-weld/alpha';
import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { buildMipChain, downsample, type MipColorMath } from '@opensa/rw-codec/mip';
import { encodeDxtStruct } from '@opensa/rw-codec/texture-native';

import type { TextureSource } from './texture-source';

/**
 * Like {@link encodeLodTxd}, but halves each texture `halvings` power-of-two steps (1 → ½ each side, ¼ area)
 * instead of capping to a size budget — the sa-lod-generator "50 % textures" clone. Same DXT + full mips; the DFF's
 * material/texture **names** + UVs are untouched, so a verbatim HD-clone DFF resolves every texture from here.
 */
export function encodeHalvedTxd(
  textures: readonly string[],
  source: TextureSource,
  halvings: number,
  math: MipColorMath,
): Uint8Array {
  return buildTxd(textures, source, (rgba, width, height) => halve(rgba, width, height, halvings, math), math);
}

/**
 * Build one shared LOD TXD holding the given textures, **downscaled** to a far-LOD budget and **DXT-compressed**
 * (DXT5 for alpha-cutout textures, DXT1 for opaque) with a full mip chain — uncompressed A8R8G8B8 blows the IMG up
 * ~4× (e.g. a full cell build's TXDs were ~324 MB raw vs ~81 MB DXT). The DFF keeps its original material/texture
 * **names** + UVs untouched (perfect tiling — no atlas), so it resolves every texture from this single dictionary.
 * Reuses the engine `parseTxd` (via the source) + `encodeDxtStruct` + chunk codec. Names missing from the source
 * are skipped.
 */
export function encodeLodTxd(
  textures: readonly string[],
  source: TextureSource,
  maxSize: number,
  math: MipColorMath,
): Uint8Array {
  return buildTxd(textures, source, (rgba, width, height) => downscale(rgba, width, height, maxSize, math), math);
}

/** Assemble a TEXTURE_DICTIONARY from the source textures, each reduced to its top level by `reduce`, DXT + mips. */
function buildTxd(
  textures: readonly string[],
  source: TextureSource,
  reduce: (rgba: Uint8Array, width: number, height: number) => Level,
  math: MipColorMath,
): Uint8Array {
  const natives: RwChunk[] = [];
  for (const name of textures) {
    const texture = source.get(name);
    if (texture) {
      const level = reduce(texture.rgba, texture.width, texture.height);
      natives.push(textureNative(name, texture.hasAlpha, toPow2(level), math));
    }
  }

  const struct = new Uint8Array(4);
  const header = new DataView(struct.buffer);
  header.setUint16(0, natives.length, true); // numTextures
  // deviceId — **2 on every stock SA dictionary**, and we wrote 0 ("any device") for a year. Our own reader
  // ignores the field; RenderWare's does not, and a dictionary the game will not accept never loads, so every
  // model pointing at it goes untextured or undrawn. Measured against `game-src/original` 2026-08-16.
  header.setUint16(2, TXD_DEVICE_D3D, true);

  return writeRw({
    chunks: [container(RW_TEXTURE_DICTIONARY, [leaf(RW_STRUCT, struct), ...natives, container(RW_EXTENSION, [])])],
    trailing: new Uint8Array(0),
  });
}

const RW_VERSION = 0x1803ffff;

interface Level {
  data: Uint8Array;
  height: number;
  width: number;
}

function container(type: number, children: RwChunk[]): RwChunk {
  return { children, type, version: RW_VERSION };
}

/** Downscale RGBA (2× box) until both dimensions are ≤ `maxSize`. */
function downscale(rgba: Uint8Array, width: number, height: number, maxSize: number, math: MipColorMath): Level {
  let level: Level = { data: rgba, height, width };
  while (level.width > maxSize || level.height > maxSize) {
    level = downsample(level.data, level.width, level.height, math);
  }

  return level;
}

/**
 * Aggressive downscales must not turn small sources into mush: a 64 px texture at ¼ scale would be 16 px —
 * unreadable on large tiled surfaces. Halving stops once the smaller dimension would drop below this
 * (sa plan 006: LODs render from ≥ ~300 u where 32 px still covers the screen density).
 */
const MIN_HALVED_SIZE = 32;

/** Halve RGBA (2× box) `halvings` times, flooring at {@link MIN_HALVED_SIZE} on the smaller dimension. */
function halve(rgba: Uint8Array, width: number, height: number, halvings: number, math: MipColorMath): Level {
  let level: Level = { data: rgba, height, width };
  for (let i = 0; i < halvings && Math.min(level.width, level.height) >= MIN_HALVED_SIZE * 2; i += 1) {
    level = downsample(level.data, level.width, level.height, math);
  }

  return level;
}

/**
 * Every level we emit is DXT, and a DXT raster whose top level is not a multiple of 4 on both sides is one the
 * real game's D3D9 refuses to create — the whole dictionary then fails to load and EVERY model pointing at it is
 * never drawn (a model whose TXD is not loaded is never marked loaded). Mods ship such sources uncompressed
 * (`marinadoor1_256` 250×250 A8R8G8B8 in the hospital door mod), which SA takes; halved to 62×62 and
 * DXT-compressed by us, the same texture took the two hospital LODs and the pizzeria block down with it
 * (`open-issues/fixed/sa-lod-visibility-budget.md`, round 16). Stock ships 26 004 textures and not one that is not a
 * power of two, so that is the shape we emit: nearest power of two per side (bilinear), floor 4 — which also
 * keeps every mip level block-aligned.
 */
function toPow2(level: Level): Level {
  const sized = resampleToPow2(level.data, level.width, level.height);

  return { data: sized.rgba, height: sized.height, width: sized.width };
}

/** The `deviceId` half of a TexDictionary's struct: 2 on every stock SA TXD (the D3D platform). */
const TXD_DEVICE_D3D = 2;

function leaf(type: number, data: Uint8Array): RwChunk {
  return { data, type, version: RW_VERSION };
}

function textureNative(name: string, hasAlpha: boolean, level: Level, math: MipColorMath): RwChunk {
  const mips = buildMipChain(level.data, level.width, level.height, math);
  // DXT3 for alpha, never DXT5: stock SA ships 28 786 DXT1 + 2 095 DXT3 textures across 3 978 dictionaries
  // and **not one** DXT5 (measured 2026-08-16 over `game-src/original`). Both are 16 bytes per block, so this
  // costs nothing; it just stops handing the game a format its own content never uses.
  const struct = encodeDxtStruct(name, hasAlpha ? 'dxt3' : 'dxt1', mips);

  return container(RW_TEXTURE_NATIVE, [leaf(RW_STRUCT, struct), container(RW_EXTENSION, [])]);
}
