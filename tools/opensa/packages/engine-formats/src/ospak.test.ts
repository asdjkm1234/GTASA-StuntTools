import { describe, expect, it } from 'vitest';

import { buildOspak, OSPAK_ALIGN, type OspakInput, ospakRequiredFeatures, validateOspakManifest } from './ospak';
import { OstexFormat } from './ostex';

function inputs(): OspakInput[] {
  return [
    { bytes: new Uint8Array([1, 2, 3]), key: '54,-32,hd', kind: 'cell' },
    { bytes: new Uint8Array(5000).fill(9), key: '54,-32,lod', kind: 'cell' },
    {
      bytes: new Uint8Array([7, 7]),
      key: 'array-0',
      kind: 'texture',
      meta: { format: 1, height: 256, layers: 12, width: 256 },
    },
  ];
}

describe('ospak', () => {
  describe('negative cases', () => {
    it('throws on duplicate keys', () => {
      const doubled = [...inputs(), { bytes: new Uint8Array([4]), key: '54,-32,hd', kind: 'cell' as const }];

      expect(() => buildOspak(doubled)).toThrow(/duplicate cell key/);
    });

    it('REFUSES collision entries whose grid nobody stated', () => {
      // 250 and 256 both "work" here and one of them is silently wrong -- a reader that assumes the render
      // grid gets the WRONG cell's colliders, and the symptom is a player falling through the world.
      const withCollision: OspakInput[] = [
        ...inputs(),
        { bytes: new Uint8Array([1]), key: '5,-7', kind: 'collision' as const },
      ];

      expect(() => buildOspak(withCollision)).toThrow(/collisionCellSize/);
      expect(() => buildOspak(withCollision, { collisionCellSize: 256 })).not.toThrow();
    });

    it('validate rejects a manifest carrying collision without its grid', () => {
      const { manifest } = buildOspak(inputs());

      expect(() =>
        validateOspakManifest({ ...manifest, collision: { '5,-7': { hash: 0, length: 1, offset: 0 } } }),
      ).toThrow(/collisionCellSize/);
    });

    it('throws on a duplicate collision key', () => {
      const doubled: OspakInput[] = [
        { bytes: new Uint8Array([1]), key: '5,-7', kind: 'collision' as const },
        { bytes: new Uint8Array([2]), key: '5,-7', kind: 'collision' as const },
      ];

      expect(() => buildOspak(doubled, { collisionCellSize: 256 })).toThrow(/duplicate collision key/);
    });

    it('throws on a texture entry without meta', () => {
      expect(() => buildOspak([{ bytes: new Uint8Array([1]), key: 'array-1', kind: 'texture' }])).toThrow(
        /missing meta/,
      );
    });

    it('validate rejects a version mismatch and an overrunning range', () => {
      const { manifest } = buildOspak(inputs());

      expect(() => validateOspakManifest({ ...manifest, version: 99 })).toThrow(/unsupported/);
      const broken = structuredClone(manifest);
      broken.cells['54,-32,hd'] = { ...broken.cells['54,-32,hd'], length: broken.byteLength + 1 };
      expect(() => validateOspakManifest(broken)).toThrow(/overruns/);
    });
  });

  describe('positive cases', () => {
    it('aligns every entry to 4 KiB and preserves payload bytes at the recorded offsets', () => {
      const { manifest, pak } = buildOspak(inputs());

      validateOspakManifest(manifest);
      for (const entry of [...Object.values(manifest.cells), ...Object.values(manifest.textures)]) {
        expect(entry.offset % OSPAK_ALIGN).toBe(0);
      }
      const hd = manifest.cells['54,-32,hd'];
      expect([...pak.subarray(hd.offset, hd.offset + hd.length)]).toEqual([1, 2, 3]);
      const lod = manifest.cells['54,-32,lod'];
      expect(pak[lod.offset]).toBe(9);
      expect(lod.length).toBe(5000);
    });

    it('is deterministic regardless of input order (sorted by key)', () => {
      const a = buildOspak(inputs());
      const b = buildOspak([...inputs()].reverse());

      expect([...a.pak]).toEqual([...b.pak]);
      expect(a.manifest).toEqual(b.manifest);
    });

    it('carries a cell geometry aabb into the manifest, and omits the key when absent (plan 087)', () => {
      const aabb: [number, number, number, number] = [1322, 1707, 1266, 1731];
      const withAabb = [...inputs()];
      withAabb[0] = { ...withAabb[0], aabb };
      const { manifest } = buildOspak(withAabb);

      expect(manifest.cells['54,-32,hd'].aabb).toEqual(aabb);
      expect(manifest.cells['54,-32,lod']).not.toHaveProperty('aabb');
    });

    it('carries the vertical extent and the screen-error pair, omitting each when absent (plan 201/1-05)', () => {
      const withResidency = [...inputs()];
      withResidency[0] = { ...withResidency[0], aabbY: [-3, 41], geometricError: 0 };
      withResidency[1] = { ...withResidency[1], geometricError: 0.6415 };
      const { manifest } = buildOspak(withResidency, { lodPixelThreshold: 2 });

      expect(manifest.cells['54,-32,hd'].aabbY).toEqual([-3, 41]);
      expect(manifest.cells['54,-32,hd'].geometricError).toBe(0);
      expect(manifest.cells['54,-32,lod'].geometricError).toBeCloseTo(0.6415, 4);
      expect(manifest.cells['54,-32,lod']).not.toHaveProperty('aabbY');
      expect(manifest.lodPixelThreshold).toBe(2);
    });

    it('omits the screen-error budget for a pak the bake never stated one to', () => {
      expect(buildOspak(inputs()).manifest).not.toHaveProperty('lodPixelThreshold');
    });

    it('keys collision on the GAME grid, apart from the render cells', () => {
      const withCollision: OspakInput[] = [
        ...inputs(),
        { bytes: new Uint8Array([1, 2]), key: '5,-7', kind: 'collision' as const },
      ];

      const { manifest } = buildOspak(withCollision, { collisionCellSize: 256 });

      expect(manifest.collisionCellSize).toBe(256);
      expect(manifest.cellSize).toBe(250);
      expect(Object.keys(manifest.collision ?? {})).toEqual(['5,-7']);
      expect(Object.keys(manifest.cells)).not.toContain('5,-7');
      expect(() => validateOspakManifest(manifest)).not.toThrow();
    });

    it('omits the collision keys entirely for a pak built without the bake', () => {
      const { manifest } = buildOspak(inputs());

      expect(manifest).not.toHaveProperty('collision');
      expect(manifest).not.toHaveProperty('collisionCellSize');
    });

    it('carries texture meta into the manifest for the scheduler', () => {
      const { manifest } = buildOspak(inputs());

      expect(manifest.textures['array-0']).toMatchObject({ format: 1, height: 256, layers: 12, width: 256 });
    });

    it('carries UV-scroll animations into the manifest, and omits the key when there are none (B7·c)', () => {
      const animations = [{ duration: 3, keyframes: [{ time: 0, uv: [0, 1, 1, 0, 0, 0] }], name: 'DolSign' }];

      expect(buildOspak(inputs(), { uvAnimations: animations }).manifest.uvAnimations).toEqual(animations);
      expect(buildOspak(inputs(), { uvAnimations: [] }).manifest).not.toHaveProperty('uvAnimations');
      expect(buildOspak(inputs()).manifest).not.toHaveProperty('uvAnimations');
    });

    it('derives the BC demand from the texture formats the converter chose', () => {
      // The fixture's array is BC3 — a pak built from SA assets, i.e. a desktop-only world.
      expect(ospakRequiredFeatures(buildOspak(inputs()).manifest)).toEqual(['texture-compression-bc']);
    });

    it('demands nothing of an RGBA8 world, so it uploads on a mobile GPU', () => {
      const rgba8 = inputs().map((input) =>
        input.kind === 'texture' ? { ...input, meta: { ...input.meta!, format: OstexFormat.RGBA8 } } : input,
      );

      expect(ospakRequiredFeatures(buildOspak(rgba8).manifest)).toEqual([]);
    });

    it('reports the demand once for a world mixing BC formats with RGBA8', () => {
      const mixed: OspakInput[] = [
        ...inputs(),
        {
          bytes: new Uint8Array([8]),
          key: 'array-1',
          kind: 'texture',
          meta: { format: OstexFormat.BC1, height: 64, layers: 2, width: 64 },
        },
        {
          bytes: new Uint8Array([9]),
          key: 'array-2',
          kind: 'texture',
          meta: { format: OstexFormat.RGBA8, height: 4, layers: 1, width: 4 },
        },
      ];

      expect(ospakRequiredFeatures(buildOspak(mixed).manifest)).toEqual(['texture-compression-bc']);
    });

    it('carries missing-texture stand-in layers into the manifest, and omits the key when the map resolved (085)', () => {
      const missing = [{ array: 3, color: [92, 92, 87, 255] as [number, number, number, number], layer: 1 }];

      expect(buildOspak(inputs(), { missingLayers: missing }).manifest.missingLayers).toEqual(missing);
      expect(buildOspak(inputs(), { missingLayers: [] }).manifest).not.toHaveProperty('missingLayers');
      expect(buildOspak(inputs()).manifest).not.toHaveProperty('missingLayers');
    });
  });
});
