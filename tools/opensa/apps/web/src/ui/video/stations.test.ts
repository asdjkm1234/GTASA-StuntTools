import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import type { StationProbes } from './stations';

import {
  createSurvey,
  predictAlong,
  STATION_LATERALS,
  stationCandidates,
  stepSurvey,
  SURVEY_DEFAULTS,
  WALK_STATION_LATERALS,
  WALK_SURVEY_DEFAULTS,
  windowSamples,
} from './stations';

/** A straight road along GTA +Y at z = 10, 2 m between vertices, driven at 12 m/s. */
const straightRoute = (points = 60, speed = 12): { position: [number, number, number]; speed: number }[] =>
  Array.from({ length: points }, (_unused, at) => ({
    position: [100, 200 + at * 2, 10] as [number, number, number],
    speed,
  }));

/** Probes that see a flat world at z = 10 and nothing in the way. */
const openWorld: StationProbes = { groundBelow: () => 10, pathClear: () => true };

/** Probes with ground everywhere and a wall down ONE side of the road (the side is chosen per test). */
const walledSide = (side: number): StationProbes => ({
  groundBelow: () => 10,
  pathClear: (from) => Math.sign(from[0] - 100) !== side,
});

describe('predictAlong', () => {
  describe('negative cases', () => {
    it('stops at the end of the line instead of running past it', () => {
      const route = straightRoute(10); // 18 m of road at 12 m/s = 1.5 s

      const { index, position } = predictAlong(route, 0, 30);

      expect(index).toBe(9);
      expect(position[1]).toBe(218);
    });

    it('answers with the current point for a zero horizon', () => {
      expect(predictAlong(straightRoute(), 4, 0).position[1]).toBe(208);
    });
  });

  describe('positive cases', () => {
    it('walks the route at its OWN per-vertex speeds', () => {
      const route = straightRoute();

      // 12 m/s for 3 s = 36 m from the start = 18 vertices along.
      const { index, position } = predictAlong(route, 0, 3);

      expect(position[1]).toBeCloseTo(236, 6);
      expect(index).toBeCloseTo(18, 6);
    });

    it('slows the prediction where the route slows down', () => {
      const slow = straightRoute().map((point, at) => ({ ...point, speed: at < 10 ? 4 : 12 }));

      // 20 m of road at 4 m/s eats the whole 3 s window plus a little.
      expect(predictAlong(slow, 0, 3).position[1]).toBeLessThan(224);
    });

    it('shortens the horizon by the speed the car is ACTUALLY keeping', () => {
      const route = straightRoute();

      // Three seconds at 12 m/s is 36 m; a car holding 85 % of target covers 30.6 m of it.
      expect(predictAlong(route, 0, 3, 0.85).position[1]).toBeCloseTo(200 + 30.6, 6);
    });

    it('starts from a FRACTIONAL index — the car is between vertices, not on one', () => {
      const route = straightRoute();

      expect(predictAlong(route, 2.5, 1).position[1]).toBeCloseTo(205 + 12, 6);
    });
  });
});

describe('stationCandidates', () => {
  describe('negative cases', () => {
    it('offers nothing for a line that is a single point', () => {
      expect(stationCandidates([{ position: [0, 0, 0] }], 0, mulberry32(1))).toEqual([]);
    });

    it('never stands a camera on the driven line itself', () => {
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(3));
      const onTheLine = candidates.filter((candidate) => Math.abs(candidate.position[0] - 100) < 1);

      expect(onTheLine).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('uses both sides and only the offsets the table allows', () => {
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(3));
      const offsets = [...new Set(candidates.map((candidate) => Math.abs(candidate.lateral)))].sort((a, b) => a - b);

      expect(offsets).toEqual([...STATION_LATERALS]);
      expect(candidates.some((candidate) => candidate.lateral > 0)).toBe(true);
      expect(candidates.some((candidate) => candidate.lateral < 0)).toBe(true);
    });

    it("takes the caller's own offsets when it is given a set — the walk scene's tripods (096/07)", () => {
      // A person filmed from 8-18 m of pavement is already a wide shot, and the far offsets would put the
      // tripod through the buildings the pavement runs along.
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(3), WALK_STATION_LATERALS);
      const offsets = [...new Set(candidates.map((candidate) => Math.abs(candidate.lateral)))].sort((a, b) => a - b);

      expect(offsets).toEqual([...WALK_STATION_LATERALS]);
      // The two sets meet at 8 m and go opposite ways from it: the walk set's WIDEST stand is the driving
      // set's closest, and it reaches in to 2.5 m where a car never would.
      expect(Math.max(...offsets)).toBeLessThanOrEqual(Math.min(...STATION_LATERALS));
      expect(Math.min(...offsets)).toBeLessThan(Math.min(...STATION_LATERALS));
    });

    it('measures the offset off the ROAD, whichever way the road runs', () => {
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(3));
      // The road runs along +Y, so its sides are ±X, and each candidate sits at exactly its own offset.
      for (const candidate of candidates) {
        expect(candidate.position[0] - 100).toBeCloseTo(candidate.lateral, 6);
        expect(candidate.position[1]).toBeCloseTo(240, 6);
      }
    });

    it('reproduces its whole order from the seed (D9)', () => {
      const first = stationCandidates(straightRoute(), 20, mulberry32(9));
      const second = stationCandidates(straightRoute(), 20, mulberry32(9));

      expect(first).toEqual(second);
    });
  });
});

