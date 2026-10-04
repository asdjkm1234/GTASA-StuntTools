import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CleoDecodeError, decodeScript } from './decode';
import { opcodeDef } from './opcode-table';

/** Real Sanny-compiled corpus scripts, copied by `npm run test:fixtures` (097/01 decision 6). */
const CORPUS = 'fixtures/original/cleo';
/** name → recon census instruction count — decode counts are a REGRESSION, not an aspiration. */
const CENSUS: readonly (readonly [string, number])[] = [
  ['ferris', 91],
  ['windfarm', 239],
  ['firela', 44],
  ['vandoor', 102],
  ['rhino', 2085],
  ['cardoor-coach', 64],
  ['cardoor-bus', 64],
];

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
/** `[u32 codeEnd]["__SBFTR\0"]` appended to a code buffer. */
const withTrailer = (code: readonly number[], codeEnd: number, ...footer: number[]): Uint8Array =>
  bytes(...code, ...footer, codeEnd & 0xff, (codeEnd >> 8) & 0xff, 0, 0, 0x5f, 0x5f, 0x53, 0x42, 0x46, 0x54, 0x52, 0);

describe('decodeScript', () => {
  describe('negative cases', () => {
    it('throws a located error on an opcode the DB does not know', () => {
      expect(() => decodeScript(bytes(0xff, 0x7f))).toThrow(CleoDecodeError);
      expect(() => decodeScript(bytes(0xff, 0x7f))).toThrow(/opcode 7FFF/);
    });

    it('throws when a declared operand is the 0x00 terminator', () => {
      // 0001 WAIT declares one operand; the stream ends it immediately.
      expect(() => decodeScript(bytes(0x01, 0x00, 0x00))).toThrow(/terminator/);
    });

    it('throws on a truncated opcode at the code boundary', () => {
      expect(() => decodeScript(bytes(0x01, 0x00, 0x04, 0x00, 0x01))).toThrow(/truncated opcode/);
    });

    it('throws when the __SBFTR trailer points past its own footer', () => {
      expect(() => decodeScript(withTrailer([], 99))).toThrow(/points past/);
    });

    it('throws when an operand payload is cut by the footer boundary', () => {
      // WAIT's int32 operand declares 4 bytes but the trailer ends the code after 2.
      expect(() => decodeScript(withTrailer([0x01, 0x00, 0x01, 0x22, 0x22], 5))).toThrow(CleoDecodeError);
    });
  });

  describe('positive cases', () => {
    it('decodes an instruction with the negated bit split from the opcode id', () => {
      // 8485 = NOT IS_PC_VERSION (0485, zero params).
      const script = decodeScript(bytes(0x85, 0x84));
      expect(script.instructions).toEqual([{ negated: true, offset: 0, opcode: 0x0485, operands: [] }]);
    });

    it('reads a variadic tail until the terminator (0AB1 CLEO_CALL)', () => {
      // CLEO_CALL label=-10 numArgs=1 tail=[int8 7] terminator.
      const script = decodeScript(bytes(0xb1, 0x0a, 0x01, 0xf6, 0xff, 0xff, 0xff, 0x04, 0x01, 0x04, 0x07, 0x00));
      expect(script.instructions[0].operands).toHaveLength(3);
      expect(script.instructions[0].operands[2]).toEqual({ kind: 'int', type: 0x04, value: 7 });
    });

    it('reads a native call as head + args + output vars to the terminator (0AA7)', () => {
      // CALL_FUNCTION_RETURN addr numParams=1 pop=1, one int8 arg, one local out var, terminator.
      const script = decodeScript(
        bytes(
          0xa7,
          0x0a,
          0x01,
          0x00,
          0x54,
          0x4c,
          0x00, // addr 0x4C5400
          0x04,
          0x01, // numParams 1
          0x04,
          0x01, // pop 1
          0x04,
          0x2a, // arg 42
          0x03,
          0x05,
          0x00, // out 5@
          0x00,
        ),
      );
      expect(script.instructions[0].operands).toHaveLength(5);
      expect(script.instructions[0].operands[4]).toEqual({ index: 5, kind: 'var', scope: 'local', type: 0x03 });
    });

    it('stops at the __SBFTR boundary and preserves the footer opaquely', () => {
      const script = decodeScript(withTrailer([0x93, 0x0a], 2, 0x56, 0x41, 0x52, 0x00));
      expect(script.codeEnd).toBe(2);
      expect(script.instructions).toHaveLength(1);
      expect([...script.footer.subarray(0, 4)]).toEqual([0x56, 0x41, 0x52, 0x00]);
    });

    it('maps every instruction offset to its index', () => {
      const script = decodeScript(bytes(0x85, 0x04, 0x93, 0x0a));
      expect(script.offsetIndex.get(0)).toBe(0);
      expect(script.offsetIndex.get(2)).toBe(1);
    });
  });
});

describe.skipIf(!existsSync(CORPUS))('decodeScript on the real corpus', () => {
  describe('positive cases', () => {
    it.each(CENSUS)('decodes %s to the footer boundary with the census instruction count', (name, count) => {
      const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));
      expect(script.instructions).toHaveLength(count);
    });

    it('resolves every script-local jump/gosub/CLEO_CALL target through the offset map', () => {
      let checked = 0;
      for (const [name] of CENSUS) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));
        for (const instruction of script.instructions) {
          const def = opcodeDef(instruction.opcode);
          const isCall = instruction.opcode === 0x0ab1 || instruction.opcode === 0x0050;
          if (!def?.branch && !isCall) {
            continue;
          }
          for (const operand of instruction.operands) {
            // Negative int = a custom-script-local byte offset; positives point into main.scm space.
            if (operand.kind === 'int' && operand.value < 0) {
              expect(script.offsetIndex.has(-operand.value), `${name}: target ${operand.value}`).toBe(true);
              checked += 1;
            }
          }
        }
      }
      // A count of zero would mean the guard never had a chance to fail.
      expect(checked).toBeGreaterThan(100);
    });

    it('keeps the whole corpus inside the recon data-type byte set (decode is total)', () => {
      const seen = new Set<number>();
      for (const [name] of CENSUS) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));
        for (const instruction of script.instructions) {
          for (const operand of instruction.operands) {
            seen.add(operand.type);
          }
        }
      }
      for (const type of seen) {
        expect(type).toBeLessThanOrEqual(0x13);
      }
      expect(seen.size).toBeGreaterThan(3);
    });
  });
});
