import { decodeScript, disassemble, opcodeDef } from '@opensa/cleo';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Disassemble compiled CLEO scripts (plan 097/02 decision 1) — plan 01's `disassemble()` behind a
 * CLI, no duplicate decoder. Answers "what does this `.cs` actually do": the instruction listing,
 * the opcode frequency table, or just the strings (model names, GXT keys) at a glance.
 *
 * Run: `npx tsx scripts/debug/scm-disasm.ts <file.cs | dir> [more paths…] [--census] [--strings]
 *       [--json] [--out <dir>]`
 *
 * Default prints the Sanny-like listing per file (the exact format committed as the plan 01 fixture
 * listings). `--census` prints per-file + global opcode frequencies with extension names; `--strings`
 * prints string operands only; `--json` emits the typed instruction stream for piping; `--out` writes
 * one `<name>.txt` per script instead of stdout.
 */

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const outIndex = args.indexOf('--out');
const outDir = outIndex >= 0 ? args[outIndex + 1] : null;
const paths = args.filter((a, i) => !a.startsWith('--') && (outIndex < 0 || i !== outIndex + 1));

if (paths.length === 0) {
  console.error('usage: scm-disasm.ts <file.cs | dir> [--census] [--strings] [--json] [--out <dir>]');
  process.exit(1);
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

const global = new Map<number, number>();

for (const file of files) {
  const script = decodeScript(new Uint8Array(readFileSync(file)));
  if (flags.has('--json')) {
    console.log(JSON.stringify({ codeEnd: script.codeEnd, file, instructions: script.instructions }));
    continue;
  }
  if (flags.has('--census')) {
    const counts = new Map<number, number>();
    for (const instruction of script.instructions) {
      counts.set(instruction.opcode, (counts.get(instruction.opcode) ?? 0) + 1);
      global.set(instruction.opcode, (global.get(instruction.opcode) ?? 0) + 1);
    }
    console.log(`\n${file} — ${script.instructions.length} instructions, ${counts.size} unique opcodes`);
    for (const [id, count] of [...counts.entries()].sort(([, a], [, b]) => b - a)) {
      const def = opcodeDef(id);
      console.log(
        `  ${id.toString(16).toUpperCase().padStart(4, '0')}  ${String(count).padStart(5)}  ${def?.extension.padEnd(10) ?? '?'} ${def?.name ?? '???'}`,
      );
    }
    continue;
  }
  if (flags.has('--strings')) {
    console.log(`\n${file}`);
    for (const instruction of script.instructions) {
      for (const operand of instruction.operands) {
        if (operand.kind === 'string') {
          const def = opcodeDef(instruction.opcode);
          console.log(`  ${instruction.offset.toString().padStart(6, '0')}  ${def?.name ?? '???'}  '${operand.value}'`);
        }
      }
    }
    continue;
  }
  const listing = disassemble(script);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const dest = join(outDir, `${basename(file).replace(/\.cs$/i, '')}.txt`);
    writeFileSync(dest, listing);
    console.log(`wrote ${dest} (${script.instructions.length} instructions)`);
  } else {
    console.log(`\n; ${file} — ${script.instructions.length} instructions, code ${script.codeEnd} B`);
    console.log(listing);
  }
}

if (flags.has('--census') && files.length > 1) {
  console.log(`\nGLOBAL — ${global.size} unique opcodes across ${files.length} scripts`);
  for (const [id, count] of [...global.entries()].sort(([, a], [, b]) => b - a)) {
    const def = opcodeDef(id);
    console.log(
      `  ${id.toString(16).toUpperCase().padStart(4, '0')}  ${String(count).padStart(5)}  ${def?.extension.padEnd(10) ?? '?'} ${def?.name ?? '???'}`,
    );
  }
}
