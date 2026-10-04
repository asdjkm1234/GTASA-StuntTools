import {
  ensure24h,
  FIELD_LABELS,
  FIELDS,
  HOURS,
  parseTimecyc,
  WEATHER_NAMES,
} from '@opensa/renderware/parsers/text/timecyc.parser';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mergeTimecyc } from './merge';

const WIDTH: Record<string, number> = { float: 1, int: 1, rgb: 3, rgba: 4 };
const ROW_SIZE = FIELDS.reduce((n, f) => n + WIDTH[f.kind], 0);
const TOTAL_ROWS = WEATHER_NAMES.length * HOURS;

/** A full row set (every weather × hour) filled with one marker value. */
function grid(fill: number): number[][] {
  return Array.from({ length: TOTAL_ROWS }, () => Array.from({ length: ROW_SIZE }, () => fill));
}

/** Offset of a field label in a flat row (independent re-derivation for the assertions). */
function offsetOf(label: string): number {
  let offset = 0;
  for (let i = 0; i < FIELDS.length; i += 1) {
    if (FIELD_LABELS[i] === label) {
      return offset;
    }
    offset += WIDTH[FIELDS[i].kind];
  }

  return -1;
}

const rowIndex = (weather: string, hour: number): number => WEATHER_NAMES.indexOf(weather) * HOURS + hour;

const SKY_TOP = offsetOf('Sky top'); // 9 (width 3)
const FAR_CLIP = offsetOf('FarClp'); // 27
const FOG_START = offsetOf('FogSt'); // 28

afterEach(() => vi.restoreAllMocks());

describe('mergeTimecyc', () => {
  describe('negative cases', () => {
    it('returns a fresh clone of the base when there are no items', () => {
      const base = grid(0);
      const result = mergeTimecyc(base, []);
      expect(result).toEqual(base);
      expect(result).not.toBe(base);
      expect(result[0]).not.toBe(base[0]); // rows cloned, not shared
    });

    it('skips an unknown prop / zone / hour (warns, leaves the base untouched)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const base = grid(0);
      const result = mergeTimecyc(base, [
        { props: ['No Such Prop'], rows: grid(7) },
        { rows: grid(7), zones: ['NO_SUCH_ZONE'] },
        { rows: grid(7), times: ['99h'] },
      ]);
      expect(result).toEqual(base);
      expect(warn).toHaveBeenCalledTimes(3);
    });
  });

  describe('positive cases', () => {
    it('props-only overlay touches only those columns, across all weathers and hours', () => {
      const result = mergeTimecyc(grid(0), [{ props: ['Sky top'], rows: grid(7) }]);
      for (const weather of ['EXTRASUNNY_LA', 'CLOUDY_VEGAS', 'EXTRACOLOURS_2']) {
        for (const hour of [0, 12, 23]) {
          const row = result[rowIndex(weather, hour)];
          expect(row.slice(SKY_TOP, SKY_TOP + 3)).toEqual([7, 7, 7]); // Sky top replaced
          expect(row[0]).toBe(0); // Amb untouched
          expect(row[ROW_SIZE - 1]).toBe(0); // DirMult untouched
        }
      }
    });

    it('times-only overlay restricts to those hours (whole row), leaving other hours as base', () => {
      const result = mergeTimecyc(grid(0), [{ rows: grid(7), times: ['5h'] }]);
      expect(result[rowIndex('SUNNY_SF', 5)]).toEqual(Array(ROW_SIZE).fill(7)); // hour 5 fully overlaid
      expect(result[rowIndex('SUNNY_SF', 6)]).toEqual(Array(ROW_SIZE).fill(0)); // hour 6 untouched
    });

    it('zones-only overlay replaces the whole weather (all hours, all props)', () => {
      const result = mergeTimecyc(grid(0), [{ rows: grid(7), zones: ['CLOUDY_VEGAS'] }]);
      for (const hour of [0, 11, 23]) {
        expect(result[rowIndex('CLOUDY_VEGAS', hour)]).toEqual(Array(ROW_SIZE).fill(7));
      }
      expect(result[rowIndex('SUNNY_VEGAS', 0)]).toEqual(Array(ROW_SIZE).fill(0)); // a different weather untouched
    });

    it('intersects props and times (only those columns of only those hours)', () => {
      const result = mergeTimecyc(grid(0), [{ props: ['Sky top'], rows: grid(7), times: ['20h'] }]);
      const at20 = result[rowIndex('EXTRASUNNY_LA', 20)];
      expect(at20.slice(SKY_TOP, SKY_TOP + 3)).toEqual([7, 7, 7]);
      expect(at20[0]).toBe(0); // other columns at hour 20 untouched
      expect(result[rowIndex('EXTRASUNNY_LA', 19)].slice(SKY_TOP, SKY_TOP + 3)).toEqual([0, 0, 0]); // other hours untouched
    });

    it('applies items in order — a later item wins on overlapping cells', () => {
      const result = mergeTimecyc(grid(0), [
        { props: ['Sky top'], rows: grid(7) },
        { props: ['Sky top'], rows: grid(9) },
      ]);
      expect(result[0].slice(SKY_TOP, SKY_TOP + 3)).toEqual([9, 9, 9]);
    });

    // The recipe for the table the opensa target SHIPS, written as a test so the file stays reproducible
    // and any drift fails (plan 104/04): Dante's 23 × 24 table everywhere, `FarClp` + `FogSt` from stock.
    // The field rejected Dante's fog and accepted everything else, and nothing else in the repo could say
    // so — re-copying his file over ours would be silent.
    it('reproduces the shipped opensa table: Dante everywhere, FarClp + FogSt from stock', () => {
      const dante = ensure24h(parseTimecyc(readFileSync('fixtures/original/data/timecyc24h.dat', 'utf8')));
      const stock = ensure24h(parseTimecyc(readFileSync('fixtures/original/data/timecyc.dat', 'utf8')));
      const shipped = ensure24h(parseTimecyc(readFileSync('fixtures/original/mods/timecyc24h-shipped.dat', 'utf8')));

      expect(mergeTimecyc(dante, [{ props: ['FarClp', 'FogSt'], rows: stock }])).toEqual(shipped);
    });

    it('leaves every column but the fog pair as Dante authored it', () => {
      const dante = ensure24h(parseTimecyc(readFileSync('fixtures/original/data/timecyc24h.dat', 'utf8')));
      const shipped = ensure24h(parseTimecyc(readFileSync('fixtures/original/mods/timecyc24h-shipped.dat', 'utf8')));
      const changed = new Set<number>();
      shipped.forEach((row, r) => row.forEach((value, c) => (value === dante[r][c] ? null : changed.add(c))));

      expect([...changed].sort((a, b) => a - b)).toEqual([FAR_CLIP, FOG_START]);
    });
  });
});
