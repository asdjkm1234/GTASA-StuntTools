/**
 * Clump-level DFF surgery: read a clump into frames (with names + HAnim), atomics (with their extension
 * bodies verbatim) and geometry chunk bodies (verbatim bytes), and write the same shape back. Geometry,
 * material and atomic-extension bytes are never re-encoded — the mod-installer principle — only the
 * frame list, the HAnim plugins and the atomic indices are ours.
 *
 * READING reuses the engine parser's anti-rip machinery (`forEachClumpChild` / `recoverLockedList`,
 * read-only): half the real mod fleet ships "locked" DFFs whose container sizes lie (taxi, zr350,
 * copcarla, firela, burrito, securica…), which a naive size-respecting walk reads as an empty clump.
 * Inner leaf sizes stay honest — only outer container sizes are tampered — so bodies sliced by the
 * recovered bounds are sound, and WRITING emits honest headers around them (a converted file never
 * carries the donor's lock). A leading UVAnimDict (or any pre-clump chunk) is dropped on conversion.
 *
 * Binary facts encoded here were measured on the vanilla cutscene fleet (probe 2026-08-12, plan 002
 * step 2): clump struct is 12 B (atomics/lights/cameras), frame-list rows are 56 B, every frame gets an
 * Extension chunk (empty on the unnamed top frame), the HAnim hierarchy sits on the skeleton root with
 * `flags 0` / `keyFrameSize 36`, and the clump-level Extension of every vanilla cs model is EMPTY (no
 * embedded collision — a converted mod's COL3 is deliberately dropped).
 */
import { BinaryStream } from '@opensa/renderware/parsers/binary/binary-stream';
import {
  type ChunkHeader,
  findChild,
  forEachClumpChild,
  readChunkHeader,
  recoverLockedList,
} from '@opensa/renderware/parsers/binary/chunks';
import { RwSection } from '@opensa/renderware/parsers/binary/constants';
import {
  readRw,
  RW_EXTENSION,
  RW_GEOMETRY,
  RW_GEOMETRY_LIST,
  RW_STRUCT,
  type RwChunk,
  writeRw,
} from '@opensa/rw-codec/chunk';

export const RW_ATOMIC = 0x14;
export const RW_CLUMP = 0x10;
export const RW_FRAME_LIST = 0x0e;
export const RW_FRAME_NAME = 0x253f2fe;
export const RW_HANIM = 0x11e;

const FRAME_ROW_BYTES = 56;
const HANIM_VERSION = 0x100;
const HANIM_KEYFRAME_SIZE = 36;
const CHUNK_HEADER_BYTES = 12;

/** Direct children of an Atomic / a Geometry — the honest-sized anchors the lock recovery walks. */
const ATOMIC_CHILDREN: ReadonlySet<number> = new Set([RwSection.EXTENSION, RwSection.STRUCT]);
const GEOMETRY_CHILDREN: ReadonlySet<number> = new Set([
  RwSection.EXTENSION,
  RwSection.MATERIAL_LIST,
  RwSection.STRUCT,
]);

export interface ClumpAtomic {
  /** The atomic's Extension BODY bytes, verbatim (matfx flag / right-to-render / SA pipeline plugins). */
  extension: null | OpaqueChunk;
  flags: number;
  frameIndex: number;
  geometryIndex: number;
}

export interface ClumpFrame {
  boneId?: number;
  /** Frame-list matrix-flags word (vanilla: `0x20003` on the top frame, `3` everywhere else). */
  flags: number;
  hierarchy?: HierarchyNode[];
  name: string;
  parentIndex: number;
  position: [number, number, number];
  rotation: number[];
}

export interface ClumpModel {
  atomics: ClumpAtomic[];
  frames: ClumpFrame[];
  /** Geometry chunk BODIES, verbatim — re-emitted byte-for-byte under honest headers. */
  geometries: OpaqueChunk[];
  version: number;
}

/** One node row of the skeleton root's HAnim hierarchy table. */
export interface HierarchyNode {
  /** `2` = more siblings follow (push), `1` = leaf (pop), `3` = both, `0` = neither — measured rule,
   *  reproduced verbatim across all five vanilla cutscene rig styles. */
  flags: number;
  id: number;
  index: number;
}

/** A chunk carried by body bytes + version (its emitted header is rebuilt honest). */
export interface OpaqueChunk {
  body: Uint8Array;
  version: number;
}

