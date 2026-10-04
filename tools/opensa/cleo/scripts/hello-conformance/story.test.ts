import { createRecordingHost, decodeScript, ScriptRunner } from '@opensa/cleo';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { script as definition } from './script';

const FRAME_MS = 1000 / 60;

describe('hello-conformance', () => {
  describe('positive cases', () => {
    it('prints once a second, five times, then terminates cleanly', () => {
      const compiled = compileScript(definition);
      expect(compiled.warnings).toEqual([]);
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(decodeScript(compiled.bytes), definition.name);
      for (let frame = 0; frame < 60 * 7; frame += 1) {
        runner.tick(FRAME_MS);
      }
      expect(runner.faults).toEqual([]);
      const prints = host.calls.filter((line) => line.startsWith('text.printNow'));
      expect(prints).toHaveLength(5);
      expect(prints[0]).toBe("text.printNow 'HELLO OPENSA' 900");
      expect(runner.activeThreads).toHaveLength(0);
    });

    it('stays within its declared per-tick budget', () => {
      const compiled = compileScript(definition);
      const runner = new ScriptRunner({ host: createRecordingHost() });
      runner.spawn(decodeScript(compiled.bytes), definition.name);
      let worstTick = 0;
      for (let frame = 0; frame < 60 * 7; frame += 1) {
        runner.tick(FRAME_MS);
        worstTick = Math.max(worstTick, runner.instructionsLastTick);
      }
      expect(worstTick).toBeGreaterThan(0);
      expect(worstTick).toBeLessThanOrEqual(definition.budgetPerTick);
    });

    it('builds deterministically and emits the committed listing (the review surface)', () => {
      const first = compileScript(definition);
      expect(first.artifact).toBe('hello-conformance.cs');
      expect(first.bytes).toEqual(compileScript(definition).bytes);
      expect(first.listing).toMatchInlineSnapshot(`
        "000000: 03A4 SCRIPT_NAME 'hellocf'
        000011: 0006 SET_LVAR_INT 0@ 0
        000018: 00D6 IF 0
        000022: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 0@ 4
        000029: 004D GOTO_IF_FALSE -74
        000036: 0001 WAIT 1000
        000041: 0ACD PRINT_STRING_NOW 'HELLO OPENSA' 900
        000060: 000A ADD_VAL_TO_INT_LVAR 0@ 1
        000067: 0002 GOTO -18
        000074: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 76
        "
      `);
    });
  });
});
