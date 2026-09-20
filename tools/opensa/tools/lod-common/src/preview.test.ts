import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';
import type { PreviewCamera, PreviewOptions } from './preview';

import { previewDiff, renderMeshPreview } from './preview';

/** A single triangle in the XY plane at z=0 with the given winding and uniform prelit. */
function plate(flip = false, prelit = 255): MergedMesh {
  const indices = flip ? [0, 2, 1] : [0, 1, 2];

  return {
    colors: new Uint8Array(12).fill(prelit),
    groups: [{ indices: Uint32Array.from(indices), texture: 'a' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([-10, -10, 0, 10, -10, 0, -10, 10, 0]),
    uvs: new Float32Array(6),
  };
}

/** Camera 50 units above the origin looking straight down. */
const TOP: PreviewCamera = { fovYDeg: 60, position: [0, 0, 50], target: [0, 0, 0] };
const OPTS: PreviewOptions = { cull: 'back', height: 32, width: 32 };

const coveredPixels = (image: { rgba: Uint8Array }): number => {
  let covered = 0;
  for (let i = 3; i < image.rgba.length; i += 4) {
    if (image.rgba[i] !== 0) {
      covered += 1;
    }
  }

  return covered;
};

describe('renderMeshPreview / previewDiff', () => {
  describe('negative cases', () => {
    it('culls a back-facing triangle under cull: back (and diff against no-cull flags it)', () => {
      const culled = renderMeshPreview(plate(true), TOP, OPTS);
      const twoSided = renderMeshPreview(plate(true), TOP, { ...OPTS, cull: 'none' });

      expect(coveredPixels(culled)).toBe(0);
      expect(coveredPixels(twoSided)).toBeGreaterThan(50);
      expect(previewDiff(culled, twoSided)).toBe(1); // pure coverage mismatch
    });

    it('diff of an empty scene is 0', () => {
      const empty: MergedMesh = { ...plate(), groups: [] };
      const image = renderMeshPreview(empty, TOP, OPTS);

      expect(previewDiff(image, image)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('renders a front-facing triangle and identical renders diff to 0', () => {
      const first = renderMeshPreview(plate(), TOP, OPTS);
      const second = renderMeshPreview(plate(), TOP, OPTS);

      expect(coveredPixels(first)).toBeGreaterThan(50);
      expect(previewDiff(first, second)).toBe(0);
    });

    it('shades pixels by vertex prelit × group mean colour', () => {
      const image = renderMeshPreview(plate(false, 128), TOP, {
        ...OPTS,
        groupColor: () => [200, 100, 50],
      });
      const centre = (16 * 32 + 12) * 4; // a pixel inside the triangle

      expect(image.rgba[centre + 3]).toBe(255);
      expect(image.rgba[centre]).toBeCloseTo(100, -1); // 200 × 128/255
      expect(image.rgba[centre + 1]).toBeCloseTo(50, -1);
    });

    it('nearer geometry wins the z-buffer', () => {
      const two: MergedMesh = {
        colors: Uint8Array.from([...new Array<number>(12).fill(255), ...new Array<number>(12).fill(0)]),
        groups: [
          { indices: Uint32Array.of(0, 1, 2), texture: 'far' },
          { indices: Uint32Array.of(3, 4, 5), texture: 'near' },
        ],
        normals: new Float32Array(18),
        positions: Float32Array.from([-10, -10, 0, 10, -10, 0, -10, 10, 0, -10, -10, 5, 10, -10, 5, -10, 10, 5]),
        uvs: new Float32Array(12),
      };
      const image = renderMeshPreview(two, TOP, OPTS);
      const centre = (16 * 32 + 12) * 4;

      expect(image.rgba[centre]).toBe(0); // the black (prelit 0) nearer plate covers the white one
    });

    it('screendoor dither covers roughly the opaque-coverage fraction', () => {
      const solid = coveredPixels(renderMeshPreview(plate(), TOP, OPTS));
      const half = coveredPixels(renderMeshPreview(plate(), TOP, { ...OPTS, groupCoverage: () => 0.5 }));

      expect(half / solid).toBeGreaterThan(0.35);
      expect(half / solid).toBeLessThan(0.65);
    });
  });
});
