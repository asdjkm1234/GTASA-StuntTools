import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildTimecyc, sampleTimecyc } from './timecyc';
import { convertTo24h, ensure24h, parseTimecyc, TIME_WEATHERS } from './timecyc.parser';

const timecyc = buildTimecyc(convertTo24h(parseTimecyc(readFileSync('fixtures/original/data/timecyc.dat', 'utf8'))));

describe('buildTimecyc', () => {
  describe('positive cases', () => {
    it('groups the 21 time weathers, each with 24 hours and a name', () => {
      expect(timecyc.weathers).toHaveLength(TIME_WEATHERS);
      expect(timecyc.weathers[0].name).toBe('EXTRASUNNY_LA');
      expect(timecyc.weathers[0].hours).toHaveLength(24);
    });

    it('keeps 21 weathers from the Dante 23 × 24 table (the extracolours are not time-based)', () => {
      const text = readFileSync('fixtures/original/data/timecyc24h.dat', 'utf8');
      const dante = buildTimecyc(ensure24h(parseTimecyc(text)));

      expect(dante.weathers).toHaveLength(TIME_WEATHERS);
      expect(dante.weathers[TIME_WEATHERS - 1].name).toBe('UNDERWATER');
      expect(dante.weathers[0].hours).toHaveLength(24);
    });
  });
});

describe('sampleTimecyc', () => {
  describe('positive cases', () => {
    it('returns the exact entry on a whole hour (midnight ambient)', () => {
      expect(sampleTimecyc(timecyc, 0, 0).amb).toEqual([22, 22, 22]);
    });

    it('interpolates between hours at a half-hour', () => {
      const h0 = sampleTimecyc(timecyc, 0, 0).amb[0];
      const h1 = sampleTimecyc(timecyc, 0, 1).amb[0];
      expect(sampleTimecyc(timecyc, 0, 0.5).amb[0]).toBeCloseTo((h0 + h1) / 2, 5);
    });

    it('wraps fractional hours past midnight (23.5 blends hour 23 → hour 0)', () => {
      const h23 = sampleTimecyc(timecyc, 0, 23).fogStart;
      const h0 = sampleTimecyc(timecyc, 0, 0).fogStart;
      expect(sampleTimecyc(timecyc, 0, 23.5).fogStart).toBeCloseTo((h23 + h0) / 2, 5);
    });
  });
});
