import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RWBreakable } from '../parsers/binary/types';

import { toArrayBuffer } from '../test-utils';
import { bakeDebris, DEBRIS_LIFETIME } from './bake-debris';
import { getBreakable } from './mesh';

/** Two triangles sharing one texture, sitting flat at z = 0 in model space. */
function shatterMesh(textures: [string, string] = ['crate', 'crate']): RWBreakable {
  return {
    colours: new Uint8Array([255, 128, 0, 255, 255, 128, 0, 255, 255, 128, 0, 255, 10, 20, 30, 255]),
    materials: [
      { ambient: [1, 1, 1], mask: '', texture: textures[0] },
      { ambient: [0.5, 0.5, 0.5], mask: '', texture: textures[1] },
    ],
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    triangleMaterials: new Uint16Array([0, 1]),
    triangles: new Uint16Array([0, 1, 2, 1, 3, 2]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
  } as unknown as RWBreakable;
}

/** Identity, then translated 10 m up — column-major, as three's `Matrix4.elements` hands it over. */
const AT_HEIGHT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1];

describe('bakeDebris', () => {
  describe('negative cases', () => {
    it('never lands the shards when no ground was probed — the three path’s known defect', () => {
      // Prod ships without a ground probe: the shards fall through the floor and sink while fading. The own
      // engine is meant to FIX that by passing a real groundZ, so the "never lands" value must stay explicit
      // rather than silently becoming a plausible-looking small number.
      const baked = bakeDebris(shatterMesh(), AT_HEIGHT);

      expect([...baked.landTime].every((time) => time > DEBRIS_LIFETIME)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('de-indexes into per-triangle shards, three vertices each', () => {
      const baked = bakeDebris(shatterMesh(), AT_HEIGHT);

      expect(baked.vertexCount).toBe(6); // 2 triangles × 3
      expect(baked.position).toHaveLength(18);
    });

    it('every vertex of a shard shares ONE flight — else the triangle tears apart in the air', () => {
      const baked = bakeDebris(shatterMesh(), AT_HEIGHT);

      for (const shard of [0, 1]) {
        const at = shard * 3;
        for (const vertex of [1, 2]) {
          expect([...baked.velocity.subarray((at + vertex) * 3, (at + vertex) * 3 + 3)]).toEqual([
            ...baked.velocity.subarray(at * 3, at * 3 + 3),
          ]);
          expect([...baked.center.subarray((at + vertex) * 3, (at + vertex) * 3 + 3)]).toEqual([
            ...baked.center.subarray(at * 3, at * 3 + 3),
          ]);
          expect(baked.landTime[at + vertex]).toBe(baked.landTime[at]);
        }
      }
    });

    it('bakes into WORLD space — gravity is a literal −Z, so the mesh must not need a transform', () => {
      const baked = bakeDebris(shatterMesh(), AT_HEIGHT);

      // Every corner (model z = 0) is lifted to the prop's world height.
      for (let vertex = 0; vertex < baked.vertexCount; vertex += 1) {
        expect(baked.position[vertex * 3 + 2]).toBeCloseTo(10);
      }
    });

    it('collapses shards onto ONE draw per texture (a bin authors seven identical materials)', () => {
      const shared = bakeDebris(shatterMesh(['crate', 'crate']), AT_HEIGHT);
      const mixed = bakeDebris(shatterMesh(['crate', 'metal']), AT_HEIGHT);

      expect(shared.groups).toHaveLength(1);
      expect(shared.groups[0]).toEqual({ count: 18, start: 0, texture: 'crate' });
      expect(mixed.groups.map((group) => group.texture)).toEqual(['crate', 'metal']);
      // Contiguous and complete: every vertex belongs to exactly one group.
      expect(mixed.groups.reduce((sum, group) => sum + group.count, 0)).toBe(mixed.vertexCount * 3);
    });

    it('lands the shards when a ground height IS probed (the fix this port carries)', () => {
      const baked = bakeDebris(shatterMesh(), AT_HEIGHT, { groundZ: 0 });

      // Thrown up from 10 m, a shard reaches the ground within the lifetime rather than sinking forever.
      expect([...baked.landTime].every((time) => time > 0 && time < DEBRIS_LIFETIME)).toBe(true);
    });

    it('is deterministic — the same prop shatters identically every session', () => {
      const first = bakeDebris(shatterMesh(), AT_HEIGHT);
      const second = bakeDebris(shatterMesh(), AT_HEIGHT);

      expect([...first.velocity]).toEqual([...second.velocity]);
      expect([...first.angular]).toEqual([...second.angular]);
    });

    it('flings the shards AWAY from the hit — the impact seeds their velocity', () => {
      const still = bakeDebris(shatterMesh(), AT_HEIGHT, { seed: 1 });
      const rammed = bakeDebris(shatterMesh(), AT_HEIGHT, { impact: [20, 0, 0], seed: 1 });

      expect(rammed.velocity[0]).toBeGreaterThan(still.velocity[0] + 5);
    });
  });
});

// A REAL shatter mesh: trafficlight1 ships an RW Breakable atomic (SA authors 238 of them). The synthetic mesh
// above pins the arithmetic; this one proves the arithmetic survives contact with SA's own data.
const TRAFFICLIGHT = 'fixtures/custom/proper-fixes-models/trafficlight1.dff';

describe.skipIf(!existsSync(TRAFFICLIGHT))('bakeDebris (a real SA shatter mesh)', () => {
  const shatter = getBreakable(
    { get: () => toArrayBuffer(readFileSync(TRAFFICLIGHT)), names: [] },
    'trafficlight1',
  ) as RWBreakable;

  describe('positive cases', () => {
    it('shatters SA’s own mesh into per-triangle shards, all finite, one draw per texture', () => {
      const baked = bakeDebris(shatter, AT_HEIGHT, { groundZ: 0, impact: [12, 0, 0] });

      expect(baked.vertexCount).toBe(shatter.triangleMaterials.length * 3);
      expect(baked.vertexCount).toBeGreaterThan(30); // a real prop, not a toy
      expect([...baked.position].every(Number.isFinite)).toBe(true);
      expect([...baked.velocity].every(Number.isFinite)).toBe(true);
      // Every shard lands within its lifetime — thrown from 10 m, with a real ground to land on.
      expect([...baked.landTime].every((time) => time > 0 && time < DEBRIS_LIFETIME)).toBe(true);
      // The groups partition the mesh: SA authors several identical materials, and they collapse.
      expect(baked.groups.reduce((sum, group) => sum + group.count, 0)).toBe(baked.vertexCount * 3);
      expect(baked.groups.length).toBeLessThanOrEqual(shatter.materials.length);
    });
  });
});
