import { describe, expect, it } from 'vitest';

import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { buildScript, int } from './test-script';
import { atlasTierOf, DECLARED_TIERS, tierOf } from './tiers';

describe('unimplemented tiers', () => {
  describe('negative cases', () => {
    it('kill-thread terminates the thread with a located fault (the tick goes on)', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host, tiers: new Map([[0x7abc, 'kill-thread']]) });
      const dying = runner.spawn(buildScript([{ op: 0x7abc }, { op: 0x0000 }]), 'dying');
      const survivor = runner.spawn(buildScript([{ op: 0x0001, operands: [int(0)] }]), 'survivor');
      runner.tick(16);

      expect(dying.terminated).toBe(true);
      expect(runner.faults).toEqual([{ message: 'opcode 7abc is tier kill-thread', thread: 'dying' }]);
      expect(survivor.terminated).toBe(false);
    });

    it('a declared tier for an opcode the registry already serves is a stale declaration', () => {
      const runner = new ScriptRunner({ host: createRecordingHost() });
      const stale = [...DECLARED_TIERS.keys()].filter((opcode) => runner.registry.has(opcode));

      expect(stale.map((opcode) => opcode.toString(16))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('resolves a declared tier as declared, and an unknown one to the DB default', () => {
      expect(tierOf(0x0af0)).toEqual({ declared: true, tier: 'conditional-false' });
      expect(tierOf(0x0615)).toEqual({ declared: true, tier: 'noop' });
      expect(tierOf(0x7abc)).toEqual({ declared: false, tier: 'noop' });
    });

    it('a declared conditional-false answers the IF false even without the DB condition flag', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host, tiers: new Map([[0x7abc, 'conditional-false']]) });
      // IF 0 · <unimplemented cond> · GOTO_IF_FALSE -> skip to WAIT (index 3) · NOP (must be skipped)
      const thread = runner.spawn(
        buildScript([
          { op: 0x00d6, operands: [int(0)] },
          { op: 0x7abc },
          { op: 0x004d, operands: [int(-30)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'guarded',
      );
      runner.tick(16);

      expect(thread.terminated).toBe(false);
      expect(thread.ip).toBe(4); // jumped over nothing extra: landed on the WAIT and yielded past it
    });

    it('an atlas miss resolves by what the facade DID: reads/calls answered 0 (tier b), writes skipped (tier a)', () => {
      expect(atlasTierOf({ address: 0x590, detail: 'vehicle+0x590 (size 4)', kind: 'read' })).toEqual({
        declared: false,
        tier: 'conditional-false',
      });
      expect(atlasTierOf({ address: 0xdead, detail: 'unknown function 0xdead', kind: 'call' })).toEqual({
        declared: false,
        tier: 'conditional-false',
      });
      expect(atlasTierOf({ address: 0x590, detail: 'raw address', kind: 'write' })).toEqual({
        declared: false,
        tier: 'noop',
      });
    });

    it('coverage() accumulates per-opcode counts with tier resolution, worst first', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(
        buildScript([
          { op: 0x0615 }, // declared noop (class C)
          { op: 0x0615 },
          { op: 0x7abc }, // undeclared
          { op: 0x0001, operands: [int(0)] },
        ]),
        'covered',
      );
      runner.tick(16);

      expect(runner.coverage()).toEqual([
        { count: 2, declared: true, opcode: 0x0615, tier: 'noop' },
        { count: 1, declared: false, opcode: 0x7abc, tier: 'noop' },
      ]);
      expect(host.calls.filter((line) => line.startsWith('onUnimplemented'))).toHaveLength(2); // once per id
    });
  });
});
