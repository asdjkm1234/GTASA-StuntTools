import { describe, expect, it } from 'vitest';

import { planTxdDeletions } from './pack-vehicles';

/**
 * The TXD-deletion guard under a PARTIAL convert (`--vehicles`).
 *
 * Converting a subset made "a car that did not convert" an everyday case instead of an error case, and the
 * deletion test is exactly the one that must not be fooled by it: judged against the subset, a dictionary
 * belonging to a car outside the list looks unused and gets erased — a silent no-texture for that car. So
 * `packVehicles` hands this function the WHOLE roster and only `converted` is the subset.
 *
 * No fixtures: this is the pure half, and it is the half that decides what is deleted.
 */
const roster = [
  { model: 'admiral', txd: 'admiral' },
  { model: 'infernus', txd: 'infernus' },
  { model: 'copcarla', txd: 'copcarla' },
];

describe('planTxdDeletions', () => {
  describe('negative cases', () => {
    it('keeps the dictionary of a car that did NOT convert (the --vehicles subset case)', () => {
      const deletes: string[] = [];

      const kept = planTxdDeletions(roster, new Set(['admiral']), deletes);

      expect(deletes).toEqual(['admiral.txd']);
      expect(kept).toEqual(expect.arrayContaining(['infernus', 'copcarla']));
    });

    it('never deletes a SHARED dictionary, even when every car naming it converted', () => {
      const deletes: string[] = [];

      const kept = planTxdDeletions([{ model: 'admiral', txd: 'vehicle' }], new Set(['admiral']), deletes);

      expect(deletes).toEqual([]);
      expect(kept).toEqual(['vehicle']);
    });

    it('keeps a shared-by-two dictionary while either car is unconverted', () => {
      const deletes: string[] = [];
      const shared = [
        { model: 'admiral', txd: 'sedan' },
        { model: 'premier', txd: 'sedan' },
      ];

      expect(planTxdDeletions(shared, new Set(['admiral']), deletes)).toEqual(['sedan']);
      expect(deletes).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('deletes a dictionary once every car naming it has converted', () => {
      const deletes: string[] = [];
      const shared = [
        { model: 'admiral', txd: 'sedan' },
        { model: 'premier', txd: 'sedan' },
      ];

      expect(planTxdDeletions(shared, new Set(['admiral', 'premier']), deletes)).toEqual([]);
      expect(deletes).toEqual(['sedan.txd']);
    });

    it('deletes every dictionary on a FULL convert', () => {
      const deletes: string[] = [];

      const kept = planTxdDeletions(roster, new Set(['admiral', 'copcarla', 'infernus']), deletes);

      expect(kept).toEqual([]);
      expect(deletes).toEqual(['admiral.txd', 'infernus.txd', 'copcarla.txd']);
    });
  });
});
