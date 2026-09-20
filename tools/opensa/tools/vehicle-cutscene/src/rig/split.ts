/**
 * Mixed-translucency geometry split (plan 004 round 14, FINAL2B). Some mods bake glass INTO a body
 * part's geometry (the sabre's door panes live inside `door_lf_ok`; its lamp lenses inside the
 * bumpers). The pipeline rule is per-ATOMIC — any translucent material keeps the whole atomic off
 * the vehicle PipelineSet (rounds 5–9) — so one embedded pane cost a whole painted door its shine,
 * and the pane-last pass dragged the entire door into the window block. The split gives each class
 * its own atomic on the SAME frame: the opaque remainder takes the vehicle pipeline and its normal
 * draw slot; the translucent twin stays on the default pipeline like every other pane/lens.
 *
 * The surgery is deliberately narrow, everything else byte-verbatim:
 *  - the FULL vertex set stays in both copies (prelit / uv / normals / night-colour arrays keep
 *    their exact bytes — only the Struct's triangle list is filtered);
 *  - the BinMesh is FILTERED, never rebuilt: each mesh entry belongs to one material, so whole
 *    entries move to their copy with winding, strip order and index bytes untouched (exporters ship
 *    Struct faces and BinMesh with opposite winding — rebuilding one from the other flips faces);
 *  - the opaque copy's now-unreferenced translucent materials get alpha 255 so the downstream
 *    classifiers (pipeline stamp, pane order) read the copy as what it is;
 *  - an ADC-strip geometry is never split (its per-index bits align to the unfiltered BinMesh).
 */
import {
  readRw,
  RW_BIN_MESH_PLG,
  RW_EXTENSION,
  RW_NIGHT_VERTEX_COLORS,
  RW_STRUCT,
  type RwChunk,
  writeRw,
} from '@opensa/rw-codec/chunk';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { ClumpAtomic, OpaqueChunk } from './clump-io';

const RW_MATERIAL_LIST = 0x08;
const RW_MATERIAL = 0x07;
const RW_ADC_PLG = 0x134;
/** SA Pipeline Set atomic plugin — must never ride a translucent twin (mirrors `emit.ts`). */
const RW_PIPELINE_SET = 0x253f2f3;

/** The split of one geometry body, or null when it is single-class (or ADC — see the header). */
export function splitGeometryByTranslucency(
  geometry: OpaqueChunk,
): null | { opaque: OpaqueChunk; translucent: OpaqueChunk } {
  const file = readRw(geometry.body);
  const structChunk = file.chunks.find((chunk) => chunk.type === RW_STRUCT);
  const materialList = file.chunks.find((chunk) => chunk.type === RW_MATERIAL_LIST);
  const extension = file.chunks.find((chunk) => chunk.type === RW_EXTENSION);
  if (!structChunk?.data || !materialList?.data) {
    return null;
  }
  if (extension?.children?.some((chunk) => chunk.type === RW_ADC_PLG)) {
    return null;
  }
  const translucentMats = new Set<number>();
  materialAlphas(materialList.data).forEach((alpha, index) => {
    if (alpha < 255) {
      translucentMats.add(index);
    }
  });
  if (translucentMats.size === 0) {
    return null;
  }
  const struct = decodeGeometryStruct(structChunk.data);
  const translucentTris = struct.triangles.filter((triangle) => translucentMats.has(triangle.material));
  if (translucentTris.length === 0 || translucentTris.length === struct.triangles.length) {
    return null;
  }

  return {
    opaque: rebuildCopy(geometry, translucentMats, false),
    translucent: rebuildCopy(geometry, translucentMats, true),
  };
}

/**
 * Split every geometry that carries BOTH opaque- and translucent-referenced triangles into an opaque
 * copy (replacing the original index) and a translucent twin; every atomic on a split geometry gains
 * a sibling atomic for the twin on the same frame, right after it in draw order.
 */
export function splitMixedAtomics(geometries: OpaqueChunk[], atomics: ClumpAtomic[]): void {
  const twins = new Map<number, number>();
  const sourceCount = geometries.length;
  for (let index = 0; index < sourceCount; index += 1) {
    const split = splitGeometryByTranslucency(geometries[index]);
    if (split) {
      geometries[index] = split.opaque;
      twins.set(index, geometries.push(split.translucent) - 1);
    }
  }
  if (twins.size === 0) {
    return;
  }
  const out: ClumpAtomic[] = [];
  for (const atomic of atomics) {
    out.push(atomic);
    const twin = twins.get(atomic.geometryIndex);
    if (twin !== undefined) {
      out.push({
        extension: withoutPipeline(atomic.extension),
        flags: atomic.flags,
        frameIndex: atomic.frameIndex,
        geometryIndex: twin,
      });
    }
  }
  atomics.length = 0;
  atomics.push(...out);
}

