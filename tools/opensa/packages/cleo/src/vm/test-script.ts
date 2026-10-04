/**
 * Synthetic-script builder for VM tests: hand-rolled instruction lists with a consistent
 * offset/index map (offset = index × 10, so a jump to instruction k is the operand −(k × 10)).
 * Test infrastructure, not product code — corpus tests use the real decoder instead.
 */
import type { DecodedScript, Instruction } from '../core/decode';
import type { Operand } from '../core/operands';

export const OFFSET_STRIDE = 10;

export const int = (value: number): Operand => ({ kind: 'int', type: 0x01, value });
export const flt = (value: number): Operand => ({ kind: 'float', type: 0x06, value });
export const str = (value: string): Operand => ({ kind: 'string', type: 0x0e, value });
export const lvar = (index: number): Operand => ({ index, kind: 'var', scope: 'local', type: 0x03 });
export const gvar = (index: number): Operand => ({ index, kind: 'var', scope: 'global', type: 0x02 });
export const lstr = (index: number): Operand => ({ index, kind: 'var', scope: 'local', type: 0x11 });
export const larr = (offset: number, indexVar: number, size: number): Operand => ({
  elemSize: size,
  flags: 0,
  indexVar,
  kind: 'array',
  offset,
  scope: 'local',
  type: 0x08,
});

/** The operand that jumps to instruction `index` (script-local labels are negative). */
export const label = (index: number): Operand => int(-(index * OFFSET_STRIDE));

export interface Row {
  readonly negated?: boolean;
  readonly op: number;
  readonly operands?: readonly Operand[];
}

export function buildScript(rows: readonly Row[]): DecodedScript {
  const instructions: Instruction[] = rows.map((row, index) => ({
    negated: row.negated ?? false,
    offset: index * OFFSET_STRIDE,
    opcode: row.op,
    operands: row.operands ?? [],
  }));
  const offsetIndex = new Map(instructions.map((instruction, index) => [instruction.offset, index]));

  return { codeEnd: rows.length * OFFSET_STRIDE, footer: new Uint8Array(0), instructions, offsetIndex };
}
