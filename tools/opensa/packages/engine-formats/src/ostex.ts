/**
 * `.ostex` — one `texture2d_array` (plan 074/02): every layer the same W×H×format (the bucketing unit), the
 * FULL mip chain baked offline (the runtime never generates mips), premultiplied alpha where alpha exists.
 * Payload is layer-major, mip-minor; every mip level's rows are 256-byte aligned so `queue.writeTexture`
 * consumes them verbatim (`bytesPerRow` multiple-of-256 rule).
 */
import { ByteReader, ByteWriter } from './binary';

export const OSTEX_MAGIC = 0x3154534f; // 'OST1' little-endian
export const OSTEX_VERSION_MAJOR = 0;
export const OSTEX_VERSION_MINOR = 2; // 2: the ASTC4x4 format id

export const OstexFormat = {
  /** ASTC 4x4 LDR (plan 200 chain 2): 16 bytes per 4x4 block — ONE byte per texel, the same as BC3/BC7 and a
   *  QUARTER of RGBA8. It is here because `--rgba8` is the only thing a GPU without BC can take today and it
   *  costs 8x a BC1 payload, which is the arithmetic that keeps the full map off a phone. The 4x4 block
   *  matches BC's, so every layout rule below is unchanged; other ASTC block sizes would not be. */
  ASTC4x4: 5,
  BC1: 0,
  BC2: 4,
  BC3: 1,
  BC7: 2,
  RGBA8: 3,
} as const;
export type OstexFormatId = (typeof OstexFormat)[keyof typeof OstexFormat];

/**
 * The GPU feature a payload in this format DEMANDS, or undefined when it uploads anywhere.
 *
 * This is the whole of "which GPUs can display this world", and it is a property of the CONTENT: the
 * converter picked the format at build time and no runtime choice can re-take it. Mobile GPUs ship
 * ETC2/ASTC and never BC, so a BC payload is a desktop payload.
 */
export const OSTEX_FORMAT_FEATURE: Record<OstexFormatId, string | undefined> = {
  [OstexFormat.ASTC4x4]: 'texture-compression-astc',
  [OstexFormat.BC1]: 'texture-compression-bc',
  [OstexFormat.BC2]: 'texture-compression-bc',
  [OstexFormat.BC3]: 'texture-compression-bc',
  [OstexFormat.BC7]: 'texture-compression-bc',
  [OstexFormat.RGBA8]: undefined,
};

export const OstexAlphaClass = {
  CUTOUT: 1,
  OPAQUE: 0,
  SOFT_BLEND: 2,
} as const;

export interface Ostex {
  format: OstexFormatId;
  height: number;
  layers: OstexLayer[];
  mipCount: number;
  /** Layer-major, mip-minor payload; each mip laid out per {@link ostexMipLayout}. */
  payload: Uint8Array;
  premultiplied: boolean;
  width: number;
}

export interface OstexLayer {
  /** 0 opaque | 1 cutout | 2 softBlend (offline classification — plan 074/03). */
  alphaClass: number;
  /** Alpha-to-coverage reference for cutouts, unorm8 (0 for non-cutouts). */
  cutoutRef: number;
  /** FNV-1a of the lowercased source texture name (the manifest keeps full strings). */
  nameHash: number;
  /** 0 repeat | 1 clamp (SA is overwhelmingly repeat). */
  wrap: number;
}

/** Bytes-per-row alignment `queue.writeTexture` requires. */
export const OSTEX_ROW_ALIGN = 256;

const BLOCK_BYTES: Record<OstexFormatId, number> = {
  [OstexFormat.ASTC4x4]: 16,
  [OstexFormat.BC1]: 8,
  [OstexFormat.BC2]: 16,
  [OstexFormat.BC3]: 16,
  [OstexFormat.BC7]: 16,
  [OstexFormat.RGBA8]: 4, // per texel, not per block
};

export function decodeOstex(bytes: Uint8Array): Ostex {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== OSTEX_MAGIC) {
    throw new Error(`not an .ostex (magic 0x${magic.toString(16)})`);
  }
  const major = r.u16();
  r.u16(); // minor
  if (major !== OSTEX_VERSION_MAJOR) {
    throw new Error(`unsupported .ostex major ${major} (reader supports ${OSTEX_VERSION_MAJOR})`);
  }
  const format = r.u8() as OstexFormatId;
  const premultiplied = r.u8() === 1;
  r.u16(); // pad
  const width = r.u16();
  const height = r.u16();
  const layerCount = r.u16();
  const mipCount = r.u8();
  r.u8(); // pad
  const layers: OstexLayer[] = [];
  for (let index = 0; index < layerCount; index += 1) {
    const nameHash = r.u32();
    const alphaClass = r.u8();
    const cutoutRef = r.u8();
    const wrap = r.u8();
    r.u8(); // pad
    layers.push({ alphaClass, cutoutRef, nameHash, wrap });
  }
  r.seek(r.position + ((4 - (r.position % 4)) % 4));
  const payload = r.raw(ostexLayerBytes(format, width, height, mipCount) * layerCount);

  return { format, height, layers, mipCount, payload, premultiplied, width };
}

