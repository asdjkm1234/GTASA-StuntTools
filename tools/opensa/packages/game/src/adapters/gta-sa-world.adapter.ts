import type { parsePedDefs } from '@opensa/renderware';

// The deep path rather than the package index — see the note in streaming/collision-streaming.system.ts.
import { frameSpans } from '@opensa/engine/debug/frame-spans';
// game/adapters/** (and game/mods/**) are the only places allowed to import renderware.
import { Matrix4 } from '@opensa/math';
import {
  type AssetFileSystem,
  breakableKeyHash,
  breakableModelsOf,
  buildCellColliders,
  buildCollisionIndex,
  buildTimecyc,
  buildWorldGrid,
  type CarGroup,
  ensure24h,
  groupRulesBySurface,
  type HandlingEntry,
  type IdeObjectDef,
  type MapDefinitions,
  ModelIndex,
  type ObjectDatEntry,
  parseCarcols,
  parseCarGroups,
  parseHandling,
  parseObjectDat,
  parsePopcycle,
  parseProcObj,
  parseSurfaceAdhesion,
  parseSurfaceInfo,
  parseSurfaceNames,
  parseTimecyc,
  parseVehicleDefs,
  placementMatrix,
  type PopcycleZone,
  type ProcObjBatch,
  type ProcObjCategoryName,
  procObjCellBudget,
  procObjColliders,
  type ProcObjRule,
  type ProcObjSampler,
  type ProcObjSlopeConfig,
  type RegionColliders,
  resolveMap,
  resolveTimecycSource,
  scatterProcObjects,
  type SurfaceInfo,
  type Timecyc,
  TIMECYC_SOURCES,
  type VehicleColours,
  type VehicleDef,
  type WorldGrid,
} from '@opensa/renderware';
import { setTxdParents } from '@opensa/renderware/archive/asset-cache';
import { breakableInstanceKey } from '@opensa/renderware/breakable/key';
import { getBreakable } from '@opensa/renderware/breakable/mesh';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';

import type { ModelColliders } from '../interfaces/collider.interface';
import type {
  AxleSetup,
  AxleType,
  SurfaceRecord,
  VehicleHandling,
  WorldAdapter,
} from '../interfaces/world-adapter.interface';
import type { WorldMod } from '../mods/mod.interface';
import type { CellCoord } from '../streaming/grid';
import type { PlateSources } from '../vehicle/plate-raster';
import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';
import type { City } from '../zones/city';
import type { VehicleRigData } from './engine-vehicle-handle';

import { type BakedCollisionSource, readBakedCell } from './baked-collision';
import { carGeneratorPlacements } from './car-generators';
import { extractPlateSources } from './plate-sources';
import { randomCarPlacements } from './popcycle-cars';
import { type RigidModelInit } from './vehicle-model-init';
import { readVehicleOsm } from './vehicle-osm';

/** Sea level (Z) + a large background plane half-size so the ocean reaches the horizon. */

/** B1 (plan 059) — a representative `popcycle.dat` zone-type per map.zon city, for resolving random map cars.
 *  Countryside/desert map 1:1; the three cities use a generic residential mix (coarse but data-driven). */
const CITY_POPCYCLE_ZONE: Record<City, string> = {
  COUNTRYSIDE: 'COUNTRYSIDE',
  DESERT: 'DESERT',
  LA: 'RESIDENTIAL_AVERAGE',
  SF: 'RESIDENTIAL_AVERAGE',
  VEGAS: 'RESIDENTIAL_AVERAGE',
};

/** One placed animated map object (074/08 B7·b) — native GTA coords and the IPL quaternion, verbatim. */
export interface AnimatedPlacement {
  /** The IFP file holding the model's clip (the clip inside is named after the MODEL). */
  anim: string;
  modelName: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  txdName: string;
}

/** One clutter model's instances in a cell (074/19), for the own-engine host to render instanced. */
export interface CellClutterRender {
  /** The batch's semantic category — the key the host's per-category draw distance is read with. It rides
   *  here because a cell's clutter is split by model×SURFACE and the category follows the surface, so the
   *  host cannot recover it from `modelName` alone (19 of 56 models scatter on several surfaces). */
  category: ProcObjCategoryName;
  /** Per-instance breakable key hash (074/20), aligned with `matrices` — present only for breakable clutter
   *  models (cactus/rubble/rock), so a hit can resolve to the instance to degenerate. */
  keyHashes?: Uint32Array;
  /** 16 floats per instance, GTA-space column-major (model→GTA world); the host applies the axis change. */
  matrices: Float32Array;
  modelName: string;
  txdName: string;
}

/**
 * The own engine's vehicle load product (074/08 B5 step 4): renderer-agnostic geometry + the same collision,
 * handling and paint the three path gets. The host uploads `model` ONCE per car type and spawns instances.
 */
export interface EngineVehicleData {
  colliders: ModelColliders | null;
  halfExtents: [number, number, number];
  handling: VehicleHandling;
  /** Engine-ready upload shape — BOTH paths converge here, so the host cannot tell them apart. */
  model: RigidModelInit;
  /** Carcols colours as 0..1 (the engine's `setPaint` space). */
  paint: { primary: Rgb; quaternary: Rgb; secondary: Rgb; tertiary: Rgb };
  /** The articulation the handle animates (doors, wheels, damage submeshes). */
  rig: VehicleRigData;
  /** `ped_frontseat` dummy in vehicle space, or null. */
  seat: [number, number, number] | null;
  wheels: { connection: [number, number, number]; front: boolean; index: number; radius: number }[];
}

