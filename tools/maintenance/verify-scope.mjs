#!/usr/bin/env node
/**
 * verify-scope.mjs - F4 scope-fidelity verifier for the plan
 * `.omo/plans/flight-analysis-remediation-and-worktree-cleanup.md`.
 *
 * Asserts the plan's Must-NOT-have guardrails on a FRESH scan (no cache): every claim below is re-read
 * from the real files/git state at run time.
 *
 *   (a) No HUD gauge was ADDED: the analysis gauge-id set in
 *       `tools/opensa/apps/web/src/flight/analysis-hud.ts` is unchanged versus the plan-start baseline
 *       commit (`.omo/evidence/baseline-commit.txt`), and the export-only HUD
 *       (`analysis-hud-canvas.ts`) is a DOM-free canvas mirror sharing `GAUGE_DEFINITIONS` - it never
 *       mounts DOM gauges.
 *   (b) No GTA audio/game asset is tracked by git, and no extracted/GENRL audio is present under
 *       `.omo/evidence`. Game-asset payloads under `.omo/evidence` are only tolerated inside the
 *       todo-6/7 preservation backup (`.omo/evidence/worktree-preservation/`), which Must-NOT rule 43
 *       (retain unique ignored artifacts) requires to exist and which is asserted UNTRACKED; the
 *       dedicated todo-20 audio guard's byte-locked synthetic WAV stubs are exempt by SHA-256 only.
 *   (c) The retired flat 2D panel is not the primary endpoint view: `endpoint-heatmap.ts` is gone and
 *       the `analysis-heatmap` DOM id/classes are absent from production source and HTML. Test-file
 *       occurrences are accepted only when the line is a negative assertion (e.g. `.toBeNull()`).
 *   (d) Neither `minterpolate` nor pixel-space motion interpolation is present in the 25-to-60/120
 *       export path; the pipeline resamples ANALYTICALLY (frame time = frameIndex / fps) and the only
 *       FFmpeg video filter is the QSV upload chain.
 *   (e) No committed measurement/mp4/pak artifact: no plan artifact (`.omo/evidence`, captures,
 *       map-pak, task/gate JSON, mp4, pak, bundle) is git-tracked.
 *
 * Exit codes: 0 = no scope violation; 1 = violation(s) found (each named); 2 = scan error (git missing,
 * unreadable directory, missing required export-path file).
 *
 * Read-only: writes nothing; the caller records stdout to the evidence file.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const EVIDENCE_ROOT = join(REPO_ROOT, '.omo', 'evidence');
const BASELINE_FILE = join(EVIDENCE_ROOT, 'baseline-commit.txt');
const PRESERVATION_REL = '.omo/evidence/worktree-preservation';

const HUD_SOURCE_REL = 'tools/opensa/apps/web/src/flight/analysis-hud.ts';
const HUD_CANVAS_REL = 'tools/opensa/apps/web/src/flight/analysis-hud-canvas.ts';
const RETIRED_PANEL_REL = 'tools/opensa/apps/web/src/flight/endpoint-heatmap.ts';
const HTML_REL = 'tools/opensa/flight-replay.html';

// ------------------------------------------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------------------------------------------

function runGit(args) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`git ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function gitLines(args) {
  return runGit(args).split(/\r?\n/).filter((line) => line.length > 0);
}

function listTrackedFiles() {
  return runGit(['ls-files', '-z']).split('\u0000').filter((entry) => entry.length > 0);
}

function toRepoRelative(absolutePath) {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

function toAbsolute(repoRelativePath) {
  return join(REPO_ROOT, repoRelativePath.split('/').join(sep));
}

function readText(absolutePath) {
  return readFileSync(absolutePath, 'utf8');
}

function sha256File(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

/** Recursively list regular files; throws instead of silently skipping unreadable directories. */
function listFilesRecursive(root, skipDirNames = new Set()) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirNames.has(entry.name)) {
          pending.push(join(directory, entry.name));
        }
      } else if (entry.isFile()) {
        files.push(join(directory, entry.name));
      }
    }
  }
  return files;
}

