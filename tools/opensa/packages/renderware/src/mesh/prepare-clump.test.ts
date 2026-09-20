import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { hasPreparedAtomics, prepareClumpAtomics, preparedAtomicsFor, primePreparedAtomics } from './prepare-clump';

function clumpWith(...geos: RWGeometry[]): RWClump {
  return {
    atomics: geos.map((_, index) => ({ frameIndex: 0, geometryIndex: index })),
    frames: [{ name: 'Mesh', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: geos,
  };
}

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    lights: [],
    materials: [material(), material({ color: [200, 100, 50, 255] })],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    prelitColors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
    triangles: [
      { a: 0, b: 1, c: 2, materialIndex: 0 },
      { a: 0, b: 2, c: 3, materialIndex: 0 },
      { a: 1, b: 2, c: 3, materialIndex: 1 },
    ],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

describe('prepareClumpAtomics', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty clump', () => {
      expect(prepareClumpAtomics({ atomics: [], frames: [], geometries: [] })).toEqual([]);
    });

    it('skips an atomic whose geometry index is out of range', () => {
      const clump = clumpWith(geometry());
      clump.atomics.push({ frameIndex: 0, geometryIndex: 7 });
      expect(prepareClumpAtomics(clump)).toHaveLength(1);
    });

    it('skips empty material slices instead of emitting empty parts', () => {
      const [atomic] = prepareClumpAtomics(clumpWith(geometry({ materials: [material(), material(), material()] })));
      // Fixture triangles only reference materials 0 and 1 — no slice for material 2.
      expect(atomic.parts.map((part) => part.materialIndex)).toEqual([0, 1]);
    });
  });

  describe('positive cases', () => {
    it('splits triangles into per-material index buffers', () => {
      const [atomic] = prepareClumpAtomics(clumpWith(geometry()));
      expect(atomic.parts).toHaveLength(2);
      expect([...atomic.parts[0].index]).toEqual([0, 1, 2, 0, 2, 3]);
      expect([...atomic.parts[1].index]).toEqual([1, 2, 3]);
      expect(atomic.parts[0].index).toBeInstanceOf(Uint16Array); // 4 vertices — 16-bit is plenty
    });

    it('computes area-weighted vertex normals (values captured from three@0.185.1)', () => {
      const rw = geometry({
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 5]),
        triangles: [
          { a: 0, b: 1, c: 2, materialIndex: 0 },
          { a: 0, b: 3, c: 1, materialIndex: 0 },
        ],
      });
      const [atomic] = prepareClumpAtomics(clumpWith(rw));

      // `BufferGeometry.computeVertexNormals()` on the same positions + index [0,1,2, 0,3,1].
      const expected = [0, 0.8574929237365723, 0.5144957304000854, 0, 0.8574929237365723, 0.5144957304000854, 0, 0, 1, 0, 1, 0]; // prettier-ignore
      atomic.normals.forEach((value, at) => expect(value).toBeCloseTo(expected[at], 5));
    });

    it('computes the bounding sphere like three (box centre, max-distance radius)', () => {
      const [atomic] = prepareClumpAtomics(clumpWith(geometry()));

      // `BufferGeometry.computeBoundingSphere()` on the fixture's unit quad, three@0.185.1.
      expect(atomic.sphere.center[0]).toBeCloseTo(0.5, 5);
      expect(atomic.sphere.center[1]).toBeCloseTo(0.5, 5);
      expect(atomic.sphere.center[2]).toBeCloseTo(0, 5);
      expect(atomic.sphere.radius).toBeCloseTo(0.7071067811865476, 5);
    });

    it('converts prelit RGBA bytes to vec3 float colours and keeps sway weights from the alpha', () => {
      const [atomic] = prepareClumpAtomics(
        clumpWith(
          geometry({ prelitColors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 170, 0, 0, 255, 255, 0, 0, 0, 255]) }),
        ),
      );
      expect(atomic.color?.itemSize).toBe(3);
      expect(atomic.color?.array[0]).toBeCloseTo(1, 5);
      expect(atomic.sway?.minAlpha).toBe(170);
      expect(atomic.sway?.weights[1]).toBeCloseTo((255 - 170) / 255, 5);
    });

    it('keeps vec4 prelit for floodlight beams (white texture + alpha cone)', () => {
      const beam = geometry({
        materials: [material({ texture: { maskName: '', name: 'white' }, textured: true })],
        prelitColors: new Uint8Array([255, 255, 255, 10, 255, 255, 255, 10, 255, 255, 255, 10, 255, 255, 255, 10]),
        triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
      });
      const [atomic] = prepareClumpAtomics(clumpWith(beam));
      expect(atomic.color?.itemSize).toBe(4);
    });
  });
});

describe('preparedAtomicsFor', () => {
  describe('positive cases', () => {
    it('caches by model name and serves primed (worker) results', () => {
      const clump = clumpWith(geometry());
      const first = preparedAtomicsFor('cache_test_model', clump);
      expect(preparedAtomicsFor('CACHE_TEST_MODEL', clump)).toBe(first); // case-insensitive hit

      const primed = prepareClumpAtomics(clump);
      primePreparedAtomics('primed_model', primed);
      expect(hasPreparedAtomics('PRIMED_MODEL')).toBe(true);
      expect(preparedAtomicsFor('primed_model', clump)).toBe(primed);
    });
  });
});