/** Parse a DFF's clump into the editable model, tolerant of locked/anti-rip container sizes. */
export function readClump(bytes: Uint8Array): ClumpModel {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new BinaryStream(buffer);
  const clump = findClumpHeader(stream);

  let frames: ClumpFrame[] | null = null;
  let geometryList: ChunkHeader | null = null;
  let declaredAtomics = 0;
  let atomicHeaders: ChunkHeader[] = [];
  if (clump.end - clump.dataStart >= CHUNK_HEADER_BYTES) {
    forEachClumpChild(stream, clump, (child) => {
      if (child.type === RwSection.STRUCT && declaredAtomics === 0 && child.end - child.dataStart >= 4) {
        stream.seek(child.dataStart);
        declaredAtomics = stream.u32();
      } else if (child.type === RwSection.FRAME_LIST) {
        frames = readFrames(new Uint8Array(buffer, child.dataStart, child.end - child.dataStart));
      } else if (child.type === RwSection.GEOMETRY_LIST) {
        geometryList = child;
      } else if (child.type === RwSection.ATOMIC) {
        atomicHeaders.push(child);
      }
    });
  }
  if (!frames || !geometryList) {
    throw new Error('clump has no frame list / geometry list');
  }
  if (atomicHeaders.length < declaredAtomics) {
    atomicHeaders = recoverLockedList(
      stream,
      clump.dataStart,
      clump.end,
      declaredAtomics,
      RwSection.ATOMIC,
      ATOMIC_CHILDREN,
    );
  }

  return {
    atomics: atomicHeaders.map((header) => readAtomic(stream, buffer, header)),
    frames,
    geometries: readGeometries(stream, buffer, geometryList),
    version: clump.version,
  };
}

/** Serialize the model back to DFF bytes (clump-level Extension emitted EMPTY, like vanilla cs). */
export function writeClump(model: ClumpModel): Uint8Array {
  const children: RwChunk[] = [
    structChunk(clumpStructBody(model), model.version),
    frameListChunk(model),
    geometryListChunk(model),
    ...model.atomics.map((atomic) => atomicChunk(atomic, model.version)),
    { children: [], type: RW_EXTENSION, version: model.version },
  ];

  return writeRw({ chunks: [{ children, type: RW_CLUMP, version: model.version }], trailing: new Uint8Array(0) });
}

function atomicChunk(atomic: ClumpAtomic, version: number): RwChunk {
  const struct = new Uint8Array(16);
  const view = new DataView(struct.buffer);
  view.setUint32(0, atomic.frameIndex, true);
  view.setUint32(4, atomic.geometryIndex, true);
  view.setUint32(8, atomic.flags, true);
  const extension: RwChunk = atomic.extension
    ? { data: atomic.extension.body, type: RW_EXTENSION, version: atomic.extension.version }
    : { children: [], type: RW_EXTENSION, version };
  const body = [chunkBytes(structChunk(struct, version)), chunkBytes(extension)];

  return { data: concat(body), type: RW_ATOMIC, version };
}

function chunkBytes(chunk: RwChunk): Uint8Array {
  return writeRw({ chunks: [chunk], trailing: new Uint8Array(0) });
}

function clumpStructBody(model: ClumpModel): Uint8Array {
  const body = new Uint8Array(12);
  new DataView(body.buffer).setUint32(0, model.atomics.length, true);

  return body;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** Mirror `parseDff`'s leading-chunk skip: some DFFs carry a UVAnimDict (or junk) before the clump. */
function findClumpHeader(stream: BinaryStream): ChunkHeader {
  if (stream.remaining < CHUNK_HEADER_BYTES) {
    throw new Error('not a DFF: no clump chunk');
  }
  let header = readChunkHeader(stream);
  while (header.type !== RwSection.CLUMP) {
    stream.seek(Math.max(header.end, header.dataStart));
    if (stream.remaining < CHUNK_HEADER_BYTES) {
      throw new Error('not a DFF: no clump chunk');
    }
    header = readChunkHeader(stream);
  }

  return { ...header, end: Math.min(header.end, stream.length) };
}

function frameExtension(frame: ClumpFrame, version: number): RwChunk {
  const children: RwChunk[] = [];
  if (frame.boneId !== undefined) {
    children.push({ data: hanimBody(frame), type: RW_HANIM, version });
  }
  if (frame.name !== '') {
    children.push({ data: new TextEncoder().encode(frame.name), type: RW_FRAME_NAME, version });
  }

  return { children, type: RW_EXTENSION, version };
}

function frameListChunk(model: ClumpModel): RwChunk {
  const struct = new Uint8Array(4 + model.frames.length * FRAME_ROW_BYTES);
  const view = new DataView(struct.buffer);
  view.setUint32(0, model.frames.length, true);
  model.frames.forEach((frame, index) => {
    const base = 4 + index * FRAME_ROW_BYTES;
    frame.rotation.forEach((value, at) => view.setFloat32(base + at * 4, value, true));
    frame.position.forEach((value, at) => view.setFloat32(base + 36 + at * 4, value, true));
    view.setInt32(base + 48, frame.parentIndex, true);
    view.setUint32(base + 52, frame.flags, true);
  });
  const body = [
    chunkBytes(structChunk(struct, model.version)),
    ...model.frames.map((frame) => chunkBytes(frameExtension(frame, model.version))),
  ];

  return { data: concat(body), type: RW_FRAME_LIST, version: model.version };
}

function geometryListChunk(model: ClumpModel): RwChunk {
  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint32(0, model.geometries.length, true);

  return {
    children: [
      structChunk(struct, model.version),
      ...model.geometries.map(
        (geometry): RwChunk => ({ data: geometry.body, type: RW_GEOMETRY, version: geometry.version }),
      ),
    ],
    type: RW_GEOMETRY_LIST,
    version: model.version,
  };
}

function hanimBody(frame: ClumpFrame): Uint8Array {
  const nodes = frame.hierarchy ?? [];
  const body = new Uint8Array(12 + (nodes.length > 0 ? 8 + nodes.length * 12 : 0));
  const view = new DataView(body.buffer);
  view.setUint32(0, HANIM_VERSION, true);
  view.setUint32(4, frame.boneId ?? 0, true);
  view.setUint32(8, nodes.length, true);
  if (nodes.length > 0) {
    view.setUint32(16, HANIM_KEYFRAME_SIZE, true);
    nodes.forEach((node, at) => {
      view.setUint32(20 + at * 12, node.id, true);
      view.setUint32(24 + at * 12, node.index, true);
      view.setUint32(28 + at * 12, node.flags, true);
    });
  }

  return body;
}

function readAtomic(stream: BinaryStream, buffer: ArrayBuffer, header: ChunkHeader): ClumpAtomic {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct || struct.end - struct.dataStart < 12) {
    throw new Error('atomic missing struct');
  }
  stream.seek(struct.dataStart);
  const frameIndex = stream.u32();
  const geometryIndex = stream.u32();
  const flags = stream.u32();
  const extension = findChild(stream, struct.end, header.end, RwSection.EXTENSION);
  const extensionEnd = extension ? Math.min(extension.end, header.end) : 0;

  return {
    extension:
      extension && extensionEnd > extension.dataStart
        ? {
            body: new Uint8Array(buffer, extension.dataStart, extensionEnd - extension.dataStart),
            version: extension.version,
          }
        : null,
    flags,
    frameIndex,
    geometryIndex,
  };
}

