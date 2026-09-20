/**
 * The welding core (moved out of `tools/opensa-pack` in plan 094 phase 1, code unchanged): RenderWare
 * instances + TXDs → the engine's native `.oscell` / `.ostex` bytes. It is Node-free by construction, which
 * is the whole point of it living here — `opensa-pack` (a `type:tool`) welds a whole map offline, and
 * `sa-map-viewer` (a `type:app`, forbidden to import a tool) welds one cell at a time in the browser.
 */
export {
  type AlphaClass,
  classifyAlpha,
  coverage,
  dilateEdges,
  downsample,
  effectiveAlphaClass,
  isAlphaMask,
  premultiply,
  preserveCoverage,
  processAlphaTexture,
  resampleToPow2,
} from './alpha';
export { CELL_SIZE } from './cell-size';
export { packOstexPayload } from './ostex-payload';
export { type ResolvedTexture, TexturePlanner } from './textures';
export {
  assembleCell,
  createUvAnimRegistry,
  isVegetationDef,
  uvAnimList,
  type UvAnimRegistry,
  WELD_AO,
  WELD_ROW,
  WELD_SUNSOFT,
  WELD_SUNVIS,
  type WeldBucket,
  weldCell,
  weldCellParts,
  type WeldedCell,
  type WeldStats,
} from './weld';
