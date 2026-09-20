import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import {
  readRw,
  RW_EXTENSION,
  RW_STRUCT,
  RW_TEXTURE_DICTIONARY,
  RW_TEXTURE_NATIVE,
  type RwChunk,
} from '@opensa/rw-codec/chunk';
import { buildMipChain } from '@opensa/rw-codec/mip';
import { encodeUncompressedStruct } from '@opensa/rw-codec/texture-native';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';
import { emptyTxd, mergeTxdBytes, mergeTxdFolder } from './txd-folder';

const VERSION = 0x1803ffff;
const png = (size: number, color: [number, number, number, number]): Uint8Array =>
  encodePng(solidRgba(size, size, color), size, size);

/** A stock-shaped UNCOMPRESSED texture — what `models/generic/vehicle.txd` is made of, all 19 of it. */
const uncompressedNative = (name: string, size: number): RwChunk => ({
  children: [
    {
      data: encodeUncompressedStruct(
        name,
        buildMipChain(solidRgba(size, size, [8, 9, 10, 255]), size, size, 'gamma'),
        false,
      ),
      type: RW_STRUCT,
      version: VERSION,
    },
    { children: [], type: RW_EXTENSION, version: VERSION },
  ],
  type: RW_TEXTURE_NATIVE,
  version: VERSION,
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'txd-folder-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('mergeTxdFolder', () => {
  describe('negative cases', () => {
    it('does nothing (0) for a folder with no PNGs', () => {
      const txdPath = join(dir, 'base.txd');
      writeFileSync(txdPath, buildTxd([pngToTextureNative('texa', png(8, [1, 2, 3, 255]), VERSION)], VERSION));
      const empty = mkdtempSync(join(dir, 'empty-'));
      expect(mergeTxdFolder(empty, txdPath)).toBe(0);
    });

    it('throws when the target file is not a TXD', () => {
      const txdPath = join(dir, 'bogus.txd');
      writeFileSync(txdPath, new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4])); // no texture-dictionary chunk
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'tex.png'), png(8, [1, 2, 3, 255]));
      expect(() => mergeTxdFolder(folder, txdPath)).toThrow(/not a TXD/);
    });
  });

  describe('positive cases', () => {
    it('replaces a same-named texture and adds a new one, leaving the rest untouched', () => {
      const txdPath = join(dir, 'base.txd');
      writeFileSync(
        txdPath,
        buildTxd(
          [
            pngToTextureNative('texa', png(8, [10, 20, 30, 255]), VERSION),
            pngToTextureNative('texb', png(8, [40, 50, 60, 255]), VERSION),
          ],
          VERSION,
        ),
      );
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'texb.png'), png(16, [70, 80, 90, 255])); // replace texb (bigger)
      writeFileSync(join(folder, 'texc.png'), png(4, [11, 22, 33, 128])); // add texc (alpha → dxt5)

      const merged = mergeTxdFolder(folder, txdPath);
      expect(merged).toBe(2);

      const textures = parseTxd(Uint8Array.from(readFileSync(txdPath)).buffer).textures;
      const byName = new Map(textures.map((t) => [t.name, t]));
      expect([...byName.keys()].sort()).toEqual(['texa', 'texb', 'texc']);
      expect(byName.get('texa')?.width).toBe(8); // untouched
      expect(byName.get('texb')?.width).toBe(16); // replaced (was 8)
      expect(byName.get('texc')?.format).toBe('dxt5'); // added, alpha
      // The dictionary's own numTextures must follow. Our parser walks the CHILDREN, so a stale count is
      // invisible to every tool in this repo — and the real game reads exactly this u16.
      expect(declaredTextureCount(readFileSync(txdPath))).toBe(3);
    });

    it('matches an existing texture case-insensitively, and the PNG spelling becomes the name', () => {
      // The contract rule (`docs/contracts/mods.md`): a PNG replaces a same-named texture whatever the case.
      // A mod author writes `ReMap.png`; the dictionary calls it `remap`. Getting the match wrong ADDS a
      // second texture instead of replacing one, and the model keeps sampling the old pixels. The stored
      // name is the PNG's — RW itself looks textures up case-insensitively, so the spelling is cosmetic.
      const txdPath = join(dir, 'case.txd');
      writeFileSync(txdPath, buildTxd([pngToTextureNative('remap', png(8, [1, 2, 3, 255]), VERSION)], VERSION));
      const folder = mkdtempSync(join(dir, 'case-'));
      writeFileSync(join(folder, 'ReMap.png'), png(16, [9, 9, 9, 255]));

      expect(mergeTxdFolder(folder, txdPath)).toBe(1);

      const textures = parseTxd(Uint8Array.from(readFileSync(txdPath)).buffer).textures;
      expect(textures.length).toBe(1); // replaced, not added
      expect(textures[0].width).toBe(16);
      expect(textures[0].name).toBe('ReMap');
      expect(declaredTextureCount(readFileSync(txdPath))).toBe(1);
    });

    it('builds a whole dictionary from an empty seed (a PNG folder that IS the .txd)', () => {
      // "52. Abandoned Cars" shipped `gta3_img/philss/` — 22 PNGs that were the complete dictionary
      // `cuntwjunk04` names. A texture folder only PATCHES, so all 22 were dropped with a warning.
      const folder = mkdtempSync(join(dir, 'whole-'));
      writeFileSync(join(folder, 'body.png'), png(16, [10, 20, 30, 255]));
      writeFileSync(join(folder, 'glass.png'), png(8, [40, 50, 60, 128]));
      writeFileSync(join(folder, 'notes.txt'), 'ignored');

      const { bytes, merged } = mergeTxdBytes(folder, emptyTxd(VERSION), 'philss.txd');
      expect(merged).toBe(2);

      const textures = parseTxd(Uint8Array.from(bytes).buffer).textures;
      expect(textures.map((texture) => texture.name).sort()).toEqual(['body', 'glass']);
      expect(textures.find((texture) => texture.name === 'glass')?.format).toBe('dxt5');
      expect(textures.find((texture) => texture.name === 'body')?.format).toBe('dxt1');
      expect(declaredTextureCount(bytes)).toBe(2);
    });

    it('a PNG replacing an UNCOMPRESSED texture stays uncompressed, while its DXT neighbour does not', () => {
      // Plan 015: the raster the PNG replaces decides the format. `platecharset` is read back on the CPU by
      // `CCustomCarPlateMgr` — DXT blocks reach the plate as colour, which is the green plates of 2026-08-20.
      const txdPath = join(dir, 'vehicle.txd');
      writeFileSync(
        txdPath,
        buildTxd(
          [
            uncompressedNative('platecharset', 8),
            pngToTextureNative('vehiclegrunge256', png(8, [1, 2, 3, 255]), VERSION),
          ],
          VERSION,
        ),
      );
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'platecharset.png'), png(16, [70, 80, 90, 255]));
      writeFileSync(join(folder, 'vehiclegrunge256.png'), png(16, [70, 80, 90, 255]));
      writeFileSync(join(folder, 'plateback9.png'), png(16, [70, 80, 90, 255])); // adds: nothing to follow

      expect(mergeTxdFolder(folder, txdPath)).toBe(3);

      const byName = new Map(
        parseTxd(Uint8Array.from(readFileSync(txdPath)).buffer).textures.map((texture) => [texture.name, texture]),
      );
      expect(byName.get('platecharset')?.format).toBe('rgba8888');
      expect(byName.get('platecharset')?.width).toBe(16); // the mod's size, not the stock one
      expect(byName.get('vehiclegrunge256')?.format).toBe('dxt1');
      expect(byName.get('plateback9')?.format).toBe('dxt1');
    });

    it('keeps the mip chain on a raster it leaves uncompressed', () => {
      const txdPath = join(dir, 'mips.txd');
      writeFileSync(txdPath, buildTxd([uncompressedNative('coronamoon', 4)], VERSION));
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'coronamoon.png'), png(8, [70, 80, 90, 255]));

      mergeTxdFolder(folder, txdPath);

      const texture = parseTxd(Uint8Array.from(readFileSync(txdPath)).buffer).textures[0];
      expect(texture.format).toBe('rgba8888');
      expect(texture.mipmaps).toHaveLength(4); // 8, 4, 2, 1 — stock ships these single-level, we do not
    });

    it('emptyTxd alone is a valid, EMPTY dictionary (stock SA ships 11 of them)', () => {
      const bytes = emptyTxd(VERSION);

      expect(parseTxd(Uint8Array.from(bytes).buffer).textures).toEqual([]);
      expect(declaredTextureCount(bytes)).toBe(0);
    });
  });
});

/** The dictionary STRUCT's leading u16 — what the GAME counts, as opposed to what our parser walks. */
function declaredTextureCount(bytes: Uint8Array): number {
  const dict = readRw(Uint8Array.from(bytes)).chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  const struct = dict?.children?.find((chunk) => chunk.type === RW_STRUCT)?.data;
  if (!struct) {
    throw new Error('no dictionary struct');
  }

  return new DataView(struct.buffer, struct.byteOffset, struct.byteLength).getUint16(0, true);
}
