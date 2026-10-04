import type { LodModifier } from './hd-to-lod';
import type { MergedGroup, MergedMesh } from './mesh';

import { compactMeshVertices } from './compact';

/**
 * Faces at or below this area (world units²) render nothing at any distance — collinear/duplicate-vertex
 * degenerates and float-noise slivers. Deliberately far below visible size (a ~0.1 mm² patch at metre scale):
 * this modifier must NOT cull "small but tiling" triangles — dense tessellation of a big surface is made of
 * small faces whose individual removal punches pinholes (plan 003, Track 1); reducing those is the coplanar
 * remesh's job (Track 3).
 */
const MIN_FACE_AREA = 1e-8;

/**
 * Drop degenerate faces (zero area within {@link MIN_FACE_AREA}) from every group, then compact the orphaned
 * vertices. Needs no context. A mesh with no degenerate faces is returned unchanged.
 */
export const dropDegenerateFaces: LodModifier = (mesh: MergedMesh): MergedMesh => {
  let dropped = false;
  const groups: MergedGroup[] = [];
  for (const group of mesh.groups) {
    const kept: number[] = [];
    for (let i = 0; i < group.indices.length; i += 3) {
      const [a, b, c] = [group.indices[i], group.indices[i + 1], group.indices[i + 2]];
      if (faceArea(mesh.positions, a, b, c) > MIN_FACE_AREA) {
        kept.push(a, b, c);
      } else {
        dropped = true;
      }
    }
    if (kept.length > 0) {
      groups.push(
        kept.length === group.indices.length
          ? group
          : {
              indices: Uint32Array.from(kept),
              texture: group.texture,
              ...(group.color ? { color: group.color } : {}),
            },
      );
    }
  }
  if (!dropped) {
    return mesh;
  }

  return compactMeshVertices({ ...mesh, groups });
};

/** Triangle area via the cross-product magnitude. */
function faceArea(p: Float32Array, a: number, b: number, c: number): number {
  const abx = p[b * 3] - p[a * 3];
  const aby = p[b * 3 + 1] - p[a * 3 + 1];
  const abz = p[b * 3 + 2] - p[a * 3 + 2];
  const acx = p[c * 3] - p[a * 3];
  const acy = p[c * 3 + 1] - p[a * 3 + 1];
  const acz = p[c * 3 + 2] - p[a * 3 + 2];
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;

  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}
