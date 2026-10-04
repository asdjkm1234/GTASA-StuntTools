import { describe, expect, it } from 'vitest';

import type { Quat } from './math';

import { cockpitStickMotion } from './cockpit-stick';
import { quatMultiply, rotateVec } from './math';

const identity: Quat = [0, 0, 0, 1];
const x = (angle: number): Quat => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
const binds = Array.from({ length: 5 }, () => identity);

describe('Hydra surface-driven stick', () => {
  it('pushes/pulls with the elevators and moves left/right with differential ailerons', () => {
    const motion = cockpitStickMotion([null, x(0.3), x(0.3), x(0.4), x(-0.4)], binds);
    const tip = rotateVec(motion.rotation, [0, 0, 1]);
    expect(tip[0]).toBeGreaterThan(0); // right roll
    expect(tip[1]).toBeGreaterThan(0); // push forward
    const reverse = rotateVec(cockpitStickMotion([null, x(-0.3), x(-0.3), x(-0.4), x(0.4)], binds).rotation, [0, 0, 1]);
    expect(reverse[0]).toBeLessThan(0);
    expect(reverse[1]).toBeLessThan(0);
  });

  it('cancels common aileron travel and treats recorded neutral as authoritative', () => {
    expect(cockpitStickMotion([null, identity, identity, x(0.3), x(0.3)], binds).rotation).toEqual(identity);
  });

  it('uses the surviving surface, marks a missing axis unavailable', () => {
    const partial = cockpitStickMotion([null, null, x(-0.2), null, x(-0.3)], binds);
    expect(partial.pitch).toBeCloseTo(0.12);
    expect(partial.roll).toBeCloseTo(0.18);
    const missing = cockpitStickMotion([null, null, null, identity, identity], binds);
    expect(missing.pitch).toBe(0);
    expect(missing.available).toBe(false);
    expect(missing.roll).toBe(0);
  });

  it('removes authored binds and accepts equivalent quaternion signs', () => {
    const bind: Quat = [0, Math.sin(0.2), 0, Math.cos(0.2)];
    const recorded = quatMultiply(x(0.3), bind);
    const result = cockpitStickMotion([null, recorded], [null, bind]);
    expect(result.pitch).toBeCloseTo(-0.18);
    expect(cockpitStickMotion([null, recorded.map((v) => -v) as Quat], [null, bind]).pitch).toBeCloseTo(result.pitch);
  });

  it('limits diagonal travel and has no history when seeking or exporting', () => {
    const nodes = [null, x(2), x(2), x(2), x(-2)];
    const first = cockpitStickMotion(nodes, binds);
    expect(Math.hypot(first.pitch, first.roll)).toBeCloseTo((18 * Math.PI) / 180);
    cockpitStickMotion([], binds);
    expect(cockpitStickMotion(nodes, binds)).toEqual(first);
    expect(Math.hypot(...first.rotation)).toBeCloseTo(1);
  });
});
