import type { MergedMesh, Vec3 } from '@opensa/lod-common/mesh';

import { buildClumpMesh } from '@opensa/lod-common/build-mesh';

/**
 * Build a **model-local** {@link MergedMesh} from a procobj clump — the shared `buildClumpMesh` (`@opensa/lod-common`),
 * which places each atomic by its DFF frame transform (so opensa and lod-procobj build LOD meshes by the same rules).
 */
export const buildModelMesh = buildClumpMesh;

/** Axis-aligned bounds of a mesh's vertices (for the LOD's collision bounds + height gate). */
export function meshBounds(mesh: MergedMesh): { max: Vec3; min: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.positions[i + axis]);
      max[axis] = Math.max(max[axis], mesh.positions[i + axis]);
    }
  }

  return { max, min };
}
