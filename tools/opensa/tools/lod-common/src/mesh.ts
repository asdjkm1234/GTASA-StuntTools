/**
 * The merged-mesh interchange types for the simplified-copy LOD pipeline (decimate → normals → encode). A producer
 * (a cell merge, or a single procobj model) builds a {@link MergedMesh}; `@opensa/sa-lod` decimates, re-derives
 * normals, and encodes it to a RenderWare DFF.
 */

/** One texture's triangles within a {@link MergedMesh} — `indices` are triples into the vertex arrays. */
export interface MergedGroup {
  /**
   * Material RGBA (0–255) when the source material is tinted; absent = opaque white. Groups bucket by
   * texture + colour, and the encoder writes it back — tinted glass/awnings keep their tint through the mesh
   * path (plan 003, Phase 5; ~177 stock clone models carry a tint).
   */
  color?: readonly [number, number, number, number];
  indices: Uint32Array;
  /** Base texture name (lowercased), or '' for untextured materials. */
  texture: string;
  /**
   * Optional per-face two-sided flags (faceCount entries; 1 = emit both windings at encode) — produced by the
   * visibility cull (plan 003, Phase 2), which orients each kept face toward its visible side and marks only the
   * faces genuinely seen from both. Absent → the encoder's blanket `doubleSided` option applies to the group.
   */
  twoSided?: Uint8Array;
}

/**
 * A mesh in native Z-up space, triangles bucketed into per-texture {@link MergedGroup}s (no atlas). Vertex
 * attributes are parallel arrays indexed by the group `indices`. Normals are carried from the source when present,
 * else left zero for a downstream normals pass; colours default to opaque white when a source vertex had no prelit.
 */
export interface MergedMesh {
  /** Prelit RGBA bytes (SA **day** colours), flattened (vertexCount × 4). */
  colors: Uint8Array;
  /** Per-texture triangle groups (vertex indices into the attribute arrays). */
  groups: MergedGroup[];
  /** SA **night** prelit RGBA bytes (the `0x253F2F9` "extra vertex colour" set), flattened (vertexCount × 4).
   *  Optional — when absent, the encoder writes no night plugin (the engine falls back to the day colours). */
  nightColors?: Uint8Array;
  /** Vertex normals, flattened (vertexCount × 3); zero where the source had none. */
  normals: Float32Array;
  /** Vertex positions, flattened (vertexCount × 3). */
  positions: Float32Array;
  /** UV layer 0, flattened (vertexCount × 2). */
  uvs: Float32Array;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];

/**
 * Concatenate two merged meshes — `b`'s vertices appended after `a`'s, group indices rebased. Built for the
 * opensa cell bake's hole-fill exemption (plan 086): the protected instances merge verbatim and join the
 * modifier-shaped remainder here. Night colours stay optional per side — a side without them contributes its
 * DAY colours, the same fallback the engine applies when the night plugin is absent.
 */
export function concatMeshes(a: MergedMesh, b: MergedMesh): MergedMesh {
  const aCount = a.positions.length / 3;
  const concat = <T extends Float32Array | Uint8Array>(left: T, right: T, make: (length: number) => T): T => {
    const out = make(left.length + right.length);
    out.set(left, 0);
    out.set(right, left.length);

    return out;
  };
  const night =
    a.nightColors || b.nightColors
      ? concat(a.nightColors ?? a.colors, b.nightColors ?? b.colors, (n) => new Uint8Array(n))
      : undefined;

  return {
    colors: concat(a.colors, b.colors, (n) => new Uint8Array(n)),
    groups: [
      ...a.groups,
      ...b.groups.map((group) => ({ ...group, indices: Uint32Array.from(group.indices, (i) => i + aCount) })),
    ],
    ...(night ? { nightColors: night } : {}),
    normals: concat(a.normals, b.normals, (n) => new Float32Array(n)),
    positions: concat(a.positions, b.positions, (n) => new Float32Array(n)),
    uvs: concat(a.uvs, b.uvs, (n) => new Float32Array(n)),
  };
}
