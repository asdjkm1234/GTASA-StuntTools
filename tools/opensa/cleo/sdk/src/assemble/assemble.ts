/**
 * IR → standard CLEO 4 bytes (plan cleo-sdk/002): two-pass assembly — lay out offsets, then emit
 * with labels resolved to the corpus's negative-offset convention. `assembleScript` appends the
 * `__SBFTR` trailer so decode-to-EOF tooling sees an explicit code boundary. Deterministic:
 * identical IR yields identical bytes.
 */
import { NEGATED_BIT, opcodeDef, type OpcodeDef } from '@opensa/cleo';
import { TRAILER_MAGIC } from '@opensa/cleo/core/decode';
import { TYPE_END, TYPE_INT8, TYPE_INT16, TYPE_INT32, TYPE_STRING8, TYPE_STRING16 } from '@opensa/cleo/core/operands';

import type { IrInstruction, IrOperand } from '../ir';

import { writeOperand } from './operands';
import { Writer } from './writer';

/** A jump-target operand is always emitted as int32: type byte + 4 payload bytes. */
const LABEL_OPERAND_SIZE = 5;

export class AssembleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssembleError';
  }
}

/** The code region only — what the referee (decode → re-assemble) compares byte-for-byte. */
export function assembleCode(instructions: readonly IrInstruction[]): Uint8Array {
  const labels = layout(instructions);
  const writer = new Writer();
  for (const ins of instructions) {
    const def = defOf(ins);
    writer.u16(ins.negated ? ins.opcode | NEGATED_BIT : ins.opcode);
    for (const operand of ins.operands) {
      if (operand.kind === 'label') {
        writer.u8(TYPE_INT32);
        writer.i32(-resolve(labels, operand.name));
      } else {
        writeOperand(writer, operand);
      }
    }
    if (def.variadic) {
      writer.u8(TYPE_END);
    }
  }

  return writer.bytes();
}

/** A complete `.cs`: the code region plus the `[u32 codeEnd]["__SBFTR\0"]` trailer. */
export function assembleScript(instructions: readonly IrInstruction[]): Uint8Array {
  const code = assembleCode(instructions);
  const writer = new Writer();
  writer.raw(code);
  writer.u32(code.length);
  for (let index = 0; index < TRAILER_MAGIC.length; index += 1) {
    writer.u8(TRAILER_MAGIC.charCodeAt(index));
  }

  return writer.bytes();
}

function defOf(ins: IrInstruction): OpcodeDef {
  const def = opcodeDef(ins.opcode);
  if (!def) {
    throw new AssembleError(`opcode ${ins.opcode.toString(16)} not in the library DB`);
  }

  return def;
}

/** Pass 1: instruction offsets and label definitions (sizes are exact — label operands are int32). */
function layout(instructions: readonly IrInstruction[]): Map<string, number> {
  const labels = new Map<string, number>();
  let offset = 0;
  for (const ins of instructions) {
    for (const label of ins.labels) {
      if (labels.has(label)) {
        throw new AssembleError(`label "${label}" defined twice`);
      }
      labels.set(label, offset);
    }
    offset += sizeOf(ins);
  }

  return labels;
}

function resolve(labels: ReadonlyMap<string, number>, name: string): number {
  const offset = labels.get(name);
  if (offset === undefined) {
    throw new AssembleError(`label "${name}" is not defined`);
  }
  if (offset === 0) {
    // -0 encodes as 0, which a runtime reads as a MAIN-script offset, not a local one.
    throw new AssembleError(`label "${name}" sits at offset 0 — a local jump cannot encode it`);
  }

  return offset;
}

function sizeOf(ins: IrInstruction): number {
  const def = defOf(ins);
  let size = 2;
  for (const operand of ins.operands) {
    size += sizeOfOperand(operand);
  }

  return def.variadic ? size + 1 : size;
}

/** The emitted byte count of one operand: the type byte plus its payload. */
function sizeOfOperand(operand: IrOperand): number {
  if (operand.kind === 'label') {
    return LABEL_OPERAND_SIZE;
  }
  switch (operand.kind) {
    case 'array':
      return 1 + 6;
    case 'float':
      return 1 + 4;
    case 'int':
      return 1 + (operand.type === TYPE_INT8 ? 1 : operand.type === TYPE_INT16 ? 2 : 4);
    case 'string':
      switch (operand.type) {
        case TYPE_STRING8:
          return 1 + 8;
        case TYPE_STRING16:
          return 1 + 16;
        default:
          return 1 + 1 + operand.value.length + (operand.padding?.length ?? 0);
      }
    case 'var':
      return 1 + 2;
  }
}
