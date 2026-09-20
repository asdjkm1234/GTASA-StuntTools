// Public API for the RenderWare (GTA San Andreas) asset loaders.

// IMG archive + asset resolution
export * from './archive';

// 2dfx particles (074/06 row 13, B6): the shared FX baking both renderers run.
export { breakableKeyHash } from './breakable/key';

export { breakableModelsFromText, breakableModelsOf } from './breakable/models';
// Collision (COL) index over the archive
export * from './collision';

export {
  bakeFxInstances,
  bakeFxSystem,
  FX_INSTANCE_STRIDE,
  FX_SYSTEM_STRIDE,
  type FxBakedEmitter,
  type FxPlacement,
  sampleFxParticle,
  writeFxSystemRecord,
} from './fx/bake-fx';
export { normalizeSpriteAlpha } from './fx/sprites';
// Framework-agnostic map resolution + region instancing
export * from './map';
export { frameWorldTransform, mulMat3, rotationToQuat } from './mesh/frame-transform';
export {
  hasPreparedAtomics,
  prepareClumpAtomics,
  type PreparedAtomic,
  preparedAtomicsFor,
  primePreparedAtomics,
} from './mesh/prepare-clump';
// Parser layer (renderer-agnostic): binary RW geometry + collision + text map definitions.
export { parseColLibrary, parseDffCollision } from './parsers/binary/col';
export * from './parsers/binary/col-types';
export { parseDff } from './parsers/binary/dff';
export { gxtKeyHash, parseGxt } from './parsers/binary/gxt';
export { type IfpAnimation, type IfpBone, type IfpKeyframe, parseIfp } from './parsers/binary/ifp';
export { type VehiclePathLink, type VehiclePathNode, vehiclePathNodes } from './parsers/binary/paths';
export { parseTxd } from './parsers/binary/txd';
export * from './parsers/binary/types';
export * from './parsers/text';

// The three.js adapter layer lived here until plan 074/13 phase 5c deleted it (C2).
// Renderer-agnostic vehicle model (074/08 B5) — the own engine's spawn-time builder.
export { buildVehicleModel } from './vehicle/build-vehicle-model';
export { VehicleTextures } from './vehicle/textures';
export * from './vehicle/types';
export { pickVariants } from './vehicle/variants';
