/**
 * Patch a binary IPL stream: point selected HD instances' `lod` fields at their impostor LOD (a text-IPL
 * index) and/or drop instances that migrated to an overflow area (see place-map's per-area row budget).
 * `lod` fields index the area's companion TEXT IPL, so removals never shift them; the 76-byte header's
 * `numInst` + post-INST section offsets are fixed up when records are dropped.
 */
const HEADER_SIZE = 76;
const OFFSET_INST = 0x1c;
const FIELD_NUM_INST = 0x04;
const INST_SIZE = 40;
const REC_LOD = 36;

/** `instanceIndex → new lod (text-IPL index)`. Returns the patched bytes (a copy) or the input if `links` empty. */
export function linkBinaryLods(buffer: Uint8Array, links: ReadonlyMap<number, number>): Uint8Array {
  return rewriteBinaryStream(buffer, links, new Set());
}

/** Apply `links` (by ORIGINAL instance index), then drop the `removes` records. Input returned when both empty. */
export function rewriteBinaryStream(
  buffer: Uint8Array,
  links: ReadonlyMap<number, number>,
  removes: ReadonlySet<number>,
): Uint8Array {
  if (links.size === 0 && removes.size === 0) {
    return buffer;
  }
  const bytes = buffer.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const instOffset = view.getUint32(OFFSET_INST, true);
  for (const [index, lod] of links) {
    view.setInt32(instOffset + index * INST_SIZE + REC_LOD, lod, true);
  }
  if (removes.size === 0) {
    return bytes;
  }

  const numInst = view.getUint32(FIELD_NUM_INST, true);
  const kept: number[] = [];
  for (let i = 0; i < numInst; i += 1) {
    if (!removes.has(i)) {
      kept.push(i);
    }
  }
  const newInst = new Uint8Array(kept.length * INST_SIZE);
  kept.forEach((source, target) => {
    const from = instOffset + source * INST_SIZE;
    newInst.set(bytes.subarray(from, from + INST_SIZE), target * INST_SIZE);
  });

  const delta = (numInst - kept.length) * INST_SIZE;
  const header = bytes.slice(0, HEADER_SIZE);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(FIELD_NUM_INST, kept.length, true);
  for (let offset = OFFSET_INST + 4; offset < HEADER_SIZE; offset += 4) {
    const value = headerView.getUint32(offset, true);
    if (value > instOffset) {
      headerView.setUint32(offset, value - delta, true); // section shifted earlier by the removed INST bytes
    }
  }

  const tail = bytes.subarray(instOffset + numInst * INST_SIZE);
  const out = new Uint8Array(HEADER_SIZE + newInst.length + tail.length);
  out.set(header, 0);
  out.set(newInst, HEADER_SIZE);
  out.set(tail, HEADER_SIZE + newInst.length);

  return out;
}
