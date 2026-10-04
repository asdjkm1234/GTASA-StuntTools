import { describe, expect, it } from 'vitest';

import type { RWMaterial } from '../parsers/binary/types';

import { regionHasTransparency, VehicleTextures } from './textures';

/** No TXDs at all — every lookup misses, which is the interesting boundary. */
function empty(): VehicleTextures {
  return new VehicleTextures([]);
}

function material(name: null | string): RWMaterial {
  return {
    color: [255, 255, 255, 255],
    texture: name === null ? null : ({ name } as RWMaterial['texture']),
    textured: name !== null,
  };
}

describe('VehicleTextures', () => {
  describe('negative cases', () => {
    it('an untextured material resolves to the built-in white layer (the paint carries the colour)', () => {
      const textures = empty();

      expect(textures.resolve(material(null))).toBe(0);
      expect(textures.pack().names[0]).toBe('white');
    });

    it('a material whose texture is missing does not blow up the array', () => {
      const textures = empty();

      const layer = textures.resolve(material('nosuchtexture'));
      const packed = textures.pack();

      expect(packed.names[layer]).toBe('nosuchtexture');
      expect(packed.rgba.byteLength).toBe(packed.layers * packed.width * packed.height * 4);
    });

    it('a material with no lamp twin reports layer 0 — the "none" sentinel', () => {
      // Layer 0 is always claimed by the first body material, so it can never itself BE a twin.
      expect(empty().resolveNightTwin(material('vehiclegeneric256'))).toBe(0);
      expect(empty().resolveNightTwin(material('vehiclelightson128'))).toBe(0); // already the lit one
    });

    it('a texture the TXD never carried has no alpha to speak of', () => {
      expect(empty().hasAlpha(material('vehiclescratch64'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('resolving the same texture twice reuses its layer', () => {
      const textures = empty();

      expect(textures.resolve(material('body'))).toBe(0);
      expect(textures.resolve(material('body'))).toBe(0);
      expect(textures.resolve(material('glass'))).toBe(1);
      expect(textures.pack().layers).toBe(2);
    });

    it('every layer is packed at the SAME size (a texture array demands it)', () => {
      const textures = empty();
      textures.resolve(material('a'));
      textures.resolve(material('b'));

      const packed = textures.pack();

      expect(packed.rgba.byteLength).toBe(2 * packed.width * packed.height * 4);
    });
  });
});

describe('regionHasTransparency', () => {
  /** An 8×8 texture whose LEFT half is transparent (alpha 0) and right half opaque — the atlas shape. */
  function halfAlphaTexture(): Uint8Array {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        rgba.set([128, 128, 128, x < 4 ? 0 : 255], (y * 8 + x) * 4);
      }
    }

    return rgba;
  }

  function triangle(): [{ a: number; b: number; c: number; materialIndex: number }] {
    return [{ a: 0, b: 1, c: 2, materialIndex: 0 }];
  }

  describe('negative cases', () => {
    it('a region that samples only opaque texels reports no transparency, whatever the rest of the atlas holds', () => {
      // The comet's parcel shelf: mapped onto the opaque half of a lamp atlas. The whole-texture answer
      // sent it into the no-depth blend phase and the world showed through it.
      const uvs = new Float32Array([0.55, 0.05, 0.95, 0.05, 0.95, 0.95]);

      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, uvs, triangle(), 250)).toBe(false);
    });

    it('a degenerate (zero-area) triangle samples nothing', () => {
      const uvs = new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);

      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, uvs, triangle(), 250)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('a region over the transparent half reports transparency', () => {
      const uvs = new Float32Array([0.05, 0.05, 0.45, 0.05, 0.45, 0.95]);

      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, uvs, triangle(), 250)).toBe(true);
    });

    it('UVs outside [0, 1] wrap (SA vehicle UVs address atlas quadrants that way)', () => {
      // 1.55..1.95 wraps onto 0.55..0.95 — the opaque half; 2.05..2.45 onto the transparent one.
      const opaque = new Float32Array([1.55, 1.05, 1.95, 1.05, 1.95, 1.95]);
      const transparent = new Float32Array([2.05, 2.05, 2.45, 2.05, 2.45, 2.95]);

      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, opaque, triangle(), 250)).toBe(false);
      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, transparent, triangle(), 250)).toBe(true);
    });

    it('a triangle tiling a full period takes the whole-texture answer instead of rasterising the tiling', () => {
      const uvs = new Float32Array([0, 0, 10, 0, 10, 10]);

      expect(regionHasTransparency(halfAlphaTexture(), 8, 8, uvs, triangle(), 250)).toBe(true);
    });
  });
});

describe('VehicleTextures.packBuckets', () => {
  describe('negative cases', () => {
    it('an empty dictionary still yields the white stand-in bucket, like pack()', () => {
      const { arrays, slots } = empty().packBuckets();

      expect(arrays.length).toBe(1);
      expect(arrays[0].names).toEqual(['white']);
      expect(slots).toEqual([{ array: 0, layer: 0 }]);
    });
  });

  describe('positive cases', () => {
    it('same-size layers land in one bucket with builder order preserved', () => {
      const textures = empty();
      textures.resolve(material('body'));
      textures.resolve(material('glass'));

      const { arrays, slots } = textures.packBuckets();

      // Both misses decode as the 4×4 white stand-in — one size, one bucket, layers as the builder
      // numbered them, so `meta.x` needs no remap in this shape.
      expect(arrays.length).toBe(1);
      expect(arrays[0].names).toEqual(['body', 'glass']);
      expect(arrays[0].rgba.byteLength).toBe(2 * arrays[0].width * arrays[0].height * 4);
      expect(slots).toEqual([
        { array: 0, layer: 0 },
        { array: 0, layer: 1 },
      ]);
    });
  });
});