export interface GtaSaWorldConfig {
  /** The pak's baked cell collision (plan 200/3-01), when it carries one — the COL bind is skipped for every
   *  cell the bake covers. Absent (or a pak built without `--bake-collision`) simply keeps the COL path.
   *  Its grid must be {@link GtaSaWorldConfig.cellSize}: the constructor refuses a source keyed on another,
   *  because the symptom of a mismatch is a neighbouring cell's colliders, not missing ones. */
  bakedCollision?: BakedCollisionSource;
  cellSize: number;
  /**
   * Give the procedural clutter (grass, rocks, cacti) COLLIDERS at all.
   *
   * A renderer that does not DRAW the clutter must not collide it either — that is this file's own rule
   * ("no invisible obstacles"). And the price is not theoretical: with none of the knobs below set, the
   * countryside handed Rapier **9 803 static bodies**, which measured **17 ms per step** and drove the
   * fixed-step loop into a catch-up spiral (12 fps, standing still, on an empty screen). Default: on.
   */
  clutterColliders?: boolean;
  /** Standalone script-gated binary IPL groups to load (plan 042) — the world-state choice
   *  vanilla makes via mission-script LOAD_IPL/REMOVE_IPL (e.g. `truthsfarm`, `barriers1`). */
  extraIpl?: readonly string[];
  /** The asset source (plan 050) — all models/textures/data are read from here, not fetched. */
  fs: AssetFileSystem;
  /** **Currently INERT.** The build hook mods rode (`decoratePart`) died with the three cell builder in
   *  074/13; the engine welds cells offline, so nothing reads this yet. Kept as the declared extension
   *  point — passing mods here has no effect until one is re-wired. */
  mods?: readonly WorldMod[];
  /** Effective clutter density per category (0 when disabled) — keeps clutter COLLISION in sync
   *  with the rendered set. On a knob change, call {@link GtaSaWorldAdapter.invalidateColliderCache}
   *  and re-stream physics. Default: vanilla density 1 for every category. */
  procObjDensityOf?: (category: ProcObjCategoryName) => number;
  /** Hard cap on clutter instances per cell — over the limit, the highest-lottery placements
   *  are simply not RENDERED and therefore not collided either (one budget drives both; lowest
   *  lotteries win). The vanilla CProcObjectMan pools at ~300 for the same perf reason.
   *  Default: unlimited. */
  procObjLimit?: number;
  /** Slope-aware candidate density (plan 011): per category, a multiplier on how many candidates a STEEP or a
   *  FLAT collision face generates. The SAME config the `sa` bake takes — slope is a per-FACE signal and the
   *  scatter is the only place either target can spend one. Absent = unchanged. */
  /** Where inside a collision triangle a placement lands — `area` (ours, default) or `corner` (the
   *  original's recovered routine). The SAME knob the `sa` bake takes; it is one `sqrt` in the scatter. */
  procObjSampler?: ProcObjSampler;
  procObjSlope?: ProcObjSlopeConfig;
  /** Species floor N (sa-procobj-placement plan 012): while {@link procObjLimit} binds, every clutter
   *  species eligible in the cell keeps at least `min(N, its eligible count)` placements instead of
   *  possibly none — paid for at the top of the lottery order, so the budget itself is unchanged.
   *  Default: 0 (OFF — the plain cap, byte-identical to not passing it). */
  procObjSpeciesFloor?: number;
}

type Rgb = [number, number, number];

/** Resolved carcol paint (RGB per slot); 3rd/4th present only for 4-colour cars. */
interface VehiclePaint {
  primary: [number, number, number];
  quaternary?: [number, number, number];
  secondary: [number, number, number];
  tertiary?: [number, number, number];
}

/**
 * Bridges the generic engine to GTA SA / renderware. Downloads the WIMG archive
 * and resolves the map, then builds instanced regions and reports picked objects.
 * The −90°X (GTA Z-up → three Y-up) lives here, not in the engine.
 */
/** Per-slice main-thread budget for the cooperative cell build (plan 060 Phase 3). */

export class GtaSaWorldAdapter implements WorldAdapter {
  readonly cellSize: number;

