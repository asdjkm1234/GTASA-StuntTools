import { describe, expect, it, vi } from 'vitest';

import { OPEN_URL_BIN, openConsole } from './opener.mjs';

const URL_ = 'http://localhost:3001/build/webapp/dispatch.html?src=x&agent=1';

/**
 * A phone whose clock and bus the test owns: `attachAfter` is how many polls pass before the page phones
 * home, so "it attached" and "it never did" are decisions rather than races.
 */
function phone(options = {}) {
  const { attachAfter = 0, hasOpener = true, launch = vi.fn(async () => {}) } = options;
  let now = 1000;
  let polls = 0;

  return {
    deps: {
      attached: () => {
        const attached = polls >= attachAfter;
        polls += 1;

        return attached ? { attached: true, page: { mode: 'live' } } : { attached: false, page: null };
      },
      exists: (path) => hasOpener && path === OPEN_URL_BIN,
      launch,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
    launch,
  };
}

describe('openConsole', () => {
  describe('negative cases', () => {
    it('refuses without termux-open-url and names the package that provides it', async () => {
      const { deps, launch } = phone({ hasOpener: false });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.error).toContain('termux-tools');
      expect(answer.url).toBe(URL_);
      expect(launch).not.toHaveBeenCalled();
    });

    it('reports the launcher failing rather than claiming a page', async () => {
      const { deps } = phone({
        attachAfter: Number.POSITIVE_INFINITY,
        launch: vi.fn(async () => {
          throw new Error('no activity found');
        }),
      });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.error).toContain('no activity found');
    });

    it('gives up when the browser opened but nothing ever attached, and says where to look', async () => {
      const { deps } = phone({ attachAfter: Number.POSITIVE_INFINITY });

      const answer = await openConsole(deps, { timeoutMs: 2000, url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.attached).toBe(false);
      expect(answer.error).toContain('npm run phone');
      expect(answer.url).toBe(URL_);
    });

    // The phone run on 2026-08-28: the launcher exits 0 and Android discards the activity, so the refusal
    // that only described a broken page sent the reader looking for a bug that was a permission.
    it('names the permission a background launch needs, since the launcher cannot report being ignored', async () => {
      const { deps } = phone({ attachAfter: Number.POSITIVE_INFINITY });

      const answer = await openConsole(deps, { timeoutMs: 2000, url: URL_ });

      expect(answer.error).toContain('display over other apps');
    });
  });

  describe('positive cases', () => {
    it('launches the url and answers once the page phones home', async () => {
      const { deps, launch } = phone({ attachAfter: 3 });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer).toMatchObject({ attached: true, ok: true, reused: false, url: URL_ });
      expect(answer.page).toEqual({ mode: 'live' });
      expect(launch).toHaveBeenCalledWith(URL_);
    });

    it('keeps the map already on screen instead of opening a second tab over it', async () => {
      const { deps, launch } = phone({ attachAfter: 0 });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer).toMatchObject({ attached: true, ok: true, reused: true });
      expect(launch).not.toHaveBeenCalled();
    });
  });
});
