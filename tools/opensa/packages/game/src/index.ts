export type { System } from './core/system';

export { EventBus } from './events/event-bus';
export type { GameEvents } from './events/events.global';

// Public API of the framework-agnostic game engine.
export type { ColliderBox, ColliderShape, ColliderSphere, ModelColliders } from './interfaces/collider.interface';
export type {
  BloomConfig,
  CameraConfig,
  CloudsConfig,
  Config,
  EffectsConfig,
  HeadlightConfig,
  LightsConfig,
  MoonConfig,
  NightConfig,
  ProcObjCategory,
  ProcObjConfig,
  ProcObjTypeConfig,
  ShadowsConfig,
  SkyConfig,
  SsaoConfig,
  StarsConfig,
  StreamingConfig,
  VehicleReflectionConfig,
  WaterConfig,
  WorldLightConfig,
} from './interfaces/config.interface';

export type { RegionRequest, Vec3, WorldAdapter, WorldObjectInfo } from './interfaces/world-adapter.interface';

export type { CellCoord } from './streaming/grid';
export { weatherForCity } from './weather/weather-zones';
export { type City, type CityBox, cityFromLevel, isDesertZone } from './zones/city';
export { CityZoneSystem } from './zones/city-zone.system';
export { type NamedZone, ZoneNameSystem } from './zones/zone-name.system';
