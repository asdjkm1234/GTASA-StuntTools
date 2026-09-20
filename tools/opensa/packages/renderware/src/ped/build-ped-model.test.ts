import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RWClump } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildPedModel, pedClip, rootMotion, sampleRootMotion } from './build-ped-model';

/** Real stock peds, extracted by `npm run test:fixtures` — the same pair the skinning tests use. */
const BMYPOL1_DFF = 'fixtures/original/character/bmypol1.dff';
const BMYPOL1_TXD = 'fixtures/original/character/bmypol1.txd';
const ARMY_DFF = 'fixtures/original/character/army.dff';

const read = (path: string): ArrayBuffer => toArrayBuffer(new Uint8Array(readFileSync(path)));

describe('buildPedModel', () => {
  describe('negative cases', () => {
    it('returns null for a clump with no skin (it is not a character)', () => {
      const clump: RWClump = {
        atomics: [],
        frames: [],
        geometries: [
          { flags: 0, lights: [], materials: [], positions: new Float32Array(), triangles: [], uvLayers: [] },
        ],
      } as unknown as RWClump;

      expect(buildPedModel(clump, [])).toBeNull();
    });
  });

  describe.skipIf(!existsSync(BMYPOL1_DFF))('positive cases (real bmypol1)', () => {
    const clump = parseDff(read(BMYPOL1_DFF));
    const txds = existsSync(BMYPOL1_TXD) ? [read(BMYPOL1_TXD)] : [];

    it('builds the standard 32-bone SA biped with one weight set per vertex', () => {
      const model = buildPedModel(clump, txds)!;

      expect(model.bones).toHaveLength(32);
      expect(model.joints).toHaveLength((model.positions.length / 3) * 4);
      expect(model.weights).toHaveLength((model.positions.length / 3) * 4);
      expect(model.indices.length % 3).toBe(0);
    });

    it('quantizes every vertex’s four weights to exactly 255', () => {
      const { weights } = buildPedModel(clump, txds)!;

      for (let vertex = 0; vertex < weights.length / 4; vertex += 1) {
        const at = vertex * 4;
        expect(weights[at] + weights[at + 1] + weights[at + 2] + weights[at + 3]).toBe(255);
      }
    });

    it('keeps the skin plugin’s inverse binds (valid homogeneous bottom row)', () => {
      const { bones } = buildPedModel(clump, txds)!;

      expect(bones.every((bone) => bone.inverseBind[15] === 1)).toBe(true);
      expect(bones.every((bone) => bone.inverseBind[3] === 0)).toBe(true);
    });

    it('measures the feet BELOW the origin on the posed mesh', () => {
      // The SA bind mesh lies along X; minZ is only meaningful once the skeleton stands it up.
      const { minZ } = buildPedModel(clump, txds)!;

      expect(minZ).toBeLessThan(0);
      expect(minZ).toBeGreaterThan(-2);
    });

    it.skipIf(!existsSync(BMYPOL1_TXD))('decodes the referenced textures to RGBA8', () => {
      const { textures } = buildPedModel(clump, txds)!;

      expect(textures.length).toBeGreaterThan(0);
      for (const texture of textures) {
        expect(texture.rgba).toHaveLength(texture.width * texture.height * 4);
      }
    });
  });

  describe.skipIf(!existsSync(ARMY_DFF))('positive cases (real army — HAnim ≠ frame order)', () => {
    const clump = parseDff(read(ARMY_DFF));

    it('orders bones by the HAnim hierarchy, not the frame order', () => {
      const { bones } = buildPedModel(clump, [])!;

      expect(bones.slice(0, 4).map((bone) => bone.name)).toEqual(['Root', 'Pelvis', 'Spine', 'Spine1']);
    });

    it('parents every non-root bone to an earlier bone (the sampler walks the array once)', () => {
      const { bones } = buildPedModel(clump, [])!;

      expect(bones[0].parent).toBe(-1);
      bones.forEach((bone, index) => expect(bone.parent).toBeLessThan(index));
    });
  });
});

