import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertResumable,
  fingerprintSources,
  hashRunConfig,
  openResumeSession,
  readResume,
  RESUME_FILE,
  type ResumeIdentity,
} from './resume';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pmb-resume-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function identity(over: Partial<ResumeIdentity> = {}): ResumeIdentity {
  return {
    commit: 'abc',
    configHash: 'cfg',
    sources: { game: { bytes: 1, files: 1, newestMtimeMs: 1 } },
    target: 'opensa',
    ...over,
  };
}

describe('hashRunConfig', () => {
  describe('negative cases', () => {
    it('differs when a value differs', () => {
      expect(hashRunConfig({ a: 1 })).not.toBe(hashRunConfig({ a: 2 }));
    });
  });

  describe('positive cases', () => {
    it('is stable across key order and undefined members', () => {
      expect(hashRunConfig({ a: 1, b: [1, { c: 2 }] })).toBe(hashRunConfig({ a: 1, b: [1, { c: 2 }], d: undefined }));
    });
  });
});

describe('fingerprintSources', () => {
  describe('negative cases', () => {
    it('leaves out a root that does not exist', () => {
      expect(fingerprintSources({ gone: join(root, 'nope') })).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('counts files and bytes recursively and moves with a change', () => {
      mkdirSync(join(root, 'src', 'deep'), { recursive: true });
      writeFileSync(join(root, 'src', 'a.txt'), 'aaa');
      writeFileSync(join(root, 'src', 'deep', 'b.txt'), 'bb');
      const before = fingerprintSources({ src: join(root, 'src') }).src;
      expect(before).toMatchObject({ bytes: 5, files: 2 });

      writeFileSync(join(root, 'src', 'deep', 'c.txt'), 'c');
      const after = fingerprintSources({ src: join(root, 'src') }).src;
      expect(after).toMatchObject({ bytes: 6, files: 3 });
    });
  });
});

describe('assertResumable', () => {
  describe('negative cases', () => {
    it('refuses, naming every difference — code, config, target and a changed source', () => {
      const previous = { ...identity(), stages: [], startedAt: 't' };
      const now = identity({
        commit: 'def',
        configHash: 'other',
        sources: {
          game: { bytes: 2, files: 1, newestMtimeMs: 1 },
          'in/mods': { bytes: 1, files: 1, newestMtimeMs: 1 },
        },
        target: 'sa',
      });

      expect(() => assertResumable(previous, now, root)).toThrow(/target: was opensa, now sa/);
      expect(() => assertResumable(previous, now, root)).toThrow(/code: the run was made at abc/);
      expect(() => assertResumable(previous, now, root)).toThrow(/config: was cfg, now other/);
      expect(() => assertResumable(previous, now, root)).toThrow(/game: changed since the run/);
      expect(() => assertResumable(previous, now, root)).toThrow(/in\/mods: appeared/);
    });
  });

  describe('positive cases', () => {
    it('accepts an identical identity', () => {
      expect(() => assertResumable({ ...identity(), stages: [], startedAt: 't' }, identity(), root)).not.toThrow();
    });
  });
});

describe('openResumeSession', () => {
  describe('negative cases', () => {
    it('refuses to resume when there is nothing to resume', () => {
      const work = join(root, '.work-opensa');
      mkdirSync(work);

      expect(() => openResumeSession({ identity: identity(), log: () => undefined, resume: true, work })).toThrow(
        /nothing to resume/,
      );
    });

    it('a fresh session WIPES the work dir; a resume keeps it and clears the failed mark', () => {
      const work = join(root, '.work-opensa');
      mkdirSync(join(work, '1-mods'), { recursive: true });
      writeFileSync(join(work, '1-mods', 'x'), 'x');
      const fresh = openResumeSession({ identity: identity(), log: () => undefined, resume: false, work });
      expect(readFileSync(join(work, RESUME_FILE), 'utf8')).toContain('"stages": []');
      expect(() => readFileSync(join(work, '1-mods', 'x'))).toThrow();

      fresh.recordStep('mods', join(work, '1-mods'), 3);
      fresh.recordFailure('vehicles', new Error('boom'));
      expect(readResume(work)?.failed).toEqual({ error: 'boom', step: 'vehicles' });

      const logs: string[] = [];
      const resumed = openResumeSession({ identity: identity(), log: (m) => logs.push(m), resume: true, work });
      expect(readResume(work)?.failed).toBeUndefined();
      expect(resumed.doneStep('mods')?.seconds).toBe(3);
      expect(resumed.doneStep('vehicles')).toBeUndefined();
      expect(logs[0]).toMatch(/resuming opensa after 'vehicles' failed/);
    });
  });

  describe('positive cases', () => {
    it('records steps in order with their dirs and seconds', () => {
      const work = join(root, '.work-sa');
      const session = openResumeSession({
        identity: identity({ target: 'sa' }),
        log: () => undefined,
        resume: false,
        work,
      });
      session.recordStep('mods', join(work, '1-mods'), 1.5);
      session.recordStep('sa', join(root, 'sa'), 20);

      expect(readResume(work)?.stages.map((s) => [s.name, s.seconds])).toEqual([
        ['mods', 1.5],
        ['sa', 20],
      ]);
    });
  });
});
