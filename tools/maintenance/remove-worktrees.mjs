#!/usr/bin/env node
/**
 * remove-worktrees.mjs - task-7 worktree + branch cleanup (destructive, gated).
 *
 * Removes the five linked Codex worktrees from the todo-6 inventory and deletes
 * ONLY branches that are fully contained in `main`. This script is deliberately
 * paranoid:
 *
 *   1. refuses unless ALL of --inventory, --inventory-sha256, --confirm-cleanup
 *      are passed; the sidecar hash is verified against the JSON before any
 *      read-only checks or destructive action;
 *   2. binds to the sidecar, not to a hardcoded HEAD; the recorded main HEAD,
 *      branch tips and per-worktree HEAD must still match live git;
 *   3. immediately before each removal it RE-READS that worktree's HEAD,
 *      `git status --porcelain=v2`, its untracked/ignored set and re-hashes
 *      every recorded ignored artifact; any change since the inventory aborts
 *      the run (TOCTOU);
 *   4. removes worktrees with `git worktree remove <path>` only - never
 *      `--force`, never manual `.git/worktrees/*` deletion, never `prune`;
 *      NTFS junctions recorded in the inventory are unlinked as reparse points
 *      (link only, target untouched) before the git removal so git can never
 *      recurse into the main worktree's directories;
 *   5. deletes a branch ONLY via `git branch -d` and ONLY when
 *      `git rev-list --count main..BRANCH` is exactly 0; a nonzero count means
 *      REFUSE-RETAIN unconditionally (a verified bundle does NOT permit
 *      deletion);
 *   6. verifies afterwards: `git worktree list` shows only the primary
 *      worktree, fully-contained branches are gone, retained branches still
 *      exist at their recorded tips, the canonical bundle still verifies with
 *      matching list-heads, and the recorded pre-cleanup HEAD is an ancestor of
 *      `main` (`git merge-base --is-ancestor RECORDED_HEAD main`);
 *   7. writes `.omo/evidence/task-7-flight-analysis-remediation-and-worktree-cleanup.md`
 *      with the before/after state and per-worktree/per-branch outcome.
 *
 * Usage (from the repo root):
 *   node tools/maintenance/remove-worktrees.mjs \
 *     --inventory .omo/evidence/task-6-flight-analysis-remediation-and-worktree-cleanup.json \
 *     --inventory-sha256 .omo/evidence/task-6-flight-analysis-remediation-and-worktree-cleanup.json.sha256 \
 *     --confirm-cleanup
 *
 * Optional:
 *   --evidence <path>   override the task-7 evidence markdown path
 *   --repo <root>       override the primary worktree root
 *   -h, --help          show help
 *
 * Exit codes: 0 = success (including an idempotent re-run), 2 = refusal /
 * missing confirmation / bad CLI, 3 = validation or TOCTOU abort, 4 = a git
 * operation failed, 5 = post-cleanup verification failed.
 *
 * This script never commits and never writes inside `.omo/evidence/worktree-preservation/`.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INVENTORY_BASENAME = 'task-6-flight-analysis-remediation-and-worktree-cleanup.json';
const SIDECAR_BASENAME = `${INVENTORY_BASENAME}.sha256`;
const CANONICAL_BUNDLE_BASENAME = 'task-6-worktree-branches.bundle';
const DEFAULT_EVIDENCE_BASENAME = 'task-7-flight-analysis-remediation-and-worktree-cleanup.md';
const SCHEMA = 'gtasa-stunttools.worktree-inventory/v1';
const BASELINE_BRANCH = 'main';
const PRESERVATION_DIR_REL = path.join('.omo', 'evidence', 'worktree-preservation');
const HEX40 = /^[0-9a-f]{40}$/;

class Abort extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'Abort';
    this.code = code;
    this.details = details;
  }
}

const log = (msg) => process.stderr.write(`[remove-worktrees] ${msg}\n`);
const say = (msg) => process.stdout.write(`${msg}\n`);

// ---------------------------------------------------------------------------
// generic helpers
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
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

function normPathKey(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function splitLines(text) {
  return String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------
// git runner with a hard allowlist (defense in depth)
// ---------------------------------------------------------------------------

const ALLOWED_COMMANDS = new Set([
  'status',
  'rev-parse',
  'rev-list',
  'hash-object',
  'worktree',
  'branch',
  'bundle',
  'merge-base',
  'show-ref',
  'log',
  'version',
]);

function assertSafeGitArgs(args) {
  for (const forbidden of ['--force', '-f', '-D', '--hard', '--delete', '--prune']) {
    if (args.includes(forbidden)) {
      throw new Abort(9, `internal guard: refusing forbidden git flag in: git ${args.join(' ')}`);
    }
  }
  const cmd = args[0];
  if (!ALLOWED_COMMANDS.has(cmd)) {
    throw new Abort(9, `internal guard: refusing git command: git ${args.join(' ')}`);
  }
  if (cmd === 'worktree') {
    const listOk = args[1] === 'list';
    const removeOk = args[1] === 'remove' && args.length === 3 && !args[2].startsWith('-');
    if (!listOk && !removeOk) {
      throw new Abort(9, `internal guard: only "worktree list" and "worktree remove <path>" are allowed: git ${args.join(' ')}`);
    }
  }
  if (cmd === 'branch') {
    const deleteOk = args[1] === '-d' && args.length === 3 && !args[2].startsWith('-');
    const listOk = (args[1] === '--list' || args[1] === '-vv' || args[1] === '--format=%(refname:short) %(objectname) %(subject)');
    if (!deleteOk && !listOk) {
      throw new Abort(9, `internal guard: only "branch -d <name>" and branch listing are allowed: git ${args.join(' ')}`);
    }
  }
  if (cmd === 'hash-object' && (args.includes('-w') || args.includes('--stdin'))) {
    throw new Abort(9, `internal guard: refusing writing git object: git ${args.join(' ')}`);
  }
  if (cmd === 'bundle') {
    if (args[1] !== 'verify' && args[1] !== 'list-heads') {
      throw new Abort(9, `internal guard: only "bundle verify" and "bundle list-heads" are allowed: git ${args.join(' ')}`);
    }
  }
  if (cmd === 'rev-list') {
    if (args[1] !== '--count' || args.length !== 3) {
      throw new Abort(9, `internal guard: only "rev-list --count <range>" is allowed: git ${args.join(' ')}`);
    }
  }
}

function runGit(cwd, args, opts = {}) {
  assertSafeGitArgs(args);
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input: opts.input,
    maxBuffer: opts.maxBuffer || 512 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (res.error) {
    throw new Abort(4, `failed to spawn git ${args.join(' ')}: ${res.error.message}`);
  }
  return {
    command: `git ${args.join(' ')}`,
    cwd,
    status: res.status === null ? -1 : res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function gitExpect(cwd, args, opts = {}) {
  const r = runGit(cwd, args, opts);
  if (r.status !== 0) {
    const detail = (r.stderr || r.stdout).trim();
    throw new Abort(4, `git ${args.join(' ')} exited ${r.status}${detail ? `\n${detail}` : ''}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// worktree / status parsing
// ---------------------------------------------------------------------------

function parseWorktreeListPorcelain(text) {
  const blocks = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') {
      if (cur) { blocks.push(cur); cur = null; }
      continue;
    }
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1);
    if (key === 'worktree') {
      if (cur) blocks.push(cur);
      cur = { path: value, head: null, branch: null, detached: false, bare: false, locked: null };
    } else if (!cur) {
      continue;
    } else if (key === 'HEAD') cur.head = value;
    else if (key === 'branch') cur.branch = value;
    else if (key === 'detached') cur.detached = true;
    else if (key === 'bare') cur.bare = true;
    else if (key === 'locked') cur.locked = value || '';
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseIgnoredSetNul(stdout) {
  const ignored = [];
  const untracked = [];
  for (const token of String(stdout).split('\0')) {
    if (token.startsWith('! ')) ignored.push(token.slice(2));
    else if (token.startsWith('? ')) untracked.push(token.slice(2));
  }
  return { ignored, untracked };
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

// ---------------------------------------------------------------------------
// ignored-artifact hashing (same method as inventory-worktrees.mjs)
// ---------------------------------------------------------------------------

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
        let st;
        try { st = fs.lstatSync(childAbs); } catch (err) { errors.push({ path: childRel, error: err.message }); continue; }
        if (st.isSymbolicLink()) {
          files.push({ abs: childAbs, rel: childRel, size: 0, symlink: true, target: fs.readlinkSync(childAbs) });
        } else {
          stack.push({ abs: childAbs, rel: childRel });
        }
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

function tryGitHashBatch(wtDir, absPaths) {
  try {
    const r = runGit(wtDir, ['hash-object', '--no-filters', '--stdin-paths'], {
      input: `${absPaths.join('\n')}\n`,
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
    size_bytes: total,
    file_count: files.length,
    sha256: h.digest('hex'),
    unreadable,
    walk_errors: errors,
  };
}

async function inventoryFile(absFile) {
  const st = fs.lstatSync(absFile);
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(absFile);
    return {
      kind: 'symlink',
      symlink_target: target,
      size_bytes: 0,
      file_count: 0,
      sha256: sha256Hex(Buffer.from(target, 'utf8')),
      unreadable: [],
      walk_errors: [],
    };
  }
  return {
    kind: 'file',
    symlink_target: null,
    size_bytes: st.size,
    file_count: 1,
    sha256: await sha256File(absFile),
    unreadable: [],
    walk_errors: [],
  };
}

async function hashArtifactEntry(gitCwd, abs) {
  if (!fs.existsSync(abs)) {
    return { kind: 'missing', symlink_target: null, size_bytes: 0, file_count: 0, sha256: null, unreadable: [], walk_errors: [{ path: abs, error: 'path no longer exists' }] };
  }
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) return inventoryFile(abs);
  if (st.isDirectory()) return inventoryDirectory(gitCwd, abs);
  return inventoryFile(abs);
}

// ---------------------------------------------------------------------------
// argument parsing / help
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    inventory: null,
    inventorySha256: null,
    confirmCleanup: false,
    evidence: null,
    repo: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Abort(2, `missing value for ${name}`);
      i += 1;
      return v;
    };
    if (a === '--inventory') opts.inventory = need(a);
    else if (a === '--inventory-sha256') opts.inventorySha256 = need(a);
    else if (a === '--confirm-cleanup') opts.confirmCleanup = true;
    else if (a === '--evidence') opts.evidence = need(a);
    else if (a === '--repo') opts.repo = need(a);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Abort(2, `unknown argument: ${a}`);
  }
  return opts;
}

function printHelp() {
  say('Usage: node tools/maintenance/remove-worktrees.mjs --inventory <json> --inventory-sha256 <sha256> --confirm-cleanup');
  say('');
  say('  --inventory <path>        todo-6 inventory JSON (must be ' + INVENTORY_BASENAME + ')');
  say('  --inventory-sha256 <path> sidecar SHA-256 of the inventory JSON (must be <inventory>.sha256)');
  say('  --confirm-cleanup         explicit user confirmation; without it the script refuses');
  say('  --evidence <path>         override the task-7 evidence markdown output path');
  say('  --repo <root>             override the primary worktree root (default: script repo root)');
  say('  -h, --help                show this help');
}

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

function readSidecarAndVerify(inventoryPath, sidecarPath) {
  if (path.basename(inventoryPath) !== INVENTORY_BASENAME) {
    throw new Abort(3, `REFUSED: unexpected inventory filename "${path.basename(inventoryPath)}" (expected ${INVENTORY_BASENAME})`);
  }
  if (path.basename(sidecarPath) !== SIDECAR_BASENAME) {
    throw new Abort(3, `REFUSED: unexpected sidecar filename "${path.basename(sidecarPath)}" (expected ${SIDECAR_BASENAME})`);
  }
  if (!fs.existsSync(inventoryPath)) throw new Abort(3, `REFUSED: inventory not found: ${inventoryPath}`);
  if (!fs.existsSync(sidecarPath)) throw new Abort(3, `REFUSED: sidecar not found: ${sidecarPath}`);

  const sidecarText = fs.readFileSync(sidecarPath, 'utf8');
  const m = sidecarText.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/m);
  if (!m) throw new Abort(3, `REFUSED: sidecar is not in "<sha256>  <filename>" format: ${sidecarPath}`);

  const expectedHash = m[1].toLowerCase();
  const listedName = path.basename(m[2].trim());
  const actualHash = sha256Hex(fs.readFileSync(inventoryPath));

  const problems = [];
  if (listedName !== INVENTORY_BASENAME) {
    problems.push(`sidecar names "${listedName}" but the inventory is ${INVENTORY_BASENAME}`);
  }
  if (actualHash !== expectedHash) {
    problems.push(`sidecar hash mismatch: sidecar=${expectedHash} actual=${actualHash}`);
  }
  if (problems.length > 0) {
    throw new Abort(3, 'REFUSED: inventory sidecar verification failed (tampered or stale state)', problems);
  }
  return { expectedHash, actualHash };
}

function validateInventory(json, inventoryPath) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };

  need(json && typeof json === 'object', 'inventory JSON is not an object');
  if (problems.length > 0) throw new Abort(3, 'REFUSED: inventory is unusable', problems);

  need(json.schema === SCHEMA, `unexpected schema: ${json.schema}`);
  need(json.mode === 'inventory', `unexpected mode: ${json.mode}`);
  need(json.deletion_performed === false, 'inventory already records a deletion');
  need(json.baseline_branch === BASELINE_BRANCH, `unexpected baseline branch: ${json.baseline_branch}`);
  need(Array.isArray(json.errors) && json.errors.length === 0, `inventory reported errors: ${JSON.stringify(json.errors)}`);
  need(json.state_recheck && json.state_recheck.stable === true, 'inventory state_recheck was not stable');
  need(json.main && HEX40.test(json.main.head || ''), 'inventory main.head is not a full SHA-1');
  need(Array.isArray(json.worktrees) && json.worktrees.length === 5, `expected 5 worktrees, found ${json.worktrees ? json.worktrees.length : 'none'}`);
  need(Array.isArray(json.expected_worktrees) && json.expected_worktrees.length === 5, 'expected_worktrees must list the five worktrees');
  need(json.bundle && json.bundle.verified === true, 'inventory bundle was not verified');
  need(json.bundle && json.bundle.branch_tips && typeof json.bundle.branch_tips === 'object', 'inventory bundle.branch_tips missing');

  if (json.worktrees) {
    for (const wt of json.worktrees) {
      need(wt.present === true && wt.found === true, `worktree ${wt.name}: not present in inventory`);
      need(wt.deletion_allowed === true, `worktree ${wt.name}: deletion not allowed`);
      need(wt.dirty === false, `worktree ${wt.name}: inventory marked dirty`);
      need(HEX40.test(wt.head || ''), `worktree ${wt.name}: head is not a full SHA-1`);
      need(typeof wt.branch === 'string' && wt.branch.length > 0, `worktree ${wt.name}: branch missing`);
      need(typeof wt.path === 'string' && wt.path.length > 0, `worktree ${wt.name}: path missing`);
      need(typeof wt.path_posix === 'string' && wt.path_posix.length > 0, `worktree ${wt.name}: path_posix missing`);
      need(wt.status && typeof wt.status.output_sha256 === 'string', `worktree ${wt.name}: status.output_sha256 missing`);
      need(Array.isArray(wt.ignored_artifacts), `worktree ${wt.name}: ignored_artifacts missing`);
      need(wt.branch_deletion && typeof wt.branch_deletion.commits_outside_main === 'number', `worktree ${wt.name}: branch_deletion.commits_outside_main missing`);
      need(json.bundle.branch_tips[wt.branch] === wt.head, `worktree ${wt.name}: branch tip is not bound to the worktree head`);
    }
  }
  if (problems.length > 0) {
    throw new Abort(3, 'REFUSED: inventory failed validation', problems);
  }
}

// ---------------------------------------------------------------------------
// pre-flight / TOCTOU checks
// ---------------------------------------------------------------------------

function checkStatus(wt) {
  const problems = [];
  const z = runGit(wt.path, ['status', '--porcelain=v2', '-z'], { maxBuffer: 256 * 1024 * 1024 });
  const hash = sha256Hex(Buffer.from(z.stdout, 'utf8'));
  if (hash !== wt.status.output_sha256) {
    problems.push(`status hash changed: recorded=${wt.status.output_sha256} live=${hash}`);
  }
  if (wt.dirty === false && z.stdout !== '') {
    problems.push(`worktree is now dirty/untracked: ${JSON.stringify(z.stdout.slice(0, 300))}`);
  }
  const plain = runGit(wt.path, ['status', '--porcelain=v2'], { maxBuffer: 256 * 1024 * 1024 });
  if (typeof wt.status.porcelain_v2_text === 'string' && plain.stdout !== wt.status.porcelain_v2_text) {
    problems.push('non-z status text changed since inventory');
  }
  return { statusHashLive: hash, porcelainTextLength: z.stdout.length, problems };
}

function checkIgnoredSet(wt) {
  const problems = [];
  const r = runGit(wt.path, ['status', '--porcelain=v2', '-z', '--ignored=traditional'], { maxBuffer: 256 * 1024 * 1024 });
  const { ignored, untracked } = parseIgnoredSetNul(r.stdout);
  const liveSet = new Set(ignored);
  const recordedSet = new Set(wt.ignored_artifacts.map((a) => a.path));
  for (const p of recordedSet) if (!liveSet.has(p)) problems.push(`ignored artifact disappeared from set: ${p}`);
  for (const p of liveSet) if (!recordedSet.has(p)) problems.push(`new ignored artifact not in inventory: ${p}`);
  for (const u of untracked) problems.push(`new untracked file: ${u}`);
  return { liveIgnored: [...liveSet].sort(), untracked, problems };
}

async function checkArtifacts(wt) {
  const problems = [];
  const results = [];
  for (const recorded of wt.ignored_artifacts) {
    const rel = recorded.path.endsWith('/') ? recorded.path.slice(0, -1) : recorded.path;
    const abs = path.join(wt.path, ...rel.split('/'));
    const live = await hashArtifactEntry(wt.path, abs);
    const item = { path: recorded.path, recordedSha: recorded.sha256, liveSha: live.sha256, recordedKind: recorded.kind, liveKind: live.kind, ok: true, problems: [] };
    if (live.kind !== recorded.kind) item.problems.push(`kind changed: recorded=${recorded.kind} live=${live.kind}`);
    if (live.sha256 !== recorded.sha256) item.problems.push(`sha256 changed: recorded=${recorded.sha256} live=${live.sha256}`);
    if (live.size_bytes !== recorded.size_bytes) item.problems.push(`size changed: recorded=${recorded.size_bytes} live=${live.size_bytes}`);
    if (live.file_count !== recorded.file_count) item.problems.push(`file_count changed: recorded=${recorded.file_count} live=${live.file_count}`);
    if (recorded.kind === 'symlink' && live.symlink_target !== recorded.symlink_target) {
      item.problems.push(`symlink target changed: recorded=${recorded.symlink_target} live=${live.symlink_target}`);
    }
    for (const e of (live.walk_errors || [])) item.problems.push(`walk error at ${e.path}: ${e.error}`);
    for (const u of (live.unreadable || [])) item.problems.push(`unreadable file ${u.path}: ${u.error}`);
    item.ok = item.problems.length === 0;
    if (!item.ok) problems.push(`${recorded.path}: ${item.problems.join('; ')}`);
    results.push(item);
  }
  return { artifacts: results, problems };
}

async function checkWorktreeLive(repoRoot, wt, registered) {
  const problems = [];
  const head = runGit(wt.path, ['rev-parse', 'HEAD'], { maxBuffer: 64 * 1024 * 1024 });
  const headLive = head.stdout.trim();
  if (headLive !== wt.head) problems.push(`HEAD changed: recorded=${wt.head} live=${headLive}`);
  if (registered && registered.head && registered.head !== wt.head) problems.push(`registered worktree HEAD changed: recorded=${wt.head} live=${registered.head}`);
  if (registered && registered.branch && registered.branch !== `refs/heads/${wt.branch}`) problems.push(`registered branch changed: ${registered.branch}`);
  if (registered && registered.locked !== null) problems.push('worktree is locked');

  const tip = runGit(repoRoot, ['rev-parse', `refs/heads/${wt.branch}`], { maxBuffer: 64 * 1024 * 1024 });
  const tipLive = tip.stdout.trim();
  if (tipLive !== wt.head) problems.push(`branch tip changed: recorded=${wt.head} live=${tipLive}`);

  const status = checkStatus(wt);
  problems.push(...status.problems);
  const ignored = checkIgnoredSet(wt);
  problems.push(...ignored.problems);
  const artifacts = await checkArtifacts(wt);
  problems.push(...artifacts.problems);

  return {
    name: wt.name,
    path: wt.path,
    headRecorded: wt.head,
    headLive,
    branchTipLive: tipLive,
    statusHashLive: status.statusHashLive,
    ignoredCount: ignored.liveIgnored.length,
    untrackedCount: ignored.untracked.length,
    artifacts: artifacts.artifacts,
    problems,
  };
}

async function runPreflight(repoRoot, json) {
  const problems = [];

  const version = runGit(repoRoot, ['version'], { allowFail: true });
  const gitVersion = (version.stdout || version.stderr || '').trim();

  const listRes = gitExpect(repoRoot, ['worktree', 'list', '--porcelain']);
  const blocks = parseWorktreeListPorcelain(listRes.stdout);

  const primary = blocks.find((b) => normPathKey(b.path) === normPathKey(repoRoot));
  if (!primary) problems.push(`primary worktree not found in git worktree list (repo root ${repoRoot})`);
  if (primary) {
    if (primary.branch !== `refs/heads/${BASELINE_BRANCH}`) problems.push(`primary worktree branch is ${primary.branch}, expected refs/heads/${BASELINE_BRANCH}`);
    if (primary.head !== json.main.head) problems.push(`main HEAD moved: recorded=${json.main.head} live=${primary.head}`);
    if (primary.locked !== null) problems.push('primary worktree is locked');
  }

  const mainRef = runGit(repoRoot, ['rev-parse', BASELINE_BRANCH], { allowFail: true });
  if (mainRef.status !== 0 || mainRef.stdout.trim() !== json.main.head) {
    problems.push(`git rev-parse main is ${mainRef.stdout.trim() || '(failed)'}, recorded ${json.main.head}`);
  }

  const allowedPaths = new Set([normPathKey(repoRoot), ...json.worktrees.map((w) => normPathKey(w.path))]);
  for (const b of blocks) {
    if (!allowedPaths.has(normPathKey(b.path))) {
      problems.push(`unexpected extra worktree present: ${toPosix(path.resolve(b.path))}`);
    }
    if (b.locked !== null) problems.push(`registered worktree is locked: ${toPosix(path.resolve(b.path))}`);
  }

  const byPath = new Map(blocks.map((b) => [normPathKey(b.path), b]));
  const worktreeChecks = [];
  const absent = [];
  for (const wt of json.worktrees) {
    const registered = byPath.get(normPathKey(wt.path)) || null;
    const existsOnDisk = fs.existsSync(wt.path);
    if (!registered) {
      if (existsOnDisk) {
        problems.push(`worktree ${wt.name}: path exists but is not registered (manual state change): ${wt.path}`);
      } else {
        absent.push({ name: wt.name, path: wt.path, status: 'already-removed' });
      }
      continue;
    }
    if (!existsOnDisk) {
      problems.push(`worktree ${wt.name}: registered but path is missing (manual deletion?): ${wt.path}`);
      continue;
    }
    if (registered.locked !== null) {
      problems.push(`worktree ${wt.name}: registered as locked`);
      continue;
    }
    const check = await checkWorktreeLive(repoRoot, wt, registered);
    worktreeChecks.push(check);
    problems.push(...check.problems.map((p) => `${wt.name}: ${p}`));
  }

  return { problems, blocks, primary, byPath, worktreeChecks, absent, gitVersion };
}

// ---------------------------------------------------------------------------
// preservation backup verification (read-only)
// ---------------------------------------------------------------------------

function quickTreeSignature(absDir) {
  if (!fs.existsSync(absDir)) return { exists: false, file_count: 0, sha256: null };
  const files = [];
  const errors = [];
  walkDirectory(absDir, '', files, errors);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const lines = files.map((f) => `${f.symlink ? 'L' : 'F'} ${f.size} ${f.rel}`);
  return { exists: true, file_count: files.length, sha256: sha256Hex(Buffer.from(lines.join('\n'), 'utf8')) };
}

async function verifyPreservation(repoRoot, json) {
  const problems = [];
  const entries = [];
  const preservation = json.preservation;
  if (!preservation || !Array.isArray(preservation.copied)) {
    problems.push('inventory has no preservation.copied list');
    return { problems, entries, signature: null };
  }
  const dir = preservation.dir ? path.resolve(preservation.dir) : path.resolve(repoRoot, PRESERVATION_DIR_REL);
  for (const copy of preservation.copied) {
    const abs = path.resolve(copy.preserved_to);
    const item = { worktree: copy.worktree, source_relative: copy.source_relative, preserved_to: toPosix(abs), ok: true, problems: [] };
    if (!fs.existsSync(abs)) {
      item.problems.push('preserved copy is missing');
    } else {
      const live = await hashArtifactEntry(repoRoot, abs);
      if (live.sha256 !== copy.sha256) item.problems.push(`sha256 changed: recorded=${copy.sha256} live=${live.sha256}`);
      if (live.size_bytes !== copy.size_bytes) item.problems.push(`size changed: recorded=${copy.size_bytes} live=${live.size_bytes}`);
      if (live.file_count !== copy.file_count) item.problems.push(`file_count changed: recorded=${copy.file_count} live=${live.file_count}`);
      for (const e of (live.walk_errors || [])) item.problems.push(`walk error at ${e.path}: ${e.error}`);
    }
    item.ok = item.problems.length === 0;
    if (!item.ok) problems.push(`${copy.worktree} ${copy.source_relative}: ${item.problems.join('; ')}`);
    entries.push(item);
  }
  return { problems, entries, signature: quickTreeSignature(dir) };
}

// ---------------------------------------------------------------------------
// bundle verification
// ---------------------------------------------------------------------------

function verifyBundle(repoRoot, bundlePath, json) {
  const problems = [];
  if (!fs.existsSync(bundlePath)) {
    problems.push(`bundle missing: ${toPosix(bundlePath)}`);
    return { path: toPosix(bundlePath), exists: false, verifyExit: null, verifyOutput: '', listHeads: [], problems };
  }
  const verify = runGit(repoRoot, ['bundle', 'verify', bundlePath], { maxBuffer: 64 * 1024 * 1024 });
  const list = runGit(repoRoot, ['bundle', 'list-heads', bundlePath], { maxBuffer: 64 * 1024 * 1024 });
  const listHeads = parseBundleHeads(list.stdout);
  for (const [branch, tip] of Object.entries(json.bundle.branch_tips)) {
    const got = listHeads.find((h) => h.ref === `refs/heads/${branch}`);
    if (!got) problems.push(`bundle is missing ref refs/heads/${branch}`);
    else if (got.sha !== tip) problems.push(`bundle tip for ${branch} is ${got.sha}, recorded ${tip}`);
  }
  if (verify.status !== 0) problems.push(`git bundle verify exited ${verify.status}`);
  return {
    path: toPosix(bundlePath),
    exists: true,
    verifyExit: verify.status,
    verifyOutput: `${verify.stdout}${verify.stderr ? `\n${verify.stderr}` : ''}`.trim(),
    listHeads,
    problems,
  };
}

// ---------------------------------------------------------------------------
// destructive actions
// ---------------------------------------------------------------------------

function unlinkJunction(abs, expectedTarget, wtName) {
  const st = fs.lstatSync(abs);
  if (!st.isSymbolicLink()) {
    throw new Abort(3, `TOCTOU: ${wtName}: expected a symlink/junction at ${abs} before removal`);
  }
  const target = fs.readlinkSync(abs);
  if (target !== expectedTarget) {
    throw new Abort(3, `TOCTOU: ${wtName}: symlink/junction target changed at ${abs}: ${target}`);
  }
  // rmdir removes the reparse point itself (link only) - it never recurses.
  try {
    fs.rmdirSync(abs);
  } catch (err) {
    if (err.code === 'ENOTDIR' || err.code === 'EPERM') {
      fs.unlinkSync(abs);
    } else {
      throw new Abort(4, `failed to unlink junction ${abs}: ${err.message}`);
    }
  }
  if (fs.existsSync(abs)) {
    throw new Abort(4, `junction still present after unlink: ${abs}`);
  }
  if (!fs.existsSync(target)) {
    throw new Abort(4, `junction target disappeared after unlink (this must never happen): ${target}`);
  }
}

async function removeOneWorktree(repoRoot, wt, json) {
  // TOCTOU: re-read HEAD, status, ignored set and every artifact hash
  // immediately before removal.
  const listRes = gitExpect(repoRoot, ['worktree', 'list', '--porcelain']);
  const registered = parseWorktreeListPorcelain(listRes.stdout).find((b) => normPathKey(b.path) === normPathKey(wt.path)) || null;
  if (!registered) {
    throw new Abort(4, `worktree ${wt.name} disappeared between pre-flight and removal`);
  }
  const recheck = await checkWorktreeLive(repoRoot, wt, registered);
  if (recheck.problems.length > 0) {
    throw new Abort(3, `TOCTOU: worktree changed since inventory: ${wt.name}`, recheck.problems);
  }

  // Unlink recorded junctions first so `git worktree remove` cannot recurse
  // through a reparse point into the main worktree.
  const unlinked = [];
  for (const recorded of wt.ignored_artifacts) {
    if (recorded.kind !== 'symlink') continue;
    const rel = recorded.path.endsWith('/') ? recorded.path.slice(0, -1) : recorded.path;
    const abs = path.join(wt.path, ...rel.split('/'));
    unlinkJunction(abs, recorded.symlink_target, wt.name);
    unlinked.push({ path: recorded.path, target: recorded.symlink_target });
  }

  // Plain `git worktree remove <path>` - never --force, never manual metadata.
  const remove = runGit(repoRoot, ['worktree', 'remove', wt.path], { maxBuffer: 64 * 1024 * 1024 });
  if (remove.status !== 0) {
    throw new Abort(4, `git worktree remove failed for ${wt.name} (exit ${remove.status})\n${(remove.stderr || remove.stdout).trim()}`);
  }

  const after = gitExpect(repoRoot, ['worktree', 'list', '--porcelain']);
  const stillRegistered = parseWorktreeListPorcelain(after.stdout).some((b) => normPathKey(b.path) === normPathKey(wt.path));
  if (stillRegistered) {
    throw new Abort(4, `worktree ${wt.name} is still registered after removal`);
  }
  if (fs.existsSync(wt.path)) {
    throw new Abort(4, `worktree directory still exists after removal: ${wt.path}`);
  }

  return {
    name: wt.name,
    path: wt.path,
    branch: wt.branch,
    head: wt.head,
    action: 'removed',
    command: remove.command,
    unlinked_junctions: unlinked,
    output: `${remove.stdout}${remove.stderr ? `\n${remove.stderr}` : ''}`.trim(),
  };
}

function deleteOrRetainBranches(repoRoot, json) {
  const actions = [];
  for (const wt of json.worktrees) {
    const branch = wt.branch;
    const exists = runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }).status === 0;
    if (!exists) {
      if (wt.branch_deletion.commits_outside_main === 0) {
        actions.push({ branch, action: 'already-absent', commits_outside_main: 0, tip: null, retained: false });
        continue;
      }
      throw new Abort(5, `retained branch ${branch} no longer exists (it had ${wt.branch_deletion.commits_outside_main} commit(s) outside main)`);
    }
    const tipRes = gitExpect(repoRoot, ['rev-parse', `refs/heads/${branch}`]);
    const tip = tipRes.stdout.trim();
    if (tip !== wt.head) {
      throw new Abort(3, `TOCTOU: branch ${branch} tip changed: recorded=${wt.head} live=${tip}`);
    }
    const countRes = gitExpect(repoRoot, ['rev-list', '--count', `${BASELINE_BRANCH}..${branch}`]);
    const count = Number.parseInt(countRes.stdout.trim(), 10);
    if (!Number.isInteger(count)) {
      throw new Abort(4, `could not parse rev-list count for ${branch}: ${countRes.stdout.trim()}`);
    }
    if (count !== 0) {
      log(`RETAINED ${branch}: ${count} commit(s) outside main (bundle is backup only; deletion is refused unconditionally)`);
      actions.push({ branch, action: 'retained', commits_outside_main: count, tip, retained: true });
      continue;
    }
    const del = runGit(repoRoot, ['branch', '-d', branch], { maxBuffer: 64 * 1024 * 1024 });
    if (del.status !== 0) {
      throw new Abort(4, `git branch -d ${branch} failed (exit ${del.status})\n${(del.stderr || del.stdout).trim()}`);
    }
    const gone = runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }).status !== 0;
    if (!gone) throw new Abort(4, `branch ${branch} still exists after deletion`);
    log(`deleted branch ${branch} (was ${tip.slice(0, 10)}, fully contained in main)`);
    actions.push({ branch, action: 'deleted', commits_outside_main: 0, tip, retained: false, output: `${del.stdout}${del.stderr ? `\n${del.stderr}` : ''}`.trim() });
  }
  return actions;
}

// ---------------------------------------------------------------------------
// post-cleanup verification
// ---------------------------------------------------------------------------

function postVerify(repoRoot, json, canonicalBundle) {
  const assertions = [];
  const add = (name, ok, detail) => assertions.push({ name, ok, detail });

  const listRes = gitExpect(repoRoot, ['worktree', 'list', '--porcelain']);
  const blocks = parseWorktreeListPorcelain(listRes.stdout);
  const primaryOnly = blocks.length === 1 && normPathKey(blocks[0].path) === normPathKey(repoRoot) && blocks[0].branch === `refs/heads/${BASELINE_BRANCH}`;
  add('git worktree list shows only the primary worktree', primaryOnly, JSON.stringify(blocks.map((b) => ({ path: toPosix(path.resolve(b.path)), branch: b.branch, head: b.head }))));

  const mainRef = runGit(repoRoot, ['rev-parse', BASELINE_BRANCH], { allowFail: true });
  add('main still at recorded HEAD', mainRef.status === 0 && mainRef.stdout.trim() === json.main.head, `recorded=${json.main.head} live=${mainRef.stdout.trim()}`);

  for (const wt of json.worktrees) {
    const exists = runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${wt.branch}`], { allowFail: true }).status === 0;
    if (wt.branch_deletion.commits_outside_main === 0) {
      add(`fully-contained branch deleted: ${wt.branch}`, !exists, exists ? 'branch still exists' : 'branch absent');
    } else {
      let tip = null;
      if (exists) {
        const tipRes = runGit(repoRoot, ['rev-parse', `refs/heads/${wt.branch}`], { allowFail: true });
        tip = tipRes.stdout.trim();
      }
      add(`retained branch still exists at recorded tip: ${wt.branch}`, exists && tip === wt.head, `live=${tip || '(missing)'} recorded=${wt.head}`);
    }
  }

  const bundle = verifyBundle(repoRoot, canonicalBundle, json);
  add('git bundle verify exits 0', bundle.exists && bundle.verifyExit === 0, `exit=${bundle.verifyExit}`);
  add('bundle list-heads match recorded tips', bundle.problems.length === 0, bundle.problems.join('; ') || 'all five tips match');

  const anc = runGit(repoRoot, ['merge-base', '--is-ancestor', json.main.head, BASELINE_BRANCH], { allowFail: true });
  add(`recorded pre-cleanup HEAD ${json.main.head.slice(0, 10)} is an ancestor of main`, anc.status === 0, `git merge-base --is-ancestor exit=${anc.status}`);

  return { assertions, listRes, bundle };
}

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

function codeBlock(text, lang = '') {
  return `\`\`\`${lang}\n${String(text).replace(/\s+$/, '')}\n\`\`\``;
}

function buildEvidence({ startedAt, finishedAt, json, inventoryPath, sidecar, repoRoot, gitVersion, preflight, preservation, actions, branchActions, post, canonicalBundle, runMode, bundleExtra }) {
  const L = [];
  L.push('# Task 7 - Worktree + branch removal (before/after)');
  L.push('');
  L.push(`- run_started_utc: ${startedAt}`);
  L.push(`- run_finished_utc: ${finishedAt}`);
  L.push(`- run_mode: ${runMode}`);
  L.push(`- repo_root: ${toPosix(repoRoot)}`);
  L.push(`- inventory: ${toPosix(inventoryPath)}`);
  L.push(`- inventory_sha256: ${sidecar.actualHash} (sidecar verified: ${sidecar.actualHash === sidecar.expectedHash})`);
  L.push(`- git_version: ${gitVersion}`);
  L.push(`- canonical_bundle: ${canonicalBundle}`);
  L.push('- guardrails: no --force; no manual .git/worktrees deletion; no git worktree prune; branches deleted only when git rev-list --count main..BRANCH == 0; a verified bundle does NOT permit deleting a branch with unique commits.');
  L.push('');
  L.push('## Before (recorded by the todo-6 inventory)');
  L.push('');
  L.push(`Inventory generated_at_utc: ${json.generated_at_utc}; main HEAD at inventory time: ${json.main.head}.`);
  L.push('');
  L.push('### git worktree list --porcelain (recorded)');
  L.push('');
  L.push(codeBlock(json.worktree_list_porcelain));
  L.push('');
  L.push('### branch tips (recorded)');
  L.push('');
  L.push(codeBlock(Object.entries(json.bundle.branch_tips).map(([b, t]) => `${t}  ${b}`).join('\n') + `\n${json.main.head}  ${BASELINE_BRANCH}`));
  L.push('');
  L.push('## Live state at run start');
  L.push('');
  L.push('### git worktree list --porcelain (live)');
  L.push('');
  L.push(codeBlock(preflight.blocks.map((b) => `worktree ${toPosix(path.resolve(b.path))}\nHEAD ${b.head}\nbranch ${b.branch}`).join('\n\n')));
  L.push('');
  L.push('### TOCTOU checks performed immediately before removal');
  L.push('');
  L.push('| worktree | head recorded | head live | status sha (live) | ignored entries | untracked | artifacts verified | problems |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const c of preflight.worktreeChecks) {
    L.push(`| ${c.name} | ${c.headRecorded.slice(0, 10)} | ${c.headLive.slice(0, 10)} | ${c.statusHashLive.slice(0, 12)} | ${c.ignoredCount} | ${c.untrackedCount} | ${c.artifacts.length} | ${c.problems.length === 0 ? 'none' : c.problems.join('; ')} |`);
  }
  for (const a of (preflight.absent || [])) {
    L.push(`| ${a.name} | - | - | - | - | - | - | already removed before this run |`);
  }
  L.push('');
  L.push('Per-artifact re-hash results (sha256 recorded -> live):');
  L.push('');
  for (const c of preflight.worktreeChecks) {
    for (const art of c.artifacts) {
      L.push(`- ${c.name}: ${art.path} [${art.recordedKind}] ${art.recordedSha} -> ${art.liveSha} ${art.ok ? 'OK' : 'CHANGED: ' + art.problems.join('; ')}`);
    }
  }
  L.push('');
  L.push('### Preservation backup verification (read-only; never modified)');
  L.push('');
  L.push(`- preservation dir: ${json.preservation.dir}`);
  L.push(`- copied artifacts verified: ${preservation.entries.length}, problems: ${preservation.problems.length}`);
  for (const e of preservation.entries) {
    L.push(`  - ${e.worktree} ${e.source_relative} -> ${e.preserved_to}: ${e.ok ? 'OK' : 'PROBLEM: ' + e.problems.join('; ')}`);
  }
  L.push(`- preservation tree signature (relpath+size manifest sha256): ${preservation.signature ? preservation.signature.sha256 : 'n/a'} (${preservation.signature ? preservation.signature.file_count : 0} files)`);
  L.push('');
  L.push('### Bundle verification before cleanup');
  L.push('');
  L.push(codeBlock(preflight.bundleBefore.verifyOutput));
  L.push('');
  L.push('## Actions');
  L.push('');
  for (const a of actions) {
    if (a.action === 'removed') {
      L.push(`- worktree ${a.name} (${a.branch}): ${a.command} -> exit 0`);
      for (const j of a.unlinked_junctions) L.push(`  - unlinked junction link only (target preserved): ${j.path} -> ${j.target}`);
    } else {
      L.push(`- worktree ${a.name} (${a.branch}): already removed before this run (idempotent)`);
    }
  }
  for (const b of branchActions) {
    if (b.action === 'deleted') L.push(`- branch ${b.branch}: git branch -d (commits outside main = 0) -> deleted; was ${b.tip}`);
    else if (b.action === 'retained') L.push(`- branch ${b.branch}: RETAINED - commits outside main = ${b.commits_outside_main}; no deletion performed`);
    else L.push(`- branch ${b.branch}: already absent (deleted by an earlier run)`);
  }
  L.push('');
  L.push('## After');
  L.push('');
  L.push('### git worktree list --porcelain');
  L.push('');
  L.push(codeBlock(post.listRes.stdout));
  L.push('');
  L.push('### git branch -vv');
  L.push('');
  L.push(codeBlock(post.branchVv));
  L.push('');
  L.push('### git branch --list "codex/*"');
  L.push('');
  L.push(codeBlock(post.branchCodex || '(none)'));
  L.push('');
  L.push('### git bundle verify');
  L.push('');
  L.push(codeBlock(post.bundle.verifyOutput));
  L.push('');
  if (bundleExtra && bundleExtra.length > 0) {
    L.push('### Additional bundle paths');
    L.push('');
    for (const e of bundleExtra) {
      L.push(`- ${e.path}: ${e.exists ? `exit=${e.verifyExit}` : 'MISSING (recorded path from inventory; canonical bundle above is authoritative)'}`);
      if (e.verifyOutput) L.push(codeBlock(e.verifyOutput));
    }
    L.push('');
  }
  L.push('## Verification assertions');
  L.push('');
  for (const a of post.assertions) {
    L.push(`- [${a.ok ? 'PASS' : 'FAIL'}] ${a.name} - ${a.detail}`);
  }
  L.push('');
  L.push(`Result: ${post.assertions.every((a) => a.ok) ? 'OK' : 'FAILED'}.`);
  L.push('');
  L.push('Cleanup command used:');
  L.push('');
  L.push(codeBlock(`node tools/maintenance/remove-worktrees.mjs --inventory .omo/evidence/${INVENTORY_BASENAME} --inventory-sha256 .omo/evidence/${SIDECAR_BASENAME} --confirm-cleanup`));
  L.push('');
  return `${L.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString();
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof Abort) {
      console.error(`REFUSED: ${err.message}`);
      return err.code;
    }
    throw err;
  }
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (!opts.confirmCleanup) {
    console.error('REFUSED: confirmation required - pass --confirm-cleanup together with --inventory and --inventory-sha256');
    return 2;
  }
  if (!opts.inventory || !opts.inventorySha256) {
    console.error('REFUSED: --inventory and --inventory-sha256 are both required');
    return 2;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = opts.repo ? path.resolve(opts.repo) : path.resolve(scriptDir, '..', '..');
  const inventoryPath = path.resolve(repoRoot, opts.inventory);
  const sidecarPath = path.resolve(repoRoot, opts.inventorySha256);
  const evidencePath = opts.evidence
    ? path.resolve(repoRoot, opts.evidence)
    : path.resolve(repoRoot, '.omo', 'evidence', DEFAULT_EVIDENCE_BASENAME);
  const canonicalBundle = path.resolve(path.dirname(inventoryPath), CANONICAL_BUNDLE_BASENAME);
  const preservationDir = path.resolve(repoRoot, PRESERVATION_DIR_REL);

  if (isInside(preservationDir, evidencePath) || isInside(preservationDir, inventoryPath) || isInside(preservationDir, sidecarPath)) {
    console.error('REFUSED: refusing to write or read from inside the preservation directory');
    return 2;
  }

  try {
    // 1) sidecar bind
    const sidecar = readSidecarAndVerify(inventoryPath, sidecarPath);
    log(`sidecar verified: ${sidecar.actualHash}`);

    const json = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    validateInventory(json, inventoryPath);
    log(`inventory validated: schema=${json.schema}, 5 worktrees, main=${json.main.head}`);

    for (const wt of json.worktrees) {
      if (normPathKey(wt.path) === normPathKey(repoRoot)) {
        throw new Abort(3, `REFUSED: worktree path equals the primary worktree: ${wt.path}`);
      }
    }

    // 2) preservation backups must still be intact BEFORE any deletion
    const preservation = await verifyPreservation(repoRoot, json);
    if (preservation.problems.length > 0) {
      throw new Abort(3, 'REFUSED: preservation backups are missing or changed; refusing to delete worktrees', preservation.problems);
    }
    log(`preservation verified: ${preservation.entries.length} copied artifact(s) intact`);

    // 3) bundle backup must verify before any deletion
    const bundleBefore = verifyBundle(repoRoot, canonicalBundle, json);
    if (bundleBefore.problems.length > 0) {
      throw new Abort(3, `REFUSED: canonical bundle does not verify: ${canonicalBundle}`, bundleBefore.problems);
    }
    const bundleExtra = [];
    if (json.bundle && json.bundle.path && path.resolve(json.bundle.path) !== canonicalBundle) {
      const extra = verifyBundle(repoRoot, path.resolve(json.bundle.path), json);
      bundleExtra.push({
        path: toPosix(path.resolve(json.bundle.path)),
        exists: extra.exists,
        verifyExit: extra.verifyExit,
        verifyOutput: extra.verifyOutput,
        problems: extra.problems,
      });
      if (extra.exists && extra.problems.length > 0) {
        throw new Abort(3, `REFUSED: recorded bundle does not verify: ${json.bundle.path}`, extra.problems);
      }
    }
    log(`bundle verified: ${bundleBefore.path}`);

    // 4) pre-flight TOCTOU for every worktree (no destructive action yet)
    const preflight = await runPreflight(repoRoot, json);
    preflight.bundleBefore = bundleBefore;
    if (preflight.problems.length > 0) {
      throw new Abort(3, 'REFUSED: pre-flight validation failed (nothing has been removed)', preflight.problems);
    }
    log('pre-flight validation passed for all worktrees');

    // 5) remove worktrees one by one, re-checking immediately before each
    const actions = [];
    for (const wt of json.worktrees) {
      const registered = preflight.byPath.get(normPathKey(wt.path)) || null;
      if (!registered) {
        log(`worktree ${wt.name}: already removed; skipping (idempotent)`);
        actions.push({ name: wt.name, path: wt.path, branch: wt.branch, head: wt.head, action: 'already-removed' });
        continue;
      }
      log(`removing worktree ${wt.name} (${wt.branch}) at ${wt.path}`);
      actions.push(await removeOneWorktree(repoRoot, wt, json));
    }

    // 6) delete only fully-contained branches; retain everything else
    const branchActions = deleteOrRetainBranches(repoRoot, json);

    // 7) post verification
    const post = postVerify(repoRoot, json, canonicalBundle);
    post.branchVv = gitExpect(repoRoot, ['branch', '-vv']).stdout.trim();
    const codexList = runGit(repoRoot, ['branch', '--list', 'codex/*'], { allowFail: true });
    post.branchCodex = codexList.stdout.trim();

    const failed = post.assertions.filter((a) => !a.ok);
    const runMode = actions.every((a) => a.action === 'already-removed') && branchActions.every((b) => b.action !== 'deleted') ? 'already-clean' : 'cleanup';

    // 8) evidence
    const evidence = buildEvidence({
      startedAt,
      finishedAt: new Date().toISOString(),
      json,
      inventoryPath,
      sidecar,
      repoRoot,
      gitVersion: preflight.gitVersion,
      preflight,
      preservation,
      actions,
      branchActions,
      post,
      canonicalBundle: toPosix(canonicalBundle),
      runMode,
      bundleExtra,
    });
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, evidence, 'utf8');
    log(`evidence written: ${toPosix(evidencePath)}`);

    say('');
    say('RESULT: ' + (failed.length === 0 ? 'OK' : 'FAILED'));
    say(`worktrees removed: ${actions.filter((a) => a.action === 'removed').length}; already removed: ${actions.filter((a) => a.action === 'already-removed').length}`);
    say(`branches deleted: ${branchActions.filter((b) => b.action === 'deleted').map((b) => b.branch).join(', ') || '(none)'}`);
    say(`branches retained: ${branchActions.filter((b) => b.action === 'retained').map((b) => `${b.branch} (${b.commits_outside_main} unique commit(s))`).join(', ') || '(none)'}`);
    say(`evidence: ${toPosix(evidencePath)}`);
    say('');
    say('final git worktree list:');
    say(post.listRes.stdout.trim());
    say('');
    say('final git branch:');
    say(post.branchVv);

    if (failed.length > 0) {
      for (const f of failed) console.error(`FAILED ASSERTION: ${f.name} - ${f.detail}`);
      return 5;
    }
    return 0;
  } catch (err) {
    if (err instanceof Abort) {
      console.error(`ABORT (${err.code}): ${err.message}`);
      for (const d of err.details) console.error(`  - ${d}`);
      return err.code;
    }
    console.error(`ABORT (1): ${err.stack || err.message}`);
    return 1;
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`ABORT (1): ${err.stack || err.message}`);
    process.exitCode = 1;
  });
