// Public API for the GTA San Andreas text map parsers (DAT / IDE / IPL).
export { parseCarcols, type VehicleColours } from './carcols.parser';
export { type CarGroup, parseCarGroups } from './cargrp.parser';
export { type Carmods, parseCarmods } from './carmods.parser';
export { type FxEmitter, type FxKeyframe, type FxSystem, parseFxp, sampleFxTrack } from './fxp.parser';
export { parseGtaDat } from './gta-dat.parser';
export { type HandlingEntry, parseHandling } from './handling.parser';
export { hasIdeFlag, IdeFlag } from './ide-flags';
export { parseIde, parseTimedObjects, parseTxdParents } from './ide.parser';
export { interiorId, isInterior } from './interior';
export { parseBinaryCarGenerators, parseBinaryIpl } from './ipl-binary.parser';
export { parseIpl } from './ipl.parser';
export { isLodModel } from './lod';
export { ColDamageEffect, type ObjectDatEntry, parseObjectDat } from './object-dat.parser';
export { parsePedDefs, type PedDef } from './ped-defs.parser';
export {
  parsePopcycle,
  POPCYCLE_GROUPS,
  POPCYCLE_SLOTS,
  type PopcycleSlot,
  popcycleSlotForHour,
  type PopcycleZone,
} from './popcycle.parser';
export { parseProcObj, type ProcObjRule } from './procobj.parser';
export { ADHESION_GROUPS, type AdhesionGroup, type AdhesionMatrix, parseSurfaceAdhesion } from './surface.parser';
export { parseSurfaceInfo, parseSurfaceNames, type SurfaceInfo } from './surfinfo.parser';
export {
  buildTimecyc,
  type Rgb,
  type Rgba,
  sampleTimecyc,
  sampleTimecycBlend,
  type Timecyc,
  type TimecycHour,
  type TimecycWeather,
} from './timecyc';
export {
  describeTimecycSource,
  resolveTimecycSource,
  resolveTimecycSourceAsync,
  TIMECYC_SOURCES,
  type TimecycKind,
  type TimecycSource,
} from './timecyc-source';
export { convertTo24h, ensure24h, parseTimecyc, WEATHER_NAMES } from './timecyc.parser';
export * from './types';
export { parseVehicleDefs, type VehicleDef } from './vehicle-defs.parser';
export {
  parseVehicleFeatures,
  saAbilitiesOf,
  saCarrierFor,
  UP_DOWN_LIGHTS,
  VEHICLE_FEATURE_TOKENS,
  type VehicleFeatureCarrier,
  type VehicleFeatureToken,
  vehicleFeatureToken,
} from './vehicle-features.parser';
export { parseWater, type WaterQuad } from './water.parser';
export { type MapZone, parseZones, zoneAt } from './zon.parser';
