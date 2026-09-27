#!/usr/bin/env node
/**
 * scan-no-assets.mjs - game-audio leak guard (plan todo 20, flight-analysis remediation).
 *
 * Asserts that NO GENRL / game-audio file is (a) tracked by git or (b) present under `.omo/evidence`.
 * Every run is a FRESH scan: it re-reads `git ls-files` and re-walks the evidence directory, with no cache.
 *
 * Detection (fail-closed):
 * - a file whose extension is an audio extension (.wav/.ogg/.mp3/.../.adf) is a game-audio candidate;
 * - any non-source file whose name contains `genrl` (the raw bank is `GENRL`, extensionless) is a candidate;
 * - source/doc files (.ts/.mts/.js/.mjs/.json/.md/...) are not audio and are never flagged, so code that
 *   merely mentions GENRL in its filename (e.g. `scripts/lib/genrl.ts`) is not a false positive.
 *
 * The ONLY exemptions are byte-identical known synthetic test artifacts (SHA-256 locked below). A file that
 * is planted at an exempt path, or an exempt file whose bytes change, is a violation - the exemption cannot
 * go stale and cannot hide a new leak. Exemptions are printed on every run.
 *
 * Usage:
 *   node scripts/scan-no-assets.mjs                 scan tracked files + .omo/evidence
 *   node scripts/scan-no-assets.mjs <path> [<path>] also scan each extra path (file or directory);
 *                                                   relative paths resolve against cwd, then repo root.
 *
 * Exit codes: 0 = no violations; 1 = violations found; 2 = scan error (git missing, unreadable dir, bad path).
 *
 * No GTA sample bytes live in this file: the exemptions are hashes and descriptions only.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
const EVIDENCE_ROOT = join(REPO_ROOT, '.omo', 'evidence');

/** Audio/container extensions that indicate a game-audio payload. `.adf` is the GTA III/VC audio bank. */
const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.adf',
  '.aif',
  '.aiff',
  '.au',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.wave',
  '.wma',
]);

/** Text/source extensions that are never an audio payload even when the filename says `genrl`. */
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.py',
  '.rs',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

/**
 * Byte-locked synthetic test artifacts: they live under `.omo/evidence` and are generated test tones/stubs,
 * never GENRL-derived samples. The SHA-256 is checked at scan time, so a replaced file fails the scan.
 */
const SYNTHETIC_ARTIFACTS = new Map([
  [
    '.omo/evidence/worktree-preservation/integration/recorder/build/test-game.wav',
    {
      reason: 'recorder build self-test stub (48 kHz stereo, every sample within +/-1 LSB; no GENRL content)',
      sha256: '6760ea8d60bb9c384e0f18216560386707afe8a575171f1046a700c17a351976',
    },
  ],
  [
    '.omo/evidence/worktree-preservation/integration/recorder/build/test-silence.wav',
    {
      reason: 'recorder build self-test silence control (48 kHz stereo, every sample within +/-1 LSB)',
      sha256: '63e389cb2719f07727c9f4e89537bd4b1797f12e75b6ab5fb18c3dd06c06c72e',
    },
  ],
  [
    '.omo/evidence/worktree-preservation/integration/tools/opensa/captures/fx-probe.wav',
    {
      reason: 'FX probe acceptance tone (48 kHz stereo, ~220 Hz generated sine; not a GENRL sample)',
      sha256: '50252a490f35968f74b3a6875633b0fd075a92ec75594a3d0b6dc6f7a1be0fa6',
    },
  ],
]);

/**
 * Classify a repo-relative path. Returns `null` when the file cannot carry game audio, else the leak kind.
 * @param {string} relativePath
 * @returns {null | 'audio' | 'genrl-bank'}
 */
