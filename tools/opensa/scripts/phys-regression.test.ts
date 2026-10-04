import { describe, expect, it } from 'vitest';

import type { Capture } from './lib/phys-captures';

import { breaches } from './phys-regression';

/** A capture carrying nothing but the summary the bands read — the series plays no part in the gate. */
function capture(key: string, summary: Record<string, unknown>): Capture {
  return { car: 'infernus', columns: [], key, series: [], summary };
}

function labels(reference: Capture, candidate: Capture): string[] {
  return breaches(reference, candidate).map((breach) => breach.label);
}

describe('phys-regression breaches', () => {
  describe('negative cases', () => {
    it('reports a signal that moved beyond its band', () => {
      const before = capture('u-turn', { turnedDeg: 100 });
      const after = capture('u-turn', { turnedDeg: 130 });

      expect(breaches(before, after)).toEqual([{ after: 130, band: 8, before: 100, label: 'turnedDeg' }]);
    });

    it('reports a signal the fresh sweep no longer carries', () => {
      const before = capture('brake-strip', { brake: { distanceM: 60 } });
      const after = capture('brake-strip', { brake: null });

      expect(breaches(before, after)).toEqual([{ after: null, band: null, before: 60, label: 'brake.distanceM' }]);
    });

    it('reports a lap that stopped flipping — the reference had one and the fresh run does not', () => {
      const before = capture('slalom', { flip: { atKmh: 90, atS: 6.2 } });
      const after = capture('slalom', { flip: null });

      expect(labels(before, after)).toEqual(['flip.atKmh', 'flip.atS']);
    });

    it('does not lend a scene that stays on the road the widening of one that leaves it', () => {
      const before = capture('handbrake-flick', { rollDeg: { max: 40 } });
      const after = capture('handbrake-flick', { rollDeg: { max: 48 } }); // inside `slalom`'s 10°, not this

      expect(labels(before, after)).toEqual(['rollDeg.max']);
    });

    it('reports a sweep driven with different dials as a configuration difference', () => {
      const before = { ...capture('sweeper', {}), speedGrip: { cap: 3, reference: 12 } };
      const after = { ...capture('sweeper', {}), speedGrip: { cap: 3, reference: 20 } };

      expect(labels(before, after)).toEqual(['config.speedGrip.reference']);
    });

    it('reports a sweep flown with different AIR CONTROL as a configuration difference', () => {
      const before = { ...capture('crest-jump', {}), airControl: { scale: 1 } };
      const after = { ...capture('crest-jump', {}), airControl: { scale: 0 } };

      expect(labels(before, after)).toEqual(['config.airControl.scale']);
    });

    it('reports a spring the fresh run set differently', () => {
      const before = { ...capture('rest', {}), springs: [{ stiffness: 24.96 }] };
      const after = { ...capture('rest', {}), springs: [{ stiffness: 30 }] };

      expect(labels(before, after)).toEqual(['config.springs[0].stiffness']);
    });

    it('reports a car that now stands differently, which no summary signal shows', () => {
      const before = { ...capture('rest', {}), stance: { wheels: [{ contact: true, suspensionLength: 0.0194 }] } };
      const after = { ...capture('rest', {}), stance: { wheels: [{ contact: true, suspensionLength: 0.05 }] } };

      expect(labels(before, after)).toEqual(['config.stance.wheels[0].suspensionLength']);
    });
  });

  describe('positive cases', () => {
    it('passes a lap that replayed itself', () => {
      const lap = capture('sweeper', { gLat: { max: 8.1, min: -2 }, slipMaxDeg: 28.28, topSpeedKmh: 113.44 });

      expect(breaches(lap, lap)).toEqual([]);
    });

    it('passes a move inside the band', () => {
      const before = capture('brake-strip', { timeTo100S: 5.43, topSpeedKmh: 126.39 });
      const after = capture('brake-strip', { timeTo100S: 5.5, topSpeedKmh: 128 });

      expect(breaches(before, after)).toEqual([]);
    });

    it('scales a relative band with the reference value', () => {
      const before = capture('brake-strip', { topSpeedKmh: 296 });
      const after = capture('brake-strip', { topSpeedKmh: 301 }); // 5 km/h < 2 % of 296

      expect(breaches(before, after)).toEqual([]);
    });

    it('says nothing about a field the pack predates — a new signal is not a regression', () => {
      const before = capture('rest', { topSpeedKmh: 0 });
      const after = capture('rest', { surfaces: { tarmac: 1 }, topSpeedKmh: 0 });

      expect(breaches(before, after)).toEqual([]);
    });

    it('lets a chaotic scene move where its widening allows', () => {
      const before = capture('slalom', { rollDeg: { max: 43.21 } });
      const after = capture('slalom', { rollDeg: { max: 51 } });

      expect(breaches(before, after)).toEqual([]);
    });
  });
});
