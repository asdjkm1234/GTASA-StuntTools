import { describe, expect, it } from 'vitest';

import { DynamicParticlePool } from './dynamic-particles';

/** Spawn with only the interesting knobs — position/velocity default to recognisable values. */
const spawnAt = (pool: DynamicParticlePool, now: number, life: number, system = 0): boolean =>
  pool.spawn(now, life, system, 1, 2, 3, 4, 5, 6);

describe('DynamicParticlePool', () => {
  describe('negative cases', () => {
    it('drops the spawn when the pool is full', () => {
      const pool = new DynamicParticlePool(2);
      expect(spawnAt(pool, 0, 1)).toBe(true);
      expect(spawnAt(pool, 0, 1)).toBe(true);

      expect(spawnAt(pool, 0, 1)).toBe(false);
      expect(pool.count).toBe(2);
    });

    it('drops a spawn with a non-positive life', () => {
      const pool = new DynamicParticlePool(4);

      expect(spawnAt(pool, 0, 0)).toBe(false);
      expect(spawnAt(pool, 0, -1)).toBe(false);
      expect(pool.count).toBe(0);
    });

    it('reports no change when nothing has died', () => {
      const pool = new DynamicParticlePool(4);
      spawnAt(pool, 0, 10);

      expect(pool.prune(5)).toBe(false);
      expect(pool.count).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('writes the 9-float record with phase = minus the spawn time', () => {
      const pool = new DynamicParticlePool(4);
      spawnAt(pool, 7.5, 2, 3);

      expect([...pool.data.subarray(0, 9)]).toEqual([1, 2, 3, 4, 5, 6, 2, -7.5, 3]);
    });

    it('encodes per-spawn alpha in the system slot fraction (1 − alpha, clamped)', () => {
      const pool = new DynamicParticlePool(4);
      pool.spawn(0, 1, 3, 0, 0, 0, 0, 0, 0, 0.25);
      pool.spawn(0, 1, 3, 0, 0, 0, 0, 0, 0, 0); // fully transparent still floors just under the next slot
      pool.spawn(0, 1, 3, 0, 0, 0, 0, 0, 0, 2); // over-range reads as opaque

      expect(pool.data[8]).toBeCloseTo(3.75, 5);
      expect(pool.data[9 + 8]).toBeCloseTo(3.999, 5);
      expect(pool.data[18 + 8]).toBe(3);
    });

    it('swap-removes the dead and keeps the live range packed', () => {
      const pool = new DynamicParticlePool(4);
      pool.spawn(0, 1, 0, 11, 0, 0, 0, 0, 0); // dies at 1
      pool.spawn(0, 9, 0, 22, 0, 0, 0, 0, 0); // dies at 9
      pool.spawn(0, 2, 0, 33, 0, 0, 0, 0, 0); // dies at 2

      expect(pool.prune(3)).toBe(true);
      expect(pool.count).toBe(1);
      expect(pool.data[0]).toBe(22); // the survivor was swapped into slot 0
    });

    it('recycles freed slots without reallocating', () => {
      const pool = new DynamicParticlePool(2);
      const data = pool.data;
      spawnAt(pool, 0, 1);
      spawnAt(pool, 0, 1);
      pool.prune(2); // both die

      expect(pool.count).toBe(0);
      expect(spawnAt(pool, 3, 1)).toBe(true);
      expect(spawnAt(pool, 3, 1)).toBe(true);
      expect(pool.data).toBe(data); // the same backing store, spawn after spawn — no per-particle allocation
    });

    it('prunes on exact death time, not before', () => {
      const pool = new DynamicParticlePool(2);
      spawnAt(pool, 1, 2); // dies at 3

      expect(pool.prune(2.999)).toBe(false);
      expect(pool.prune(3)).toBe(true);
      expect(pool.count).toBe(0);
    });
  });
});
