/**
 * Getting a prop's SHATTER MESH — renderer-agnostic, because both renderers need it at break time and the
 * fallback rule (props with no shatter atomic shatter their visible mesh) must not exist in two versions.
 */
import { decodeOsm, decodeOsmShatter, osmSection, OsmSectionTag } from '@opensa/engine-formats';

import type { ImgArchive } from '../archive';
import type { RWBreakable, RWBreakableMaterial, RWGeometry } from '../parsers/binary/types';

import { getClump } from '../archive';

/**
 * Synthesize a shatter mesh from a model's **render** geometry (plan 045 fallback): props whose
 * object.dat collision-damage effect is "smash" but that carry no RW Breakable atomic (cardboard
 * boxes, bin bags, some fences) shatter their visible mesh instead. Maps the geometry's positions /
 * UVs / prelit colours / triangles + per-triangle material straight across; ambient is white (the
 * prelit colours already carry the shading), texture names lowercased to match the TXD dictionary.
 */
export function breakableFromGeometry(geometry: RWGeometry): RWBreakable {
  const vertexCount = geometry.positions.length / 3;
  const triangles = new Uint16Array(geometry.triangles.length * 3);
  const triangleMaterials = new Uint16Array(geometry.triangles.length);
  geometry.triangles.forEach((triangle, i) => {
    triangles[i * 3] = triangle.a;
    triangles[i * 3 + 1] = triangle.b;
    triangles[i * 3 + 2] = triangle.c;
    triangleMaterials[i] = triangle.materialIndex;
  });

  return {
    colours: geometry.prelitColors ?? new Uint8Array(vertexCount * 4).fill(255),
    materials: geometry.materials.map(
      (material): RWBreakableMaterial => ({
        ambient: [1, 1, 1],
        mask: (material.texture?.maskName ?? '').toLowerCase(),
        texture: (material.texture?.name ?? '').toLowerCase(),
      }),
    ),
    positions: geometry.positions,
    triangleMaterials,
    triangles,
    uvs: geometry.uvLayers[0] ?? new Float32Array(vertexCount * 2),
  };
}

/** A registered, un-broken prop by its instance key (resolving a contact-force impact to the prop). */

/**
 * The shatter mesh of a model, or undefined when it isn't breakable / not in the archive.
 *
 * OPTIMIZED first (opensa-pack 003 phase 5): a converted prop carries a baked `SHAT` section, so the first
 * hit reads a struct instead of running a whole `parseDff` on the main thread. The converter also resolved
 * the authored-vs-synthesized choice, which is why a `SHAT` hit needs no fallback.
 */
export function getBreakable(archive: ImgArchive, modelName: string): RWBreakable | undefined {
  const baked = bakedShatter(archive, modelName);
  if (baked) {
    return baked;
  }
  try {
    return getClump(archive, modelName).geometries.find((geometry) => geometry.breakable)?.breakable;
  } catch {
    return undefined; // model not in the archive — not breakable
  }
}

/** The `SHAT` section of `<model>.osm`, when the converter wrote one. */
function bakedShatter(archive: ImgArchive, modelName: string): RWBreakable | undefined {
  const bytes = archive.get(`${modelName.toLowerCase()}.osm`);
  if (!bytes) {
    return undefined;
  }
  try {
    const section = osmSection(decodeOsm(new Uint8Array(bytes)), OsmSectionTag.SHAT);

    return section ? decodeOsmShatter(section) : undefined;
  } catch {
    return undefined; // a malformed `.osm` must not take the prop down with it
  }
}
