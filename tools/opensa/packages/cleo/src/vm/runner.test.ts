import { describe, expect, it } from 'vitest';

import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { buildScript, flt, gvar, int, label, larr, lstr, lvar, str } from './test-script';

const make = (options: Partial<ConstructorParameters<typeof ScriptRunner>[0]> = {}): ScriptRunner =>
  new ScriptRunner({ host: createRecordingHost(), ...options });

describe('ScriptRunner', () => {
  describe('negative cases', () => {
    it('kills a thread on a handler throw and keeps the others running', () => {
      const runner = make();
      runner.registry.register(0x7000, () => {
        throw new Error('boom');
      });
      const dying = runner.spawn(buildScript([{ op: 0x7000 }]), 'dying');
      const survivor = runner.spawn(
        buildScript([
          { op: 0x0006, operands: [lvar(0), int(5)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'survivor',
      );
      runner.tick(16);
      expect(dying.terminated).toBe(true);
      expect(runner.faults).toEqual([{ message: 'boom', thread: 'dying' }]);
      expect(survivor.terminated).toBe(false);
      expect(survivor.locals.int(0)).toBe(5);
    });

    it('a RETURN without a GOSUB is a located fault, not a crash', () => {
      const runner = make();
      runner.spawn(buildScript([{ op: 0x0051 }]), 'orphan');
      runner.tick(16);
      expect(runner.faults[0].message).toMatch(/RETURN without a GOSUB/);
    });

    it('bounds a WAIT-less loop by the instruction budget and yields', () => {
      const runner = make({ maxInstructionsPerTick: 50 });
      const thread = runner.spawn(
        buildScript([
          { op: 0x000a, operands: [lvar(0), int(1)] },
          { op: 0x0002, operands: [label(0)] },
        ]),
        'spinner',
      );
      runner.tick(16);
      expect(thread.terminated).toBe(false);
      expect(runner.faults).toHaveLength(0);
      expect(runner.instructionsLastTick).toBe(50);
      // The next tick resumes where the budget cut it — no progress is lost.
      runner.tick(16);
      expect(thread.locals.int(0)).toBeGreaterThan(25);
    });

    it('routes an unregistered opcode to onUnimplemented ONCE and fails its condition', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(
        buildScript([
          // 0E4A IS_CHAR_EXITING_ANY_CAR — a class-C opcode nothing registers yet.
          { op: 0x00d6, operands: [int(0)] },
          { negated: true, op: 0x0e4a, operands: [lvar(0)] },
          { op: 0x0e4a, operands: [lvar(0)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'cardoor',
      );
      runner.tick(16);
      expect(host.calls.filter((line) => line.startsWith('onUnimplemented 0E4A'))).toHaveLength(1);
      // Tier-b default: FINAL condition false, negation ignored — the guard block never runs.
      expect(thread.condition).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('WAIT arms against game time and the thread sleeps until the clock passes it', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          { op: 0x0001, operands: [int(100)] },
          { op: 0x0006, operands: [lvar(0), int(1)] },
          { op: 0x0001, operands: [int(10_000)] },
        ]),
        'sleeper',
      );
      runner.tick(16);
      expect(thread.locals.int(0)).toBe(0);
      runner.tick(50);
      expect(thread.locals.int(0)).toBe(0);
      runner.tick(50); // clock 116 ≥ 100 — wakes, runs, sleeps again
      expect(thread.locals.int(0)).toBe(1);
    });

    it('timers advance with game delta even while the thread sleeps', () => {
      const runner = make();
      const thread = runner.spawn(buildScript([{ op: 0x0001, operands: [int(10_000)] }]), 'timers');
      runner.tick(16);
      runner.tick(500);
      expect(thread.locals.int(32)).toBe(516);
      expect(thread.locals.int(33)).toBe(516);
    });

    it('negated conditionals and ANDOR groups combine into one flag', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          { op: 0x0006, operands: [lvar(0), int(5)] },
          // IF 1 = AND of the next two conditions.
          { op: 0x00d6, operands: [int(1)] },
          { op: 0x0039, operands: [lvar(0), int(5)] },
          { negated: true, op: 0x0039, operands: [lvar(0), int(6)] },
          { op: 0x004d, operands: [label(6)] },
          { op: 0x0006, operands: [lvar(1), int(111)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'andor',
      );
      runner.tick(16);
      expect(thread.locals.int(1)).toBe(111);
    });

    it('OR groups pass when any member passes', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          // IF 21 = OR of the next two.
          { op: 0x00d6, operands: [int(21)] },
          { op: 0x0039, operands: [lvar(0), int(9)] },
          { op: 0x0039, operands: [lvar(0), int(0)] },
          { op: 0x004d, operands: [label(5)] },
          { op: 0x0006, operands: [lvar(1), int(1)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'or',
      );
      runner.tick(16);
      expect(thread.locals.int(1)).toBe(1);
    });

    it('gosub nests and returns in order', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          { op: 0x0050, operands: [label(3)] }, // gosub outer
          { op: 0x000a, operands: [lvar(0), int(100)] },
          { op: 0x0001, operands: [int(0)] },
          { op: 0x0050, operands: [label(6)] }, // outer: gosub inner
          { op: 0x000a, operands: [lvar(0), int(10)] },
          { op: 0x0051 }, // return from outer
          { op: 0x000a, operands: [lvar(0), int(1)] },
          { op: 0x0051 }, // inner: return
        ]),
        'gosub',
      );
      runner.tick(16);
      expect(thread.locals.int(0)).toBe(111);
    });

    it('CLEO_CALL runs the sub on a fresh local frame and CLEO_RETURN copies outputs back', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          { op: 0x0006, operands: [lvar(0), int(7)] },
          // CLEO_CALL label numArgs=2 args(5, 0@) out(1@)
          { op: 0x0ab1, operands: [label(4), int(2), int(5), lvar(0), lvar(1)] },
          { op: 0x0006, operands: [lvar(2), int(1)] },
          { op: 0x0001, operands: [int(0)] },
          // sub: 0@=5, 1@=7 arrive in a ZEROED frame; return 0@+1@
          { op: 0x005a, operands: [lvar(0), lvar(1)] },
          { op: 0x0ab2, operands: [int(1), lvar(0)] },
        ]),
        'cleo-call',
      );
      runner.tick(16);
      expect(thread.locals.int(0)).toBe(7); // caller frame restored
      expect(thread.locals.int(1)).toBe(12); // 5 + 7 copied into the output var
      expect(thread.locals.int(2)).toBe(1); // execution resumed after the call
    });

    it('timed float ops scale by the SA timestep (delta / 20 ms)', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          // 0079 ADD_TIMED_VAL_TO_FLOAT_LVAR 0@ += 1.5 per timestep unit
          { op: 0x0079, operands: [lvar(0), flt(1.5)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'timed',
      );
      runner.tick(40); // 40 ms = 2.0 timestep units
      expect(thread.locals.float(0)).toBeCloseTo(3, 5);
    });

    it('arrays address base + index and globals persist across threads', () => {
      const runner = make();
      runner.spawn(
        buildScript([
          { op: 0x0006, operands: [lvar(1), int(2)] }, // index var
          { op: 0x0006, operands: [larr(5, 1, 18), int(42)] }, // arr@(5,1@) → slot 7
          { op: 0x0006, operands: [gvar(100), int(9)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'writer',
      );
      const reader = runner.spawn(
        buildScript([
          { op: 0x0085, operands: [lvar(0), gvar(100)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'reader',
      );
      runner.tick(16);
      expect(reader.locals.int(0)).toBe(9);
    });

    it('START_NEW_SCRIPT spawns a thread at the label with args in its locals', () => {
      const runner = make();
      runner.spawn(
        buildScript([
          { op: 0x004f, operands: [label(2), int(77)] },
          { op: 0x0001, operands: [int(0)] },
          { op: 0x0006, operands: [lvar(1), int(1)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'parent',
      );
      runner.tick(16);
      const spawned = runner.activeThreads.find((thread) => thread.name.startsWith('parent+'));
      expect(spawned?.locals.int(0)).toBe(77);
      expect(spawned?.locals.int(1)).toBe(1);
    });

    it('SCRIPT_NAME renames the thread and string vars hold text', () => {
      const runner = make();
      const thread = runner.spawn(
        buildScript([
          { op: 0x03a4, operands: [str('FERRIS')] },
          { op: 0x0ad3, operands: [lstr(4), str('car%d'), int(3)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'unnamed',
      );
      runner.tick(16);
      expect(thread.name).toBe('FERRIS');
      expect(thread.locals.string(4, 16)).toBe('car3');
    });
  });
});
