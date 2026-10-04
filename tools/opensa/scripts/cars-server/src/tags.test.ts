import { describe, expect, it } from 'vitest';

import { vehicleTags } from './tags';

const folder = (slot: string, entries: readonly string[], hasCleo = false): Parameters<typeof vehicleTags>[0] => ({
  entries,
  hasCleo,
  slot,
});

describe('vehicleTags', () => {
  describe('negative cases', () => {
    it('gives a plain model swap no tags at all', () => {
      expect(vehicleTags(folder('admiral', ['admiral.dff', 'admiral.txd', 'admiral.settings.txt']), {})).toEqual([]);
    });

    it('does not call the universal nitro upgrades tuning — every tunable stock car has them', () => {
      expect(vehicleTags(folder('alpha', ['alpha.dff']), { carmodsLine: 'alpha, nto_b_l, nto_b_s, nto_b_tw' })).toEqual(
        [],
      );
    });

    it('reads a 2-value carcols line as the plain car section, not car4', () => {
      expect(vehicleTags(folder('alpha', ['alpha.dff']), { carcolsLine: 'alpha, 0,102, 79,25, 51,104' })).toEqual([]);
    });

    it("does not count another model's numbered txd as a paint job", () => {
      expect(vehicleTags(folder('alpha', ['alpha.dff', 'elegy1.txd']), {})).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('counts the numbered txds as paint jobs (the real alpha ships four)', () => {
      const entries = ['alpha.dff', 'alpha.txd', 'alpha1.txd', 'alpha2.txd', 'alpha3.txd', 'alpha4.txd'];

      expect(vehicleTags(folder('alpha', entries), {})).toEqual(['4 Paint Jobs']);
    });

    it('singularises one paint job', () => {
      expect(vehicleTags(folder('alpha', ['alpha.dff', 'alpha1.txd']), {})).toEqual(['1 Paint Job']);
    });

    it('reads a 4-value carcols line as car4 support', () => {
      expect(vehicleTags(folder('banshee', ['banshee.dff']), { carcolsLine: 'banshee, 1,31,1,0, 2,2,2,0' })).toEqual([
        'Car4 Supported',
      ]);
    });

    it('names the palette a mod appends', () => {
      expect(
        vehicleTags(folder('boxville', ['boxville.dff']), {
          palette: [{ line: '233,199,40  # new1 yellow', name: 'new1' }],
        }),
      ).toEqual(['New Colors']);
    });

    it('names a shipped cleo script', () => {
      expect(vehicleTags(folder('bus', ['bus.dff'], true), {})).toEqual(['Has Cleo Script']);
    });

    it('lists a tuned car in the stated order (the real blade)', () => {
      const entries = ['blade.dff', 'exh_lr_bl1.dff', 'blade.txd', 'blade1.txd', 'blade2.txd'];
      const settings = {
        carcolsLine: 'blade, 1,31,1,0, 2,2,2,0',
        carmodsLine: 'blade, exh_lr_bl1, nto_b_l, nto_b_s',
      };

      expect(vehicleTags(folder('blade', entries), settings)).toEqual([
        'Tuning',
        'New Tuning Parts',
        '2 Paint Jobs',
        'Car4 Supported',
      ]);
    });
  });
});
