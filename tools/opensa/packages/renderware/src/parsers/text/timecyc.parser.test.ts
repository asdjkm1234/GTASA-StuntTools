import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  convertTo24h,
  ensure24h,
  FIELD_LABELS,
  FIELDS,
  HOURS,
  parseTimecyc,
  stringifyTimecyc,
  TIME_WEATHERS,
  WEATHER_NAMES,
} from './timecyc.parser';

const WIDTH: Record<string, number> = { float: 1, int: 1, rgb: 3, rgba: 4 };
/** Read-failure default per field kind; a FLOAT field has none — see {@link readFailures}. */
const SENTINEL: Record<string, number | undefined> = { int: -1000, rgb: -100, rgba: -100 };
const ROW_SIZE = FIELDS.reduce((n, f) => n + WIDTH[f.kind], 0);
const base = readFileSync('fixtures/original/data/timecyc.dat', 'utf8');
const day24 = readFileSync('fixtures/original/data/timecyc_24h.dat', 'utf8');
/** The `timecyc24h.asi` (Dante) table — the only 23 × 24 authored file in the corpus (plan 104). */
const dante = readFileSync('fixtures/original/data/timecyc24h.dat', 'utf8');
/** Read-failure defaults, by the only field kinds that can produce them: `getval` returns -1000 for a
 *  strict-int read and -100 per channel for an RGB(A) one. A FLOAT field can hold either number as DATA —
 *  Dante authors `FogSt` at -100 and -1000 — so a whole-row scan for those values reports failures that
 *  are not there (it did, on 2026-08-22, until the columns were separated). */
function readFailures(rows: readonly (readonly number[])[]): number {
  return rows.reduce((total, row) => total + rowFailures(row), 0);
}

function rowFailures(row: readonly number[]): number {
  let failures = 0;
  let pos = 0;
  for (const field of FIELDS) {
    const width = WIDTH[field.kind];
    const sentinel = SENTINEL[field.kind];
    if (sentinel !== undefined && row.slice(pos, pos + width).includes(sentinel)) {
      failures += 1;
    }
    pos += width;
  }

  return failures;
}

/** Every non-comment line's raw token count — the structural claim, before any field is read. */
const tokenWidths = (text: string): Set<number> =>
  new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'))
      .map((line) => line.split(/\s+/).length),
  );

