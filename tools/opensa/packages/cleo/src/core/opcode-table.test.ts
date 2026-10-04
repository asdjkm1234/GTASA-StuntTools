import { describe, expect, it } from 'vitest';

import { opcodeDef, opcodeTable } from './opcode-table';

describe('opcodeTable', () => {
  describe('negative cases', () => {
    it('returns undefined for an id the library does not know', () => {
      expect(opcodeDef(0x7fff)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('resolves 0001 WAIT with one declared param from the default extension', () => {
      expect(opcodeDef(0x0001)).toMatchObject({ extension: 'default', name: 'WAIT', numParams: 1, variadic: false });
    });

    it('resolves 00D6 IF and 0453 SET_OBJECT_ROTATION with their declared arity', () => {
      expect(opcodeDef(0x00d6)).toMatchObject({ name: 'IF', numParams: 1 });
      expect(opcodeDef(0x0453)).toMatchObject({ name: 'SET_OBJECT_ROTATION', numParams: 4 });
    });

    it('marks 0AB1 CLEO_CALL variadic with two declared reads before the tail', () => {
      expect(opcodeDef(0x0ab1)).toMatchObject({ extension: 'CLEO', name: 'CLEO_CALL', numParams: 2, variadic: true });
    });

    it('marks the native calls variadic with the head-only declared arity (0AA7: addr, numParams, pop)', () => {
      expect(opcodeDef(0x0aa7)).toMatchObject({ name: 'CALL_FUNCTION_RETURN', numParams: 3, variadic: true });
      expect(opcodeDef(0x0aa6)).toMatchObject({ name: 'CALL_METHOD', numParams: 4, variadic: true });
    });

    it('resolves 0E01 CREATE_OBJECT_NO_SAVE from the CLEO+ extension', () => {
      expect(opcodeDef(0x0e01)).toMatchObject({ extension: 'CLEO+', name: 'CREATE_OBJECT_NO_SAVE', numParams: 7 });
    });

    it('carries the whole library (about 3 700 ids) with branch flags on the jumps', () => {
      expect(opcodeTable().size).toBeGreaterThan(3000);
      expect(opcodeDef(0x0002)).toMatchObject({ branch: true, name: 'GOTO' });
    });
  });
});
