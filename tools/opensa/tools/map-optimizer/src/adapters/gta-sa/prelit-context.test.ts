import { describe, expect, it } from 'vitest';

import type { PrelitFingerprint } from './prelit-context';
import type { Placement } from './resolve';

import { computePrelitContext, parseOnlyList } from './prelit-context';

/** A fingerprint with sane defaults — override what the case needs. */
function print(overrides: Partial<PrelitFingerprint>): PrelitFingerprint {
  return {
    alphaOverloaded: false,
    dayMean: 80,
    dayP50: 80,
    dayP75: 100,
    dayP90: 120,
    dayP95: 140,
    daySpread: 120,
    hasNight: true,
    nightP50: 24,
    nightP75: 32,
    nightP95: 48,
    vertexCount: 200,
    ...overrides,
  };
}

/** A cluster of `n` healthy neighbour models placed around the origin. */
function world(
  n: number,
  subject: PrelitFingerprint,
  subjectName = 'subject',
): {
  fingerprints: Map<string, PrelitFingerprint>;
  placements: Placement[];
} {
  const fingerprints = new Map<string, PrelitFingerprint>([[subjectName, subject]]);
  const placements: Placement[] = [{ modelName: subjectName, position: [0, 0, 0], rotation: [0, 0, 0, 1] }];
  for (let i = 0; i < n; i += 1) {
    const name = `hood${i}`;
    fingerprints.set(name, print({}));
    placements.push({ modelName: name, position: [10 + i * 5, 0, 0], rotation: [0, 0, 0, 1] });
  }

  return { fingerprints, placements };
}

describe('parseOnlyList', () => {
  describe('negative cases', () => {
    it('rejects a non-array root', () => {
      expect(() => parseOnlyList({})).toThrow(/must be a JSON array/);
    });

    it('rejects an object entry without a model name', () => {
      expect(() => parseOnlyList([{ nightMax: 20 }])).toThrow(/needs a non-empty string "model"/);
    });

    it('rejects an unknown key (the "nigthMax" typo class)', () => {
      expect(() => parseOnlyList([{ model: 'x', nigthMax: 20 }])).toThrow(/unknown key "nigthMax"/);
    });

    it('rejects a non-numeric correction value', () => {
      expect(() => parseOnlyList([{ model: 'x', nightMax: '20' }])).toThrow(/"nightMax" must be a number/);
    });
  });

  describe('positive cases', () => {
    it('accepts a mix of bare names and explicit entries', () => {
      expect(parseOnlyList(['a', { model: 'b', nightMax: 20 }, { dayShift: -30, model: 'c' }])).toEqual([
        'a',
        { model: 'b', nightMax: 20 },
        { dayShift: -30, model: 'c' },
      ]);
    });
  });
});

