import { describe, expect, it } from 'vitest';

import { playSequence } from './sequence';

/** A hook pair that fails on the named scenes and records what it was told. */
function hooks(failOn: readonly number[]): {
  failures: [number, string][];
  onFailure: (scene: number, message: string) => void;
  play: (scene: number) => Promise<void>;
  played: number[];
} {
  const failures: [number, string][] = [];
  const played: number[] = [];

  return {
    failures,
    onFailure: (scene, message) => failures.push([scene, message]),
    play: async (scene): Promise<void> => {
      await Promise.resolve();
      if (failOn.includes(scene)) {
        throw new Error(`no route inside LA in 120 tries (scene ${scene})`);
      }
      played.push(scene);
    },
    played,
  };
}

describe('playSequence', () => {
  describe('negative cases', () => {
    it('does not let one bad scene end the run — the rest still play', async () => {
      // The whole point of the loop: nobody watches a 100-scene sequence live, so a scene that cannot stage
      // (no route in its region, spawn retries exhausted, every aerial pass blocked) costs one scene.
      const test = hooks([2]);

      await expect(playSequence(1, 4, test)).resolves.toBe(3);
      expect(test.played).toEqual([1, 3, 4]);
    });

    it('REPORTS every failure — a scene with no line reads as a scene that played', async () => {
      const test = hooks([2, 3]);

      await playSequence(1, 4, test);

      expect(test.failures.map(([scene]) => scene)).toEqual([2, 3]);
      expect(test.failures[0][1]).toContain('no route inside LA');
    });

    it('resolves rather than rejecting when EVERY scene fails', async () => {
      const test = hooks([1, 2, 3]);

      await expect(playSequence(1, 3, test)).resolves.toBe(0);
      expect(test.failures).toHaveLength(3);
    });

    it('reports a non-Error throw as its string, instead of "[object Object]" or a crash', async () => {
      const failures: [number, string][] = [];

      await playSequence(1, 1, {
        onFailure: (scene, message) => failures.push([scene, message]),
        play: async (): Promise<void> => {
          await Promise.resolve();
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- exactly the case under test
          throw 'spawn denied';
        },
      });

      expect(failures).toEqual([[1, 'spawn denied']]);
    });

    it('plays nothing when the range is empty', async () => {
      const test = hooks([]);

      await expect(playSequence(5, 4, test)).resolves.toBe(0);
      expect(test.played).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('plays the inclusive range in order and counts what played', async () => {
      const test = hooks([]);

      await expect(playSequence(6, 8, test)).resolves.toBe(3);
      expect(test.played).toEqual([6, 7, 8]);
    });

    it('plays scenes strictly one at a time', async () => {
      // Two scenes staging at once would share the world, the car and the overlay — the run is a sequence.
      let live = 0;
      let overlapped = false;

      await playSequence(1, 4, {
        onFailure: () => undefined,
        play: async () => {
          live += 1;
          overlapped ||= live > 1;
          await Promise.resolve();
          live -= 1;
        },
      });

      expect(overlapped).toBe(false);
    });
  });
});
