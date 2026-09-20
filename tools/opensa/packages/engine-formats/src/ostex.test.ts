import { describe, expect, it } from 'vitest';

import { fnv1a } from './binary';
import {
  decodeOstex,
  encodeOstex,
  type Ostex,
  OSTEX_FORMAT_FEATURE,
  OSTEX_ROW_ALIGN,
  OSTEX_VERSION_MAJOR,
  OstexAlphaClass,
  OstexFormat,
  ostexLayerBytes,
  ostexMaxMips,
  ostexMipLayout,
  ostexTightRowBytes,
} from './ostex';

function sampleTex(): Ostex {
  const format = OstexFormat.BC3;
  const width = 16;
  const height = 16;
  const mipCount = ostexMaxMips(format, width, height);
  const layers = [
    { alphaClass: OstexAlphaClass.CUTOUT, cutoutRef: 128, nameHash: fnv1a('vgsebushes'), wrap: 0 },
    { alphaClass: OstexAlphaClass.SOFT_BLEND, cutoutRef: 0, nameHash: fnv1a('fence_64'), wrap: 0 },
  ];
  const payload = new Uint8Array(ostexLayerBytes(format, width, height, mipCount) * layers.length);
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] = (index * 7) % 253;
  }

  return { format, height, layers, mipCount, payload, premultiplied: true, width };
}

describe('ostex codec', () => {
  describe('negative cases', () => {
    it('throws when the payload size does not match the declared layout', () => {
      const tex = sampleTex();

      expect(() => encodeOstex({ ...tex, payload: new Uint8Array(8) })).toThrow(/layout mismatch/);
    });

    it('rejects a wrong magic', () => {
      const bytes = encodeOstex(sampleTex());
      bytes[0] = 0xff;

      expect(() => decodeOstex(bytes)).toThrow(/not an .ostex/);
    });

    it('rejects an unknown major version', () => {
      const bytes = encodeOstex(sampleTex());
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(4, OSTEX_VERSION_MAJOR + 3, true);

      expect(() => decodeOstex(bytes)).toThrow(/unsupported .ostex major/);
    });
  });

  describe('positive cases', () => {
    it('round-trips header, layer table and payload byte-exactly', () => {
      const tex = sampleTex();

      const decoded = decodeOstex(encodeOstex(tex));

      expect(decoded.format).toBe(tex.format);
      expect(decoded.width).toBe(tex.width);
      expect(decoded.height).toBe(tex.height);
      expect(decoded.mipCount).toBe(tex.mipCount);
      expect(decoded.premultiplied).toBe(true);
      expect(decoded.layers).toEqual(tex.layers);
      expect([...decoded.payload]).toEqual([...tex.payload]);
    });

    it('mip layout is writeTexture-ready: 256-aligned rows, BC block rows, 4×4 floor', () => {
      // 16×16 BC3: mip0 = 4 block-rows, raw row 4×16=64 B → aligned 256.
      const level0 = ostexMipLayout(OstexFormat.BC3, 16, 16, 0);
      expect(level0.bytesPerRow).toBe(OSTEX_ROW_ALIGN);
      expect(level0.rows).toBe(4);
      expect(level0.totalBytes).toBe(4 * OSTEX_ROW_ALIGN);

      // BC chain stops at 4×4: 16→8→4 = 3 mips.
      expect(ostexMaxMips(OstexFormat.BC3, 16, 16)).toBe(3);
      // RGBA8 goes to 1×1: 16→8→4→2→1 = 5 mips.
      expect(ostexMaxMips(OstexFormat.RGBA8, 16, 16)).toBe(5);
    });

    it('encodes deterministically', () => {
      expect([...encodeOstex(sampleTex())]).toEqual([...encodeOstex(sampleTex())]);
    });
  });
});

/**
 * ASTC 4x4 (plan 200 chain 2): the format that lets a GPU without BC hold the world at the DESKTOP's price.
 * Its 4x4 block is BC's, which is the whole reason nothing else in the layout had to change — these tests
 * pin that, because the day a non-4x4 ASTC block is added, `ostexMipLayout` stops being right and only a
 * test says so.
 */
describe('ostex ASTC 4x4', () => {
  describe('negative cases', () => {
    it('demands the ASTC feature, not the BC one — the two never substitute', () => {
      expect(OSTEX_FORMAT_FEATURE[OstexFormat.ASTC4x4]).toBe('texture-compression-astc');
      expect(OSTEX_FORMAT_FEATURE[OstexFormat.BC1]).toBe('texture-compression-bc');
    });

    it('is not free: it costs exactly what BC3 costs, and never RGBA8', () => {
      const astc = ostexLayerBytes(OstexFormat.ASTC4x4, 256, 256, 1);

      expect(astc).toBe(ostexLayerBytes(OstexFormat.BC3, 256, 256, 1));
      expect(astc).toBe(ostexLayerBytes(OstexFormat.RGBA8, 256, 256, 1) / 4);
    });
  });

  describe('positive cases', () => {
    it('is ONE byte per texel at mip 0 — the number the mobile decision is made on', () => {
      const layout = ostexMipLayout(OstexFormat.ASTC4x4, 256, 256, 0);

      expect(ostexTightRowBytes(OstexFormat.ASTC4x4, 256)).toBe((256 / 4) * 16);
      expect(layout.rows * ostexTightRowBytes(OstexFormat.ASTC4x4, 256)).toBe(256 * 256);
    });

    it('round-trips through the container like any other format', () => {
      const format = OstexFormat.ASTC4x4;
      const mipCount = ostexMaxMips(format, 16, 16);
      const payload = new Uint8Array(ostexLayerBytes(format, 16, 16, mipCount));
      payload.forEach((_, index) => (payload[index] = (index * 11) % 251));
      const source: Ostex = {
        format,
        height: 16,
        layers: [{ alphaClass: OstexAlphaClass.OPAQUE, cutoutRef: 0, nameHash: fnv1a('astc'), wrap: 0 }],
        mipCount,
        payload,
        premultiplied: true,
        width: 16,
      };

      const back = decodeOstex(encodeOstex(source));

      expect(back.format).toBe(OstexFormat.ASTC4x4);
      expect(back.payload).toEqual(payload);
      expect(back.mipCount).toBe(mipCount);
    });
  });
});
