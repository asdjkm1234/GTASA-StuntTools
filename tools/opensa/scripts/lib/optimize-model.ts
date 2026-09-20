import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, RW_BIN_MESH_PLG, RW_EXTENSION, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { Asset } from '../../tools/map-optimizer/src/core/asset';

import { encodeDff } from '../../tools/map-optimizer/src/adapters/gta-sa/codec/dff';
import { rebuildGeometry } from '../../tools/map-optimizer/src/adapters/gta-sa/codec/geometry-rebuild';
import { clumpToIr } from '../../tools/map-optimizer/src/adapters/gta-sa/read';
import { loadCreaseOverrides } from '../../tools/map-optimizer/src/crease-overrides';
import { createDedupeFaces } from '../../tools/map-optimizer/src/plugins/dedupe-faces';
import { createRemoveDegenerateTriangles } from '../../tools/map-optimizer/src/plugins/degenerate-triangles';
import { createPruneVertices } from '../../tools/map-optimizer/src/plugins/prune-vertices';
import { createSmoothNormals } from '../../tools/map-optimizer/src/plugins/smooth-normals';
import { createWeldVertices } from '../../tools/map-optimizer/src/plugins/weld-vertices';

/**
 * ONE model through the map-optimizer GEOMETRY chain, in memory, in a named variant — the shared half of
 * `scripts/debug/model-optimize.ts` and `scripts/debug/model-lab.ts` (the field A/B instruments for the
 * normals × repeat-texture × SkyGfx question, `docs/open-issues/fixed/sa-lod-visibility-budget.md` rounds 9–10).
 * The chain is `optimizer.config.ts` + `run.ts`'s addNormals / curated-crease wiring; the world-context
 * prelight passes are NOT replayed (they need a map-wide pre-pass and never touch structure).
 */
const TRISTRIP = 0x01;
const PRELIT = 0x08;
const NORMALS = 0x10;
const LIGHT = 0x20;

/**
 * - `chain` — the build's chain, addNormals ON (reproduces the shipped model)
 * - `no-add-normals` — the chain with normals creation off
 * - `strip-normals-after` — the build's chain, THEN a chunk-level strip: NORMALS flag cleared and morph normals
 *   dropped, everything else (trilist re-encode, split vertices, prelit) kept — separates "the normals array"
 *   from "the strip→list re-encode"
 * - `raw` — the source bytes untouched (the clean control)
 * - `list-only` — the source, no chain at all, forced through the REBUILD path (`rebuildGeometry`): same
 *   vertices, same prelit, no normals — only the BinMesh becomes a trilist, the Struct triangles are re-emitted
 *   and the bounds recomputed. Isolates "the trilist re-encode" from everything else the chain does
 * - `restrip` — the build's chain (normals, split vertices), THEN the trilist BinMesh is converted BACK to a
 *   tristrip (one degenerate-joined strip per material, parity kept) and the TRISTRIP flag set — the candidate
 *   FIX if `list-only` breaks: the target's SkyGfx building pipe never met a trilist in stock (0 of 338 stock
 *   trilist geometries carry night colours)
 */
export type OptimizeVariant = 'chain' | 'list-only' | 'no-add-normals' | 'raw' | 'restrip' | 'strip-normals-after';

export const OPTIMIZE_VARIANT_FLAGS: Readonly<Record<string, OptimizeVariant>> = {
  '--list-only': 'list-only',
  '--no-add-normals': 'no-add-normals',
  '--raw': 'raw',
  '--restrip': 'restrip',
  '--strip-normals-after': 'strip-normals-after',
};

export interface GeometryRow {
  readonly bytes: number;
  readonly flags: number;
  readonly triangles: number;
  readonly vertices: number;
}

