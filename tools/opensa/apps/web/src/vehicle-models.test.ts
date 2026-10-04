import { describe, expect, it } from 'vitest';

import { modCarSlots, roadCarModels, vehicleModelsFromIde } from './vehicle-models';

const fs = (text: null | string): { getText: () => null | string } => ({ getText: () => text });

/** A filesystem that answers for a fixed set of present files — what a build does or does not carry. */
const fsWith = (
  text: null | string,
  present: readonly string[] = [],
): { getText: () => null | string; has: (name: string) => boolean } => ({
  getText: () => text,
  has: (name) => present.includes(name),
});

const IDE = `cars
400, landstal, landstal, car, LANDSTAL, LANDSTAL, x, ignore, 7, 0, 0, -1, 0.8, 0.8, -1
402, Buffalo, buffalo, car, BUFFALO, BUFFALO, x, ignore, 7, 0, 0, -1, 0.7, 0.7, -1
end`;

/** One of each kind a scene must not put a driver in, plus a car it may. */
const MIXED_IDE = `cars
400, landstal, landstal, car, LANDSTAL, LANDSTAL, x, ignore, 7, 0, 0, -1, 0.8, 0.8, -1
446, squalo, squalo, boat, SQUALO, SQUALO, x, ignore, 7, 0, 0, -1, 0.7, 0.7, -1
511, beagle, beagle, plane, BEAGLE, BEAGLE, x, ignore, 7, 0, 0, -1, 0.7, 0.7, -1
462, faggio, faggio, bike, FAGGIO, FAGGIO, x, ignore, 7, 0, 0, -1, 0.7, 0.7, -1
end`;

describe('vehicleModelsFromIde', () => {
  describe('negative cases', () => {
    it('returns empty when vehicles.ide is absent', () => {
      expect(vehicleModelsFromIde(fs(null))).toEqual([]);
    });

    it('returns empty for a vehicles.ide with no cars', () => {
      expect(vehicleModelsFromIde(fs('cars\nend'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists every cars-section model, lowercased and sorted', () => {
      expect(vehicleModelsFromIde(fs(IDE))).toEqual(['buffalo', 'landstal']);
    });
  });
});

describe('roadCarModels', () => {
  describe('negative cases', () => {
    it('returns empty when vehicles.ide is absent', () => {
      expect(roadCarModels(fsWith(null, ['landstal.osm']))).toEqual([]);
    });

    it('drops a car the build carries no model for — that slot throws at spawn, it does not skip', () => {
      expect(roadCarModels(fsWith(IDE, ['landstal.osm']))).toEqual(['landstal']);
    });

    it('drops every type that is not a road car', () => {
      // A showcase drive needs a car: a boat, a plane and a bike are all in the same roster and none of them
      // can be driven down a route out of the vehicle path graph.
      const present = ['landstal.osm', 'squalo.osm', 'beagle.osm', 'faggio.osm'];

      expect(roadCarModels(fsWith(MIXED_IDE, present))).toEqual(['landstal']);
    });
  });

  describe('positive cases', () => {
    it('lists the present road cars, lowercased and sorted', () => {
      expect(roadCarModels(fsWith(IDE, ['buffalo.osm', 'landstal.osm']))).toEqual(['buffalo', 'landstal']);
    });
  });
});

describe('modCarSlots', () => {
  describe('negative cases', () => {
    it('reads an absent ledger as no mod cars, never as an error', () => {
      // A game built before the installer wrote one, or with no vehicle mods at all: the car pick simply has
      // nothing to prefer, and every scene takes a stock car.
      expect(modCarSlots(fs(null))).toEqual(new Set());
    });
  });

  describe('positive cases', () => {
    it('reads the slots the installer wrote, comments and all', () => {
      expect(modCarSlots(fs('# written by vehicle-installer\nPrevion\ninfernus  # a Starion\n'))).toEqual(
        new Set(['infernus', 'previon']),
      );
    });
  });
});
