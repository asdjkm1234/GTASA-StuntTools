import type { TextureSource } from '@opensa/lod-common/texture-source';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LodLink } from '../../core/types';
import type { BuildStats } from './finalize';

import { cloneLodDff } from './finalize';

// The Burger Shot of LAw (`npm run test:fixtures`): an `anim` clump of TWO atomics — the building (752 tris) on
// the root frame and its burger sign (336 tris) on a child frame at (7.2, −7.3, 1.0). Its stock LOD row is a
// plain `objs` atomic model, and SA keeps exactly ONE atomic of a clump read through such a row, re-framed at
// the origin. The verbatim clone showed the sign alone at the origin — "LOD absent" (open issue
// sa-lod-visibility-budget, round 15).
const BURGER = 'fixtures/original/dff/anim-clump/burger01_law.dff';
const SIGN_OFFSET = { x: 7.1796875, y: -7.296875, z: 1.0078125 };

const LINK: LodLink = {
  hdDrawDistance: 100,
  hdModel: 'burger01_law',
  hdTxd: 'burgsh01_law',
  instanceCount: 1,
  lodId: 6201,
  lodModel: 'lodger01_law',
  lodTxd: 'salod0079',
};

const NO_TEXTURES: TextureSource = { get: () => null };

/** A decimator that rejects every target — the budget path that used to leave the byte-copy in place. */
const keepEverything = <T>(mesh: T): T => mesh;

function burger(): Uint8Array {
  return new Uint8Array(readFileSync(BURGER));
}

function hasVertexNear(bytes: Uint8Array, point: readonly number[], tolerance = 1e-3): boolean {
  return parseDff(toBuffer(bytes)).geometries.some((geometry) => {
    for (let i = 0; i < geometry.positions.length; i += 3) {
      if (
        Math.abs(geometry.positions[i] - point[0]) <= tolerance &&
        Math.abs(geometry.positions[i + 1] - point[1]) <= tolerance &&
        Math.abs(geometry.positions[i + 2] - point[2]) <= tolerance
      ) {
        return true;
      }
    }

    return false;
  });
}

function stats(): BuildStats {
  return {
    clonedLods: 0,
    decimatedLods: 0,
    filledHoles: 0,
    filledInstances: 0,
    generatedTxds: 0,
    mergedLods: 0,
    missingHd: 0,
    missingTxd: 0,
    parentTextures: 0,
    retransformedLods: 0,
    skippedHoles: 0,
    skippedShared: 0,
  };
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function triangleCount(bytes: Uint8Array): number {
  return parseDff(toBuffer(bytes)).geometries.reduce((sum, geometry) => sum + geometry.triangles.length, 0);
}

describe('cloneLodDff (multi-atomic HD — the real Burger Shot)', () => {
  describe('negative cases', () => {
    it('never leaves a multi-atomic HD as a verbatim byte-copy, even with decimation OFF', () => {
      const source = burger();

      const clone = cloneLodDff(source, LINK, null, NO_TEXTURES, stats(), true);

      expect(parseDff(toBuffer(source)).atomics).toHaveLength(2); // fixture sanity
      expect(clone).not.toBe(source);
      expect(parseDff(toBuffer(clone)).atomics).toHaveLength(1);
    });

    it('never leaves it verbatim when the pixel budget rejects every decimation target either', () => {
      const counters = stats();

      const clone = cloneLodDff(burger(), LINK, keepEverything, NO_TEXTURES, counters, true);

      expect(counters.decimatedLods).toBe(0);
      expect(counters.mergedLods).toBe(1);
      expect(parseDff(toBuffer(clone)).atomics).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('merges every atomic into the one geometry — no triangle of the building or the sign is lost', () => {
      const clone = cloneLodDff(burger(), LINK, keepEverything, NO_TEXTURES, stats(), true);

      expect(triangleCount(clone)).toBe(752 + 336);
    });

    it('bakes the child frame offset, so the sign stands where the animation rests it', () => {
      // The sign atomic's geometry is authored around ITS frame's origin; merged, its vertices must sit at the
      // frame offset — the SA loader would have dropped that frame and left the sign at the building's origin.
      const source = burger();
      const hd = parseDff(toBuffer(source));
      const sign = hd.atomics.find((atomic) => hd.frames[atomic.frameIndex].name === 'burger01_LAw3');
      const frame = hd.frames[sign!.frameIndex];
      const [x, y, z] = hd.geometries[sign!.geometryIndex].positions.subarray(0, 3);
      const r = frame.rotation;
      const placed = [
        r[0] * x + r[3] * y + r[6] * z + SIGN_OFFSET.x,
        r[1] * x + r[4] * y + r[7] * z + SIGN_OFFSET.y,
        r[2] * x + r[5] * y + r[8] * z + SIGN_OFFSET.z,
      ];

      expect(frame.position).toEqual([SIGN_OFFSET.x, SIGN_OFFSET.y, SIGN_OFFSET.z]); // fixture sanity

      const clone = cloneLodDff(source, LINK, keepEverything, NO_TEXTURES, stats(), true);

      expect(hasVertexNear(clone, placed)).toBe(true);
    });
  });
});