export function encodeOstex(tex: Ostex): Uint8Array {
  const expected = ostexLayerBytes(tex.format, tex.width, tex.height, tex.mipCount) * tex.layers.length;
  if (tex.payload.byteLength !== expected) {
    throw new Error(`payload ${tex.payload.byteLength} B ≠ expected ${expected} B (layout mismatch)`);
  }
  const w = new ByteWriter(tex.payload.byteLength + 1024);
  w.u32(OSTEX_MAGIC);
  w.u16(OSTEX_VERSION_MAJOR);
  w.u16(OSTEX_VERSION_MINOR);
  w.u8(tex.format);
  w.u8(tex.premultiplied ? 1 : 0);
  w.u16(0); // pad
  w.u16(tex.width);
  w.u16(tex.height);
  w.u16(tex.layers.length);
  w.u8(tex.mipCount);
  w.u8(0); // pad
  for (const layer of tex.layers) {
    w.u32(layer.nameHash);
    w.u8(layer.alphaClass);
    w.u8(layer.cutoutRef);
    w.u8(layer.wrap);
    w.u8(0); // pad
  }
  w.align(4);
  w.raw(tex.payload);

  return w.bytes();
}

/** Total payload bytes for one layer (all mips). */
export function ostexLayerBytes(format: OstexFormatId, width: number, height: number, mipCount: number): number {
  let total = 0;
  for (let level = 0; level < mipCount; level += 1) {
    total += ostexMipLayout(format, width, height, level).totalBytes;
  }

  return total;
}

/** Max meaningful mip count for W×H (BC formats stop at 4×4 blocks). */
export function ostexMaxMips(format: OstexFormatId, width: number, height: number): number {
  const floor = format === OstexFormat.RGBA8 ? 1 : 4;
  let count = 0;
  let w = width;
  let h = height;
  while (w >= floor && h >= floor) {
    count += 1;
    w >>= 1;
    h >>= 1;
  }

  return Math.max(1, count);
}

/** One mip level's GPU-upload layout: aligned bytesPerRow, row count, and total byte size. */
export function ostexMipLayout(
  format: OstexFormatId,
  width: number,
  height: number,
  level: number,
): { bytesPerRow: number; mipHeight: number; mipWidth: number; rows: number; totalBytes: number } {
  const mipWidth = Math.max(1, width >> level);
  const mipHeight = Math.max(1, height >> level);
  const compressed = format !== OstexFormat.RGBA8;
  const rows = compressed ? Math.ceil(mipHeight / 4) : mipHeight;
  const rawRow = ostexTightRowBytes(format, mipWidth);
  const bytesPerRow = Math.ceil(rawRow / OSTEX_ROW_ALIGN) * OSTEX_ROW_ALIGN;

  return { bytesPerRow, mipHeight, mipWidth, rows, totalBytes: bytesPerRow * rows };
}

/**
 * The TIGHT (unaligned) bytes of one row of a mip level — what an encoder produces, before the payload is
 * padded to {@link OSTEX_ROW_ALIGN}.
 *
 * Exported because the writer needs exactly this number and used to compute it from its own copy of the
 * block table. Two copies of "how big is a block" is how adding a format goes wrong: the second one is
 * updated by whoever remembers it exists.
 */
export function ostexTightRowBytes(format: OstexFormatId, mipWidth: number): number {
  return format === OstexFormat.RGBA8 ? mipWidth * BLOCK_BYTES[format] : Math.ceil(mipWidth / 4) * BLOCK_BYTES[format];
}

/**
 * Just the format byte, without decoding the payload — for build-time scans over a whole game's
 * dictionaries, where copying every texel to learn one number is the difference between a check and a stage.
 */
export function readOstexFormat(bytes: Uint8Array, offset = 0): OstexFormatId {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 9);
  if (view.getUint32(0, true) !== OSTEX_MAGIC) {
    throw new Error(`not an .ostex (magic 0x${view.getUint32(0, true).toString(16)})`);
  }

  return view.getUint8(8) as OstexFormatId;
}
