import { describe, expect, it, vi } from 'vitest';

import { buildJob, JobRunner, mapOnlyOut } from './jobs.mjs';

/** A runner over this repository, collecting what it printed. */
function runner() {
  const lines = [];

  return { lines, runner: new JobRunner({ cwd: process.cwd(), onLine: (line) => lines.push(line) }) };
}

/** A job that prints and exits, and one that stays up — both plain node, so the test needs no fixtures. */
const PRINTS = {
  args: ['-e', "console.log('from the job')"],
  command: 'node',
  dropped: [],
  env: {},
  id: 'test-print',
  label: 'print',
  long: false,
};
const STAYS = {
  args: ['-e', 'setInterval(() => {}, 1000)'],
  command: 'node',
  dropped: [],
  env: {},
  id: 'test-stay',
  label: 'stay',
  long: true,
};

describe('phone console jobs', () => {
  describe('negative cases', () => {
    it('refuses a job it does not have, and names the ones it does', () => {
      expect(() => buildJob('rm-rf')).toThrow(
        /unknown job 'rm-rf' — known: districts, map, map3d, open, phone, pull, rebase, setup, share, sirv, webapp/,
      );
    });

    it('drops a knob that is not this job DIRECTLY rather than passing it on', () => {
      // A shell script ignores an env var it does not read, silently. Here the page is told.
      const plan = buildJob('phone', { DISTRICT: 'ganton', NOT_A_KNOB: '1' });

      expect(plan.env).toEqual({ DISTRICT: 'ganton' });
      expect(plan.dropped).toEqual(['NOT_A_KNOB (not a knob of this job)']);
    });

    it('drops a value that is not the shape the knob takes', () => {
      const plan = buildJob('phone', { RECT: '8;-8;11;-5', TEXTURES: 'jpeg' });

      expect(plan.env).toEqual({});
      expect(plan.dropped).toEqual([
        'RECT=8;-8;11;-5 (not the shape RECT takes)',
        'TEXTURES=jpeg (not the shape TEXTURES takes)',
      ]);
    });

    it('carries no env at all into a job that has no knobs', () => {
      expect(buildJob('pull', { DISTRICT: 'ganton' })).toMatchObject({
        dropped: ['DISTRICT (not a knob of this job)'],
        env: {},
      });
    });

    it('will not let the page turn a map-only run back into a full one', () => {
      // The whole value of the button is that it cannot be half-pressed: a stale MODELS in the form, or a
      // page from before this existed, must not buy back the model half of a convert measured in hours.
      const plan = buildJob('map', { BAKE: '1', DISTRICT: 'ganton', MODELS: '1', OUT: './build/phone-ls' });

      expect(plan.env).toMatchObject({ BAKE: '0', MODELS: '0' });
    });

    it('refuses a second job while one is running, and names the one that is', async () => {
      const { runner: jobs } = runner();
      jobs.start(STAYS);

      expect(() => jobs.start(PRINTS)).toThrow(/'test-stay' is still running/);
      jobs.stop();
      await vi.waitFor(() => expect(jobs.status().running).toBe(false));
    });
  });

  describe('positive cases', () => {
    it('builds the 3D map into its OWN folder, with the tier flag forced on', () => {
      // 201/6-01. Two recipes in one folder is a run that serves nothing (phone.sh refuses a pak whose
      // recipe is not the one asked for) or a rebuild that throws the other pak away.
      const plan = buildJob('map3d', { OUT: './build/phone', TEXTURES: 'rgba8' });

      expect(plan.env.LODONLY).toBe('1');
      expect(plan.env.OUT).toBe('./build/phone-map3d');
      expect(plan.env.TEXTURES).toBe('rgba8');
    });

    it('keeps the map-only and the 3D-map folders apart, so neither can be reused as the other', () => {
      expect(buildJob('map', {}).env.OUT).toBe('./build/phone-map');
      expect(buildJob('map3d', {}).env.OUT).toBe('./build/phone-map3d');
    });

    it('builds the phone run out of the form', () => {
      const plan = buildJob('phone', {
        DISTRICT: 'los-santos-centre',
        MODELS: '0',
        OUT: './build/phone-ls',
        TEXTURES: 'rgba8',
      });

      expect(plan.command).toBe('npm');
      expect(plan.args).toEqual(['run', 'phone']);
      expect(plan.env).toEqual({
        DISTRICT: 'los-santos-centre',
        MODELS: '0',
        OUT: './build/phone-ls',
        TEXTURES: 'rgba8',
      });
      expect(plan.long).toBe(true);
    });

    it('sends a map-only run into its own folder, once', () => {
      // `phone.sh` REFUSES an existing pak whose recipe is not the one being asked for, so a map-only run
      // over the full pak's folder would serve nothing at all; and pressing the button twice must reuse the
      // map-only pak rather than name a third folder.
      expect(buildJob('map', { OUT: './build/phone-ls' }).env.OUT).toBe('./build/phone-ls-map');
      expect(mapOnlyOut('./build/phone-ls-map')).toBe('./build/phone-ls-map');
      expect(mapOnlyOut('./build/phone-ls/')).toBe('./build/phone-ls-map');
      // Nothing typed, or a value dropped for its shape: still a folder named for what it holds.
      expect(buildJob('map').env.OUT).toBe('./build/phone-map');
    });

    it('keeps the district and the texture format a map-only run was asked for', () => {
      const plan = buildJob('map', { DISTRICT: 'los-santos-wide', TEXTURES: 'rgba8' });

      expect(plan.args).toEqual(['run', 'phone']);
      expect(plan.env).toEqual({
        BAKE: '0',
        DISTRICT: 'los-santos-wide',
        MODELS: '0',
        OUT: './build/phone-map',
        TEXTURES: 'rgba8',
      });
    });

    it('re-unpacks the app by clearing assets/ rather than the folder itself', () => {
      // `build/webapp` is routinely a symlink into shared storage, so `rm -rf build/webapp` removes the link
      // (or the shared folder); `assets/` is the part that must go, because chunk names are content-hashed
      // and an overlay leaves every old chunk in place beside the new ones.
      const plan = buildJob('webapp');

      expect(plan.command).toBe('bash');
      expect(plan.args[1]).toBe('rm -rf build/webapp/assets && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp');
    });

    it('installs sirv without touching package.json', () => {
      // Every install this panel runs is --no-save: a dirty package.json here is a `git pull` that refuses.
      expect(buildJob('sirv').args).toEqual(['i', 'sirv', '--no-save', '--no-audit', '--no-fund']);
    });

    it('ignores an empty field instead of passing an empty value down', () => {
      expect(buildJob('phone', { DISTRICT: '  ', TEXTURES: 'astc' }).env).toEqual({ TEXTURES: 'astc' });
    });

    it('keeps what a job printed, so a page that reconnects still sees it', async () => {
      const { lines, runner: jobs } = runner();
      jobs.start(PRINTS);
      await vi.waitFor(() => expect(jobs.status().running).toBe(false));

      expect(lines.some((line) => line.includes('from the job'))).toBe(true);
      expect(jobs.backlog().some((line) => line.startsWith('$ node'))).toBe(true);
      expect(jobs.backlog().some((line) => line.includes('finished'))).toBe(true);
    });

    it('drops the terminal colour codes the shell scripts print', () => {
      // `phone-setup.sh` writes its headings with literal printf escapes, which FORCE_COLOR cannot reach —
      // on a page they are `[1m== environment[0m` across the line an operator is reading.
      const jobs = new JobRunner({ cwd: process.cwd(), onLine: () => undefined });
      const esc = String.fromCharCode(27);
      jobs.push(`${esc}[1m== environment${esc}[0m`);
      jobs.push(`   ${esc}[32m+${esc}[0m wake lock held`);

      expect(jobs.backlog()).toEqual(['== environment', '   + wake lock held']);
    });

    it('caps the buffer so a long convert cannot grow without bound', () => {
      const jobs = new JobRunner({ cwd: process.cwd(), onLine: () => undefined, ringLines: 3 });
      for (const line of ['a', 'b', 'c', 'd', 'e']) {
        jobs.push(line);
      }

      expect(jobs.backlog()).toEqual(['c', 'd', 'e']);
    });

    it('says nothing is running when nothing is', () => {
      expect(runner().runner.status()).toEqual({ running: false });
      expect(runner().runner.stop()).toEqual({ running: false });
    });
  });
});
