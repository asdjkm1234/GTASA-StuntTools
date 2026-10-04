import type { LodContext, LodModifier } from './hd-to-lod';
import type { MergedMesh } from './mesh';
import type { TextureSource } from './texture-source';

import { compactMeshVertices } from './compact';
import { createOpaqueCoverage } from './opaque-coverage';

/**
 * Drop per-texture groups whose texture is almost entirely transparent (opaque coverage below
 * `minOpaqueCoverage`) — chain-link, grates, wires: at LOD distances they resolve to sub-pixel noise
 * (plan 003, Track 1). Conservative by construction: untextured groups, groups whose texture is missing from
 * `ctx.textures`, and any run without a texture source are all **kept** (they count as fully opaque). Coverage
 * is memoized across cells/models (the modifier is shared by the whole bake).
 */
export function createDropTransparentGroups(minOpaqueCoverage: number): LodModifier {
  // Keyed by source (not a single closure) — one modifier instance may see different texture sources in tests.
  const bySource = new WeakMap<TextureSource, (texture: string) => number>();

  return (mesh: MergedMesh, ctx: LodContext): MergedMesh => {
    if (!ctx.textures) {
      return mesh;
    }
    let coverage = bySource.get(ctx.textures);
    if (!coverage) {
      coverage = createOpaqueCoverage(ctx.textures);
      bySource.set(ctx.textures, coverage);
    }
    const groups = mesh.groups.filter((group) => coverage(group.texture) >= minOpaqueCoverage);
    if (groups.length === mesh.groups.length) {
      return mesh;
    }

    return compactMeshVertices({ ...mesh, groups });
  };
}
