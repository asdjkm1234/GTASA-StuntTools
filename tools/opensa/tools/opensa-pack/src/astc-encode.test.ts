import { packOstexPayload } from '@opensa/cell-weld/ostex-payload';
import {
  buildOspak,
  decodeOstex,
  encodeOstex,
  ospakRequiredFeatures,
  OstexAlphaClass,
  OstexFormat,
  ostexLayerBytes,
  ostexMaxMips,
  ostexMipLayout,
} from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { createAstcEncoder } from './astc-encode';

/**
 * The ASTC re-encode (plan 200/2-02), on synthetic layers — no game assets, so it runs in CI.
 *
 * What is only checkable here: the output declares the layout the uploader allocates against, the mip chain
 * is TRUNCATED at the 4x4 block floor rather than reinterpreted (RGBA8 mips run to 1x1 and ASTC's cannot),
 * the per-layer alpha classification survives the format change, and a BC source is refused instead of
 * quietly re-encoded.
 */

/** An RGBA8 `.ostex` of `layers` gradient layers, full mip chain, exactly as the planner emits one. */
function rgba8Array(width: number, height: number, layers: number): Uint8Array {
  const mipCount = ostexMaxMips(OstexFormat.RGBA8, width, height);
  const mips: { data: Uint8Array }[][] = [];
  for (let layer = 0; layer < layers; layer += 1) {
    const levels: { data: Uint8Array }[] = [];
    for (let level = 0; level < mipCount; level += 1) {
      const w = Math.max(1, width >> level);
      const h = Math.max(1, height >> level);
      const data = new Uint8Array(w * h * 4);
      for (let index = 0; index < w * h; index += 1) {
        data.set([(index * 7 + layer * 31) & 255, (index * 3) & 255, (index ^ layer) & 255, 255], index * 4);
      }
      levels.push({ data });
    }
    mips.push(levels);
  }

  return encodeOstex({
    format: OstexFormat.RGBA8,
    height,
    layers: Array.from({ length: layers }, (_, index) => ({
      alphaClass: index % 2 === 0 ? OstexAlphaClass.OPAQUE : OstexAlphaClass.CUTOUT,
      cutoutRef: index % 2 === 0 ? 0 : 128,
      nameHash: index + 1,
      wrap: 0,
    })),
    mipCount,
    payload: packOstexPayload(OstexFormat.RGBA8, width, height, mipCount, mips),
    premultiplied: true,
    width,
  });
}

describe('createAstcEncoder', () => {
  describe('negative cases', () => {
    it('refuses a BC source instead of re-encoding it', async () => {
      const bc1 = encodeOstex({
        format: OstexFormat.BC1,
        height: 8,
        layers: [{ alphaClass: OstexAlphaClass.OPAQUE, cutoutRef: 0, nameHash: 1, wrap: 0 }],
        mipCount: 1,
        payload: packOstexPayload(OstexFormat.BC1, 8, 8, 1, [[{ data: new Uint8Array(8 * 4) }]]),
        premultiplied: false,
        width: 8,
      });

      await expect(createAstcEncoder({ threads: 0 }).ostex(bc1)).rejects.toThrow(/RGBA8 source/);
    });
  });

  describe('positive cases', () => {
    it('writes the layout the runtime allocates against, at a quarter of RGBA8', async () => {
      const astc = decodeOstex(await createAstcEncoder({ threads: 0 }).ostex(rgba8Array(64, 64, 2)));

      expect(astc.format).toBe(OstexFormat.ASTC4x4);
      expect(astc.mipCount).toBe(5); // 64x64 down to 4x4
      // The payload is what `ostexLayerBytes` says it is — the same function `beginOstexUpload` sizes with.
      expect(astc.payload.byteLength).toBe(ostexLayerBytes(OstexFormat.ASTC4x4, 64, 64, 5) * 2);
      // Mip 0 at 64x64 needs no row padding in either format, so this is the format ratio itself: 1 B/texel
      // against RGBA8's 4, which is the whole case for the chain.
      expect(ostexMipLayout(OstexFormat.ASTC4x4, 64, 64, 0).totalBytes).toBe(64 * 64);
      expect(ostexMipLayout(OstexFormat.RGBA8, 64, 64, 0).totalBytes).toBe(4 * 64 * 64);
    });

    it('truncates the chain at the 4x4 block floor rather than reinterpreting RGBA8 levels', async () => {
      const source = decodeOstex(rgba8Array(32, 32, 1));
      const astc = decodeOstex(await createAstcEncoder({ threads: 0 }).ostex(rgba8Array(32, 32, 1)));

      expect(source.mipCount).toBe(6); // RGBA8 runs to 1x1
      expect(astc.mipCount).toBe(4); // ASTC stops at 4x4
    });

    it('carries the alpha classification and the premultiplied flag through unchanged', async () => {
      const astc = decodeOstex(await createAstcEncoder({ threads: 0 }).ostex(rgba8Array(16, 16, 3)));

      expect(astc.premultiplied).toBe(true);
      expect(astc.layers.map((layer) => layer.alphaClass)).toEqual([
        OstexAlphaClass.OPAQUE,
        OstexAlphaClass.CUTOUT,
        OstexAlphaClass.OPAQUE,
      ]);
      expect(astc.layers.map((layer) => layer.cutoutRef)).toEqual([0, 128, 0]);
      expect(astc.layers.map((layer) => layer.nameHash)).toEqual([1, 2, 3]);
    });

    it('lands in a pak that DEMANDS ASTC — the manifest is what the runtime gates on', async () => {
      const bytes = await createAstcEncoder({ threads: 0 }).ostex(rgba8Array(16, 16, 1));
      const { manifest } = buildOspak([
        {
          bytes,
          key: 'array-0',
          kind: 'texture',
          meta: { format: OstexFormat.ASTC4x4, height: 16, layers: 1, width: 16 },
        },
      ]);

      // The demand is read off the manifest's entry META, not the `.ostex` header — so a build that re-encoded
      // the payload and left the meta saying RGBA8 would ship a world the device silently accepts and cannot
      // draw. Both halves are written together in `convertDistrict`; this is the half that is checkable.
      expect(ospakRequiredFeatures(manifest)).toEqual(['texture-compression-astc']);
    });

    it('encodes the same bytes with a CAPPED worker pool — the phone knob may not change the output', async () => {
      // `threads` exists because one-per-core (the default) OOMs the target device: every astcenc worker is
      // a V8 isolate reserving its own code range. A knob that also changed the pak would make the phone's
      // build a different build, so this pins that it does not.
      const source = rgba8Array(16, 16, 2);
      const wide = await createAstcEncoder({ threads: 0 }).ostex(source);
      const capped = await createAstcEncoder({ threads: 1 }).ostex(source);

      expect(Array.from(capped)).toEqual(Array.from(wide));
    });

    it('reports what the stage cost, so a build can log it', async () => {
      const encoder = createAstcEncoder({ threads: 0 });
      await encoder.ostex(rgba8Array(16, 16, 2));

      expect(encoder.stats.texels).toBe(2 * (256 + 64 + 16));
      expect(encoder.stats.ms).toBeGreaterThanOrEqual(0);
    });
  });
});