export function classifyGameAudioPath(relativePath) {
  const name = basename(relativePath).toLowerCase();
  const extension = extname(name);
  if (SOURCE_EXTENSIONS.has(extension)) {
    return null;
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (name.includes('genrl')) {
    return 'genrl-bank';
  }

  return null;
}

/** Recursively list every regular file under `root` (throws instead of silently skipping unreadable dirs). */
function listFilesRecursive(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  return files;
}

function listTrackedFiles() {
  let output;
  try {
    output = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`git ls-files failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  return output.split('\u0000').filter((entry) => entry.length > 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('usage: node scripts/scan-no-assets.mjs [path ...]');
    console.log('scans git-tracked files and .omo/evidence for GENRL/game-audio files; extra paths are added.');

    return 0;
  }

  const lines = ['scan-no-assets: GENRL / game-audio leak guard (plan todo 20)'];
  lines.push(`repo root: ${REPO_ROOT}`);
  if (!existsSync(join(REPO_ROOT, '.git'))) {
    throw new Error(`not a git worktree: ${REPO_ROOT}`);
  }

  const tracked = listTrackedFiles();
  lines.push(`tracked files: ${tracked.length} (git ls-files, fresh)`);

  const violations = [];
  const exemptions = [];
  for (const relativePath of tracked) {
    const kind = classifyGameAudioPath(relativePath);
    if (!kind) {
      continue;
    }
    const absolute = join(REPO_ROOT, relativePath.split('/').join(sep));
    if (!existsSync(absolute)) {
      continue; // tracked but deleted from the worktree: no bytes can leak
    }
    const verdict = verdictFor(absolute, relativePath, kind);
    if (verdict.exemption) {
      exemptions.push(verdict.exemption);
    }
    if (verdict.violation) {
      violations.push({ ...verdict.violation, scope: 'tracked' });
    }
  }

  const roots = [];
  if (existsSync(EVIDENCE_ROOT)) {
    roots.push({ path: EVIDENCE_ROOT, scope: 'evidence' });
  } else {
    lines.push(`evidence dir: ${EVIDENCE_ROOT} (not present)`);
  }
  const seenRoots = new Set(roots.map((root) => root.path.toLowerCase()));
  for (const argument of args) {
    const extra = resolveExtraPath(argument);
    if (statSync(extra).isDirectory()) {
      if (!seenRoots.has(extra.toLowerCase())) {
        seenRoots.add(extra.toLowerCase());
        roots.push({ path: extra, scope: 'extra' });
      }
    } else {
      const relativePath = toRepoRelative(extra);
      const kind = classifyGameAudioPath(relativePath);
      if (kind) {
        const verdict = verdictFor(extra, relativePath, kind);
        if (verdict.exemption) {
          exemptions.push(verdict.exemption);
        }
        if (verdict.violation) {
          violations.push({ ...verdict.violation, scope: 'arg' });
        }
      }
      lines.push(`extra file: ${relativePath} (scanned)`);
    }
  }

  for (const root of roots) {
    const files = listFilesRecursive(root.path);
    lines.push(`${root.scope === 'evidence' ? 'evidence dir' : 'extra root'}: ${root.path} (${files.length} files)`);
    for (const absolute of files) {
      const relativePath = toRepoRelative(absolute);
      const kind = classifyGameAudioPath(relativePath);
      if (!kind) {
        continue;
      }
      const verdict = verdictFor(absolute, relativePath, kind);
      if (verdict.exemption) {
        exemptions.push(verdict.exemption);
      }
      if (verdict.violation) {
        violations.push({ ...verdict.violation, scope: root.scope });
      }
    }
  }

  lines.push(`registered synthetic artifacts: ${SYNTHETIC_ARTIFACTS.size} (hash-locked; absent entries are fine)`);
  lines.push(`synthetic exemptions matched: ${exemptions.length} (hash-verified)`);
  for (const exemption of exemptions) {
    lines.push(`  exempt: ${exemption.path} - ${exemption.reason}`);
  }

  for (const violation of violations) {
    const detail = violation.reason.length > 0 ? ` (${violation.reason})` : '';
    lines.push(`VIOLATION ${violation.scope}: ${violation.path} [${violation.kind}]${detail}`);
  }
  lines.push(`RESULT: ${violations.length} violation${violations.length === 1 ? '' : 's'}`);

  if (violations.length > 0) {
    lines.push('scan-no-assets: FAIL');
    console.log(lines.join('\n'));

    return 1;
  }
  lines.push('scan-no-assets: OK');
  console.log(lines.join('\n'));

  return 0;
}

function resolveExtraPath(argument) {
  const candidates = isAbsolute(argument) ? [argument] : [resolve(process.cwd(), argument), join(REPO_ROOT, argument)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`extra path does not exist (cwd or repo root): ${argument}`);
}

function sha256File(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

function toRepoRelative(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

/**
 * Decide whether one existing file is a violation. The registered synthetic artifacts are hash-verified
 * (a mismatch is itself a violation, with the reason attached).
 */
function verdictFor(absolutePath, relativePath, kind) {
  const registered = SYNTHETIC_ARTIFACTS.get(relativePath.toLowerCase());
  if (registered && kind !== 'genrl-bank') {
    const actual = sha256File(absolutePath);
    if (actual === registered.sha256) {
      return { exemption: { path: relativePath, reason: registered.reason }, violation: null };
    }

    return {
      exemption: null,
      violation: {
        kind,
        path: relativePath,
        reason: `registered synthetic artifact changed (sha256 ${actual} != ${registered.sha256})`,
      },
    };
  }

  return { exemption: null, violation: { kind, path: relativePath, reason: '' } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`scan-no-assets: ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
