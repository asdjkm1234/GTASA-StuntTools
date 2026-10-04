#!/usr/bin/env node
// check-doc-drift.mjs
//
// Guards the project docs against the drift this work introduced:
//   README.md, recorder/README.md and HANDOFF.md must document
//     - the v9 inferred gear/load columns and the inferred collision event,
//     - the replay audio engine plus its honesty limits,
//     - the 3D world endpoint markers (no-hide) and retired 2D panel,
//     - the export architecture plus its honesty limits,
//   and must NOT still describe the recorder as v7.
//
// The check reads the real files from disk on every run (no cached state, no
// assumptions). Exit 0 = docs OK. Exit 1 = drift found.
//
// Usage:
//   node tools/maintenance/check-doc-drift.mjs
//   node tools/maintenance/check-doc-drift.mjs --root <dir>   # check a copy
//   node tools/maintenance/check-doc-drift.mjs --self-test    # plant a stray
//                                                             # v7 claim and
//                                                             # prove it fails

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// tools/maintenance -> repo root is two levels up.
const DEFAULT_ROOT = resolve(HERE, '..', '..');

const DOC_FILES = ['README.md', 'recorder/README.md', 'HANDOFF.md'];

// ASCII anchors that must appear in the listed files. The docs carry these
// labels verbatim next to the Chinese prose, so the check is deterministic and
// does not depend on prose wording.
const REQUIRED_SECTIONS = [
  {
    id: 'v9-inferred-columns',
    label: 'v9 inferred gear/load columns',
    files: ['README.md', 'recorder/README.md', 'HANDOFF.md'],
    tokens: [
      'transmission_gear_inferred',
      'transmission_gear_source',
      'engine_load_inferred',
      'engine_load_source',
    ],
  },
  {
    id: 'v9-inferred-not-measured',
    label: 'inferred values labelled per-row, never measured',
    files: ['README.md', 'recorder/README.md', 'HANDOFF.md'],
    tokens: ['inferred', '*_source'],
  },
  {
    id: 'v9-collision-event',
    label: 'v9 inferred collision event format',
    files: ['README.md', 'recorder/README.md', 'HANDOFF.md'],
    tokens: ['# event', 'collision,inferred', 'impact_m_s2'],
  },
  {
    id: 'v9-rev-rpm-blocked',
    label: 'engine rev/RPM deliberately not emitted (G3 NO-GO)',
    files: ['README.md', 'HANDOFF.md'],
    tokens: ['rev/RPM', 'NO-GO'],
  },
  {
    id: 'audio-engine',
    label: 'replay audio engine and baked samples',
    files: ['README.md', 'HANDOFF.md'],
    tokens: [
      'engine-520-turbine',
      'THRUST',
      'WHINE',
      'SND_BANK_GENRL_VEHICLE_GEN',
      'SND_BANK_GENRL_FASTPROP',
      'collision-set',
      'explosion-set',
      'manifest.json',
    ],
  },
  {
    id: 'audio-limits',
    label: 'audio honesty: parameterization-faithful, NOT bit-exact',
    files: ['README.md', 'HANDOFF.md'],
    tokens: ['parameterization-faithful', 'NOT bit-exact'],
  },
  {
    id: 'markers-3d-no-hide',
    label: '3D world endpoint markers; density halo never hides a point',
    files: ['README.md', 'HANDOFF.md'],
    tokens: [
      '3D world endpoint markers',
      'every track endpoint',
      'density halo',
      'never hides a point',
      'flat 2D panel retired',
    ],
  },
  {
    id: 'export-architecture',
    label: 'export architecture: WebCodecs in-page + ffmpeg -c:v copy',
    files: ['README.md', 'HANDOFF.md'],
    tokens: ['WebCodecs', '-c:v copy', '1920x1080', 'no per-frame PNG'],
  },
  {
    id: 'export-limits',
    label: 'export honesty: NOT realtime, measured clip-length ratios',
    files: ['README.md', 'HANDOFF.md'],
    tokens: ['claim realtime export', '1.1x', '2-2.3x'],
  },
  {
    id: 'export-hud-fps-limits',
    label: 'HUD canvas mirror + 120fps cadence-only limit',
    files: ['README.md', 'HANDOFF.md'],
    tokens: ['canvas mirror', 'not pixel-identical', '12.5 Hz', 'cadence'],
  },
];

// Stale current-tense claims. Historical mentions of v7 (e.g. "v7 added the
// center-gear debug columns") are fine; a recorder described as v7 today is not.
const STALE_CLAIMS = [
  { id: 'recorder-v7', re: /录制器\s*v7/, message: 'recorder described as v7 (should be v9)' },
  { id: 'v7-recording-source', re: /v7\s*录制源/, message: 'recorder source called v7' },
  { id: 'v7-source', re: /v7\s*源/, message: 'recorder source called v7' },
  { id: 'still-v7', re: /仍为\s*v7/, message: 'recorder format still called v7' },
  { id: 'ascii-recorder-v7', re: /recorder\s+v7/i, message: 'recorder described as v7' },
];

