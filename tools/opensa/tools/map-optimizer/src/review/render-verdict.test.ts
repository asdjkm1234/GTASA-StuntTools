import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { describe, expect, it } from 'vitest';

import { renderVerdictThumbnails } from './render-verdict';

/** Mean luma over the covered pixels of a preview image. */
function coveredLuma(image: { rgba: Uint8Array }): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < image.rgba.length; i += 4) {
    if (image.rgba[i + 3] !== 0) {
      sum += (image.rgba[i] + image.rgba[i + 1] + image.rgba[i + 2]) / 3;
      count += 1;
    }
  }

  return count === 0 ? 0 : sum / count;
}

/** A single-quad clump facing the review camera's upper diagonal, with uniform prelit (+ optional night). */
function quadClump(luma: number, night?: number): RWClump {
  const vertexCount = 4;
  const rgba = (value: number): Uint8Array => {
    const out = new Uint8Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = value;
      out[i * 4 + 3] = 255;
    }

    return out;
  };

  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [
      {
        materials: [{ texture: { name: 'wall' } }],
        nightColors: night === undefined ? null : rgba(night),
        // A vertical quad spanning x/z — visible from the framing camera's diagonal.
        positions: new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]),
        prelitColors: rgba(luma),
        triangles: [
          { a: 0, b: 1, c: 2, materialIndex: 0 },
          { a: 0, b: 2, c: 3, materialIndex: 0 },
        ],
        uvLayers: [],
      },
    ],
  } as unknown as RWClump;
}

describe('renderVerdictThumbnails', () => {
  describe('negative cases', () => {
    it('returns null night images when the model has no night set and the verdict adds none', () => {
      const thumbs = renderVerdictThumbnails(quadClump(100), { flat: false }, 32);

      expect(thumbs.nightBefore).toBeNull();
      expect(thumbs.nightAfter).toBeNull();
    });

    it('leaves the day image unchanged when the verdict has no level correction', () => {
      const thumbs = renderVerdictThumbnails(quadClump(100), { flat: false }, 32);

      expect(thumbs.dayAfter).toEqual(thumbs.dayBefore);
    });
  });

  describe('positive cases', () => {
    it('renders the quad and applies a day lift to the after image only', () => {
      const thumbs = renderVerdictThumbnails(
        quadClump(80),
        { flat: false, level: { protectFrom: 255, protectTo: 255, shift: 40 } },
        32,
      );

      expect(coveredLuma(thumbs.dayBefore)).toBeCloseTo(80, 0);
      expect(coveredLuma(thumbs.dayAfter)).toBeCloseTo(120, 0);
    });

    it('scales an existing night set on the after side only', () => {
      const thumbs = renderVerdictThumbnails(
        quadClump(80, 100),
        { flat: false, night: { kind: 'repair', protectFrom: 255, protectTo: 255, scale: 0.5 } },
        32,
      );

      expect(coveredLuma(thumbs.nightBefore!)).toBeCloseTo(100, 0);
      expect(coveredLuma(thumbs.nightAfter!)).toBeCloseTo(50, 0);
    });

    it('synthesizes the after night image from the corrected day at the given ratio', () => {
      const thumbs = renderVerdictThumbnails(
        quadClump(100),
        { flat: false, night: { kind: 'synthesize', ratio: 0.3 } },
        32,
      );

      expect(thumbs.nightBefore).toBeNull();
      expect(coveredLuma(thumbs.nightAfter!)).toBeCloseTo(30, 0);
    });
  });
});
