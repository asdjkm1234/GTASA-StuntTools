import { describe, expect, it } from 'vitest';

import { runChecks, statusPaths, verdict } from './doctor.mjs';

const TARGET = { game: './game-src/original', out: './build/phone', ports: [3001] };

/** A phone where everything is in place; each test breaks exactly one thing. */
function probe(overrides = {}) {
  const present = new Set(['./game-src/original/data/gta.dat', 'node_modules/sirv', 'node_modules/tsx']);

  return {
    app: async () => null,
    arch: 'arm64',
    credentials: async () => ({ helper: 'store', ok: true }),
    exists: async (path) => (overrides.missing ?? new Set()).has(path) === false && present.has(path),
    freeBytes: async () => 40 * 1024 ** 3,
    git: async () => ({ ahead: 0, behind: 0, branch: 'main', dirty: 0, dirtyPaths: [] }),
    identity: async () => ({ email: 'phone@users.noreply.github.com', name: 'phone', owner: 'sexorcist00' }),
    mtime: async (path) => (path === 'package-lock.json' ? 100 : 200),
    nodeVersion: 'v22.4.0',
    openUrl: true,
    portOpen: async () => false,
    readJson: async () => ({ build: { at: '2026-08-23', textures: 'astc' } }),
    realpath: async (path) => `/home/user/opensa/${path}`,
    rebasing: async () => false,
    signal: true,
    termux: true,
    tilesArchive: async () => null,
    wakeLock: true,
    ...overrides,
  };
}

const find = (checks, id) => checks.find((check) => check.id === id);

