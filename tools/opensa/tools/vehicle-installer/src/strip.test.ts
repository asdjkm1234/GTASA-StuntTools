import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseCarGroups } from '@opensa/renderware/parsers/text/cargrp.parser';
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  stripCarcols,
  stripCarGroups,
  stripCarmods,
  stripGta3Img,
  stripHandling,
  stripIde,
  stripParked,
} from './strip';

const IDE = ['cars', '400, landstal, landstal, car', '445, admiral, admiral, car', 'end'].join('\n');
const HANDLING = ['; header', 'LANDSTAL 1700 a b c', 'ADMIRAL 2000 a b c', '% PREDATOR 0.7', '! boat 1'].join('\n');
const CARCOLS = ['col', '0,0,0 # 0', '1,1,1 # 1', 'end', 'car', 'admiral, 1,1', 'ambulan, 2,2', 'end'].join('\n');
const CARMODS = ['link', 'a, b', 'end', 'mods', 'admiral, nto_b_l', 'banshee, nto_b_s', 'end'].join('\n');
const CARGRP = ['# header', 'taxi, admiral, mule\t# WORKERS', 'banshee, comet # RICH'].join('\n');
const PARKED = JSON.stringify([
  { colour: '57,57', heading: 0, model: 'admiral', position: [1, 2, 3] },
  { colour: '6,3', heading: 0, model: 'comet', position: [4, 5, 6] },
]);

describe('strip', () => {
  describe('positive cases', () => {
    it('stripIde keeps only the installed models in the cars section', () => {
      const out = stripIde(IDE, new Set(['admiral']));
      expect(out).toContain('445, admiral, admiral, car');
      expect(out).not.toContain('landstal');
      expect(out.split('\n').filter((l) => l.trim() !== '')).toEqual(['cars', '445, admiral, admiral, car', 'end']);
    });

    it('stripHandling keeps only the installed ids, leaving comments and sub-tables', () => {
      const out = stripHandling(HANDLING, new Set(['ADMIRAL']));
      const handling = parseHandling(out);
      expect(handling.has('ADMIRAL')).toBe(true);
      expect(handling.has('LANDSTAL')).toBe(false);
      expect(out).toContain('% PREDATOR'); // non-car sub-table kept
      expect(out).toContain('; header'); // comment kept
    });

    it('stripCarcols keeps the col palette and only installed cars', () => {
      const carcols = parseCarcols(stripCarcols(CARCOLS, new Set(['admiral'])));
      expect(carcols.palette).toHaveLength(2); // col section untouched
      expect(carcols.cars.has('admiral')).toBe(true);
      expect(carcols.cars.has('ambulan')).toBe(false);
    });

    it('stripCarmods keeps link/wheel and only installed mods', () => {
      const carmods = parseCarmods(stripCarmods(CARMODS, new Set(['admiral'])));
      expect(carmods.links).toHaveLength(1); // link section untouched
      expect(carmods.mods.has('admiral')).toBe(true);
      expect(carmods.mods.has('banshee')).toBe(false);
    });

    it('stripCarGroups keeps only installed models per group, preserving group lines + labels', () => {
      // The line for a group with no installed cars is kept (emptied) so group order/index is preserved.
      expect(stripCarGroups(CARGRP, new Set(['admiral'])).split('\n')).toEqual([
        '# header',
        'admiral\t# WORKERS', // taxi + mule dropped
        '\t# RICH', // banshee + comet dropped → emptied, line kept
      ]);
      // The kept group still parses to just the installed model.
      expect(parseCarGroups(stripCarGroups(CARGRP, new Set(['admiral'])))[0]).toEqual({
        comment: 'WORKERS',
        models: ['admiral'],
      });
    });

    it('stripParked keeps only the installed models entries', () => {
      const parked = JSON.parse(stripParked(PARKED, new Set(['admiral']))) as { model: string }[];
      expect(parked.map((p) => p.model)).toEqual(['admiral']); // comet dropped
    });
  });
});

