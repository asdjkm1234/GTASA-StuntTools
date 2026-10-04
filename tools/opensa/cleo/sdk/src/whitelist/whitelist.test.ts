import { describe, expect, it } from 'vitest';

import { gvar, instruction, int, type IrInstruction, lvar, str8 } from '../ir';
import { deriveWhitelist } from './derive';
import { artifactName, checkWhitelist, WhitelistError } from './gate';
import { DUAL_TARGET_OPCODES, VM_SERVED_OPCODES } from './whitelist.generated';

const dualScript = (): IrInstruction[] => [
  instruction('SCRIPT_NAME', [str8('test')]),
  instruction('WAIT', [int(0)], { labels: ['loop'] }),
  instruction('TERMINATE_THIS_CUSTOM_SCRIPT'),
];

describe('checkWhitelist', () => {
  describe('negative cases', () => {
    it('rejects an opcode the VM does not serve, under EVERY target', () => {
      const script = [instruction(0x0004, [gvar(2), int(1)])];
      for (const target of ['dual', 'opensa-only'] as const) {
        expect(() => checkWhitelist(script, target)).toThrow('not served by the OpenSA VM');
      }
    });

    it('rejects a VM-only opcode under the dual target, naming real CLEO 4', () => {
      const script = [instruction(0x0e40, [lvar(0)])];
      expect(() => checkWhitelist(script, 'dual')).toThrow('not served by plain real CLEO 4');
      expect(() => checkWhitelist(script, 'dual')).toThrow("declare target: 'opensa-only'");
    });

    it('rejects a VM-only opcode under the sa-only target — real CLEO does not serve it either', () => {
      expect(() => checkWhitelist([instruction(0x0e40, [lvar(0)])], 'sa-only')).toThrow(WhitelistError);
    });

    it('rejects a module opcode outside the claimed CLEO 4.4 surface under sa-only (0B00 file module)', () => {
      expect(() => checkWhitelist([instruction(0x0b00, [str8('x')])], 'sa-only')).toThrow(WhitelistError);
    });

    it('aggregates every violating opcode once, with the Sanny name', () => {
      const script = [
        instruction(0x0e40, [lvar(0)]),
        instruction(0x0e40, [lvar(1)]),
        instruction(0x0004, [gvar(2), int(1)]),
      ];
      let error: unknown;
      try {
        checkWhitelist(script, 'dual');
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(WhitelistError);
      expect((error as WhitelistError).violations).toHaveLength(2);
      expect((error as WhitelistError).message).toContain('0E40 GET_CURRENT_HOUR');
      expect((error as WhitelistError).message).toContain('0004 SET_VAR_INT');
    });
  });

  describe('positive cases', () => {
    it('passes a dual-target script under both targets', () => {
      for (const target of ['dual', 'opensa-only'] as const) {
        expect(() => checkWhitelist(dualScript(), target)).not.toThrow();
      }
    });

    it('passes a VM-served CLEO+ opcode under the opensa-only target', () => {
      expect(() => checkWhitelist([instruction(0x0e40, [lvar(0)])], 'opensa-only')).not.toThrow();
    });

    it('passes the cutscene sequence + an ini read under sa-only — opcodes the VM does not serve', () => {
      const script = [
        instruction('LOAD_CUTSCENE', [str8('PROLOG3')]),
        instruction('HAS_CUTSCENE_LOADED'),
        instruction('START_CUTSCENE'),
        instruction('HAS_CUTSCENE_FINISHED'),
        instruction('CLEAR_CUTSCENE'),
        instruction(0x0af4, [str8('a'), str8('b'), str8('c'), lvar(0)]),
      ];
      expect(() => checkWhitelist(script, 'sa-only')).not.toThrow();
      expect(() => checkWhitelist(script, 'opensa-only')).toThrow('not served by the OpenSA VM');
    });
  });
});

describe('artifactName', () => {
  describe('positive cases', () => {
    it('carries the target in the name — the contract rule', () => {
      expect(artifactName('hello-conformance', 'dual')).toBe('hello-conformance.cs');
      expect(artifactName('city-life', 'opensa-only')).toBe('city-life.opensa-only.cs');
      expect(artifactName('cutscene-override', 'sa-only')).toBe('cutscene-override.sa-only.cs');
    });
  });
});

describe('whitelist.generated', () => {
  describe('positive cases', () => {
    it('matches what regeneration would produce (drift gate — run npm run cleo:whitelist)', () => {
      const derived = deriveWhitelist();
      expect(new Set(derived.dual)).toEqual(DUAL_TARGET_OPCODES);
      expect(new Set(derived.vmServed)).toEqual(VM_SERVED_OPCODES);
    });

    it('dual is a subset of VM-served, and every dual opcode is in the library DB', () => {
      for (const id of DUAL_TARGET_OPCODES) {
        expect(VM_SERVED_OPCODES.has(id)).toBe(true);
      }
    });
  });
});
