import type { Raw2dfxEntry } from '@opensa/rw-codec/dff';

import { composeRoadsignRotation } from '@opensa/renderware/roadsign/glyph-quads';
import { extract2dfxEntries } from '@opensa/rw-codec/dff';
import { decodeEscalator2dfx, decodeRoadsign2dfx } from '@opensa/rw-codec/two-d-effect';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { VertexTransform } from './build-mesh';
import type { Vec3 } from './mesh';

import { transform2dfxEntry } from './two-dfx-transform';

const SIGN_DFF = 'fixtures/custom/proper-fixes-models/vegasnroad19.dff';
const ESCALATOR_DFF = 'fixtures/original/dff/escalator/escl_la.dff';
const PARTICLE_DFF = 'fixtures/original/dff/particle/skullpillar01_lvs.dff';
const LIGHTS_DFF = 'fixtures/custom/proper-fixes-models/trafficlight1.dff';

const DEG_TO_RAD = Math.PI / 180;

const IDENTITY: VertexTransform = {
  normal: (x, y, z): Vec3 => [x, y, z],
  point: (x, y, z): Vec3 => [x, y, z],
};

/** The first entry of `type` in a fixture. */
function entryOf(path: string, type: number): Raw2dfxEntry {
  return extract2dfxEntries(new Uint8Array(readFileSync(path)), new Set([type]))[0];
}

/** The plate's facing in model space: the text normal (plate-local −Z) through the sign's own rotation. */
function plateNormal(rotation: readonly [number, number, number]): Vec3 {
  return composeRoadsignRotation(rotation[0] * DEG_TO_RAD, rotation[1] * DEG_TO_RAD, rotation[2] * DEG_TO_RAD)(
    0,
    0,
    -1,
  );
}

/** Rotation about Z by `deg`, then a translation — the shape both LOD paths actually pass. */
function rotZ(deg: number, translation: Vec3 = [0, 0, 0]): VertexTransform {
  const [s, c] = [Math.sin(deg * DEG_TO_RAD), Math.cos(deg * DEG_TO_RAD)];
  const normal = (x: number, y: number, z: number): Vec3 => [x * c - y * s, x * s + y * c, z];

  return {
    normal,
    point: (x, y, z): Vec3 => {
      const [rx, ry, rz] = normal(x, y, z);

      return [rx + translation[0], ry + translation[1], rz + translation[2]];
    },
  };
}

/** Uniform scale by `k` (no rotation) — the transform this function must refuse. */
function scaled(k: number): VertexTransform {
  return { normal: (x, y, z): Vec3 => [x * k, y * k, z * k], point: (x, y, z): Vec3 => [x * k, y * k, z * k] };
}

describe('transform2dfxEntry', () => {
  describe('negative cases', () => {
    it('refuses a scaling transform on a plate rather than stretching it', () => {
      expect(() => transform2dfxEntry(entryOf(SIGN_DFF, 7), scaled(2))).toThrow(/rotation basis is scaled/);
    });

    it('refuses a scaling transform on an escalator step path', () => {
      expect(() => transform2dfxEntry(entryOf(ESCALATOR_DFF, 10), scaled(0.5))).toThrow(/rotation basis is scaled/);
    });

    it('refuses a mirrored basis (a plate would face the right way and read backwards)', () => {
      const mirror: VertexTransform = {
        normal: (x, y, z): Vec3 => [-x, y, z],
        point: (x, y, z): Vec3 => [-x, y, z],
      };

      expect(() => transform2dfxEntry(entryOf(SIGN_DFF, 7), mirror)).toThrow(/not a pure rotation/);
    });
  });

  describe('positive cases', () => {
    it('is byte-identity under the identity transform, for every carried type', () => {
      for (const entry of [
        entryOf(SIGN_DFF, 7),
        entryOf(ESCALATOR_DFF, 10),
        entryOf(PARTICLE_DFF, 1),
        entryOf(LIGHTS_DFF, 0),
      ]) {
        const carried = transform2dfxEntry(entry, IDENTITY);

        expect(carried.bytes).toEqual(entry.bytes);
        expect(carried.position).toEqual(entry.position);
      }
    });

    it('leaves a plate facing exactly as authored when the transform only translates', () => {
      const entry = entryOf(SIGN_DFF, 7);
      const carried = transform2dfxEntry(entry, { ...IDENTITY, point: (x, y, z): Vec3 => [x + 5, y - 3, z + 1] });

      expect(carried.bytes).toEqual(entry.bytes); // payload untouched — nothing turned it
      expect(carried.position).toEqual([entry.position[0] + 5, entry.position[1] - 3, entry.position[2] + 1]);
    });

    it('turns a plate with the transform: the carried normal is the transformed HD normal', () => {
      const entry = entryOf(SIGN_DFF, 7);
      const before = decodeRoadsign2dfx(entry.bytes);
      const transform = rotZ(37, [100, -20, 4]);

      const after = decodeRoadsign2dfx(transform2dfxEntry(entry, transform).bytes);

      // The stock plates sit at rx = ±90 — the gimbal-locked branch, so the Euler TRIPLE is not preserved and
      // only the facing it encodes can be compared.
      const expected = transform.normal(...plateNormal(before.rotation));
      plateNormal(after.rotation).forEach((axis, index) => {
        expect(axis).toBeCloseTo(expected[index], 5);
      });
    });

    it('keeps the rest of a turned plate byte-for-byte — only the rotation moves', () => {
      const entry = entryOf(SIGN_DFF, 7);
      const before = decodeRoadsign2dfx(entry.bytes);

      const after = decodeRoadsign2dfx(transform2dfxEntry(entry, rotZ(90)).bytes);

      expect(after.plateSize).toEqual(before.plateSize);
      expect(after.flags).toBe(before.flags);
      expect(after.lines).toEqual(before.lines);
      expect(after.trailing).toEqual(before.trailing);
    });

    it('carries an escalator step path as POINTS and its direction as the flag it is', () => {
      const entry = entryOf(ESCALATOR_DFF, 10);
      const before = decodeEscalator2dfx(entry.bytes);
      const transform = rotZ(90, [10, 0, 2]);

      const after = decodeEscalator2dfx(transform2dfxEntry(entry, transform).bytes);

      expect(after.direction).toBe(before.direction); // a u32 step flag: rotating it would corrupt it
      for (const field of ['bottom', 'end', 'top'] as const) {
        const expected = transform.point(...before[field]);
        after[field].forEach((axis, index) => {
          expect(axis).toBeCloseTo(expected[index], 4);
        });
      }
    });

    it('leaves an opaque payload byte-verbatim under a rotation and moves only its position', () => {
      for (const entry of [entryOf(PARTICLE_DFF, 1), entryOf(LIGHTS_DFF, 0)]) {
        const transform = rotZ(45, [1, 2, 3]);
        const carried = transform2dfxEntry(entry, transform);

        expect(carried.bytes).toEqual(entry.bytes);
        expect(carried.position).toEqual(transform.point(...entry.position));
      }
    });
  });
});
