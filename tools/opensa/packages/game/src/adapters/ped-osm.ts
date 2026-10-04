/**
 * `.osm` → a ped, engine-ready (opensa-pack 003 phase 5f) — the inverse of opensa-pack's `packPedFixture`.
 *
 * The unoptimized path parses the DFF, walks the skin plugin, quantizes weights, re-derives the root's bind
 * position from its inverse bind, decodes every texture and measures the posed feet level. Here that is a
 * DESC parse and some `subarray` views.
 *
 * A ped carries no `COLL`: its collider is a generated capsule.
 */
import type { PedFixture } from '@opensa/renderware/ped/build-ped-model';

import { decodeOsm, decodeOsmTextures, osmSection, OsmSectionTag } from '@opensa/engine-formats';

/** Byte strides of the `GEOM` buffers, matching what `packPedFixture` reserved. */
const STRIDE = { index: 2, joints: 4, normals: 12, positions: 12, uvs: 8, weights: 4 };

export interface OptimizedPed {
  fixture: PedFixture;
  /** Interleaved-free buffers, as views over the container. */
  geometry: {
    indices: Uint8Array;
    joints: Uint8Array;
    normals: Uint8Array;
    positions: Uint8Array;
    uvs: Uint8Array;
    weights: Uint8Array;
  };
  /** One `.ostex` payload per texture size the ped uses; `submeshes[].array` indexes this. */
  textureArrays: Uint8Array[];
}

/** Read one converted ped. Throws when a required section is missing — a truncated `.osm` is a bug. */
export function readPedOsm(name: string, osm: Uint8Array): OptimizedPed {
  const sections = decodeOsm(osm);
  const section = (tag: number, label: string): Uint8Array => {
    const bytes = osmSection(sections, tag);
    if (!bytes) {
      throw new Error(`${name}.osm is missing its ${label} section`);
    }

    return bytes;
  };
  const fixture = JSON.parse(new TextDecoder().decode(section(OsmSectionTag.DESC, 'DESC'))) as PedFixture;
  const geom = section(OsmSectionTag.GEOM, 'GEOM');
  const at = (offset: number, length: number): Uint8Array => geom.subarray(offset, offset + length);
  const { layout, vertexCount } = fixture;

  return {
    fixture,
    geometry: {
      indices: at(layout.indices, fixture.indexCount * STRIDE.index),
      joints: at(layout.joints, vertexCount * STRIDE.joints),
      normals: at(layout.normals, vertexCount * STRIDE.normals),
      positions: at(layout.positions, vertexCount * STRIDE.positions),
      uvs: at(layout.uvs, vertexCount * STRIDE.uvs),
      weights: at(layout.weights, vertexCount * STRIDE.weights),
    },
    textureArrays: decodeOsmTextures(section(OsmSectionTag.TEXS, 'TEXS')).arrays,
  };
}
