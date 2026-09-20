import { TYPE_INT8, TYPE_INT16, TYPE_INT32 } from '@opensa/cleo/core/operands';
import { describe, expect, it } from 'vitest';

import { instruction, int, IrError, irFromDecoded, labelRef, str8 } from './ir';

describe('instruction', () => {
  describe('negative cases', () => {
    it('throws on an opcode id the library DB does not know', () => {
      expect(() => instruction(0x7999)).toThrow(IrError);
    });

    it('throws on an unknown opcode name', () => {
      expect(() => instruction('NO_SUCH_OPCODE')).toThrow('not in the library DB');
    });

    it('throws on an arity mismatch', () => {
      expect(() => instruction('WAIT', [])).toThrow('takes 1 operand(s), got 0');
      expect(() => instruction('WAIT', [int(0), int(1)])).toThrow('takes 1 operand(s), got 2');
    });

    it('throws when a variadic opcode gets fewer than its declared operands', () => {
      expect(() => instruction('CALL_FUNCTION', [int(0), int(0)])).toThrow('at least 3');
    });

    it('throws when a non-condition opcode is negated', () => {
      expect(() => instruction('WAIT', [int(0)], { negated: true })).toThrow('cannot be negated');
    });
  });

  describe('positive cases', () => {
    it('resolves an opcode by Sanny name or by raw id to the same instruction', () => {
      expect(instruction('WAIT', [int(250)])).toEqual(instruction(0x0001, [int(250)]));
    });

    it('accepts a negated condition and a variadic tail', () => {
      expect(instruction('IS_INT_VAR_GREATER_THAN_NUMBER', [int(0), int(5)], { negated: true }).negated).toBe(true);
      expect(instruction('CALL_FUNCTION', [int(0), int(0), int(1), int(42)]).operands).toHaveLength(4);
    });

    it('carries labels and label refs through untouched', () => {
      const ins = instruction('GOTO', [labelRef('loop')], { labels: ['top'] });
      expect(ins.labels).toEqual(['top']);
      expect(ins.operands[0]).toEqual({ kind: 'label', name: 'loop' });
    });
  });
});

describe('operand factories', () => {
  describe('negative cases', () => {
    it('int throws outside the 32-bit range and on fractions', () => {
      expect(() => int(0x80000000)).toThrow(IrError);
      expect(() => int(0.5)).toThrow(IrError);
    });
  });

  describe('positive cases', () => {
    it('int picks the smallest width that holds the value', () => {
      expect(int(127).type).toBe(TYPE_INT8);
      expect(int(128).type).toBe(TYPE_INT16);
      expect(int(-129).type).toBe(TYPE_INT16);
      expect(int(32768).type).toBe(TYPE_INT32);
      expect(int(-40000).type).toBe(TYPE_INT32);
    });

    it('irFromDecoded maps instructions verbatim with no labels', () => {
      const decoded = [{ negated: true, opcode: 0x0018, operands: [int(1), int(2)] }];
      expect(irFromDecoded(decoded)).toEqual([
        { labels: [], negated: true, opcode: 0x0018, operands: [int(1), int(2)] },
      ]);
    });

    it('str8 builds the SCRIPT_NAME-shaped fixed operand', () => {
      expect(instruction('SCRIPT_NAME', [str8('hello')]).operands[0]).toMatchObject({ kind: 'string', value: 'hello' });
    });
  });
});
