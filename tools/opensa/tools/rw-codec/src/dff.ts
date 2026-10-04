import type { RwChunk } from './chunk';

import {
  readRw,
  RW_CLUMP,
  RW_EXTENSION,
  RW_GEOMETRY,
  RW_GEOMETRY_LIST,
  RW_STRUCT,
  RW_TWO_D_EFFECT,
  writeRw,
} from './chunk';
import { ENTRY_HEADER_BYTES, PARTICLE_2DFX } from './two-d-effect';

/** One raw 2d-effect entry lifted out of a geometry — `bytes` is the whole entry (header + data) verbatim. */
export interface Raw2dfxEntry {
  bytes: Uint8Array;
  geometryIndex: number;
  /** Geometry-local entry position (the first 12 bytes of the entry) — transform it, then re-emit. */
  position: [number, number, number];
  type: number;
}

/**
 * Assemble a 2dfx section payload (`u32 count` + entries) from raw entries, overwriting each entry's first
 * 12 bytes with its (transformed) `position`. Returns null for an empty list (write no section at all).
 */
export function build2dfxSection(
  entries: readonly { bytes: Uint8Array; position: readonly [number, number, number] }[],
): null | Uint8Array {
  if (entries.length === 0) {
    return null;
  }
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, entries.length, true);
  const blobs = entries.map((entry) => {
    const copy = Uint8Array.from(entry.bytes);
    const view = new DataView(copy.buffer);
    view.setFloat32(0, entry.position[0], true);
    view.setFloat32(4, entry.position[1], true);
    view.setFloat32(8, entry.position[2], true);

    return copy;
  });

  return concat([header, ...blobs]);
}

/** Every Geometry chunk, in document order (matches a clump's geometry-list order). */
export function collectGeometries(chunks: readonly RwChunk[]): RwChunk[] {
  const geometries: RwChunk[] = [];
  for (const clump of chunks) {
    if (clump.type !== RW_CLUMP) {
      continue;
    }
    for (const list of clump.children ?? []) {
      if (list.type !== RW_GEOMETRY_LIST) {
        continue;
      }
      for (const geometry of list.children ?? []) {
        if (geometry.type === RW_GEOMETRY) {
          geometries.push(geometry);
        }
      }
    }
  }

  return geometries;
}

/** The Struct leaf of every Geometry, in document order (for tests). */
export function collectGeometryStructs(chunks: readonly RwChunk[]): RwChunk[] {
  return collectGeometries(chunks)
    .map((geometry) => geometry.children?.find((child) => child.type === RW_STRUCT && child.data))
    .filter((struct): struct is RwChunk => Boolean(struct));
}

/**
 * Lift every 2d-effect entry out of a DFF's geometries as raw byte blobs (plan 003, Phase 5). The caller
 * transforms each entry's `position` into its target space (frame / instance transform) and re-emits via
 * {@link build2dfxSection} — everything except the 12 position bytes stays byte-for-byte intact, so fields our
 * parsers don't even know about survive the round trip. `keepTypes` filters entries (e.g. lights only for cell
 * bakes); omit it to keep everything except particles (type 1, deliberately stripped from far LODs).
 */
