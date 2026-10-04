import { describe, expect, it } from 'vitest';

import { createSettleWatcher } from './settle-watcher';

describe('createSettleWatcher', () => {
  describe('negative cases', () => {
    it('resolves "timeout" after timeoutMs of frame deltas when the predicate never holds', async () => {
      const watcher = createSettleWatcher(() => false, 100);
      for (let i = 0; i < 4; i += 1) {
        watcher.update?.(0.03); // 4 × 30 ms > 100 ms
      }
      await expect(watcher.result).resolves.toBe('timeout');
      expect(watcher.done).toBe(true);
    });

    it('stops evaluating after it is done (one-shot)', async () => {
      let calls = 0;
      const watcher = createSettleWatcher(() => {
        calls += 1;

        return true;
      }, 1000);
      watcher.update?.(0.016);
      watcher.update?.(0.016); // no further predicate calls
      await watcher.result;
      expect(calls).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('resolves "settled" on the first frame the predicate holds', async () => {
      let ready = false;
      const watcher = createSettleWatcher(() => ready, 1000);
      watcher.update?.(0.016);
      expect(watcher.done).toBe(false);
      ready = true;
      watcher.update?.(0.016);
      await expect(watcher.result).resolves.toBe('settled');
    });
  });
});
