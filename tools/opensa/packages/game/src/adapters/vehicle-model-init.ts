import type { RigidModelInit } from '@opensa/loaders/model-osm';
import type { VehicleModelData } from '@opensa/renderware';

/** The engine-ready shapes both paths produce; they moved beside the `.osm` reader in 201/5-04. */
export type { RigidModelInit, RigidTextureInit } from '@opensa/loaders/model-osm';

const bytes = (values: Float32Array): Uint8Array => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

/**
 * `buildVehicleModel` output → `engine.createVehicleModel` input.
 *
 * The rigid path is RENDERER-level, not vehicle-level: a prop, a felled tree, an animated object and a
 * car all upload through it — a prop is just a model with no paint and no lamps. Hence this lives here
 * rather than in any one host.
 */
export function toRigidModelInit(model: VehicleModelData): RigidModelInit {
  return {
    colors: model.colors,
    // The builder narrows the index array to the model; carry the width instead of assuming it, or a
    // hi-poly car binds uint32 data as uint16 and draws a scrambled mesh.
    index16: model.indices.BYTES_PER_ELEMENT === 2,
    indexCount: model.indices.length,
    indices: new Uint8Array(model.indices.buffer, model.indices.byteOffset, model.indices.byteLength),
    meta: model.meta,
    night: model.night,
    normals: bytes(model.normals),
    parts: model.parts,
    positions: bytes(model.positions),
    reflect: model.reflect,
    submeshes: model.submeshes,
    textures: [
      {
        height: model.texture.height,
        kind: 'rgba',
        layers: model.texture.layers,
        rgba: model.texture.rgba,
        width: model.texture.width,
      },
    ],
    ...(model.uvAnimations?.length ? { uvAnimations: model.uvAnimations } : {}),
    uvs: bytes(model.uvs),
    vertexCount: model.positions.length / 3,
  };
}