/** Per-geometry Struct facts of a DFF (flags, counts, Struct bytes) — the before/after table's rows. */
export function describeGeometries(bytes: Uint8Array): GeometryRow[] {
  return collectGeometries(readRw(bytes).chunks).map((geometry) => {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) throw new Error('geometry without a Struct');
    const decoded = decodeGeometryStruct(struct.data);

    return {
      bytes: struct.data.length,
      flags: decoded.flags,
      triangles: decoded.numTriangles,
      vertices: decoded.numVertices,
    };
  });
}

/** The source through `rebuildGeometry` with its OWN unchanged IR — the trilist re-encode and nothing else. */
export function forceRebuild(source: Uint8Array): Uint8Array {
  const clump = parseDff(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer);
  const ir = clumpToIr(clump);
  const file = readRw(source);
  const geometries = collectGeometries(file.chunks);
  if (geometries.length !== ir.meshes.length) throw new Error('geometry count mismatch');
  geometries.forEach((geometry, index) => rebuildGeometry(geometry, ir.meshes[index]));

  return writeRw(file);
}

/** Run `variant` over one model's DFF bytes. */
export function optimizeModel(
  name: string,
  source: Uint8Array,
  variant: OptimizeVariant,
  crease: number | undefined,
): Uint8Array {
  switch (variant) {
    case 'chain':
      return runGeometryChain(name, source, true, crease);
    case 'list-only':
      return forceRebuild(source);
    case 'no-add-normals':
      return runGeometryChain(name, source, false, crease);
    case 'raw':
      return source;
    case 'restrip':
      return restripBinMeshes(runGeometryChain(name, source, true, crease));
    case 'strip-normals-after':
      return stripNormals(runGeometryChain(name, source, true, crease));
  }
}

/**
 * Convert every trilist `BinMeshPLG` of a DFF back to a tristrip: per material ONE strip, triangles joined by
 * degenerates with the parity kept (`a b c c d d d e f …` — six indices per further triangle, so the strip
 * draws exactly the list's triangles with the list's winding), `flags = 1`, and the geometry Struct's
 * TRISTRIP bit set to agree. A probe encoder, not a stripifier: index count ≈ 2× the list's.
 */
export function restripBinMeshes(bytes: Uint8Array): Uint8Array {
  const file = readRw(bytes);
  for (const geometry of collectGeometries(file.chunks)) {
    const extension = geometry.children?.find((child) => child.type === RW_EXTENSION);
    const binMesh = extension?.children?.find((child) => child.type === RW_BIN_MESH_PLG && child.data);
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!binMesh?.data || !struct?.data) continue;
    const view = new DataView(binMesh.data.buffer, binMesh.data.byteOffset, binMesh.data.byteLength);
    if (view.getUint32(0, true) !== 0) continue; // already a strip
    const numMeshes = view.getUint32(4, true);
    const strips: { indices: number[]; material: number }[] = [];
    let offset = 12;
    for (let m = 0; m < numMeshes; m += 1) {
      const numIndices = view.getUint32(offset, true);
      const material = view.getUint32(offset + 4, true);
      offset += 8;
      const list: number[] = [];
      for (let i = 0; i < numIndices; i += 1, offset += 4) list.push(view.getUint32(offset, true));
      strips.push({ indices: degenerateStrip(list), material });
    }
    const total = strips.reduce((sum, strip) => sum + strip.indices.length, 0);
    const out = new Uint8Array(12 + strips.length * 8 + total * 4);
    const w = new DataView(out.buffer);
    w.setUint32(0, 1, true); // rpMESHHEADERTRISTRIP
    w.setUint32(4, strips.length, true);
    w.setUint32(8, total, true);
    let cursor = 12;
    for (const strip of strips) {
      w.setUint32(cursor, strip.indices.length, true);
      w.setUint32(cursor + 4, strip.material, true);
      cursor += 8;
      for (const index of strip.indices) {
        w.setUint32(cursor, index, true);
        cursor += 4;
      }
    }
    binMesh.data = out;
    const decoded = decodeGeometryStruct(struct.data);
    decoded.flags |= TRISTRIP;
    struct.data = encodeGeometryStruct(decoded);
  }

  return writeRw(file);
}