describe('phone console doctor', () => {
  describe('negative cases', () => {
    it('fails a tree older than the lock — what a pull causes and the convert reports minutes later', async () => {
      const checks = await runChecks(
        probe({
          mtime: async (path) => (path === 'package-lock.json' ? 300 : path === 'build/webapp/index.html' ? null : 200),
        }),
        TARGET,
      );

      expect(find(checks, 'deps').state).toBe('fail');
      expect(find(checks, 'deps').fix).toBe('npm run phone:setup');
      // Carries the job, so the page offers it as a button rather than a command to retype on a phone.
      expect(find(checks, 'deps').job).toBe('setup');
    });

    it('fails when node_modules is not there at all', async () => {
      const checks = await runChecks(probe({ mtime: async () => null }), TARGET);

      expect(find(checks, 'deps').detail).toMatch(/not installed/);
    });

    it('fails when the served app is NOT the build in the archive', async () => {
      // 2026-08-23: the phone served an 11-day-old build, so a feature it had just pulled did not exist on
      // screen. Compared by content — a timestamp comparison is guaranteed to lie here (`webapp.mjs`).
      const checks = await runChecks(probe({ app: async () => ({ archived: 'a:1', served: 'a:2' }) }), TARGET);

      expect(find(checks, 'webapp')).toMatchObject({ job: 'webapp', state: 'fail' });
      expect(find(checks, 'webapp').detail).toMatch(/NOT the app in the repo/);
    });

    it('fails when git has no author, and derives the fix from the remote', async () => {
      // 2026-08-24 on the phone: every commit died with "Author identity unknown", which git only says when
      // one is attempted — so the capture the operator had filed went nowhere and the panel looked broken.
      const checks = await runChecks(
        probe({ identity: async () => ({ email: '', name: '', owner: 'sexorcist00' }) }),
        TARGET,
      );

      expect(find(checks, 'identity').state).toBe('fail');
      expect(find(checks, 'identity').fix).toContain('sexorcist00@users.noreply.github.com');
      // Not a button: only the operator knows what to be called, so nothing here can run it for them.
      expect(find(checks, 'identity').job).toBeUndefined();
    });

    it('fails on a missing sirv, because that is the server that hands out the pak', async () => {
      const checks = await runChecks(probe({ missing: new Set(['node_modules/sirv']) }), TARGET);

      expect(find(checks, 'sirv').state).toBe('fail');
      expect(find(checks, 'sirv').detail).toMatch(/cannot serve the pak/);
      expect(find(checks, 'sirv').job).toBe('sirv');
    });

    it('fails when GAME and OUT resolve to one folder', async () => {
      // 2026-08-09: the convert rewrote the archives it was reading. `guardOut` refuses it now, but only
      // after the run has already started deleting.
      const checks = await runChecks(probe({ realpath: async () => '/shared/one-folder' }), TARGET);

      expect(find(checks, 'paths').state).toBe('fail');
      expect(find(checks, 'paths').detail).toMatch(/eat its own source/);
    });

    it('fails a node too old to run the repo', async () => {
      const checks = await runChecks(probe({ nodeVersion: 'v16.20.0' }), TARGET);

      expect(find(checks, 'node').state).toBe('fail');
    });

    it('warns rather than fails on a device that is nearly full', async () => {
      const checks = await runChecks(probe({ freeBytes: async () => 512 * 1024 ** 2 }), TARGET);

      expect(find(checks, 'disk-repo').state).toBe('warn');
    });

    it('names a modified package.json, because that is a pull that will not run', async () => {
      // 2026-08-23 on the phone: `npm i tsx` had written itself into package.json, the pull refused, and
      // the update carrying the panel never landed — so the symptom was "the script does not exist".
      const checks = await runChecks(
        probe({ git: async () => ({ ahead: 0, behind: 2, branch: 'main', dirty: 1, dirtyPaths: ['package.json'] }) }),
        TARGET,
      );

      expect(find(checks, 'pull-blocked')).toMatchObject({
        fix: 'git checkout -- package.json package-lock.json',
        state: 'fail',
      });
      // Deliberately NOT a button: it discards a file, and nothing destructive is one tap away here.
      expect(find(checks, 'pull-blocked').job).toBeUndefined();
    });

    it('reads the FIRST porcelain line correctly, space and all', () => {
      // An unstaged modification's status field starts with a space, so trimming the block first eats one
      // character of the first line only — `ackage.json`, and a check that reads healthy exactly when the
      // file it is about is the only thing changed.
      expect(statusPaths(' M package.json\n M scripts/phone.sh\n')).toEqual(['package.json', 'scripts/phone.sh']);
      expect(statusPaths('?? tools-debug/phone-console/\n')).toEqual(['tools-debug/phone-console/']);
      expect(statusPaths('R  old.md -> docs/new.md\n')).toEqual(['docs/new.md']);
      expect(statusPaths('')).toEqual([]);
    });

    it('rolls the blocking checks up into one line', async () => {
      const checks = await runChecks(probe({ missing: new Set(['node_modules/tsx']) }), TARGET);

      expect(verdict(checks)).toEqual({ headline: '1 blocking: tsx', state: 'fail' });
    });
  });

  describe('positive cases', () => {
    it('passes a phone that is ready, and says what the pak is', async () => {
      const checks = await runChecks(probe(), TARGET);

      expect(verdict(checks).state).toBe('ok');
      expect(find(checks, 'pak').detail).toBe('built 2026-08-23 · textures astc · no tiles.pmtiles beside it');
      expect(find(checks, 'node').detail).toBe('v22.4.0 · arm64 · Termux');
    });

    it('says nothing about the served app on a device that runs the dev server instead', async () => {
      // No `build/webapp` means vite is the app, and a check about an archive nobody unpacked is noise.
      expect(find(await runChecks(probe(), TARGET), 'webapp')).toBeUndefined();
    });

    it('passes the served app when it is the build the archive carries', async () => {
      const checks = await runChecks(probe({ app: async () => ({ archived: 'a:1', served: 'a:1' }) }), TARGET);

      expect(find(checks, 'webapp')).toMatchObject({ state: 'ok' });
      expect(find(checks, 'webapp').fix).toBeUndefined();
    });

    it('names a diverged branch as the decision it is, with the command that takes both sides', async () => {
      // 2026-08-24: the phone committed a capture while the other end pushed, and `git pull --ff-only`
      // refused — correctly, and in words that read like a breakage rather than a choice.
      const checks = await runChecks(
        probe({ git: async () => ({ ahead: 1, behind: 2, branch: 'work', dirty: 0, dirtyPaths: [] }) }),
        TARGET,
      );

      expect(find(checks, 'diverged')).toMatchObject({ job: 'rebase', state: 'fail' });
      expect(find(checks, 'diverged').detail).toBe('1 here and 2 there — a fast-forward pull cannot take both');
    });

    it('says when a rebase stopped part-way, and how to leave that state', async () => {
      const checks = await runChecks(probe({ rebasing: async () => true }), TARGET);

      expect(find(checks, 'rebasing')).toMatchObject({ state: 'fail' });
      expect(find(checks, 'rebasing').fix).toContain('git rebase --abort');
      // Not a button: neither continuing nor abandoning someone's half-finished history is a tap.
      expect(find(checks, 'rebasing').job).toBeUndefined();
    });

    it('warns when a push has no way to authenticate, without asking the network', async () => {
      // 2026-08-24: the commit went through and the push died on "could not read Username". Knowable from
      // configuration alone, so preflight says it before a capture is filed rather than after.
      const checks = await runChecks(probe({ credentials: async () => ({ helper: '', ok: false }) }), TARGET);

      expect(find(checks, 'push-auth')).toMatchObject({ state: 'warn' });
      expect(find(checks, 'push-auth').fix).toContain('gh auth login');
    });

    it('says the flat map’s pyramid is beside the pak, and how big it is', async () => {
      const checks = await runChecks(probe({ tilesArchive: async () => 12 * 1024 * 1024 }), TARGET);

      expect(find(checks, 'pak').detail).toContain('tiles.pmtiles 12.00 MB');
    });

    it('says who the captures will be committed as', async () => {
      expect(find(await runChecks(probe(), TARGET), 'identity')).toMatchObject({
        detail: 'commits as phone <phone@users.noreply.github.com>',
        state: 'ok',
      });
    });

    it('reports a port that is already serving as reuse rather than a problem', async () => {
      const checks = await runChecks(probe({ portOpen: async () => true }), TARGET);

      expect(find(checks, 'port-3001')).toMatchObject({ detail: 'already serving — a run reuses it', state: 'ok' });
    });

    it('warns about a missing wake lock, since Android suspends a long convert without it', async () => {
      const checks = await runChecks(probe({ wakeLock: false }), TARGET);

      expect(find(checks, 'wake').state).toBe('warn');
      expect(verdict(checks)).toEqual({ headline: 'ready · 1 to know about', state: 'warn' });
    });

    it('warns when nothing on this phone can open a url, and names the package', async () => {
      const checks = await runChecks(probe({ openUrl: false }), TARGET);

      expect(find(checks, 'open-url').state).toBe('warn');
      expect(find(checks, 'open-url').fix).toBe('pkg install termux-tools');
    });

    it('warns when the phone cannot buzz, because then only the console itself says a run ended', async () => {
      const checks = await runChecks(probe({ signal: false }), TARGET);

      expect(find(checks, 'signal').state).toBe('warn');
      expect(find(checks, 'signal').fix).toBe('pkg install termux-api');
    });

    it('offers the pull when the branch is behind', async () => {
      const checks = await runChecks(
        probe({
          git: async () => ({ ahead: 1, behind: 3, branch: 'main', dirty: 2, dirtyPaths: ['docs/a.md', 'docs/b.md'] }),
        }),
        TARGET,
      );

      expect(find(checks, 'git').detail).toBe('main · 2 changed files · 1 to push · 3 behind');
      expect(find(checks, 'git').fix).toBe('git pull --ff-only');
      expect(find(checks, 'pull-blocked')).toBeUndefined();
      // Ahead AND behind is the diverged case; ahead alone is not.
      expect(find(checks, 'diverged')).toBeDefined();
    });

    it('says a world with no pak yet is not an error', async () => {
      const checks = await runChecks(probe({ readJson: async () => null }), TARGET);

      expect(find(checks, 'pak').state).toBe('warn');
      expect(find(checks, 'pak').detail).toMatch(/no pak yet/);
    });
  });
});
