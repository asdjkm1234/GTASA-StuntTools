import { describe, expect, it } from 'vitest';

import {
  describeTimecycSource,
  resolveTimecycSource,
  resolveTimecycSourceAsync,
  TIMECYC_SOURCES,
} from './timecyc-source';

/** A game dir holding exactly `present`, read the way each loader reads it. */
const dir =
  (present: Record<string, string>) =>
  (path: string): null | string =>
    present[path] ?? null;

describe('resolveTimecycSource', () => {
  describe('negative cases', () => {
    it('returns null when the game dir carries none of the three names', () => {
      expect(resolveTimecycSource(dir({}))).toBeNull();
    });

    it('does not match a misspelled name — it falls through silently', () => {
      expect(resolveTimecycSource(dir({ 'data/timecyc-24h.dat': 'rows' }))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('prefers the authored 24h table over both other names', () => {
      const source = resolveTimecycSource(
        dir({ 'data/timecyc24h.dat': 'dante', 'data/timecyc.dat': 'stock', 'data/timecyc_24h.dat': 'authored' }),
      );

      expect(source).toEqual({ kind: 'authored-24h', path: 'data/timecyc_24h.dat', text: 'authored' });
    });

    it('takes the Dante table when no authored one is present', () => {
      const source = resolveTimecycSource(dir({ 'data/timecyc24h.dat': 'dante', 'data/timecyc.dat': 'stock' }));

      expect(source).toEqual({ kind: 'dante-24h', path: 'data/timecyc24h.dat', text: 'dante' });
    });

    it('falls back to the mandatory stock table', () => {
      expect(resolveTimecycSource(dir({ 'data/timecyc.dat': 'stock' }))?.kind).toBe('stock');
    });

    it('resolves the same order asynchronously', async () => {
      const present = { 'data/timecyc24h.dat': 'dante', 'data/timecyc.dat': 'stock' };
      const source = await resolveTimecycSourceAsync((path) => Promise.resolve(dir(present)(path)));

      expect(source).toEqual({ kind: 'dante-24h', path: 'data/timecyc24h.dat', text: 'dante' });
    });

    it('reports the winner with its kind and row count', () => {
      const source = resolveTimecycSource(dir({ 'data/timecyc24h.dat': '// header\n1 2 3\n4 5 6\n' }));

      expect(describeTimecycSource(source)).toBe('data/timecyc24h.dat (dante-24h, 2 rows)');
    });

    it('names the three it looked for when the world carries none', () => {
      expect(describeTimecycSource(null)).toBe('none of data/timecyc_24h.dat / data/timecyc24h.dat / data/timecyc.dat');
    });

    it('lists the three names in preference order', () => {
      expect(TIMECYC_SOURCES.map((c) => c.path)).toEqual([
        'data/timecyc_24h.dat',
        'data/timecyc24h.dat',
        'data/timecyc.dat',
      ]);
    });
  });
});
