/**
 * Layer A (plan 097/01 decision 1): the type-byte operand reader. Every operand in an SA `.cs` stream
 * is one data-type byte followed by a correctly sized payload; this file turns that byte into a typed
 * value on a plain little-endian cursor. Pure — no opcode knowledge, no DB.
 *
 * The union is LOSSLESS: `type` keeps the raw data-type byte, so width (int8/16/32), string form
 * (fixed 8/16, length-prefixed) and string-variable kinds all survive into disassembly/re-encode.
 * String payload bytes past the first NUL are kept too (`padding`, only when non-zero — Sanny
 * leaves leftover garbage there; the 097 corpus has exactly one such byte, in rhino) so a decoded
 * script re-encodes byte-identically.
 */
import type { Cursor } from './cursor';

export type Operand =
  /** Array element ref: `offset` (var-space base), the index variable, element size, packed flags. */
  | {
      readonly elemSize: number;
      readonly flags: number;
      readonly indexVar: number;
      readonly kind: 'array';
      readonly offset: number;
      readonly scope: VarScope;
      readonly type: number;
    }
  | { readonly index: number; readonly kind: 'var'; readonly scope: VarScope; readonly type: number }
  | { readonly kind: 'float'; readonly type: number; readonly value: number }
  | { readonly kind: 'int'; readonly type: number; readonly value: number }
  /** `padding`: payload bytes from the first NUL to the declared width, present only when not all zero. */
  | { readonly kind: 'string'; readonly padding?: Uint8Array; readonly type: number; readonly value: string };

export type VarScope = 'global' | 'local';

/** Data-type bytes (the full set the corpus contains — plan 097/01 decision 1). Exported: the
 *  authoring SDK's operand WRITER mirrors this reader byte-for-byte off the same constants. */
export const TYPE_END = 0x00;
export const TYPE_INT32 = 0x01;
export const TYPE_GLOBAL_VAR = 0x02;
export const TYPE_LOCAL_VAR = 0x03;
export const TYPE_INT8 = 0x04;
export const TYPE_INT16 = 0x05;
export const TYPE_FLOAT32 = 0x06;
export const TYPE_GLOBAL_ARRAY = 0x07;
export const TYPE_LOCAL_ARRAY = 0x08;
export const TYPE_STRING8 = 0x09;
export const TYPE_GLOBAL_VAR_STRING8 = 0x0a;
export const TYPE_LOCAL_VAR_STRING8 = 0x0b;
export const TYPE_GLOBAL_ARRAY_STRING8 = 0x0c;
export const TYPE_LOCAL_ARRAY_STRING8 = 0x0d;
export const TYPE_STRING_VARLEN = 0x0e;
export const TYPE_STRING16 = 0x0f;
export const TYPE_GLOBAL_VAR_STRING16 = 0x10;
export const TYPE_LOCAL_VAR_STRING16 = 0x11;
export const TYPE_GLOBAL_ARRAY_STRING16 = 0x12;
export const TYPE_LOCAL_ARRAY_STRING16 = 0x13;

const GLOBAL_VARS = new Set([TYPE_GLOBAL_VAR, TYPE_GLOBAL_VAR_STRING8, TYPE_GLOBAL_VAR_STRING16]);
const LOCAL_VARS = new Set([TYPE_LOCAL_VAR, TYPE_LOCAL_VAR_STRING8, TYPE_LOCAL_VAR_STRING16]);
const GLOBAL_ARRAYS = new Set([TYPE_GLOBAL_ARRAY, TYPE_GLOBAL_ARRAY_STRING8, TYPE_GLOBAL_ARRAY_STRING16]);
const LOCAL_ARRAYS = new Set([TYPE_LOCAL_ARRAY, TYPE_LOCAL_ARRAY_STRING8, TYPE_LOCAL_ARRAY_STRING16]);

/**
 * One operand at the cursor, or null when the byte is the 0x00 variadic terminator (consumed).
 * An unknown data-type byte is a hard located error — decode is total, never lossy.
 */
export function readOperand(cursor: Cursor): null | Operand {
  const at = cursor.offset;
  const type = cursor.u8();
  switch (type) {
    case TYPE_END:
      return null;
    case TYPE_FLOAT32:
      return { kind: 'float', type, value: cursor.f32() };
    case TYPE_INT8:
      return { kind: 'int', type, value: cursor.i8() };
    case TYPE_INT16:
      return { kind: 'int', type, value: cursor.i16() };
    case TYPE_INT32:
      return { kind: 'int', type, value: cursor.i32() };
    case TYPE_STRING8:
      return stringOperand(type, cursor.take(8));
    case TYPE_STRING16:
      return stringOperand(type, cursor.take(16));
    case TYPE_STRING_VARLEN:
      return stringOperand(type, cursor.take(cursor.u8()));
    default: {
      if (GLOBAL_VARS.has(type)) {
        return { index: cursor.u16(), kind: 'var', scope: 'global', type };
      }
      if (LOCAL_VARS.has(type)) {
        return { index: cursor.u16(), kind: 'var', scope: 'local', type };
      }
      if (GLOBAL_ARRAYS.has(type)) {
        return arrayRef(cursor, type, 'global');
      }
      if (LOCAL_ARRAYS.has(type)) {
        return arrayRef(cursor, type, 'local');
      }
      throw new RangeError(`unknown operand data-type byte 0x${type.toString(16)} at offset ${at}`);
    }
  }
}

function arrayRef(cursor: Cursor, type: number, scope: VarScope): Operand {
  const offset = cursor.u16();
  const indexVar = cursor.u16();
  const elemSize = cursor.u8();
  const flags = cursor.u8();

  return { elemSize, flags, indexVar, kind: 'array', offset, scope, type };
}

/** Script text is byte-per-char (cp1252-ish identifiers in practice); NULs pad fixed forms, and a
 *  non-zero tail past the first NUL is preserved as `padding` so re-encoding is byte-exact. */
function stringOperand(type: number, bytes: Uint8Array): Operand {
  let end = bytes.indexOf(0);
  if (end < 0) {
    end = bytes.length;
  }
  let value = '';
  for (let index = 0; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  const tail = bytes.subarray(end);

  return tail.some((byte) => byte !== 0)
    ? { kind: 'string', padding: tail.slice(), type, value }
    : { kind: 'string', type, value };
}
