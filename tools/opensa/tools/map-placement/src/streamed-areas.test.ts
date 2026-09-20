import { describe, expect, it } from 'vitest';

import { AREA_MAX_PAIRS, buildLinkedAreas, type LinkedPair, splitByMedian } from './streamed-areas';

const pairAt = (x: number, y = 0): LinkedPair => ({
  hd: { id: 800, interior: 3, position: [x, y, 0], rotation: [0, 0, 0, 1] },
  lod: { id: 6500, model: 'plobush' },
});

describe('splitByMedian', () => {
  describe('negative cases', () => {
    it('returns one leaf when the items already fit', () => {
      expect(splitByMedian([pairAt(0), pairAt(1)], 5, (p) => p.hd.position)).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('packs into exactly ⌈N/max⌉ near-equal leaves instead of halving to powers of two', () => {
      const items = Array.from({ length: 15283 }, (_, i) => pairAt(i % 400, Math.floor(i / 400)));
      const leaves = splitByMedian(items, 2000, (p) => p.hd.position);

      expect(leaves).toHaveLength(8); // halving would give 16 leaves of ~955 — a waste of text-IPL slots
      for (const leaf of leaves) {
        expect(leaf.length).toBeLessThanOrEqual(2000);
        expect(leaf.length).toBeGreaterThanOrEqual(1900); // near-equal packing
      }
      expect(leaves.reduce((n, leaf) => n + leaf.length, 0)).toBe(15283);
    });
  });
});

describe('AREA_MAX_PAIRS', () => {
  describe('negative cases', () => {
    it('keeps an area under the 4096 boot buffer, counting BOTH entries a pair costs', () => {
      // A linked pair is one text row + one HD stream record, and both pass through gpLoadedBuildings. Raised to
      // 4800 on 2026-08-10 from ProperFixes' measured 9 627-row file, this killed the game on the first area at
      // ~8 520 mixed entries — PF's file has zero streams, so its number does not apply to this path. The
      // text-only path has its own cap (`AREA_MAX_ROWS`), where 9 627 legitimately does apply.
      expect(2 * AREA_MAX_PAIRS).toBeLessThanOrEqual(4096);
    });
  });

  describe('positive cases', () => {
    it('is the value that shipped for a year', () => {
      expect(AREA_MAX_PAIRS).toBe(2000);
    });
  });
});

describe('buildLinkedAreas', () => {
  describe('negative cases', () => {
    it('throws when the areaBase makes a stream name exceed the IMG VER2 23-byte cap', () => {
      expect(() => buildLinkedAreas([pairAt(0)], 'a-far-too-long-base')).toThrow(/23 bytes/);
    });
  });

  describe('positive cases', () => {
    it('propagates the HD interior into the LOD text row', () => {
      const { files } = buildLinkedAreas([pairAt(0)], 'plotr');
      const row = files[0][1].split('\r\n').find((l) => l.startsWith('6500'));

      expect(row).toBe('6500, plobush, 3, 0, 0, 0, 0, 0, 0, 1, -1');
    });

    it('groups unlinked pairs into their OWN area whose text IPL has no inst rows (plan 002)', async () => {
      const { parseBinaryIpl } = await import('@opensa/renderware/parsers/text/ipl-binary.parser');
      const { datLines, files, imgFiles, instBearingFiles } = buildLinkedAreas(
        [{ ...pairAt(0), linked: false }, pairAt(5)], // one unlinked bush + one linked tree
        'plotr',
      );
      const rowsOf = (text: string): string[] => text.split('\r\n').filter((l) => /^\d/.test(l));
      const instsOf = (bytes: Uint8Array): { id: number; lod: number }[] =>
        parseBinaryIpl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

      // Two areas, both registered — the empty one's gta.dat line is how SetupRelatedIpls finds its streams.
      expect(files).toHaveLength(2);
      expect(datLines).toHaveLength(2);
      // Linked FIRST: it owns the only text rows, and it is the only area spending a slot.
      expect(rowsOf(files[0][1])).toHaveLength(1);
      expect(rowsOf(files[1][1])).toHaveLength(0);
      expect(instBearingFiles).toBe(1);

      expect(instsOf(imgFiles[0][1]).map((i) => [i.id, i.lod])).toEqual([[800, 0]]); // the tree HD links row 0
      expect(
        instsOf(imgFiles[1][1])
          .map((i) => [i.id, i.lod])
          .sort((a, b) => a[0] - b[0]),
      ).toEqual([
        [800, -1],
        [6500, -1],
      ]); // both bush rows ride the stream unlinked
    });

    it('counts only inst-bearing areas as slots — an all-unlinked layer spends none', () => {
      const pairs = Array.from({ length: 40 }, (_, i) => ({ ...pairAt(i), linked: false }));
      const { datLines, instBearingFiles } = buildLinkedAreas(pairs, 'plobj');

      expect(datLines.length).toBeGreaterThan(0); // the areas still exist and are registered
      expect(instBearingFiles).toBe(0); // …and cost nothing against SA's 40
    });
  });
});
