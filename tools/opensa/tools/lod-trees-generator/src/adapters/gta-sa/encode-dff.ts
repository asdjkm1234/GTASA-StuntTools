import type { MeshIR } from '@opensa/map-optimizer/ir';

import { encodeDff } from '@opensa/map-optimizer/codec';

import type { Impostor } from '../../core';

import { buildCardGeometry } from '../../core';
import { clearTristripFlag, setNightColour, setTextureName, stripExtraVertColour } from './dff-edit';

/**
 * Encode a LOD impostor to DFF bytes: build the card geometry, hand it to map-optimizer's geometry rebuilder
 * over a template clump (reuses Struct/BinMesh/bounds encoding), then rename the material's texture to the
 * impostor's atlas entry (`lod<Name>`). Finally, when the source tree had a night set, bake a night vertex colour
 * onto the card (after `stripExtraVertColour` clears the template's stale one) so the impostor darkens at night
 * like the HD instead of staying at its baked-in day brightness.
 */
export function encodeLodDff(template: Uint8Array, impostor: Impostor): Uint8Array {
  const geometry = buildCardGeometry(impostor);
  const ir: MeshIR = {
    meshes: [
      {
        materialCount: 1,
        name: impostor.name,
        nightColors: null,
        normals: null,
        positions: geometry.positions,
        prelitColors: geometry.prelit,
        triangles: geometry.triangles.map((triangle) => ({ ...triangle, material: 0 })),
        uvs: geometry.uvs,
      },
    ],
  };

  const dff = clearTristripFlag(stripExtraVertColour(setTextureName(encodeDff(template, ir), impostor.name)));

  return impostor.nightColor ? setNightColour(dff, impostor.nightColor) : dff;
}
