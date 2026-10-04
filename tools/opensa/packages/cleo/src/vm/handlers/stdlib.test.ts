import { describe, expect, it } from 'vitest';

import { createRecordingHost } from '../recording-host';
import { ScriptRunner } from '../runner';
import { buildScript, flt, int, lvar, str } from '../test-script';

const run = (rows: Parameters<typeof buildScript>[0], random?: () => number): ReturnType<ScriptRunner['spawn']> => {
  const runner = new ScriptRunner({ host: createRecordingHost(), ...(random ? { random } : {}) });
  const thread = runner.spawn(buildScript([...rows, { op: 0x0001, operands: [int(0)] }]), 'stdlib');
  runner.tick(16);

  return thread;
};

describe('stdlib handlers', () => {
  describe('negative cases', () => {
    it('a struct op on an unservable NATIVE pointer lands in the atlas miss ledger and answers 0', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(
        buildScript([
          { op: 0x0006, operands: [lvar(2), int(123)] },
          // 0D4E at an address+offset no atlas row names (cardoor's task pointer shape) — the read
          // routes through the memory facade (097/07): a REPORTED miss + a deterministic 0, never
          // a silent side channel and never stale var contents.
          { op: 0x0d4e, operands: [int(0x00b74494), int(0x10), int(4), lvar(2)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'native-ptr',
      );
      runner.tick(16);
      expect(host.atlas.misses).toContainEqual({
        address: 0x00b744a4,
        detail: 'unknown global 0xb744a4 (size 4)',
        kind: 'read',
      });
      expect(thread.locals.int(2)).toBe(0);
    });

    it('a list op on a dead token is a located fault', () => {
      const runner = new ScriptRunner({ host: createRecordingHost() });
      runner.spawn(buildScript([{ op: 0x0e74, operands: [int(0x4c00ffff), int(1)] }]), 'dead-list');
      runner.tick(16);
      expect(runner.faults[0].message).toMatch(/list .* does not exist/);
    });
  });

  describe('positive cases', () => {
    it('a struct read at an address the atlas CAN name is served through it', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      // 0D4E struct=CPools::ms_pVehiclePool offset=0 — resolves to the pool token, not a miss.
      const thread = runner.spawn(
        buildScript([
          { op: 0x0d4e, operands: [int(0x00b74494), int(0), int(4), lvar(0)] },
          { op: 0x0001, operands: [int(0)] },
        ]),
        'pool-read',
      );
      runner.tick(16);
      expect(host.atlas.misses).toEqual([]);
      expect(thread.locals.int(0)).not.toBe(0);
    });

    it('lists create/add/size/value/reset round-trip', () => {
      const thread = run([
        { op: 0x0e72, operands: [int(0), lvar(0)] },
        { op: 0x0e74, operands: [lvar(0), int(431)] },
        { op: 0x0e74, operands: [lvar(0), int(544)] },
        { op: 0x0e77, operands: [lvar(0), lvar(1)] },
        { op: 0x0e78, operands: [lvar(0), int(1), lvar(2)] },
        { op: 0x0e79, operands: [lvar(0)] },
        { op: 0x0e77, operands: [lvar(0), lvar(3)] },
      ]);
      expect(thread.locals.int(1)).toBe(2);
      expect(thread.locals.int(2)).toBe(544);
      expect(thread.locals.int(3)).toBe(0);
    });

    it('scratch buffers allocate as tokens and struct params read back what was written', () => {
      const thread = run([
        { op: 0x0ac8, operands: [int(64), lvar(0)] },
        { op: 0x0d37, operands: [lvar(0), int(3), int(0x1234)] },
        { op: 0x0d38, operands: [lvar(0), int(3), lvar(1)] },
        { op: 0x0d4e, operands: [lvar(0), int(12), int(4), lvar(2)] },
      ]);
      expect(thread.locals.int(0)).toBeGreaterThan(0x40000000);
      expect(thread.locals.int(1)).toBe(0x1234);
      expect(thread.locals.int(2)).toBe(0x1234); // param 3 = byte offset 12
    });

    it('STRING_FORMAT covers %d, %s, %x and %%', () => {
      const thread = run([
        {
          op: 0x0ad3,
          operands: [{ index: 4, kind: 'var', scope: 'local', type: 0x11 }, str('%d-%x%%'), int(42), int(255)],
        },
      ]);
      expect(thread.locals.string(4, 16)).toBe('42-ff%');
    });

    it('SIN/COS take degrees and 0208 uses the injected random source', () => {
      const thread = run(
        [
          { op: 0x02f6, operands: [flt(90), lvar(0)] },
          { op: 0x02f7, operands: [flt(0), lvar(1)] },
          { op: 0x0208, operands: [flt(10), flt(20), lvar(2)] },
        ],
        () => 0.5,
      );
      expect(thread.locals.float(0)).toBeCloseTo(1, 6);
      expect(thread.locals.float(1)).toBeCloseTo(1, 6);
      expect(thread.locals.float(2)).toBeCloseTo(15, 6);
    });

    it('GET_HEADING_FROM_VECTOR_2D maps +y to 0 and +x to 270 (GTA heading)', () => {
      const thread = run([
        { op: 0x0604, operands: [flt(0), flt(1), lvar(0)] },
        { op: 0x0604, operands: [flt(1), flt(0), lvar(1)] },
      ]);
      expect(thread.locals.float(0)).toBeCloseTo(0, 5);
      expect(thread.locals.float(1)).toBeCloseTo(270, 5);
    });

    it('perlin is deterministic across runs (the Wind Farm sway input)', () => {
      const rows: Parameters<typeof buildScript>[0] = [
        { op: 0x0ef1, operands: [flt(3.7), flt(11.2), int(3), flt(0.3), flt(10), flt(2), flt(0.5), lvar(0)] },
      ];
      const first = run(rows).locals.float(0);
      const second = run(rows).locals.float(0);
      expect(first).toBe(second);
      expect(first).not.toBe(0);
      expect(Math.abs(first)).toBeLessThan(20);
    });
  });
});
