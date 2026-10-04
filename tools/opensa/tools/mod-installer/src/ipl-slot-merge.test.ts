import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compactStockInstIpls, mergeModInstIpls } from './ipl-slot-merge';

const STOCK_DAT = 'IDE DATA\\MAPS\\stock.IDE\nIPL DATA\\MAPS\\area.IPL\n';

/** A second stock host of `rows` rows, registered in both gta.dat files. */
function addStockHost(game: string, out: string, base: string, rows: number): void {
  for (const root of [game, out]) {
    const dat = join(root, 'data', 'gta.dat');
    const current = existsSync(dat) ? readFileSync(dat, 'utf8') : STOCK_DAT;
    writeFileSync(dat, `${current}IPL DATA\\MAPS\\${base}.IPL\n`);
  }
  writeFileSync(join(out, 'data', 'maps', `${base}.ipl`), `inst\n${bulk(rows, base)}\nend\n`);
}

/** `count` inst rows, each linking to `lod` (-1 = none) — the shape a mod map file ships. */
function bulk(count: number, model: string, lod = -1): string {
  return Array.from({ length: count }, (_, i) => `${i}, ${model}, 0, ${i},0,0, 0,0,0,1, ${lod}`).join('\n');
}

function hostRows(out: string, base = 'area'): string[] {
  return readFileSync(join(out, 'data', 'maps', `${base}.ipl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && /^\d/.test(l.trim()));
}

function writeGameAndOut(dir: string): { game: string; out: string } {
  const game = join(dir, 'game');
  const out = join(dir, 'out');
  for (const root of [game, out]) {
    mkdirSync(join(root, 'data', 'maps'), { recursive: true });
    mkdirSync(join(root, 'models'), { recursive: true });
  }
  writeFileSync(join(game, 'data', 'gta.dat'), STOCK_DAT);
  writeFileSync(join(out, 'models', 'gta3.img'), buildVer2Buffer([]));
  writeFileSync(join(out, 'data', 'maps', 'area.ipl'), 'inst\n1, stockthing, 0, 0,0,0, 0,0,0,1, -1\nend\n');

  return { game, out };
}

describe('mergeModInstIpls', () => {
  let dir: string;
  let game: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipl-slot-merge-'));
    ({ game, out } = writeGameAndOut(dir));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('never touches stock IPL lines or areas with binary streams in the IMG', () => {
      writeFileSync(
        join(out, 'models', 'gta3.img'),
        buildVer2Buffer([{ data: new Uint8Array(8), name: 'streamed_stream0.ipl' }]),
      );
      writeFileSync(join(out, 'data', 'gta.dat'), `${STOCK_DAT}IPL DATA\\MAPS\\streamed.IPL\nIPL DATA\\MAPS\\a.IPL\n`);
      writeFileSync(join(out, 'data', 'maps', 'streamed.ipl'), 'inst\n5, s, 0, 0,0,0, 0,0,0,1, -1\nend\n');
      writeFileSync(join(out, 'data', 'maps', 'a.ipl'), 'inst\n6, a, 0, 0,0,0, 0,0,0,1, -1\nend\n');

      const result = mergeModInstIpls(game, out);

      expect(result.merged).toBe(1); // a only — streamed.ipl keeps its own identity
      expect(existsSync(join(out, 'data', 'maps', 'streamed.ipl'))).toBe(true);
      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).toContain('IPL DATA\\MAPS\\streamed.IPL');
      expect(dat).toContain('IPL DATA\\MAPS\\area.IPL');
      expect(dat).not.toContain('MAPS\\a.IPL');
    });

    it('leaves everything alone when no stock host has the row budget, and SAYS which files', () => {
      writeFileSync(join(out, 'data', 'maps', 'area.ipl'), `inst\n${bulk(4200, 'big')}\nend\n`);
      writeFileSync(join(out, 'data', 'gta.dat'), `${STOCK_DAT}IPL DATA\\MAPS\\only.IPL\n`);
      writeFileSync(join(out, 'data', 'maps', 'only.ipl'), 'inst\n900, thing, 0, 1,2,3, 0,0,0,1, -1\nend\n');

      expect(mergeModInstIpls(game, out)).toEqual({ kept: [{ base: 'only.ipl', rows: 1 }], merged: 0, rows: 0 });
      expect(existsSync(join(out, 'data', 'maps', 'only.ipl'))).toBe(true);
    });

    it('will not SPLIT a file whose rows link to each other, and keeps it whole or keeps it put', () => {
      // 150 linked rows against two hosts with 100 free each: splitting would repoint every link, so the
      // file stays — and stays reported.
      writeFileSync(join(out, 'data', 'maps', 'area.ipl'), `inst\n${bulk(3000, 'stockthing')}\nend\n`);
      addStockHost(game, out, 'second', 3000);
      writeFileSync(
        join(out, 'data', 'gta.dat'),
        `${readFileSync(join(out, 'data', 'gta.dat'), 'utf8')}IPL DATA\\MAPS\\linked.IPL\n`,
      );
      writeFileSync(join(out, 'data', 'maps', 'linked.ipl'), `inst\n${bulk(150, 'linked', 3)}\nend\n`);

      const result = mergeModInstIpls(game, out);

      expect(result).toEqual({ kept: [{ base: 'linked.ipl', rows: 150 }], merged: 0, rows: 0 });
      expect(existsSync(join(out, 'data', 'maps', 'linked.ipl'))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('appends mod rows into the stock host, rebasing internal lod links past the host rows', () => {
      writeFileSync(
        join(out, 'data', 'gta.dat'),
        `${STOCK_DAT}IPL DATA\\MAPS\\first.IPL\nIPL DATA\\MAPS\\second.IPL\n`,
      );
      writeFileSync(
        join(out, 'data', 'maps', 'first.ipl'),
        'inst\n10, hd_a, 0, 1,1,1, 0,0,0,1, 1\n11, lod_a, 0, 1,1,1, 0,0,0,1, -1\nend\n',
      );
      writeFileSync(
        join(out, 'data', 'maps', 'second.ipl'),
        'inst\n20, hd_b, 0, 2,2,2, 0,0,0,1, 1\n21, lod_b, 0, 2,2,2, 0,0,0,1, -1\nend\n',
      );

      const result = mergeModInstIpls(game, out);

      expect(result).toEqual({ kept: [], merged: 2, rows: 4 });
      const rows = hostRows(out);
      expect(rows).toHaveLength(5); // 1 stock + 4 appended
      expect(rows[0]).toMatch(/^1, stockthing/); // host rows untouched, indexes preserved
      expect(rows[1]).toMatch(/, 2$/); // first.ipl link 1 → host offset 1 (+0 within block)
      expect(rows[3]).toMatch(/, 4$/); // second.ipl link 1 → rebased past host + first
      expect(existsSync(join(out, 'data', 'maps', 'first.ipl'))).toBe(false);
      expect(existsSync(join(out, 'data', 'maps', 'second.ipl'))).toBe(false);

      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).not.toContain('first.IPL');
      expect(dat).not.toContain('second.IPL');
      expect(dat).toContain('IPL DATA\\MAPS\\area.IPL'); // host line intact, no new line added
      expect(dat).not.toContain('modinst');
    });

    it('spreads a link-free file over SEVERAL hosts when no single one has the room', () => {
      // The Urbanize shape in miniature: 150 rows, two hosts with 100 free each. One host was the old rule,
      // and under it this file — and every file behind it — kept its slot.
      writeFileSync(join(out, 'data', 'maps', 'area.ipl'), `inst\n${bulk(3000, 'stockthing')}\nend\n`);
      addStockHost(game, out, 'second', 3000);
      writeFileSync(
        join(out, 'data', 'gta.dat'),
        `${readFileSync(join(out, 'data', 'gta.dat'), 'utf8')}IPL DATA\\MAPS\\props.IPL\n`,
      );
      writeFileSync(join(out, 'data', 'maps', 'props.ipl'), `inst\n${bulk(150, 'prop')}\nend\n`);

      const result = mergeModInstIpls(game, out);

      expect(result).toEqual({ kept: [], merged: 1, rows: 150 });
      expect(hostRows(out)).toHaveLength(3100); // 3000 + 100, the fold's cap with the later stages reserved
      expect(hostRows(out, 'second')).toHaveLength(3050);
      expect(existsSync(join(out, 'data', 'maps', 'props.ipl'))).toBe(false);
    });

    it('reserves room for the stages that append AFTER it — a host at the fold cap takes nothing', () => {
      writeFileSync(join(out, 'data', 'maps', 'area.ipl'), `inst\n${bulk(3100, 'stockthing')}\nend\n`);
      addStockHost(game, out, 'second', 2900);
      writeFileSync(
        join(out, 'data', 'gta.dat'),
        `${readFileSync(join(out, 'data', 'gta.dat'), 'utf8')}IPL DATA\\MAPS\\props.IPL\n`,
      );
      writeFileSync(join(out, 'data', 'maps', 'props.ipl'), `inst\n${bulk(200, 'prop')}\nend\n`);

      const result = mergeModInstIpls(game, out);

      // 3100 is the cap (4000 boot rows − 900 for the tree LODs and hole fill that land here later), so the
      // full host takes none of it and the other takes all 200 — over its own 4000 only if it also grows.
      expect(result).toEqual({ kept: [], merged: 1, rows: 200 });
      expect(hostRows(out)).toHaveLength(3100);
      expect(hostRows(out, 'second')).toHaveLength(3100);
    });
  });
});

describe('compactStockInstIpls', () => {
  let dir: string;
  let game: string;
  let out: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ipl-compact-'));
    game = join(dir, 'game');
    out = join(dir, 'out');
    for (const root of [game, out]) {
      mkdirSync(join(root, 'data', 'maps'), { recursive: true });
      mkdirSync(join(root, 'models'), { recursive: true });
    }
    writeFileSync(join(game, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\host.IPL\nIPL DATA\\MAPS\\donor.IPL\n');
    writeFileSync(join(out, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\host.IPL\nIPL DATA\\MAPS\\donor.IPL\n');
    // host is stream-backed (keeps its slot anyway), donor has no streams + extra sections
    const stream = new Uint8Array(80);
    stream.set([0x62, 0x6e, 0x72, 0x79]);
    new DataView(stream.buffer).setUint32(4, 0, true);
    writeFileSync(join(out, 'models', 'gta3.img'), buildVer2Buffer([{ data: stream, name: 'host_stream0.ipl' }]));
    writeFileSync(join(out, 'data', 'maps', 'host.ipl'), 'inst\n1, h, 0, 0,0,0, 0,0,0,1, -1\nend\n');
    writeFileSync(
      join(out, 'data', 'maps', 'donor.ipl'),
      'inst\n7, d, 5, 9,9,9, 0,0,0,1, -1\nend\nenex\n1, foo\nend\n',
    );
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('keeps the donor file and its other sections in place', () => {
      compactStockInstIpls(game, out);
      const donor = readFileSync(join(out, 'data', 'maps', 'donor.ipl'), 'utf8');

      expect(donor).toContain('enex');
      expect(donor).toContain('1, foo');
      expect(donor).not.toContain('7, d,');
      const dat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(dat).toContain('IPL DATA\\MAPS\\donor.IPL'); // gta.dat line stays — file still loads its enex
    });
  });

  describe('positive cases', () => {
    it('moves the stream-less stock inst rows into the stream-backed host', () => {
      const result = compactStockInstIpls(game, out);

      expect(result).toEqual({ compacted: 1, rows: 1 });
      const host = readFileSync(join(out, 'data', 'maps', 'host.ipl'), 'utf8');
      expect(host).toContain('7, d, 5, 9,9,9'); // interior field preserved
    });

    it('loses NOTHING: every row the donor gives up is in the host, whatever the donor held', () => {
      // The property this compaction lives or dies on, and the one nothing pinned. On the real map the
      // donors are `gen_int1` (206 rows) and `int_cont` (8) — emptying them is how the layer buys back two
      // of SA's 40 `IplEntityIndexArrays` slots, and 2026-08-10 a whole bisection went into asking whether
      // those 206 rows had been DELETED. They had not (399 placements before, 400 after, the +1 a mod's).
      // A count test says that in one line, where reading the emptied file says the opposite.
      const rows = Array.from({ length: 12 }, (_, i) => `${100 + i}, d${i}, ${i % 3}, ${i},${i},${i}, 0,0,0,1, -1`);
      writeFileSync(join(out, 'data', 'maps', 'donor.ipl'), `inst\n${rows.join('\n')}\nend\nenex\n1, foo\nend\n`);

      const result = compactStockInstIpls(game, out);

      expect(result.rows).toBe(rows.length);
      const host = readFileSync(join(out, 'data', 'maps', 'host.ipl'), 'utf8');
      for (const row of rows) {
        expect(host).toContain(row);
      }
      // And the donor really is empty — the slot is only reclaimed if its `inst` block has nothing left.
      const donorInst = readFileSync(join(out, 'data', 'maps', 'donor.ipl'), 'utf8').split(/\r?\n/);
      expect(donorInst.filter((line) => /^\d/.test(line.trim()) && line.includes(', d'))).toEqual([]);
    });
  });
});
