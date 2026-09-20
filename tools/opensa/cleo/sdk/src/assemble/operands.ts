/**
 * The operand WRITER (plan cleo-sdk/002 decision 2): the byte-exact mirror of `@opensa/cleo`'s
 * `readOperand`, driven by the same exported type-byte constants. Verbatim — an operand carries its
 * raw data-type byte, so a decoded script re-encodes to its original bytes; width POLICY (which
 * type byte an authored value gets) lives in `../ir.ts`, not here.
 */
import type { Operand } from '@opensa/cleo';

import {
  TYPE_FLOAT32,
  TYPE_GLOBAL_ARRAY,
  TYPE_GLOBAL_ARRAY_STRING8,
  TYPE_GLOBAL_ARRAY_STRING16,
  TYPE_GLOBAL_VAR,
  TYPE_GLOBAL_VAR_STRING8,
  TYPE_GLOBAL_VAR_STRING16,
  TYPE_INT8,
  TYPE_INT16,
  TYPE_INT32,
  TYPE_LOCAL_ARRAY,
  TYPE_LOCAL_ARRAY_STRING8,
  TYPE_LOCAL_ARRAY_STRING16,
  TYPE_LOCAL_VAR,
  TYPE_LOCAL_VAR_STRING8,
  TYPE_LOCAL_VAR_STRING16,
  TYPE_STRING8,
  TYPE_STRING16,
  TYPE_STRING_VARLEN,
} from '@opensa/cleo/core/operands';

import type { Writer } from './writer';

const VAR_TYPES = new Set([
  TYPE_GLOBAL_VAR,
  TYPE_GLOBAL_VAR_STRING8,
  TYPE_GLOBAL_VAR_STRING16,
  TYPE_LOCAL_VAR,
  TYPE_LOCAL_VAR_STRING8,
  TYPE_LOCAL_VAR_STRING16,
]);
const ARRAY_TYPES = new Set([
  TYPE_GLOBAL_ARRAY,
  TYPE_GLOBAL_ARRAY_STRING8,
  TYPE_GLOBAL_ARRAY_STRING16,
  TYPE_LOCAL_ARRAY,
  TYPE_LOCAL_ARRAY_STRING8,
  TYPE_LOCAL_ARRAY_STRING16,
]);

/** An operand the writer refuses: a value out of its declared width, or a kind/type mismatch. */
export class OperandWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperandWriteError';
  }
}

/** Emit one operand: the data-type byte, then the payload the reader expects for it. */
export function writeOperand(writer: Writer, operand: Operand): void {
  writer.u8(operand.type);
  switch (operand.kind) {
    case 'array': {
      if (!ARRAY_TYPES.has(operand.type)) {
        throw new OperandWriteError(`array operand with non-array type byte 0x${operand.type.toString(16)}`);
      }
      writer.u16(operand.offset);
      writer.u16(operand.indexVar);
      writer.u8(operand.elemSize);
      writer.u8(operand.flags);

      return;
    }
    case 'float': {
      if (operand.type !== TYPE_FLOAT32) {
        throw new OperandWriteError(`float operand with type byte 0x${operand.type.toString(16)}`);
      }
      writer.f32(operand.value);

      return;
    }
    case 'int':
      writeInt(writer, operand.type, operand.value);

      return;
    case 'string':
      writeString(writer, operand.type, operand.value, operand.padding);

      return;
    case 'var': {
      if (!VAR_TYPES.has(operand.type)) {
        throw new OperandWriteError(`var operand with non-var type byte 0x${operand.type.toString(16)}`);
      }
      writer.u16(operand.index);

      return;
    }
  }
}

function assertRange(value: number, min: number, max: number, width: string): void {
  if (value < min || value > max) {
    throw new OperandWriteError(`value ${value} out of ${width} range`);
  }
}

/** The decoded-padding invariant: it starts at the first NUL, so the reader re-finds `value`. */
function writeChars(writer: Writer, value: string, padding: Uint8Array | undefined): void {
  for (let index = 0; index < value.length; index += 1) {
    writer.u8(value.charCodeAt(index) & 0xff);
  }
  if (padding && padding.length > 0) {
    if (padding[0] !== 0) {
      throw new OperandWriteError(`string padding must begin with the NUL terminator`);
    }
    writer.raw(padding);
  }
}

function writeFixedString(writer: Writer, value: string, padding: Uint8Array | undefined, width: number): void {
  if (value.length + (padding?.length ?? 0) > width) {
    throw new OperandWriteError(`string "${value}" does not fit ${width} bytes`);
  }
  writeChars(writer, value, padding);
  for (let index = value.length + (padding?.length ?? 0); index < width; index += 1) {
    writer.u8(0);
  }
}

function writeInt(writer: Writer, type: number, value: number): void {
  if (!Number.isInteger(value)) {
    throw new OperandWriteError(`int operand with non-integer value ${value}`);
  }
  switch (type) {
    case TYPE_INT8:
      assertRange(value, -0x80, 0x7f, 'int8');
      writer.i8(value);

      return;
    case TYPE_INT16:
      assertRange(value, -0x8000, 0x7fff, 'int16');
      writer.i16(value);

      return;
    case TYPE_INT32:
      assertRange(value, -0x80000000, 0x7fffffff, 'int32');
      writer.i32(value);

      return;
    default:
      throw new OperandWriteError(`int operand with type byte 0x${type.toString(16)}`);
  }
}

function writeString(writer: Writer, type: number, value: string, padding: Uint8Array | undefined): void {
  switch (type) {
    case TYPE_STRING8:
      writeFixedString(writer, value, padding, 8);

      return;
    case TYPE_STRING16:
      writeFixedString(writer, value, padding, 16);

      return;
    case TYPE_STRING_VARLEN: {
      const length = value.length + (padding?.length ?? 0);
      if (length > 0xff) {
        throw new OperandWriteError(`variable-length string of ${length} bytes exceeds 255`);
      }
      writer.u8(length);
      writeChars(writer, value, padding);

      return;
    }
    default:
      throw new OperandWriteError(`string operand with type byte 0x${type.toString(16)}`);
  }
}
