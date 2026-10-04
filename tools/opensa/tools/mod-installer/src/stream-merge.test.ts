import { type BinaryIplInstance, encodeBinaryIpl } from '@opensa/map-placement/ipl-binary-write';
import { parseBinaryCarGenerators, parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyStreamMerge, formatInstanceRow, patchAreaStreams } from './stream-merge';

const inst = (id: number, lod: number, x = 100): BinaryIplInstance => ({
  id,
  interior: 0,
  lod,
  position: [x, 200.5, 30.25],
  rotation: [0, 0, 0, 1],
});

const toAB = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('applyStreamMerge', () => {
  describe('negative cases', () => {
    it('warns and skips a non-inst section', () => {
      const entry = encodeBinaryIpl([inst(700, -1)]);
      const { warnings } = applyStreamMerge(entry, 'remove from "occl":\n1, 2, 3, 4, 5, 6, 7, 8, 9, 0', 'x.ipl');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/only "inst"/);
    });

    it('throws on a malformed instance row (wrong cell count)', () => {
      const entry = encodeBinaryIpl([inst(700, -1)]);
      expect(() => applyStreamMerge(entry, 'add to "inst":\n700, 0, 1, 2', 'x.ipl')).toThrow(/expected 'id, interior/);
    });

    it('warns when a remove matches no instance, applying the rest', () => {
      const entry = encodeBinaryIpl([inst(700, -1)]);
      const merge = [
        'remove from "inst":',
        '999, 0, 1, 2, 3, 0, 0, 0, 1, -1',
        'add to "inst":',
        formatInstanceRow(inst(701, 4)),
      ].join('\n');
      const { bytes, warnings } = applyStreamMerge(entry, merge, 'x.ipl');
      expect(warnings).toHaveLength(1);
      expect(parseBinaryIpl(toAB(bytes))).toHaveLength(2);
    });
  });

  describe('positive cases', () => {
    it('adds, removes and replaces instances with canonical float matching, carrying CARS through', () => {
      const car = new Uint8Array(48).fill(7);
      const entry = encodeBinaryIpl([inst(700, -1, 1640.078125), inst(701, 5)], car);
      const merge = [
        'remove from "inst":',
        '700, 0, 1640.08, 200.5, 30.25, 0, 0, 0, 1, -1', // 6-sig-digit float noise still matches
        'replace in "inst":',
        `- ${formatInstanceRow(inst(701, 5))}`,
        `+ ${formatInstanceRow(inst(701, 9))}`,
        'add to "inst":',
        formatInstanceRow(inst(702, -1)),
      ].join('\n');
      const { bytes, warnings } = applyStreamMerge(entry, merge, 'x.ipl');
      expect(warnings).toEqual([]);
      const out = parseBinaryIpl(toAB(bytes));
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({ id: 701, lod: 9 });
      expect(out[1]).toMatchObject({ id: 702, lod: -1 });
      expect(parseBinaryCarGenerators(toAB(bytes))).toHaveLength(1); // parked car survived the rebuild
    });
  });
});

describe('patchAreaStreams', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stream-patch-'));
    mkdirSync(join(root, 'models'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  function writeImg(entries: Record<string, Uint8Array>): void {
    const img = createImg();
    for (const [name, bytes] of Object.entries(entries)) {
      img.set(name, bytes);
    }
    writeFileSync(join(root, 'models', 'gta3.img'), img.build());
  }

  function streamLods(name: string): number[] {
    const img = openImg(new Uint8Array(readFileSync(join(root, 'models', 'gta3.img'))));

    return parseBinaryIpl(toAB(img.get(name)!)).map((i) => i.lod);
  }

  describe('negative cases', () => {
    it('unlinks (lod -1) a stream instance that pointed at a removed text row, with a warning', () => {
      writeImg({ 'lae_stream0.ipl': encodeBinaryIpl([inst(700, 96)]) });
      patchAreaStreams(root, 'data/maps/la/lae.ipl', [96]);
      expect(streamLods('lae_stream0.ipl')).toEqual([-1]); // orphan neutralized, install continues
    });

    it('is a no-op when the area has no streams', () => {
      writeImg({ 'vegasn_stream0.ipl': encodeBinaryIpl([inst(700, 5)]) });
      patchAreaStreams(root, 'data/maps/la/lae.ipl', [1]);
      expect(streamLods('vegasn_stream0.ipl')).toEqual([5]); // untouched neighbour area
    });
  });

  describe('positive cases', () => {
    it('shifts lods above each removed index, leaves -1 and lower links alone, across all area streams', () => {
      writeImg({
        'lae2_stream0.ipl': encodeBinaryIpl([inst(705, 97)]), // different area (lae2 ≠ lae) — untouched
        'lae_stream0.ipl': encodeBinaryIpl([inst(700, 5), inst(701, 96), inst(702, -1), inst(703, 200)]),
        'lae_stream1.ipl': encodeBinaryIpl([inst(704, 97)]),
      });
      patchAreaStreams(root, 'data/maps/la/LAe.ipl', [6, 100]);
      expect(streamLods('lae_stream0.ipl')).toEqual([5, 95, -1, 198]);
      expect(streamLods('lae_stream1.ipl')).toEqual([96]);
      expect(streamLods('lae2_stream0.ipl')).toEqual([97]);
    });
  });
});
