import { describe, expect, it } from 'vitest';

import { Cursor } from './cursor';
import { readOperand } from './operands';

const read = (...bytes: number[]): ReturnType<typeof readOperand> => readOperand(new Cursor(new Uint8Array(bytes)));

describe('readOperand', () => {
  describe('negative cases', () => {
    it('throws a located error on an unknown data-type byte', () => {
      expect(() => read(0x42)).toThrow(/unknown operand data-type byte 0x42 at offset 0/);
    });

    it('throws when a fixed string runs past the end of the buffer', () => {
      expect(() => read(0x09, 0x41, 0x42)).toThrow(/read past end/);
    });

    it('throws when a length-prefixed string runs past the end of the buffer', () => {
      expect(() => read(0x0e, 5, 0x41)).toThrow(/read past end/);
    });
  });

  describe('positive cases', () => {
    it('returns null for the 0x00 variadic terminator', () => {
      expect(read(0x00)).toBeNull();
    });

    it('reads the three int widths with their sign', () => {
      expect(read(0x01, 0xff, 0xff, 0xff, 0xff)).toEqual({ kind: 'int', type: 0x01, value: -1 });
      expect(read(0x04, 0x80)).toEqual({ kind: 'int', type: 0x04, value: -128 });
      expect(read(0x05, 0x2e, 0xfb)).toEqual({ kind: 'int', type: 0x05, value: -1234 });
    });

    it('reads a float32', () => {
      expect(read(0x06, 0x00, 0x00, 0xb4, 0x42)).toEqual({ kind: 'float', type: 0x06, value: 90 });
    });

    it('reads global and local numeric vars as u16 indices', () => {
      expect(read(0x02, 0x08, 0x00)).toEqual({ index: 8, kind: 'var', scope: 'global', type: 0x02 });
      expect(read(0x03, 0x1b, 0x00)).toEqual({ index: 27, kind: 'var', scope: 'local', type: 0x03 });
    });

    it('reads the four string-var forms (8/16-char, global/local)', () => {
      expect(read(0x0a, 0x02, 0x00)).toMatchObject({ kind: 'var', scope: 'global', type: 0x0a });
      expect(read(0x0b, 0x02, 0x00)).toMatchObject({ kind: 'var', scope: 'local', type: 0x0b });
      expect(read(0x10, 0x02, 0x00)).toMatchObject({ kind: 'var', scope: 'global', type: 0x10 });
      expect(read(0x11, 0x02, 0x00)).toMatchObject({ kind: 'var', scope: 'local', type: 0x11 });
    });

    it('reads the 6-byte array refs in all six forms', () => {
      for (const [type, scope] of [
        [0x07, 'global'],
        [0x08, 'local'],
        [0x0c, 'global'],
        [0x0d, 'local'],
        [0x12, 'global'],
        [0x13, 'local'],
      ] as const) {
        expect(read(type, 0x10, 0x00, 0x05, 0x00, 0x04, 0x80)).toEqual({
          elemSize: 4,
          flags: 0x80,
          indexVar: 5,
          kind: 'array',
          offset: 16,
          scope,
          type,
        });
      }
    });

    it('reads fixed 8- and 16-char strings, trimming the NUL padding', () => {
      expect(read(0x09, 0x46, 0x45, 0x52, 0x52, 0x49, 0x53, 0x00, 0x00)).toEqual({
        kind: 'string',
        type: 0x09,
        value: 'FERRIS',
      });
      const fixed16 = read(0x0f, ...Array.from('WINDMILL_LONGER!').map((c) => c.charCodeAt(0)));
      expect(fixed16).toEqual({ kind: 'string', type: 0x0f, value: 'WINDMILL_LONGER!' });
    });

    it('reads a length-prefixed string exactly to its length byte', () => {
      expect(read(0x0e, 3, 0x61, 0x62, 0x63, 0x7a)).toEqual({ kind: 'string', type: 0x0e, value: 'abc' });
    });
  });
});