/** Keep only the BinMesh entries whose material passes `keep`; header counts follow. */
function filterBinMesh(data: Uint8Array, keep: (material: number) => boolean): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = view.getUint32(0, true);
  const numMeshes = view.getUint32(4, true);
  const kept: Uint8Array[] = [];
  let keptIndices = 0;
  let offset = 12;
  for (let mesh = 0; mesh < numMeshes && offset + 8 <= data.length; mesh += 1) {
    const numIndices = view.getUint32(offset, true);
    const material = view.getUint32(offset + 4, true);
    const end = Math.min(offset + 8 + numIndices * 4, data.length);
    if (keep(material)) {
      kept.push(data.subarray(offset, end));
      keptIndices += numIndices;
    }
    offset = end;
  }
  const out = new Uint8Array(12 + kept.reduce((sum, part) => sum + part.length, 0));
  const outView = new DataView(out.buffer);
  outView.setUint32(0, flags, true);
  outView.setUint32(4, kept.length, true);
  outView.setUint32(8, keptIndices, true);
  let at = 12;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

/** Per-material alpha bytes of a MaterialList body, in material order. */
function materialAlphas(listBody: Uint8Array): number[] {
  const alphas: number[] = [];
  for (const material of readRw(listBody).chunks) {
    if (material.type !== RW_MATERIAL || !material.data) {
      continue;
    }
    const struct = readRw(material.data).chunks.find((chunk) => chunk.type === RW_STRUCT);
    alphas.push(struct?.data ? struct.data[7] : 255);
  }

  return alphas;
}

/** One side of the split, re-parsed from a fresh byte copy so the two sides never alias. */
function rebuildCopy(
  geometry: OpaqueChunk,
  translucentMats: ReadonlySet<number>,
  translucentSide: boolean,
): OpaqueChunk {
  const keepMaterial = (material: number): boolean => translucentMats.has(material) === translucentSide;
  const file = readRw(geometry.body.slice());
  const structChunk = file.chunks.find((chunk) => chunk.type === RW_STRUCT)!;
  const struct = decodeGeometryStruct(structChunk.data!);
  struct.triangles = struct.triangles.filter((triangle) => keepMaterial(triangle.material));
  struct.numTriangles = struct.triangles.length;
  structChunk.data = encodeGeometryStruct(struct);

  if (!translucentSide) {
    // The translucent materials are unreferenced here — alpha 255 so the copy classifies opaque.
    const materialList = file.chunks.find((chunk) => chunk.type === RW_MATERIAL_LIST)!;
    let index = 0;
    for (const material of readRw(materialList.data!).chunks) {
      if (material.type !== RW_MATERIAL || !material.data) {
        continue;
      }
      const materialStruct = readRw(material.data).chunks.find((chunk) => chunk.type === RW_STRUCT);
      if (materialStruct?.data && translucentMats.has(index)) {
        materialStruct.data[7] = 255; // aliases the copy's bytes — writeRw re-reads them
      }
      index += 1;
    }
  }

  const extension = file.chunks.find((chunk) => chunk.type === RW_EXTENSION);
  if (extension?.children) {
    const binMesh = extension.children.find((chunk) => chunk.type === RW_BIN_MESH_PLG);
    if (binMesh?.data) {
      binMesh.data = filterBinMesh(binMesh.data, keepMaterial);
    }
    if (translucentSide) {
      // The twin keeps only what its vertices still need; effects plugins (2dfx…) stay with the
      // opaque main copy so nothing doubles.
      extension.children = extension.children.filter(
        (chunk) => chunk.type === RW_BIN_MESH_PLG || chunk.type === RW_NIGHT_VERTEX_COLORS,
      );
    }
  }

  return { body: writeRw(file), version: geometry.version };
}

/** The atomic extension minus any Pipeline Set plugin — a translucent twin must render default-pipe. */
function withoutPipeline(extension: null | OpaqueChunk): null | OpaqueChunk {
  if (!extension) {
    return null;
  }
  const file = readRw(extension.body);
  const kept: RwChunk[] = file.chunks.filter((chunk) => chunk.type !== RW_PIPELINE_SET);
  if (kept.length === file.chunks.length) {
    return extension;
  }

  return { body: writeRw({ chunks: kept, trailing: file.trailing }), version: extension.version };
}
