import type { Operand } from '@opensa/cleo';

import { Cursor, readOperand } from '@opensa/cleo';
import {
  TYPE_FLOAT32,
  TYPE_GLOBAL_ARRAY,
  TYPE_GLOBAL_VAR,
  TYPE_INT8,
  TYPE_INT16,
  TYPE_INT32,
  TYPE_LOCAL_ARRAY_STRING16,
  TYPE_LOCAL_VAR,
  TYPE_STRING8,
  TYPE_STRING16,
  TYPE_STRING_VARLEN,
} from '@opensa/cleo/core/operands';
import { describe, expect, it } from 'vitest';

import { OperandWriteError, writeOperand } from './operands';
import { Writer } from './writer';

function emit(operand: Operand): Uint8Array {
  const writer = new Writer();
  writeOperand(writer, operand);

  return writer.bytes();
}

/** Emit one operand, read it back with the package's own reader — the oracle for the mirror. */
function roundTrip(operand: Operand): null | Operand {
  const writer = new Writer();
  writeOperand(writer, operand);

  return readOperand(new Cursor(writer.bytes()));
}

describe('writeOperand', () => {
  describe('negative cases', () => {
    it('throws on a value out of its declared int width', () => {
      expect(() => emit({ kind: 'int', type: TYPE_INT8, value: 128 })).toThrow(OperandWriteError);
      expect(() => emit({ kind: 'int', type: TYPE_INT16, value: -0x8001 })).toThrow('out of int16 range');
      expect(() => emit({ kind: 'int', type: TYPE_INT32, value: 0x80000000 })).toThrow('out of int32 range');
    });

    it('throws on a non-integer int value', () => {
      expect(() => emit({ kind: 'int', type: TYPE_INT32, value: 1.5 })).toThrow('non-integer');
    });

    it('throws on a kind/type mismatch', () => {
      expect(() => emit({ kind: 'int', type: TYPE_FLOAT32, value: 1 })).toThrow(OperandWriteError);
      expect(() => emit({ kind: 'float', type: TYPE_INT32, value: 1 })).toThrow(OperandWriteError);
      expect(() => emit({ kind: 'string', type: TYPE_INT32, value: 'x' })).toThrow(OperandWriteError);
      expect(() => emit({ index: 1, kind: 'var', scope: 'global', type: TYPE_INT32 })).toThrow(OperandWriteError);
    });

    it('throws on padding that does not begin with the NUL terminator', () => {
      const operand: Operand = { kind: 'string', padding: new Uint8Array([0x54]), type: TYPE_STRING8, value: 'x' };
      expect(() => emit(operand)).toThrow('must begin with the NUL terminator');
    });

    it('throws on a string that does not fit its fixed width', () => {
      expect(() => emit({ kind: 'string', type: TYPE_STRING8, value: 'nine-char' })).toThrow('does not fit 8 bytes');
      expect(() => emit({ kind: 'string', type: TYPE_STRING16, value: 'seventeen-chars--' })).toThrow(
        'does not fit 16 bytes',
      );
    });
  });

  describe('positive cases', () => {
    it('round-trips every int width through the package reader', () => {
      for (const operand of [
        { kind: 'int', type: TYPE_INT8, value: -128 },
        { kind: 'int', type: TYPE_INT16, value: 32767 },
        { kind: 'int', type: TYPE_INT32, value: -2147483648 },
      ] as const) {
        expect(roundTrip(operand)).toEqual(operand);
      }
    });

    it('round-trips floats bit-exactly', () => {
      const operand: Operand = { kind: 'float', type: TYPE_FLOAT32, value: Math.fround(2085.361) };
      expect(roundTrip(operand)).toEqual(operand);
    });

    it('round-trips every string form', () => {
      for (const operand of [
        { kind: 'string', type: TYPE_STRING8, value: 'ferris' },
        { kind: 'string', type: TYPE_STRING8, value: 'eight-ch' },
        { kind: 'string', type: TYPE_STRING16, value: 'sixteen chars ok' },
        { kind: 'string', type: TYPE_STRING_VARLEN, value: 'any length at all' },
        { kind: 'string', type: TYPE_STRING_VARLEN, value: '' },
      ] as const) {
        expect(roundTrip(operand)).toEqual(operand);
      }
    });

    it('round-trips vars and array refs', () => {
      const gvar: Operand = { index: 9345, kind: 'var', scope: 'global', type: TYPE_GLOBAL_VAR };
      const lvar: Operand = { index: 31, kind: 'var', scope: 'local', type: TYPE_LOCAL_VAR };
      const globalArray: Operand = {
        elemSize: 1,
        flags: 0x80,
        indexVar: 3,
        kind: 'array',
        offset: 512,
        scope: 'global',
        type: TYPE_GLOBAL_ARRAY,
      };
      const localStringArray: Operand = {
        elemSize: 4,
        flags: 0,
        indexVar: 1,
        kind: 'array',
        offset: 8,
        scope: 'local',
        type: TYPE_LOCAL_ARRAY_STRING16,
      };
      for (const operand of [gvar, lvar, globalArray, localStringArray]) {
        expect(roundTrip(operand)).toEqual(operand);
      }
    });

    it('reproduces decoded garbage padding byte-exactly (the rhino BB_05 case)', () => {
      const operand: Operand = {
        kind: 'string',
        padding: new Uint8Array([0, 0x54, 0]),
        type: TYPE_STRING8,
        value: 'BB_05',
      };
      expect([...emit(operand)]).toEqual([TYPE_STRING8, 0x42, 0x42, 0x5f, 0x30, 0x35, 0, 0x54, 0]);
      expect(roundTrip(operand)).toEqual(operand);
    });

    it('pads fixed strings with NULs (the reader stops at the first one)', () => {
      const bytes = emit({ kind: 'string', type: TYPE_STRING8, value: 'abc' });
      expect([...bytes]).toEqual([TYPE_STRING8, 97, 98, 99, 0, 0, 0, 0, 0]);
    });
  });
});
