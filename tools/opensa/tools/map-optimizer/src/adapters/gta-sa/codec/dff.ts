import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { readRw, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { MeshIR } from '../../../core/ir';

import { applyMeshToStruct, rebuildGeometry, syncNightColors } from './geometry-rebuild';

/**
 * Serialize a (possibly edited) {@link MeshIR} back to DFF bytes. Reads the source into a faithful chunk tree,
 * then per geometry either **overlays** the IR attributes onto the existing Struct (when vertex + triangle
 * counts are unchanged — preserves multi-UV/skin/etc.; identity when nothing changed) or **rebuilds** the
 * whole geometry (Struct + BinMeshPLG + night colours + bounds) when a count changed. The chunk codec fixes
 * all chunk sizes. Throws when the IR geometry count no longer matches the DFF (e.g. anti-rip recovered
 * geometry); the rebuild path throws on data it can't remap (skin / multi-UV / multi-morph).
 */
export function encodeDff(source: Uint8Array, ir: MeshIR): Uint8Array {
  const file = readRw(source);
  const geometries = collectGeometries(file.chunks);
  if (geometries.length !== ir.meshes.length) {
    throw new Error(`geometry count mismatch: ${geometries.length} in DFF vs ${ir.meshes.length} in IR`);
  }
  geometries.forEach((geometry, index) => {
    const mesh = ir.meshes[index];
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) {
      throw new Error(`geometry ${index} has no Struct`);
    }
    // Decide attribute-overlay vs full rebuild by the actual **topology**, not just counts. A plain count match
    // is unsafe: topology-changing plugins (weld/prune + smooth-normals) can land the vertex/triangle counts
    // back on the source's while the triangle indices differ — overlaying then writes stale indices and shatters
    // the model. Only when the triangles are byte-for-byte identical is the overlay path (which preserves
    // multi-UV/skin) correct.
    if (sameTopology(decodeGeometryStruct(struct.data), mesh)) {
      struct.data = applyMeshToStruct(struct.data, mesh);
    } else {
      rebuildGeometry(geometry, mesh);
    }
    syncNightColors(geometry, mesh); // repaired (plan 019) or synthesized (plan 013) night sets; no-op otherwise
  });

  return writeRw(file);
}

/**
 * True when the Struct's vertex count + triangle set exactly match the mesh (an attribute-only edit).
 *
 * Compared as an unordered MULTISET of wound triples, not positionally: since plan 095 the parser reads a
 * geometry's triangles from its BinMeshPLG (the data RenderWare draws) rather than from this Struct array,
 * and the two are stored in different ORDER even in files where they agree — a positional compare sent
 * every untouched round-trip down the rebuild path. Order does not matter to the overlay, which writes
 * attributes and leaves the index array alone; re-INDEXING (the weld/prune trap this guard exists for)
 * still changes the multiset, and so does a flipped winding.
 */
function sameTopology(struct: GeometryStruct, mesh: MeshIR['meshes'][number]): boolean {
  if (struct.numVertices !== mesh.positions.length / 3 || struct.triangles.length !== mesh.triangles.length) {
    return false;
  }
  const counts = new Map<number, number>();
  for (const t of struct.triangles) {
    const key = woundKey(t.a, t.b, t.c);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const t of mesh.triangles) {
    const key = woundKey(t.a, t.b, t.c);
    const left = counts.get(key);
    if (left === undefined) {
      return false;
    }
    if (left === 1) {
      counts.delete(key);
    } else {
      counts.set(key, left - 1);
    }
  }

  return counts.size === 0;
}

/** Winding-preserving triangle key: the rotation starting at the smallest index (a→b→c is b→c→a is c→a→b,
 *  and none of those is a→c→b). Indices are u16, so the packed value stays an exact double. */
function woundKey(a: number, b: number, c: number): number {
  const [x, y, z] = a <= b && a <= c ? [a, b, c] : b <= c ? [b, c, a] : [c, a, b];

  return x * 0x1_0000_0000 + y * 0x1_0000 + z;
}
