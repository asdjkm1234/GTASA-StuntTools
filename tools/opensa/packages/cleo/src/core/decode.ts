/**
 * Layer B (plan 097/01 decision 2): the DB-driven instruction reader. u16 opcode (top bit 0x8000 =
 * negated conditional) + operands to the declared arity; a variadic opcode then reads its tail until
 * the 0x00 terminator (native calls 0AA5–0AA8 fall out of the same rule — their `numParams` head
 * operands are declared, the args + output vars are the tail).
 *
 * The Sanny footer is NOT detected heuristically: a Sanny-compiled `.cs` ends with the trailer
 * `[u32 codeEnd]["__SBFTR\0"]`, and `codeEnd` is where the VAR/FLAG/SRC metadata begins (measured on
 * the 097 corpus — van door: 24 597 B file, code ends at 1 010). Files without the trailer decode to
 * EOF. The footer is preserved as an opaque tail, never "failed on".
 */
import type { Operand } from './operands';

import { Cursor } from './cursor';
import { type OpcodeDef, opcodeDef } from './opcode-table';
import { readOperand } from './operands';

export const NEGATED_BIT = 0x8000;

/** Exported: the authoring SDK emits the same trailer this decoder detects. */
export const TRAILER_MAGIC = '__SBFTR\0';
const TRAILER_LENGTH = TRAILER_MAGIC.length + 4;

export interface DecodedScript {
  /** Where instructions stop: the footer boundary, or the buffer end without a trailer. */
  readonly codeEnd: number;
  /** The opaque Sanny footer (VAR/FLAG/SRC + trailer), empty when the file has none. */
  readonly footer: Uint8Array;
  readonly instructions: readonly Instruction[];
  /** Instruction byte offset → index into `instructions` — jump targets resolve through this. */
  readonly offsetIndex: ReadonlyMap<number, number>;
}

export interface Instruction {
  /** The 0x8000 bit: the conditional's result is inverted. */
  readonly negated: boolean;
  /** Byte offset of the u16 opcode — jump targets land on these. */
  readonly offset: number;
  /** Opcode id without the negation bit. */
  readonly opcode: number;
  readonly operands: readonly Operand[];
}

/** A decode failure, located: the byte offset and (when known) the opcode being read. */
export class CleoDecodeError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly opcode: null | number = null,
  ) {
    super(`${message} (offset ${offset}${opcode === null ? '' : `, opcode ${hex(opcode)}`})`);
    this.name = 'CleoDecodeError';
  }
}

/** Decode a whole `.cs` buffer — total and lossless, or a located {@link CleoDecodeError}. */
export function decodeScript(bytes: Uint8Array): DecodedScript {
  const codeEnd = codeEndOf(bytes);
  const cursor = new Cursor(bytes.subarray(0, codeEnd));
  const instructions: Instruction[] = [];
  const offsetIndex = new Map<number, number>();

  while (cursor.offset < codeEnd) {
    const offset = cursor.offset;
    if (codeEnd - offset < 2) {
      throw new CleoDecodeError('truncated opcode at the code boundary', offset);
    }
    const raw = cursor.u16();
    const opcode = raw & ~NEGATED_BIT;
    const def = opcodeDef(opcode);
    if (!def) {
      throw new CleoDecodeError('opcode not in the library DB', offset, opcode);
    }
    const operands = readOperands(cursor, def, offset, opcode);
    offsetIndex.set(offset, instructions.length);
    instructions.push({ negated: (raw & NEGATED_BIT) !== 0, offset, opcode, operands });
  }

  return { codeEnd, footer: bytes.subarray(codeEnd), instructions, offsetIndex };
}

/** The code/footer boundary: the `__SBFTR` trailer's u32 when present, else the whole buffer. */
function codeEndOf(bytes: Uint8Array): number {
  if (bytes.length < TRAILER_LENGTH) {
    return bytes.length;
  }
  for (let index = 0; index < TRAILER_MAGIC.length; index += 1) {
    if (bytes[bytes.length - TRAILER_MAGIC.length + index] !== TRAILER_MAGIC.charCodeAt(index)) {
      return bytes.length;
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = view.getUint32(bytes.length - TRAILER_LENGTH, true);
  if (end > bytes.length - TRAILER_LENGTH) {
    throw new CleoDecodeError(`__SBFTR trailer points past its own footer (codeEnd ${end})`, bytes.length - 4);
  }

  return end;
}

function hex(opcode: number): string {
  return opcode.toString(16).toUpperCase().padStart(4, '0');
}

/** Declared reads to the DB arity, then (variadic only) the tail to the 0x00 terminator. */
function readOperands(cursor: Cursor, def: OpcodeDef, offset: number, opcode: number): Operand[] {
  const operands: Operand[] = [];
  try {
    for (let index = 0; index < def.numParams; index += 1) {
      const operand = readOperand(cursor);
      if (operand === null) {
        throw new RangeError(`declared operand ${index + 1}/${def.numParams} is the 0x00 terminator`);
      }
      operands.push(operand);
    }
    if (def.variadic) {
      for (let operand = readOperand(cursor); operand !== null; operand = readOperand(cursor)) {
        operands.push(operand);
      }
    }
  } catch (error) {
    if (error instanceof CleoDecodeError) {
      throw error;
    }
    throw new CleoDecodeError(error instanceof Error ? error.message : String(error), offset, opcode);
  }

  return operands;
}
