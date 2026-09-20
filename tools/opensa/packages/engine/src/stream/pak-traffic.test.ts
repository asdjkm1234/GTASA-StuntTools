import { describe, expect, it } from 'vitest';

import { kindOfPakKey, PakTraffic, postPakFetch } from './pak-traffic';

/**
 * The bytes column of 201/1-01: what a surface READS out of a pak, against what the build put in it.
 *
 * The value of this table is the GAP, so the two things worth pinning are that a kind nobody requests never
 * appears (an omission candidate must not be invented by the instrument) and that every request goes through
 * the one counted call.
 */
describe('pak traffic', () => {
  describe('negative cases', () => {
    it('reports nothing before anything is read, rather than a table of zeroes', () => {
      const traffic = new PakTraffic();

      expect(traffic.report()).toEqual([]);
      expect(traffic.totalBytes).toBe(0);
      expect(traffic.requests).toBe(0);
    });

    it('never invents a kind for a key it does not recognise — it reports the key itself', () => {
      // An `other` bucket is where a new entry kind goes to be ignored. A pak that grows one should make it
      // appear in the table by name, unread and obvious.
      expect(kindOfPakKey('water.bin')).toBe('water.bin');
      expect(kindOfPakKey('5,-7')).toBe('5,-7');
    });

    it('keeps the LEVELS of a cell apart, because the profile treats them differently', () => {
      expect(kindOfPakKey('5,-7,hd')).toBe('cell-hd');
      expect(kindOfPakKey('5,-7,lod')).toBe('cell-lod');
    });
  });

  describe('positive cases', () => {
    it('sums bytes and requests per kind, descending by bytes', () => {
      const traffic = new PakTraffic();
      traffic.record('array-3', 1_000_000);
      traffic.record('array-4', 500_000);
      traffic.record('5,-7,hd', 200_000);
      traffic.record('5,-7,lod', 20_000);
      traffic.record('collision-5,-7', 9_000);

      expect(traffic.report()).toEqual([
        { bytes: 1_500_000, kind: 'texture-array', requests: 2 },
        { bytes: 200_000, kind: 'cell-hd', requests: 1 },
        { bytes: 20_000, kind: 'cell-lod', requests: 1 },
        { bytes: 9_000, kind: 'collision', requests: 1 },
      ]);
      expect(traffic.totalBytes).toBe(1_729_000);
      expect(traffic.requests).toBe(5);
    });

    it('counts a re-read as a second request — a cell fetched twice cost the network twice', () => {
      const traffic = new PakTraffic();
      traffic.record('5,-7,hd', 100);
      traffic.record('5,-7,hd', 100);

      expect(traffic.report()).toEqual([{ bytes: 200, kind: 'cell-hd', requests: 2 }]);
    });

    it('posts the entry the worker expects and records the same bytes, in one call', () => {
      const posted: unknown[] = [];
      const worker = {
        postMessage(message: unknown): void {
          posted.push(message);
        },
      };

      postPakFetch(worker, 'array-7', { enc: 'deflate-raw', length: 4096, offset: 8192 });

      expect(posted).toEqual([{ enc: 'deflate-raw', key: 'array-7', length: 4096, offset: 8192, type: 'fetch' }]);
    });

    it('omits `enc` entirely for an entry that has none — the worker branches on its absence', () => {
      const posted: { enc?: string }[] = [];
      const worker = {
        postMessage(message: unknown): void {
          posted.push(message as { enc?: string });
        },
      };

      postPakFetch(worker, '5,-7,hd', { length: 10, offset: 0 });

      expect('enc' in posted[0]).toBe(false);
    });
  });
});
