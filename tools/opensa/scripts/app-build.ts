/**
 * Which commit an app bundle was built from, injected as `__APP_BUILD__` by every vite config that builds
 * one (the root site build and the dispatch embed).
 *
 * It exists because of a repeated, silent field failure: on 2026-08-26 three inventory captures in a row were
 * taken of an app the device had NOT updated to — twice while everyone involved believed otherwise — and
 * nothing in the capture could say so. The pak's `buildTime` is in there; the APP's identity was not. A
 * capture that names its own build turns "did the archive reach the phone?" from an argument into a field.
 *
 * The SHA alone, deliberately: no timestamp, so rebuilding the same commit produces the same bundle. A
 * working tree with uncommitted changes gets a `+`, because a build from a dirty tree is not that commit.
 */
import { execSync } from 'node:child_process';

export function appBuild(cwd: string): string {
  try {
    const run = (command: string): string => execSync(command, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const sha = run('git rev-parse --short HEAD').trim();
    // `--untracked-files=no`, and the incremental cache dropped: this runs INSIDE the build, after `tsc -b`
    // has already written whatever it writes, so a plain `git status` reports the build's own leavings as
    // uncommitted work. The first archive stamped `67432d1+` from a tree that was clean when it was
    // committed one command earlier — a `+` that fires on every build is a `+` that means nothing.
    const dirty = run('git status --porcelain --untracked-files=no')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.endsWith('tsconfig.tsbuildinfo'));

    return dirty.length === 0 ? sha : `${sha}+`;
  } catch {
    // A tarball with no `.git`, or no git at all. `unknown` is the honest answer and is never a version
    // anyone can mistake for one.
    return 'unknown';
  }
}
