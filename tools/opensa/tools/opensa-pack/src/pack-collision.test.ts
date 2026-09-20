import type { RegionColliders } from '@opensa/renderware';

import { decodeOscol, encodeOscol } from '@opensa/engine-formats';
import { bakedModelColliders } from '@opensa/game/adapters/baked-collision';
import { toModelColliders } from '@opensa/game/adapters/gta-sa-world.adapter';
import { Matrix4 } from '@opensa/math';
import { breakableInstanceKey } from '@opensa/renderware/breakable/key';
import { describe, expect, it } from 'vitest';

import { bakeCellCollision, bakeRegion, collisionCellRect } from './pack-collision';

/**
 * The bake is only correct if it agrees with the path it replaces, so the oracle is that path itself:
 * `toModelColliders` is what the runtime builds today from the same `RegionColliders`.
 *
 * This test lives in the TOOL because it needs both the writer and the runtime, and `type:engine` may not
 * depend on `type:tool` (`docs/restrictions/architecture.md`).
 */

const surface = (material: number): { brightness: number; flag: number; light: number; material: number } => ({
  brightness: 0,
  flag: 0,
  light: 0,
  material,
});

function regionColliders(): RegionColliders {
  return {
    col: {
      bounds: { center: [0.5, 0.5, 0.5], max: [1, 1, 1], min: [0, 0, 0], radius: 2 },
      boxes: [{ max: [1, 2, 3], min: [-1, -2, -3], surface: surface(7) }],
      faces: [
        { a: 0, b: 1, c: 2, light: 0, material: 4 },
        { a: 0, b: 2, c: 3, light: 0, material: 17 },
      ],
      modelId: 42,
      name: 'roads32_law2',
      spheres: [{ center: [0, 0, 2], radius: 1.5, surface: surface(9) }],
      version: 3,
      vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    },
    name: 'roads32_law2',
    transforms: [new Matrix4().setPosition(12.5, -3, 7)],
  } as unknown as RegionColliders;
}

describe('bakeCellCollision', () => {
  describe('negative cases', () => {
    it('bakes an empty cell rather than nothing, so "no colliders" is distinguishable from "not baked"', () => {
      expect(decodeOscol(encodeOscol(bakeCellCollision([], () => false))).regions).toEqual([]);
    });

    it('gives a model that does not shatter NO instance keys — presence is the whole breakable flag', () => {
      const baked = decodeOscol(encodeOscol(bakeCellCollision([regionColliders()], () => false))).regions[0];

      expect(baked.instanceKeys).toBeUndefined();
    });

    it('does not drop a surface id anywhere on the way through the container', () => {
      const baked = decodeOscol(encodeOscol(bakeCellCollision([regionColliders()], () => false))).regions[0];

      expect(baked.materials).toEqual(Uint8Array.from([4, 17]));
      expect(baked.boxes[0].material).toBe(7);
      expect(baked.spheres[0].material).toBe(9);
    });
  });

  describe('positive cases', () => {
    it('agrees with the runtime path it replaces, index for index', () => {
      const source = regionColliders();

      const baked = bakeRegion(source, false);
      const runtime = toModelColliders(source);

      expect(baked.indices).toEqual(runtime.shape.indices);
      expect(baked.materials).toEqual(runtime.shape.materials);
      expect(baked.vertices).toEqual(runtime.shape.vertices);
      expect(baked.name).toBe(runtime.name);
    });

    it('reads back through the RUNTIME path as the colliders the COL parse would have built', () => {
      // The whole loop the plan buys: regions → bake → container → the runtime's read. If these two ever
      // disagree, the world the player collides with stops being the world the converter saw.
      const source = regionColliders();

      const [baked] = bakedModelColliders(decodeOscol(encodeOscol(bakeCellCollision([source], () => false))));
      const runtime = toModelColliders(source);

      expect(baked.name).toBe(runtime.name);
      expect(baked.shape.indices).toEqual(runtime.shape.indices);
      expect(baked.shape.materials).toEqual(runtime.shape.materials);
      expect(baked.shape.vertices).toEqual(runtime.shape.vertices);
      expect(baked.shape.boxes).toEqual(runtime.shape.boxes);
      expect(baked.shape.spheres).toEqual(runtime.shape.spheres);
      expect(baked.transforms.map((matrix) => matrix.elements)).toEqual(
        runtime.transforms.map((matrix) => matrix.elements),
      );
    });

    it('keys a breakable model’s placements the way the render registry and the physics layer do', () => {
      // The key IS the contract that pairs a hit to the prop that disappears — baking it means the runtime
      // never opens the model's DFF to ask whether it shatters, and a key spelled differently resolves to
      // nothing at all.
      const baked = decodeOscol(encodeOscol(bakeCellCollision([regionColliders()], () => true))).regions[0];

      expect(baked.instanceKeys).toEqual([breakableInstanceKey('roads32_law2', [12.5, -3, 7])]);
      expect(baked.instanceKeys).toHaveLength(baked.transforms.length);
    });

    it('survives the round trip through .oscol with its placements intact', () => {
      const baked = decodeOscol(encodeOscol(bakeCellCollision([regionColliders()], () => false))).regions[0];

      expect(baked.transforms).toHaveLength(1);
      // Column-major: the translation is the last row of `Matrix4.elements`.
      expect([...baked.transforms[0]].slice(12, 15)).toEqual([12.5, -3, 7]);
      expect(baked.vertices).toEqual(Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
    });
  });
});

describe('collisionCellRect', () => {
  describe('negative cases', () => {
    it('does NOT return the render rect unchanged — the grids only meet every 32 000 units', () => {
      // Ganton, the district every mobile recipe in the docs converts.
      expect(collisionCellRect([8, -8, 11, -5], 250, 256)).not.toEqual([8, -8, 11, -5]);
    });

    it('covers the whole world extent, so no strip of a district is left without collision', () => {
      const [gx0, gy0, gx1, gy1] = collisionCellRect([8, -8, 11, -5], 250, 256);

      // The render rect spans world x 2000…2999.99 and y -2000…-1250.01 (inclusive cells, half-open ends).
      expect(gx0 * 256).toBeLessThanOrEqual(8 * 250);
      expect((gx1 + 1) * 256).toBeGreaterThanOrEqual((11 + 1) * 250);
      expect(gy0 * 256).toBeLessThanOrEqual(-8 * 250);
      expect((gy1 + 1) * 256).toBeGreaterThanOrEqual((-5 + 1) * 250);
    });
  });

  describe('positive cases', () => {
    it('normalises a rect given corner-first', () => {
      expect(collisionCellRect([11, -5, 8, -8], 250, 256)).toEqual(collisionCellRect([8, -8, 11, -5], 250, 256));
    });

    it('is the identity when the two grids are the same', () => {
      expect(collisionCellRect([3, -4, 5, -1], 256, 256)).toEqual([3, -4, 5, -1]);
    });

    it('handles the negative side, where flooring and truncation disagree', () => {
      // -1 render cell spans world -250…-0.01; on the 256 grid that is entirely cell -1.
      expect(collisionCellRect([-1, -1, -1, -1], 250, 256)).toEqual([-1, -1, -1, -1]);
    });
  });
});
