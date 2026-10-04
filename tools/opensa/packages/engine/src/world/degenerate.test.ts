import { describe, expect, it } from 'vitest';

import { alignedErase } from './degenerate';

/** Read the buffer back as u16 after applying an erase. */
function afterErase(indexOffset: number, indexCount: number): number[] {
  const data = indices();
  const erase = alignedErase(data, indexOffset, indexCount, 2);
  expect(erase.byteOffset % 4).toBe(0); // WebGPU rejects anything else — silently, with only a warning
  expect(erase.bytes.byteLength % 4).toBe(0);
  data.set(erase.bytes, erase.byteOffset);

  return [...new Uint16Array(data.buffer)];
}

/** Eight u16 indices, each equal to its position — so a stray write is obvious. */
function indices(): Uint8Array {
  return new Uint8Array(new Uint16Array([10, 11, 12, 13, 14, 15, 16, 17]).buffer);
}

describe('alignedErase', () => {
  describe('negative cases', () => {
    it('does not touch the NEIGHBOUR index an odd range drags into its 4-byte window', () => {
      // Range [1, 4) with u16 indices spans bytes 2..8 — the aligned window starts at byte 0, which contains
      // index 0. Zeroing it too would silently degenerate a triangle of the prop next door.
      expect(afterErase(1, 3)).toEqual([10, 0, 0, 0, 14, 15, 16, 17]);
    });

    it('preserves the neighbour at the TAIL end too', () => {
      // Range [2, 5) spans bytes 4..10; the window runs to byte 12, which holds index 5.
      expect(afterErase(2, 3)).toEqual([10, 11, 0, 0, 0, 15, 16, 17]);
    });

    it('does not emit an unaligned write when an ODD u16 index count ends the buffer (the hide crash)', () => {
      // 7 indices = 14 bytes: the old clamp to byteLength produced a 2-byte-short window that writeBuffer
      // REJECTS with OperationError (087: map-inspector hide). The GPU buffer is align4-padded, so the
      // window may legally run to byte 16.
      const data = new Uint8Array(new Uint16Array([10, 11, 12, 13, 14, 15, 16]).buffer);

      const erase = alignedErase(data, 4, 3, 2);

      expect(erase.byteOffset % 4).toBe(0);
      expect(erase.bytes.byteLength % 4).toBe(0);
      expect(erase.byteOffset + erase.bytes.byteLength).toBe(16); // into the pad, never short of it
      const padded = new Uint8Array(16);
      padded.set(data, 0);
      padded.set(erase.bytes, erase.byteOffset);
      expect([...new Uint16Array(padded.buffer)]).toEqual([10, 11, 12, 13, 0, 0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('erases exactly the prop’s own indices when the range is already aligned', () => {
      expect(afterErase(2, 4)).toEqual([10, 11, 0, 0, 0, 0, 16, 17]);
    });

    it('always yields a 4-byte aligned offset and size, whatever the range', () => {
      const data = indices();
      for (let offset = 0; offset < 8; offset += 1) {
        for (let count = 1; count + offset <= 8; count += 1) {
          const erase = alignedErase(data, offset, count, 2);
          expect(erase.byteOffset % 4).toBe(0);
          expect(erase.bytes.byteLength % 4).toBe(0);
          // May run into the align4 pad of the GPU buffer, never past it.
          expect(erase.byteOffset + erase.bytes.byteLength).toBeLessThanOrEqual((data.byteLength + 3) & ~3);
        }
      }
    });

    it('u32 indices are aligned by construction — the window is the range itself', () => {
      const data = new Uint8Array(new Uint32Array([1, 2, 3, 4]).buffer);

      const erase = alignedErase(data, 1, 2, 4);

      expect(erase.byteOffset).toBe(4);
      expect([...erase.bytes]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
  });
});