function readDocs(root) {
  const docs = new Map();
  for (const rel of DOC_FILES) {
    const path = join(root, rel);
    try {
      const text = readFileSync(path, 'utf8');
      docs.set(rel, { path, ok: true, bytes: Buffer.byteLength(text, 'utf8'), text });
    } catch (err) {
      docs.set(rel, { path, ok: false, error: String(err && err.message ? err.message : err), text: '' });
    }
  }
  return docs;
}

function runCheck(root) {
  const docs = readDocs(root);
  const findings = [];

  for (const rel of DOC_FILES) {
    const info = docs.get(rel);
    if (info && !info.ok) {
      findings.push({ kind: 'missing-file', message: rel + ': cannot read (' + info.error + ')', file: rel });
    }
  }

  for (const section of REQUIRED_SECTIONS) {
    for (const rel of section.files) {
      const info = docs.get(rel);
      if (!info || !info.ok) continue;
      const missing = section.tokens.filter((t) => !info.text.includes(t));
      if (missing.length > 0) {
        findings.push({
          kind: 'missing-section',
          section: section.id,
          message: rel + ': missing ' + section.label + ' -> ' + missing.join(', '),
          file: rel,
        });
      }
    }
  }

  for (const rel of DOC_FILES) {
    const info = docs.get(rel);
    if (!info || !info.ok) continue;
    const lines = info.text.split(/\r?\n/);
    for (const stale of STALE_CLAIMS) {
      for (let i = 0; i < lines.length; i += 1) {
        if (stale.re.test(lines[i])) {
          findings.push({
            kind: 'stale-claim',
            section: stale.id,
            message: rel + ':' + (i + 1) + ': ' + stale.message + ' -> ' + lines[i].trim(),
            file: rel,
          });
        }
      }
    }
  }

  return { ok: findings.length === 0, findings, docs };
}

function report(result) {
  console.log('check-doc-drift: reading real files fresh on this run');
  for (const rel of DOC_FILES) {
    const info = result.docs.get(rel);
    if (info && info.ok) {
      console.log('  read   ' + rel + ' (' + info.bytes + ' bytes) -> ' + info.path);
    } else {
      console.log('  MISSING ' + rel + ' -> ' + (info ? info.path : '(unknown)'));
    }
  }
  if (result.ok) {
    console.log('  sections present: ' + REQUIRED_SECTIONS.map((s) => s.id).join(', '));
    console.log('  no stale v7 recorder claim found');
  } else {
    console.log('  findings:');
    for (const f of result.findings) {
      console.log('    [' + f.kind + '] ' + f.message);
    }
  }
}

function selfTest() {
  const errors = [];
  const tmp = mkdtempSync(join(tmpdir(), 'doc-drift-self-test-'));
  try {
    // 1) Copy the real docs into a throwaway tree; the baseline must pass.
    for (const rel of DOC_FILES) {
      const dest = join(tmp, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(DEFAULT_ROOT, rel), 'utf8'), 'utf8');
    }
    const baseline = runCheck(tmp);
    if (!baseline.ok) {
      errors.push(
        'baseline temp copy already fails: ' + baseline.findings.map((f) => f.message).join(' | '),
      );
    } else {
      console.log('self-test: baseline temp copy passes');
    }

    // 2) Plant a stray v7 claim; the check must now FAIL via the v7 rule.
    const target = join(tmp, 'HANDOFF.md');
    const planted =
      readFileSync(target, 'utf8') +
      '\n<!-- drift self-test -->\n\u672c\u673a\u5f55\u5236\u5668 v7 \u8f93\u51fa\u3002\n';
    writeFileSync(target, planted, 'utf8');

    const after = runCheck(tmp);
    const sawStale = after.findings.some(
      (f) => f.kind === 'stale-claim' && f.section === 'recorder-v7',
    );
    if (after.ok) {
      errors.push('planted stray v7 claim was NOT detected (check would exit 0)');
    }
    if (!sawStale) {
      errors.push('stray v7 claim was detected but not via the recorder-v7 rule');
    }
    if (!after.ok && sawStale) {
      console.log('self-test: planted stray v7 claim -> check FAILS as required (exit 1)');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    testPathRemoved(tmp);
  }

  if (errors.length > 0) {
    console.error('SELF-TEST FAIL:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('SELF-TEST PASS: stray v7 case detected; temp copy removed');
  return 0;
}

function testPathRemoved(p) {
  try {
    readFileSync(p);
    console.error('WARNING: temp copy still present at ' + p);
  } catch {
    console.log('self-test: temp copy removed -> ' + p);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest();
    return 0;
  }
  let root = DEFAULT_ROOT;
  const ri = args.indexOf('--root');
  if (ri !== -1 && args[ri + 1]) root = resolve(args[ri + 1]);

  const result = runCheck(root);
  report(result);
  if (!result.ok) {
    console.log('FAIL: ' + result.findings.length + ' drift finding(s)');
    process.exit(1);
  }
  console.log('PASS: v9 / audio / analysis / export sections present; no stale v7 recorder claim');
  return 0;
}

main();