describe('stripGta3Img', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'strip-img-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('positive cases', () => {
    it('keeps only the named entries, dropping the rest', () => {
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();
      img.set('admiral.dff', Uint8Array.of(1));
      img.set('admiral.txd', Uint8Array.of(2));
      img.set('building.dff', Uint8Array.of(3));
      writeFileSync(imgPath, img.build());

      stripGta3Img(imgPath, new Set(['admiral.dff', 'admiral.txd']));

      const after = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(
        after
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['admiral.dff', 'admiral.txd']);
    });
  });
});

// The SUT strips STOCK files, and every risk lives in stock-file weirdness the hand-written fakes above omit:
// handling.cfg's `%` bike / `!` boat / `$` plane / `^` flying sub-tables, carcols.dat's `col`+`car` two-section
// layout, cargrp.dat's fixed group order. All six are already in the fixture manifest.
const STOCK = {
  carcols: 'fixtures/original/data/carcols.dat',
  cargrp: 'fixtures/original/data/cargrp.dat',
  handling: 'fixtures/original/data/handling.cfg',
  ide: 'fixtures/original/data/vehicles.ide',
  parked: 'fixtures/original/parked.json',
};
const read = (path: string): string => readFileSync(path, 'utf8');

describe.skipIf(!existsSync(STOCK.handling))('strip (real stock data files)', () => {
  const installed = new Set(['admiral']);

  describe('positive cases', () => {
    it('stripHandling keeps the one installed car and EVERY non-car sub-table', () => {
      const stock = read(STOCK.handling);

      const out = stripHandling(stock, new Set(['ADMIRAL']));

      expect(parseHandling(stock).size).toBeGreaterThan(200); // the stock car table
      expect([...parseHandling(out).keys()]).toEqual(['ADMIRAL']);
      // Bikes (%), boats (!), planes ($) and flying ($/^) live in their own tables keyed by a leading marker.
      // They are NOT cars and must survive untouched, or the game loses every bike's handling.
      for (const marker of ['%', '!', '$', '^']) {
        const rows = (text: string): number => text.split('\n').filter((line) => line.startsWith(marker)).length;
        expect(rows(out)).toBe(rows(stock));
        expect(rows(out)).toBeGreaterThan(0);
      }
    });

    it('stripCarcols keeps the WHOLE 127-colour palette and only the installed car', () => {
      const stock = parseCarcols(read(STOCK.carcols));

      const out = parseCarcols(stripCarcols(read(STOCK.carcols), installed));

      // The palette is indexed BY NUMBER from the car rows — dropping a single entry would repaint the game.
      expect(out.palette).toEqual(stock.palette);
      expect([...out.cars.keys()]).toEqual(['admiral']);
    });

    it('stripCarGroups keeps every group LINE, so the group indexes still line up', () => {
      const stock = read(STOCK.cargrp);

      const out = stripCarGroups(stock, installed);

      // popcycle.dat picks a car group BY INDEX, so an emptied group must stay as an empty line rather than
      // disappear (our own parser skips the empties — that is why this asserts on lines, not on parsed groups).
      expect(out.split('\n')).toHaveLength(stock.split('\n').length);
      for (const group of parseCarGroups(out)) {
        expect(group.models).toEqual(['admiral']);
      }
    });

    it('stripIde keeps the cars section shape and only the installed model', () => {
      const out = stripIde(read(STOCK.ide), installed);

      const rows = out.split('\n').filter((line) => /^\d/.test(line.trim()));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('admiral');
      expect(out).toContain('cars');
      expect(out).toContain('end');
    });

    it('stripParked drops every parked car whose model is not installed', () => {
      const stock = JSON.parse(read(STOCK.parked)) as { model: string }[];

      const out = JSON.parse(stripParked(read(STOCK.parked), installed)) as { model: string }[];

      expect(stock.length).toBeGreaterThan(100);
      expect(new Set(out.map((car) => car.model))).toEqual(new Set(['admiral']));
    });
  });
});
