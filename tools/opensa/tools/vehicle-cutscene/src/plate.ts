import type { PlateCity, PlateRaster } from '@opensa/game/vehicle/plate-raster';

import { extractPlateSources } from '@opensa/game/adapters/plate-sources';
/**
 * Plate bake (plan 003): compose a READABLE license plate per slot and ship it inside the emitted
 * `cs*.txd` — own-TXD-first resolution overrides the `carplate`/`carpback` placeholders with zero DFF
 * changes. Vanilla cutscene cars show a BLANK plate because `CCustomCarPlateMgr` only runs for
 * gameplay vehicles; the compose formula is the ENGINE's own recovered implementation
 * (`@opensa/game/vehicle/plate-raster`, plan 082/01 — measured off the real rasters and confirmed
 * against the reversed manager), reused rather than re-derived.
 *
 * The two entries are encoded exactly as the stock plate art in `models/generic/vehicle.txd` is
 * (measured 2026-08-13): platform 9 (D3D9), filter 0x1101, rasterFormat 0x600 (C888), d3dFormat 22
 * (X8R8G8B8), depth 32, one mip, rasterType 4, no alpha — stored BGRX on disk, opaque by design
 * (the compose writes a full plate face; the quad UVs span 0..1 on every real DFF probed).
 */
import {
  composePlateText,
  DEFAULT_PLATE_MASK,
  generatePlateText,
  PLATE_TEXT_HEIGHT,
  PLATE_TEXT_LENGTH,
  PLATE_TEXT_WIDTH,
  plateBackgroundIndex,
} from '@opensa/game/vehicle/plate-raster';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import {
  readRw,
  RW_EXTENSION,
  RW_STRUCT,
  RW_TEXTURE_DICTIONARY,
  RW_TEXTURE_NATIVE,
  type RwChunk,
  writeRw,
} from '@opensa/rw-codec/chunk';

import { toArrayBuffer } from './template';

/** The composed pair a slot ships: the text strip and the town background it is inset into. */
export interface PlatePair {
  carpback: PlateRaster;
  carplate: PlateRaster;
}

/** `--plate-town` values → the engine's `eCarPlateType` city keys. */
export const PLATE_TOWNS: Readonly<Record<string, PlateCity>> = { ls: 'LA', lv: 'VEGAS', sf: 'SF' };

/** Mirrored from the stock plate art in `models/generic/vehicle.txd` (see the header). */
const PLATE_FILTER_FLAGS = 0x1101;
const RASTER_FORMAT_C888 = 0x0600;
const D3DFMT_X8R8G8B8 = 22;
const RASTER_TYPE_TEXTURE = 4;

/**
 * Append (or REPLACE — a mod shipping its own `carplate` deliberately gets ours, plan 003 risk 2)
 * textures in a dictionary, preserving everything else byte-for-byte.
 */
export function appendTextures(
  txdBytes: Uint8Array,
  textures: readonly { name: string; raster: PlateRaster }[],
): Uint8Array {
  const file = readRw(txdBytes);
  const dictionary = file.chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  if (!dictionary?.children) {
    throw new Error('not a texture dictionary');
  }
  const replaced = new Set(textures.map((texture) => texture.name.toLowerCase()));
  const kept = dictionary.children.filter(
    (child) => child.type !== RW_TEXTURE_NATIVE || !replaced.has(textureNativeName(child)),
  );
  // Struct first, extension last — ours land between the kept natives and the trailing extension.
  const extensionAt = kept.findIndex((child) => child.type !== RW_STRUCT && child.type !== RW_TEXTURE_NATIVE);
  const natives = textures.map((texture) => textureNative(texture.name, texture.raster, dictionary.version));
  const children =
    extensionAt < 0 ? [...kept, ...natives] : [...kept.slice(0, extensionAt), ...natives, ...kept.slice(extensionAt)];

  const count = children.filter((child) => child.type === RW_TEXTURE_NATIVE).length;
  const struct = children.find((child) => child.type === RW_STRUCT);
  if (struct?.data && struct.data.length >= 2) {
    struct.data = struct.data.slice();
    new DataView(struct.data.buffer, struct.data.byteOffset).setUint16(0, count, true);
  }
  dictionary.children = children;

  return writeRw(file);
}

/**
 * Compose the slot's pair from the resident generic `vehicle.txd`. Throws when the dictionary lacks
 * the plate sources — a build that cannot compose a plate must say so, not silently ship blanks.
 */
export function composePlatePair(genericTxd: Uint8Array, text: string, town: PlateCity): PlatePair {
  const sources = extractPlateSources(parseTxd(toArrayBuffer(genericTxd)));
  if (!sources) {
    throw new Error('generic vehicle.txd has no plate sources (platecharset / plateback1-3)');
  }
  const background = sources.backgrounds[plateBackgroundIndex(town)];

  return {
    carpback: background,
    carplate: {
      height: PLATE_TEXT_HEIGHT,
      rgba: composePlateText(text, sources.charset),
      width: PLATE_TEXT_WIDTH,
    },
  };
}

/**
 * The slot's plate text: the override verbatim (cut to the eight cells a plate has — the caller
 * reports the truncation), else a game-shaped text (`LLDD DLL`) seeded from the cs model name —
 * deterministic across rebuilds, different per slot.
 */
export function plateTextFor(csName: string, override?: string): string {
  if (override !== undefined) {
    return override.slice(0, PLATE_TEXT_LENGTH);
  }

  return generatePlateText(DEFAULT_PLATE_MASK, fnv1a(csName.toLowerCase()));
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** One D3D9 TextureNative chunk in the stock plate art's exact shape (see the header constants). */
function textureNative(name: string, raster: PlateRaster, version: number): RwChunk {
  const pixels = raster.width * raster.height;
  const data = new Uint8Array(92 + pixels * 4);
  const view = new DataView(data.buffer);
  view.setUint32(0, 9, true); // platform: D3D9
  view.setUint32(4, PLATE_FILTER_FLAGS, true);
  new TextEncoder().encodeInto(name.slice(0, 31), data.subarray(8, 40));
  // mask name (40..72) stays zeroed
  view.setUint32(72, RASTER_FORMAT_C888, true);
  view.setUint32(76, D3DFMT_X8R8G8B8, true);
  view.setUint16(80, raster.width, true);
  view.setUint16(82, raster.height, true);
  data[84] = 32; // depth
  data[85] = 1; // mip levels
  data[86] = RASTER_TYPE_TEXTURE;
  data[87] = 0; // flags: no alpha
  view.setUint32(88, pixels * 4, true);
  for (let at = 0; at < pixels; at += 1) {
    const src = at * 4;
    const dst = 92 + at * 4;
    data[dst] = raster.rgba[src + 2]; // B
    data[dst + 1] = raster.rgba[src + 1]; // G
    data[dst + 2] = raster.rgba[src]; // R
    data[dst + 3] = 255; // X
  }

  return {
    children: [
      { data, type: RW_STRUCT, version },
      { children: [], type: RW_EXTENSION, version },
    ],
    type: RW_TEXTURE_NATIVE,
    version,
  };
}

/** The lowercased name inside a TextureNative struct (offset 8, 32 bytes). */
function textureNativeName(chunk: RwChunk): string {
  const struct = chunk.children?.find((child) => child.type === RW_STRUCT);
  if (!struct?.data || struct.data.length < 40) {
    return '';
  }
  const raw = struct.data.subarray(8, 40);
  const end = raw.indexOf(0);

  return new TextDecoder().decode(raw.subarray(0, end < 0 ? raw.length : end)).toLowerCase();
}