  /** The pak's baked collision (plan 200/3-01), or null when this pak carries none. */
  private readonly baked: BakedCollisionSource | null;
  /** Lowercased model names that "smash" per object.dat but carry no RW Breakable atomic (plan 045) —
   *  their shatter mesh is synthesized from the render geometry. Built in {@link prepare}. */
  private readonly breakableModels = new Set<string>();
  /** `cargrp.dat` groups for random map-car resolution (plan 059); null when absent. */
  private carGroups: CarGroup[] | null = null;
  /** Per-cell colliders, cached as the PROMISE so two callers asking for the same cell share one build
   *  (the baked path awaits a pak read, so a second ask can arrive while the first is in flight). */
  private readonly colliderCache = new Map<string, Promise<ModelColliders[]>>();
  private readonly config: GtaSaWorldConfig;
  /** Catalog defs by lowercased model name — resolves procobj clutter models to their TXDs. */
  private defByName: Map<string, IdeObjectDef> | null = null;
  private defs: MapDefinitions | null = null;
  private readonly fs: AssetFileSystem;
  private grid: null | WorldGrid = null;
  /** Parsed `handling.cfg`, kept for the later vehicle-physics phase. */
  private handling: Map<string, HandlingEntry> | null = null;
  /** Model-name search index (plan 094/05), built on the first debug search — the game never asks for it. */
  private modelIndexCache: ModelIndex | null = null;
  /** Parsed `object.dat` collision-damage tuning by lowercased model (plan 045); null when absent. */
  private objectDat: Map<string, ObjectDatEntry> | null = null;
  /** Parsed `peds.ide` defs by lowercased model name (TEMP: resolves the env-picked main character). */
  private peds: null | ReturnType<typeof parsePedDefs> = null;
  /** undefined = not parsed yet; null = no usable plate rasters in this game's dictionary. */
  private plateSourcesCache: null | PlateSources | undefined = undefined;
  /** `popcycle.dat` zone-types for random map-car resolution (plan 059); null when absent. */
  private popcycle: Map<string, PopcycleZone> | null = null;
  /** Whether {@link ensurePopulationData} has run (popcycle/cargrp may legitimately be absent → null). */
  private populationLoaded = false;
  /** Memoized scatter per cell (074/19): the render (engine clutter) AND collider paths share it, so ONE
   *  scatter drives both — the render/collision divergence that cost 17 ms/step cannot recur. */
  private readonly procObjBatchCache = new Map<string, null | readonly ProcObjBatch[]>();
  /** procobj.dat rules by surface name; null when the data files are absent (no scatter). */
  private procObjRules: Map<string, ProcObjRule[]> | null = null;
  /** Surface-name table from surfinfo.dat (index = COL material id); pairs with procObjRules. */
  private surfaceNames: null | string[] = null;
  private surfaceTable: null | SurfaceInfo[] = null;
  private tyreAdhesionTable: null | { perMaterial: Float32Array; road: number } = null;
  private vehicleColours: null | VehicleColours = null;
  private vehicleDefs: Map<string, VehicleDef> | null = null;

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
    this.fs = config.fs;
    // The grid check is the whole guard against the trap this bake has: collision streams on the GAME grid
    // (256) while the pak's render cells are 250, and a bake keyed on the other one hands back a
    // NEIGHBOURING cell's colliders — the world renders correctly and the player falls through parts of it.
    // See `docs/restrictions/architecture.md`.
    if (config.bakedCollision !== undefined && config.bakedCollision.cellSize !== config.cellSize) {
      throw new Error(
        `baked collision is keyed on a ${config.bakedCollision.cellSize}-unit grid but collision streams on ` +
          `${config.cellSize} — the pak was baked for a different grid, and using it would place every ` +
          `collider in the wrong cell`,
      );
    }
    this.baked = config.bakedCollision ?? null;
    this.cellSize = config.cellSize;
  }

  /**
   * Every ANIMATED map object placed on the map (074/08 B7·b): garage doors, windmills, the spinning signs.
   * There are only ~64 of them map-wide, so the host holds the whole list and spawns the ones in range —
   * no per-cell streaming machinery for a set this small.
   */
  animatedPlacements(): AnimatedPlacement[] {
    if (!this.defs) {
      return [];
    }
    const placed: AnimatedPlacement[] = [];
    for (const instance of this.defs.instances) {
      const def = this.defs.catalog.get(instance.id);
      if (def?.anim === undefined) {
        continue;
      }
      placed.push({
        anim: def.anim,
        modelName: def.modelName,
        position: [...instance.position],
        rotation: [...instance.rotation],
        txdName: def.txdName,
      });
    }

    return placed;
  }

  /** `object.dat` collision-damage tuning for a model (plan 045), or undefined when absent. The
   *  break system gates on RW Breakable mesh data; this only tunes the impact threshold + marks
   *  indestructible (huge-mass) props. */
  breakableInfo(modelName: string): ObjectDatEntry | undefined {
    return this.objectDat?.get(modelName.toLowerCase());
  }

  /**
   * Renderer-agnostic procedural clutter for a cell (074/19 B7·d), for the own-engine host to render INSTANCED.
   * Uses the SAME memoized scatter and the SAME per-category density × `procObjLimit` cap as the colliders, so
   * what the engine draws is exactly what physics collides — one budget, no divergence. GTA-space matrices (the
   * host applies the axis change); empty before the map is ready or where nothing scatters.
   */
  cellClutter(cx: number, cy: number): CellClutterRender[] {
    const batches = this.cellProcObjBatches(cx, cy);
    if (!batches || batches.length === 0 || !this.defByName) {
      return [];
    }
    const keep = this.cellProcObjBudget(batches);
    const out: CellClutterRender[] = [];
    const matrix = new Matrix4();
    for (let at = 0; at < batches.length; at += 1) {
      const batch = batches[at];
      const def = this.defByName.get(batch.model);
      if (!def) {
        continue;
      }
      const breakable = this.isClutterBreakable(def.modelName);
      const floats: number[] = [];
      const hashes: number[] = [];
      for (let i = 0; i < keep[at]; i += 1) {
        const elements = placementMatrix(batch.placements[i], matrix).elements;
        floats.push(...elements);
        if (breakable) {
          // 074/20: the SAME key the collider carries (tagBreakable also reads the matrix translation).
          hashes.push(
            breakableKeyHash(breakableInstanceKey(def.modelName, [elements[12], elements[13], elements[14]])),
          );
        }
      }
      if (floats.length > 0) {
        out.push({
          ...(breakable ? { keyHashes: new Uint32Array(hashes) } : {}),
          category: batch.category,
          matrices: new Float32Array(floats),
          modelName: def.modelName,
          txdName: def.txdName,
        });
      }
    }

    return out;
  }

  /** `0A01 IS_THIS_MODEL_A_CAR` (plan 097/05): the id names a car-class vehicle — the same
   *  car/bike split SA draws (bikes, boats, planes and helis answer no). */
  cleoIsCarModelId(id: number): boolean {
    for (const vehicle of this.vehicleDefs?.values() ?? []) {
      if (vehicle.id === id) {
        return vehicle.type === 'car' || vehicle.type === 'mtruck' || vehicle.type === 'quad';
      }
    }

    return false;
  }

  /** CLEO model resolution, id-first (plan 097/04 decision 2): the IDE catalog composed with
   *  `vehicles.ide` — scripts request map objects AND vehicles by the same id space. Null before the
   *  map defs load, or when nothing carries the id. */
  cleoModelById(id: number): null | { drawDistance: number; modelName: string; txdName: string } {
    const def = this.defs?.catalog.get(id);
    if (def) {
      return { drawDistance: def.drawDistance, modelName: def.modelName, txdName: def.txdName };
    }
    for (const vehicle of this.vehicleDefs?.values() ?? []) {
      if (vehicle.id === id) {
        return { drawDistance: 300, modelName: vehicle.model, txdName: vehicle.txd };
      }
    }

    return null;
  }

  /** CLEO model resolution, name-first (`GET_MODEL_BY_NAME 0E9C` gives names — Wind Farm uses it). */
  cleoModelIdByName(name: string): null | number {
    const def = this.defByName?.get(name.toLowerCase());
    if (def) {
      return def.id;
    }
    const vehicle = this.vehicleDefs?.get(name.toLowerCase());

    return vehicle ? vehicle.id : null;
  }

  /** Drop the cached per-cell colliders (clutter knobs changed) — the collision streaming system
   *  then re-streams physics via {@link loadCellColliders}, rebuilding with the new density. */
  invalidateColliderCache(): void {
    this.colliderCache.clear();
    this.procObjBatchCache.clear();
  }

  listCells(): CellCoord[] {
    if (!this.grid) {
      return [];
    }

    return [...this.grid.values()].map((cell): CellCoord => [cell.cx, cell.cy]);
  }

  /**
   * Load the timecyc (per-weather, per-hour colour/lighting table), always as 24h. The file is whichever
   * of {@link TIMECYC_SOURCES} the game dir carries first; `ensure24h` decides by row count, so an
   * authored 24h table (504 or 552 rows) passes through and the stock 8-keyframe one is expanded.
   */
  async loadTimecyc(): Promise<Timecyc> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    const source = resolveTimecycSource((path) => this.fs.getText(path));
    if (source === null) {
      throw new Error(`asset not found: ${TIMECYC_SOURCES.map((c) => c.path).join(' / ')}`);
    }

    return buildTimecyc(ensure24h(parseTimecyc(source.text)));
  }

  /**
   * Spawn data for one car, read straight out of its converted `<model>.osm` (opensa-pack 003 phase 3) — a
   * section read, no RW parser entered.
   *
   * There is no runtime `.dff` path. It existed for a `modloader/` override, and everything a car now needs
   * beyond its raw geometry is decided at BUILD time — its `features.txt` pod declaration, its plate slots,
   * its baked occlusion — none of which can be recovered from a DFF the engine parses for itself. A car with
   * no `.osm` would therefore not be a slower spawn but a WRONG one, so it is an error instead: opensa-pack
   * names every car it failed to convert in its report, and `vehicle-installer --rebake` re-converts one.
   */
  async loadVehicleData(modelName: string, colour?: string): Promise<EngineVehicleData> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const def = this.vehicleDefs?.get(name);
    if (!def) {
      throw new Error(`No vehicle definition for '${modelName}' in vehicles.ide`);
    }
    const osm = this.fs.get(`${name}.osm`);
    if (!osm) {
      throw new Error(`No converted model for '${name}' — '${name}.osm' is missing from this build`);
    }
    // Everything past the await runs between frames (plan 091 phase 2) — the section read and the parse
    // report themselves, or a spawn's cost shows up only as the frame that got longer.
    const vehicle = frameSpans.measure(`vehicle-osm:${name}`, () => readVehicleOsm(name, new Uint8Array(osm)));

    return {
      colliders: vehicle.colliders,
      halfExtents: vehicle.halfExtents,
      handling: this.vehicleHandling(def.handlingId),
      model: vehicle.model,
      paint: enginePaint(this.resolveVehicleColours(name, colourIndices(colour))),
      rig: vehicle.rig,
      seat: vehicle.seat,
      wheels: vehicle.wheels,
    };
  }

  // eslint-disable-next-line
  async loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]> {
    const key = `${cx},${cy}`;
    let pending = this.colliderCache.get(key);
    if (pending === undefined) {
      // The cache holds the PROMISE, not the result: with a baked pak this path awaits a range read, so two
      // callers wanting the same cell (the streamer and the debug wireframe) would otherwise build it twice.
      // A rejected read is evicted — a poisoned key that can never be retried is a failure mode this project
      // has already paid for once (the stuck-at-LOD blob mark).
      pending = this.assembleColliders(cx, cy);
      pending.catch(() => this.colliderCache.delete(key));
      this.colliderCache.set(key, pending);
    }

    return pending;
  }

  /**
   * The map's specific-model car generators (binary IPL `CARS` sections in gta3.img) as parked-car placements
   * for the vehicle LOD system. `id → model` is resolved from `vehicles.ide`; random (`id = -1`) generators are
   * skipped (cargrp/popcycle resolution is a later phase — plan 059). Empty until {@link prepare} resolved the map.
   */
  async mapCarGenerators(options: {
    cityAt: (x: number, y: number) => City;
    hour: number;
  }): Promise<VehiclePlacement[]> {
    await this.ensureVehicleData();
    await this.ensurePopulationData();
    const generators = this.defs?.carGenerators ?? [];
    const modelById = new Map<number, string>();
    for (const def of this.vehicleDefs?.values() ?? []) {
      modelById.set(def.id, def.model.toLowerCase());
    }
    const specific = carGeneratorPlacements(generators, modelById);
    if (this.popcycle === null || this.carGroups === null) {
      return specific; // no popcycle/cargrp shipped → only the specific-model generators
    }
    // Random (id = -1) generators: resolve via the zone-type popcycle weights → a cargrp model (B1, plan 059).
    const popcycle = this.popcycle;
    const random = randomCarPlacements(generators, {
      accept: (model) => this.vehicleDefs?.has(model) ?? false,
      cargrp: this.carGroups,
      hour: options.hour,
      popcycleFor: (position) => popcycle.get(CITY_POPCYCLE_ZONE[options.cityAt(position[0], position[1])]) ?? null,
    });

    return [...specific, ...random];
  }

  /**
   * The debugger's model-name search index (plan 094/05) over the SAME `MapDefinitions` the map was built
   * from, so a name it finds is a name the world places. Built on first use and kept: it is a debug-only
   * path, and the game asks for it exactly never. Null before {@link GtaSaWorldAdapter.prepare}.
   */
  modelIndex(): ModelIndex | null {
    if (!this.defs) {
      return null;
    }
    this.modelIndexCache ??= new ModelIndex(this.defs);

    return this.modelIndexCache;
  }

  /**
   * The renderer-agnostic vehicle load (074/08 B5 step 4): geometry the OWN ENGINE uploads as a model (one
   * per car type — instances share it), plus collision, handling and paint.
   *
   * Two paths converge here (opensa-pack 003): the OPTIMIZED `.osm`/`.ostex` read, and the UNOPTIMIZED
   * DFF/TXD parse below it. The caller cannot tell which ran, and must not need to.
   */
  /**
   * The license-plate rasters (plan 082), parsed ONCE from the same `models/generic/vehicle.txd` this
   * adapter already merges into every car's texture chain. Null when the dictionary is missing or a mod
   * replaced it past recognition — plates then stay stock rather than taking the boot down.
   */
  plateSources(): null | PlateSources {
    if (this.plateSourcesCache === undefined) {
      const generic = this.fs.get('models/generic/vehicle.txd');
      this.plateSourcesCache = generic ? extractPlateSources(parseTxd(generic)) : null;
    }

    return this.plateSourcesCache;
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.defs = resolveMap(this.fs, { extraIpl: this.config.extraIpl });
    // The IDE `txdp` links, handed to the asset cache so runtime-parsed TXDs inherit from their parents
    // (opensa-pack 003). Anything opensa-pack converted had its chain flattened offline; this serves the
    // unoptimized path, where a modded TXD with a parent would otherwise lose the inherited textures.
    setTxdParents(this.defs.txdParents);
    this.grid = buildWorldGrid(this.defs, this.cellSize);
    this.defByName = new Map([...this.defs.catalog.values()].map((def) => [def.modelName.toLowerCase(), def]));
    // Procedural ground clutter (plan 042): both data files present → cells scatter; else skipped.
    const procObjText = this.fs.getText('data/procobj.dat');
    const surfInfoText = this.fs.getText('data/surfinfo.dat');
    if (procObjText !== null && surfInfoText !== null) {
      this.procObjRules = groupRulesBySurface(parseProcObj(procObjText));
      this.surfaceNames = parseSurfaceNames(surfInfoText);
    }
    // The full table is read whenever the file is there, procobj or not: what a WHEEL stands on has nothing
    // to do with whether ground clutter scatters (plan 081/10).
    if (surfInfoText !== null) {
      this.surfaceTable = parseSurfaceInfo(surfInfoText);
      this.tyreAdhesionTable = tyreAdhesionPerMaterial(this.surfaceTable, this.fs.getText('data/surface.dat'));
    }
    // Breakable-prop tuning (plan 045) — absent-tolerant: no file, props still break at the default
    // threshold (the break gate is the RW Breakable mesh, not this table).
    const objectDatText = this.fs.getText('data/object.dat');
    if (objectDatText !== null) {
      this.objectDat = parseObjectDat(objectDatText);
      // The SAME gate the converter records smashable ranges with — one definition, or the two disagree.
      for (const name of breakableModelsOf(this.objectDat)) {
        this.breakableModels.add(name);
      }
    }
    onProgress?.(1);
  }

  /** The `surfinfo.dat` table, indexed by collision material id (plan 081/10) — null before `prepare`, or
   *  when the world ships no such file. The parsed rows already ARE the engine-side shape. */
  surfaces(): null | readonly SurfaceRecord[] {
    return this.surfaceTable;
  }

  /** The model's TXD name — the own engine needs it to texture a smashed prop's shards (074/08 B7·a). */
  txdOf(modelName: string): string | undefined {
    return this.defByName?.get(modelName.toLowerCase())?.txdName;
  }

  /** What a TYRE grips on each collision material (plan 081/10): `surface.dat`'s rubber row resolved through
   *  each surface's adhesion group, indexed by material id. Null when either data file is missing — and then
   *  the physics keeps its road-only constant rather than guessing. */
  tyreAdhesion(): null | { perMaterial: Float32Array; road: number } {
    return this.tyreAdhesionTable;
  }

  /** Every carcol paint combo for a model (palette-index tuples) — 2-colour entries then 4-colour;
   *  empty if the car has none. Lets callers cycle paint on repeated spawns (each combo is its OWN car's). */
  async vehicleColourCombos(modelName: string): Promise<number[][]> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const colours = this.vehicleColours;

    return [...(colours?.cars.get(name) ?? []), ...(colours?.cars4.get(name) ?? [])].map((combo) => [...combo]);
  }

  /** The shared generic `vehicle.txd` texture map, parsed once. */
  /**
   * Resolve JUST a car's carcols paint (074/08 B5) — the own engine shares ONE uploaded model across every
   * car of a type and paints each instance, so a spawn needs the colours without re-parsing the DFF.
   */
  async vehiclePaint(modelName: string, colour?: string): Promise<EngineVehicleData['paint']> {
    await this.ensureVehicleData();
    const indices = colour
      ? colour
          .split(',')
          .map((cell) => Number(cell.trim()))
          .filter((value) => Number.isFinite(value))
      : undefined;
    const paint = this.resolveVehicleColours(modelName.toLowerCase(), indices);

    return {
      primary: scale255(paint.primary),
      quaternary: scale255(paint.quaternary ?? paint.secondary),
      secondary: scale255(paint.secondary),
      tertiary: scale255(paint.tertiary ?? paint.primary),
    };
  }

  /**
   * One cell's colliders: the pak's BAKE when it carries one for this cell (plan 200/3-01), the COL bind
   * otherwise — plus the procedural clutter, which both paths share.
   *
   * The two branches must agree shape for shape: `.oscol` was written by the converter from the same
   * `RegionColliders` the COL branch builds here, with `toModelColliders` as the bake's test oracle
   * (`tools/opensa-pack/src/pack-collision.test.ts`).
   */
  private async assembleColliders(cx: number, cy: number): Promise<ModelColliders[]> {
    const { defs, grid } = this;
    if (!defs || !grid) {
      throw new Error('GtaSaWorldAdapter.loadCellColliders called before prepare()');
    }
    const bytes = this.baked?.has(cx, cy) === true ? await this.baked.read(cx, cy) : null;
    if (bytes !== null) {
      // Everything from here runs in a promise CONTINUATION — between frames, where no loop timer reaches —
      // so it times itself into a span (plan 091 phase 2). The Rapier build that used to be timed here
      // alongside it (`cell-collision-bodies`) is drained inside the loop's `collision` block since 200/3-02.
      // The regions are used AS WRITTEN: the bake already decided which models shatter, and re-asking would
      // open a DFF per model — the archive read this whole path exists to avoid.
      const baked = frameSpans.measure('cell-collision-decode', () => {
        const models = readBakedCell(bytes);

        return models === null ? null : [...models, ...this.clutterColliders(cx, cy)];
      });
      if (baked !== null) {
        return baked;
      }
      // A container this reader cannot read (a pak from an older writer): fall through to COL, having said so.
    }
    // NO SPAN HERE. This looks like out-of-loop work and is not: with no bake to await, the body runs
    // synchronously to the end, and the only caller in a normal run is `CollisionStreamingSystem.load()`,
    // inside `collision.update()` — which the frame loop already times as its `collision` block. A span
    // would be subtracted from `dt` a second time; the field drive of 2026-08-02 read
    // `collision 76.0 · other 30.0 (cell-collision-read 75.7 … unattributed -65.9)` for exactly that
    // reason. See `docs/restrictions/architecture.md` and 091's field verdict.
    const index = buildCollisionIndex(this.fs);

    return [
      ...buildCellColliders(index, defs, grid, cx, cy).map((region) =>
        this.withBreakableKeys(toModelColliders(region)),
      ),
      ...this.clutterColliders(cx, cy),
    ];
  }

  /** Deterministic clutter batches for one cell (plan 042), or null when the procobj data files
   *  were absent. Shared by the render path (loadCell) and the collider path (loadCellColliders) —
   *  same inputs give byte-identical batches, so visuals and collision always agree. */
  private cellProcObjBatches(cx: number, cy: number): null | readonly ProcObjBatch[] {
    if (!this.defs || !this.grid || !this.procObjRules || !this.surfaceNames) {
      return null;
    }
    const key = `${cx},${cy}`;
    const cached = this.procObjBatchCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const colliders = buildCellColliders(buildCollisionIndex(this.fs), this.defs, this.grid, cx, cy);
    const batches = scatterProcObjects(colliders, this.procObjRules, this.surfaceNames, cx, cy, undefined, {
      sampler: this.config.procObjSampler,
      slope: this.config.procObjSlope,
    });
    this.procObjBatchCache.set(key, batches);

    return batches;
  }

  /** The cell's clutter budget as one keep-count per batch — the SINGLE place the density knobs, the
   *  `procObjLimit` cap and the species floor are resolved, so the render path and the collider path
   *  spend the same decision and can never diverge. Cheap enough to recompute (the knobs are live). */
  private cellProcObjBudget(batches: readonly ProcObjBatch[]): number[] {
    return procObjCellBudget(batches, {
      densityOf: this.config.procObjDensityOf,
      limit: this.config.procObjLimit,
      speciesFloor: this.config.procObjSpeciesFloor,
    });
  }

  /**
   * Clutter collision (plan 042): models that ship a COL collide (rocks/cacti/trees); grass and flower
   * patches have none, so they stay walk-through — like vanilla. The collidable subset follows the live
   * per-category density (no invisible obstacles) — and a renderer that draws no clutter at all asks for
   * none of it.
   *
   * **The bake does not cover this**, and that is why a baked cell still touches the COL index: the scatter
   * is seeded per cell from the cell's own collision surfaces, and its density cutoff is a LIVE knob.
   */
  private clutterColliders(cx: number, cy: number): ModelColliders[] {
    const batches = this.config.clutterColliders === false ? null : this.cellProcObjBatches(cx, cy);
    if (!batches) {
      return [];
    }
    // The budget comes from {@link cellProcObjBudget} and never from a second computation here: the render
    // path spends the same decision, and a collider set built off its own density read is an invisible
    // obstacle nobody can see (upstream centralised this 2026-08-09; the divergence it removes is silent).
    const clutter = procObjColliders(buildCollisionIndex(this.fs), batches, {
      keep: this.cellProcObjBudget(batches),
    });

    // Breakable clutter (074/20): 6 of 56 procobj models shatter (cactus/rubble/rock) — tag their colliders
    // with the SAME per-instance key the render carries, so a hit resolves to the instance to degenerate.
    return clutter.map((region) => this.withBreakableKeys(toModelColliders(region)));
  }

  /** Lazily load popcycle.dat + cargrp.dat for random map-car resolution (plan 059) — absent-tolerant: either
   *  missing leaves its field null, so a game without them simply spawns no random map cars. */
  private async ensurePopulationData(): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.populationLoaded) {
      return;
    }
    this.populationLoaded = true;
    const popcycle = this.fs.getText('data/popcycle.dat');
    const cargrp = this.fs.getText('data/cargrp.dat');
    this.popcycle = popcycle === null ? null : parsePopcycle(popcycle);
    this.carGroups = cargrp === null ? null : parseCarGroups(cargrp);
  }

  /** Lazily fetch + parse vehicles.ide, carcols.dat and handling.cfg (cached). */
  private async ensureVehicleData(): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.vehicleDefs && this.vehicleColours && this.handling) {
      return;
    }
    const ide = requireText(this.fs, 'data/vehicles.ide');
    const carcols = requireText(this.fs, 'data/carcols.dat');
    const handling = requireText(this.fs, 'data/handling.cfg');
    this.vehicleDefs = parseVehicleDefs(ide);
    this.vehicleColours = parseCarcols(carcols);
    this.handling = parseHandling(handling); // stored for the later vehicle-physics phase
  }

  /** A model that shatters (plan 045 / 074/20): a DFF Breakable shatter mesh or an object.dat smash effect.
   *  ONE gate for map props and clutter alike — the render registry keys both the same way. */
  private isClutterBreakable(name: string): boolean {
    return getBreakable(this.fs, name) !== undefined || this.breakableModels.has(name);
  }

  /** First carcol combo for a model → primary/secondary RGB (falls back to white).
   *  Missing 3rd/4th colours default to palette index 0 (black), like SA does for 2-colour cars. */
  private resolveVehicleColours(name: string, indices?: number[]): VehiclePaint {
    const colours = this.vehicleColours;
    const white: [number, number, number] = [255, 255, 255];
    const rgb = (index: number): [number, number, number] => colours?.palette[index] ?? white;
    const paint = (combo: readonly number[]): VehiclePaint => ({
      primary: rgb(combo[0]),
      quaternary: rgb(combo[3] ?? 0),
      secondary: rgb(combo[1] ?? combo[0]),
      tertiary: rgb(combo[2] ?? 0),
    });

    // Explicit carcols indices (e.g. '37,37' / '0,6,3,0') win.
    if (indices && indices.length > 0) {
      return paint(indices);
    }
    const combo = colours?.cars.get(name)?.[0];
    if (combo) {
      return paint(combo);
    }
    const combo4 = colours?.cars4.get(name)?.[0];
    if (combo4) {
      return paint(combo4);
    }

    return { primary: white, secondary: white };
  }

  /**
   * Driving feel for a handling id — the WHOLE row, typed (plan 081/02).
   *
   * Indices are the game's own column order, pinned by tests against real rows rather than by the file's
   * legend (which lists a "(not used)" column the shipped data does not carry). Values pass through as
   * authored: what a number becomes — a force, a spring rate, a top speed — is the consuming plan's
   * decision, made with its own evidence.
   *
   * The fallback row is a mid-range sedan, used when a car has no handling entry at all. It is deliberately
   * bland: a missing row should drive dully, never surprisingly.
   */
  private vehicleHandling(handlingId: string): VehicleHandling {
    const fields = this.handling?.get(handlingId)?.fields;
    const num = (index: number, fallback: number): number => {
      const value = Number(fields?.[index]);

      return Number.isFinite(value) ? value : fallback;
    };
    const text = (index: number): string => (fields?.[index] ?? '').toUpperCase();
    const drive = text(14);
    const engine = text(15);

    // `modelFlags` is HEX (the file's legend says so in capitals) and its 5th/6th digits are the two axles.
    const modelFlags = Number.parseInt(text(30), 16);

    return {
      abs: num(18, 0) !== 0,
      axleFront: axleSetup(modelFlags, 16),
      axleRear: axleSetup(modelFlags, 20),
      brakeBias: num(17, 0.5),
      brakeDecel: num(16, 8.5),
      centreOfMass: [num(3, 0), num(4, 0), num(5, 0)],
      collisionDamageMult: num(28, 1),
      dragMult: num(2, 2),
      drive: drive === 'F' || drive === 'R' ? drive : '4',
      engineAccel: num(12, 22),
      engineInertia: num(13, 20),
      engineType: engine === 'D' || engine === 'E' ? engine : 'P',
      gears: num(10, 5),
      mass: num(0, 1500),
      maxVelocity: num(11, 160),
      steeringLock: num(19, 30),
      suspAntiDive: num(26, 0),
      suspBias: num(25, 0.5),
      suspDamping: num(21, 0.1),
      suspForce: num(20, 0.9),
      suspHighSpeedDamp: num(22, 0),
      suspLower: num(24, -0.15),
      suspUpper: num(23, 0.3),
      tractionBias: num(9, 0.5),
      tractionLoss: num(8, 0.85),
      tractionMult: num(7, 0.75),
      turnMass: num(1, 3000),
    };
  }

  /** A model's colliders with the breakable-prop instance keys attached when the model shatters (plan 045),
   *  so a smashed prop's one static body can be dropped — keyed exactly the way the render registry keys the
   *  placement. A pass-through for everything else. */
  private withBreakableKeys(model: ModelColliders): ModelColliders {
    return tagBreakable(model, this.isClutterBreakable(model.name));
  }
}

