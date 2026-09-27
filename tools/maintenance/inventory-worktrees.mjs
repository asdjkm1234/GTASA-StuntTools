#!/usr/bin/env node
/*
 * tools/maintenance/inventory-worktrees.mjs
 *
 * READ-ONLY inventory + preservation for the five linked Codex worktrees
 * (analysis, audio, fx, integration, video).
 *
 * What it does
 *   - reads LIVE git state (never cached): path, branch, HEAD, `git status
 *     --porcelain=v2`, tracked-tree hash of the working tree;
 *   - compares each branch against `main` at the file/blob level;
 *   - inventories every ignored artifact by path/size/hash;
 *   - compares every pak `index.json` (size/sha256 + replayAssets.version)
 *     against the main worktree's;
 *   - creates a real restorable `git bundle` of the five branch tips and
 *     verifies it with `git bundle verify` (never assumes success);
 *   - copies any UNIQUE ignored artifact into a preservation directory;
 *   - writes the inventory JSON with NO digest field, then writes the JSON
 *     file's SHA-256 to a sidecar `<out>.sha256` (non-self-referential).
 *
 * Safety invariants (enforced by assertSafeGitArgs)
 *   - never deletes anything;
 *   - never runs `git worktree remove` / `git worktree prune`;
 *   - never touches `.git/worktrees/*` directly;
 *   - never passes `--force` (or `-f`, `-D`, `hash-object -w`);
 *   - never commits in the real repository (commits are allowed only inside
 *     the sandboxed `--self-test` scratch repo).
 *
 * Usage
 *   node tools/maintenance/inventory-worktrees.mjs [--out <path>]
 *        [--bundle <path>] [--preserve-dir <dir>] [--repo <root>] [--reuse-bundle]
 *   node tools/maintenance/inventory-worktrees.mjs --self-test
 *
 * Defaults
 *   --out          .omo/evidence/task-6-flight-analysis-remediation-and-worktree-cleanup.json
 *   sidecar        <out>.sha256
 *   --bundle       <out dir>/task-6-worktree-branches.bundle
 *   --preserve-dir <out dir>/worktree-preservation
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'gtasa-stunttools.worktree-inventory/v1';
const EXPECTED_WORKTREES = [
  { name: 'analysis', branch: 'codex/flight-analysis' },
  { name: 'audio', branch: 'codex/flight-audio' },
  { name: 'fx', branch: 'codex/flight-fx' },
  { name: 'integration', branch: 'codex/flight-features-integration' },
  { name: 'video', branch: 'codex/flight-video' },
];
const DEFAULT_OUT = path.join('.omo', 'evidence', 'task-6-flight-analysis-remediation-and-worktree-cleanup.json');
const BASELINE_BRANCH = 'main';
const PAK_SCAN_ROOTS = ['tools/opensa', 'web-replay'];

const log = (msg) => process.stderr.write(`[inventory] ${msg}\n`);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function nowIso() {
  return new Date().toISOString();
}

function utcStamp() {
  return nowIso().replace(/[:.]/g, '-');
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256FileSync(abs) {
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function sha256File(abs) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

function resolveMaybeRelative(root, p) {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isInsideCI(parent, child) {
  return isInside(parent.toLowerCase(), child.toLowerCase());
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// --- forbidden git operations ---------------------------------------------

function hasSequence(args, seq) {
  for (let i = 0; i + seq.length <= args.length; i += 1) {
    let ok = true;
    for (let j = 0; j < seq.length; j += 1) {
      if (args[i + j] !== seq[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

const FORBIDDEN_SEQUENCES = [
  ['worktree', 'remove'],
  ['worktree', 'prune'],
  ['worktree', 'repair'],
  ['branch', '-d'],
  ['branch', '-D'],
  ['branch', '--delete'],
  ['clean'],
  ['reset'],
  ['checkout'],
  ['switch'],
  ['stash', 'drop'],
  ['stash', 'clear'],
  ['reflog', 'delete'],
  ['gc'],
  ['prune'],
  ['update-ref'],
  ['push'],
];

function assertSafeGitArgs(args, opts) {
  if (args.includes('--force') || args.includes('-f') || args.includes('-D')) {
    throw new Error(`refusing forbidden git flag in: git ${args.join(' ')}`);
  }
  for (const seq of FORBIDDEN_SEQUENCES) {
    if (hasSequence(args, seq)) {
      throw new Error(`refusing forbidden git command: git ${args.join(' ')}`);
    }
  }
  if (args[0] === 'hash-object' && (args.includes('-w') || args.includes('--stdin'))) {
    throw new Error(`refusing writing git object: git ${args.join(' ')}`);
  }
  if (args[0] === 'worktree' && args[1] !== 'list' && !opts.sandbox) {
    throw new Error(`only "git worktree list" is allowed outside the --self-test sandbox: git ${args.join(' ')}`);
  }
  if (['init', 'add', 'commit', 'config'].includes(args[0]) && !opts.sandbox) {
    throw new Error(`git ${args[0]} is only allowed inside the --self-test sandbox`);
  }
}

function runGit(cwd, args, opts = {}) {
  assertSafeGitArgs(args, opts);
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input: opts.input,
    maxBuffer: opts.maxBuffer || 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error) {
    throw new Error(`failed to spawn git ${args.join(' ')}: ${res.error.message}`);
  }
  const status = res.status === null ? -1 : res.status;
  const out = {
    command: ['git', ...args],
    cwd,
    status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
  if (status !== 0 && !opts.allowFail) {
    const detail = (out.stderr || out.stdout).trim();
    throw new Error(`git ${args.join(' ')} exited ${status}${detail ? `\n${detail}` : ''}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// repo discovery
// ---------------------------------------------------------------------------

function findDotGitDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`not inside a git repository (started at ${start})`);
    }
    dir = parent;
  }
}

/**
 * Resolve the PRIMARY worktree root even when this script is executed from a
 * linked worktree (`.git` there is a file pointing into `.git/worktrees/`).
 */
function resolvePrimaryRoot(start) {
  const toplevel = findDotGitDir(start);
  const common = runGit(toplevel, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFail: true });
  if (common.status === 0) {
    const commonDir = common.stdout.trim();
    const candidate = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : null;
    if (candidate && fs.existsSync(path.join(candidate, '.git'))) return path.resolve(candidate);
  }
  return path.resolve(toplevel);
}

// ---------------------------------------------------------------------------
// worktree list parsing
// ---------------------------------------------------------------------------

function parseWorktreeList(text) {
  const blocks = [];
  let cur = null;
  const push = () => { if (cur && cur.path) blocks.push(cur); cur = null; };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line) { push(); continue; }
    if (!cur) cur = { path: null, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false, raw: [] };
    cur.raw.push(line);
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1);
    if (key === 'worktree') cur.path = value;
    else if (key === 'HEAD') cur.head = value;
    else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') cur.detached = true;
    else if (key === 'bare') cur.bare = true;
    else if (key === 'locked') cur.locked = true;
    else if (key === 'prunable') cur.prunable = true;
  }
  push();
  return blocks;
}

// ---------------------------------------------------------------------------
// status / tracked tree
// ---------------------------------------------------------------------------

