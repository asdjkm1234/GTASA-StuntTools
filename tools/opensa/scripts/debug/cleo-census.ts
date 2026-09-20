import { createRecordingHost, decodeScript, opcodeDef, ScriptRunner } from '@opensa/cleo';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The CLEO coverage joint (plan 097/02 decision 2): decode a corpus and report every opcode it uses,
 * sorted by frequency — the table plans 03-05 implement against, and the SAME code path plan 07 later
 * runs in CI. Until the VM handler registry + tier registry exist (plans 03/05) the `status` column
 * degrades to `-` (raw census, same output shape); the join lands with plan 03.
 *
 * Run: `npx tsx scripts/debug/cleo-census.ts [paths…] [--json]`
 *
 * Default corpus: `fixtures/original/cleo` (regenerate with `npm run test:fixtures`). The recon baseline
 * this must reproduce is in `docs/plans/097-cleo-basic/01-scm-decoding.md` (115 unique opcodes;
 * per-script counts 91/239/44/102/2085/64/64).
 */

const args = process.argv.slice(2);
const json = args.includes('--json');
const paths = args.filter((a) => !a.startsWith('--'));
if (paths.length === 0) {
  paths.push('fixtures/original/cleo');
}

const files: string[] = [];
const walk = (path: string): void => {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) {
      walk(join(path, entry));
    }
  } else if (path.toLowerCase().endsWith('.cs')) {
    files.push(path);
  }
};
for (const path of paths) {
  walk(path);
}

interface Row {
  count: number;
  perScript: Map<string, number>;
}

const rows = new Map<number, Row>();
const scripts: { file: string; instructions: number }[] = [];

for (const file of files) {
  const script = decodeScript(new Uint8Array(readFileSync(file)));
  const name = basename(file, '.cs');
  scripts.push({ file: name, instructions: script.instructions.length });
  for (const instruction of script.instructions) {
    const row = rows.get(instruction.opcode) ?? { count: 0, perScript: new Map() };
    row.count += 1;
    row.perScript.set(name, (row.perScript.get(name) ?? 0) + 1);
    rows.set(instruction.opcode, row);
  }
}

/** The plan 03 handler registry join: which used opcodes the VM serves today. The tier registry
 *  (plan 05/07) refines 'todo' into tiers; natives (0AA5-0AA8, 0A8C-0A8E…) land with plan 05. */
const registered = new Set(new ScriptRunner({ host: createRecordingHost() }).registry.ids());
const status = (id: number): string => (registered.has(id) ? 'vm' : 'todo');

if (json) {
  const out = [...rows.entries()].map(([id, row]) => ({
    count: row.count,
    extension: opcodeDef(id)?.extension ?? '?',
    id: id.toString(16).toUpperCase().padStart(4, '0'),
    name: opcodeDef(id)?.name ?? '???',
    perScript: Object.fromEntries(row.perScript),
    status: status(id),
  }));
  console.log(JSON.stringify({ opcodes: out, scripts }, null, 2));
} else {
  for (const script of scripts) {
    console.log(`${script.file.padEnd(20)} ${script.instructions} instructions`);
  }
  console.log(
    `\n${rows.size} unique opcodes across ${scripts.length} scripts (status: vm = plan 03 registry serves it, todo = plans 04/05):\n`,
  );
  console.log('  id    count  status  ext        name');
  for (const [id, row] of [...rows.entries()].sort(([, a], [, b]) => b.count - a.count)) {
    const def = opcodeDef(id);
    console.log(
      `  ${id.toString(16).toUpperCase().padStart(4, '0')}  ${String(row.count).padStart(5)}  ${status(id).padEnd(6)}  ${def?.extension.padEnd(10) ?? '?'} ${def?.name ?? '???'}`,
    );
  }
}
