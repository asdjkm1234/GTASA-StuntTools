import type { RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { describe, expect, it } from 'vitest';

import { MeshBuilder, type VertexTransform } from './build-mesh';

/** A one-triangle geometry with the given texture + optional prelit/night vertex colours. */
function geometry(
  texture: string,
  positions: number[],
  colours?: { day?: number[]; material?: [number, number, number, number]; night?: number[] },
): RWGeometry {
  return {
    flags: 0,
    lights: [],
    materials: [
      { color: colours?.material ?? [255, 255, 255, 255], texture: { maskName: '', name: texture }, textured: true },
    ],
    nightColors: colours?.night ? new Uint8Array(colours.night) : null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(positions),
    prelitColors: colours?.day ? new Uint8Array(colours.day) : null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** Translate-only transform (identity rotation), so assertions are exact. */
function shift(dx: number, dy: number, dz: number): VertexTransform {
  return { normal: (x, y, z) => [x, y, z], point: (x, y, z) => [x + dx, y + dy, z + dz] };
}

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const DAY = [40, 40, 40, 255, 40, 40, 40, 255, 40, 40, 40, 255];
const NIGHT = [8, 9, 10, 255, 8, 9, 10, 255, 8, 9, 10, 255];

describe('MeshBuilder', () => {
  describe('negative cases', () => {
    it('omits nightColors when no added geometry had a night set', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('wall', TRI, { day: DAY }), shift(0, 0, 0));

      expect(builder.finish().nightColors).toBeUndefined();
    });

    it('falls back to opaque white where a geometry had no prelit', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('wall', TRI), shift(0, 0, 0));

      expect([...builder.finish().colors]).toEqual(new Array(12).fill(255));
    });
  });

  describe('positive cases', () => {
    it('applies the transform and buckets triangles by texture', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('wall', TRI), shift(10, 20, 30));
      const mesh = builder.finish();

      expect([...mesh.positions.slice(0, 3)]).toEqual([10, 20, 30]);
      expect(mesh.groups).toEqual([{ indices: Uint32Array.of(0, 1, 2), texture: 'wall' }]);
    });

    it('buckets tinted materials separately from the plain texture and carries the colour', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('glass', TRI), shift(0, 0, 0));
      builder.add(geometry('glass', TRI, { material: [64, 128, 255, 200] }), shift(5, 0, 0));
      const mesh = builder.finish();

      expect(mesh.groups).toHaveLength(2);
      expect(mesh.groups[0].color).toBeUndefined(); // white stays the plain bucket
      expect(mesh.groups[1].texture).toBe('glass');
      expect(mesh.groups[1].color).toEqual([64, 128, 255, 200]);
    });

    it('re-bases triangle indices across successive add() calls', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('wall', TRI), shift(0, 0, 0));
      builder.add(geometry('wall', TRI), shift(5, 0, 0));
      const mesh = builder.finish();

      expect(mesh.positions).toHaveLength(18);
      expect([...mesh.groups[0].indices]).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('carries the source night set when present', () => {
      const builder = new MeshBuilder();
      builder.add(geometry('wall', TRI, { day: DAY, night: NIGHT }), shift(0, 0, 0));

      expect([...builder.finish().nightColors!]).toEqual(NIGHT);
    });
  });
});
