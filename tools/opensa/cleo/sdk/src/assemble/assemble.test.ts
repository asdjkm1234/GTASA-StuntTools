import { decodeScript } from '@opensa/cleo';
import { TYPE_INT32 } from '@opensa/cleo/core/operands';
import { describe, expect, it } from 'vitest';

import { instruction, int, type IrInstruction, labelRef, str8 } from '../ir';
import { assembleCode, AssembleError, assembleScript } from './assemble';

const script = (): IrInstruction[] => [
  instruction('SCRIPT_NAME', [str8('test')]),
  instruction('WAIT', [int(0)], { labels: ['loop'] }),
  instruction('GOTO', [labelRef('loop')]),
];

describe('assembleCode', () => {
  describe('negative cases', () => {
    it('throws on an undefined label', () => {
      expect(() => assembleCode([instruction('GOTO', [labelRef('nowhere')])])).toThrow('"nowhere" is not defined');
    });

    it('throws on a label defined twice', () => {
      const twice = [
        instruction('WAIT', [int(0)], { labels: ['x'] }),
        instruction('WAIT', [int(0)], { labels: ['x'] }),
      ];
      expect(() => assembleCode(twice)).toThrow('defined twice');
    });

    it('throws on a jump to offset 0 (unencodable under the negative-offset convention)', () => {
      const toStart = [instruction('WAIT', [int(0)], { labels: ['start'] }), instruction('GOTO', [labelRef('start')])];
      expect(() => assembleCode(toStart)).toThrow(AssembleError);
    });
  });

  describe('positive cases', () => {
    it('emits the opcode, the negation bit and the variadic terminator the decoder expects', () => {
      const code = assembleCode([
        instruction('IS_INT_VAR_GREATER_THAN_NUMBER', [int(1), int(2)], { negated: true }),
        instruction('CALL_FUNCTION', [int(0x1000), int(0), int(1), int(7)]),
      ]);
      const decoded = decodeScript(code);
      expect(decoded.instructions).toHaveLength(2);
      expect(decoded.instructions[0]).toMatchObject({ negated: true, opcode: 0x0018 });
      expect(decoded.instructions[1].operands).toHaveLength(4);
    });

    it('resolves a label to the negated byte offset of its instruction, as int32', () => {
      const code = assembleCode(script());
      const decoded = decodeScript(code);
      // SCRIPT_NAME: u16 + type byte + 8 bytes = 11; the loop label sits right after it.
      const goto = decoded.instructions[2];
      expect(goto.operands[0]).toEqual({ kind: 'int', type: TYPE_INT32, value: -11 });
      expect(decoded.offsetIndex.get(11)).toBe(1);
    });

    it('is deterministic — two runs, identical bytes', () => {
      expect(assembleCode(script())).toEqual(assembleCode(script()));
    });
  });
});

describe('assembleScript', () => {
  describe('positive cases', () => {
    it('appends the __SBFTR trailer the decoder reads back as the code boundary', () => {
      const bytes = assembleScript(script());
      const code = assembleCode(script());
      const decoded = decodeScript(bytes);
      expect(decoded.codeEnd).toBe(code.length);
      expect(decoded.instructions).toHaveLength(3);
      expect(decoded.footer).toHaveLength(12);
    });
  });
});
