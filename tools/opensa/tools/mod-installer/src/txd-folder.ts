import type { RwChunk } from '@opensa/rw-codec/chunk';

import {
  readRw,
  RW_EXTENSION,
  RW_STRUCT,
  RW_TEXTURE_DICTIONARY,
  RW_TEXTURE_NATIVE,
  writeRw,
} from '@opensa/rw-codec/chunk';
import { readTextureName } from '@opensa/rw-codec/texture-native';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pngToTextureNative } from './png-texture';

/**
 * An EMPTY texture dictionary at `version` — the seed {@link mergeTxdBytes} needs when a folder of PNGs is a
 * whole dictionary rather than a patch on one. Stock SA ships 11 dictionaries of exactly this shape, so this
 * is a valid `.txd` on its own; take `version` from a dictionary the same mod ships rather than assuming one.
 */
export function emptyTxd(version: number): Uint8Array {
  const struct = new Uint8Array(4); // textureCount 0, deviceId 0

  return writeRw({
    chunks: [
      {
        children: [
          { data: struct, type: RW_STRUCT, version },
          { children: [], type: RW_EXTENSION, version },
        ],
        type: RW_TEXTURE_DICTIONARY,
        version,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

/**
 * The in-memory core of {@link mergeTxdFolder} — also used for `.txd` ENTRIES inside an IMG archive
 * (plan 009), where there is no loose file to rewrite. `label` names the target in errors.
 */
export function mergeTxdBytes(
  folderPath: string,
  txdBytes: Uint8Array,
  label: string,
): { bytes: Uint8Array; merged: number } {
  const pngs = readdirSync(folderPath, { withFileTypes: true }).filter((e) => e.isFile() && /\.png$/i.test(e.name));
  if (pngs.length === 0) {
    return { bytes: txdBytes, merged: 0 };
  }

  const file = readRw(txdBytes);
  const dict = file.chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  if (!dict?.children) {
    throw new Error(`not a TXD (no texture-dictionary chunk): ${label}`);
  }
  const byName = new Map<string, RwChunk>();
  for (const native of dict.children.filter((c) => c.type === RW_TEXTURE_NATIVE)) {
    const struct = textureStruct(native);
    if (struct) {
      byName.set(readTextureName(struct).toLowerCase(), native);
    }
  }

  for (const png of pngs) {
    const name = png.name.replace(/\.png$/i, '');
    const existing = byName.get(name.toLowerCase());
    // The replaced texture's Struct decides the raster format the PNG is encoded into (plan 015).
    const native = pngToTextureNative(
      name,
      Uint8Array.from(readFileSync(join(folderPath, png.name))),
      dict.version,
      existing ? textureStruct(existing) : undefined,
    );
    if (existing) {
      dict.children[dict.children.indexOf(existing)] = native;
    } else {
      insertNative(dict, native);
    }
    byName.set(name.toLowerCase(), native);
  }

  updateTextureCount(dict);

  return { bytes: writeRw(file), merged: pngs.length };
}

/**
 * Merge a folder of PNGs into an existing loose `.txd`: each `<name>.png` becomes a texture named `<name>` —
 * **replacing** the same-named texture in the dictionary or **adding** a new one, leaving every other texture
 * untouched. Returns the number of PNGs merged. Non-PNG files in the folder are ignored.
 */
export function mergeTxdFolder(folderPath: string, txdPath: string): number {
  const result = mergeTxdBytes(folderPath, Uint8Array.from(readFileSync(txdPath)), txdPath);
  if (result.merged > 0) {
    writeFileSync(txdPath, result.bytes);
  }

  return result.merged;
}

/** Insert a new TextureNative after the last existing one (before the dictionary's trailing extension). */
function insertNative(dict: RwChunk, native: RwChunk): void {
  const children = dict.children!;
  let index = children.length;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (children[i].type === RW_TEXTURE_NATIVE) {
      index = i + 1;
      break;
    }
  }
  children.splice(index, 0, native);
}

/** A TextureNative chunk's Struct bytes, or undefined when the chunk carries none. */
function textureStruct(native: RwChunk): Uint8Array | undefined {
  return native.children?.find((c) => c.type === RW_STRUCT)?.data;
}

/** Rewrite the dictionary STRUCT's leading `textureCount` (u16) to the current native count. */
function updateTextureCount(dict: RwChunk): void {
  const struct = dict.children?.find((c) => c.type === RW_STRUCT)?.data;
  const count = dict.children?.filter((c) => c.type === RW_TEXTURE_NATIVE).length ?? 0;
  if (struct && struct.length >= 2) {
    new DataView(struct.buffer, struct.byteOffset, struct.byteLength).setUint16(0, count, true);
  }
}
