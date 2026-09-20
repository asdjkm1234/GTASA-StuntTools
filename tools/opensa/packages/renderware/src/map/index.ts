// Framework-agnostic GTA map resolution + streamed cell instancing.
export { addToGroup, cellGroups, cellModelNames, type RegionMeshData } from './cell-groups';
export { MODEL_SEARCH_LIMIT, ModelIndex, type ModelSearchHit } from './model-search';
export { oceanFrame } from './ocean-frame';
export { procObjCategory, type ProcObjCategoryName } from './procobj-categories';
export { type ProcObjColliderOptions, procObjColliders } from './procobj-colliders';
export {
  groupRulesBySurface,
  placementMatrix,
  PROC_OBJ_MAX_DENSITY,
  PROC_OBJ_STEEP_THRESHOLD,
  type ProcObjBatch,
  procObjCellBudget,
  type ProcObjCellBudgetOptions,
  procObjLotteryCap,
  type ProcObjPlacement,
  type ProcObjSampler,
  type ProcObjScatterOptions,
  type ProcObjSlopeConfig,
  scatterProcObjects,
  validateSlopeConfig,
} from './procobj-scatter';
export { resolveMap, type ResolveMapOptions } from './resolve-map';
export { flatWaterMesh, WATER_DEEP, WATER_VERTEX_FLOATS } from './water-mesh';
export { buildWorldGrid, cellKey, type GridCell, instanceCell, type WorldGrid } from './world-grid';
