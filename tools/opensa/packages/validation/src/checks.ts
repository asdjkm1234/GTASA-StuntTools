/**
 * Generic file and path checks. Nothing here knows what a `.dff` is, what GTA:SA needs or which slots
 * exist — a domain question is asked of the tool that owns the data, and only its ANSWER is shaped here.
 *
 * `label` is a lowercase noun phrase naming the thing to the user ("game folder", "output folder",
 * "gta_sa.exe"); it is what makes a generic check's message readable by the person who picked the folder.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Verdict } from './verdict';

/** What a file is expected to be. Both are optional — check the size alone when a hash is too expensive. */
export interface FileExpectation {
  /** Lowercase 40-hex SHA1. */
  readonly sha1?: string;
  readonly size?: number;
}

/** The path exists and is a directory. */
export function checkDirectory(path: string, label: string): Verdict[] {
  const stats = statOrUndefined(path);

  if (!stats) {
    return [
      {
        code: 'path.missing',
        detail: path,
        fix: `Choose the ${label} again — there is nothing at that path.`,
        level: 'error',
        message: `The ${label} does not exist.`,
      },
    ];
  }

  if (!stats.isDirectory()) {
    return [
      {
        code: 'path.not-a-directory',
        detail: path,
        fix: `Choose a folder, not a file, as the ${label}.`,
        level: 'error',
        message: `The ${label} is a file, not a folder.`,
      },
    ];
  }

  return [{ code: 'path.ok', detail: path, level: 'ok', message: `The ${label} exists.` }];
}

/**
 * Every named entry is present under `dir`. Entries are relative paths (`models/gta3.img`) so the caller
 * can express a whole layout as data, and EACH missing one gets its own verdict — "something is missing"
 * is not a report a user can act on.
 */
export function checkEntries(dir: string, entries: readonly string[], label: string): Verdict[] {
  const missing = entries.filter((entry) => !statOrUndefined(join(dir, entry)));

  if (missing.length > 0) {
    return missing.map((entry) => ({
      code: 'path.entry-missing',
      detail: join(dir, entry),
      fix: `Choose a ${label} that contains ${entry}.`,
      level: 'error' as const,
      message: `The ${label} is missing ${entry}.`,
    }));
  }

  return [
    {
      code: 'path.entries-present',
      detail: entries.join(', '),
      level: 'ok',
      message: `The ${label} carries all ${entries.length} files we read.`,
    },
  ];
}

/** The file exists and matches the expected size and/or SHA1. */
export function checkFile(path: string, expected: FileExpectation, label: string): Verdict[] {
  const stats = statOrUndefined(path);

  if (!stats?.isFile()) {
    return [
      {
        code: 'file.missing',
        detail: path,
        fix: `Choose a folder that contains ${label}.`,
        level: 'error',
        message: `${label} was not found.`,
      },
    ];
  }

  if (expected.size !== undefined && stats.size !== expected.size) {
    return [
      {
        code: 'file.size-mismatch',
        detail: `${path} is ${stats.size} bytes, expected ${expected.size}`,
        fix: `Use a ${label} of exactly ${expected.size} bytes.`,
        level: 'error',
        message: `${label} is not the version we support.`,
      },
    ];
  }

  if (expected.sha1 !== undefined) {
    const actual = createHash('sha1').update(readFileSync(path)).digest('hex');

    if (actual !== expected.sha1) {
      return [
        {
          code: 'file.sha1-mismatch',
          detail: `${path} is sha1 ${actual}, expected ${expected.sha1}`,
          fix: `Use a ${label} whose sha1 is ${expected.sha1}.`,
          level: 'error',
          message: `${label} is not the version we support.`,
        },
      ];
    }
  }

  return [{ code: 'file.ok', detail: path, level: 'ok', message: `${label} is the version we support.` }];
}

/**
 * The directory can actually be written to. This WRITES a probe file and removes it, because the
 * permission bits are not the answer on Windows — a read-only folder there passes `access(W_OK)` and then
 * fails on the first real write, which is exactly the kind of late surprise this package exists to move
 * forward in time.
 */
export function checkWritable(path: string, label: string): Verdict[] {
  const probe = join(path, `.opensa-write-probe-${process.pid}`);

  try {
    writeFileSync(probe, '');
    rmSync(probe, { force: true });
  } catch {
    return [
      {
        code: 'path.not-writable',
        detail: path,
        fix: `Choose a ${label} you can write to, or grant write permission on this one.`,
        level: 'error',
        message: `The ${label} cannot be written to.`,
      },
    ];
  }

  return [{ code: 'path.writable', detail: path, level: 'ok', message: `The ${label} can be written to.` }];
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