export function extract2dfxEntries(bytes: Uint8Array, keepTypes?: ReadonlySet<number>): Raw2dfxEntry[] {
  const out: Raw2dfxEntry[] = [];
  const file = readRw(bytes);
  collectGeometries(file.chunks).forEach((geometry, geometryIndex) => {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    const fx = extension?.children?.find((child) => child.type === RW_TWO_D_EFFECT && child.data);
    const data = fx?.data;
    if (!data || data.length < 4) {
      return;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const count = view.getUint32(0, true);
    let pos = 4;
    for (let i = 0; i < count; i += 1) {
      if (pos + ENTRY_HEADER_BYTES > data.length) {
        return; // malformed — skip the rest of this section
      }
      const entryType = view.getUint32(pos + 12, true);
      const entryEnd = pos + ENTRY_HEADER_BYTES + view.getUint32(pos + 16, true);
      if (entryEnd > data.length) {
        return;
      }
      const keep = keepTypes ? keepTypes.has(entryType) : entryType !== PARTICLE_2DFX;
      if (keep) {
        out.push({
          bytes: data.subarray(pos, entryEnd),
          geometryIndex,
          position: [view.getFloat32(pos, true), view.getFloat32(pos + 4, true), view.getFloat32(pos + 8, true)],
          type: entryType,
        });
      }
      pos = entryEnd;
    }
  });

  return out;
}

/**
 * Remove every 2d-effect entry `keep` rejects, from every geometry's 2dfx section, leaving the kept ones and
 * the rest of the file byte-for-byte intact. This is the SUBTRACTIVE half of the LOD carry policy: a verbatim
 * byte-copy clone exists to preserve plugins our writers do not model (breakable, and whatever else), so a
 * type it must not carry is cut out of the copy rather than the whole model being re-encoded.
 *
 * Byte-faithful via {@link readRw}/{@link writeRw}; returns the input unchanged (identity) when `keep` accepts
 * everything, so it is safe to call on every clone.
 */
export function strip2dfxEntries(bytes: Uint8Array, keep: (type: number) => boolean): Uint8Array {
  const file = readRw(bytes);
  let removed = 0;
  for (const geometry of collectGeometries(file.chunks)) {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    const fx = extension?.children?.find((child) => child.type === RW_TWO_D_EFFECT && child.data);
    if (!fx?.data) {
      continue;
    }
    const filtered = filterEntries(fx.data, keep);
    if (filtered) {
      fx.data = filtered.data;
      removed += filtered.removed;
    }
  }

  return removed > 0 ? writeRw(file) : bytes;
}

/**
 * Remove **particle** 2d-effect entries (type 1 — `effects.fxp` emitters) from every geometry's 2dfx section,
 * leaving lights/coronas, road signs, escalators and everything else byte-for-byte intact. Used when cloning an HD
 * model into a far LOD: the verbatim clone would otherwise carry the emitter, so the effect (factory smoke, fire,
 * fountains) renders from the distant LOD too — a duplicate emitter and far-view overdraw. Stripping it on the
 * clone restores stock far-view behaviour (LODs have no emitter) while the HD keeps the effect up close.
 *
 * Byte-faithful via {@link readRw}/{@link writeRw}; returns the input unchanged (identity) when there are no
 * particle entries, so it is safe to call on every clone.
 */
export function stripParticleEffects(bytes: Uint8Array): Uint8Array {
  return strip2dfxEntries(bytes, (type) => type !== PARTICLE_2DFX);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/**
 * Rewrite a 2dfx section's raw bytes (`u32 count`, then entries of `position(12) + type(4) + dataSize(4) + data`)
 * keeping every entry `keep` accepts, verbatim. Returns `null` when there is nothing to remove (leave the leaf
 * as-is), else the new bytes + how many entries were dropped. Any bytes trailing the last entry are preserved.
 */
function filterEntries(
  data: Uint8Array,
  keep: (type: number) => boolean,
): null | { data: Uint8Array; removed: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const kept: Uint8Array[] = [];
  let removed = 0;
  let pos = 4;
  for (let i = 0; i < count; i += 1) {
    if (pos + ENTRY_HEADER_BYTES > data.length) {
      return null; // malformed — don't touch it
    }
    const entryType = view.getUint32(pos + 12, true);
    const entryEnd = pos + ENTRY_HEADER_BYTES + view.getUint32(pos + 16, true);
    if (entryEnd > data.length) {
      return null;
    }
    if (keep(entryType)) {
      kept.push(data.subarray(pos, entryEnd));
    } else {
      removed += 1;
    }
    pos = entryEnd;
  }
  if (removed === 0) {
    return null;
  }
  const header = new Uint8Array(4);
  new DataView(header.buffer).setUint32(0, kept.length, true);

  return { data: concat([header, ...kept, data.subarray(pos)]), removed };
}
