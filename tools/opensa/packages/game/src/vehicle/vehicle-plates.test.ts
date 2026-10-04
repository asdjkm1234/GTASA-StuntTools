import { describe, expect, it } from 'vitest';

import type { CityBox } from '../zones/city';
import type { PlateMasks, PlatePlacement } from './vehicle-plates';

import { resolvePlate } from './vehicle-plates';

const MASKS: PlateMasks = { la: 'LLDD DLL', sf: 'DDLL LDD', vegas: 'LLLL DDDD' };

const BOXES: CityBox[] = [
  { city: 'LA', max: [1000, 1000], min: [0, 0] },
  { city: 'SF', max: [-1000, 1000], min: [-2000, 0] },
  { city: 'VEGAS', max: [3000, 1000], min: [2000, 0] },
];

const at = (x: number, y: number, z = 5, model = 'admiral'): PlatePlacement => ({ model, position: [x, y, z] });

describe('resolvePlate', () => {
  describe('negative cases', () => {
    it('does not take the plate from the player — the CAR position decides', () => {
      // Same model, two cities: a far-streamed SF car must not wear the plate of wherever the player is.
      expect(resolvePlate(at(500, 500), MASKS, BOXES).city).toBe('LA');
      expect(resolvePlate(at(-1500, 500), MASKS, BOXES).city).toBe('SF');
    });

    it('does not re-roll when a ground snap nudges the spawn by a fraction of a centimetre', () => {
      const snapped = resolvePlate(at(500, 500, 5.0000001), MASKS, BOXES);

      expect(snapped.text).toBe(resolvePlate(at(500, 500, 5), MASKS, BOXES).text);
    });

    it('gives two cars at different spots different plates', () => {
      expect(resolvePlate(at(500, 500), MASKS, BOXES).text).not.toBe(resolvePlate(at(600, 500), MASKS, BOXES).text);
    });
  });

  describe('positive cases', () => {
    it('is deterministic: the same placement always resolves to the same plate', () => {
      expect(resolvePlate(at(500, 500), MASKS, BOXES)).toEqual(resolvePlate(at(500, 500), MASKS, BOXES));
    });

    it('applies the mask of the city the car spawned in', () => {
      expect(resolvePlate(at(500, 500), MASKS, BOXES).text).toMatch(/^[A-Z]{2}\d{2} \d[A-Z]{2}$/); // la
      expect(resolvePlate(at(-1500, 500), MASKS, BOXES).text).toMatch(/^\d{2}[A-Z]{2} [A-Z]\d{2}$/); // sf
      expect(resolvePlate(at(2500, 500), MASKS, BOXES).text).toMatch(/^[A-Z]{4} \d{3}$/); // vegas, cut to 8
    });

    it('picks a city stably outside every box, and not always the same one', () => {
      const outside = [at(9000, 9000), at(9100, 9000), at(9200, 9000), at(9300, 9000), at(9400, 9000)];
      const cities = outside.map((placement) => resolvePlate(placement, MASKS, BOXES).city);

      // Stable per placement...
      for (const placement of outside) {
        expect(resolvePlate(placement, MASKS, BOXES).city).toBe(resolvePlate(placement, MASKS, BOXES).city);
      }
      // ...but a country road shows a MIX, not one city's plates on every car.
      expect(new Set(cities).size).toBeGreaterThan(1);
    });

    it('lets an explicit plate win over the hash', () => {
      expect(resolvePlate({ ...at(500, 500), plate: 'OPENSA 1' }, MASKS, BOXES).text).toBe('OPENSA 1');
    });

    it('gives two models at the same spot different plates', () => {
      const admiral = resolvePlate(at(500, 500, 5, 'admiral'), MASKS, BOXES);
      const cheetah = resolvePlate(at(500, 500, 5, 'cheetah'), MASKS, BOXES);

      expect(admiral.text).not.toBe(cheetah.text);
    });

    it('falls back to the game default when a city mask is empty', () => {
      const empty: PlateMasks = { la: '', sf: '', vegas: '' };

      expect(resolvePlate(at(500, 500), empty, BOXES).text).toMatch(/^[A-Z]{2}\d{2} \d[A-Z]{2}$/);
    });
  });
});