/** The build's geometry chain over one model's bytes; returns the re-encoded DFF (source when nothing moved). */
export function runGeometryChain(
  name: string,
  source: Uint8Array,
  addNormals: boolean,
  crease: number | undefined,
): Uint8Array {
  const clump = parseDff(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer);
  const asset: Asset = { dirty: false, ir: clumpToIr(clump), log: [], meta: {}, name, source };
  const curated = loadCreaseOverrides();
  const creaseFor = (model: string): number | undefined => crease ?? curated?.get(model);
  const plugins = [
    createWeldVertices(),
    createRemoveDegenerateTriangles(),
    createDedupeFaces(),
    createPruneVertices(),
    createSmoothNormals({ addWhereAbsent: addNormals, creaseFor }),
  ];
  const context = { game: 'lab', log: (): void => undefined };
  for (const plugin of plugins) void plugin.transform(asset, context);

  return asset.dirty ? encodeDff(source, asset.ir) : source;
}

/** Chunk-level normals strip: clear the NORMALS flag and drop every morph target's normals array; nothing
 *  else in the file moves (the BinMeshPLG, split vertices and prelit stay as the chain left them). */
export function stripNormals(bytes: Uint8Array): Uint8Array {
  const file = readRw(bytes);
  for (const geometry of collectGeometries(file.chunks)) {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) continue;
    const decoded = decodeGeometryStruct(struct.data);
    decoded.flags &= ~NORMALS;
    for (const morph of decoded.morphs) morph.normals = null;
    struct.data = encodeGeometryStruct(decoded);
  }

  return writeRw(file);
}

/** The variant named on the command line (`chain` when none); throws when two are named. */
export function variantFromArgv(argv: readonly string[] = process.argv): OptimizeVariant {
  const named = argv.filter((arg) => arg in OPTIMIZE_VARIANT_FLAGS);
  if (named.length > 1) throw new Error(`pick one variant, not ${named.join(' + ')}`);

  return named[0] ? OPTIMIZE_VARIANT_FLAGS[named[0]] : 'chain';
}

/** One strip drawing a triangle list's triangles in order and winding: every triangle starts at an EVEN strip
 *  index (D3D flips odd triangles), the gap being filled with degenerates. */
function degenerateStrip(list: readonly number[]): number[] {
  const strip: number[] = [];
  for (let t = 0; t + 2 < list.length; t += 3) {
    const [a, b, c] = [list[t], list[t + 1], list[t + 2]];
    if (strip.length === 0) {
      strip.push(a, b, c);
      continue;
    }
    // last real triangle sat at even k = strip.length - 3; the next must sit at k + 6
    strip.push(strip[strip.length - 1], a, a, a, b, c);
  }

  return strip;
}

/** `0x0006f STRIP -PL` — the flag word plus TRISTRIP / NORMALS / PRELIT / LIGHT letters. */
export const flagWord = (flags: number): string =>
  `0x${flags.toString(16).padStart(5, '0')} ${flags & TRISTRIP ? 'STRIP' : 'LIST '} ${flags & NORMALS ? 'N' : '-'}${flags & PRELIT ? 'P' : '-'}${flags & LIGHT ? 'L' : '-'}`;

/** Print the before → after geometry table for one model. */
export function printGeometryDiff(label: string, before: Uint8Array, after: Uint8Array): void {
  const from = describeGeometries(before);
  const to = describeGeometries(after);
  console.log(
    `${label}: ${before.length} → ${after.length} B, ${from.length} geometr${from.length === 1 ? 'y' : 'ies'}`,
  );
  from.forEach((a, i) => {
    const b = to[i] ?? a;
    console.log(
      `  [${i}] ${flagWord(a.flags)} → ${flagWord(b.flags)}  tris ${a.triangles} → ${b.triangles}  verts ${a.vertices} → ${b.vertices}  struct ${a.bytes} → ${b.bytes} B`,
    );
  });
}