export function toModelColliders({ col, name, transforms }: RegionColliders): ModelColliders {
  const indices = new Uint32Array(col.faces.length * 3);
  // One surface byte per TRIANGLE, in the same order as the indices — this is what makes a wheel able to
  // ask what it is standing on (plan 081/10). A byte per triangle beside twelve per vertex is free.
  const materials = new Uint8Array(col.faces.length);
  col.faces.forEach((face, i) => {
    indices[i * 3] = face.a;
    indices[i * 3 + 1] = face.b;
    indices[i * 3 + 2] = face.c;
    materials[i] = face.material;
  });

  return {
    name,
    shape: {
      boxes: col.boxes.map((box) => ({ material: box.surface.material, max: box.max, min: box.min })),
      indices,
      materials,
      spheres: col.spheres.map((sphere) => ({
        center: sphere.center,
        material: sphere.surface.material,
        radius: sphere.radius,
      })),
      vertices: col.vertices,
    },
    transforms,
  };
}

/** Tag a model's collider placements with breakable instance keys (plan 045); a pass-through for
 *  non-breakable models. The key matches the render registry's (model + cm-rounded translation). */
/**
 * The tyre-adhesion lookup the physics uses (081/10): one absolute number per collision material — SA's
 * `surface.dat` rubber row (road 4.5 · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8) resolved through each
 * surface's adhesion group. Built ONCE here, where both files are already parsed, so the per-step path is a
 * single array index with no strings and no map.
 *
 * Null when `surface.dat` is absent: a world that ships no matrix must not be handed a made-up one.
 */
