import { describe, expect, it } from 'vitest';

import { applyIdeMerge, parseMergeFile } from './ide-merge';

const TARGET = ['objs', '1682, ap_radar1_01, ap_misc1bit, 100, 2097152', '1683, other, tex, 100, 0', 'end', ''].join(
  '\n',
);

describe('parseMergeFile', () => {
  describe('negative cases', () => {
    it('throws on an entry outside any directive', () => {
      expect(() => parseMergeFile('1682, ap_radar1_01, ap_misc1bit, 100, 2097152')).toThrow(/outside any directive/);
    });

    it('throws on a malformed directive header (typo guard)', () => {
      expect(() => parseMergeFile('add too "anim":\n1, a, b, 0')).toThrow(/malformed merge directive/);
    });

    it('throws on an entry without a numeric ID', () => {
      expect(() => parseMergeFile('add to "anim":\nap_radar1_01, no, id')).toThrow(/no numeric ID/);
    });

    it('throws on a dangling "-" line without its "+" replacement', () => {
      expect(() => parseMergeFile('replace in "inst":\n- 710, vgs_palm01, 0, 1, 2, 3')).toThrow(
        /'-' line without its '\+' replacement/,
      );
    });

    it('throws on a "+" line without a preceding "-" line', () => {
      expect(() => parseMergeFile('replace in "inst":\n+ 710, vgs_palm01, 0, 1, 2, 3')).toThrow(
        /'\+' line without a preceding '-'/,
      );
    });

    it('throws on a bare entry line under a replace directive', () => {
      expect(() => parseMergeFile('replace in "inst":\n710, vgs_palm01, 0, 1, 2, 3')).toThrow(
        /expected a '-' or '\+' line/,
      );
    });

    it('throws on a pair line under an add directive', () => {
      expect(() => parseMergeFile('add to "inst":\n- 710, vgs_palm01, 0, 1, 2, 3')).toThrow(/belong under a 'replace/);
    });
  });

  describe('positive cases', () => {
    it('parses a replace directive into -/+ pairs', () => {
      const directives = parseMergeFile(
        [
          'replace in "inst":',
          '- 710, vgs_palm01, 0, 2110.67, -977.73, 66.13, 0, 0, 0, 1, -1',
          '+ 710, vgs_palm01, 0, 2110.67, -977.73, -300.0, 0, 0, 0, 1, -1',
          '- 713, veg_bevtree1, 0, 2275.39, -1438.66, 22.55, 0, 0, 0, 1, -1',
          '+ 713, veg_bevtree1, 0, 2275.39, -1438.66, -300.0, 0, 0, 0, 1, -1',
        ].join('\n'),
      );
      expect(directives).toHaveLength(1);
      expect(directives[0].action).toBe('replace');
      expect(directives[0].pairs).toHaveLength(2);
      expect(directives[0].pairs![0].from).toContain('66.13');
      expect(directives[0].pairs![0].to).toContain('-300.0');
    });

    it('parses remove/add directives with comments and blank lines', () => {
      const directives = parseMergeFile(
        [
          '# radar becomes an anim object',
          'remove from "objs":',
          '1682, ap_radar1_01, ap_misc1bit, 100, 2097152 # documentation line',
          '',
          'add to "anim":',
          '1682, ap_radar1_01, ap_misc1bit, radar, 600, 0',
        ].join('\n'),
      );
      expect(directives).toHaveLength(2);
      expect(directives[0]).toMatchObject({ action: 'remove', section: 'objs' });
      expect(directives[0].entries).toHaveLength(1);
      expect(directives[1]).toMatchObject({ action: 'add', section: 'anim' });
    });
  });
});

describe('applyIdeMerge', () => {
  describe('negative cases', () => {
    it('warns when removing from a section the target does not have', () => {
      const { text, warnings } = applyIdeMerge(TARGET, parseMergeFile('remove from "tobj":\n1682, a, b, 0, 0, 0, 0'));
      expect(warnings).toHaveLength(1);
      expect(text).toBe(TARGET); // untouched
    });

    it('warns (not throws) when a remove ID is absent, and applies the rest', () => {
      const directives = parseMergeFile(
        'remove from "objs":\n9999, ghost, tex, 100, 0\nadd to "anim":\n1, a, b, c, 0, 0',
      );
      const { text, warnings } = applyIdeMerge(TARGET, directives);
      expect(warnings).toEqual(['remove from "objs": id 9999 not found — skipped']);
      expect(text).toContain('anim\n1, a, b, c, 0, 0\nend');
    });
  });

  describe('positive cases', () => {
    it('moves an entry between sections (the radar case), leaving other lines verbatim', () => {
      const directives = parseMergeFile(
        'remove from "objs":\n1682, ap_radar1_01, ap_misc1bit, 100, 2097152\nadd to "anim":\n1682, ap_radar1_01, ap_misc1bit, radar, 600, 0',
      );
      const { text, warnings } = applyIdeMerge(TARGET, directives);
      expect(warnings).toEqual([]);
      expect(text).not.toMatch(/objs\n1682/); // removed from objs
      expect(text).toContain('1683, other, tex, 100, 0'); // untouched neighbour kept verbatim
      expect(text).toContain('anim\n1682, ap_radar1_01, ap_misc1bit, radar, 600, 0\nend'); // section created
    });

    it('replaces a same-ID entry when adding into a section that already has it (mod stacking)', () => {
      const first = applyIdeMerge(TARGET, parseMergeFile('add to "anim":\n1682, a, b, clip1, 100, 0')).text;
      const second = applyIdeMerge(first, parseMergeFile('add to "anim":\n1682, a, b, clip2, 600, 0')).text;
      expect(second).toContain('clip2');
      expect(second).not.toContain('clip1');
    });

    it('preserves the target CRLF line endings', () => {
      const crlf = TARGET.replace(/\n/g, '\r\n');
      const { text } = applyIdeMerge(crlf, parseMergeFile('add to "anim":\n1, a, b, c, 0, 0'));
      expect(text).toContain('\r\n');
      expect(text).toContain('anim\r\n1, a, b, c, 0, 0\r\nend');
    });

    it('removes by ID even when the target line was reformatted by another tool (float noise)', () => {
      const reformatted = TARGET.replace(
        '1682, ap_radar1_01, ap_misc1bit, 100, 2097152',
        '1682 ,ap_radar1_01 ,ap_misc1bit ,100 ,2097152',
      );
      const { text } = applyIdeMerge(
        reformatted,
        parseMergeFile('remove from "objs":\n1682, ap_radar1_01, ap_misc1bit, 100, 2097152'),
      );
      expect(text).not.toContain('1682');
    });
  });
});

/** A text IPL with duplicate inst IDs (real SA shape) + an occl section. */
const IPL = [
  'inst',
  '710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
  '710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1',
  '714, veg_bevtree2, 0, 120, 220, 32, 0, 0, 0, 1, 5',
  'end',
  'occl',
  '1932.59, 1917.11, 122.833, 86.8, 8.38, -142.09, 0.0, 0.0, 0.0, 0',
  'end',
  '',
].join('\n');

/** A linked fixture for remove-rebase tests: row 2 links to row 3 via its lod column. */
const LINKED_IPL = [
  'inst',
  '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
  '701, obj_b, 0, 11, 21, 31, 0, 0, 0, 1, -1',
  '# a comment row — transparent to indexing',
  '702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 3',
  '703, lod_d, 0, 12, 22, 32, 0, 0, 0, 1, -1',
  'end',
  '',
].join('\n');

describe('applyIdeMerge on .ipl targets (plan 007)', () => {
  describe('negative cases', () => {
    it('throws when removing an inst row another row still links to (orphaned lod)', () => {
      expect(() =>
        applyIdeMerge(
          LINKED_IPL,
          parseMergeFile('remove from "inst":\n703, lod_d, 0, 12, 22, 32, 0, 0, 0, 1, -1'),
          'ipl',
        ),
      ).toThrow(/still links to the removed row/);
    });

    it('warns (not throws) when a replace pair matches nothing, applying the rest', () => {
      const merge = [
        'replace in "inst":',
        '- 999, ghost, 0, 1, 2, 3, 0, 0, 0, 1, -1',
        '+ 999, ghost, 0, 1, 2, -300, 0, 0, 0, 1, -1',
        '- 714, veg_bevtree2, 0, 120, 220, 32, 0, 0, 0, 1, 5',
        '+ 714, veg_bevtree2, 0, 120, 220, -300, 0, 0, 0, 1, 5',
      ].join('\n');
      const { text, warnings } = applyIdeMerge(IPL, parseMergeFile(merge), 'ipl');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/line not found/);
      expect(text).toContain('714, veg_bevtree2, 0, 120, 220, -300, 0, 0, 0, 1, 5');
    });

    it('warns when a replace pair is ambiguous and replaces only the first match', () => {
      const doubled = IPL.replace(
        '710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1',
        '710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
      );
      const merge = [
        'replace in "inst":',
        '- 710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
        '+ 710, vgs_palm01, 0, 100, 200, -300, 0, 0, 0, 1, -1',
      ].join('\n');
      const { text, warnings } = applyIdeMerge(doubled, parseMergeFile(merge), 'ipl');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/2 rows matched/);
      // first sunk, second untouched
      expect(text).toContain('710, vgs_palm01, 0, 100, 200, -300, 0, 0, 0, 1, -1');
      expect(text).toContain('710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1');
    });
  });

  describe('positive cases', () => {
    it('replace keeps the row at its index (duplicate IDs disambiguated by the full line)', () => {
      const merge = [
        'replace in "inst":',
        '- 710, vgs_palm01, 0, 110, 210, 31, 0, 0, 0, 1, -1',
        '+ 710, vgs_palm01, 0, 110, 210, -300.0, 0, 0, 0, 1, -1',
      ].join('\n');
      const { text, warnings } = applyIdeMerge(IPL, parseMergeFile(merge), 'ipl');
      expect(warnings).toEqual([]);
      const lines = text.split('\n');
      expect(lines[2]).toBe('710, vgs_palm01, 0, 110, 210, -300.0, 0, 0, 0, 1, -1'); // same row index
      expect(lines[1]).toBe('710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1'); // same-id neighbour untouched
      expect(lines[3]).toBe('714, veg_bevtree2, 0, 120, 220, 32, 0, 0, 0, 1, 5');
    });

    it('add appends verbatim before the section end without touching existing rows (no id-dedupe)', () => {
      const merge = 'add to "inst":\n710, vgs_palm01, 0, 300, 400, 50, 0, 0, 0, 1, -1';
      const { text } = applyIdeMerge(IPL, parseMergeFile(merge), 'ipl');
      const lines = text.split('\n');
      expect(lines[1]).toContain('100, 200, 30'); // existing same-id rows keep their indexes
      expect(lines[2]).toContain('110, 210, 31');
      expect(lines[4]).toBe('710, vgs_palm01, 0, 300, 400, 50, 0, 0, 0, 1, -1'); // appended last
      expect(lines[5]).toBe('end');
    });

    it('remove works for non-inst sections by full-line match (occluders carry no IDs)', () => {
      const merge = 'remove from "occl":\n1932.59, 1917.11, 122.833, 86.8, 8.38, -142.09, 0.0, 0.0, 0.0, 0';
      const { text, warnings } = applyIdeMerge(IPL, parseMergeFile(merge), 'ipl');
      expect(warnings).toEqual([]);
      expect(text).toContain('occl\nend');
    });

    it('remove from "inst" rebases every surviving lod link and reports the original index (plan 008)', () => {
      const { removedInst, text, warnings } = applyIdeMerge(
        LINKED_IPL,
        parseMergeFile('remove from "inst":\n701, obj_b, 0, 11, 21, 31, 0, 0, 0, 1, -1'),
        'ipl',
      );
      expect(warnings).toEqual([]);
      expect(removedInst).toEqual([1]);
      expect(text).not.toContain('obj_b');
      expect(text).toContain('702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 2'); // link 3 → 2 (its target shifted down)
      expect(text).toContain('700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1'); // -1 untouched
      expect(text).toContain('# a comment row'); // comments survive and never counted as indexes
    });

    it('reports multiple removals in the ORIGINAL index space', () => {
      const merge = [
        'remove from "inst":',
        '700, obj_a, 0, 10, 20, 30, 0, 0, 0, 1, -1',
        '701, obj_b, 0, 11, 21, 31, 0, 0, 0, 1, -1',
      ].join('\n');
      const { removedInst, text } = applyIdeMerge(LINKED_IPL, parseMergeFile(merge), 'ipl');
      expect(removedInst).toEqual([0, 1]); // second removal happened at current index 0 → original 1
      expect(text).toContain('702, obj_c, 0, 12, 22, 32, 0, 0, 0, 1, 1'); // 3 → 1 after two shifts
    });

    it('replace works for .ide targets too (line-keyed flag edit)', () => {
      const merge = [
        'replace in "objs":',
        '- 1682, ap_radar1_01, ap_misc1bit, 100, 2097152',
        '+ 1682, ap_radar1_01, ap_misc1bit, 100, 0',
      ].join('\n');
      const { text, warnings } = applyIdeMerge(TARGET, parseMergeFile(merge), 'ide');
      expect(warnings).toEqual([]);
      expect(text).toContain('1682, ap_radar1_01, ap_misc1bit, 100, 0');
      expect(text).not.toContain('2097152');
    });
  });
});
