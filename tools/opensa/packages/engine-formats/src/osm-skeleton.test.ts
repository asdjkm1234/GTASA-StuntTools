import { describe, expect, it } from 'vitest';

import type { OsmSkeleton } from './osm-skeleton';

import { decodeOsmSkeleton, encodeOsmSkeleton } from './osm-skeleton';

const skeleton = (): OsmSkeleton => ({
  frames: [
    { boneId: -1, name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    {
      boneId: 7,
      name: 'door_hinge',
      parentIndex: 0,
      position: [1.5, -2, 0.25],
      rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1],
    },
  ],
});

describe('osm skeleton section', () => {
  describe('negative cases', () => {
    it('survives a clump with no frames', () => {
      expect(decodeOsmSkeleton(encodeOsmSkeleton({ frames: [] }))).toEqual({ frames: [] });
    });

    it('refuses a rotation that is not a 3x3 rather than writing a corrupt frame', () => {
      const broken: OsmSkeleton = {
        frames: [{ boneId: -1, name: 'bad', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0] }],
      };

      expect(() => encodeOsmSkeleton(broken)).toThrow(/9 floats/);
    });

    it('decodes from an UNALIGNED view over a larger buffer', () => {
      const encoded = encodeOsmSkeleton(skeleton());
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOsmSkeleton(padded.subarray(3))).toEqual(skeleton());
    });
  });

  describe('positive cases', () => {
    it('round-trips names, parents, bone ids, positions and the full 3x3', () => {
      expect(decodeOsmSkeleton(encodeOsmSkeleton(skeleton()))).toEqual(skeleton());
    });

    it('keeps -1 apart from 0 for parents and bone ids (a root is not frame zero)', () => {
      const read = decodeOsmSkeleton(encodeOsmSkeleton(skeleton()));

      expect(read.frames[0].parentIndex).toBe(-1);
      expect(read.frames[0].boneId).toBe(-1);
      expect(read.frames[1].parentIndex).toBe(0);
      expect(read.frames[1].boneId).toBe(7);
    });
  });
});
