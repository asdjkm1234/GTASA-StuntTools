import type { MergedGroup, MergedMesh } from './mesh';

/**
 * Drop vertices no group references (after a face/group cull) and remap the indices — orphan vertices would
 * otherwise be encoded into the DFF (and count against its 65 535-vertex geometry limit) for nothing. A mesh
 * whose vertices are all referenced is returned unchanged.
 */
export function compactMeshVertices(mesh: MergedMesh): MergedMesh {
  const vertexCount = mesh.positions.length / 3;
  const used = new Uint8Array(vertexCount);
  let usedCount = 0;
  for (const group of mesh.groups) {
    for (const index of group.indices) {
      if (used[index] === 0) {
        used[index] = 1;
        usedCount += 1;
      }
    }
  }
  if (usedCount === vertexCount) {
    return mesh;
  }

  const remap = new Uint32Array(vertexCount);
  const positions = new Float32Array(usedCount * 3);
  const normals = new Float32Array(usedCount * 3);
  const uvs = new Float32Array(usedCount * 2);
  const colors = new Uint8Array(usedCount * 4);
  const nightColors = mesh.nightColors ? new Uint8Array(usedCount * 4) : undefined;
  let next = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    if (used[v] === 0) {
      continue;
    }
    remap[v] = next;
    positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), next * 3);
    normals.set(mesh.normals.subarray(v * 3, v * 3 + 3), next * 3);
    uvs.set(mesh.uvs.subarray(v * 2, v * 2 + 2), next * 2);
    colors.set(mesh.colors.subarray(v * 4, v * 4 + 4), next * 4);
    nightColors?.set(mesh.nightColors!.subarray(v * 4, v * 4 + 4), next * 4);
    next += 1;
  }

  const groups: MergedGroup[] = mesh.groups.map((group) => ({
    indices: Uint32Array.from(group.indices, (index) => remap[index]),
    texture: group.texture,
    ...(group.color ? { color: group.color } : {}),
    ...(group.twoSided ? { twoSided: group.twoSided } : {}), // face order is untouched — the mask rides along
  }));

  return { colors, groups, normals, positions, uvs, ...(nightColors ? { nightColors } : {}) };
}