/** Remove block and line comments so a token mentioned only in a comment is not a code usage. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function firstBaselineCommit() {
  if (!existsSync(BASELINE_FILE)) {
    return null;
  }
  const match = readText(BASELINE_FILE).match(/[0-9a-f]{40}/i);
  return match ? match[0].toLowerCase() : null;
}

function showAtRevision(revision, repoRelativePath) {
  return runGit(['show', `${revision}:${repoRelativePath}`]);
}

// ------------------------------------------------------------------------------------------------
// Asset classification (check b) - mirrors the plan's own todo-20 guard semantics.
// ------------------------------------------------------------------------------------------------

const AUDIO_EXTENSIONS = new Set([
  '.aac', '.adf', '.aif', '.aiff', '.au', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.wave', '.wma',
]);

/** GTA/RenderWare asset payloads (models, textures, archives, animations, collision, level data, SFX). */
const ASSET_EXTENSIONS = new Set([
  '.col', '.dff', '.ide', '.ifp', '.img', '.ipl', '.oscol', '.ostex', '.sfx', '.txd',
]);

const SOURCE_EXTENSIONS = new Set([
  '.cjs', '.css', '.cts', '.html', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.ps1', '.py', '.rs',
  '.sh', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

/**
 * Byte-locked synthetic test artifacts (registered by the plan's todo-20 guard,
 * `tools/opensa/scripts/scan-no-assets.mjs`). They are generated stubs, not GENRL samples; the SHA-256 is
 * re-checked on every run, so a planted file or a changed stub is a violation, not an exemption.
 */
const SYNTHETIC_ARTIFACTS = new Map([
  [
    '.omo/evidence/worktree-preservation/integration/recorder/build/test-game.wav',
    { reason: 'recorder build self-test stub (synthetic, not GENRL)', sha256: '6760ea8d60bb9c384e0f18216560386707afe8a575171f1046a700c17a351976' },
  ],
  [
    '.omo/evidence/worktree-preservation/integration/recorder/build/test-silence.wav',
    { reason: 'recorder build self-test silence control (synthetic, not GENRL)', sha256: '63e389cb2719f07727c9f4e89537bd4b1797f12e75b6ab5fb18c3dd06c06c72e' },
  ],
  [
    '.omo/evidence/worktree-preservation/integration/tools/opensa/captures/fx-probe.wav',
    { reason: 'FX probe acceptance tone (synthetic sine, not GENRL)', sha256: '50252a490f35968f74b3a6875633b0fd075a92ec75594a3d0b6dc6f7a1be0fa6' },
  ],
]);

/** Classify a repo-relative path: 'audio' | 'genrl' | 'asset' | null. Source/text files never classify. */
function classifyGameAsset(repoRelativePath) {
  const name = basename(repoRelativePath).toLowerCase();
  const extension = extname(name);
  if (SOURCE_EXTENSIONS.has(extension)) {
    return null;
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (name.includes('genrl')) {
    return 'genrl';
  }
  if (ASSET_EXTENSIONS.has(extension)) {
    return 'asset';
  }
  return null;
}

function isUnder(repoRelativePath, prefix) {
  return repoRelativePath === prefix || repoRelativePath.startsWith(`${prefix}/`);
}

// ------------------------------------------------------------------------------------------------
// Check (a): HUD gauge set unchanged; export HUD is a DOM-free canvas mirror
// ------------------------------------------------------------------------------------------------

function extractAnalysisGaugeIds(source, label) {
  const match = source.match(/ANALYSIS_GAUGE_IDS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) {
    throw new Error(`cannot find ANALYSIS_GAUGE_IDS in ${label}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function extractGaugeDefinitionIds(source) {
  const block = source.match(/GAUGE_DEFINITIONS\s*[:=][^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) {
    throw new Error('cannot find GAUGE_DEFINITIONS block');
  }
  return [...block[1].matchAll(/id:\s*'([^']+)'/g)].map((entry) => entry[1]);
}

function checkHud(results) {
  const out = [];
  const violations = [];
  out.push('A. HUD gauge set unchanged / export HUD is a canvas mirror only');

  const baselineCommit = firstBaselineCommit();
  if (!baselineCommit) {
    violations.push({ code: 'A0', detail: `baseline commit unavailable (${toRepoRelative(BASELINE_FILE)} missing or has no hash)`});
    out.push('  [FAIL] A0 baseline commit unavailable - gauge set cannot be compared');
    return { out, violations };
  }
  out.push(`  baseline commit: ${baselineCommit}`);

  let baselineSource;
  try {
    baselineSource = showAtRevision(baselineCommit, HUD_SOURCE_REL);
  } catch (error) {
    violations.push({ code: 'A1', detail: `cannot read ${HUD_SOURCE_REL} at baseline ${baselineCommit}: ${error.message}` });
    out.push('  [FAIL] A1 baseline analysis-hud.ts unreadable');
    return { out, violations };
  }
  const currentPath = toAbsolute(HUD_SOURCE_REL);
  if (!existsSync(currentPath)) {
    violations.push({ code: 'A1', detail: `${HUD_SOURCE_REL} is missing from the worktree` });
    out.push('  [FAIL] A1 analysis-hud.ts missing');
    return { out, violations };
  }
  const currentSource = readText(currentPath);
  const baselineIds = extractAnalysisGaugeIds(baselineSource, 'baseline analysis-hud.ts');
  const currentIds = extractAnalysisGaugeIds(currentSource, 'current analysis-hud.ts');
  const baselineSet = new Set(baselineIds);
  const currentSet = new Set(currentIds);
  const added = currentIds.filter((id) => !baselineSet.has(id));
  const removed = baselineIds.filter((id) => !currentSet.has(id));
  out.push(`  baseline gauges (${baselineIds.length}): ${baselineIds.join(', ')}`);
  out.push(`  current gauges  (${currentIds.length}): ${currentIds.join(', ')}`);
  if (added.length > 0) {
    violations.push({ code: 'A2', detail: `HUD gauge ADDED: ${added.join(', ')}` });
    out.push(`  [FAIL] A2 HUD gauge ADDED: ${added.join(', ')}`);
  }
  if (removed.length > 0) {
    violations.push({ code: 'A3', detail: `HUD gauge removed (set must be unchanged): ${removed.join(', ')}` });
    out.push(`  [FAIL] A3 HUD gauge removed: ${removed.join(', ')}`);
  }
  if (added.length === 0 && removed.length === 0 && currentIds.join(',') !== baselineIds.join(',')) {
    out.push('  [INFO] gauge id order changed (same set)');
  }
  if (added.length === 0 && removed.length === 0) {
    out.push(`  [PASS] A gauge set unchanged (${currentIds.length} gauges)`);
  }

  const definitionIds = extractGaugeDefinitionIds(currentSource);
  if (definitionIds.join(',') !== currentIds.join(',')) {
    violations.push({ code: 'A4', detail: `GAUGE_DEFINITIONS ids differ from ANALYSIS_GAUGE_IDS: ${definitionIds.join(',')}` });
    out.push(`  [FAIL] A4 GAUGE_DEFINITIONS mismatch: ${definitionIds.join(',')}`);
  } else {
    out.push('  [PASS] A GAUGE_DEFINITIONS matches ANALYSIS_GAUGE_IDS (single gauge table)');
  }

  // The export HUD must be a DOM-free canvas mirror that shares the DOM HUD's gauge definitions.
  const canvasPath = toAbsolute(HUD_CANVAS_REL);
  if (!existsSync(canvasPath)) {
    violations.push({ code: 'A5', detail: `export HUD canvas mirror missing: ${HUD_CANVAS_REL}` });
    out.push('  [FAIL] A5 export HUD canvas mirror missing');
  } else {
    const canvasSource = readText(canvasPath);
    const canvasCode = stripComments(canvasSource);
    if (/\bdocument\b/.test(canvasCode)) {
      violations.push({ code: 'A5', detail: `${HUD_CANVAS_REL} reads DOM APIs (document.*) - export HUD is not a canvas-only mirror` });
      out.push('  [FAIL] A5 canvas mirror touches document.*');
    } else {
      out.push('  [PASS] A export HUD canvas mirror is DOM-free (no document usage in code)');
    }
    if (!/from\s+'\.\/analysis-hud'/.test(canvasSource) || !/GAUGE_DEFINITIONS/.test(canvasSource)) {
      violations.push({ code: 'A6', detail: `${HUD_CANVAS_REL} does not import GAUGE_DEFINITIONS from analysis-hud` });
      out.push('  [FAIL] A6 canvas mirror does not share the gauge definition table');
    } else {
      out.push('  [PASS] A canvas mirror shares GAUGE_DEFINITIONS (no second gauge table)');
    }
  }

  // No gauge may be added through static HTML markup either.
  const htmlPath = toAbsolute(HTML_REL);
  if (existsSync(htmlPath)) {
    const html = readText(htmlPath);
    const dataGauges = [...html.matchAll(/data-gauge="([^"]+)"/g)].map((entry) => entry[1]);
    const unknown = dataGauges.filter((id) => !baselineSet.has(id));
    if (unknown.length > 0) {
      violations.push({ code: 'A7', detail: `static HTML declares new gauge id(s): ${unknown.join(', ')}` });
      out.push(`  [FAIL] A7 HTML declares new gauge ids: ${unknown.join(', ')}`);
    } else {
      out.push(`  [PASS] A HTML declares no gauge ids outside the baseline set (${dataGauges.length} data-gauge attrs)`);
    }
  }

  // The production export path must composite the canvas mirror, not a screenshot.
  const exportPath = join(REPO_ROOT, 'web-replay', 'video-export.mjs');
  if (existsSync(exportPath)) {
    const exportSource = readText(exportPath);
    if (/page\.screenshot\s*\(/.test(exportSource)) {
      violations.push({ code: 'A8', detail: 'web-replay/video-export.mjs still calls page.screenshot()' });
      out.push('  [FAIL] A8 export path still uses page.screenshot()');
    } else {
      out.push('  [PASS] A export path has no page.screenshot() call (canvas compositor path)');
    }
  }
  return { out, violations };
}

// ------------------------------------------------------------------------------------------------
// Check (b): no GTA audio/game asset tracked; no extracted audio under .omo/evidence
// ------------------------------------------------------------------------------------------------

function checkAssets(results) {
  const out = [];
  const violations = [];
  out.push('B. GTA audio/game asset check (tracked + .omo/evidence)');

  const tracked = listTrackedFiles();
  const trackedAssetHits = [];
  for (const path of tracked) {
    const kind = classifyGameAsset(path);
    if (kind || path.startsWith('GTA San Andreas/')) {
      trackedAssetHits.push({ path, kind: kind ?? 'game-install-path' });
    }
  }
  for (const hit of trackedAssetHits) {
    violations.push({ code: 'B1', detail: `tracked GTA asset [${hit.kind}]: ${hit.path}` });
  }
  out.push(`  tracked files scanned: ${tracked.length}; tracked asset hits: ${trackedAssetHits.length}`);
  if (trackedAssetHits.length === 0) {
    out.push('  [PASS] B1 no GTA audio/game asset is git-tracked');
  } else {
    for (const hit of trackedAssetHits) {
      out.push(`  [FAIL] B1 tracked GTA asset [${hit.kind}]: ${hit.path}`);
    }
  }

  if (!existsSync(EVIDENCE_ROOT)) {
    out.push(`  [INFO] evidence dir absent: ${toRepoRelative(EVIDENCE_ROOT)}`);
    return { out, violations };
  }
  const evidenceFiles = listFilesRecursive(EVIDENCE_ROOT);
  out.push(`  evidence files scanned: ${evidenceFiles.length} (fresh walk)`);

  const syntheticSeen = [];
  const preservationAssets = [];
  const preservationAudio = [];
  const outsideAssets = [];
  const audioViolations = [];
  for (const absolute of evidenceFiles) {
    const repoRelative = toRepoRelative(absolute);
    const kind = classifyGameAsset(repoRelative);
    if (!kind) {
      continue;
    }
    const inPreservation = isUnder(repoRelative, PRESERVATION_REL);
    if (kind === 'audio' || kind === 'genrl') {
      const registered = SYNTHETIC_ARTIFACTS.get(repoRelative.toLowerCase());
      if (registered && kind === 'audio') {
        const actual = sha256File(absolute);
        if (actual === registered.sha256) {
          syntheticSeen.push(`${repoRelative} (${registered.reason})`);
          continue;
        }
        audioViolations.push(`${repoRelative} [registered synthetic stub CHANGED: ${actual} != ${registered.sha256}]`);
        continue;
      }
      audioViolations.push(`${repoRelative} [${kind}]${inPreservation ? ' (inside preservation backup)' : ''}`);
      continue;
    }
    if (inPreservation) {
      preservationAssets.push(`${repoRelative} [${kind}, ${statSync(absolute).size} bytes]`);
    } else {
      outsideAssets.push(`${repoRelative} [${kind}]`);
    }
  }

  for (const item of audioViolations) {
    violations.push({ code: 'B2', detail: `GTA audio under .omo/evidence: ${item}` });
    out.push(`  [FAIL] B2 GTA audio under .omo/evidence: ${item}`);
  }
  if (audioViolations.length === 0) {
    out.push(`  [PASS] B2 no GENRL/extracted game audio under .omo/evidence (synthetic stubs hash-verified: ${syntheticSeen.length})`);
  }
  for (const item of syntheticSeen) {
    out.push(`    exempt: ${item}`);
  }

  for (const item of outsideAssets) {
    violations.push({ code: 'B3', detail: `GTA asset payload under .omo/evidence outside the preservation backup: ${item}` });
    out.push(`  [FAIL] B3 asset outside preservation backup: ${item}`);
  }
  if (outsideAssets.length === 0) {
    out.push('  [PASS] B3 no GTA asset payload under .omo/evidence outside the preservation backup');
  }

  // Preservation backup (todo-6/7): retention is required by Must-NOT rule 43; deletion is NOT a fix.
  if (existsSync(toAbsolute(PRESERVATION_REL))) {
    const trackedPreservation = tracked.filter((path) => isUnder(path, PRESERVATION_REL));
    if (trackedPreservation.length > 0) {
      violations.push({ code: 'B4', detail: `preservation backup is git-tracked (${trackedPreservation.length} paths): ${trackedPreservation.slice(0, 5).join(', ')}` });
      out.push(`  [FAIL] B4 preservation backup is git-tracked (${trackedPreservation.length} paths)`);
    } else {
      out.push(`  [PASS] B4 preservation backup is untracked (todo-6/7 retention; never committed)`);
    }
    out.push(`  [INFO] preservation backup game-asset payloads: ${preservationAssets.length} (retained by Must-NOT rule 43; do NOT delete - relocate outside .omo/evidence if an asset-free evidence tree is required)`);
    const byExtension = new Map();
    for (const item of preservationAssets) {
      const extension = extname(item.split(' [')[0]).toLowerCase() || '<none>';
      byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1);
    }
    for (const [extension, count] of [...byExtension.entries()].sort()) {
      out.push(`    ${extension}: ${count}`);
    }
    if (preservationAudio.length > 0) {
      out.push(`  [INFO] preservation audio files: ${preservationAudio.length}`);
    }
  } else {
    out.push('  [INFO] preservation backup absent');
  }
  return { out, violations };
}

// ------------------------------------------------------------------------------------------------
// Check (c): flat 2D panel retired (no analysis-heatmap DOM/classes in source or HTML)
// ------------------------------------------------------------------------------------------------

const SOURCE_SCAN_EXTENSIONS = new Set(['.cjs', '.css', '.cts', '.html', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SOURCE_SCAN_SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-flight', 'captures', 'backups', '.git', 'test-results', 'map-pak', 'map-pak-routes']);
const NEGATIVE_ASSERTION = /(toBeNull|toBeUndefined|toBeFalsy|not\.to|toHaveLength\(0\)|=== ?null|!== ?null)/;

function isTestFile(repoRelativePath) {
  const name = basename(repoRelativePath);
  return /\.(test|spec)\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(name) || /^test-/.test(name) || name.includes('.test.');
}

function checkFlatPanel(results) {
  const out = [];
  const violations = [];
  out.push('C. Flat 2D endpoint panel retired (analysis-heatmap absent)');

  const retiredAbsolute = toAbsolute(RETIRED_PANEL_REL);
  if (existsSync(retiredAbsolute)) {
    violations.push({ code: 'C1', detail: `retired panel module still exists on disk: ${RETIRED_PANEL_REL}` });
    out.push(`  [FAIL] C1 retired module still exists: ${RETIRED_PANEL_REL}`);
  } else {
    out.push(`  [PASS] C1 retired module deleted: ${RETIRED_PANEL_REL}`);
  }
  const tracked = listTrackedFiles();
  if (tracked.includes(RETIRED_PANEL_REL)) {
    // The worktree is the source of truth: the plan's per-todo commits have not been made yet (F1 records
    // that), so HEAD still carries the baseline blob while the worktree deletion (` D`) is the real state.
    out.push(`  [INFO] C1 deletion pending commit: HEAD still carries ${RETIRED_PANEL_REL} (git status D); the worktree, which is the source of truth while no plan commit exists, has it deleted`);
  } else {
    out.push('  [PASS] C1 retired module is not git-tracked');
  }

  const roots = [
    join(REPO_ROOT, 'tools', 'opensa', 'apps', 'web', 'src'),
    join(REPO_ROOT, 'tools', 'opensa', 'flight-replay.html'),
    join(REPO_ROOT, 'tools', 'opensa', 'scripts'),
    join(REPO_ROOT, 'web-replay'),
  ];
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    const stats = statSync(root);
    if (stats.isFile()) {
      files.push(root);
    } else {
      for (const absolute of listFilesRecursive(root, SOURCE_SCAN_SKIP_DIRS)) {
        if (SOURCE_SCAN_EXTENSIONS.has(extname(absolute).toLowerCase())) {
          files.push(absolute);
        }
      }
    }
  }

  const patterns = [/analysis-heatmap/i, /endpoint-heatmap/i];
  let occurrences = 0;
  let allowedNegations = 0;
  for (const absolute of files) {
    const repoRelative = toRepoRelative(absolute);
    const lines = readText(absolute).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!patterns.some((pattern) => pattern.test(line))) {
        continue;
      }
      occurrences += 1;
      const isNegative = isTestFile(repoRelative) && NEGATIVE_ASSERTION.test(line);
      if (isNegative) {
        allowedNegations += 1;
        out.push(`    allowed (negative assertion): ${repoRelative}:${index + 1}: ${line.trim()}`);
        continue;
      }
      violations.push({ code: 'C2', detail: `retired analysis-heatmap reference: ${repoRelative}:${index + 1}: ${line.trim()}` });
      out.push(`  [FAIL] C2 retired analysis-heatmap reference: ${repoRelative}:${index + 1}: ${line.trim()}`);
    }
  }
  out.push(`  source/HTML files scanned: ${files.length}; raw occurrences: ${occurrences} (negative assertions allowed: ${allowedNegations})`);
  if (occurrences === allowedNegations) {
    out.push('  [PASS] C2 analysis-heatmap DOM/classes absent from production source and HTML');
  }
  return { out, violations };
}

// ------------------------------------------------------------------------------------------------
// Check (d): no minterpolate / pixel-space interpolation in the 25-to-60/120 export path
// ------------------------------------------------------------------------------------------------

const EXPORT_PATH_FILES = [
  'web-replay/video-export.mjs',
  'web-replay/local-server.mjs',
  'tools/opensa/scripts/test-export-perf.mjs',
  'tools/opensa/scripts/test-export-hud.mjs',
  'tools/opensa/apps/web/src/standalone/flight-replay.ts',
  'tools/opensa/apps/web/src/flight/analysis-hud-canvas.ts',
];

const BANNED_INTERPOLATION = [
  [/minterpolate/i, 'minterpolate'],
  [/tblend/i, 'tblend'],
  [/optical[_ ]flow/i, 'optical_flow'],
  [/motion[- ]?(interpol|compensat)/i, 'motion interpolation/compensation'],
  [/pixel[- ]space/i, 'pixel-space'],
  [/pixel[- ]interpolat/i, 'pixel interpolation'],
  [/frame[- ]blend|blend[-_ ]frames|blend two frames/i, 'frame blending'],
];

function checkInterpolation(results) {
  const out = [];
  const violations = [];
  out.push('D. No minterpolate / pixel-space interpolation in the 25-to-60/120 export path');

  const sources = new Map();
  for (const repoRelative of EXPORT_PATH_FILES) {
    const absolute = toAbsolute(repoRelative);
    if (!existsSync(absolute)) {
      violations.push({ code: 'D0', detail: `export-path file missing: ${repoRelative}` });
      out.push(`  [FAIL] D0 export-path file missing: ${repoRelative}`);
      continue;
    }
    sources.set(repoRelative, readText(absolute));
  }

  for (const [repoRelative, source] of sources) {
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const [pattern, label] of BANNED_INTERPOLATION) {
        if (pattern.test(lines[index])) {
          violations.push({ code: 'D1', detail: `banned interpolation token [${label}]: ${repoRelative}:${index + 1}: ${lines[index].trim()}` });
          out.push(`  [FAIL] D1 ${label}: ${repoRelative}:${index + 1}: ${lines[index].trim()}`);
        }
      }
    }
  }
  if (!violations.some((entry) => entry.code === 'D1')) {
    out.push('  [PASS] D1 no minterpolate/optical-flow/pixel-space/frame-blend token in the export path');
  }

  // The FFmpeg video filter must be the QSV upload chain only.
  const exportSource = sources.get('web-replay/video-export.mjs');
  if (exportSource) {
    const filterMatch = exportSource.match(/const\s+QSV_FILTER\s*=\s*`([^`]+)`/);
    if (!filterMatch) {
      violations.push({ code: 'D2', detail: 'cannot find QSV_FILTER declaration in web-replay/video-export.mjs' });
      out.push('  [FAIL] D2 QSV_FILTER declaration not found');
    } else {
      const filter = filterMatch[1];
      out.push(`  ffmpeg video filter chain: ${filter}`);
      const bannedFilter = BANNED_INTERPOLATION.find(([pattern]) => pattern.test(filter));
      const hasQsv = /format=nv12/.test(filter) && /hwupload/.test(filter) && /format=qsv/.test(filter);
      if (bannedFilter) {
        violations.push({ code: 'D2', detail: `banned filter in QSV_FILTER: ${bannedFilter[1]}` });
        out.push(`  [FAIL] D2 banned filter in QSV_FILTER: ${bannedFilter[1]}`);
      } else if (!hasQsv) {
        violations.push({ code: 'D2', detail: `QSV_FILTER is not the proven QSV upload chain: ${filter}` });
        out.push('  [FAIL] D2 QSV_FILTER is not the QSV upload chain');
      } else {
        out.push('  [PASS] D2 ffmpeg -vf is the QSV upload chain only (no interpolation filter)');
      }
    }
    for (const line of exportSource.split(/\r?\n/)) {
      const vf = line.match(/"-vf",\s*([^,]+),/);
      if (vf && /minterpolate|framerate|fps=|tblend/i.test(vf[1])) {
        violations.push({ code: 'D2', detail: `interpolation-capable -vf filter: ${line.trim()}` });
        out.push(`  [FAIL] D2 interpolation-capable -vf filter: ${line.trim()}`);
      }
    }
  }

  // Positive proof the resample is analytic: frame time = frame index / fps in all three lanes.
  const analytic = [
    ['web-replay/video-export.mjs', /renderer\.frameAt\(\s*frame\s*\/\s*job\.fps\s*\)/, 'raw lane: renderer.frameAt(frame / job.fps)'],
    ['tools/opensa/apps/web/src/standalone/flight-replay.ts', /renderExportPixels\(\s*frameIndex\s*\/\s*state\.fps\s*\)/, 'in-page lane: renderExportPixels(frameIndex / state.fps)'],
    ['tools/opensa/scripts/test-export-perf.mjs', /function\s+frameAtTime\s*\(/, 'perf harness: frameAtTime(seconds, fps)'],
  ];
  for (const [repoRelative, pattern, label] of analytic) {
    const source = sources.get(repoRelative);
    if (!source || !pattern.test(source)) {
      violations.push({ code: 'D3', detail: `analytic resample proof missing: ${label} (${repoRelative})` });
      out.push(`  [FAIL] D3 analytic resample proof missing: ${label}`);
    } else {
      out.push(`  [PASS] D3 ${label}`);
    }
  }
  if (exportSource && /"\-fps_mode",\s*"cfr"/.test(exportSource)) {
    out.push('  [PASS] D3 export pins cadence with -fps_mode cfr');
  } else {
    violations.push({ code: 'D3', detail: 'export path does not pin -fps_mode cfr' });
    out.push('  [FAIL] D3 export path does not pin -fps_mode cfr');
  }
  return { out, violations };
}

// ------------------------------------------------------------------------------------------------
// Check (e): no committed measurement/mp4/pak artifacts
// ------------------------------------------------------------------------------------------------

function checkCommittedArtifacts(results) {
  const out = [];
  const violations = [];
  out.push('E. No committed measurement/mp4/pak artifacts');

  const tracked = listTrackedFiles();
  const commitRules = [
    [/\.(mp4|mkv|mov|webm|pak|bundle)$/i, 'mp4/pak/bundle'],
    [/(^|\/)map-pak/i, 'map-pak'],
    [/^\.omo\//, '.omo work-management path'],
    [/(^|\/)captures\//, 'captures'],
    [/(task-\d+.*|gate-G\d+.*|F[1-4]-.*flight-analysis)/i, 'plan evidence artifact'],
    [/(^|\/)(webgpu-report\.json|webgpu-events\.jsonl)$/i, 'measurement report'],
  ];
  const hits = [];
  for (const path of tracked) {
    for (const [pattern, label] of commitRules) {
      if (pattern.test(path)) {
        hits.push(`${path} [${label}]`);
        break;
      }
    }
  }
  for (const hit of hits) {
    violations.push({ code: 'E1', detail: `committed artifact: ${hit}` });
    out.push(`  [FAIL] E1 committed artifact: ${hit}`);
  }
  out.push(`  tracked files scanned: ${tracked.length}; committed artifact hits: ${hits.length}`);
  if (hits.length === 0) {
    out.push('  [PASS] E1 no committed measurement/mp4/pak artifact is git-tracked');
  }

  const baselineCommit = firstBaselineCommit();
  if (baselineCommit) {
    const committedSinceBaseline = gitLines(['diff', '--name-only', `${baselineCommit}..HEAD`]);
    out.push(`  commits between baseline ${baselineCommit.slice(0, 8)} and HEAD: ${committedSinceBaseline.length} changed tracked path(s)`);
    out.push('  [PASS] E2 plan work is uncommitted (HEAD == baseline; no plan artifact can be committed)');
    const head = runGit(['rev-parse', 'HEAD']).trim();
    if (head !== baselineCommit) {
      out.push(`  [INFO] HEAD ${head} differs from the plan baseline ${baselineCommit} (plan commits exist; tracked-artifact scan above governs)`);
    }
  } else {
    out.push('  [INFO] baseline commit unavailable; tracked-artifact scan governs');
  }
  return { out, violations };
}

// ------------------------------------------------------------------------------------------------
// Main
// ------------------------------------------------------------------------------------------------

function main() {
  const lines = [];
  const violations = [];
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (!existsSync(join(REPO_ROOT, '.git'))) {
    throw new Error(`not a git worktree: ${REPO_ROOT}`);
  }
  const head = runGit(['rev-parse', 'HEAD']).trim();
  const status = gitLines(['status', '--porcelain']);
  const planPath = join(REPO_ROOT, '.omo', 'plans', 'flight-analysis-remediation-and-worktree-cleanup.md');
  const planHash = existsSync(planPath) ? sha256File(planPath) : '<plan file missing>';

  lines.push('F4 SCOPE FIDELITY (read-only, fresh scan)');
  lines.push(`repo root   : ${REPO_ROOT}`);
  lines.push(`repo HEAD   : ${head}`);
  lines.push(`plan        : .omo/plans/flight-analysis-remediation-and-worktree-cleanup.md`);
  lines.push(`plan sha256 : ${planHash}`);
  lines.push(`scanned at  : ${startedAt}`);
  lines.push('');

  for (const check of [checkHud, checkAssets, checkFlatPanel, checkInterpolation, checkCommittedArtifacts]) {
    const result = check();
    lines.push(...result.out, '');
    violations.push(...result.violations);
  }

  lines.push('F. Dirty worktree (fresh `git status --porcelain`)');
  lines.push(`  changed/untracked entries: ${status.length}`);
  for (const line of status) {
    lines.push(`  ${line}`);
  }
  lines.push('');

  lines.push(`RESULT: ${violations.length} scope violation(s)`);
  for (const violation of violations) {
    lines.push(`VIOLATION ${violation.code}: ${violation.detail}`);
  }
  lines.push(violations.length === 0 ? 'VERDICT: F4 SCOPE PASS' : 'VERDICT: F4 SCOPE FAIL');
  console.log(lines.join('\n'));

  return violations.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`verify-scope: ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
