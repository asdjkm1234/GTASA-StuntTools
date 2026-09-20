import { mulberry32 } from '@opensa/game/paths/rng';
import { WEATHER_NAMES } from '@opensa/renderware';
import { describe, expect, it } from 'vitest';

import {
  buildProgram,
  HOUR_SLOTS,
  parseSceneLimit,
  parseSceneStart,
  pickCar,
  PROGRAM_LENGTH,
  REGION_CYCLE,
  SCENE_LIMIT,
  sceneProgramEntry,
  sceneSeed,
  sceneUrl,
  weatherPool,
} from './presets';

/** A stock roster shape: a handful of road cars, two of which a mod has taken over. */
const ROSTER = ['admiral', 'banshee', 'comet', 'infernus', 'sultan', 'taxi'];
const MODS = new Set(['comet', 'infernus']);

describe('weatherPool', () => {
  describe('negative cases', () => {
    it('never lets another region’s weather into a pool (D7)', () => {
      const losSantos = weatherPool(WEATHER_NAMES, 'LA').map((index) => WEATHER_NAMES[index]);

      expect(losSantos.filter((name) => !name.endsWith('_LA'))).toEqual([]);
      expect(losSantos).not.toContain('RAINY_SF');
    });

    it('returns nothing for a region this game authors no weather for', () => {
      // A total conversion may ship a timecyc with only its own rows; the caller then leaves the weather alone
      // rather than inventing an index into someone else's list.
      expect(weatherPool(['EXTRASUNNY_LA', 'CLOUDY_LA'], 'DESERT')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('finds a pool for every region in the cycle, out of the shipped names', () => {
      for (const region of REGION_CYCLE) {
        expect(weatherPool(WEATHER_NAMES, region).length).toBeGreaterThan(0);
      }
    });
  });
});

describe('buildProgram', () => {
  describe('negative cases', () => {
    it('never repeats or drops a region among the drive scenes', () => {
      for (let seed = 0; seed < 20; seed += 1) {
        const drives = buildProgram(mulberry32(seed))
          .filter((entry) => entry.kind === 'drive')
          .map((entry) => entry.region);

        expect(new Set(drives).size).toBe(REGION_CYCLE.length);
      }
    });

    it('never names a region outside the cycle', () => {
      const regions = buildProgram(mulberry32(3)).map((entry) => entry.region);

      expect(regions.filter((region) => !REGION_CYCLE.includes(region))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('drives every region in the cycle order, then the flythroughs and the walk (D2/D3)', () => {
      const program = buildProgram(mulberry32(11));

      expect(program.filter((entry) => entry.kind === 'drive').map((entry) => entry.region)).toEqual([...REGION_CYCLE]);
      expect(program.map((entry) => entry.kind)).toEqual([
        'drive',
        'drive',
        'drive',
        'drive',
        'drive',
        'fly',
        'fly',
        'walk',
      ]);
    });

    it('reproduces itself from the seed', () => {
      expect(buildProgram(mulberry32(47))).toEqual(buildProgram(mulberry32(47)));
    });
  });
});

describe('sceneSeed', () => {
  describe('negative cases', () => {
    it('does not hand two scenes of a run the same seed', () => {
      const seeds = new Set(Array.from({ length: 200 }, (unused, index) => sceneSeed(47, index)));

      expect(seeds.size).toBe(200);
    });
  });

  describe('positive cases', () => {
    it('is the same for the same scene however the run reached it (D9)', () => {
      expect(sceneSeed(47, 7)).toBe(sceneSeed(47, 7));
      expect(sceneSeed(48, 7)).not.toBe(sceneSeed(47, 7));
    });
  });
});

describe('pickCar', () => {
  describe('negative cases', () => {
    it('returns null rather than a name when there is nothing to drive', () => {
      expect(pickCar(mulberry32(1), [], MODS)).toBeNull();
    });

    it('never picks a ledger name the roster does not carry', () => {
      // A ledger listing a slot this build has no model for (a mod removed since it was written) must not put
      // that name in a scene — the spawn would throw. Nothing drivable in the intersection is the one case
      // that still falls back to stock.
      const ledger = new Set(['alsomissing', 'nosuchcar']);
      for (let seed = 0; seed < 50; seed += 1) {
        expect(ROSTER).toContain(pickCar(mulberry32(seed), ROSTER, ledger));
      }
    });

    it('does not let the ledger change how far the seeded stream advances', () => {
      // A seed must name the same scene list whatever mods are installed, so exactly one roll is taken on
      // either path: two runs of the same seed differ in the CAR, never in everything after it.
      const withMods = mulberry32(9);
      const without = mulberry32(9);
      pickCar(withMods, ROSTER, MODS);
      pickCar(without, ROSTER, new Set());

      expect(withMods()).toBe(without());
    });
  });

  describe('positive cases', () => {
    it('drives ONLY mod cars once the ledger offers any (D10, revised 2026-08-03)', () => {
      const picks = Array.from({ length: 400 }, (unused, seed) => pickCar(mulberry32(seed), ROSTER, MODS));

      expect(picks.filter((model) => model === null || !MODS.has(model))).toEqual([]);
    });

    it('still spreads across the whole mod pool rather than pinning one car', () => {
      const picks = new Set(Array.from({ length: 400 }, (unused, seed) => pickCar(mulberry32(seed), ROSTER, MODS)));

      expect([...picks].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['comet', 'infernus']);
    });

    it('takes a stock car when the ledger is empty', () => {
      expect(ROSTER).toContain(pickCar(mulberry32(5), ROSTER, new Set()));
    });

    it('drives the one mod car every scene when the ledger offers exactly one', () => {
      const picks = Array.from({ length: 20 }, (unused, seed) =>
        pickCar(mulberry32(seed), ROSTER, new Set(['sultan'])),
      );

      expect(new Set(picks)).toEqual(new Set(['sultan']));
    });
  });
});

describe('parseSceneLimit', () => {
  describe('negative cases', () => {
    it('takes the full run rather than refusing to start on a typo', () => {
      // A showcase run is something a screen recorder is already pointed at: a bad `?scenes=` costs the typo,
      // never the session.
      expect(parseSceneLimit('lots')).toBe(SCENE_LIMIT);
      expect(parseSceneLimit(null)).toBe(SCENE_LIMIT);
      expect(parseSceneLimit('')).toBe(SCENE_LIMIT);
    });

    it('never plays fewer than one scene, or more than the ceiling', () => {
      expect(parseSceneLimit('0')).toBe(1);
      expect(parseSceneLimit('-5')).toBe(1);
      expect(parseSceneLimit('1000')).toBe(SCENE_LIMIT);
    });
  });

  describe('positive cases', () => {
    it('takes a short run for a quick field look', () => {
      expect(parseSceneLimit('8')).toBe(8);
      expect(parseSceneLimit('12.7')).toBe(12);
    });
  });
});

describe('parseSceneStart', () => {
  describe('negative cases', () => {
    it('starts at the first scene when nothing readable was asked for', () => {
      expect(parseSceneStart(null)).toBe(1);
      expect(parseSceneStart('')).toBe(1);
      expect(parseSceneStart('the good one')).toBe(1);
    });

    it('never starts before the first scene or past the ceiling', () => {
      expect(parseSceneStart('0')).toBe(1);
      expect(parseSceneStart('-3')).toBe(1);
      expect(parseSceneStart('1000')).toBe(SCENE_LIMIT);
    });
  });

  describe('positive cases', () => {
    it('starts at the scene a field note named', () => {
      expect(parseSceneStart('57')).toBe(57);
      expect(parseSceneStart('57.9')).toBe(57);
    });
  });
});

describe('sceneUrl', () => {
  describe('negative cases', () => {
    it('does not invent a scene count for a run that never bounded itself', () => {
      // An absent `scenes` already means "to the ceiling"; writing one would turn a full run into a bounded
      // one the moment it was reloaded.
      expect(sceneUrl('http://localhost:5173/?video=1', 47, 6, SCENE_LIMIT)).toBe('/?video=1&seed=47&scene=6');
    });

    it('keeps a bounded run ending where it was going to end', () => {
      // `scenes` is a COUNT, not an end: carried over unchanged, a reload at scene 5 of a 1-8 run would play
      // 5-12. The count is rewritten so `last` survives the reload.
      expect(sceneUrl('http://localhost:5173/?video=1&scenes=8', 47, 5, 8)).toBe('/?video=1&scenes=4&seed=47&scene=5');
    });

    it('never writes a count below one scene', () => {
      expect(sceneUrl('http://localhost:5173/?video=1&scenes=8', 47, 12, 8)).toContain('scenes=1');
    });

    it('drops the origin rather than handing replaceState an absolute URL', () => {
      expect(sceneUrl('http://localhost:5173/?video=1', 47, 3, SCENE_LIMIT).startsWith('/')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('names the scene now playing, and the seed that made it', () => {
      const url = new URL(sceneUrl('http://localhost:5173/?video=1', 1234, 57, SCENE_LIMIT), 'http://x');

      expect(url.searchParams.get('scene')).toBe('57');
      expect(url.searchParams.get('seed')).toBe('1234');
    });

    it('replaces the seed and scene a previous mark left, rather than appending a second pair', () => {
      const once = sceneUrl('http://localhost:5173/?video=1', 47, 6, SCENE_LIMIT);

      expect(sceneUrl(`http://localhost:5173${once}`, 47, 7, SCENE_LIMIT)).toBe('/?video=1&seed=47&scene=7');
    });

    it('leaves every other parameter, the path and the hash alone', () => {
      expect(sceneUrl('http://localhost:5173/play?video=1&car=infernus&diag=1#top', 47, 9, SCENE_LIMIT)).toBe(
        '/play?video=1&car=infernus&diag=1&seed=47&scene=9#top',
      );
    });
  });
});

describe('sceneProgramEntry', () => {
  describe('negative cases', () => {
    it('does not re-seed the lap from the scene itself — the trap a mid-run start would fall into', () => {
      // The wrong key: build the lap from THIS scene rather than from the lap's first. It agrees on every
      // lap boundary (where the two are the same scene) and diverges in between, which is exactly why it
      // would have shipped unnoticed.
      const wrong = (seed: number, scene: number): string => {
        const at = (scene - 1) % PROGRAM_LENGTH;

        return `${buildProgram(mulberry32(sceneSeed(seed, -scene)))[at].kind}/${
          buildProgram(mulberry32(sceneSeed(seed, -scene)))[at].region
        }`;
      };
      const right = (scene: number): string => {
        const entry = sceneProgramEntry(47, scene);

        return `${entry.kind}/${entry.region}`;
      };
      const differing = Array.from({ length: SCENE_LIMIT }, (_, index) => index + 1).filter(
        (scene) => wrong(47, scene) !== right(scene),
      );

      // Every disagreement is a fly or a walk: the drive spine is a fixed order of fixed regions, so the
      // wrong key can only move the three scenes whose region comes off the seeded stream.
      expect(differing.length).toBeGreaterThan(0);
      expect(differing.every((scene) => sceneProgramEntry(47, scene).kind !== 'drive')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('is a pure function of (seed, scene) — so scene N is scene N wherever the run started', () => {
      // `?scene=57` plays what the full run plays at 57. The property is structural: where the run began is
      // not an argument, so it cannot be an influence.
      for (let scene = 1; scene <= SCENE_LIMIT; scene += 1) {
        expect(sceneProgramEntry(47, scene)).toEqual(sceneProgramEntry(47, scene));
      }
      // The SEED moves only the fly/walk slots — the drive spine is fixed regions in a fixed order, so two
      // seeds agree on every drive scene by construction and can only differ over the other three.
      const slots = [6, 7, 8];
      expect(slots.map((scene) => sceneProgramEntry(47, scene))).not.toEqual(
        slots.map((scene) => sceneProgramEntry(48, scene)),
      );
      expect(sceneProgramEntry(47, 57)).toEqual(sceneProgramEntry(48, 57)); // a drive: seed-independent
    });

    it('walks the lap in order and plays every entry of the program across one', () => {
      const lap = Array.from({ length: PROGRAM_LENGTH }, (_, index) => sceneProgramEntry(47, index + 1));

      expect(lap).toEqual(buildProgram(mulberry32(sceneSeed(47, -1))));
    });

    it('plays the drive spine in the cycle order, whatever the seed', () => {
      const drives = Array.from({ length: REGION_CYCLE.length }, (_, index) => sceneProgramEntry(9, index + 1));

      expect(drives.map((entry) => entry.kind)).toEqual(REGION_CYCLE.map(() => 'drive'));
      expect(drives.map((entry) => entry.region)).toEqual([...REGION_CYCLE]);
    });
  });
});

describe('PROGRAM_LENGTH', () => {
  describe('positive cases', () => {
    it('is what buildProgram actually returns — the runner picks a lap with it before it can build one', () => {
      // A drift here would hand a mid-sequence start (`?scene=58`) a program from the wrong lap, and the
      // scene would silently differ from the same scene of a full run.
      expect(buildProgram(mulberry32(1))).toHaveLength(PROGRAM_LENGTH);
      expect(buildProgram(mulberry32(999))).toHaveLength(PROGRAM_LENGTH);
    });
  });
});

describe('HOUR_SLOTS', () => {
  describe('positive cases', () => {
    it('is the debugger’s own preset set (D6)', () => {
      expect([...HOUR_SLOTS]).toEqual([0, 6, 12, 18, 21]);
    });
  });
});
