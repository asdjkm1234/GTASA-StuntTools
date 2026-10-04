/**
 * The opcode DB (plan 097/01 decision 3): the vendored Sanny Builder library, generated into
 * `opcodes.generated.ts` and expanded here into a lookup the decoder drives on. A missing id is a
 * LOCATED decode error at the call site, never a silent skip.
 */
import { OPCODE_EXTENSIONS, OPCODE_ROWS } from './opcodes.generated';

export interface OpcodeDef {
  /** Jump/branch instruction (`is_branch` in the library). */
  readonly branch: boolean;
  /** Usable after `if` (`is_condition`); the 0x8000 stream bit negates it. */
  readonly condition: boolean;
  /** Which library extension defined it (`default`, `CLEO`, `CLEO+`, …). */
  readonly extension: string;
  readonly id: number;
  readonly name: string;
  /** Declared operand reads. For a variadic opcode this counts only the operands BEFORE the
   *  terminator-driven tail (the stream is inputs-then-outputs, tail last). */
  readonly numParams: number;
  /** Ends with a tail of operands read until the 0x00 terminator. */
  readonly variadic: boolean;
}

const FLAG_VARIADIC = 1;
const FLAG_CONDITION = 2;
const FLAG_BRANCH = 4;

let table: Map<number, OpcodeDef> | null = null;

/** One opcode's definition, or undefined when the library does not know the id. */
export function opcodeDef(id: number): OpcodeDef | undefined {
  return opcodeTable().get(id);
}

/** The full id → def table (built once, ~3 700 entries). */
export function opcodeTable(): ReadonlyMap<number, OpcodeDef> {
  table ??= build();

  return table;
}

function build(): Map<number, OpcodeDef> {
  const map = new Map<number, OpcodeDef>();
  for (const [id, name, numParams, flags, extension] of OPCODE_ROWS) {
    map.set(id, {
      branch: (flags & FLAG_BRANCH) !== 0,
      condition: (flags & FLAG_CONDITION) !== 0,
      extension: OPCODE_EXTENSIONS[extension],
      id,
      name,
      numParams,
      variadic: (flags & FLAG_VARIADIC) !== 0,
    });
  }

  return map;
}
