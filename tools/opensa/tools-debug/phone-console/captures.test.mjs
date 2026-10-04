import { describe, expect, it } from 'vitest';

import {
  capturePath,
  checkTilesArchive,
  commitPlan,
  pakFacts,
  pendingCaptures,
  runCommit,
  slugify,
  withNote,
} from './captures.mjs';

const FACTS = { commit: 'abc1234', device: 'Pixel', node: 'v22.0.0', pak: 'original rect 8,-8,11,-5' };

describe('phone console captures', () => {
  describe('negative cases', () => {
    it('refuses a capture with no name — the file name IS the name', () => {
      expect(() => capturePath('2026-08-23', '   ')).toThrow(/needs a name/);
    });

    it('refuses a one-word name, because the family names a capture <surface>-<what>', () => {
      // What gets typed when the point is to test the button rather than to keep the run.
      expect(() => capturePath('2026-08-25', 'test')).toThrow(/is one word/);
      expect(() => capturePath('2026-08-25', 'Jdjsjsjsjdjd')).toThrow(/is one word/);
    });

    it('refuses a capture whose note says nothing', () => {
      // The benchmark record's first rule: a row nobody can place is a row nobody can compare.
      expect(() => withNote({ runs: [] }, 'ok', FACTS)).toThrow(/at least 12 characters/);
    });

    it('refuses a note that is not in English', () => {
      // The repository is English only, and this panel writes committed files on a device whose operator
      // does not type English by default — so the rule is enforced at the door, not repaired afterwards.
      expect(() => withNote({}, 'Прогон на телефоне', FACTS)).toThrow(/must be in English/);
      // The panel's own separators are not letters and must keep working.
      expect(withNote({}, 'the ASTC side of the A/B', FACTS).note).toContain(' · ');
    });

    it('refuses a file that is not a PMTiles archive', () => {
      // Silent by nature: an HTML error page saved under the right name makes the flat map draw nothing,
      // which looks exactly like a map that has not loaded.
      const html = new Uint8Array(Buffer.from('<!doctype html><title>404'));

      expect(() => checkTilesArchive(html)).toThrow(/not a PMTiles archive/);
    });

    it('refuses to commit anything but a capture', () => {
      expect(() => commitPlan(['apps/dispatch/src/world/boot.ts'], 'sneak')).toThrow(/files data, never code/);
    });

    it('refuses an empty commit', () => {
      expect(() => commitPlan([], 'nothing')).toThrow(/nothing to commit/);
    });

    it('writes the failing command and git’s own words to the log, then stops', async () => {
      // The first version logged only on success, so a failed push left one short line on the page and no
      // evidence anywhere — on the device where reading a terminal is hardest.
      const lines = [];
      const plan = commitPlan(['docs/benchmarks/opensa-engine/2026-08-23-a.json'], 'a capture');
      const run = async (command) => {
        if (command === 'git' && lines.some((line) => line.includes('commit'))) {
          throw Object.assign(new Error('Command failed'), { stderr: 'nothing to commit, working tree clean\n' });
        }

        return { stderr: '', stdout: '' };
      };

      await expect(
        runCommit({ branch: 'main', log: (line) => lines.push(line), plan, push: true, run }),
      ).rejects.toThrow(/git commit failed — nothing to commit/);
      expect(lines.some((line) => line.includes('nothing to commit, working tree clean'))).toBe(true);
      // The push never ran: a failed commit has nothing to send.
      expect(lines.some((line) => line.includes('push'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('finds the captures waiting to be committed, and nothing else', () => {
      // The list comes from git, not from what the page remembers filing — a reload used to lose it, and a
      // capture already on disk could then never be committed from the panel.
      expect(
        pendingCaptures([
          'docs/benchmarks/opensa-engine/2026-08-23-b.json',
          'docs/benchmarks/opensa-engine/2026-08-23-a.json',
          'docs/benchmarks/opensa-engine/notes.md',
          'docs/benchmarks/index.md',
          'apps/dispatch/src/world/boot.ts',
        ]),
      ).toEqual(['docs/benchmarks/opensa-engine/2026-08-23-a.json', 'docs/benchmarks/opensa-engine/2026-08-23-b.json']);
      expect(pendingCaptures([])).toEqual([]);
    });

    it('names the file the way the family does', () => {
      expect(capturePath('2026-08-23', 'Mobile pinned district — inventory')).toBe(
        'docs/benchmarks/opensa-engine/2026-08-23-mobile-pinned-district-inventory.json',
      );
    });

    it('slugifies a phone-typed name', () => {
      expect(slugify('  ASTC vs RGBA8 (LS) ')).toBe('astc-vs-rgba8-ls');
    });

    it('stamps the conditions it can prove onto the note the operator wrote', () => {
      const stamped = withNote({ frames: 400 }, 'the ASTC side of the format A/B', FACTS);

      expect(stamped.frames).toBe(400);
      expect(stamped.note).toBe(
        'the ASTC side of the format A/B — Pixel · node v22.0.0 · pak original rect 8,-8,11,-5 · commit abc1234 · captured through tools-debug/phone-console',
      );
    });

    it('reads the pak own recipe, and says so when there is none', () => {
      expect(
        pakFacts({
          build: {
            at: '2026-08-23T10:00:00Z',
            commit: 'deadbee',
            game: 'original',
            rect: [8, -8, 11, -5],
            textures: 'astc',
          },
        }),
      ).toEqual({
        commit: 'deadbee',
        pak: 'original rect 8,-8,11,-5 textures astc built 2026-08-23T10:00:00Z',
      });
      expect(pakFacts(null)).toEqual({ commit: null, pak: null });
    });

    it('accepts a real archive header', () => {
      const archive = new Uint8Array(Buffer.from('PMTilesrest of it'));

      expect(checkTilesArchive(archive)).toEqual({ bytes: archive.byteLength });
    });

    it('logs every command it runs, and says what it pushed', async () => {
      const lines = [];
      const plan = commitPlan(['docs/benchmarks/opensa-engine/2026-08-23-a.json'], 'a capture');
      const run = async () => ({ stderr: 'To github.com:owner/repo.git', stdout: '' });

      const result = await runCommit({ branch: 'work', log: (line) => lines.push(line), plan, push: true, run });

      expect(result).toEqual({ branch: 'work', pushed: true, steps: 3 });
      expect(lines[0]).toMatch(/^\$ git add/);
      expect(lines.some((line) => line.startsWith('$ git push -u origin work'))).toBe(true);
    });

    it('leaves the push out when it was not asked for', async () => {
      const lines = [];
      const plan = commitPlan(['docs/benchmarks/opensa-engine/2026-08-23-a.json'], 'a capture');

      const result = await runCommit({
        branch: 'work',
        log: (line) => lines.push(line),
        plan,
        push: false,
        run: async () => ({ stderr: '', stdout: '' }),
      });

      expect(result).toEqual({ branch: 'work', pushed: false, steps: 2 });
      expect(lines.some((line) => line.includes('push'))).toBe(false);
    });

    it('names the paths on the commit itself, so a dirty tree cannot ride along', () => {
      const plan = commitPlan(['docs/benchmarks/opensa-engine/2026-08-23-a.json'], 'the pinned district on ASTC');

      expect(plan.env).toEqual({ GIT_TERMINAL_PROMPT: '0', HUSKY: '0' });
      expect(plan.steps[0]).toEqual(['git', ['add', '--', 'docs/benchmarks/opensa-engine/2026-08-23-a.json']]);
      expect(plan.steps[1]).toEqual([
        'git',
        [
          'commit',
          '-m',
          'chore(bench): the pinned district on ASTC',
          '--',
          'docs/benchmarks/opensa-engine/2026-08-23-a.json',
        ],
      ]);
    });
  });
});