describe('stepSurvey', () => {
  const samples = windowSamples(straightRoute(), 0, 2, 6);

  describe('negative cases', () => {
    it('spends no more casts than it was given', () => {
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples);

      expect(stepSurvey(survey, openWorld, 3)).toBeLessThanOrEqual(3);
      expect(survey.casts).toBeLessThanOrEqual(3);
    });

    it('drops a candidate with no ground under it, without probing its sightlines', () => {
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples);
      const void_: StationProbes = { groundBelow: () => null, pathClear: () => true };

      while (survey.station === null && survey.at < survey.candidates.length) {
        stepSurvey(survey, void_, 3);
      }

      expect(survey.station).toBeNull();
      expect(survey.rejected.ground).toBe(survey.candidates.length);
      // One cast per candidate and not one more — a candidate over a void costs a ground snap, nothing else.
      expect(survey.casts).toBe(survey.candidates.length);
    });

    it('rejects every station on the blocked side of the street', () => {
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(4));
      // Wall off whichever side the seeded order happens to offer first, so the test is about the survey and
      // not about the draw.
      const blocked = Math.sign(candidates[0].lateral);
      const survey = createSurvey(candidates, samples);
      while (survey.station === null && survey.at < survey.candidates.length) {
        stepSurvey(survey, walledSide(blocked), 3);
      }

      expect(survey.station).not.toBeNull();
      expect(Math.sign((survey.station?.position[0] ?? 100) - 100)).toBe(-blocked);
      expect(survey.rejected.sight).toBeGreaterThan(0);
    });

    it('rejects a station the car is never near enough for (the dwell test)', () => {
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples, {
        ...SURVEY_DEFAULTS,
        maxDist: 5, // nothing on the roadside is ever this close
      });
      while (survey.station === null && survey.at < survey.candidates.length) {
        stepSurvey(survey, openWorld, 3);
      }

      expect(survey.station).toBeNull();
      expect(survey.rejected.dwell).toBe(survey.candidates.length);
    });

    it('does nothing at all once it has an answer', () => {
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples);
      while (survey.station === null) {
        stepSurvey(survey, openWorld, 3);
      }
      const spent = survey.casts;

      expect(stepSurvey(survey, openWorld, 3)).toBe(0);
      expect(survey.casts).toBe(spent);
    });
  });

  describe('positive cases', () => {
    it('accepts the first candidate that can see the car, in the seeded order', () => {
      const candidates = stationCandidates(straightRoute(), 20, mulberry32(2));
      const survey = createSurvey(candidates, samples);
      while (survey.station === null && survey.at < survey.candidates.length) {
        stepSurvey(survey, openWorld, 3);
      }

      expect(survey.station?.coverage).toBe(1);
      expect(survey.at).toBe(0); // an open world accepts the first one offered
      expect(survey.station?.position[2]).toBe(10 + candidates[0].height);
    });

    it('forgives ONE blocked sample — a lamppost may not cost a usable station', () => {
      let asked = 0;
      const oneLamppost: StationProbes = { groundBelow: () => 10, pathClear: () => (asked += 1) !== 3 };
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples);
      while (survey.station === null && survey.at < survey.candidates.length) {
        stepSurvey(survey, oneLamppost, 3);
      }

      expect(survey.station?.coverage).toBeCloseTo(0.8, 6);
    });

    it('costs one ground snap plus one cast per window sample, and no more', () => {
      const survey = createSurvey(stationCandidates(straightRoute(), 20, mulberry32(2)), samples);
      while (survey.station === null) {
        stepSurvey(survey, openWorld, 3);
      }

      expect(survey.casts).toBe(1 + samples.length);
    });
  });
});

describe('windowSamples', () => {
  describe('positive cases', () => {
    it('spans the whole shot window, lifted to the car body', () => {
      const samples = windowSamples(straightRoute(), 0, 2, 6);

      expect(samples.length).toBe(5);
      expect(samples[0][1]).toBeCloseTo(200 + 24, 6); // 2 s in at 12 m/s
      expect(samples[4][1]).toBeCloseTo(200 + 96, 6); // 8 s in
      expect(samples[0][2]).toBeGreaterThan(10);
    });
  });
});

describe('WALK_SURVEY_DEFAULTS', () => {
  describe('positive cases', () => {
    it('brings the distance ceiling in to what a PERSON reads at, and changes nothing else', () => {
      expect(WALK_SURVEY_DEFAULTS.maxDist).toBeLessThan(SURVEY_DEFAULTS.maxDist);
      // Coverage and dwell are judgements about the WORLD, not about the subject's size: a station that can
      // only see the subject for half its window is a bad station whoever is walking past it.
      expect(WALK_SURVEY_DEFAULTS.minCoverage).toBe(SURVEY_DEFAULTS.minCoverage);
      expect(WALK_SURVEY_DEFAULTS.minDwell).toBe(SURVEY_DEFAULTS.minDwell);
    });
  });
});
