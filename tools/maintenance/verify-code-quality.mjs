#!/usr/bin/env node
/*
 * verify-code-quality.mjs - F2 final-verification for the plan
 * `.omo/plans/flight-analysis-remediation-and-worktree-cleanup.md`.
 *
 * Every run is FRESH: it re-reads the baseline, re-runs git, re-runs tsc and
 * eslint, and re-scans the diff. Nothing is cached or assumed.
 *
 * What it checks:
 *   (a) reads the baseline commit from `.omo/evidence/baseline-commit.txt`
 *       (written by plan todo 1) and verifies the commit object exists;
 *   (b) derives changed files (tracked, vs the baseline) plus untracked files.
 *       `.omo/**` is plan/evidence material: it is listed and then excluded
 *       from code scanning with a recorded note (never silently skipped);
 *   (c) runs `npx tsc --noEmit -p tsconfig.json` from `tools/opensa`; every
 *       reported type error is a violation;
 *   (d) runs the project `npx eslint` (tools/opensa/eslint.config.ts) on the
 *       derived JS/TS files. An error on an added line (for tracked files) or
 *       in a new file is a NEW lint error -> violation; an error on an
 *       unchanged line is pre-existing and only reported. Files the config
 *       explicitly ignores are recorded, not silently skipped;
 *   (e) mechanically scans the added diff lines for the plan's Must-NOT list:
 *       - a cast-to-any expression,
 *       - TS suppression comments (the ignore and expect-error forms),
 *       - empty catch blocks: a catch body with no code and no comment. A
 *         comment-only body is allowed by the project's no-empty rule and is
 *         reported separately as an observation,
 *       - GTA asset files among the derived files,
 *       - the forbidden motion-interpolation filter name anywhere in the
 *         25-to-60/120 fps path.
 *
 * The full report is printed to stdout AND written to
 * `.omo/evidence/F2-flight-analysis-remediation-and-worktree-cleanup.txt`.
 *
 * Exit codes: 0 = clean; 1 = violations (each printed as file:line); 2 = scan
 * error (the check could not be completed - e.g. missing baseline, git failing,
 * or tsc/eslint not runnable).
 *
 * Usage:
 *   node tools/maintenance/verify-code-quality.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const OPENSA_DIR = join(REPO_ROOT, 'tools', 'opensa');
const BASELINE_PATH = join(REPO_ROOT, '.omo', 'evidence', 'baseline-commit.txt');
const EVIDENCE_PATH = join(
  REPO_ROOT,
  '.omo',
  'evidence',
  'F2-flight-analysis-remediation-and-worktree-cleanup.txt',
);

const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
const CATCH_SCAN_EXTENSIONS = new Set([...JS_TS_EXTENSIONS, '.html', '.c', '.cc', '.cpp', '.h', '.hpp']);
const LITERAL_SCAN_EXTENSIONS = new Set([...JS_TS_EXTENSIONS, '.html']);
const SOURCE_LIKE_EXTENSIONS = new Set([
  ...JS_TS_EXTENSIONS,
  '.c', '.cc', '.cpp', '.h', '.hpp',
  '.json', '.md', '.txt', '.csv', '.html', '.css', '.ps1', '.cmd', '.sh', '.yml', '.yaml',
]);
const ASSET_EXTENSIONS = new Set([
  '.dff', '.txd', '.img', '.ifp', '.col', '.sfx', '.adf',
  '.wav', '.wave', '.ogg', '.mp3', '.aac', '.flac', '.m4a',
  '.asi', '.dll', '.exe',
]);

// The 25-to-60/120 fps resampling/export path: the CSV sampling, the browser
// app, the standalone entry, the export server, and everything under the
// flight/export scripts. A hit outside this set is still reported, as a note.
const MOTION_PATH_RE = /(export|video|fps|frame|csv|camera|hud|flight-replay|audio-offline|audio-engine)/i;

// Forbidden literals, assembled at runtime so this verifier's own source does
// not contain the exact strings it searches for (self-scan stays honest).
const FORBIDDEN_LITERALS = [
  {
    id: 'cast-any',
    label: 'cast-to-any',
    pattern: new RegExp('\\bas' + '\\s+any\\b'),
  },
  {
    id: 'ts-ignore-comment',
    label: 'TS suppression comment (ignore form)',
    pattern: new RegExp('@' + 'ts-' + 'ignore\\b'),
  },
  {
    id: 'ts-expect-error-comment',
    label: 'TS suppression comment (expect-error form)',
    pattern: new RegExp('@' + 'ts-' + 'expect-error\\b'),
  },
];

const MOTION_FILTER_NAME = 'minter' + 'polate';
const MOTION_FILTER_PATTERN = new RegExp(MOTION_FILTER_NAME);

const CATCH_OPENER = /\bcatch\s*(?:\([^()]*\))?\s*\{/;

function main() {
  const startedAt = new Date();
  const report = [];
  const emit = (line) => {
    report.push(line);
    console.log(line);
  };

  const violations = [];
  const scanErrors = [];
  const notes = [];

  emit('F2 code-quality verification - plan flight-analysis-remediation-and-worktree-cleanup');
  emit(`run (local time): ${startedAt.toString()}`);
  emit(`node: ${process.version} on ${process.platform}`);
  emit(`repo root: ${REPO_ROOT}`);
  emit('');

  if (!existsSync(BASELINE_PATH)) {
    fail(emit, scanErrors, `baseline file not found: ${BASELINE_PATH} (plan todo 1 must write it)`);
    return finish(emit, report, violations, scanErrors);
  }

  const baseline = readFileSync(BASELINE_PATH, 'utf8').trim();
  emit(`baseline from .omo/evidence/baseline-commit.txt: ${baseline}`);
  if (!/^[0-9a-f]{40}$/.test(baseline)) {
    fail(emit, scanErrors, `baseline is not a 40-hex commit: ${JSON.stringify(baseline)}`);
    return finish(emit, report, violations, scanErrors);
  }
  const resolvedBaseline = git(['rev-parse', '--verify', baseline + '^{commit}']);
  emit(`baseline commit verified: ${resolvedBaseline}`);
  emit(`HEAD: ${git(['rev-parse', 'HEAD'])}`);
  emit('');

  // ---------------------------------------------------------------- (b) files
  emit('== Derived files vs baseline (changed + untracked) ==');
  const statusLines = git(['diff', '--name-status', '--no-renames', '-z', baseline, '--'])
    .split('\u0000')
    .filter((entry) => entry.length > 0);
  const changed = [];
  const deleted = [];
  for (let i = 0; i + 1 < statusLines.length; i += 2) {
    const status = statusLines[i];
    const file = statusLines[i + 1];
    if (status.startsWith('D')) {
      deleted.push(file);
    } else {
      changed.push({ file, status });
    }
  }
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\u0000')
    .filter((entry) => entry.length > 0);

  emit(`changed tracked files: ${changed.length}`);
  for (const entry of changed) {
    emit(`  ${entry.status} ${entry.file}`);
  }
  emit(`deleted tracked files: ${deleted.length} (recorded, not scanned)`);
  for (const file of deleted) {
    emit(`  D ${file}`);
  }
  const evidenceArtifacts = untracked.filter((file) => file.startsWith('.omo/'));
  const untrackedCode = untracked.filter((file) => !file.startsWith('.omo/'));
  emit(`untracked files: ${untracked.length} (${untrackedCode.length} code/config, ${evidenceArtifacts.length} under .omo/)`);
  for (const file of untrackedCode) {
    emit(`  ?? ${file}`);
  }
  if (evidenceArtifacts.length > 0) {
    emit(`  ?? .omo/** (${evidenceArtifacts.length} files: plan + evidence artifacts)`);
    notes.push(
      `excluded from code scans: ${evidenceArtifacts.length} untracked file(s) under .omo/ ` +
        '(plan/evidence material, not shipped code)',
    );
  }
  emit('');

  const derived = [...changed.map((entry) => entry.file), ...untracked];
  const untrackedSet = new Set(untracked);
  const scanCandidates = derived.filter(
    (file) =>
      !file.startsWith('.omo/') &&
      LITERAL_SCAN_EXTENSIONS.has(extname(file).toLowerCase()),
  );
  const catchCandidates = derived.filter(
    (file) =>
      !file.startsWith('.omo/') &&
      CATCH_SCAN_EXTENSIONS.has(extname(file).toLowerCase()),
  );
  const lintCandidates = derived.filter(
    (file) =>
      !file.startsWith('.omo/') &&
      JS_TS_EXTENSIONS.has(extname(file).toLowerCase()),
  );

  // Added-line map: untracked file -> null (every line is new); tracked file ->
  // Set of line numbers added vs the baseline (git diff with unified=0).
  const addedLinesByFile = new Map();
  for (const file of new Set([...lintCandidates, ...scanCandidates, ...catchCandidates])) {
    addedLinesByFile.set(file, untrackedSet.has(file) ? null : addedLinesFor(baseline, file));
  }

  // ------------------------------------------------------------------ (c) tsc
  emit('== (c) TypeScript ==');
  const tscCmd = 'npx tsc --noEmit -p tsconfig.json';
  emit(`command: ${tscCmd}  (cwd: tools/opensa)`);
  const tscStarted = Date.now();
  const tsc = runNpx(['tsc', '--noEmit', '-p', 'tsconfig.json'], OPENSA_DIR);
  const tscSeconds = ((Date.now() - tscStarted) / 1000).toFixed(1);
  emit(`exit: ${tsc.status}  (${tscSeconds}s)`);
  let typeErrorCount = 0;
  if (tsc.status === null) {
    fail(emit, scanErrors, 'tsc did not produce an exit status (process failed to spawn)');
  } else {
    const tscErrors = parseTscErrors(tsc.output);
    typeErrorCount = tscErrors.length;
    emit(`type errors: ${typeErrorCount}`);
    for (const error of tscErrors) {
      emit(`  ${error.file}:${error.line}:${error.column}: ${error.code}: ${error.message}`);
      violations.push({ kind: 'type-error', location: `${error.file}:${error.line}`, detail: `${error.code}: ${error.message}` });
    }
    if (tsc.status !== 0 && typeErrorCount === 0) {
      fail(
        emit,
        scanErrors,
        `tsc exited ${tsc.status} with no parseable TS error - output follows:\n${indent(tsc.output.slice(-4000))}`,
      );
    }
  }
  emit('');

  // -------------------------------------------------------------- (d) eslint
  emit('== (d) ESLint ==');
  const inside = lintCandidates.filter((file) => file.startsWith('tools/opensa/'));
  const outside = lintCandidates.filter((file) => !file.startsWith('tools/opensa/'));
  emit(`derived JS/TS files: ${lintCandidates.length} (${inside.length} under tools/opensa, ${outside.length} elsewhere)`);

  let newLintErrors = 0;
  let preExistingLintErrors = 0;
  let lintWarnings = 0;
  const ignoredFromLint = [];
  const lintReportDir = join(tmpdir(), `vf2-eslint-${process.pid}`);
  mkdirSync(lintReportDir, { recursive: true });

  if (inside.length > 0) {
    const chunks = chunk(inside, 50);
    for (let index = 0; index < chunks.length; index++) {
      const files = chunks[index].map((file) => relative(OPENSA_DIR, join(REPO_ROOT, file)).split(sep).join('/'));
      const reportFile = join(lintReportDir, `inside-${index}.json`);
      const args = ['eslint', ...files, '-f', 'json', '-o', reportFile.split(sep).join('/')];
      const cmdLine = `npx ${args.map(quoteArg).join(' ')}`;
      emit(`command: ${cmdLine}  (cwd: tools/opensa)`);
      const lintStarted = Date.now();
      const run = runNpx(args, OPENSA_DIR);
      emit(`exit: ${run.status}  (${((Date.now() - lintStarted) / 1000).toFixed(1)}s)`);
      if (run.status === null) {
        fail(emit, scanErrors, 'eslint did not produce an exit status (process failed to spawn)');
        continue;
      }
      if (run.status === 2) {
        fail(
          emit,
          scanErrors,
          `eslint exited 2 (fatal) for chunk ${index + 1} - stderr follows:\n${indent(run.errorOutput.slice(-4000))}`,
        );
      }
      if (run.errorOutput.trim().length > 0) {
        emit(`stderr: ${indent(run.errorOutput.trim()).trim()}`);
      }
      if (!existsSync(reportFile)) {
        fail(emit, scanErrors, `eslint wrote no JSON report for chunk ${index + 1}: ${reportFile}`);
        continue;
      }
      let results;
      try {
        results = JSON.parse(readFileSync(reportFile, 'utf8'));
      } catch (error) {
        fail(emit, scanErrors, `eslint JSON report unreadable for chunk ${index + 1}: ${String(error)}`);
        continue;
      }
      const seen = new Set();
      for (const result of results) {
        const relPath = toRepoRelative(result.filePath);
        seen.add(relPath);
        if (result.messages.some((message) => /^File ignored/.test(message.message || ''))) {
          for (const message of result.messages) {
            if (/^File ignored/.test(message.message || '')) {
              ignoredFromLint.push({ file: relPath, reason: message.message });
            }
          }
          continue;
        }
        lintWarnings += result.warningCount;
        const fileIsUntracked = untrackedSet.has(relPath);
        const added = addedLinesByFile.get(relPath);
        for (const message of result.messages) {
          const isError = message.severity === 2 || message.fatal === true;
          if (!isError) {
            continue;
          }
          const isNew = fileIsUntracked || message.fatal === true || (message.line > 0 && added !== null && added.has(message.line));
          if (isNew) {
            newLintErrors += 1;
            violations.push({ kind: 'lint-error', location: `${relPath}:${message.line}`, detail: `${message.ruleId || 'fatal'}: ${message.message}` });
            emit(`  NEW ${relPath}:${message.line}:${message.column}  ${message.ruleId || 'fatal'}  ${message.message}`);
          } else {
            preExistingLintErrors += 1;
          }
        }
      }
      for (const file of files) {
        if (!seen.has(file)) {
          emit(`  note: eslint returned no result row for ${file}`);
        }
      }
    }
  }

  if (outside.length > 0) {
    emit(`files outside the tools/opensa eslint base path (attempted, outcome recorded):`);
    for (const file of outside) {
      const reportFile = join(lintReportDir, 'outside.json');
      const args = ['eslint', '--config', 'eslint.config.ts', relative(OPENSA_DIR, join(REPO_ROOT, file)).split(sep).join('/'), '-f', 'json', '-o', reportFile.split(sep).join('/')];
      emit(`  command: npx ${args.map(quoteArg).join(' ')}  (cwd: tools/opensa)`);
      const run = runNpx(args, OPENSA_DIR);
      emit(`  exit: ${run.status}`);
      if (run.status === 2) {
        emit(`  recorded exclusion: eslint refused to run for ${file}: ${run.errorOutput.trim().split(/\r?\n/).find((line) => line.length > 0) || 'fatal error'}`);
        continue;
      }
      if (!existsSync(reportFile)) {
        emit(`  recorded exclusion: eslint wrote no report for ${file}`);
        continue;
      }
      let results = [];
      try {
        results = JSON.parse(readFileSync(reportFile, 'utf8'));
      } catch {
        results = [];
      }
      const result = results.find((entry) => toRepoRelative(entry.filePath) === file) || results[0];
      const messages = result ? result.messages : [];
      const ignoredMessage = messages.find((message) => /^File ignored/.test(message.message || ''));
      if (ignoredMessage) {
        ignoredFromLint.push({ file, reason: ignoredMessage.message });
        emit(`  recorded exclusion: ${file} -> ${ignoredMessage.message}`);
      } else {
        emit(`  linted: ${file} (errors=${result ? result.errorCount : 'unknown'}, warnings=${result ? result.warningCount : 'unknown'})`);
      }
    }
  }

  emit(`summary: new lint errors=${newLintErrors}, pre-existing lint errors on unchanged lines=${preExistingLintErrors}, warnings=${lintWarnings}`);
  emit(`explicitly excluded from lint (recorded, not counted): ${ignoredFromLint.length}`);
  for (const entry of ignoredFromLint) {
    emit(`  ${entry.file} -> ${entry.reason}`);
  }
  emit('');

  // ------------------------------------------------------------- (e) scans
  emit('== (e) Must-NOT scans (added diff lines; untracked file = all lines) ==');

  // [1..3] forbidden literals.
  for (const item of FORBIDDEN_LITERALS) {
    const hits = [];
    for (const file of scanCandidates) {
      const lines = readLines(file);
      const added = addedLinesByFile.get(file);
      for (let i = 0; i < lines.length; i++) {
        if (added !== null && !added.has(i + 1)) {
          continue;
        }
        if (item.pattern.test(lines[i])) {
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    emit(`[${item.id}] ${item.label}: ${hits.length} hit(s)`);
    for (const hit of hits) {
      emit(`  ${hit.file}:${hit.line}: ${truncate(hit.text, 160)}`);
      violations.push({ kind: item.id, location: `${hit.file}:${hit.line}`, detail: truncate(hit.text, 160) });
    }
  }

  // [4] empty catch blocks.
  let emptyCatchHits = 0;
  let commentOnlyCatches = 0;
  for (const file of catchCandidates) {
    const lines = readLines(file);
    const added = addedLinesByFile.get(file);
    for (const block of findCatchBlocks(lines)) {
      if (block.hasCode) {
        continue;
      }
      if (block.hasComment) {
        commentOnlyCatches += 1;
        continue;
      }
      const isNew =
        added === null ||
        block.blockLines.some((lineNumber) => added.has(lineNumber));
      if (!isNew) {
        continue;
      }
      emptyCatchHits += 1;
      emit(`  ${file}:${block.startLine}: empty catch block (no code, no comment)`);
      violations.push({ kind: 'empty-catch', location: `${file}:${block.startLine}`, detail: `block lines ${block.startLine}-${block.endLine}` });
    }
  }
  emit(`[empty-catch] empty catch blocks: ${emptyCatchHits} violation(s); comment-only catch blocks (allowed by no-empty): ${commentOnlyCatches}`);

  // [5] GTA asset files among the derived files.
  const assetHits = [];
  for (const file of derived) {
    if (file.startsWith('.omo/')) {
      continue;
    }
    const assetKind = classifyGtaAsset(file);
    if (!assetKind) {
      continue;
    }
    const tracked = untrackedSet.has(file) ? 'untracked' : 'tracked-in-diff';
    assetHits.push({ file, kind: assetKind, tracked });
  }
  emit(`[gta-asset] GTA asset files among the derived set: ${assetHits.length} hit(s)`);
  for (const hit of assetHits) {
    emit(`  ${hit.file} (${hit.tracked}; ${hit.kind})`);
    violations.push({ kind: 'gta-asset', location: hit.file, detail: `${hit.tracked}; ${hit.kind}` });
  }

  // [6] motion-interpolation filter in the 25-to-60/120 path.
  const motionHits = [];
  for (const file of scanCandidates) {
    const lines = readLines(file);
    const added = addedLinesByFile.get(file);
    for (let i = 0; i < lines.length; i++) {
      if (added !== null && !added.has(i + 1)) {
        continue;
      }
      if (MOTION_FILTER_PATTERN.test(lines[i])) {
        motionHits.push({ file, line: i + 1, inPath: MOTION_PATH_RE.test(file), text: lines[i].trim() });
      }
    }
  }
  const motionViolations = motionHits.filter((hit) => hit.inPath);
  emit(`[motion-filter] "${MOTION_FILTER_NAME}" occurrences in scanned added lines: ${motionHits.length} (${motionViolations.length} inside the 25-to-60/120 path)`);
  for (const hit of motionHits) {
    const where = hit.inPath ? '25-to-60/120 path' : 'outside the export path (recorded)';
    emit(`  ${hit.file}:${hit.line}: ${where}: ${truncate(hit.text, 160)}`);
    if (hit.inPath) {
      violations.push({ kind: 'motion-filter', location: `${hit.file}:${hit.line}`, detail: truncate(hit.text, 160) });
    }
  }
  emit('');

  return finish(emit, report, violations, scanErrors, notes);
}

function finish(emit, report, violations, scanErrors, notes = []) {
  emit('== Verdict ==');
  for (const note of notes) {
    emit(`note: ${note}`);
  }
  emit(`violations: ${violations.length}`);
  for (const violation of violations) {
    emit(`  VIOLATION [${violation.kind}] ${violation.location}${violation.detail ? ` - ${violation.detail}` : ''}`);
  }
  emit(`scan errors: ${scanErrors.length}`);
  for (const error of scanErrors) {
    emit(`  SCAN-ERROR ${error}`);
  }
  if (violations.length > 0) {
    emit('RESULT: VIOLATIONS (exit 1)');
  } else if (scanErrors.length > 0) {
    emit('RESULT: SCAN-ERROR (exit 2)');
  } else {
    emit('RESULT: PASS (exit 0)');
  }

  try {
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, report.join('\n') + '\n', 'utf8');
    console.log(`evidence written: ${EVIDENCE_PATH}`);
  } catch (error) {
    console.error(`failed to write evidence: ${String(error)}`);
    scanErrors.push(`cannot write evidence: ${String(error)}`);
  }

  if (violations.length > 0) {
    return 1;
  }
  if (scanErrors.length > 0) {
    return 2;
  }
  return 0;
}

function fail(emit, scanErrors, message) {
  scanErrors.push(message);
  emit(`SCAN-ERROR: ${message}`);
}

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  }).trim();
}

function runNpx(args, cwd) {
  const useShellPath = args.every((arg) => /^[A-Za-z0-9_./@:+-]+$/.test(arg));
  let result;
  if (useShellPath && process.platform === 'win32') {
    result = spawnSync(`npx ${args.map(quoteArg).join(' ')}`, {
      cwd,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
    });
  } else if (useShellPath) {
    result = spawnSync('npx', args, {
      cwd,
      shell: false,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
    });
  } else {
    // Path contains characters a shell could interpret: run the local package
    // entry directly instead of building a command line.
    const directEntry = args[0] === 'tsc'
      ? join(OPENSA_DIR, 'node_modules', 'typescript', 'bin', 'tsc')
      : join(OPENSA_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js');
    result = spawnSync(process.execPath, [directEntry, ...args.slice(1)], {
      cwd,
      shell: false,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
    });
  }

  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
    errorOutput: result.stderr || '',
  };
}

function quoteArg(arg) {
  return /^[A-Za-z0-9_./@:+-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function addedLinesFor(baseline, file) {
  const diff = git(['diff', '-U0', '--no-color', '--no-ext-diff', baseline, '--', file]);
  const added = new Set();
  let newLine = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('@@')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (match) {
        newLine = Number(match[1]);
      }
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) {
      continue;
    }
    if (raw.startsWith('+')) {
      added.add(newLine);
      newLine += 1;
    } else if (raw.startsWith('-')) {
      // removed line: the new-file counter does not advance
    } else if (raw.startsWith(' ')) {
      newLine += 1;
    }
  }
  return added;
}

function parseTscErrors(output) {
  const errors = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(raw.trim());
    if (match) {
      const printed = match[1].split(sep).join('/');
      errors.push({
        file: toRepoRelative(isAbsolute(printed) ? printed : join(OPENSA_DIR, printed)),
        line: Number(match[2]),
        column: Number(match[3]),
        code: match[4],
        message: match[5],
      });
    }
  }
  return errors;
}

function readLines(file) {
  return readFileSync(join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
}

function findCatchBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!CATCH_OPENER.test(lines[i])) {
      continue;
    }
    const block = readCatchBlock(lines, i);
    if (block) {
      blocks.push(block);
    }
  }
  return blocks;
}

/*
 * Reads one catch block starting on `startLine` (0-based), tolerant of braces,
 * strings and comments, capped at 400 lines. Returns null when the block is not
 * closed within the cap.
 */
