import type { OspakManifest } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { CameraState } from '../engine';

import { ResidencyGate, verticalExtents } from './residency';

function manifest(cells: OspakManifest['cells']): OspakManifest {
  return { byteLength: 4096, cells, cellSize: 250, textures: {}, version: 1 };
}

/** A map-shaped camera: 400 u up, looking north-west-ish down the −Z axis, 60° vertical FOV, 800 px tall. */
function view(overrides: Partial<CameraState> = {}, pixelHeight = 800): { camera: CameraState; pixelHeight: number } {
  return {
    camera: {
      aspect: 1.6,
      eye: [0, 400, 400],
      far: 5000,
      fovYRad: Math.PI / 3,
      near: 0.1,
      target: [0, 0, 0],
      up: [0, 1, 0],
      ...overrides,
    },
    pixelHeight,
  };
}

describe('ResidencyGate', () => {
  describe('negative cases', () => {
    it('does not see a box behind the eye', () => {
      const gate = new ResidencyGate(view());

      expect(gate.sees([-100, 100, 1200, 1400], 0, 40, 0)).toBe(false);
    });

    it('does not see a box past the far plane', () => {
      const gate = new ResidencyGate(view());

      expect(gate.sees([-100, 100, -6000, -5800], 0, 40, 0)).toBe(false);
    });

    it('does not see a box far off to the side', () => {
      const gate = new ResidencyGate(view());

      expect(gate.sees([4000, 4200, -400, -200], 0, 40, 0)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('sees the ground the camera is aimed at', () => {
      const gate = new ResidencyGate(view());

      expect(gate.sees([-125, 125, -125, 125], 0, 40, 0)).toBe(true);
    });

    it('sees a box the margin reaches, which the same box without one misses', () => {
      const gate = new ResidencyGate(view());
      const behind: [number, number, number, number] = [-100, 100, 405, 500];

      expect(gate.sees(behind, 0, 40, 0)).toBe(false);
      expect(gate.sees(behind, 0, 40, 250)).toBe(true);
    });

    it('measures distance to the closest point of the box, not to its centre', () => {
      const gate = new ResidencyGate(view());

      // Eye (0, 400, 400); the box's closest point is (0, 400, 200) → 200 away.
      expect(gate.distanceToBox([-100, 100, -200, 200], 400, 500)).toBeCloseTo(200, 6);
    });

    it('halves the screen error when the distance doubles (perspective)', () => {
      const gate = new ResidencyGate(view());

      expect(gate.screenError(10, 500)).toBeCloseTo(gate.screenError(10, 1000) * 2, 6);
    });

    it('reads the same error at every distance in the plan view', () => {
      const gate = new ResidencyGate(view({ orthoHalfHeight: 600 }));

      // ortho: 1200 world units across 800 px = 1.5 u/px, so a 10 u error is 6.67 px wherever it sits.
      expect(gate.screenError(10, 100)).toBeCloseTo(10 / 1.5, 6);
      expect(gate.screenError(10, 4000)).toBeCloseTo(10 / 1.5, 6);
    });

    it('shrinks the error by the back-off in both projections', () => {
      const perspective = new ResidencyGate(view());
      const plan = new ResidencyGate(view({ orthoHalfHeight: 600 }));

      expect(perspective.screenError(10, 500, 60)).toBeLessThan(perspective.screenError(10, 500));
      expect(plan.screenError(10, 500, 60)).toBeLessThan(plan.screenError(10, 500));
    });

    it('resolves more error on a taller drawing buffer — the same world, a phone at DPR 3', () => {
      const short = new ResidencyGate(view({}, 800));
      const tall = new ResidencyGate(view({}, 2400));

      expect(tall.screenError(10, 500)).toBeCloseTo(short.screenError(10, 500) * 3, 6);
    });
  });
});

describe('verticalExtents', () => {
  describe('negative cases', () => {
    it('answers null when one entry states no height — the gate is all-or-nothing per pak', () => {
      const extents = verticalExtents(
        manifest({
          '0,0,hd': { aabbY: [0, 40], hash: 0, length: 4, offset: 0 },
          '0,0,lod': { hash: 0, length: 4, offset: 0 },
        }),
      );

      expect(extents).toBeNull();
    });

    it('answers null for a pak with no cells at all', () => {
      expect(verticalExtents(manifest({}))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('collects every entry when all of them state one', () => {
      const extents = verticalExtents(
        manifest({
          '0,0,hd': { aabbY: [0, 40], hash: 0, length: 4, offset: 0 },
          '0,0,lod': { aabbY: [-2, 31], hash: 0, length: 4, offset: 0 },
        }),
      );

      expect(extents?.get('0,0,hd')).toEqual([0, 40]);
      expect(extents?.get('0,0,lod')).toEqual([-2, 31]);
    });
  });
});
