import { type BinaryIplInstance, encodeBinaryIpl } from '@opensa/map-placement/ipl-binary-write';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { describe, expect, it } from 'vitest';

import { applyIdeMerge, parseMergeFile } from './ide-merge';
import { generateMerge, generateStreamMerge } from './merge-gen';
import { applyStreamMerge } from './stream-merge';

const IPL = [
  'inst',
  '710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
  '710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1',
  '714, veg_bevtree2, 0, 120, 220, 32, 0, 0, 0, 1, 5',
  '706, sm_vegvbbig, 0, 130, 230, 33, 0, 0, 0, 1, -1',
  'end',
  'occl',
  '1932.59, 1917.11, 122.8, 86.8, 8.3, -142.0, 0.0, 0.0, 0.0, 0',
  '2060.76, 2071.18, -0.19, 44.5, 45.1, 24.7, 0.0, 0.0, 0.0, 0',
  'end',
  '',
].join('\n');

const IDE = ['objs', '5639, LAEdirtapha, laealpha, 200, 0', '5640, other, tex, 100, 0', 'end', ''].join('\n');

function edit(base: string, from: string, to: string): string {
  return base.replace(from, to);
}

describe('generateMerge', () => {
  describe('negative cases', () => {
    it('refuses identical files', () => {
      const result = generateMerge(IPL, IPL, 'ipl');
      expect(result).toMatchObject({ kind: 'refused', reason: /identical/ });
    });

    it('refuses a section-layout change', () => {
      const modded = IPL + 'cars\n1, 2, 3\nend\n';
      const result = generateMerge(IPL, modded, 'ipl');
      expect(result).toMatchObject({ kind: 'refused', reason: /section layout/ });
    });

    it('refuses an ambiguous .ide remove (several rows share the id)', () => {
      const base = ['objs', '5639, a, t, 200, 0', '5639, b, t, 200, 0', 'end', ''].join('\n');
      const modded = ['objs', '5639, a, t, 200, 0', 'end', ''].join('\n');
      const result = generateMerge(base, modded, 'ide');
      expect(result).toMatchObject({ kind: 'refused', reason: /ambiguous/ });
    });
  });

  describe('positive cases', () => {
    it('expresses an in-place row edit as a replace pair (the sink idiom)', () => {
      const modded = edit(
        IPL,
        '710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1',
        '710, vgs_palm01, 0, 110, 210, -300.0, 0, 0, 0, 1, -1',
      );
      const result = generateMerge(IPL, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('replace in "inst":');
      expect(text).toContain('- 710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1');
      expect(text).toContain('+ 710, vgs_palm01, 0, 110, 210, -300.0, 0, 0, 0, 1, -1');
      // applying it reproduces the modded file
      expect(applyIdeMerge(IPL, parseMergeFile(text), 'ipl').text).toBe(modded);
    });

    it('expresses trailing inst additions as an append', () => {
      const modded = IPL.replace(
        '706, sm_vegvbbig, 0, 130, 230, 33, 0, 0, 0, 1, -1\nend',
        '706, sm_vegvbbig, 0, 130, 230, 33, 0, 0, 0, 1, -1\n999, new_a, 0, 1, 2, 3, 0, 0, 0, 1, -1\n998, new_b, 0, 4, 5, 6, 0, 0, 0, 1, -1\nend',
      );
      const result = generateMerge(IPL, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('add to "inst":');
      expect(applyIdeMerge(IPL, parseMergeFile(text), 'ipl').text).toBe(modded);
    });

    it('expresses an occl deletion as a line remove (no index coupling outside inst)', () => {
      const modded = IPL.replace('1932.59, 1917.11, 122.8, 86.8, 8.3, -142.0, 0.0, 0.0, 0.0, 0\n', '');
      const result = generateMerge(IPL, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('remove from "occl":');
      expect(applyIdeMerge(IPL, parseMergeFile(text), 'ipl').text).toBe(modded);
    });

    it('converts an .ide flag edit to a replace pair and a new object to an add', () => {
      const modded = edit(IDE, '5639, LAEdirtapha, laealpha, 200, 0', '5639, LAEdirtapha, laealpha, 200, 4').replace(
        'end',
        '18632, jlneon, neontex, 225, 4, 20, 6\nend',
      );
      const result = generateMerge(IDE, modded, 'ide');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('replace in "objs":');
      expect(text).toContain('+ 5639, LAEdirtapha, laealpha, 200, 4');
      expect(text).toContain('add to "objs":');
      expect(text).toContain('18632, jlneon, neontex, 225, 4, 20, 6');
    });

    it('accepts a mid-section .ide insertion (order-irrelevant, add appends instead)', () => {
      const modded = IDE.replace('5640, other', '5700, inserted, tex, 100, 0\n5640, other');
      const result = generateMerge(IDE, modded, 'ide');
      expect(result.kind).toBe('merge'); // roundtrip compares section multisets for .ide
      const applied = applyIdeMerge(IDE, parseMergeFile((result as { text: string }).text), 'ide').text;
      expect(applied).toContain('5700, inserted, tex, 100, 0');
    });

    it('handles multiple scattered replace pairs across sections in one pass', () => {
      let modded = edit(IPL, '0, 100, 200, 30,', '0, 100, 200, -300,');
      modded = edit(modded, '0, 130, 230, 33,', '0, 130, 230, -300,');
      modded = edit(modded, '2060.76, 2071.18, -0.19', '2060.76, 2071.18, -5.0');
      const result = generateMerge(IPL, modded, 'ipl');
      expect(result.kind).toBe('merge');
      expect(applyIdeMerge(IPL, parseMergeFile((result as { text: string }).text), 'ipl').text).toBe(modded);
    });

    it("converts an inst row deletion to a remove directive; the author's hand-rebased lods drop out (level 2)", () => {
      // Author deleted row 1 and manually rebased row 2's link 5→... here: the linked fixture makes it real.
      const base = [
        'inst',
        '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
        '701, gone_b, 0, 11, 21, 31, 0, 0, 0, 1, -1',
        '702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 3',
        '703, lod_d, 0, 13, 23, 33, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      // the author's file: row 1 gone, obj_c's link hand-rebased 3 → 2
      const modded = [
        'inst',
        '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
        '702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 2',
        '703, lod_d, 0, 13, 23, 33, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      const result = generateMerge(base, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('remove from "inst":');
      expect(text).toContain('701, gone_b');
      expect(text).not.toContain('replace'); // the hand-rebase is reproduced by the apply-time rebase
      const applied = applyIdeMerge(base, parseMergeFile(text), 'ipl');
      expect(applied.removedInst).toEqual([1]);
      expect(applied.text).toContain('702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 2');
    });

    it('relocates a mid-inst insertion to an append, remapping its lod link into the final layout (level 2)', () => {
      // Author inserted an HD row mid-file, linking to a row AFTER the insert point (author idx 3 = final idx 2).
      const base = [
        'inst',
        '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
        '701, obj_b, 0, 11, 21, 31, 0, 0, 0, 1, -1',
        '703, lod_d, 0, 13, 23, 33, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      const modded = [
        'inst',
        '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
        '999, new_hd, 0, 13.1, 23.1, 33.1, 0, 0, 0, 1, 3', // mid-insert, links to lod_d at AUTHOR index 3
        '701, obj_b, 0, 11, 21, 31, 0, 0, 0, 1, -1',
        '703, lod_d, 0, 13, 23, 33, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      const result = generateMerge(base, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('add to "inst":');
      expect(text).toContain('999, new_hd, 0, 13.1, 23.1, 33.1, 0, 0, 0, 1, 2'); // lod remapped 3 → 2
      const applied = applyIdeMerge(base, parseMergeFile(text), 'ipl').text;
      const lines = applied.split('\n');
      expect(lines[4]).toContain('999, new_hd'); // appended after lod_d — vanilla indexes untouched
    });

    it('repairs a malformed lod cell (bare "-") to -1 instead of shipping a game-crashing row', () => {
      const base = ['inst', '10, m, 0, 1, 2, 3, 0, 0, 0, 1, -1', 'end', ''].join('\n');
      const modded = ['inst', '10, m, 0, 1, 2, -300, 0, 0, 0, 1, -', 'end', ''].join('\n');
      const result = generateMerge(base, modded, 'ipl');
      expect(result.kind).toBe('merge');
      const text = (result as { text: string }).text;
      expect(text).toContain('+ 10, m, 0, 1, 2, -300, 0, 0, 0, 1, -1'); // repaired, not "-"
      expect(text).not.toMatch(/, -$/m);
    });

    it('returns the author→final inst map for the stream converter', () => {
      const base = ['inst', '10, m, 0, 1, 2, 3, 0, 0, 0, 1, -1', '11, m, 0, 4, 5, 6, 0, 0, 0, 1, -1', 'end', ''].join(
        '\n',
      );
      const modded = [
        'inst',
        '10, m, 0, 1, 2, 3, 0, 0, 0, 1, -1',
        '12, m, 0, 7, 8, 9, 0, 0, 0, 1, -1',
        '11, m, 0, 4, 5, 6, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      const result = generateMerge(base, modded, 'ipl');
      expect(result.kind).toBe('merge');
      // author: 10=0, 12=1, 11=2 → final: 10=0, 11=1, 12 appended at 2
      expect((result as { authorToFinal?: number[] }).authorToFinal).toEqual([0, 2, 1]);
    });
  });
});

describe('generateStreamMerge', () => {
  const inst = (id: number, lod: number, x = 100): BinaryIplInstance => ({
    id,
    interior: 0,
    lod,
    position: [x, 200.5, 30.25],
    rotation: [0, 0, 0, 1],
  });
  const toAB = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  describe('negative cases', () => {
    it('reports identical streams (after lod remap) as identical', () => {
      const vanilla = encodeBinaryIpl([inst(700, 5)]);
      const modded = encodeBinaryIpl([inst(700, 6)]); // author layout has one extra row before index 5
      const result = generateStreamMerge(toAB(vanilla), toAB(modded), parseBinaryIpl, (lod) => lod - 1);
      expect(result.kind).toBe('identical');
    });
  });

  describe('positive cases', () => {
    it('expresses instance adds/removes/lod-changes as a merge that reproduces the modded stream', () => {
      const vanilla = encodeBinaryIpl([inst(700, 5), inst(701, -1), inst(702, 9)]);
      const modded = encodeBinaryIpl([inst(700, 5), inst(702, 12), inst(900, -1, 55)]); // 701 gone, 702 relinked, 900 added
      const result = generateStreamMerge(toAB(vanilla), toAB(modded), parseBinaryIpl);
      expect(result.kind).toBe('merge');
      const { bytes } = applyStreamMerge(vanilla, (result as { text: string }).text, 'x.ipl');
      const out = parseBinaryIpl(toAB(bytes));
      const canon = (list: readonly BinaryIplInstance[]): string[] =>
        list.map((i) => JSON.stringify([i.id, i.lod, i.position])).sort();
      expect(canon(out)).toEqual(canon(parseBinaryIpl(toAB(modded))));
    });
  });
});
