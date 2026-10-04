/**
 * Sanny-like disassembly (plan 097/01 decision 5) — the decoder's proof. One deterministic line per
 * instruction; the corpus listings are committed as reference fixtures, so this format is a CONTRACT:
 * change it and the fixtures regenerate with it.
 *
 * Operand rendering: ints/floats literal; `$n` global / `n@` local (raw u16, no /4 folding); string
 * vars as `s$n`/`n@s`; arrays `$arr(base,idx@,size,flags)` / `arr@(…)`; strings single-quoted.
 */
import type { DecodedScript, Instruction } from './decode';
import type { Operand } from './operands';

import { opcodeDef } from './opcode-table';

/** The whole decoded script as a listing (one line per instruction + a footer size note). */
export function disassemble(script: DecodedScript): string {
  const lines = script.instructions.map(formatInstruction);
  if (script.footer.length > 0) {
    lines.push(`; footer: ${script.footer.length} bytes at ${script.codeEnd}`);
  }

  return `${lines.join('\n')}\n`;
}

/** One instruction as text: `offset: [NOT] NAME(id) operands…`. */
export function formatInstruction(instruction: Instruction): string {
  const def = opcodeDef(instruction.opcode);
  const name = def?.name ?? '???';
  const id = instruction.opcode.toString(16).toUpperCase().padStart(4, '0');
  const negated = instruction.negated ? 'NOT ' : '';
  const operands = instruction.operands.map(operand).join(' ');

  return `${instruction.offset.toString().padStart(6, '0')}: ${id} ${negated}${name}${operands ? ` ${operands}` : ''}`;
}

function float(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function operand(op: Operand): string {
  switch (op.kind) {
    case 'array': {
      const head = op.scope === 'global' ? '$arr' : 'arr@';

      return `${head}(${op.offset},${op.indexVar}@,${op.elemSize},0x${op.flags.toString(16)})`;
    }
    case 'float':
      return float(op.value);
    case 'int':
      return `${op.value}`;
    case 'string':
      return `'${op.value}'`;
    case 'var': {
      const stringVar = op.type >= 0x0a ? 's' : '';

      return op.scope === 'global' ? `${stringVar}$${op.index}` : `${op.index}@${stringVar}`;
    }
  }
}
