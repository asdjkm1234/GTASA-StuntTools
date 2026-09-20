import { describe, expect, it, vi } from 'vitest';

import { NOTIFY_BIN, signalDone, VIBRATE_BIN } from './signal.mjs';

/** A phone that has whichever Termux:API binaries the test says it has. */
function phone(present = [VIBRATE_BIN, NOTIFY_BIN], run = vi.fn(async () => {})) {
  return { deps: { exists: (path) => present.includes(path), run }, run };
}

describe('signalDone', () => {
  describe('negative cases', () => {
    it('says the add-on is missing rather than failing, because the band is the real signal', async () => {
      const { deps } = phone([]);

      const answer = await signalDone(deps, {});

      expect(answer.sent).toEqual([]);
      expect(answer.missing).toEqual(['termux-vibrate', 'termux-notification']);
      expect(answer.why).toContain('pkg install termux-api');
    });

    it('reports a binary that failed and still sends the other one', async () => {
      const { deps } = phone(
        [VIBRATE_BIN, NOTIFY_BIN],
        vi.fn(async (bin) => {
          if (bin === VIBRATE_BIN) {
            throw new Error('no Termux:API app');
          }
        }),
      );

      const answer = await signalDone(deps, {});

      expect(answer.failed).toEqual(['termux-vibrate: no Termux:API app']);
      expect(answer.sent).toEqual(['termux-notification']);
    });
  });

  describe('positive cases', () => {
    it('buzzes through silent mode and posts one replaceable notification', async () => {
      const { deps, run } = phone();

      const answer = await signalDone(deps, {});

      expect(answer.sent).toEqual(['termux-vibrate', 'termux-notification']);
      expect(run).toHaveBeenCalledWith(VIBRATE_BIN, ['-d', '600', '-f']);
      expect(run.mock.calls[1][1]).toEqual([
        '--id',
        'opensa-map-release',
        '--title',
        'OpenSA console',
        '--content',
        'the agent is done — you can pick the phone up',
      ]);
    });

    it('carries the agent’s own words when it left any', async () => {
      const { deps, run } = phone();

      const answer = await signalDone(deps, { note: '  capture filed, 320 frames  ' });

      expect(answer.note).toBe('capture filed, 320 frames');
      expect(run.mock.calls[1][1]).toContain('capture filed, 320 frames');
    });
  });
});