export function tyreAdhesionPerMaterial(
  surfaces: readonly SurfaceInfo[],
  surfaceDat: null | string,
): null | { perMaterial: Float32Array; road: number } {
  if (surfaceDat === null) {
    return null;
  }
  const matrix = parseSurfaceAdhesion(surfaceDat);
  const road = matrix.get('rubber', 'road');
  if (road === null) {
    return null;
  }
  const perMaterial = new Float32Array(surfaces.length);
  surfaces.forEach((surface, material) => {
    // An unknown group falls back to ROAD — the surface a car normally drives on, so an unmapped material
    // behaves exactly as it does today rather than becoming mysteriously slippery.
    perMaterial[material] = matrix.get('rubber', surface.adhesionGroup) ?? road;
  });

  return { perMaterial, road };
}

/**
 * One axle's build out of the `modelFlags` nibble at `shift` (16 = front, 20 = rear) — see {@link AxleSetup}.
 *
 * A row that authors two types at once (none of the 210 stock ones do) is read in the order the game lists
 * them, and an unreadable column reads as `independent`: a missing flag must never invent an axle.
 */
function axleSetup(modelFlags: number, shift: number): AxleSetup {
  const nibble = Number.isFinite(modelFlags) ? (modelFlags >>> shift) & 0xf : 0;
  const type: AxleType = nibble & 0x1 ? 'notilt' : nibble & 0x2 ? 'solid' : nibble & 0x4 ? 'mcpherson' : 'independent';

  return { reverse: (nibble & 0x8) !== 0, type };
}

