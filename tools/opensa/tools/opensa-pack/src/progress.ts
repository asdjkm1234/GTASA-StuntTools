/**
 * Intermediate progress for the long per-model pack loops. Each stage used to log exactly once, AFTER its
 * loop, so a full-map run showed nothing for minutes at a time and there was no way to tell how long the
 * wait would be. Same shape as the cell-convert ETA line (`convert.ts`), driven off the injected `log`.
 */
export interface Progress {
  /** Count one processed item; emits a line at most every `everyMs`. */
  tick: () => void;
}

export function createProgress(label: string, total: number, log: (message: string) => void, everyMs = 5000): Progress {
  const started = Date.now();
  let last = started;
  let done = 0;

  return {
    tick(): void {
      done += 1;
      const now = Date.now();
      if (now - last < everyMs || done >= total) {
        return; // the stage's own summary line covers the finish
      }
      last = now;
      const elapsed = (now - started) / 1000;
      const eta = (elapsed * (total - done)) / done;
      log(
        `${label}: ${done}/${total} (${((done / total) * 100).toFixed(0)} %), ` +
          `elapsed ${elapsed.toFixed(0)}s, eta ~${eta.toFixed(0)}s`,
      );
    },
  };
}
