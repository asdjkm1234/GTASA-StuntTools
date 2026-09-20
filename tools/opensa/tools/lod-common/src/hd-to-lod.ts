import { stripParticleEffects } from '@opensa/rw-codec/dff';

import type { MergedMesh } from './mesh';
import type { TextureSource } from './texture-source';
import type { LodView } from './view';

export interface HdToLodInput {
  /** Encode a (possibly modified) merged mesh into LOD DFF bytes — caller supplies name / double-siding. */
  readonly encode: (mesh: MergedMesh) => Uint8Array;
  /** The single source HD DFF bytes — enables the verbatim fast-path (only when there are no modifiers). */
  readonly hdDff?: Uint8Array;
  /** Build the merged HD mesh for the LOD (one model or a whole cell) — used by the mesh path. */
  readonly mesh: () => MergedMesh;
}

/**
 * What a {@link LodModifier} may know beyond the mesh itself (plan 003, Phase 0). Every field is optional —
 * a modifier that needs an absent field must return the mesh unchanged, so a caller that can't supply the
 * context (e.g. a test, or a game without texture archives) still gets a valid (just less reduced) LOD.
 */
export interface LodContext {
  /** Decoded source textures — the transparent-group cull reads per-texture opaque coverage from these. */
  readonly textures?: TextureSource;
  /** The pessimistic viewing conditions (closest LOD distance, FOV, viewport) screen-size maths derive from. */
  readonly view?: LodView;
}

/**
 * A LOD geometry transform — the extension point for simplification (plan 003). Applied in order to the merged
 * HD mesh before encoding; lives here once so both sa-lod-generator and opensa-lod-generator inherit each
 * modifier identically (see lod-common plans 002/003).
 */
export type LodModifier = (mesh: MergedMesh, ctx: LodContext) => MergedMesh;

/** Run the modifier chain over a mesh (identity when empty). */
export function applyModifiers(mesh: MergedMesh, modifiers: readonly LodModifier[], ctx: LodContext = {}): MergedMesh {
  return modifiers.reduce((current, modify) => modify(current, ctx), mesh);
}

/**
 * Turn a real HD source into LOD DFF bytes — the single core both LOD generators route through.
 *
 * - **Verbatim fast-path**: a single HD DFF **and** no modifiers → copy the HD bytes as-is (keeps coronas,
 *   materials, multi-UV — everything the merged-mesh path can't yet carry), only stripping particle 2dfx so a far
 *   LOD doesn't re-emit factory smoke. This is what sa-lod-generator does today.
 * - **Mesh path**: a merge (opensa cell) **or** any modifiers → build the merged mesh, run the modifier
 *   chain, encode. opensa always takes this; sa will too once a modifier is added — automatically, no caller change.
 *
 * Making `MergedMesh` lossless (2dfx/materials/multi-UV) so the fast-path can go away is future work — see plan 002.
 */
export function hdToLod(input: HdToLodInput, modifiers: readonly LodModifier[] = [], ctx: LodContext = {}): Uint8Array {
  if (input.hdDff && modifiers.length === 0) {
    return stripParticleEffects(input.hdDff);
  }

  return input.encode(applyModifiers(input.mesh(), modifiers, ctx));
}
