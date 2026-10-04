/**
 * The commit the artifact was BUILT from, injected into both halves at build time.
 *
 * `release/` is not tracked, so an exe on someone else's machine carries nothing that names its origin:
 * the first Windows run of 0.4.0 was an exe packed half an hour before the wizard was written, and the only
 * way to tell was to unpack its asar. The stamp is in the about line, so a screenshot answers that instead.
 */
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

const APP_DIR = dirname(import.meta.dirname);
const REPO_ROOT = dirname(dirname(APP_DIR));

/** What the about line shows when the build has no git tree behind it (a tarball, an unpacked source zip). */
export const UNKNOWN_STAMP = 'unknown';

/** `<short sha>`, `<short sha>-dirty` when the tree carries changes, `unknown` with no sha. */
export function formatBuildStamp(sha: string, dirty: boolean): string {
  if (sha.length === 0) {
    return UNKNOWN_STAMP;
  }

  return dirty ? `${sha}-dirty` : sha;
}

/** The stamp for the tree the build is running in. Never throws — a missing git is not a build failure. */
export function readBuildStamp(cwd: string = REPO_ROOT): string {
  try {
    const sha = git(['rev-parse', '--short', 'HEAD'], cwd);

    return formatBuildStamp(sha, git(['status', '--porcelain'], cwd).length > 0);
  } catch {
    return UNKNOWN_STAMP;
  }
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
