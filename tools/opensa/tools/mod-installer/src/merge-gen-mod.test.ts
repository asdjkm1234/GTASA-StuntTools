import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { convertModToMerges } from './merge-gen-mod';

let dir: string;

/** Vanilla `town.ipl`: a house linked to its LOD at row 3, with two rows in between. */
const VANILLA_IPL = [
  'inst',
  '100, house, 0, 0, 0, 0, 0, 0, 0, 1, 3',
  '101, shed, 0, 50, 0, 0, 0, 0, 0, 1, -1',
  '102, fence, 0, 60, 0, 0, 0, 0, 0, 1, -1',
  '200, LODhouse, 0, 0, 0, 0, 0, 0, 0, 1, -1',
  'end',
  '',
].join('\n');

/**
 * The author's `town.ipl`: `shed` deleted and `tree` inserted at the FRONT, so their `LODhouse` is still row 3
 * — while ours, which appends, puts it at 2. This is the LAw shape that shipped one row off.
 */
const AUTHOR_IPL = [
  'inst',
  '103, tree, 0, 70, 0, 0, 0, 0, 0, 1, -1',
  '100, house, 0, 0, 0, 0, 0, 0, 0, 1, 3',
  '102, fence, 0, 60, 0, 0, 0, 0, 0, 1, -1',
  '200, LODhouse, 0, 0, 0, 0, 0, 0, 0, 1, -1',
  'end',
  '',
].join('\n');

/** A `bnry` stream of one instance: `id` at `position`, linking to text row `lod`. */
function stream(id: number, position: readonly [number, number, number], lod: number): Uint8Array {
  const bytes = new Uint8Array(0x4c + 40);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79]);
  view.setUint32(0x04, 1, true);
  view.setUint32(0x1c, 0x4c, true);
  position.forEach((value, axis) => view.setFloat32(0x4c + axis * 4, value, true));
  view.setFloat32(0x4c + 24, 1, true);
  view.setUint32(0x4c + 28, id, true);
  view.setInt32(0x4c + 32, 0, true);
  view.setInt32(0x4c + 36, lod, true);

  return bytes;
}

/** A vanilla game tree + a mod that ships the author's text IPL and the stream that indexes it. */
function trees(authorStreamLod: number): { game: string; mod: string } {
  const game = join(dir, 'game');
  mkdirSync(join(game, 'data', 'maps'), { recursive: true });
  mkdirSync(join(game, 'models'), { recursive: true });
  writeFileSync(join(game, 'data', 'maps', 'town.ipl'), VANILLA_IPL);
  writeFileSync(
    join(game, 'models', 'gta3.img'),
    buildVer2Buffer([{ data: stream(100, [0, 0, 0], 3), name: 'town_stream0.ipl' }]),
  );

  const mod = join(dir, 'mod');
  mkdirSync(join(mod, 'data', 'maps'), { recursive: true });
  mkdirSync(join(mod, 'gta3_img'), { recursive: true });
  writeFileSync(join(mod, 'data', 'maps', 'town.ipl'), AUTHOR_IPL);
  writeFileSync(join(mod, 'gta3_img', 'town_stream0.ipl'), stream(100, [0, 0, 0], authorStreamLod));

  return { game, mod };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'merge-gen-mod-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('convertModToMerges', () => {
  describe('negative cases', () => {
    it('refuses a stream whose link resolves to nothing in the layout it was written against', () => {
      // Row 9 does not exist in the author's own four-row file. Writing that number into our stream is how a
      // garbage index reaches SA's parser; the gate compares what the link RESOLVES to, so it catches it.
      const { game, mod } = trees(9);

      const result = convertModToMerges({ gamePath: game, modPath: mod });
      expect(result.refused.map((entry) => entry.path)).toEqual([join('gta3_img', 'town_stream0.ipl')]);
      expect(result.refused[0].reason).toMatch(/does not exist in the author's own file/);
      expect(result.written).toEqual([join('data', 'maps', 'town.ipl.merge')]);
    });

    it('leaves a file with no vanilla counterpart alone', () => {
      const { game, mod } = trees(3);
      writeFileSync(join(mod, 'data', 'maps', 'newarea.ipl'), VANILLA_IPL);

      const result = convertModToMerges({ gamePath: game, modPath: mod });
      expect(result.skipped).toContain(join('data', 'maps', 'newarea.ipl'));
    });
  });

  describe('positive cases', () => {
    it("writes no stream directive when the installer's own rebase already lands where the author points", () => {
      // The author's row 3 is LODhouse; our layout puts it at 2, and the text merge's removal already shifts
      // the stream's 3 → 2. Nothing to say — and saying it is exactly what the shipped pack did wrong.
      const { game, mod } = trees(3);

      const result = convertModToMerges({ gamePath: game, modPath: mod, write: true });

      expect(result.refused).toEqual([]);
      expect(result.written).toEqual([join('data', 'maps', 'town.ipl.merge')]);
      expect(result.skipped).toContain(join('gta3_img', 'town_stream0.ipl'));
    });

    it("carries a re-pointed link into our layout instead of writing the author's index", () => {
      // The author moved this link to their row 2 (`fence`), which our layout holds at 1. A merge is needed,
      // and the number in it has to be OURS — the whole defect this converter exists to prevent.
      const { game, mod } = trees(2);

      const result = convertModToMerges({ gamePath: game, modPath: mod, write: true });

      expect(result.refused).toEqual([]);
      expect(result.written).toEqual([
        join('data', 'maps', 'town.ipl.merge'),
        join('gta3_img', 'town_stream0.ipl.merge'),
      ]);
      expect(readFileSync(join(mod, 'gta3_img', 'town_stream0.ipl.merge'), 'utf8')).toMatch(
        /^\+ 100, 0, 0, 0, 0, 0, 0, 0, 1, 1$/m,
      );
      expect(existsSync(join(mod, 'gta3_img', 'town_stream0.ipl'))).toBe(false);
    });

    it('writes nothing on a dry run', () => {
      const { game, mod } = trees(2);

      const result = convertModToMerges({ gamePath: game, modPath: mod });
      expect(result.written).toHaveLength(2);
      expect(existsSync(join(mod, 'gta3_img', 'town_stream0.ipl.merge'))).toBe(false);
      expect(parseBinaryIpl(readBuffer(join(mod, 'gta3_img', 'town_stream0.ipl')))[0].lod).toBe(2);
    });
  });
});

/** The file as a standalone ArrayBuffer, safe for the DataView-based parsers. */
function readBuffer(path: string): ArrayBuffer {
  const bytes = readFileSync(path);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