describe('parseTimecyc', () => {
  describe('negative cases', () => {
    it('skips comment and blank lines', () => {
      expect(parseTimecyc('// header\n\n   \n')).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('parses the vanilla timecyc.dat as 23 weathers × 8 keyframes', () => {
      const rows = parseTimecyc(base);
      expect(rows).toHaveLength(23 * 8); // 184
      expect(rows[0]).toHaveLength(ROW_SIZE); // 52, padded with defaults
      expect(rows[0].slice(0, 3)).toEqual([22, 22, 22]); // first weather, midnight ambient
    });

    it('parses the 24h timecyc_24h.dat (≥ 21 weathers × 24 hours)', () => {
      const rows = parseTimecyc(day24);
      expect(rows.length).toBeGreaterThanOrEqual(TIME_WEATHERS * HOURS); // ≥ 504
      expect(rows[0]).toHaveLength(ROW_SIZE);
    });

    it('parses the Dante timecyc24h.dat as 23 weathers × 24 hours with no read failure', () => {
      const rows = parseTimecyc(dante);
      expect(rows).toHaveLength(WEATHER_NAMES.length * HOURS); // 552
      expect(rows.every((row) => row.length === ROW_SIZE)).toBe(true);
      expect(readFailures(rows)).toBe(0);
    });

    it('still carries the stock RAINY_COUNTRYSIDE corruption into our own 24h table', () => {
      // The contrast that names the mod ("Refixed"): stock's one 49-token keyframe fails 13 fields
      // (7 int + 6 RGB), and convertTo24h carries them to hour 20 of that weather — the same 13 in the
      // generated table. Pinned so a change to that file (plan 104/03) cannot quietly alter it.
      expect(readFailures(parseTimecyc(base))).toBe(13);
      expect(readFailures(parseTimecyc(day24))).toBe(13);
    });

    it('reads the two 24h plugin files as ONE schema — 52 tokens on every data line of both', () => {
      // The finding the plan turns on: `timecyc_24h.dat` and `timecyc24h.dat` are the same format, and the
      // two plugins differ only in the file name each hardcodes. If this ever splits, the plan is wrong.
      expect(tokenWidths(dante)).toEqual(new Set([ROW_SIZE]));
      expect(tokenWidths(day24)).toEqual(new Set([ROW_SIZE]));
    });

    it('defaults the missing trailing field (dirMult) to 1', () => {
      const rows = parseTimecyc(base);
      expect(rows[0][ROW_SIZE - 1]).toBe(1); // dirMult absent in vanilla → default 1
    });

    it('reads sky from fixed columns, ignoring trailing extras (modded-timecyc robustness)', () => {
      // Modded timecyc files append non-time-based extra columns; the parser walks a fixed FIELDS
      // layout, so trailing tokens must not shift or corrupt the sky columns. (The grey-sky case.)
      const firstRow = base.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('//'))!;
      const clean = parseTimecyc(firstRow);
      const withExtras = parseTimecyc(`${firstRow}   777 888 999 111 222`);
      expect(withExtras[0]).toHaveLength(ROW_SIZE); // extras don't grow the row
      // skyTop = field 3 (values 9..11), skyBot = field 4 (values 12..14): untouched by trailing extras.
      expect(withExtras[0].slice(9, 15)).toEqual(clean[0].slice(9, 15));
    });
  });
});

describe('convertTo24h', () => {
  describe('positive cases', () => {
    it('expands the 21 time weathers to 24 hours each', () => {
      expect(convertTo24h(parseTimecyc(base))).toHaveLength(TIME_WEATHERS * HOURS); // 504
    });

    it('agrees with the shipped 24h fixture, which scripts/test-fixtures.ts generates from the base', () => {
      // What this checks and what it does NOT: the fixture is written by `stringifyTimecyc(convertTo24h(…))`
      // of this very `base`, so agreement is a fixture-generation invariant — it catches the generator and
      // the parser drifting apart, and it says NOTHING about parity with the original `timecyc` tool.
      // Its previous name claimed byte-for-byte parity with a reference output; no reference output of
      // this base exists in the repo (plan 104, recon finding 7). The 24h file bundled with
      // `timecycle24.asi` cannot stand in: its own timecyc.dat is stock, but its 24h table is authored,
      // not an expansion of it (20 416 of 26 208 values differ).
      const converted = convertTo24h(parseTimecyc(base));
      const expected = parseTimecyc(day24).slice(0, TIME_WEATHERS * HOURS);
      expect(converted).toEqual(expected);
    });

    it('copies the keyframe hours verbatim (midnight/5am/6am/7am/midday/7pm/8pm/10pm)', () => {
      const k = parseTimecyc(base);
      const h = convertTo24h(k);
      const keyToHour = [
        [0, 0],
        [1, 5],
        [2, 6],
        [3, 7],
        [4, 12],
        [5, 19],
        [6, 20],
        [7, 22],
      ];
      for (const [key, hour] of keyToHour) {
        expect(h[hour]).toEqual(k[key]); // weather 0
      }
    });

    it('interpolates between keyframes (1am = 1/5 from midnight toward 5am)', () => {
      const k = parseTimecyc(base);
      const h = convertTo24h(k);
      const a = k[0][3]; // skyTop.r at midnight
      const b = k[1][3]; // skyTop.r at 5am
      expect(h[1][3]).toBe(Math.trunc((4 / 5) * a + (1 / 5) * b));
    });
  });
});

describe('ensure24h', () => {
  describe('negative cases', () => {
    it('throws on a row count that is neither 24h nor vanilla', () => {
      expect(() => ensure24h([[1], [2], [3]])).toThrow();
    });
  });

  describe('positive cases', () => {
    it('passes an already-24h table through unchanged', () => {
      const rows = parseTimecyc(day24); // 21 × 24 — our generated table omits the 2 extracolour weathers
      expect(ensure24h(rows)).toBe(rows);
    });

    it('passes the Dante 23 × 24 table through unchanged too (both widths are 24h)', () => {
      const rows = parseTimecyc(dante);
      expect(rows).toHaveLength(WEATHER_NAMES.length * HOURS); // 552, not 504
      expect(ensure24h(rows)).toBe(rows);
    });

    it('expands a vanilla 8-keyframe table to 24h (= convertTo24h)', () => {
      const vanilla = parseTimecyc(base); // 23 × 8
      expect(vanilla).toHaveLength(WEATHER_NAMES.length * 8);
      const converted = ensure24h(vanilla);
      expect(converted).toHaveLength(TIME_WEATHERS * HOURS); // 504
      expect(converted).toEqual(convertTo24h(vanilla));
    });
  });
});

describe('stringifyTimecyc', () => {
  describe('positive cases', () => {
    it('exposes a display label per field (aligned 1:1 with FIELDS)', () => {
      expect(FIELD_LABELS).toHaveLength(FIELDS.length);
      expect(FIELD_LABELS.slice(3, 5)).toEqual(['Sky top', 'Sky bot']);
    });

    it('round-trips with parseTimecyc on the real 24h table (parse∘stringify identity)', () => {
      const rows = parseTimecyc(day24);
      expect(parseTimecyc(stringifyTimecyc(rows))).toEqual(rows);
    });

    it('writes the FIELD_LABELS header and only `//` comment lines as non-data', () => {
      const text = stringifyTimecyc(parseTimecyc(day24));
      expect(text).toContain(`// ${FIELD_LABELS.join(' ')}`);
      const nonData = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('//'));
      expect(nonData.every((line) => line.split(/\s+/).filter(Boolean).length === ROW_SIZE)).toBe(true);
    });
  });
});
