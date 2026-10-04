/**
 * Erasing one smashable prop from a cell's index buffer (074/08 B7·a).
 *
 * A break overwrites the prop's triangles with degenerate ones — every index → 0 — which the bundle happily
 * draws as nothing. The catch is `writeBuffer`: WebGPU demands a 4-byte-aligned offset AND size, while a
 * prop's range is measured in INDICES. With 16-bit indices an odd `indexOffset` lands on a 2-byte boundary and
 * the whole write is REJECTED (the browser only warns) — the prop then refuses to break, at random, depending
 * on where the converter happened to put it.
 *
 * So the write is widened to the enclosing 4-byte window, and the ≤2 bytes of a NEIGHBOUR's index that get
 * dragged in are written back verbatim. Zeroing them instead would quietly degenerate a triangle of the prop
 * next door.
 */

export interface AlignedErase {
  /** 4-byte-aligned offset into the index buffer. */
  byteOffset: number;
  /** Bytes to write: zeros over the prop's own indices, the neighbours' bytes preserved at the edges. */
  bytes: Uint8Array;
}

/**
 * The aligned write that erases `[indexOffset, indexOffset + indexCount)` from `indexData`.
 * `stride` is 2 for u16 indices, 4 for u32.
 */
export function alignedErase(
  indexData: Uint8Array,
  indexOffset: number,
  indexCount: number,
  stride: number,
): AlignedErase {
  const start = indexOffset * stride;
  const end = start + indexCount * stride;
  const alignedStart = start & ~3;
  // NOT clamped to indexData.byteLength: a u16 cell with an ODD index count ends on a 2-byte boundary, and
  // clamping produced a non-multiple-of-4 write that writeBuffer REJECTS (the 087 map-inspector hide crash).
  // The GPU buffer is created at align4(byteLength), so the ≤2 pad bytes past the data are safely writable.
  const alignedEnd = (end + 3) & ~3;
  const bytes = new Uint8Array(alignedEnd - alignedStart);
  // Head and tail: the neighbouring indices this window overlaps survive untouched.
  bytes.set(indexData.subarray(alignedStart, start), 0);
  bytes.set(indexData.subarray(end, Math.min(indexData.byteLength, alignedEnd)), end - alignedStart);

  return { byteOffset: alignedStart, bytes };
}