function readCatchBlock(lines, startLine) {
  const window = lines.slice(startLine, Math.min(lines.length, startLine + 400));
  const text = window.join('\n');
  const open = text.search(/\{/);
  if (open < 0) {
    return null;
  }
  let depth = 0;
  let hasCode = false;
  let hasComment = false;
  let state = 'code';
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (state === 'line-comment') {
      hasComment = true;
      if (char === '\n') {
        state = 'code';
      }
      continue;
    }
    if (state === 'block-comment') {
      hasComment = true;
      if (char === '*' && next === '/') {
        state = 'code';
        i += 1;
      }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      i += 1;
      continue;
    }
    if (char === "'") {
      state = 'single';
      continue;
    }
    if (char === '"') {
      state = 'double';
      continue;
    }
    if (char === '`') {
      state = 'template';
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const endLine = startLine + countNewlines(text.slice(0, i)) + 1;
        const blockLines = [];
        for (let lineNumber = startLine + 1; lineNumber <= endLine; lineNumber++) {
          blockLines.push(lineNumber);
        }
        return { startLine: startLine + 1, endLine, hasCode, hasComment, blockLines };
      }
      continue;
    }
    if (depth >= 1 && !/\s/.test(char)) {
      hasCode = true;
    }
  }
  return null;
}

function countNewlines(text) {
  let count = 0;
  for (const char of text) {
    if (char === '\n') {
      count += 1;
    }
  }
  return count;
}

function classifyGtaAsset(file) {
  const lower = file.toLowerCase();
  if (lower.startsWith('gta san andreas/')) {
    return 'path under GTA San Andreas/';
  }
  if (lower.startsWith('audio/sfx/')) {
    return 'path under audio/SFX/';
  }
  const extension = extname(lower);
  if (ASSET_EXTENSIONS.has(extension)) {
    return `asset-like extension ${extension}`;
  }
  if (lower.includes('genrl') && !SOURCE_LIKE_EXTENSIONS.has(extension)) {
    return 'GENRL bank name';
  }
  return null;
}

function toRepoRelative(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function indent(text) {
  return text
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
}

try {
  process.exitCode = main();
} catch (error) {
  const message = `SCAN-ERROR: unhandled failure: ${error && error.stack ? error.stack : String(error)}`;
  console.error(message);
  try {
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, `${message}\n`, 'utf8');
    console.error(`evidence written (failure report): ${EVIDENCE_PATH}`);
  } catch {
    // the original failure is the one that matters
  }
  process.exitCode = 2;
}