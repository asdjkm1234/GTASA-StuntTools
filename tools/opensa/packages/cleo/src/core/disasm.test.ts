import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from './decode';
import { disassemble, formatInstruction } from './disasm';

const CORPUS = 'fixtures/original/cleo';
const LISTINGS = 'fixtures/custom/cleo-listings';
const NAMES = ['ferris', 'windfarm', 'firela', 'vandoor', 'rhino', 'cardoor-coach', 'cardoor-bus', 'nolights'];

describe('formatInstruction', () => {
  describe('negative cases', () => {
    it('renders an opcode outside the DB as ??? instead of throwing', () => {
      expect(formatInstruction({ negated: false, offset: 0, opcode: 0x7fff, operands: [] })).toBe('000000: 7FFF ???');
    });
  });

  describe('positive cases', () => {
    it('renders negation, vars, floats and strings in the contract format', () => {
      const line = formatInstruction({
        negated: true,
        offset: 9,
        opcode: 0x0e9c,
        operands: [
          { kind: 'string', type: 0x0e, value: 'windturb_base' },
          { index: 12, kind: 'var', scope: 'local', type: 0x03 },
        ],
      });
      expect(line).toBe("000009: 0E9C NOT GET_MODEL_BY_NAME 'windturb_base' 12@");
    });

    it('renders integral floats with a trailing .0 so they never read as ints', () => {
      const line = formatInstruction({
        negated: false,
        offset: 0,
        opcode: 0x0001,
        operands: [{ kind: 'float', type: 0x06, value: 90 }],
      });
      expect(line).toBe('000000: 0001 WAIT 90.0');
    });
  });
});

describe.skipIf(!existsSync(CORPUS) || !existsSync(LISTINGS))('disassemble on the real corpus', () => {
  describe('positive cases', () => {
    it.each(NAMES)('reproduces the committed %s listing byte for byte', (name) => {
      const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));
      expect(disassemble(script)).toBe(readFileSync(`${LISTINGS}/${name}.txt`, 'utf8'));
    });
  });
});