function readFramePlugins(extension: RwChunk, frame: ClumpFrame): void {
  for (const plugin of extension.children ?? []) {
    if (plugin.type === RW_FRAME_NAME && plugin.data) {
      frame.name = new TextDecoder().decode(plugin.data);
    }
    if (plugin.type === RW_HANIM && plugin.data && plugin.data.length >= 12) {
      readHAnim(plugin.data, frame);
    }
  }
}

/** Parse the frame-list BODY (struct + per-frame extensions — inner sizes are honest even on locks). */
function readFrames(frameListBody: Uint8Array): ClumpFrame[] {
  const body = readRw(frameListBody);
  const struct = body.chunks[0];
  if (struct?.type !== RW_STRUCT || !struct.data) {
    throw new Error('frame list missing struct');
  }
  const view = new DataView(struct.data.buffer, struct.data.byteOffset, struct.data.byteLength);
  const frames: ClumpFrame[] = [];
  for (let index = 0; index < view.getUint32(0, true); index++) {
    const base = 4 + index * FRAME_ROW_BYTES;
    frames.push({
      flags: view.getUint32(base + 52, true),
      name: '',
      parentIndex: view.getInt32(base + 48, true),
      position: [view.getFloat32(base + 36, true), view.getFloat32(base + 40, true), view.getFloat32(base + 44, true)],
      rotation: Array.from({ length: 9 }, (_, at) => view.getFloat32(base + at * 4, true)),
    });
  }
  body.chunks.slice(1).forEach((extension, index) => {
    const frame = frames[index];
    if (extension.type === RW_EXTENSION && frame) {
      readFramePlugins(extension, frame);
    }
  });

  return frames;
}

function readGeometries(stream: BinaryStream, buffer: ArrayBuffer, list: ChunkHeader): OpaqueChunk[] {
  const struct = findChild(stream, list.dataStart, list.end, RwSection.STRUCT);
  if (!struct || struct.end - struct.dataStart < 4) {
    throw new Error('geometry list missing struct');
  }
  stream.seek(struct.dataStart);
  const count = stream.u32();
  const items = recoverLockedList(stream, struct.end, list.end, count, RwSection.GEOMETRY, GEOMETRY_CHILDREN);
  if (items.length < count) {
    throw new Error(`geometry list declares ${count} geometries, found ${items.length}`);
  }

  return items.map((item) => ({
    body: new Uint8Array(buffer, item.dataStart, item.end - item.dataStart),
    version: item.version,
  }));
}

function readHAnim(data: Uint8Array, frame: ClumpFrame): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  frame.boneId = view.getUint32(4, true);
  const numNodes = view.getUint32(8, true);
  if (numNodes === 0) {
    return;
  }
  frame.hierarchy = Array.from({ length: numNodes }, (_, at) => ({
    flags: view.getUint32(28 + at * 12, true),
    id: view.getUint32(20 + at * 12, true),
    index: view.getUint32(24 + at * 12, true),
  }));
}

function structChunk(body: Uint8Array, version: number): RwChunk {
  return { data: body, type: RW_STRUCT, version };
}