/** Convert renderware collision (COL model + placements) to the engine's generic shape. */
/** A `colour` override string (`"1,2"`) as carcols palette indices, or undefined for the model's default. */
function colourIndices(colour?: string): number[] | undefined {
  return colour
    ? colour
        .split(',')
        .map((cell) => Number(cell.trim()))
        .filter((value) => Number.isFinite(value))
    : undefined;
}

/**
 * Carcols bytes → the engine's 0..1 `setPaint` space. The same values the builder writes into the
 * non-marker vertex colours, so a painted panel and a plain one sit in the same colour space.
 */
function enginePaint(paint: VehiclePaint): EngineVehicleData['paint'] {
  return {
    primary: scale255(paint.primary),
    quaternary: scale255(paint.quaternary ?? paint.secondary),
    secondary: scale255(paint.secondary),
    tertiary: scale255(paint.tertiary ?? paint.primary),
  };
}

/** Read a required text asset from the file system (throws if absent). */
function requireText(fs: AssetFileSystem, name: string): string {
  const text = fs.getText(name);
  if (text === null) {
    throw new Error(`asset not found: ${name}`);
  }

  return text;
}

/** Read a required binary asset from the file system (throws if absent). */
/** carcols bytes → the engine's 0..1 colour space. */
function scale255(rgb: readonly [number, number, number]): Rgb {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function tagBreakable(model: ModelColliders, isBreakable: boolean): ModelColliders {
  if (!isBreakable) {
    return model;
  }
  const instanceKeys = model.transforms.map((matrix) =>
    breakableInstanceKey(model.name, [matrix.elements[12], matrix.elements[13], matrix.elements[14]]),
  );

  return { ...model, instanceKeys };
}
