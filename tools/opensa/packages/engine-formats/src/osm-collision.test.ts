import { describe, expect, it } from 'vitest';

import { decodeOsmCollision, encodeOsmCollision, type OsmCollision } from './osm-collision';

const collision: OsmCollision = {
  boxes: [{ max: [1, 2, 3], min: [-1, -2, -3] }],
  halfExtents: [1.2, 2.5, 0.7],
  indices: Uint32Array.from([0, 1, 2, 2, 1, 0]),
  spheres: [
    { center: [0, 0, 0], radius: 1.5 },
    { center: [1, -1, 0.25], radius: 0.5 },
  ],
  vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
};

describe('osm-collision', () => {
  describe('negative cases', () => {
    it('refuses to read past the end of a truncated section', () => {
      const bytes = encodeOsmCollision(collision);

      expect(() => decodeOsmCollision(bytes.subarray(0, bytes.byteLength - 8))).toThrow(RangeError);
    });
  });

  describe('positive cases', () => {
    it('round-trips every primitive', () => {
      const decoded = decodeOsmCollision(encodeOsmCollision(collision));

      // Stored as f32, so compare at f32 precision (0.7 has no exact f32 representation).
      expect(decoded.halfExtents).toEqual(collision.halfExtents.map(Math.fround));
      expect(decoded.spheres).toEqual(collision.spheres);
      expect(decoded.boxes).toEqual(collision.boxes);
      expect(decoded.vertices).toEqual(collision.vertices);
      expect(decoded.indices).toEqual(collision.indices);
    });

    it('round-trips a mesh-less collision (spheres and boxes only)', () => {
      const primitivesOnly: OsmCollision = {
        ...collision,
        indices: new Uint32Array(0),
        vertices: new Float32Array(0),
      };
      const decoded = decodeOsmCollision(encodeOsmCollision(primitivesOnly));

      expect(decoded.vertices.length).toBe(0);
      expect(decoded.indices.length).toBe(0);
      expect(decoded.spheres).toEqual(collision.spheres);
    });

    it('decodes from a section that sits at an unaligned offset in a bigger buffer', () => {
      // What `.osm` hands us: a subarray view, whose byteOffset a Float32Array could not wrap directly.
      const bytes = encodeOsmCollision(collision);
      const padded = new Uint8Array(bytes.byteLength + 1);
      padded.set(bytes, 1);
      const decoded = decodeOsmCollision(padded.subarray(1));

      expect(decoded.vertices).toEqual(collision.vertices);
    });
  });
});
