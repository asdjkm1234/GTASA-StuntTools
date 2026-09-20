/**
 * The assembler's input (plan cleo-sdk/002 decision 1): a flat instruction list — opcode by Sanny
 * name or raw id, negation flag, concrete operands plus symbolic label references. Arity is checked
 * HERE, at construction, against the generated opcode table; byte emission never sees a malformed
 * instruction. The DSL (plan 004) produces this; the whitelist gate (plan 003) walks it.
 */
import type { Operand } from '@opensa/cleo';

import { opcodeDef, type OpcodeDef, opcodeTable } from '@opensa/cleo';
import {
  TYPE_FLOAT32,
  TYPE_GLOBAL_VAR,
  TYPE_INT8,
  TYPE_INT16,
  TYPE_INT32,
  TYPE_LOCAL_VAR,
  TYPE_LOCAL_VAR_STRING8,
  TYPE_STRING8,
  TYPE_STRING16,
  TYPE_STRING_VARLEN,
} from '@opensa/cleo/core/operands';

export interface IrInstruction {
  /** Labels DEFINED at this instruction's offset (jump targets land here). */
  readonly labels: readonly string[];
  readonly negated: boolean;
  readonly opcode: number;
  readonly operands: readonly IrOperand[];
}

export type IrOperand = LabelRef | Operand;

/** A symbolic jump target — the assembler resolves it to a negative int32 offset. */
export interface LabelRef {
  readonly kind: 'label';
  readonly name: string;
}

/** A malformed instruction at construction time — never a garbage byte at emit time. */
export class IrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IrError';
  }
}

export function float(value: number): Operand {
  return { kind: 'float', type: TYPE_FLOAT32, value };
}

/** A global numeric variable by its u16 index. */
export function gvar(index: number): Operand {
  return { index, kind: 'var', scope: 'global', type: TYPE_GLOBAL_VAR };
}

// --- Operand factories (the authoring width POLICY: smallest int width that holds the value) ---

/** An IR instruction, validated against the opcode DB (name or id; arity; negation on conditions only). */
export function instruction(
  opcode: number | string,
  operands: readonly IrOperand[] = [],
  options: { readonly labels?: readonly string[]; readonly negated?: boolean } = {},
): IrInstruction {
  const def = resolveOpcode(opcode);
  if (def.variadic ? operands.length < def.numParams : operands.length !== def.numParams) {
    throw new IrError(
      `${describeOpcode(def)} takes ${def.variadic ? 'at least ' : ''}${def.numParams} operand(s), got ${operands.length}`,
    );
  }
  if (options.negated === true && !def.condition) {
    throw new IrError(`${describeOpcode(def)} is not a condition — it cannot be negated`);
  }

  return {
    labels: options.labels ?? [],
    negated: options.negated ?? false,
    opcode: def.id,
    operands,
  };
}

export function int(value: number): Operand {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new IrError(`int operand value ${value} is not a 32-bit integer`);
  }
  const type =
    value >= -0x80 && value <= 0x7f ? TYPE_INT8 : value >= -0x8000 && value <= 0x7fff ? TYPE_INT16 : TYPE_INT32;

  return { kind: 'int', type, value };
}

/** The decoded → IR bridge: verbatim operands, no labels — re-assembling reproduces the bytes. */
export function irFromDecoded(
  instructions: readonly { negated: boolean; opcode: number; operands: readonly Operand[] }[],
): IrInstruction[] {
  return instructions.map((decoded) => ({
    labels: [],
    negated: decoded.negated,
    opcode: decoded.opcode,
    operands: decoded.operands,
  }));
}

export function labelRef(name: string): LabelRef {
  return { kind: 'label', name };
}

/** A local numeric variable by its slot (allocation: `assemble/lvars.ts`). */
export function lvar(index: number): Operand {
  return { index, kind: 'var', scope: 'local', type: TYPE_LOCAL_VAR };
}

/** A local short-string (8-byte) variable by its FIRST slot — CLEO's `0@s`, two slots wide. */
export function lvarStr8(index: number): Operand {
  return { index, kind: 'var', scope: 'local', type: TYPE_LOCAL_VAR_STRING8 };
}

/** A variable-length string literal (the Sanny default for CLEO string operands). */
export function str(value: string): Operand {
  return { kind: 'string', type: TYPE_STRING_VARLEN, value };
}

/** A fixed 8-byte string literal (short-string opcodes like `03A4 SCRIPT_NAME`). */
export function str8(value: string): Operand {
  return { kind: 'string', type: TYPE_STRING8, value };
}

/** A fixed 16-byte string literal. */
export function str16(value: string): Operand {
  return { kind: 'string', type: TYPE_STRING16, value };
}

// --- Name resolution ---

let nameIndex: Map<string, number> | null = null;

function buildNameIndex(): Map<string, number> {
  const index = new Map<string, number>();
  for (const def of opcodeTable().values()) {
    // A duplicated name is poisoned rather than silently picking an id.
    index.set(def.name, index.has(def.name) ? -1 : def.id);
  }

  return index;
}

function describeOpcode(def: OpcodeDef): string {
  return `${def.id.toString(16).toUpperCase().padStart(4, '0')} ${def.name}`;
}

function resolveOpcode(opcode: number | string): OpcodeDef {
  if (typeof opcode === 'number') {
    const def = opcodeDef(opcode);
    if (!def) {
      throw new IrError(`opcode ${opcode.toString(16).toUpperCase().padStart(4, '0')} not in the library DB`);
    }

    return def;
  }
  nameIndex ??= buildNameIndex();
  const id = nameIndex.get(opcode);
  if (id === undefined) {
    throw new IrError(`opcode name "${opcode}" not in the library DB`);
  }
  if (id === -1) {
    throw new IrError(`opcode name "${opcode}" is ambiguous in the library DB — use the numeric id`);
  }

  return opcodeDef(id) as OpcodeDef;
}