describe('pedClip', () => {
  const bones = [
    { bindPosition: [0, 0, 0], bindRotation: [0, 0, 0, 1], boneId: 1, inverseBind: [], name: 'Root', parent: -1 },
    { bindPosition: [0, 0, 0], bindRotation: [0, 0, 0, 1], boneId: 7, inverseBind: [], name: 'Spine', parent: 0 },
  ] as unknown as Parameters<typeof pedClip>[1];

  describe('negative cases', () => {
    it('leaves a bone with no matching track empty (it holds the bind pose)', () => {
      const clip = pedClip({ bones: [], name: 'empty' }, bones);

      expect(clip.tracks).toHaveLength(2);
      expect(clip.tracks.every((track) => track.times.length === 0)).toBe(true);
      expect(clip.duration).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('matches tracks by bone id and converts ANP3 times to seconds', () => {
      const clip = pedClip(
        {
          bones: [
            {
              boneId: 7,
              frames: [
                { rotation: [0, 0, 0, 1], time: 0 },
                { rotation: [0, 0, 1, 0], time: 60 },
              ],
              name: 'x',
            },
          ],
          name: 'walk',
        } as never,
        bones,
      );

      expect(clip.tracks[0].times).toHaveLength(0); // Root has no track
      expect(clip.tracks[1].times).toEqual([0, 1]); // 60 units = 1 second
      expect(clip.tracks[1].quats).toHaveLength(8);
      expect(clip.duration).toBe(1);
    });

    it('falls back to the trimmed bone NAME when ids do not match', () => {
      const clip = pedClip(
        {
          bones: [{ boneId: 999, frames: [{ rotation: [0, 0, 0, 1], time: 30 }], name: ' spine ' }],
          name: 'n',
        } as never,
        bones,
      );

      expect(clip.tracks[1].times).toEqual([0.5]);
    });
  });
});

/** Synthetic ANP3 animation shells for the root-motion extractor (times raw i16, /60 to seconds). */
describe('rootMotion (plan 088/09a)', () => {
  describe('negative cases', () => {
    it('returns null when no bone track carries translation (a plain locomotion clip)', () => {
      const animation = {
        bones: [
          {
            boneId: 0,
            frames: [{ rotation: [0, 0, 0, 1] as [number, number, number, number], time: 0 }],
            name: 'Root',
          },
        ],
        name: 'walk_civi',
      };
      expect(rootMotion(animation)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('extracts the translated track with times scaled to seconds', () => {
      const animation = {
        bones: [
          {
            boneId: 1,
            frames: [{ rotation: [0, 0, 0, 1] as [number, number, number, number], time: 0 }],
            name: 'Pelvis',
          },
          {
            boneId: 0,
            frames: [
              {
                rotation: [0, 0, 0, 1] as [number, number, number, number],
                time: 0,
                translation: [0, 0, 0] as [number, number, number],
              },
              {
                rotation: [0, 0, 0, 1] as [number, number, number, number],
                time: 60,
                translation: [1, 0.5, -0.4] as [number, number, number],
              },
            ],
            name: 'Root',
          },
        ],
        name: 'car_getin_lhs',
      };
      const track = rootMotion(animation);
      expect(track).not.toBeNull();
      expect(track?.duration).toBeCloseTo(1, 6);
      expect(track?.positions).toEqual([0, 0, 0, 1, 0.5, -0.4]);
    });
  });
});

describe('sampleRootMotion', () => {
  const TRACK = { duration: 1, positions: [0, 0, 0, 1, 0.5, -0.4], times: [0, 1] };

  describe('negative cases', () => {
    it('clamps before the first and past the last keyframe', () => {
      expect(sampleRootMotion(TRACK, -1)).toEqual([0, 0, 0]);
      expect(sampleRootMotion(TRACK, 9)).toEqual([1, 0.5, -0.4]);
    });
  });

  describe('positive cases', () => {
    it('interpolates linearly between the bracketing keyframes', () => {
      const mid = sampleRootMotion(TRACK, 0.5);
      expect(mid[0]).toBeCloseTo(0.5, 6);
      expect(mid[1]).toBeCloseTo(0.25, 6);
      expect(mid[2]).toBeCloseTo(-0.2, 6);
    });
  });
});