describe('computePrelitContext', () => {
  describe('negative cases', () => {
    it('leaves a model alone when the neighbourhood is too small (noContext)', () => {
      const { fingerprints, placements } = world(3, print({ dayP50: 10 })); // dark, but only 3 neighbours
      const result = computePrelitContext(fingerprints, placements, { minHoodModels: 5 });

      expect(result.verdicts.has('subject')).toBe(false);
      expect(result.stats.noContext).toBe(4); // stats cover every model — the 3 hoods lack context too
    });

    it('leaves a statistically normal model alone (lit-canopy case: aggregates in line, bright tail)', () => {
      // laepetrol1a profile: day median == hood, ratio == hood — the lit canopy is only a p90 tail.
      const { fingerprints, placements } = world(8, print({ nightP95: 200 }));
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.has('subject')).toBe(false);
      expect(result.stats.ok).toBe(9); // subject + the 8 healthy hood models
    });

    it('skips night synthesis for alpha-overloaded models', () => {
      const subject = print({ alphaOverloaded: true, hasNight: false, nightP50: 0 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.get('subject')?.night).toBeUndefined();
    });

    it('never lowers a structured model brighter than the hood (Ganton case: sunlit roads are design)', () => {
      // lae2_roads profile: day median 125 vs hood 80, healthy spread — baked sunlight, not damage.
      const subject = print({ dayP50: 125, dayP75: 160, dayP95: 200 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.get('subject')?.level).toBeUndefined();
      expect(result.stats.lowerDay).toBe(0);
    });

    it('leaves a fullbright flat sprite alone (gang-tag case: flat 255 is emissive design)', () => {
      const subject = print({ dayMean: 255, dayP50: 255, dayP75: 255, dayP95: 255, daySpread: 0 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.get('subject')?.level).toBeUndefined();
      expect(result.stats.flat).toBe(0);
    });

    it('leaves a glowing night set alone when the day side is healthy (street-lamp / lantern case)', () => {
      // A lamp: day median matches the hood, night glows way above the hood ratio — lighting design.
      const subject = print({ nightP50: 64 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.get('subject')?.night).toBeUndefined();
      expect(result.stats.repairNight).toBe(0);
    });

    it('never brightens a too-dark night set (Idlewood case: houses with the lights off are design)', () => {
      // A black night set (p50 0) vs hood ratio 0.3 — the old two-sided repair exploded this to ×42 / 255.
      const subject = print({ nightP50: 0, nightP75: 0, nightP95: 4 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);

      expect(result.verdicts.get('subject')?.night).toBeUndefined();
      expect(result.stats.repairNight).toBe(0);
    });
  });

  describe('only-mode (user-curated list)', () => {
    it('warns about a curated name that matches no placed prelit model (typo)', () => {
      const { fingerprints, placements } = world(8, print({}));
      const result = computePrelitContext(fingerprints, placements, {
        exclude: ['ghost_model'],
        only: ['subject', 'newvic1_sfvv'],
      });

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain('newvic1_sfvv');
      expect(result.warnings[1]).toContain('ghost_model');
    });

    it('skips every model not on the list, even clear outliers', () => {
      const subject = print({ dayP50: 10 }); // would be lifted in normal mode
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements, { only: ['some_other_model'] });

      expect(result.verdicts.size).toBe(0);
    });

    it('corrects a listed glowing-night model even without day evidence (the human IS the evidence)', () => {
      // The chinatown-facade case: healthy day, night ratio 0.8 vs hood 0.3 — normal mode skips it.
      const subject = print({ nightP50: 64 });
      const { fingerprints, placements } = world(8, subject);
      const night = computePrelitContext(fingerprints, placements, { only: ['subject'] }).verdicts.get(
        'subject',
      )?.night;

      expect(night?.kind).toBe('repair');
      if (night?.kind === 'repair') {
        expect(night.scale).toBeCloseTo((0.3 * 80) / 64, 2);
      }
    });

    it("still never brightens a listed model's dark night set (the ×42 lesson holds)", () => {
      const subject = print({ nightP50: 0, nightP75: 0, nightP95: 4 });
      const { fingerprints, placements } = world(8, subject);
      const night = computePrelitContext(fingerprints, placements, { only: ['subject'] }).verdicts.get(
        'subject',
      )?.night;

      expect(night).toBeUndefined();
    });

    it('an explicit nightScale entry scales the whole set with the tail guard disarmed (newvic1 case)', () => {
      // Glow lives in the p95 tail; median is dark — auto repair can't reach it, the manual scale must.
      const subject = print({ nightP50: 19, nightP75: 57, nightP95: 114 });
      const { fingerprints, placements } = world(8, subject);
      const night = computePrelitContext(fingerprints, placements, {
        only: [{ model: 'subject', nightScale: 0.4 }],
      }).verdicts.get('subject')?.night;

      expect(night).toEqual({ kind: 'repair', protectFrom: 256, protectTo: 256, scale: 0.4 });
    });

    it('an explicit entry works without hood context and touches only what it specifies', () => {
      const subject = print({ dayP50: 200 });
      const { fingerprints, placements } = world(0, subject); // no neighbours at all
      const result = computePrelitContext(fingerprints, placements, {
        only: [{ model: 'subject', nightScale: 0.5 }],
      });

      expect(result.verdicts.get('subject')?.night?.kind).toBe('repair');
      expect(result.verdicts.get('subject')?.level).toBeUndefined(); // day untouched — no dayShift given
    });

    it('an explicit nightMax caps the glow and wins over nightScale (newvic1 lesson: keep the walls)', () => {
      const subject = print({ nightP50: 19, nightP75: 57, nightP95: 114 });
      const { fingerprints, placements } = world(8, subject);
      const night = computePrelitContext(fingerprints, placements, {
        only: [{ model: 'subject', nightMax: 64, nightScale: 0.4 }],
      }).verdicts.get('subject')?.night;

      expect(night).toEqual({ kind: 'cap', max: 64 });
    });

    it('an explicit nightScale on a night-less model synthesizes day × scale', () => {
      const subject = print({ hasNight: false, nightP50: 0, nightP75: 0, nightP95: 0 });
      const { fingerprints, placements } = world(8, subject);
      const night = computePrelitContext(fingerprints, placements, {
        only: [{ model: 'subject', nightScale: 0.4 }],
      }).verdicts.get('subject')?.night;

      expect(night).toEqual({ kind: 'synthesize', ratio: 0.4 });
    });
  });

  describe('force-list (statistical pass + curated extras)', () => {
    it('keeps the statistical fixes for unlisted models AND forces the listed one', () => {
      // Subject = the street-lamp class (healthy day, glowing night) that the normal pass protects.
      const subject = print({ nightP50: 64 });
      const { fingerprints, placements } = world(8, subject);
      fingerprints.set('dark_outlier', print({ dayP50: 10 }));
      placements.push({ modelName: 'dark_outlier', position: [15, 5, 0], rotation: [0, 0, 0, 1] });
      const result = computePrelitContext(fingerprints, placements, { force: ['subject'] });

      expect(result.verdicts.get('subject')?.night?.kind).toBe('repair'); // forced past the day-evidence guard
      expect(result.verdicts.get('dark_outlier')?.level?.shift).toBeGreaterThan(0); // statistics still run
    });

    it('applies an explicit force entry (nightMax) while the rest of the map streams through normally', () => {
      const subject = print({ nightP50: 19, nightP75: 57, nightP95: 114 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements, {
        force: [{ model: 'subject', nightMax: 20 }],
      });

      expect(result.verdicts.get('subject')?.night).toEqual({ kind: 'cap', max: 20 });
      expect(result.stats.ok).toBeGreaterThan(0); // the hood models were judged (and passed) statistically
    });

    it('only-mode wins over force when both are given', () => {
      const { fingerprints, placements } = world(8, print({ dayP50: 10 }));
      const result = computePrelitContext(fingerprints, placements, {
        force: ['subject'],
        only: ['some_other_model'],
      });

      expect(result.verdicts.size).toBe(0); // only-mode excluded everything, force ignored
    });
  });

  describe('positive cases', () => {
    it('lifts a dark outlier hard to the hood median (clubgate case)', () => {
      const subject = print({ dayP50: 27, nightP50: 21 }); // hood day median is 80
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);
      const verdict = result.verdicts.get('subject');

      expect(result.stats.liftDay).toBe(1);
      expect(verdict?.level?.shift).toBe(80 - 27);
    });

    it('levels a flat model and marks it for the AO rebake (project2 case)', () => {
      const subject = print({ dayP50: 114, daySpread: 0 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);
      const verdict = result.verdicts.get('subject');

      expect(result.stats.flat).toBe(1);
      expect(verdict?.flat).toBe(true);
      expect(verdict?.level?.shift).toBe(80 - 114);
    });

    it('repairs (darkens) a glowing night set when the day side is also broken (corroborated)', () => {
      // Day is a dark outlier (lifted 27 → 80, the day evidence); corrected ratio 64/80 = 0.8 vs hood 0.3.
      const subject = print({ dayP50: 27, nightP50: 64 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);
      const night = result.verdicts.get('subject')?.night;

      expect(result.stats.repairNight).toBe(1);
      expect(night?.kind).toBe('repair');
      if (night?.kind === 'repair') {
        expect(night.scale).toBeCloseTo((0.3 * 80) / 64, 2); // pull the median to the hood ratio
      }
    });

    it('synthesizes a missing night set at the hood ratio (not a global scale)', () => {
      const subject = print({ hasNight: false, nightP50: 0, nightP75: 0, nightP95: 0 });
      const { fingerprints, placements } = world(8, subject);
      const result = computePrelitContext(fingerprints, placements);
      const night = result.verdicts.get('subject')?.night;

      expect(result.stats.synthesizeNight).toBe(1);
      expect(night?.kind).toBe('synthesize');
      if (night?.kind === 'synthesize') {
        expect(night.ratio).toBeCloseTo(0.3, 2);
      }
    });

    it('caps a synthesized night at maxSynthRatio in a brightly-lit hood', () => {
      const subject = print({ hasNight: false, nightP50: 0, nightP75: 0, nightP95: 0 });
      const { fingerprints, placements } = world(8, subject);
      for (const [name, fingerprint] of fingerprints) {
        if (name !== 'subject') {
          fingerprint.nightP50 = 56; // hood ratio 56/80 = 0.7 — streetlit ground sheets
        }
      }
      const night = computePrelitContext(fingerprints, placements).verdicts.get('subject')?.night;

      expect(night?.kind).toBe('synthesize');
      if (night?.kind === 'synthesize') {
        expect(night.ratio).toBeCloseTo(0.35, 2);
      }
    });
  });
});
