/**
 * A DFF's frame list has to be TOPOLOGICALLY ORDERED — a parent must come before its child.
 *
 * RenderWare's clump reader creates each frame and parents it in the same pass, reading
 * `frames[parentIndex]` immediately after writing `frames[i]` (`0x807B32` in SA 1.0 US), with no bounds
 * check and no ordering check. A parent index greater than the child's therefore reads a slot that has not
 * been written yet, and whatever it holds decides between an access violation in `RwFrameAddChild`
 * (`0x007F0BF7`) and silent memory corruption — which is why the class shows up as an intermittent crash.
 * Measurement and the field case: `docs/gta-sa-original/rw-frame-list-parent-order.md`.
 *
 * It is invisible on our side: every OpenSA reader resolves parents BY INDEX, so a file that renders
 * perfectly here can still kill the real game. That is why this lives at build time.
 *
 * The repair is a permutation, not a re-encode. Frame records and their extension chunks are reordered,
 * parent indexes and atomic frame indexes are remapped, and every other byte is copied — so the output is
 * the same length as the input and no geometry, material or extension data is re-serialised.
 */
import { BinaryStream } from './binary-stream';
import { type ChunkHeader, findChild, forEachChild, forEachClumpChild, readChunkHeader } from './chunks';
import { RwSection } from './constants';

/** One frame record inside the Frame List's Struct: a 3×3 rotation, a position, a parent index and flags. */
const FRAME_RECORD_BYTES = 56;

/** Byte offset of `parentIndex` within a frame record. */
const PARENT_OFFSET = 48;

export interface FrameOrderReport {
  /** Frames whose parent is declared AFTER them — the ones the real game cannot read. */
  forward: number[];
  /** How many frames the list holds; 0 when the file carries no frame list. */
  frames: number;
}

interface Located {
  /** Byte offset of each atomic's `frameIndex` field. */
  atomics: number[];
  /** Each frame's extension chunk, in frame order — offset and full length including its 12-byte header. */
  extensions: { at: number; length: number }[];
  parents: number[];
  /** Byte offset of the first 56-byte frame record. */
  recordsAt: number;
}

/**
 * Which frames of a DFF declare a parent that comes later in the list. Empty is the healthy answer, and
 * the answer for every stock model measured so far.
 */
export function frameOrderReport(dff: ArrayBuffer): FrameOrderReport {
  const list = locate(dff);
  if (!list) {
    return { forward: [], frames: 0 };
  }

  return {
    forward: list.parents.flatMap((parent, index) => (parent > index ? [index] : [])),
    frames: list.parents.length,
  };
}

/**
 * Reorder a DFF's frame list so every parent precedes its children, remapping the parent indexes and the
 * atomics that name a frame. Returns `null` when nothing needs doing — the common case, and the caller
 * should keep passing the original file through untouched rather than rewriting it.
 *
 * Throws when the file cannot be repaired safely: a parent index out of range, a cycle, or a frame list
 * whose per-frame extension chunks do not match its frame count. A file we cannot reason about is one we
 * must not rewrite.
 */
export function reorderFrameList(dff: ArrayBuffer): null | Uint8Array {
  const list = locate(dff);
  if (!list || list.parents.every((parent, index) => parent < index)) {
    return null;
  }

  const order = topological(list.parents);
  const to = new Array<number>(order.length);
  order.forEach((from, at) => {
    to[from] = at;
  });

  const source = new Uint8Array(dff);
  const out = source.slice();
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  // (a) the frame records, permuted, each one's parent remapped through the new numbering
  order.forEach((from, at) => {
    const read = list.recordsAt + from * FRAME_RECORD_BYTES;
    const write = list.recordsAt + at * FRAME_RECORD_BYTES;
    out.set(source.subarray(read, read + FRAME_RECORD_BYTES), write);
    const parent = list.parents[from];
    view.setInt32(write + PARENT_OFFSET, parent < 0 ? -1 : to[parent], true);
  });

  // (b) the per-frame extension chunks (the frame's name, HAnim), which are positional and differently
  //     sized — permuting them keeps the region's total length, so nothing around them moves
  let cursor = list.extensions[0]?.at ?? 0;
  for (const from of order) {
    const { at, length } = list.extensions[from];
    out.set(source.subarray(at, at + length), cursor);
    cursor += length;
  }

  // (c) every atomic names its frame by index
  for (const atomic of list.atomics) {
    view.setUint32(atomic, to[view.getUint32(atomic, true)], true);
  }

  return out;
}

function locate(dff: ArrayBuffer): Located | null {
  const stream = new BinaryStream(dff);
  if (dff.byteLength < 12) {
    return null;
  }
  const clump = readChunkHeader(stream);
  if (clump.type !== RwSection.CLUMP) {
    return null;
  }
  // The lock-tolerant walk, the same one `parseDff` uses: an anti-rip clump inflates its container sizes,
  // and a boundary-respecting `findChild` would return nothing for those files — checking nothing, quietly.
  const found: ChunkHeader[] = [];
  const atomicChunks: ChunkHeader[] = [];
  forEachClumpChild(stream, clump, (child) => {
    if (child.type === RwSection.FRAME_LIST) {
      found.push(child);
    } else if (child.type === RwSection.ATOMIC) {
      atomicChunks.push(child);
    }
  });
  const frameList = found[0];
  if (!frameList) {
    return null;
  }
  const struct = findChild(stream, frameList.dataStart, frameList.end, RwSection.STRUCT);
  if (!struct) {
    return null;
  }

  stream.seek(struct.dataStart);
  const count = stream.u32();
  const recordsAt = struct.dataStart + 4;
  if (recordsAt + count * FRAME_RECORD_BYTES > struct.end) {
    throw new Error(`frame list declares ${count} frames but its struct is too small to hold them`);
  }
  const view = new DataView(dff);
  const parents = Array.from({ length: count }, (_, index) =>
    view.getInt32(recordsAt + index * FRAME_RECORD_BYTES + PARENT_OFFSET, true),
  );
  for (const [index, parent] of parents.entries()) {
    if (parent >= count || parent < -1) {
      throw new Error(`frame ${index} names parent ${parent}, outside a list of ${count}`);
    }
  }

  const extensions: { at: number; length: number }[] = [];
  forEachChild(stream, frameList.dataStart, frameList.end, (child) => {
    if (child.type === RwSection.EXTENSION) {
      extensions.push({ at: child.dataStart - 12, length: child.size + 12 });
    }
  });
  if (extensions.length !== count) {
    throw new Error(`frame list holds ${count} frames but ${extensions.length} extension chunks`);
  }

  const atomics: number[] = [];
  for (const atomic of atomicChunks) {
    const atomicStruct = findChild(stream, atomic.dataStart, atomic.end, RwSection.STRUCT);
    if (atomicStruct) {
      atomics.push(atomicStruct.dataStart);
    }
  }

  return { atomics, extensions, parents, recordsAt };
}

/**
 * Parents first, original order kept among frames that are ready together — so a healthy list comes back
 * unchanged and a broken one moves as little as it can.
 */
function topological(parents: readonly number[]): number[] {
  const order: number[] = [];
  const placed = new Set<number>();
  while (order.length < parents.length) {
    const before = order.length;
    for (const [index, parent] of parents.entries()) {
      if (!placed.has(index) && (parent < 0 || placed.has(parent))) {
        placed.add(index);
        order.push(index);
      }
    }
    if (order.length === before) {
      throw new Error('frame list has a parent cycle — no ordering exists');
    }
  }

  return order;
}
