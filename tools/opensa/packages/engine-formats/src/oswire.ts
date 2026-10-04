/**
 * `.oswire` — the wire container for meshopt-compressed cells (074/14 A1 stage 2). An `.oscell`'s vertex and
 * index payloads travel as meshopt streams; the header and tables travel verbatim (they are small and
 * deflate-raw wraps the whole container on top). The pak worker rebuilds the EXACT original `.oscell` bytes,
 * so the engine never learns wire encodings exist.
 *
 * This module owns only the container LAYOUT (pure bytes) — the meshopt encode/decode calls live with the
 * producer (opensa-pack) and the consumer (pak worker), which own the meshopt WASM dependency.
 */
import { ByteReader, ByteWriter } from './binary';
import { OSCELL_MAGIC, OSCELL_VERTEX_STRIDE, OscellFlag } from './oscell';

export const OSWIRE_MAGIC = 0x3157534f; // 'OSW1' little-endian
const OSWIRE_HEADER_BYTES = 44;

/** Where an encoded `.oscell`'s sections sit — the split points the wire codec works on. */
export interface OscellSections {
  indexCount: number;
  /** 2 (uint16 indices) or 4 (uint32). */
  indexElemSize: number;
  indexOffset: number;
  /** Total size of the raw `.oscell`. */
  rawLength: number;
  /** Everything after the index payload (group/object/light tables incl. alignment). */
  tailOffset: number;
  vertexCount: number;
  /** Also the size of the head segment (header bytes travel verbatim). */
  vertexOffset: number;
}

/** The meshopt decoder surface the rebuild needs (both meshopt WASM builds satisfy it). */
export interface OswireDecoder {
  decodeIndexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
  decodeVertexBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array): void;
}

export interface OswireParts {
  /** meshopt index stream for the index payload. */
  indexBlock: Uint8Array;
  sections: OscellSections;
  /** meshopt vertex stream (stride {@link OSCELL_VERTEX_STRIDE}) for the vertex payload. */
  vertexBlock: Uint8Array;
}

/** Split a wire container back into its parts (subarray views — no copies). */
export function decodeOswire(bytes: Uint8Array): OswireParts & { head: Uint8Array; tail: Uint8Array } {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSWIRE_MAGIC) {
    throw new Error(`not an .oswire container (magic 0x${magic.toString(16)})`);
  }
  const rawLength = r.u32();
  const vertexOffset = r.u32();
  const vertexCount = r.u32();
  const vertexBlockLength = r.u32();
  const indexOffset = r.u32();
  const indexCount = r.u32();
  const indexElemSize = r.u32();
  const indexBlockLength = r.u32();
  const tailOffset = r.u32();
  const tailLength = r.u32();
  const head = r.raw(vertexOffset);
  const vertexBlock = r.raw(vertexBlockLength);
  const indexBlock = r.raw(indexBlockLength);
  const tail = r.raw(tailLength);

  return {
    head,
    indexBlock,
    sections: { indexCount, indexElemSize, indexOffset, rawLength, tailOffset, vertexCount, vertexOffset },
    tail,
    vertexBlock,
  };
}

/** Assemble the wire container: header + head verbatim + meshopt blocks + tail verbatim. */
export function encodeOswire(raw: Uint8Array, vertexBlock: Uint8Array, indexBlock: Uint8Array): Uint8Array {
  const sections = oscellSections(raw);
  const tailLength = sections.rawLength - sections.tailOffset;
  const w = new ByteWriter(
    OSWIRE_HEADER_BYTES + sections.vertexOffset + vertexBlock.byteLength + indexBlock.byteLength + tailLength,
  );
  w.u32(OSWIRE_MAGIC);
  w.u32(sections.rawLength);
  w.u32(sections.vertexOffset);
  w.u32(sections.vertexCount);
  w.u32(vertexBlock.byteLength);
  w.u32(sections.indexOffset);
  w.u32(sections.indexCount);
  w.u32(sections.indexElemSize);
  w.u32(indexBlock.byteLength);
  w.u32(sections.tailOffset);
  w.u32(sections.rawLength - sections.tailOffset);
  w.raw(raw.subarray(0, sections.vertexOffset));
  w.raw(vertexBlock);
  w.raw(indexBlock);
  w.raw(raw.subarray(sections.tailOffset));

  return w.bytes();
}

/** Parse the section split points from a raw `.oscell` without decoding it. */
export function oscellSections(raw: Uint8Array): OscellSections {
  const r = new ByteReader(raw);
  const magic = r.u32();
  if (magic !== OSCELL_MAGIC) {
    throw new Error(`not an .oscell (magic 0x${magic.toString(16)})`);
  }
  // NB this walks the header by HARD OFFSETS — it duplicates encodeOscell's layout knowledge, so any new
  // header field must be reflected here or the wire codec silently slices the payload in the wrong place.
  // Minor 2 (B6) inserted `particleCount` between the light count and the offsets; minor 8 appended the
  // roadsign glyph-quad count after the placement count, on the same rule.
  r.seek(6); // major is at 4, minor at 6
  const minor = r.u16();
  // A newer minor may add a header count the offset formula below does not know about — which would slice
  // the payload at the wrong place and produce a corrupt-but-valid-looking `.oscell` on rebuild. Fail LOUD
  // instead. Bump this literal WITH the formula whenever encodeOscell gains a pre-offset header field.
  const KNOWN_MINOR = 8;
  if (minor > KNOWN_MINOR) {
    throw new Error(
      `.oswire: .oscell minor ${minor} is newer than the header formula (knows <= ${KNOWN_MINOR}) — ` +
        'update oscellSections to account for its new header field before wire-encoding it',
    );
  }
  r.seek(8);
  const flags = r.u32();
  r.seek(48);
  const vertexCount = r.u32();
  const indexCount = r.u32();
  // Header words: … counts …, then the three section offsets. Each minor that ADDS a count pushes them by 4.
  r.seek(68 + (minor >= 2 ? 4 : 0) + (minor >= 3 ? 4 : 0) + (minor >= 6 ? 4 : 0) + (minor >= 8 ? 4 : 0));
  const vertexOffset = r.u32();
  const indexOffset = r.u32();
  const indexElemSize = (flags & OscellFlag.INDEX16) !== 0 ? 2 : 4;

  return {
    indexCount,
    indexElemSize,
    indexOffset,
    rawLength: raw.byteLength,
    tailOffset: indexOffset + indexCount * indexElemSize,
    vertexCount,
    vertexOffset,
  };
}

/** Rebuild the exact original `.oscell` bytes from a parsed container (consumer side). */
export function rebuildOscell(parts: ReturnType<typeof decodeOswire>, decoder: OswireDecoder): Uint8Array {
  const { head, indexBlock, sections, tail, vertexBlock } = parts;
  const raw = new Uint8Array(sections.rawLength);
  raw.set(head, 0);
  decoder.decodeVertexBuffer(
    raw.subarray(sections.vertexOffset, sections.vertexOffset + sections.vertexCount * OSCELL_VERTEX_STRIDE),
    sections.vertexCount,
    OSCELL_VERTEX_STRIDE,
    vertexBlock,
  );
  decoder.decodeIndexBuffer(
    raw.subarray(sections.indexOffset, sections.tailOffset),
    sections.indexCount,
    sections.indexElemSize,
    indexBlock,
  );
  raw.set(tail, sections.tailOffset);

  return raw;
}
