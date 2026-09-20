import type { System } from '../core/system';

/**
 * A one-shot polling system (plan 061): resolves its promise on the first frame `predicate()` holds, or
 * after `timeoutMs` of frame deltas ('timeout' — a failed cell build must degrade to "proceed with a
 * warning", never a forever-frozen game). The host registers it like any system and drops it once done
 * (`done` flips true). Headless-testable — the readiness state machine lives here, not in game.ts.
 */
export interface SettleWatcher extends System {
  done: boolean;
  readonly result: Promise<'settled' | 'timeout'>;
}

export function createSettleWatcher(predicate: () => boolean, timeoutMs: number): SettleWatcher {
  let resolve: (outcome: 'settled' | 'timeout') => void;
  const result = new Promise<'settled' | 'timeout'>((r) => {
    resolve = r;
  });
  let waited = 0;

  const watcher: SettleWatcher = {
    done: false,
    name: 'settle-watcher',
    result,
    update(delta: number): void {
      if (watcher.done) {
        return;
      }
      if (predicate()) {
        watcher.done = true;
        resolve('settled');

        return;
      }
      waited += delta * 1000;
      if (waited >= timeoutMs) {
        watcher.done = true;
        resolve('timeout');
      }
    },
  };

  return watcher;
}
