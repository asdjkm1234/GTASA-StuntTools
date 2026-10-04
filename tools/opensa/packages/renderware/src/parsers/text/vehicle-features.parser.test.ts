import { describe, expect, it } from 'vitest';

import {
  parseVehicleFeatures,
  saAbilitiesOf,
  saCarrierFor,
  UP_DOWN_LIGHTS,
  VEHICLE_FEATURE_TOKENS,
  vehicleFeatureToken,
} from './vehicle-features.parser';

describe('parseVehicleFeatures', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty or comment-only table', () => {
      expect(parseVehicleFeatures('')).toEqual(new Map());
      expect(parseVehicleFeatures('# written by vehicle-installer\n\n')).toEqual(new Map());
    });

    it('skips a model line that declares no feature', () => {
      expect(parseVehicleFeatures('previon\n')).toEqual(new Map());
    });
  });

  describe('positive cases', () => {
    it('reads a model line, lowercasing the model and upper-casing its features', () => {
      const table = parseVehicleFeatures(`Previon ${UP_DOWN_LIGHTS.toLowerCase()}`);

      expect(table.get('previon')).toEqual([UP_DOWN_LIGHTS]);
    });

    it('takes several features per model and drops trailing comments', () => {
      const table = parseVehicleFeatures(`previon ${UP_DOWN_LIGHTS} SOMETHING_ELSE  # a 1986 Starion`);

      expect(table.get('previon')).toEqual([UP_DOWN_LIGHTS, 'SOMETHING_ELSE']);
    });
  });
});

describe('VEHICLE_FEATURE_TOKENS', () => {
  describe('negative cases', () => {
    it('declares no token twice and no carrier under a name the game cannot load', () => {
      const tokens = VEHICLE_FEATURE_TOKENS.map((row) => row.token);

      expect(new Set(tokens).size).toBe(tokens.length);
      for (const { saCarriers, token } of VEHICLE_FEATURE_TOKENS) {
        expect(saCarriers.length, token).toBeGreaterThan(0);
        expect(saCarriers, token).toEqual(saCarriers.map((model) => model.toLowerCase()));
      }
    });
  });

  describe('positive cases', () => {
    it('keeps the live token spelled as the rest of the chain spells it', () => {
      expect(VEHICLE_FEATURE_TOKENS.find((row) => row.token === UP_DOWN_LIGHTS)?.saCarriers).toEqual(['zr350']);
    });
  });
});

describe('vehicleFeatureToken', () => {
  describe('negative cases', () => {
    it('does not recognise a token outside the vocabulary', () => {
      expect(vehicleFeatureToken('SOMETHING_ELSE')).toBeUndefined();
      expect(vehicleFeatureToken('')).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('folds case back onto the vocabulary spelling', () => {
      expect(vehicleFeatureToken('adv_hydralics')).toBe('ADV_HYDRALICs');
      expect(vehicleFeatureToken('ADV_HYDRALICS')).toBe('ADV_HYDRALICs');
    });
  });
});

describe('saAbilitiesOf', () => {
  describe('negative cases', () => {
    it('gives nothing for a model that carries no special ability', () => {
      expect(saAbilitiesOf('admiral')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists every ability one stock model carries, whatever the case of its name', () => {
      expect(saAbilitiesOf('SWATVAN')).toEqual(['TURRETs_1', 'WATER_JETs']);
      expect(saAbilitiesOf('zr350')).toEqual([UP_DOWN_LIGHTS]);
    });
  });
});

describe('saCarrierFor', () => {
  describe('negative cases', () => {
    it('resolves nothing for an empty declaration', () => {
      expect(saCarrierFor([])).toBeNull();
    });

    it('resolves nothing when every declared token is outside the vocabulary', () => {
      expect(saCarrierFor(['SOMETHING_ELSE', 'ANOTHER_ONE'])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('picks the carrier of a single declared ability', () => {
      expect(saCarrierFor([UP_DOWN_LIGHTS])).toEqual({
        covers: [UP_DOWN_LIGHTS],
        dropped: [],
        model: 'zr350',
      });
    });

    it('prefers the one carrier that covers every declared ability', () => {
      expect(saCarrierFor(['TURRETs_1', 'WATER_JETs'])).toEqual({
        covers: ['TURRETs_1', 'WATER_JETs'],
        dropped: [],
        model: 'swatvan',
      });
    });

    it('covers as much as one carrier can and returns the rest as dropped', () => {
      expect(saCarrierFor(['ADV_HYDRALICs', UP_DOWN_LIGHTS])).toEqual({
        covers: ['ADV_HYDRALICs'],
        dropped: [UP_DOWN_LIGHTS],
        model: 'hotknife',
      });
    });

    it('reads the tokens a real declaration carries, upper-cased and deduplicated', () => {
      const declared = parseVehicleFeatures('infernus bf_engine&hydralics BF_ENGINE&HYDRALICS unknown_one');

      expect(saCarrierFor(declared.get('infernus') ?? [])).toEqual({
        covers: ['BF_ENGINE&HYDRALICS'],
        dropped: [],
        model: 'bfinject',
      });
    });
  });
});
