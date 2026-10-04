import { describe, expect, it } from 'vitest';

import type { ScriptBuilder, ScriptDefinition } from './script';

import { compileScript } from '../build';
import { int, IrError, str } from '../ir';
import { buildScript, defineScript } from './script';

function definition(build: (s: ScriptBuilder) => void, over: Partial<ScriptDefinition> = {}): ScriptDefinition {
  return { budgetPerTick: 100, build, name: 'test-script', ...over };
}

describe('defineScript', () => {
  describe('negative cases', () => {
    it('rejects a non-kebab-case name (it becomes the artifact name)', () => {
      expect(() => defineScript(definition(() => undefined, { name: 'Bad Name' }))).toThrow(IrError);
    });

    it('rejects an scmName over 7 chars', () => {
      expect(() => defineScript(definition(() => undefined, { scmName: 'eight-ch' }))).toThrow('7 chars');
    });

    it('rejects a non-positive budget', () => {
      expect(() => defineScript(definition(() => undefined, { budgetPerTick: 0 }))).toThrow('positive integer');
    });
  });

  describe('positive cases', () => {
    it('defaults scmName to the truncated script name', () => {
      const built = buildScript(definition(() => undefined));
      expect(built.instructions[0].operands[0]).toMatchObject({ kind: 'string', value: 'test-sc' });
    });
  });
});

describe('ScriptBuilder', () => {
  describe('negative cases', () => {
    it('rejects an if() with zero conditions', () => {
      expect(() => buildScript(definition((s) => s.if(() => undefined, { then: () => s.wait(0) })))).toThrow(
        '1-8 conditions',
      );
    });

    it('rejects an if() condition that is not a condition opcode', () => {
      const bad = definition((s) => s.if(() => s.wait(0), { then: () => s.wait(0) }));
      expect(() => buildScript(bad)).toThrow('not a condition opcode');
    });

    it('rejects a label queued after the last instruction', () => {
      expect(() => buildScript(definition((s) => s.label('dangling')))).toThrow('after the last instruction');
    });

    it('rejects the same local name asked for as two different kinds', () => {
      const bad = definition((s) => {
        s.op('SET_LVAR_INT', s.local('x'), int(1));
        s.localString('x');
      });
      expect(() => buildScript(bad)).toThrow('different kind');
    });
  });

  describe('positive cases', () => {
    it('reuses the same slot when a local is named twice', () => {
      const script = definition((s) => {
        s.op('SET_LVAR_INT', s.local('x'), int(1));
        s.op('SET_LVAR_INT', s.local('x'), int(2));
      });
      const built = buildScript(script);
      expect(built.instructions[1].operands[0]).toEqual(built.instructions[2].operands[0]);
    });

    it('allocates a string8 local across two slots (the next int local lands at slot 2)', () => {
      const script = definition((s) => {
        s.localString('scene');
        s.op('SET_LVAR_INT', s.local('tick'), int(0));
      });
      const built = buildScript(script);
      expect(built.instructions[1].operands[0]).toMatchObject({ index: 2, kind: 'var', scope: 'local' });
    });

    it('lowers if/else to the SCM convention (the listing is the semantics)', () => {
      const compiled = compileScript(
        definition((s) => {
          s.if(() => s.op('IS_INT_LVAR_GREATER_THAN_NUMBER', s.local('n'), int(5)), {
            else: () => s.wait(250),
            then: () => s.wait(0),
          });
          s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
        }),
      );
      expect(compiled.listing).toMatchInlineSnapshot(`
        "000000: 03A4 SCRIPT_NAME 'test-sc'
        000011: 00D6 IF 0
        000015: 0019 IS_INT_LVAR_GREATER_THAN_NUMBER 0@ 5
        000022: 004D GOTO_IF_FALSE -40
        000029: 0001 WAIT 0
        000033: 0002 GOTO -45
        000040: 0001 WAIT 250
        000045: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 47
        "
      `);
    });

    it('lowers a multi-condition ANY group to the OR code', () => {
      const built = buildScript(
        definition((s) => {
          s.if(
            () => {
              s.op('IS_INT_LVAR_GREATER_THAN_NUMBER', s.local('n'), int(5));
              s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', s.local('n'), int(9));
            },
            { any: true, then: () => s.wait(0) },
          );
          s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
        }),
      );
      // 00D6 IF 21 — OR of 2 (the 21-27 band).
      expect(built.instructions[1].operands[0]).toMatchObject({ kind: 'int', value: 21 });
    });

    it('lowers while to top-label + if + backwards GOTO', () => {
      const compiled = compileScript(
        definition((s) => {
          s.while(
            () => s.op('IS_INT_LVAR_GREATER_THAN_NUMBER', s.local('n'), int(0)),
            () => s.wait(100),
          );
          s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
        }),
      );
      expect(compiled.listing).toMatchInlineSnapshot(`
        "000000: 03A4 SCRIPT_NAME 'test-sc'
        000011: 00D6 IF 0
        000015: 0019 IS_INT_LVAR_GREATER_THAN_NUMBER 0@ 0
        000022: 004D GOTO_IF_FALSE -40
        000029: 0001 WAIT 100
        000033: 0002 GOTO -11
        000040: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 42
        "
      `);
    });

    it('sugar adds nothing the listing cannot show: raw emission produces identical bytes', () => {
      const sugar = compileScript(
        definition((s) => {
          s.loop(() => s.wait(1000));
        }),
      );
      const raw = compileScript(
        definition((s) => {
          s.label('top');
          s.wait(1000);
          s.op('GOTO', { kind: 'label', name: 'top' });
        }),
      );
      expect(sugar.bytes).toEqual(raw.bytes);
    });

    it('warns on a backwards jump enclosing no WAIT, and only there', () => {
      const busy = buildScript(definition((s) => s.loop(() => s.op('NOP'))));
      expect(busy.warnings).toHaveLength(1);
      expect(busy.warnings[0]).toContain('encloses no WAIT');

      const suppressed = buildScript(definition((s) => s.loop(() => s.op('NOP'), { noWaitWarning: true })));
      expect(suppressed.warnings).toHaveLength(0);

      const paced = buildScript(definition((s) => s.loop(() => s.wait(0))));
      expect(paced.warnings).toHaveLength(0);
    });

    it('compiles a dual-target script end to end and names the artifact by target', () => {
      const compiled = compileScript(
        definition((s) => {
          s.loop(() => {
            s.wait(1000);
            s.op('PRINT_STRING_NOW', str('hello'), int(1000));
          });
        }),
      );
      expect(compiled.artifact).toBe('test-script.cs');
      const opensaOnly = compileScript(definition(() => undefined, { target: 'opensa-only' }));
      expect(opensaOnly.artifact).toBe('test-script.opensa-only.cs');
    });
  });
});
