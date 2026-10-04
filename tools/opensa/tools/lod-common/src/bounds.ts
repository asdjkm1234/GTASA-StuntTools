import type { RWClump } from '@opensa/renderware/parsers/binary/types';

/**
 * A clump's model-local bounding radius — the farthest vertex from the model origin, each atomic placed by its
 * DFF frame (same placement rule as `buildClumpMesh`). The IPL `inst` places the origin, so this bounds the
 * whole placed model regardless of rotation — the radius the screen-size cull (plan 003, Track 1) judges by.
 */
export function clumpBoundingRadius(clump: RWClump): number {
  let maxSq = 0;
  for (const atomic of clump.atomics) {
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const r = frame?.rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const t = frame?.position ?? [0, 0, 0];
    const p = geometry.positions;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
      const wx = r[0] * x + r[3] * y + r[6] * z + t[0];
      const wy = r[1] * x + r[4] * y + r[7] * z + t[1];
      const wz = r[2] * x + r[5] * y + r[8] * z + t[2];
      maxSq = Math.max(maxSq, wx * wx + wy * wy + wz * wz);
    }
  }

  return Math.sqrt(maxSq);
}
