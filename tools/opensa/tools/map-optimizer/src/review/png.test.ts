import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { encodePng } from './png';

describe('encodePng', () => {
  describe('negative cases', () => {
    it('throws when the buffer does not match the dimensions', () => {
      expect(() => encodePng(new Uint8Array(4), 2, 2)).toThrow(/does not match/);
    });
  });

  describe('positive cases', () => {
    it('emits the PNG signature and an RGBA IHDR with the given dimensions', () => {
      const png = encodePng(new Uint8Array(2 * 3 * 4), 2, 3);
      const view = new DataView(png.buffer, png.byteOffset);

      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(view.getUint32(16)).toBe(2); // IHDR width
      expect(view.getUint32(20)).toBe(3); // IHDR height
      expect(png[24]).toBe(8); // bit depth
      expect(png[25]).toBe(6); // colour type RGBA
    });

    it('round-trips the pixel data through the IDAT scanlines', () => {
      const rgba = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255]);
      const png = encodePng(rgba, 2, 1);
      const view = new DataView(png.buffer, png.byteOffset);
      const idatLength = view.getUint32(33); // after the 8-byte signature + 25-byte IHDR chunk
      const raw = inflateSync(png.subarray(41, 41 + idatLength));

      expect(raw[0]).toBe(0); // filter None
      expect([...raw.subarray(1)]).toEqual([...rgba]);
    });

    it('is deterministic', () => {
      const rgba = new Uint8Array(16).fill(128);

      expect(encodePng(rgba, 2, 2)).toEqual(encodePng(rgba, 2, 2));
    });
  });
});
