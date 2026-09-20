import { describe, expect, it } from 'vitest';

import { createRecordingHost } from '../recording-host';
import { ScriptRunner } from '../runner';
import { buildScript, flt, int, lvar } from '../test-script';

const CAR = 257;
const GET_FRAME_FROM_NAME = 0x4c5400;
const SET_ROTATE_XYZ = 0x59b120;
const SET_ROTATE_X_ONLY = 0x59afa0;
const ANGLE = 0.5;

/** rhino's own preamble: vehicle pointer → +0x18 clump → frame by name → +0x10 modelling matrix. */
const frameMatrixOf = (name: string): Parameters<typeof buildScript>[0] => [
  { op: 0x0a97, operands: [int(CAR), lvar(0)] },
  { op: 0x000a, operands: [lvar(0), int(0x18)] },
  { op: 0x0a8d, operands: [lvar(0), int(4), int(0), lvar(0)] },
  // 0AA7 CALL_FUNCTION_RETURN GetFrameFromName num_params 2 pop 2 'name' clump -> frame
  {
    op: 0x0aa7,
    operands: [int(GET_FRAME_FROM_NAME), int(2), int(2), { kind: 'string', type: 0x0e, value: name }, lvar(0), lvar(1)],
  },
  { op: 0x000a, operands: [lvar(1), int(0x10)] },
];

const rotate = (rows: Parameters<typeof buildScript>[0]): ReturnType<typeof createRecordingHost> => {
  const host = createRecordingHost({ cars: [{ handle: CAR, model: 432 }] });
  const runner = new ScriptRunner({ host });
  runner.spawn(buildScript([...rows, { op: 0x0001, operands: [int(0)] }]), 'natives');
  runner.tick(16);
  expect(runner.faults).toEqual([]);

  return host;
};

const quatOf = (host: ReturnType<typeof createRecordingHost>): string =>
  host.calls.filter((line) => line.startsWith('natives.setPartRotation'))[0] ?? '(no rotation)';

describe('native calls', () => {
  describe('negative cases', () => {
    it("does NOT hand the atlas the script's listed order — rhino would yaw its wheels instead of rolling them", () => {
      // The shape rhino compiles: SetRotate num_params 3 pop 0 with the angle LAST (0, 0, angle).
      // Read positionally that is SetRotate(x=0, y=0, z=angle) — a yaw. CLEO pushes the args
      // upward onto a downward stack, so the LAST listed operand is the FIRST C argument: x.
      const host = rotate([
        ...frameMatrixOf('track_1'),
        { op: 0x0aa6, operands: [int(SET_ROTATE_XYZ), lvar(1), int(3), int(0), flt(0), flt(0), flt(ANGLE)] },
      ]);
      expect(quatOf(host)).not.toContain(`quat(0,0,${Math.sin(ANGLE / 2).toFixed(3)}`);
    });
  });

  describe('positive cases', () => {
    it("reverses 0AA5-0AA8 arguments into C order: rhino's trailing angle rotates about X", () => {
      const host = rotate([
        ...frameMatrixOf('track_1'),
        { op: 0x0aa6, operands: [int(SET_ROTATE_XYZ), lvar(1), int(3), int(0), flt(0), flt(0), flt(ANGLE)] },
      ]);
      const expected = `quat(${Math.sin(ANGLE / 2).toFixed(3)},0,0,${Math.cos(ANGLE / 2).toFixed(3)})`;
      expect(quatOf(host)).toContain(expected);
    });

    it('agrees with the unambiguous single-axis call — SetRotateXOnly(a) equals SetRotate(.., .., a)', () => {
      const viaXyz = rotate([
        ...frameMatrixOf('track_1'),
        { op: 0x0aa6, operands: [int(SET_ROTATE_XYZ), lvar(1), int(3), int(0), flt(0), flt(0), flt(ANGLE)] },
      ]);
      const viaXOnly = rotate([
        ...frameMatrixOf('track_1'),
        { op: 0x0aa6, operands: [int(SET_ROTATE_X_ONLY), lvar(1), int(1), int(0), flt(ANGLE)] },
      ]);
      expect(quatOf(viaXyz)).toBe(quatOf(viaXOnly));
    });

    it('a single-argument call is order-independent (the reversal cannot regress SetRotate*Only)', () => {
      const host = rotate([
        ...frameMatrixOf('misc_a'),
        { op: 0x0aa6, operands: [int(SET_ROTATE_X_ONLY), lvar(1), int(1), int(0), flt(0)] },
      ]);
      expect(quatOf(host)).toContain('quat(0,0,0,1)');
    });
  });
});