function parsePorcelainV2Z(text) {
  const tokens = text.split('\0').filter((t) => t.length > 0);
  const records = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const kind = t[0];
    const rec = { raw: t, kind };
    if (kind === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const fields = t.split(' ');
      rec.xy = fields[1];
      rec.path = fields.slice(8).join(' ');
    } else if (kind === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
      const fields = t.split(' ');
      rec.xy = fields[1];
      rec.path = fields.slice(9).join(' ');
      rec.orig_path = tokens[i + 1];
      i += 1;
    } else if (kind === 'u') {
      const fields = t.split(' ');
      rec.xy = fields[1];
      rec.path = fields.slice(10).join(' ');
    } else if (kind === '?') {
      rec.path = t.slice(2);
    } else if (kind === '!') {
      rec.path = t.slice(2);
    }
    records.push(rec);
  }
  return records;
}

function summarizeStatus(records) {
  const counts = { changed: 0, renamed: 0, unmerged: 0, untracked: 0 };
  for (const r of records) {
    if (r.kind === '1') counts.changed += 1;
    else if (r.kind === '2') counts.renamed += 1;
    else if (r.kind === 'u') counts.unmerged += 1;
    else if (r.kind === '?') counts.untracked += 1;
  }
  return counts;
}

function splitLines(text) {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

function parseLsFilesZ(text) {
  const entries = [];
  for (const line of text.split('\0')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const meta = line.slice(0, tab).split(' ');
    entries.push({
      mode: meta[0],
      index_sha: meta[1],
      stage: meta[2],
      file: line.slice(tab + 1),
    });
  }
  return entries;
}

/**
 * Tracked-tree hash: SHA-256 over a deterministic manifest of every tracked
 * file as it exists in the working tree.
 *   `<mode> <stage> <blob-hash|MISSING> <path>` lines in index order.
 * Blob hashes come from `git hash-object --stdin-paths` (filters applied, so a
 * clean file hashes exactly to its index/HEAD blob).
 */
function computeTrackedTree(wtDir, onProgress) {
  const ls = runGit(wtDir, ['ls-files', '-s', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  const entries = parseLsFilesZ(ls.stdout);
  const present = [];
  const missing = [];
  for (const e of entries) {
    const abs = path.join(wtDir, ...e.file.split('/'));
    try {
      const st = fs.lstatSync(abs);
      if (st.isFile() || st.isSymbolicLink()) present.push(e);
      else missing.push(e);
    } catch {
      missing.push(e);
    }
  }

  const hashes = new Map();
  let method = 'git hash-object --stdin-paths (filters applied), manifest sha256';
  if (present.length > 0) {
    const input = `${present.map((e) => e.file).join('\n')}\n`;
    const r = runGit(wtDir, ['hash-object', '--stdin-paths'], {
      input,
      allowFail: true,
      maxBuffer: 256 * 1024 * 1024,
    });
    const lines = splitLines(r.stdout);
    if (r.status === 0 && lines.length === present.length) {
      present.forEach((e, i) => hashes.set(e.file, lines[i].trim()));
    } else {
      method = 'per-file git hash-object fallback, manifest sha256';
      for (const e of present) {
        const rr = runGit(wtDir, ['hash-object', '--', e.file], { allowFail: true });
        hashes.set(e.file, rr.status === 0 ? rr.stdout.trim() : 'UNHASHABLE');
      }
    }
  }

  if (onProgress) onProgress(`tracked tree: ${entries.length} files (${present.length} present, ${missing.length} missing)`);

  const h = createHash('sha256');
  let matchesIndex = true;
  for (const e of entries) {
    const wtHash = hashes.has(e.file) ? hashes.get(e.file) : 'MISSING';
    h.update(`${e.mode} ${e.stage} ${wtHash} ${e.file}\n`);
    if (e.stage !== '0' || wtHash !== e.index_sha) matchesIndex = false;
  }

  return {
    tracked_tree_hash: h.digest('hex'),
    tracked_tree_hash_method: method,
    tracked_file_count: entries.length,
    tracked_missing_files: missing.length,
    tracked_matches_index: entries.length > 0 ? matchesIndex : true,
  };
}

// ---------------------------------------------------------------------------
// hashing of ignored artifacts
// ---------------------------------------------------------------------------

function tryGitHashBatch(wtDir, absPaths) {
  try {
    const r = runGit(wtDir, ['hash-object', '--no-filters', '--stdin-paths'], {
      input: `${absPaths.join('\n')}\n`,
      allowFail: true,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.status !== 0) return null;
    const lines = splitLines(r.stdout);
    if (lines.length !== absPaths.length) return null;
    const out = new Map();
    absPaths.forEach((p, i) => out.set(p, lines[i].trim()));
    return out;
  } catch {
    return null;
  }
}

/**
 * Hash many files with git (raw content sha1). Absolute paths are passed so
 * resolution never depends on cwd or the worktree root. Failing chunks are
 * bisected so one unreadable file does not force a spawn per file.
 */
async function hashPathsGit(wtDir, absPaths) {
  const out = new Map();
  if (absPaths.length === 0) return out;
  const CHUNK = 1000;
  const queue = [];
  for (let i = 0; i < absPaths.length; i += CHUNK) queue.push(absPaths.slice(i, i + CHUNK));
  while (queue.length > 0) {
    const chunk = queue.shift();
    const got = tryGitHashBatch(wtDir, chunk);
    if (got) {
      for (const [k, v] of got) out.set(k, v);
      continue;
    }
    if (chunk.length === 1) {
      out.set(chunk[0], null);
      continue;
    }
    const mid = Math.floor(chunk.length / 2);
    queue.unshift(chunk.slice(mid));
    queue.unshift(chunk.slice(0, mid));
  }
  return out;
}

function walkDirectory(absDir, relBase, files, errors) {
  const stack = [{ abs: absDir, rel: relBase }];
  while (stack.length > 0) {
    const cur = stack.pop();
    let dirents;
    try {
      dirents = fs.readdirSync(cur.abs, { withFileTypes: true });
    } catch (err) {
      errors.push({ path: cur.rel || '.', error: err.message });
      continue;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      const childAbs = path.join(cur.abs, d.name);
      const childRel = cur.rel ? `${cur.rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        stack.push({ abs: childAbs, rel: childRel });
        continue;
      }
      try {
        const st = fs.lstatSync(childAbs);
        if (st.isSymbolicLink()) {
          files.push({ abs: childAbs, rel: childRel, size: 0, symlink: true, target: fs.readlinkSync(childAbs) });
        } else {
          files.push({ abs: childAbs, rel: childRel, size: st.size, symlink: false });
        }
      } catch (err) {
        errors.push({ path: childRel, error: err.message });
      }
    }
  }
}

async function inventoryDirectory(wtDir, absDir) {
  const files = [];
  const errors = [];
  walkDirectory(absDir, '', files, errors);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const hashable = files.filter((f) => !f.symlink).map((f) => toPosix(f.abs));
  const hashMap = await hashPathsGit(wtDir, hashable);

  const h = createHash('sha256');
  const unreadable = [];
  let total = 0;
  let usedFallback = 0;
  for (const f of files) {
    total += f.size;
    let fh;
    if (f.symlink) {
      fh = `symlink:${sha256Hex(Buffer.from(f.target, 'utf8'))}`;
    } else {
      const got = hashMap.get(toPosix(f.abs));
      if (got) {
        fh = got;
      } else {
        try {
          fh = `sha256:${await sha256File(f.abs)}`;
          usedFallback += 1;
        } catch (err) {
          fh = 'UNREADABLE';
          unreadable.push({ path: f.rel, error: err.message });
        }
      }
    }
    h.update(`${fh}  ${f.size}  ${f.rel}\n`);
  }

  return {
    kind: 'directory',
    symlink_target: null,
    resolved_target: null,
    size_bytes: total,
    file_count: files.length,
    sha256: h.digest('hex'),
    hash_method: usedFallback > 0
      ? 'sha256(manifest: "<git blob sha1 | sha256:content>  <size>  <relpath>" lines, sorted by relpath; mixed fallback)'
      : 'sha256(manifest: "<git blob sha1>  <size>  <relpath>" lines, sorted by relpath)',
    unreadable,
    walk_errors: errors,
  };
}

async function inventoryFile(absFile) {
  const st = fs.lstatSync(absFile);
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(absFile);
    let resolved = null;
    try {
      resolved = toPosix(fs.realpathSync(absFile));
    } catch { /* dangling link */ }
    return {
      kind: 'symlink',
      symlink_target: target,
      resolved_target: resolved,
      size_bytes: 0,
      file_count: 0,
      sha256: sha256Hex(Buffer.from(target, 'utf8')),
      hash_method: 'sha256(symlink target string)',
      unreadable: [],
      walk_errors: [],
    };
  }
  return {
    kind: 'file',
    symlink_target: null,
    resolved_target: null,
    size_bytes: st.size,
    file_count: 1,
    sha256: await sha256File(absFile),
    hash_method: 'sha256(file content)',
    unreadable: [],
    walk_errors: [],
  };
}

async function inventoryIgnoredEntry(wtDir, wtAbs, relPathWithSlash) {
  const isDir = relPathWithSlash.endsWith('/');
  const rel = isDir ? relPathWithSlash.slice(0, -1) : relPathWithSlash;
  const abs = path.join(wtAbs, ...rel.split('/'));
  if (!fs.existsSync(abs)) {
    return {
      path: relPathWithSlash,
      kind: 'missing',
      symlink_target: null,
      resolved_target: null,
      size_bytes: 0,
      file_count: 0,
      sha256: null,
      hash_method: null,
      unreadable: [],
      walk_errors: [{ path: rel, error: 'ignored path no longer exists' }],
    };
  }
  const st = fs.lstatSync(abs);
  const inv = st.isDirectory()
    ? await inventoryDirectory(wtDir, abs)
    : await inventoryFile(abs);
  return { path: relPathWithSlash, ...inv };
}

// ---------------------------------------------------------------------------
// pak index comparison
// ---------------------------------------------------------------------------

function scanPakIndexes(rootDir) {
  const found = [];
  for (const base of PAK_SCAN_ROOTS) {
    const abs = path.join(rootDir, ...base.split('/'));
    let dirents = [];
    try {
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (!d.isDirectory() || !d.name.startsWith('map-pak')) continue;
      const idxAbs = path.join(abs, d.name, 'index.json');
      if (!fs.existsSync(idxAbs)) continue;
      found.push(describePakIndex(`${base}/${d.name}/index.json`, idxAbs));
    }
  }
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return found;
}

function describePakIndex(rel, abs) {
  const st = fs.statSync(abs);
  let version = null;
  let parseError = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    version = parsed && parsed.replayAssets ? parsed.replayAssets.version : null;
  } catch (err) {
    parseError = err.message;
  }
  return {
    path: rel,
    size_bytes: st.size,
    sha256: sha256FileSync(abs),
    replayAssets_version: version === undefined ? null : version,
    parse_error: parseError,
  };
}

// ---------------------------------------------------------------------------
// inventory core
// ---------------------------------------------------------------------------

async function runInventory(options) {
  const {
    repoRoot,
    outPath,
    bundlePath,
    preserveDir,
    mode,
    baselineBranch = BASELINE_BRANCH,
    reuseBundle = false,
    progress = log,
  } = options;

  const warnings = [];
  const errors = [];

  // --- live repo state -----------------------------------------------------
  progress(`repo root: ${repoRoot}`);
  const gitVersion = runGit(repoRoot, ['--version']).stdout.trim();
  const worktreeList = runGit(repoRoot, ['worktree', 'list', '--porcelain']).stdout;
  const blocks = parseWorktreeList(worktreeList);
  const repoRootLower = repoRoot.toLowerCase();
  const primaryBlock = blocks.find((b) => path.resolve(b.path).toLowerCase() === repoRootLower) || blocks[0];
  const mainHead = runGit(repoRoot, ['rev-parse', baselineBranch]).stdout.trim();
  const mainTree = runGit(repoRoot, ['rev-parse', `${baselineBranch}^{tree}`]).stdout.trim();

  const blockByPath = new Map();
  for (const b of blocks) blockByPath.set(path.resolve(b.path).toLowerCase(), b);

  // --- main worktree ignored baseline (paths only; hash only the subset
  //     whose relative path also appears in a linked worktree) ---------------
  const mainStatus = runGit(repoRoot, ['status', '--porcelain=v2', '-z', '--ignored=matching'], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const mainStatusRecords = parsePorcelainV2Z(mainStatus.stdout);
  const mainIgnoredPaths = mainStatusRecords.filter((r) => r.kind === '!').map((r) => r.path);

  // --- linked worktrees: read live state -----------------------------------
  const worktrees = [];
  for (const expected of EXPECTED_WORKTREES) {
    const expectedDir = path.join(repoRoot, '.worktrees', expected.name);
    let foundVia = null;
    let block = blockByPath.get(path.resolve(expectedDir).toLowerCase());
    if (block) foundVia = 'path';
    if (!block) {
      block = blocks.find((b) => b.branch === expected.branch);
      if (block) foundVia = 'branch';
    }
    const wt = {
      name: expected.name,
      expected_branch: expected.branch,
      found: !!block,
      found_via: foundVia,
      path: block ? path.resolve(block.path) : expectedDir,
      present: block ? fs.existsSync(path.resolve(block.path)) : false,
      dirty: false,
      status: null,
      tracked: null,
      branch_vs_main: null,
      pak_indexes: [],
      ignored_artifacts: [],
      deletion_verdict: 'DO-NOT-DELETE',
      deletion_allowed: false,
      deletion_blockers: [],
      branch_deletion: null,
    };
    worktrees.push(wt);
  }

  for (const wt of worktrees) {
    if (!wt.found || !wt.present) {
      wt.deletion_blockers.push(wt.found ? 'worktree-directory-missing' : 'worktree-not-found');
      continue;
    }
    progress(`reading live state: ${wt.name} (${wt.path})`);
    wt.path_posix = toPosix(wt.path);
    wt.branch = runGit(wt.path, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    wt.head = runGit(wt.path, ['rev-parse', 'HEAD']).stdout.trim();
    wt.head_tree_oid = runGit(wt.path, ['rev-parse', 'HEAD^{tree}']).stdout.trim();
    wt.head_tree_matches_main = wt.head_tree_oid === mainTree;

    const statusRes = runGit(wt.path, ['status', '--porcelain=v2', '-z'], { maxBuffer: 256 * 1024 * 1024 });
    const statusRecords = parsePorcelainV2Z(statusRes.stdout);
    wt.status = {
      porcelain_v2_text: statusRecords.map((r) => r.raw).join('\n'),
      porcelain_v2_records: statusRecords,
      output_sha256: sha256Hex(Buffer.from(statusRes.stdout, 'utf8')),
      counts: summarizeStatus(statusRecords),
    };
    wt.dirty = statusRecords.length > 0;

    wt.tracked = computeTrackedTree(wt.path, (m) => progress(`${wt.name} ${m}`));

    if (wt.branch !== wt.expected_branch) wt.deletion_blockers.push(`branch-mismatch:${wt.branch}`);
    if (wt.dirty) wt.deletion_blockers.push('dirty-worktree');
    if (primaryBlock && blockByPath.get(path.resolve(wt.path).toLowerCase())?.prunable) {
      wt.deletion_blockers.push('worktree-prunable');
    }
    if (primaryBlock && blockByPath.get(path.resolve(wt.path).toLowerCase())?.locked) {
      wt.deletion_blockers.push('worktree-locked');
    }

    // branch vs main (file/blob level)
    const mergeBase = runGit(wt.path, ['merge-base', baselineBranch, wt.branch], { allowFail: true });
    const ahead = runGit(wt.path, ['rev-list', '--count', `${baselineBranch}..${wt.branch}`]).stdout.trim();
    const behind = runGit(wt.path, ['rev-list', '--count', `${wt.branch}..${baselineBranch}`]).stdout.trim();
    const uniqueLog = runGit(wt.path, ['log', '--format=%h %s', '--no-decorate', `${baselineBranch}..${wt.branch}`], {
      maxBuffer: 32 * 1024 * 1024,
    }).stdout;
    const diffRaw = runGit(
      wt.path,
      ['diff-tree', '-r', '--no-commit-id', '--raw', '--no-abbrev', '--no-renames', '-z', baselineBranch, wt.branch],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    const diffEntries = parseRawDiffZ(diffRaw.stdout);
    const diffCounts = { added: 0, modified: 0, deleted: 0, typechange: 0, other: 0 };
    for (const e of diffEntries) {
      if (e.status === 'A') diffCounts.added += 1;
      else if (e.status === 'M') diffCounts.modified += 1;
      else if (e.status === 'D') diffCounts.deleted += 1;
      else if (e.status === 'T') diffCounts.typechange += 1;
      else diffCounts.other += 1;
    }
    wt.branch_vs_main = {
      baseline_branch: baselineBranch,
      merge_base: mergeBase.status === 0 ? mergeBase.stdout.trim() : null,
      commits_main_to_branch: Number(ahead),
      commits_branch_to_main: Number(behind),
      unique_commit_count: Number(ahead),
      unique_commits: splitLines(uniqueLog).slice(0, 100),
      unique_commits_truncated: splitLines(uniqueLog).length > 100,
      tree_diff: {
        entry_count: diffEntries.length,
        counts: diffCounts,
        entries: diffEntries,
      },
    };
    wt.branch_deletion = {
      commits_outside_main: Number(ahead),
      verdict: Number(ahead) === 0 ? 'FULLY-CONTAINED-IN-MAIN' : 'REFUSE-RETAIN',
    };

    // ignored artifacts
    const ignoredRes = runGit(wt.path, ['status', '--porcelain=v2', '-z', '--ignored=matching'], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const ignoredRecords = parsePorcelainV2Z(ignoredRes.stdout).filter((r) => r.kind === '!');
    for (const rec of ignoredRecords) {
      progress(`${wt.name}: hashing ignored artifact ${rec.path}`);
      try {
        const inv = await inventoryIgnoredEntry(wt.path, wt.path, rec.path);
        wt.ignored_artifacts.push({
          ...inv,
          unique: null,
          duplicate_of: null,
          preserved_to: null,
          preserve_error: null,
        });
      } catch (err) {
        wt.ignored_artifacts.push({
          path: rec.path,
          kind: 'error',
          symlink_target: null,
          resolved_target: null,
          size_bytes: 0,
          file_count: 0,
          sha256: null,
          hash_method: null,
          unreadable: [],
          walk_errors: [{ path: rec.path, error: err.message }],
          unique: null,
          duplicate_of: null,
          preserved_to: null,
          preserve_error: null,
        });
        wt.deletion_blockers.push(`ignored-artifact-hash-error:${rec.path}`);
      }
    }
  }

  // --- main baseline artifacts (only paths referenced by linked worktrees) --
  const linkedPaths = new Set();
  for (const wt of worktrees) {
    for (const a of wt.ignored_artifacts) linkedPaths.add(a.path);
  }
  const baselineArtifacts = [];
  for (const rel of mainIgnoredPaths) {
    if (!linkedPaths.has(rel)) continue;
    progress(`main: hashing baseline artifact ${rel}`);
    try {
      const inv = await inventoryIgnoredEntry(repoRoot, repoRoot, rel);
      baselineArtifacts.push({ ...inv, location: 'main' });
    } catch (err) {
      baselineArtifacts.push({
        path: rel,
        location: 'main',
        kind: 'error',
        symlink_target: null,
        resolved_target: null,
        size_bytes: 0,
        file_count: 0,
        sha256: null,
        hash_method: null,
        unreadable: [],
        walk_errors: [{ path: rel, error: err.message }],
      });
      warnings.push(`main baseline hash error for ${rel}: ${err.message}`);
    }
  }

  // --- uniqueness + uniqueness-based preservation ---------------------------
  const preservation = {
    dir: toPosix(preserveDir),
    uniqueness_rule:
      'An ignored artifact is UNIQUE when no main-worktree ignored artifact shares its relative path AND sha256, '
      + 'and no earlier linked worktree (order: analysis, audio, fx, integration, video) holds the same path+sha256. '
      + 'Exactly one copy per (path, sha256) group not present in main is preserved. '
      + 'Ignored symlinks/junctions are never copied: their target is owned by the main worktree (or is external).',
    copied: [],
    symlinks: [],
    skipped_duplicates: [],
    errors: [],
  };
  const baselineKeys = new Set(baselineArtifacts.filter((a) => a.sha256).map((a) => `${a.path}::${a.sha256}`));
  const firstLinkedForKey = new Map();
  for (const wt of worktrees) {
    for (const a of wt.ignored_artifacts) {
      if (a.kind === 'symlink' || a.sha256 === null) continue;
      const key = `${a.path}::${a.sha256}`;
      if (!firstLinkedForKey.has(key)) firstLinkedForKey.set(key, wt.name);
    }
  }
  for (const wt of worktrees) {
    for (const a of wt.ignored_artifacts) {
      if (a.kind === 'symlink') {
        // A symlink/junction stores no data itself; its target is the payload.
        // Never copy it (copying a junction fails and the target is safe elsewhere).
        const resolved = a.resolved_target;
        let disposition = 'external';
        let duplicateOf = 'external-symlink-target';
        if (resolved && isInsideCI(repoRoot, path.resolve(resolved))) {
          disposition = 'main-worktree';
          duplicateOf = 'main-symlink-target';
        } else if (resolved) {
          const owner = worktrees.find((w) => w.found && w.present && isInsideCI(w.path, path.resolve(resolved)));
          if (owner) {
            disposition = 'linked-worktree';
            duplicateOf = `symlink-to-${owner.name}`;
            warnings.push(
              `${wt.name}: ignored symlink ${a.path} points inside linked worktree ${owner.name}; the target worktree owns the data`,
            );
          }
        }
        a.unique = false;
        a.duplicate_of = duplicateOf;
        a.symlink_disposition = disposition;
        preservation.symlinks.push({
          worktree: wt.name,
          path: a.path,
          symlink_target: a.symlink_target,
          resolved_target: a.resolved_target,
          disposition,
        });
        continue;
      }
      if (a.sha256 === null) {
        a.unique = null;
        a.duplicate_of = 'hash-unavailable';
        continue;
      }
      const key = `${a.path}::${a.sha256}`;
      if (baselineKeys.has(key)) {
        a.unique = false;
        a.duplicate_of = 'main';
      } else if (firstLinkedForKey.get(key) === wt.name) {
        a.unique = true;
      } else {
        a.unique = false;
        a.duplicate_of = firstLinkedForKey.get(key);
      }
    }
  }

  const uniqueToPreserve = [];
  for (const wt of worktrees) {
    for (const a of wt.ignored_artifacts) {
      if (a.unique === true) uniqueToPreserve.push({ wt, a });
      else if (a.unique === false && a.duplicate_of !== 'main' && a.symlink_disposition === undefined) {
        preservation.skipped_duplicates.push({
          worktree: wt.name,
          path: a.path,
          duplicate_of: a.duplicate_of,
          sha256: a.sha256,
        });
      }
    }
  }
  mkdirp(preserveDir);
  for (const { wt, a } of uniqueToPreserve) {
    const rel = a.path.endsWith('/') ? a.path.slice(0, -1) : a.path;
    const src = path.join(wt.path, ...rel.split('/'));
    const dest = path.join(preserveDir, wt.name, ...rel.split('/'));
    try {
      mkdirp(path.dirname(dest));
      const srcStat = fs.lstatSync(src);
      const alreadyPreserved = fs.existsSync(dest);
      if (!alreadyPreserved) {
        if (srcStat.isDirectory()) {
          fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false });
        } else {
          fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
        }
      }
      a.preserved_to = toPosix(dest);
      preservation.copied.push({
        worktree: wt.name,
        source: toPosix(src),
        source_relative: a.path,
        preserved_to: toPosix(dest),
        pre_existing: alreadyPreserved,
        sha256: a.sha256,
        size_bytes: a.size_bytes,
        file_count: a.file_count,
      });
      progress(`${alreadyPreserved ? 'already preserved' : 'preserved'} ${wt.name}:${a.path} -> ${dest}`);
    } catch (err) {
      a.preserve_error = err.message;
      preservation.errors.push({ worktree: wt.name, path: a.path, error: err.message });
      wt.deletion_blockers.push(`unique-artifact-not-preserved:${a.path}`);
    }
  }
  const manifestPath = path.join(preserveDir, 'preservation-manifest.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ generated_at_utc: nowIso(), note: preservation.uniqueness_rule, entries: preservation.copied }, null, 2)}\n`,
    'utf8',
  );
  preservation.manifest_path = toPosix(manifestPath);

  // --- bundle create + verify (never assume success) ------------------------
  progress('creating git bundle of the five branch tips');
  const bundleRefs = EXPECTED_WORKTREES.map((e) => e.branch);
  const branchTips = {};
  for (const e of EXPECTED_WORKTREES) {
    const r = runGit(repoRoot, ['rev-parse', `refs/heads/${e.branch}`], { allowFail: true });
    branchTips[e.branch] = r.status === 0 ? r.stdout.trim() : null;
  }

  let effectiveBundlePath = bundlePath;
  let reusedExisting = false;
  let existingBundle = null;
  if (fs.existsSync(bundlePath) && reuseBundle) {
    const existingVerify = runGit(repoRoot, ['bundle', 'verify', bundlePath], { allowFail: true });
    const existingHeads = runGit(repoRoot, ['bundle', 'list-heads', bundlePath], { allowFail: true });
    existingBundle = {
      path: toPosix(bundlePath),
      verify_exit_code: existingVerify.status,
      verify_output: (existingVerify.stdout + existingVerify.stderr).trim(),
      list_heads: parseBundleHeads(existingHeads.stdout),
    };
    const matches = existingVerify.status === 0 && bundleHeadsMatch(existingBundle.list_heads, branchTips);
    if (matches) {
      reusedExisting = true;
      effectiveBundlePath = bundlePath;
    } else {
      effectiveBundlePath = `${bundlePath.replace(/\.bundle$/i, '')}.fresh-${utcStamp()}.bundle`;
      warnings.push(`existing bundle did not match live branch tips; wrote a fresh bundle at ${effectiveBundlePath}`);
    }
  } else if (fs.existsSync(bundlePath) && !reuseBundle) {
    // Never overwrite or delete an existing bundle: create a sibling fresh one.
    const existingVerify = runGit(repoRoot, ['bundle', 'verify', bundlePath], { allowFail: true });
    const existingHeads = runGit(repoRoot, ['bundle', 'list-heads', bundlePath], { allowFail: true });
    existingBundle = {
      path: toPosix(bundlePath),
      verify_exit_code: existingVerify.status,
      verify_output: (existingVerify.stdout + existingVerify.stderr).trim(),
      list_heads: parseBundleHeads(existingHeads.stdout),
    };
    effectiveBundlePath = `${bundlePath.replace(/\.bundle$/i, '')}.fresh-${utcStamp()}.bundle`;
  }

  let created = false;
  let createOutput = '';
  let createStatus = null;
  if (!reusedExisting) {
    mkdirp(path.dirname(effectiveBundlePath));
    const create = runGit(repoRoot, ['bundle', 'create', effectiveBundlePath, ...bundleRefs], {
      allowFail: true,
      maxBuffer: 256 * 1024 * 1024,
    });
    createStatus = create.status;
    createOutput = (create.stdout + create.stderr).trim();
    created = create.status === 0;
    if (!created) errors.push(`git bundle create failed (exit ${create.status})`);
  }

  const verify = runGit(repoRoot, ['bundle', 'verify', effectiveBundlePath], { allowFail: true });
  const verifyOutput = (verify.stdout + verify.stderr).trim();
  const headsRes = runGit(repoRoot, ['bundle', 'list-heads', effectiveBundlePath], { allowFail: true });
  const listHeads = parseBundleHeads(headsRes.stdout);
  const refsMatchTips = bundleHeadsMatch(listHeads, branchTips);

  // Re-read tips now to detect mid-flight changes (stale state guard).
  const tipsAfter = {};
  for (const e of EXPECTED_WORKTREES) {
    const r = runGit(repoRoot, ['rev-parse', `refs/heads/${e.branch}`], { allowFail: true });
    tipsAfter[e.branch] = r.status === 0 ? r.stdout.trim() : null;
  }
  const tipsStable = EXPECTED_WORKTREES.every((e) => branchTips[e.branch] === tipsAfter[e.branch]);
  if (!tipsStable) errors.push('branch tips changed while the bundle was being created; re-run the inventory');

  const bundleStat = fs.existsSync(effectiveBundlePath) ? fs.statSync(effectiveBundlePath) : null;
  const bundle = {
    path: toPosix(effectiveBundlePath),
    refs: bundleRefs,
    branch_tips: branchTips,
    create_command: ['git', 'bundle', 'create', toPosix(effectiveBundlePath), ...bundleRefs],
    created,
    create_exit_code: createStatus,
    create_output: createOutput,
    reused_existing_bundle: reusedExisting,
    existing_bundle: existingBundle,
    verify_command: ['git', 'bundle', 'verify', toPosix(effectiveBundlePath)],
    verify_exit_code: verify.status,
    verify_output: verifyOutput,
    list_heads_command: ['git', 'bundle', 'list-heads', toPosix(effectiveBundlePath)],
    list_heads: listHeads,
    refs_match_tips: refsMatchTips,
    tips_stable_during_inventory: tipsStable,
    verified: verify.status === 0 && refsMatchTips && tipsStable,
    size_bytes: bundleStat ? bundleStat.size : 0,
    sha256: bundleStat ? sha256FileSync(effectiveBundlePath) : null,
  };
  if (!bundle.verified) errors.push('git bundle verify did not validate all five branch tips');

  // --- final verdicts + TOCTOU-style live re-check --------------------------
  for (const wt of worktrees) {
    if (!wt.found || !wt.present) {
      wt.deletion_verdict = 'DO-NOT-DELETE';
      wt.deletion_allowed = false;
      continue;
    }
    const blockers = [];
    if (wt.dirty) blockers.push('dirty-worktree');
    if (wt.branch !== wt.expected_branch) blockers.push(`branch-mismatch:${wt.branch}`);
    for (const b of wt.deletion_blockers) {
      if (!blockers.includes(b)) blockers.push(b);
    }
    wt.deletion_blockers = blockers;
    wt.deletion_verdict = blockers.length > 0 ? 'DO-NOT-DELETE' : 'ELIGIBLE-FOR-REVIEW';
    wt.deletion_allowed = blockers.length === 0;
  }

  const stateRecheck = recheckLiveState(
    repoRoot,
    blocks,
    worktrees,
    baselineBranch,
    primaryBlock ? path.resolve(primaryBlock.path) : repoRoot,
  );
  if (stateRecheck.changed.length > 0) errors.push('state changed during inventory; re-run before relying on this artifact');

  // --- pak index comparison vs main ----------------------------------------
  const mainPaks = scanPakIndexes(repoRoot);
  const mainPakByPath = new Map(mainPaks.map((p) => [p.path, p]));
  for (const wt of worktrees) {
    if (!wt.found || !wt.present) continue;
    const paks = scanPakIndexes(wt.path);
    for (const p of paks) {
      const main = mainPakByPath.get(p.path) || null;
      p.vs_main = main
        ? {
            main_sha256: main.sha256,
            main_replayAssets_version: main.replayAssets_version,
            same_sha256: main.sha256 === p.sha256,
            same_replayAssets_version: main.replayAssets_version === p.replayAssets_version,
          }
        : {
            main_sha256: null,
            main_replayAssets_version: null,
            same_sha256: false,
            same_replayAssets_version: false,
            note: 'no main counterpart at this relative path',
          };
    }
    wt.pak_indexes = paks;
  }

  // --- assemble artifact (NO digest field of any kind) ----------------------
  const artifact = {
    schema: SCHEMA,
    generated_at_utc: nowIso(),
    mode,
    repo_root: toPosix(repoRoot),
    baseline_branch: baselineBranch,
    read_only: true,
    deletion_performed: false,
    git_version: gitVersion,
    expected_worktrees: EXPECTED_WORKTREES,
    worktree_list_porcelain: worktreeList.trimEnd(),
    main: {
      path: toPosix(repoRoot),
      head: mainHead,
      head_tree: mainTree,
      ignored_paths: mainIgnoredPaths,
      baseline_artifacts: baselineArtifacts,
      pak_indexes: mainPaks,
    },
    bundle,
    preservation,
    worktrees,
    state_recheck: stateRecheck,
    sidecar: {
      path: `${toPosix(outPath)}.sha256`,
      format: 'sha256sum: "<sha256>  <inventory filename>"',
      covers: 'the bytes of the inventory JSON file only; the sidecar is not covered by itself',
    },
    warnings,
    errors,
  };

  // --- write JSON, then sidecar (non-self-referential) ----------------------
  mkdirp(path.dirname(outPath));
  const jsonText = `${JSON.stringify(artifact, null, 2)}\n`;
  fs.writeFileSync(outPath, jsonText, 'utf8');
  const artifactSha256 = sha256FileSync(outPath);
  const sidecarPath = `${outPath}.sha256`;
  fs.writeFileSync(sidecarPath, `${artifactSha256}  ${path.basename(outPath)}\n`, 'utf8');

  // Independent verification of the sidecar contract.
  const sidecarText = fs.readFileSync(sidecarPath, 'utf8').trim();
  const sidecarToken = sidecarText.split(/\s+/)[0];
  const recomputed = sha256FileSync(outPath);
  const sidecarVerified = sidecarToken === recomputed && recomputed === artifactSha256;
  if (!sidecarVerified) errors.push('sidecar hash does not match the inventory JSON bytes');

  return {
    artifact,
    outPath,
    sidecarPath,
    artifactSha256,
    sidecarHash: sidecarToken,
    sidecarVerified,
    bundlePath: effectiveBundlePath,
    worktrees,
  };
}

function parseRawDiffZ(text) {
  const tokens = text.split('\0').filter((t) => t.length > 0);
  const entries = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t.startsWith(':')) continue;
    const parts = t.slice(1).split(' ');
    const pathToken = tokens[i + 1];
    if (pathToken === undefined) break;
    i += 1;
    entries.push({
      old_mode: parts[0],
      new_mode: parts[1],
      old_blob: parts[2],
      new_blob: parts[3],
      status: parts[4],
      path: pathToken,
    });
  }
  return entries;
}

function parseBundleHeads(text) {
  const heads = [];
  for (const line of splitLines(text)) {
    const sp = line.indexOf(' ');
    if (sp === -1) continue;
    heads.push({ sha: line.slice(0, sp).trim(), ref: line.slice(sp + 1).trim() });
  }
  return heads;
}

function bundleHeadsMatch(listHeads, branchTips) {
  for (const e of EXPECTED_WORKTREES) {
    const wanted = branchTips[e.branch];
    const got = listHeads.find((h) => h.ref === `refs/heads/${e.branch}`);
    if (!wanted || !got || got.sha !== wanted) return false;
  }
  return true;
}

function recheckLiveState(repoRoot, blocksBefore, worktrees, baselineBranch, primaryPath) {
  const changed = [];
  const knownPaths = new Set(blocksBefore.map((b) => path.resolve(b.path).toLowerCase()));
  if (primaryPath) knownPaths.add(path.resolve(primaryPath).toLowerCase());
  const freshList = runGit(repoRoot, ['worktree', 'list', '--porcelain'], { allowFail: true });
  if (freshList.status !== 0) {
    changed.push({ scope: 'worktree-list', detail: 'git worktree list failed during re-check' });
  } else {
    const freshBlocks = parseWorktreeList(freshList.stdout);
    const before = new Set(blocksBefore.map((b) => `${path.resolve(b.path).toLowerCase()}|${b.head}|${b.branch}`));
    const after = new Set(freshBlocks.map((b) => `${path.resolve(b.path).toLowerCase()}|${b.head}|${b.branch}`));
    for (const key of before) if (!after.has(key)) changed.push({ scope: 'worktree-list', detail: `entry disappeared or changed: ${key}` });
    for (const key of after) if (!before.has(key)) changed.push({ scope: 'worktree-list', detail: `entry appeared or changed: ${key}` });
    for (const b of freshBlocks) {
      const resolved = path.resolve(b.path).toLowerCase();
      if (!knownPaths.has(resolved)) {
        changed.push({ scope: 'worktree-list', detail: `unexpected worktree present: ${toPosix(path.resolve(b.path))}` });
      }
    }
  }
  for (const wt of worktrees) {
    if (!wt.found || !wt.present) continue;
    const head = runGit(wt.path, ['rev-parse', 'HEAD'], { allowFail: true });
    const status = runGit(wt.path, ['status', '--porcelain=v2', '-z'], { allowFail: true, maxBuffer: 256 * 1024 * 1024 });
    const headNow = head.status === 0 ? head.stdout.trim() : 'ERROR';
    const statusNow = status.status === 0 ? status.stdout : 'ERROR';
    if (headNow !== wt.head) changed.push({ scope: wt.name, detail: `HEAD changed ${wt.head} -> ${headNow}` });
    if (sha256Hex(Buffer.from(statusNow, 'utf8')) !== wt.status.output_sha256) {
      changed.push({ scope: wt.name, detail: 'git status changed during inventory' });
    }
  }
  const baselineNow = runGit(repoRoot, ['rev-parse', baselineBranch], { allowFail: true });
  return {
    checked_at_utc: nowIso(),
    baseline_branch_head: baselineNow.status === 0 ? baselineNow.stdout.trim() : null,
    changed,
    stable: changed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// self-test (sandboxed scratch repository, never the real repo)
// ---------------------------------------------------------------------------

function buildScratchRepo(root) {
  const git = (args, opts = {}) => runGit(root, args, { ...opts, sandbox: true });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'self-test@localhost']);
  git(['config', 'user.name', 'worktree inventory self-test']);
  git(['config', 'core.autocrlf', 'true']);

  const ignore = ['*.tmp', 'recorder/build/', '/tools/opensa/map-pak*/', 'node_modules/', ''].join('\n');
  fs.writeFileSync(path.join(root, '.gitignore'), ignore, 'utf8');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-m', 'scratch base']);

  for (const e of EXPECTED_WORKTREES) {
    git(['worktree', 'add', path.join('.worktrees', e.name), '-b', e.branch]);
  }

  const wt = (name) => path.join(root, '.worktrees', name);

  // main + fx have ignored pak indexes with different replayAssets.version
  for (const [base, version] of [[root, 2], [wt('fx'), 3]]) {
    mkdirp(path.join(base, 'tools', 'opensa', 'map-pak'));
    fs.writeFileSync(
      path.join(base, 'tools', 'opensa', 'map-pak', 'index.json'),
      `${JSON.stringify({ replayAssets: { version } })}\n`,
      'utf8',
    );
  }

  // one artificially dirty worktree
  fs.appendFileSync(path.join(wt('analysis'), 'tracked.txt'), 'dirty change\n', 'utf8');

  // unique ignored artifact only in audio
  mkdirp(path.join(wt('audio'), 'recorder', 'build'));
  fs.writeFileSync(path.join(wt('audio'), 'recorder', 'build', 'unique-artifact.tmp'), 'unique-audio\n', 'utf8');

  // identical ignored artifact in two worktrees (duplicate group)
  for (const name of ['fx', 'video']) {
    mkdirp(path.join(wt(name), 'tools', 'opensa', 'node_modules'));
    fs.writeFileSync(path.join(wt(name), 'tools', 'opensa', 'node_modules', 'dup.tmp'), 'same-content\n', 'utf8');
  }
}

function rmrfRobust(target) {
  if (!fs.existsSync(target)) return;
  const stack = [target];
  while (stack.length > 0) {
    const cur = stack.pop();
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      let entries = [];
      try {
        entries = fs.readdirSync(cur);
      } catch {
        entries = [];
      }
      for (const e of entries) stack.push(path.join(cur, e));
      try {
        fs.chmodSync(cur, 0o777);
      } catch { /* best effort */ }
    } else {
      try {
        fs.chmodSync(cur, 0o666);
      } catch { /* best effort */ }
    }
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function runSelfTest() {
  const scratchRoot = path.join(os.tmpdir(), `gtasa-wt-inventory-selftest-${process.pid}-${Date.now().toString(36)}`);
  let code = 1;
  let cleanupOk = true;
  try {
    log(`self-test scratch repository: ${scratchRoot}`);
    mkdirp(scratchRoot);
    buildScratchRepo(scratchRoot);

    const outPath = path.join(scratchRoot, '.omo', 'evidence', 'self-test-inventory.json');
    const bundlePath = path.join(scratchRoot, '.omo', 'evidence', 'self-test-branches.bundle');
    const preserveDir = path.join(scratchRoot, '.omo', 'preservation');

    const result = await runInventory({
      repoRoot: scratchRoot,
      outPath,
      bundlePath,
      preserveDir,
      mode: 'self-test',
      progress: log,
    });

    const failures = [];
    const checks = [];
    const assert = (cond, label) => {
      checks.push({ check: label, pass: !!cond });
      if (!cond) failures.push(label);
    };

    const wtByName = new Map(result.artifact.worktrees.map((w) => [w.name, w]));
    assert(result.artifact.worktrees.length === 5, 'five linked worktrees discovered');
    for (const e of EXPECTED_WORKTREES) assert(wtByName.has(e.name), `worktree discovered: ${e.name}`);

    const analysis = wtByName.get('analysis');
    assert(analysis && analysis.deletion_verdict === 'DO-NOT-DELETE', 'dirty worktree flagged DO-NOT-DELETE');
    assert(analysis && analysis.deletion_allowed === false, 'dirty worktree refuses deletion');
    assert(
      analysis && analysis.deletion_blockers.includes('dirty-worktree'),
      'dirty worktree blocker reason recorded',
    );
    for (const name of ['audio', 'fx', 'video', 'integration']) {
      const w = wtByName.get(name);
      assert(w && w.deletion_verdict === 'ELIGIBLE-FOR-REVIEW', `clean worktree eligible: ${name}`);
    }

    assert(result.artifact.bundle.verified === true, 'bundle verified via git bundle verify');
    assert(result.artifact.bundle.refs_match_tips === true, 'bundle heads match all five live branch tips');
    assert(result.artifact.bundle.size_bytes > 0, 'bundle file exists and is non-empty');

    const sidecarText = fs.readFileSync(result.sidecarPath, 'utf8').trim();
    const sidecarToken = sidecarText.split(/\s+/)[0];
    const recomputed = sha256FileSync(result.outPath);
    assert(sidecarToken === recomputed, 'sidecar hash matches JSON bytes');

    const jsonObj = JSON.parse(fs.readFileSync(result.outPath, 'utf8'));
    const digestKeys = [];
    (function walk(node, trail) {
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (/digest/i.test(k) || /inventory[_-]?sha/i.test(k)) digestKeys.push(trail ? `${trail}.${k}` : k);
        walk(v, trail ? `${trail}.${k}` : k);
      }
    })(jsonObj, '');
    assert(digestKeys.length === 0, `inventory JSON has no digest field (found: ${digestKeys.join(', ') || 'none'})`);

    // preservation: unique artifact copied, duplicate not copied
    const audioArtifacts = wtByName.get('audio').ignored_artifacts;
    const audioUnique = audioArtifacts.find((a) => a.path === 'recorder/build/');
    assert(audioUnique && audioUnique.unique === true, 'unique audio artifact marked unique');
    assert(
      audioUnique && audioUnique.preserved_to && fs.existsSync(audioUnique.preserved_to),
      'unique audio artifact copied to preservation dir',
    );
    const fxArtifacts = wtByName.get('fx').ignored_artifacts;
    const videoArtifacts = wtByName.get('video').ignored_artifacts;
    const fxNodeModules = fxArtifacts.find((a) => a.path === 'tools/opensa/node_modules/');
    const videoNodeModules = videoArtifacts.find((a) => a.path === 'tools/opensa/node_modules/');
    assert(fxNodeModules && fxNodeModules.unique === true, 'first duplicate-group copy preserved');
    assert(
      videoNodeModules && videoNodeModules.unique === false && videoNodeModules.duplicate_of === 'fx',
      'second duplicate-group copy de-duplicated',
    );

    // pak comparison
    const fxPak = wtByName.get('fx').pak_indexes.find((p) => p.path === 'tools/opensa/map-pak/index.json');
    assert(fxPak && fxPak.replayAssets_version === 3, 'fx pak version read from index.json');
    assert(
      fxPak && fxPak.vs_main && fxPak.vs_main.same_replayAssets_version === false
        && fxPak.vs_main.main_replayAssets_version === 2,
      'fx pak version compared against main (3 vs 2)',
    );

    // nothing deleted / nothing removed
    assert(result.artifact.deletion_performed === false, 'no deletion performed flag');
    const liveList = runGit(scratchRoot, ['worktree', 'list', '--porcelain'], { sandbox: true }).stdout;
    assert(parseWorktreeList(liveList).length === 6, 'all six worktrees (primary + five) still present');
    assert(
      result.artifact.state_recheck.stable === true,
      `live state stable during inventory (changed: ${JSON.stringify(result.artifact.state_recheck.changed)})`,
    );

    for (const c of checks) log(`self-test ${c.pass ? 'PASS' : 'FAIL'}: ${c.check}`);

    if (failures.length > 0) {
      console.error(`SELF-TEST: FAILED (${failures.length} assertion(s))`);
      for (const f of failures) console.error(`  - ${f}`);
      code = 1;
    } else {
      console.log('SELF-TEST: PASS');
      console.log('SELF-TEST ASSERTS: dirty worktree = DO-NOT-DELETE (deletion refused)');
      code = 0;
    }
  } catch (err) {
    console.error(`SELF-TEST: ERROR - ${err.stack || err.message}`);
    code = 1;
  } finally {
    try {
      rmrfRobust(scratchRoot);
      if (fs.existsSync(scratchRoot)) throw new Error('scratch directory still exists after removal');
      console.log(`CLEANUP: removed self-test scratch directory ${scratchRoot}`);
    } catch (err) {
      cleanupOk = false;
      console.error(`CLEANUP: FAILED to remove scratch directory ${scratchRoot}: ${err.message}`);
    }
  }
  if (!cleanupOk) code = 1;
  return code;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    out: null,
    bundle: null,
    preserveDir: null,
    repo: null,
    selfTest: false,
    reuseBundle: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`missing value for ${name}`);
      i += 1;
      return v;
    };
    if (a === '--out') opts.out = need(a);
    else if (a === '--bundle') opts.bundle = need(a);
    else if (a === '--preserve-dir') opts.preserveDir = need(a);
    else if (a === '--repo') opts.repo = need(a);
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--reuse-bundle') opts.reuseBundle = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function printHelp() {
  console.log('Usage: node tools/maintenance/inventory-worktrees.mjs [options]');
  console.log('');
  console.log('  --out <path>          inventory JSON path (default: .omo/evidence/task-6-flight-analysis-remediation-and-worktree-cleanup.json)');
  console.log('  --bundle <path>       bundle path (default: <out dir>/task-6-worktree-branches.bundle)');
  console.log('  --preserve-dir <dir>  preservation directory (default: <out dir>/worktree-preservation)');
  console.log('  --repo <root>         primary worktree root (default: auto-detected)');
  console.log('  --reuse-bundle        reuse an existing verified bundle instead of creating a fresh one');
  console.log('  --self-test           sandboxed self-test: scratch repo + artificially dirty worktree');
  console.log('  -h, --help            show this help');
  console.log('');
  console.log('Read-only: never deletes, never runs `git worktree remove`, never commits.');
}

function printSummary(result) {
  const a = result.artifact;
  console.log('');
  console.log(`RESULT: ${a.errors.length === 0 && result.sidecarVerified && a.bundle.verified ? 'OK' : 'FAILED'}`);
  console.log(`repo_root:  ${a.repo_root}`);
  console.log(`artifact:   ${toPosix(result.outPath)}`);
  console.log(`sidecar:    ${toPosix(result.sidecarPath)}`);
  console.log(`sidecar sha256: ${result.sidecarHash} (matches JSON: ${result.sidecarVerified})`);
  console.log(`bundle:     ${a.bundle.path}`);
  console.log(`bundle created: ${a.bundle.created} (reused existing: ${a.bundle.reused_existing_bundle})`);
  console.log(`bundle verify exit: ${a.bundle.verify_exit_code}; refs match live tips: ${a.bundle.refs_match_tips}; verified: ${a.bundle.verified}`);
  for (const line of splitLines(a.bundle.verify_output)) console.log(`  | ${line}`);
  console.log(`preservation dir: ${a.preservation.dir} (copied ${a.preservation.copied.length}, deduplicated ${a.preservation.skipped_duplicates.length}, errors ${a.preservation.errors.length})`);
  console.log('worktrees:');
  for (const w of a.worktrees) {
    const dirty = w.dirty ? `dirty(${w.status ? JSON.stringify(w.status.counts) : 'n/a'})` : 'clean';
    console.log(`  ${w.name.padEnd(12)} branch=${w.branch || '(missing)'} head=${w.head ? w.head.slice(0, 10) : '(missing)'} ${dirty} verdict=${w.deletion_verdict}`);
  }
  if (a.warnings.length > 0) {
    console.log('warnings:');
    for (const w of a.warnings) console.log(`  - ${w}`);
  }
  if (a.errors.length > 0) {
    console.log('errors:');
    for (const e of a.errors) console.log(`  - ${e}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.selfTest) {
    if (opts.out || opts.bundle || opts.preserveDir || opts.repo) {
      throw new Error('--self-test is sandboxed; do not combine it with --out/--bundle/--preserve-dir/--repo');
    }
    return await runSelfTest();
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = opts.repo ? path.resolve(opts.repo) : resolvePrimaryRoot(scriptDir);
  const outPath = resolveMaybeRelative(repoRoot, opts.out || DEFAULT_OUT);
  const outDir = path.dirname(outPath);
  const bundlePath = resolveMaybeRelative(repoRoot, opts.bundle || path.join(outDir, 'task-6-worktree-branches.bundle'));
  const preserveDir = resolveMaybeRelative(repoRoot, opts.preserveDir || path.join(outDir, 'worktree-preservation'));

  for (const [label, p] of [['out', outPath], ['bundle', bundlePath], ['preserve-dir', preserveDir]]) {
    for (const e of EXPECTED_WORKTREES) {
      const wtDir = path.join(repoRoot, '.worktrees', e.name);
      if (isInside(wtDir, p)) {
        throw new Error(`${label} path must not be inside linked worktree ${e.name}: ${p}`);
      }
    }
  }

  const result = await runInventory({
    repoRoot,
    outPath,
    bundlePath,
    preserveDir,
    mode: 'inventory',
    reuseBundle: opts.reuseBundle,
  });

  printSummary(result);

  const ok = result.artifact.errors.length === 0
    && result.sidecarVerified
    && result.artifact.bundle.verified
    && result.artifact.state_recheck.stable;
  return ok ? 0 : 1;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  });
