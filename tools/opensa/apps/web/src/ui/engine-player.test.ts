import { LOCOMOTION_COLLAPSE, LOCOMOTION_HARD_LAND, LOCOMOTION_SLIDE } from '@opensa/game/character/locomotion';
import { describe, expect, it } from 'vitest';

import { airClipFor, buildClipIndex, loadEnginePlayer, resolveGaitClip } from './engine-player';

const TIERS = { runSpeed: 7, sprintSpeed: 10, walkSpeed: 2 };

/**
 * The missing-model path only: the happy path needs a real ped `.osm` (a full readPedOsm fixture) and
 * is exercised in the field by every boot. What matters here is the NEW contract (2026-07-23): the
 * model comes from `GAME_CONFIG.mainCharacter` — the lookup must use the configured name (lowercased)
 * and the error must say where the name came from (the gostown BMYPOL1-without-a-model case).
 */
describe('loadEnginePlayer', () => {
  describe('negative cases', () => {
    it('looks up the CONFIGURED model (lowercased) and throws naming it + its config source', () => {
      const requested: string[] = [];
      const fs = {
        get: (name: string): null => {
          requested.push(name);

          return null;
        },
        getText: (): null => null,
        has: (): boolean => false,
        names: [] as string[],
      };

      expect(() => loadEnginePlayer({} as never, fs as never, 'BMYCG', TIERS)).toThrow(
        /bmycg\.osm.*GAME_CONFIG\.mainCharacter/,
      );
      expect(requested).toContain('bmycg.osm');
    });
  });
});

/**
 * The 088/03 degradation gate: a TC whose `ped.ifp` lacks `sprint_civi` must keep the RUN cycle at
 * sprint speed (the pre-sprint v1 behaviour) — sampling the empty clip would drop the ped to the flat
 * bind pose. Durations are [idle, walk, run, sprint].
 */
describe('resolveGaitClip', () => {
  describe('negative cases', () => {
    it('an unresolved sprint clip (duration 0) falls back to the run cycle', () => {
      expect(resolveGaitClip([1, 1, 1, 0], 3)).toBe(2);
    });

    it('a missing sprint entry falls back to the run cycle', () => {
      expect(resolveGaitClip([1, 1, 1], 3)).toBe(2);
    });

    it('other gaits are never redirected, resolved or not (the v1 contract)', () => {
      expect(resolveGaitClip([0, 0, 0, 0], 1)).toBe(1);
      expect(resolveGaitClip([1, 1, 1, 1], 0)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('a resolved sprint clip plays as itself', () => {
      expect(resolveGaitClip([1, 1, 1, 0.8], 3)).toBe(3);
    });
  });
});

/**
 * The clip-registration gate (2026-07-24): the exact decision that made the driver "ride STANDING with his
 * legs out of the car" when the scripted clips did not resolve. Locomotion is always addressable; a scripted
 * clip is registered only when it truly resolved (duration > 0), else it must fall through to the standing
 * locomotion stand-in rather than sampling an empty clip (which would drop the ped to the flat bind pose).
 */
describe('buildClipIndex', () => {
  describe('negative cases', () => {
    it('does NOT register an unresolved scripted clip (duration 0) — it falls through to locomotion', () => {
      const index = buildClipIndex(
        [
          { duration: 1, name: 'idle_stance' },
          { duration: 1, name: 'walk_civi' },
          { duration: 1, name: 'run_civi' },
          { duration: 0, name: 'car_sit' }, // absent from the IFP → unresolved
        ],
        3,
      );

      expect(index.has('car_sit')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('always registers locomotion clips, even unresolved (duration 0), at their indices', () => {
      const index = buildClipIndex(
        [
          { duration: 0, name: 'idle_stance' },
          { duration: 0, name: 'walk_civi' },
          { duration: 0, name: 'run_civi' },
        ],
        3,
      );

      expect(index.get('idle_stance')).toBe(0);
      expect(index.get('run_civi')).toBe(2);
    });

    it('registers a resolved scripted clip at its index, keyed lowercase', () => {
      const index = buildClipIndex(
        [
          { duration: 1, name: 'idle_stance' },
          { duration: 1, name: 'walk_civi' },
          { duration: 1, name: 'run_civi' },
          { duration: 1.2, name: 'CAR_getin_LHS' },
          { duration: 3, name: 'car_sit' },
        ],
        3,
      );

      expect(index.get('car_getin_lhs')).toBe(3);
      expect(index.get('car_sit')).toBe(4);
    });
  });
});

/**
 * The 088/07 landing tiers: durations are [idle, walk, run, sprint, launch, glide, land, fall_glide,
 * fall_collapse, fall_land, getup]. HARD_LAND plays the impact crouch (fall_land → jump_land);
 * COLLAPSE plays fall_collapse until the clip has run out, then getup.
 */
const AIR = (overrides: Readonly<Record<number, number>> = {}): number[] => {
  const durations = [1, 1, 1, 1, 0.2, 0.5, 0.23, 0.8, 1, 0.47, 1.37];
  for (const [index, value] of Object.entries(overrides)) {
    durations[Number(index)] = value;
  }

  return durations;
};

describe('airClipFor landing tiers (plan 088/07)', () => {
  describe('negative cases', () => {
    it('an unresolved impact crouch degrades HARD_LAND to the jump land', () => {
      expect(airClipFor(LOCOMOTION_HARD_LAND, AIR({ 9: 0 }))).toBe(6);
    });

    it('an unresolved collapse clip never hands off to getup — the crouch chain plays instead', () => {
      expect(airClipFor(LOCOMOTION_COLLAPSE, AIR({ 8: 0 }), 99)).toBe(9);
    });

    it('an unresolved getup holds the collapse past its duration instead of sampling emptiness', () => {
      expect(airClipFor(LOCOMOTION_COLLAPSE, AIR({ 10: 0 }), 5)).toBe(8);
    });
  });

  describe('positive cases', () => {
    it('HARD_LAND plays the fall_land impact crouch', () => {
      expect(airClipFor(LOCOMOTION_HARD_LAND, AIR())).toBe(9);
    });

    it('SLIDE braces in the fall-glide balance pose (glide when the TC lacks it)', () => {
      expect(airClipFor(LOCOMOTION_SLIDE, AIR())).toBe(7);
      expect(airClipFor(LOCOMOTION_SLIDE, AIR({ 7: 0 }))).toBe(5);
    });

    it('COLLAPSE plays fall_collapse first, then getup once the clip has run out', () => {
      expect(airClipFor(LOCOMOTION_COLLAPSE, AIR(), 0.5)).toBe(8); // mid-collapse
      expect(airClipFor(LOCOMOTION_COLLAPSE, AIR(), 1.1)).toBe(10); // past the 1 s collapse → stand up
    });
  });
});
