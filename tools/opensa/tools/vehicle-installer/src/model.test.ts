import { describe, expect, it } from 'vitest';

import { resolveVehicleModel } from './model';

/** The real `voodoo` folder's shape: a bodykit whose parts sort BEFORE the car. */
const VOODOO_BODYKIT = ['bbb_lr_slv1.dff', 'fbb_lr_slv2.dff', 'voodoo.dff', 'voodoo.txd', 'voodoo.settings.txt'];

describe('resolveVehicleModel', () => {
  describe('negative cases', () => {
    it('has no model when the folder ships no dff at all', () => {
      expect(resolveVehicleModel('admiral - 1976 Mercedes-Benz 230 - k1real24', ['readme.txt'])).toEqual({});
    });

    it('falls back to the first dff when the folder claims a slot it does not ship, and says so', () => {
      const { model, warning } = resolveVehicleModel('admiral - a car - author', ['blista.dff', 'blista.txd']);

      expect(model).toBe('blista');
      expect(warning).toMatch(/claims the slot 'admiral' but no 'admiral.dff' ships in it/);
    });
  });

  describe('positive cases', () => {
    it('takes the slot the folder name states', () => {
      expect(
        resolveVehicleModel('admiral - 1976 Mercedes-Benz 230 - k1real24', ['admiral.dff', 'admiral.txd']),
      ).toEqual({ model: 'admiral' });
    });

    it('takes the car out of a bodykit folder whose parts sort first', () => {
      expect(resolveVehicleModel('voodoo - 1960 Chevrolet Impala - chezy', VOODOO_BODYKIT)).toEqual({
        model: 'voodoo',
      });
    });

    it('matches case-insensitively, both sides', () => {
      expect(resolveVehicleModel('Voodoo - 1960 Chevrolet Impala - chezy', ['VOODOO.DFF'])).toEqual({
        model: 'voodoo',
      });
    });

    it('reads a folder named by the slot alone', () => {
      expect(resolveVehicleModel('admiral', ['admiral.dff'])).toEqual({ model: 'admiral' });
    });
  });
});
