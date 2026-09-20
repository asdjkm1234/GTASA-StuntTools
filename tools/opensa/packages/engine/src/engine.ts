/**
 * The M0 engine facade (plan 074/01): device + enumerated pipelines + texture arrays + cell bundles + ONE
 * MSAA pass (opaque/cutout world, flat sky clear) with per-pass GPU timestamps. Later milestones grow the
 * fixed frame graph (sky/transparent/water/post) — the facade's API stays.
 */
import type { OspakUvAnimation } from '@opensa/engine-formats';

import { cameraProjection } from './core/camera';
import { configureCanvas, describeDevice, type EngineDevice, initDevice } from './core/device';
import {
  frustumFromViewProj,
  frustumIntersectsSphere,
  type Mat4,
  mat4Identity,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  sphereFullyBeyond,
  type Vec3,
} from './core/math';
import { uploadOstexTexture } from './core/ostex-upload';
import { Resources } from './core/resources';
import { FrameSpans, type FrameSpanTotals } from './debug/frame-spans';
import { GpuTimers } from './debug/gpu-timers';
import { RigidEntity, type RigidPartInit } from './entities/rigid';
import { type DynamicParticleLibrary, DynamicParticles } from './render/dynamic-particles';
import {
  compileAll,
  MSAA_SAMPLES,
  type PipelineId,
  pipelineIdFor,
  type PipelineSet,
  SCENE_FORMAT,
} from './render/pipelines';
import { EnvProbe, PROBE_RANGE } from './render/probe';
import { SkidMarks, type SkidSegment } from './render/skid-marks';
import { buildSkyLut, SKY_LUT_HEIGHT, SKY_LUT_WIDTH, skyLutKey } from './render/sky-lut';
import { stepUvAnimation, UV_ANIM_IDENTITY, UV_ANIM_STRIDE, type UvAnimation, uvAnimOffset } from './render/uv-anim';
import { type CellHandle, CellStore } from './world/cells';
import { TextureArrays } from './world/textures';

// Reversed-Z (z-fighting fix): FLOAT depth + swapped near/far + clear 0 + greater compares — hugely
// better far-field precision (SA signs sit centimetres off walls hundreds of metres from the camera).
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/**
 * The SA corona billboards from particle.txd (074/06 row 13): layer 0 = `coronastar`, layer 1 = `coronamoon`.
 * Any size — the moon can be swapped for a higher-resolution one without touching the engine.
 */
export interface CoronaSprites {
  height: number;
  layers: number;
  /** RGBA8 layers, all one size, packed sequentially. */
  rgba: Uint8Array;
  width: number;
}

/** Corona instance cap per frame (074/06 row 13) — far beyond any district's lamp count. */
const CORONA_CAP = 2048;
/** Cumulus field bake resolution (sky v2 perf) — the fbm is low-frequency, 256² resolves it fully. */
const CLOUD_FIELD_SIZE = 256;
/** timecyc `sunSize` (≈3–5) → angular core radius in radians (~1° at sunSize 4, prod-matched by eye). */
const SUN_SIZE_TO_RAD = 0.0045;
/** Godrays (074/09 stage 1): ray strength, per-tap decay, and the bright-pass floor (the sun disc's HDR
 *  overshoot sits at 3–6; lit world pixels stay under ~1.2, so they never feed rays). */
const GODRAY_INTENSITY = 0.9;
const GODRAY_DECAY = 0.93;
const GODRAY_THRESHOLD = 1.25;
/** Bloom (074/09 — prod BloomEffect values): 8 mip levels, tent-blend radius 0.7, threshold knee 0.3. */
const BLOOM_LEVELS = 8;
const BLOOM_RADIUS = 0.7;
const BLOOM_SMOOTHING = 0.3;

export interface CameraState {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  /**
   * Present = draw this frame ORTHOGRAPHICALLY, with a view box this many world units tall (201/7-01);
   * `fovYRad` is then unread. Absent = perspective, which is what every consumer but the map's plan view
   * passes. One field rather than a second camera: the view matrix, the culling and every pass are the
   * same work, and only the projection differs.
   */
  orthoHalfHeight?: number;
  target: Vec3;
  up: Vec3;
}

/** One cell's clutter (074/19): per model, the instance world matrices (16 floats each, engine space). */
export interface CellClutter {
  /**
   * How far this group is visible, world units — the host's per-category number, applied PER INSTANCE in the
   * vertex shader. The clutter grid is 256 units, so a whole-group test could not express a radius smaller
   * than a cell diagonal: standing in one corner would still show the far corner's grass 360 units away.
   */
  drawDistance: number;
  /** Per-instance breakable key hash (074/20), aligned with `matrices`; present only for breakable models
   *  (cactus/rubble/rock). A hit resolves to the hash and `breakClutterInstance` collapses that instance. */
  keyHashes?: Uint32Array;
  matrices: Float32Array;
  model: ClutterModelId;
}

/** Opaque handle returned by `createClutterModel`. */
export type ClutterModelId = number;

/**
 * One procedural-clutter MODEL (074/19 B7·d): a scattered grass/bush/rock mesh, shared by every instance.
 * Geometry is tight per-attribute byte views (the dynamics vertex layout, NOT the .oscell one). `cutout` picks
 * the A2C variant (grass/bushes) vs opaque (rocks). Per-instance placement comes later via `setCellClutter`.
 */
export interface ClutterModelInit {
  colors: Uint8Array; // unorm8x4
  /** Grass/bushes (alpha edges) → A2C cutout; rocks → opaque. */
  cutout: boolean;
  /** uint16 index payload (the shared vehicle-model format). */
  indices: Uint8Array;
  /** The shared vehicle-model meta (uint8x4); only meta.x = texture-array layer is read. */
  meta: Uint8Array;
  /** NIGHT vertex colours (unorm8x4) — every procobj species ships an authored set. */
  night: Uint8Array;
  normals: Uint8Array; // float32x3
  positions: Uint8Array; // float32x3
  /** The model's dictionary: our `.ostex`, or RGBA8 layers from a runtime TXD parse. */
  texture: ModelTextureInit;
  uvs: Uint8Array; // float32x2
}

/** One break, baked (see `renderware/breakable/bake-debris`) and converted to ENGINE space by the host. */
export interface DebrisUpload {
  /** Seconds of fade at the tail of the lifetime. */
  fade: number;
  /** Gravity the shards fall under (engine units/s²) — the shader integrates it analytically. */
  gravity: number;
  lifetime: number;
  /** The shard textures, one layer per draw group; the layer rides in each vertex. */
  texture: ModelTextureInit;
  /** Interleaved, 80 bytes per vertex — the layout the debris pipeline declares. */
  vertices: Float32Array;
}

/** Opaque handle returned by `createDebugLines` (074/13 phase 4). */
export type DebugLineSetId = number;

/**
 * A host-fed corona (074/08 B5 step 5) — vehicle head/tail lamps ride the EXISTING instanced corona pass
 * rather than a second one. Hosts replace `Engine.dynamicCoronas` each frame; already faded/gated by the
 * caller (a lamp's corona dims as you look at it from behind).
 */
export interface DynamicCorona {
  /** Linear RGB. */
  color: readonly [number, number, number];
  /** 0..1 opacity — the caller's facing/brake fade. */
  fade: number;
  position: readonly [number, number, number];
  size: number;
}

/** One CPU-side local light (074/06 row 7); hosts push these into `Engine.dynamicLights` each frame. */
export interface DynamicLight {
  /** Linear RGB × intensity. */
  color: readonly [number, number, number];
  /**
   * SPOT cone (074/08 B5 step 5 — headlight beams v2): the cosine of the half-angle, with the unit
   * `direction` the light points. Omit for a POINT light. A headlight rendered as a point lights the whole
   * street, including the road BEHIND the car — a cone is what makes it a headlight.
   */
  cone?: { cosAngle: number; direction: readonly [number, number, number] };
  position: readonly [number, number, number];
  radius: number;
}

export interface EngineStats {
  cellsTotal: number;
  cellsVisible: number;
  drawsRecorded: number;
  gpuPassMs: number;
  /** Post-chain GPU time (bloom passes + composite), ms — the plan-09 ≤3 ms budget is measured. */
  gpuPostMs: number;
  /** Env-probe span (face render + mips), ms — the plan-16 ≤0.5 ms gate is measured. 0 when skipped. */
  gpuProbeMs: number;
  residencyBytes: number;
  /**
   * Roadsign GLYPH QUADS in the cells drawn this frame (`.oscell` minor 8). Roadsign text welds into an
   * ordinary beam bucket, so nothing downstream can tell it apart — and a 2.4 m plate at LOD range is ~8 px,
   * which is below what a screenshot can be asked. This is the reading that answers "do plates survive to
   * LOD range" (plan 100/03): drive out past the HD boundary and watch whether it holds or falls to zero.
   * Counted per cell at LOAD and summed over VISIBLE cells, exactly like {@link trianglesRecorded}, so it
   * costs one add per cell per frame. 0 on a pre-minor-8 pak means UNKNOWN, not none.
   */
  roadsignQuadsRecorded: number;
  submitMs: number;
  /**
   * Triangles submitted this frame — baked cell bundles (counted at load) plus every out-of-bundle
   * `drawIndexed`, instance counts included. The number the bench reports as `avgTriangles`: it is what
   * separates a geometry problem from a fragment one, so it counts what was SUBMITTED, not what survived
   * the depth test.
   */
  trianglesRecorded: number;
}

export interface Environment {
  /** World ambient floor, linear (timecyc `Amb` — plan 093): SA's building formula ADDS this on top
   *  of the blended prelight, normal-independent, so black-authored shadow verts still read as
   *  shadow instead of a hole. The world/clutter shaders add it; rigid keeps its own indirect. */
  ambientColor: readonly [number, number, number];
  /** Baked AO/skyVis strength on the indirect term (074/07): 0 = off, 1 = raw bake. */
  aoStrength: number;
  /** Bloom strength on the composite (074/09): 0 = off (the chain passes are skipped entirely). */
  bloomIntensity: number;
  /** Bloom luminance threshold (074/09) — hosts drive the prod night profile (0.70 day → 0.38 night). */
  bloomThreshold: number;
  /** Cloud layer alpha 0..1 — how strongly the procedural cirrus + cumulus composite over the sky dome. */
  cloudAlpha: number;
  /** Cloud underside/shadow tint, linear (timecyc `bottomClouds`) — dawn turns the WHOLE deck pink. */
  cloudBottomColor: readonly [number, number, number];
  /** Cloud cover 0..1 — the LUT haze driver, fed per weather (cloud-profile port); NOT the layer alpha. */
  cloudCover: number;
  /** Cloud heaviness 0..1 (storm/fog weathers). */
  cloudDark: number;
  /** Cumulus clump-size multiplier (sky v2 weather identity): >1 = smaller scattered puffs, <1 = big
   *  banks (SMOG clumps, storm decks). Neutral 1. */
  cloudScale: number;
  /** Cloud lit/top tint, linear (timecyc `lowClouds`) — white at noon, warm at golden hours. */
  cloudTopColor: readonly [number, number, number];
  /** 0 day → 1 deep night (the prelit blend). */
  dn: number;
  /** Night-emissive glow strength (lit windows / neon self-illuminate; 0 = off). */
  emissiveBoost: number;
  /** Fog full-fog distance (the horizon cut, engine units). */
  fogCutDistance: number;
  /** Height-fog falloff (1/units) — haze hugs the ground. */
  fogHeightK: number;
  /** Floor of the height attenuation (high geometry keeps at least this much fog). */
  fogHeightMin: number;
  /** Fog ramp start distance. */
  fogStartDistance: number;
  /** Godrays post-pass strength multiplier (0 = off — the config toggle; 1 = default). */
  godrayStrength: number;
  /** Game hour 0..24 — gates the timed objectTable draws (074/06 row 9). */
  hour: number;
  /** Moonlight colour, linear (BLACK by day — the host arc gates it). */
  moonColor: readonly [number, number, number];
  /** Unit direction TOWARDS the moon (engine space). */
  moonDir: readonly [number, number, number];
  /**
   * Moon phase 0..1 (B6): 0 = new, 0.5 = full. The host advances it with the in-game days; the sky shader
   * lights the moon's sphere from it, so the terminator is real rather than a cropped sprite.
   */
  moonPhase: number;
  /** Vehicle reflection strength (B5r) — the global multiplier over the DFF's per-material settings. */
  reflectionStrength: number;
  /** Physical dome exposure (prod `sky.pbrExposure`; 074/09 sky round — 0.25 was a pre-ACES constant). */
  skyExposure: number;
  /** LINEAR sky gradient horizon colour (sky pass + world fog share it). */
  skyHorizon: readonly [number, number, number];
  /** Sky dome radiance model (074/06 row 4): Hosek-Wilkie (default) or the legacy Preetham fit — kept
   *  for A/B (`?sky=preetham`) while the day-sky verdict is out. */
  skyModel: 'hosek' | 'preetham';
  /** SA mood strength: how strongly timecyc's skyTop tints the physical sky (0 = pure physical). */
  skyMood: number;
  /** LINEAR sky gradient zenith colour. */
  skyTop: readonly [number, number, number];
  /** Stochastic de-tiling toggle (074/12): 0 = plain sampling (DEFAULT — field issues pending the
   *  histogram-preserving pass; see plan 12), 1 = 3-tap blend on flagged layers. */
  stochastic: number;
  /** Sun LIGHT colour, linear 0..1 (the N·L term — near-white; the visible disc uses sunCoreColor). */
  sunColor: readonly [number, number, number];
  /** Sun DISC core colour, linear (timecyc `sunCore` — yellow/orange; hosts gate to black at night). */
  sunCoreColor: readonly [number, number, number];
  /** Sun corona/glow colour, linear (timecyc `sunCorona` — the warm halo + godray tint). */
  sunCoronaColor: readonly [number, number, number];
  /** Unit direction TOWARDS the sun (engine space). */
  sunDir: readonly [number, number, number];
  /** Direct sun scale (the N·L term). */
  sunDirect: number;
  /** Current day-arc elevation 0..1 (the sun-vis v2 threshold input — 074/07). */
  sunElevation: number;
  /** Indirect (prelit) scale. */
  sunIndirect: number;
  /** timecyc `sunSize` (≈3–5) — scales the visible disc's angular radius. */
  sunSize: number;
  /** Baked sun-shadow strength on the direct term (074/07): 0 = off, 1 = raw bake. */
  sunVisStrength: number;
  /** ACES filmic tonemap in the post pass (074/09): 1 = the prod curve, 0 = raw linear→sRGB. */
  tonemap: number;
  /** Water base opacity 0..1 (timecyc WaterRGBA alpha). */
  waterAlpha: number;
  /** Water deep tint, linear (timecyc WaterRGBA). */
  waterColor: readonly [number, number, number];
  /** Wind multiplier on the baked sway amplitudes (074/06 row 10): 0 = still air, 1 = baked metres. */
  windStrength: number;
}

/**
 * A model's texture array, from either side of the optimized/unoptimized split (opensa-pack 003):
 *
 * - `ostex` — our offline `.ostex`, uploaded verbatim. BC1/BC3 stays COMPRESSED all the way into video
 *   memory; nothing expands it. This is the optimized path.
 * - `rgba` — RGBA8 layers a runtime TXD parse produced (props, clutter and anything not yet converted).
 */
export type ModelTextureInit =
  | { bytes: Uint8Array; kind: 'ostex' }
  | { height: number; kind: 'rgba'; layers: number; rgba: Uint8Array; width: number };

/** Live probe handle: write the palette ([model, bone 0, …], column-major), then `updatePedPalette()`. */
export interface PedProbe {
  palette: Float32Array;
}

/** Skinning-probe upload (074/08 B1) — raw byte views over the probe fixture's bin sections. */
export interface PedProbeInit {
  boneCount: number;
  indexCount: number;
  /** uint16 index payload. */
  indices: Uint8Array;
  joints: Uint8Array;
  normals: Uint8Array;
  positions: Uint8Array;
  /** Each submesh binds its OWN texture, addressed as (array, layer) — a ped's textures can disagree on
   *  size, so they cannot all live in one array (opensa-pack 003 phase 5f). */
  submeshes: readonly { array: number; indexCount: number; indexOffset: number; layer: number }[];
  /** One entry per texture SIZE the ped uses; `submeshes[].array` indexes this. */
  textures: readonly ModelTextureInit[];
  uvs: Uint8Array;
  weights: Uint8Array;
}

/**
 * One drawable vehicle (074/08 B5). Geometry and textures belong to the MODEL — many instances of the same
 * car share them; per-instance state is the part transforms plus submesh visibility (the `_ok`/`_dam` damage
 * swap, the `_vlo` LOD band and detached parts are all visibility operations).
 */
export interface VehicleInstance {
  readonly entity: RigidEntity;
  readonly model: VehicleModelId;
  /**
   * Per-vehicle lamp state (074/08 B5 step 5): headlights swap the lamp texture to its lit twin and glow the
   * glass; brakes take the tail lamps to full. Was a GLOBAL day/night gate — every parked car lit up at once.
   *
   * `smashed` is SA's light-damage mask, one bit per `eLights` index. The MESH can only go dark per PAIR —
   * a DFF authors one lamp material for both sides of an end — so it takes both bits of an end to stop the
   * twin/glow; the per-lamp half of the effect (beam, pool light, corona) is the game layer's.
   */
  setLamps(headlights: boolean, brakes: boolean, intensity: number, smashed: number): void;
  /** Carcols colours (linear 0..1) the vertex paint slots resolve to — this car's own paint job. */
  setPaint(paint: VehiclePaint): void;
  /**
   * This car's license plate (plan 082/03): which layer of the engine's generated TEXT atlas its
   * `carplate` quads sample, and which of the three city backgrounds its `carpback` quads wear. Both
   * default to 0 — the stock placeholder look every unassigned car keeps.
   */
  setPlate(textSlot: number, city: number): void;
  setSubmeshVisible(submesh: number, visible: boolean): void;
}

/** Opaque handle returned by `createVehicleModel`. */
export type VehicleModelId = number;

/** Rigid-entity upload (074/08 B2) — raw byte views over the vehicle fixture's bin sections. */
export interface VehicleModelInit {
  colors: Uint8Array;
  /** False when `indices` is a uint32 payload — a hi-poly mod car past 65 536 vertices. Defaults to true,
   *  so a caller (or an `.osm` predating the width) keeps the historical uint16 binding. */
  index16?: boolean;
  indexCount: number;
  /** uint16 (default) or uint32 index payload — see {@link VehicleModelInit.index16}. */
  indices: Uint8Array;
  meta: Uint8Array;
  /** NIGHT vertex colours, same layout as `colors`; the vertex stage mixes day → night by the `dn` factor. */
  night: Uint8Array;
  normals: Uint8Array;
  parts: readonly RigidPartInit[];
  positions: Uint8Array;
  /** Per-vertex DFF reflection slots (B5r): env layer, env coefficient, reflect intensity, specular level. */
  reflect: Uint8Array;
  submeshes: readonly VehicleSubmesh[];
  /**
   * One entry per texture ARRAY the model uses; `submeshes[].array` indexes it. A car is one array (its
   * dictionary shares a size); a map object is routinely several — a converted Chinatown building plans 19
   * layers into 6 arrays, because one array is one size AND one format AND one mip count.
   */
  textures: readonly ModelTextureInit[];
  /**
   * The model's own UV animations (plan 099), a submesh's `uvAnim` indexes them. Present only on the models
   * that animate — a script object with a film-strip material, a scrolling sign — so a car, a ped and every
   * ordinary prop allocate nothing and bind the engine's shared identity.
   */
  uvAnimations?: readonly UvAnimation[];
  uvs: Uint8Array;
  vertexCount: number;
}

/** The four editable carcols colours; a vertex's `slots.z` picks one (0 = the material's own colour). */
export interface VehiclePaint {
  primary: readonly [number, number, number];
  quaternary: readonly [number, number, number];
  secondary: readonly [number, number, number];
  tertiary: readonly [number, number, number];
}

export interface VehicleSubmesh {
  /** Which texture ARRAY this submesh samples — an index into `VehicleModelInit.textures`. Absent means 0,
   *  the single-array case every runtime-built model (and every car) is. The LAYER stays per-vertex in
   *  `meta.x`, because the lamps-on twin is switched per vertex and per-submesh binding cannot say that. */
  array?: number;
  /** Part-local AABB — the translucent sort clamps the eye into it for an exact nearest-extent key. The
   *  `center − radius` sphere over-reached on scattered submeshes (a gauge cluster spanning the dash beat
   *  the window sheet in front of it and the cabin drew over the glass). Absent on old fixtures. */
  bounds?: { max: readonly [number, number, number]; min: readonly [number, number, number] };
  /** Model-space centroid (074/16 round 6) — translucent submeshes sort back-to-front by it per frame.
   *  Optional: fixtures built before the field carry none and sort at the origin. */
  center?: readonly [number, number, number];
  indexCount: number;
  indexOffset: number;
  part: number;
  /** Which face of a license plate this submesh is (plan 082): `face` = the generated text strip,
   *  `back` = the city-background quad behind it. Absent = not a plate. */
  plate?: 'back' | 'face';
  /** Bounding radius about the centroid — the sort counts a submesh by its NEAREST extent (centroid
   *  distance − radius), so a raked windscreen beats the wheel under its overhang (074/16 field fix). */
  radius?: number;
  translucent: boolean;
  /** Which of the model's `uvAnimations` drives this submesh's UVs (plan 099). Absent = static UVs, which
   *  binds the identity transform — algebraically a no-op, and the only thing an old `.osm` can say. */
  uvAnim?: number;
}

/** Per-frame environment (074/06): drives the world lighting uniforms. All CPU-side arcs live in the host. */
/** One live break's GPU resources. */
interface DebrisEntry {
  bindGroup: GPUBindGroup;
  expiresAt: number;
  texture: GPUTexture;
  textureBytes: number;
  uniform: GPUBuffer;
  vertexBuffer: GPUBuffer;
  vertexCount: number;
}

/** One registered debug wireframe: its vertices, its colour uniform and its bind group. */
interface DebugLineSet {
  bindGroup: GPUBindGroup;
  /** Ignore depth — for overlays that must be visible INSIDE geometry (a skeleton). */
  throughDepth: boolean;
  uniform: GPUBuffer;
  vertexCount: number;
  vertices: GPUBuffer;
  visible: boolean;
}

/** Instances a model starts with room for; the matrix buffer doubles when it runs out. */
const VEHICLE_CAPACITY = 8;
/** 4 carcols colours × vec4f per matrix row. */
const PAINT_ROW_BYTES = 64;
/** Floats per particle instance: spawn(3) + velocity(3) + life/phase/system(3). */
const PARTICLE_STRIDE = 9;
/** One vec4f of lamp state per matrix row (headlights, brakes, intensity, spare). */
const LAMP_ROW_BYTES = 16;

/** One vec4f of plate state per matrix row (text slot, city background, spare, spare) — plan 082/03. */
const PLATE_ROW_BYTES = 16;
/** The generated plate raster: what SA's own `CreatePlateTexture` allocates, `RwRasterCreate(64, 16, 32)`. */
const PLATE_SLOT_HEIGHT = 16;
const PLATE_SLOT_WIDTH = 64;
/**
 * How many DISTINCT plates can exist at once. A CAP constant like the probe and the LUTs, not a growing
 * pool: the array's view is baked into every model's cached bind group, so resizing it would mean
 * rebuilding all of them. 256 × 64 × 16 × 4 B = 1 MB, and the host recycles slots by refcount below that.
 */
export const PLATE_CAPACITY = 256;
/** The three city backgrounds — `plateback1..3` = SF / LV / LS (`eCarPlateType`). */
const PLATE_BACKGROUNDS = 3;

/** Unpainted default — a car that never calls `setPaint` renders its marker slots plain white. */
const DEFAULT_PAINT: VehiclePaint = {
  primary: [1, 1, 1],
  quaternary: [1, 1, 1],
  secondary: [1, 1, 1],
  tertiary: [1, 1, 1],
};

/**
 * The FX library + placed emitters (074/06 row 13, B6). The HOST owns `effects.fxp` and `effectsPC.txd`: it
 * bakes each system's keyframed tracks into a flat record and each placed emitter into a stream of particle
 * instances. The engine just draws them — and because the lifecycle loops in the vertex shader, "drawing"
 * them costs nothing per frame.
 */
export interface ParticleUpload {
  /** RGBA8 sprite layers, all one size, packed sequentially (from effectsPC.txd). */
  atlas: { height: number; layers: number; rgba: Uint8Array; width: number };
  /** Instances for the ADDITIVE pipeline (fire, sparks): 9 floats each — spawn, velocity, life/phase/system. */
  instancesAdd: Float32Array;
  /** Instances for the ALPHA-BLEND pipeline (smoke, steam, mist). */
  instancesBlend: Float32Array;
  /** Baked systems, 20 floats each: force+layer, size envelope+drawDistance, and three colour+alpha keys. */
  systems: Float32Array;
}

/** One cell × model clutter draw (074/19): its instance-matrix storage buffer + bind group. */
interface ClutterCellDraw {
  bindGroup: GPUBindGroup;
  /** World-space bounding sphere [x, y, z, r] of the instances — frustum-culled per frame. */
  bounds: readonly [number, number, number, number];
  /** The group's visibility radius (see {@link CellClutter.drawDistance}). Kept on the CPU as well as in the
   *  shader uniform so a group that is ENTIRELY beyond it is skipped before the draw is issued — the shader
   *  cull alone would still pay vertex work and still count the triangles. */
  drawDistance: number;
  /** The per-draw uniform the vertex shader reads its radius from; released with the cell. */
  drawDistanceBuffer: GPUBuffer;
  instanceCount: number;
  /** Registered breakable key hashes (074/20) — purged from `clutterBreakables` when the cell unloads. */
  keyHashes: number[];
  matrixBuffer: GPUBuffer;
  model: ClutterModelId;
}

/** A loaded clutter model's GPU resources (074/19). */
interface ClutterModel {
  buffers: GPUBuffer[]; // positions, normals, uvs, colors
  cutout: boolean;
  indexBuffer: GPUBuffer;
  indexCount: number;
  texture: GPUTexture;
  textureBytes: number;
}

interface VehicleInstanceState {
  entity: RigidEntity;
  lamps: { brakes: boolean; headlights: boolean; intensity: number; smashed: number };
  /** Kept so a capacity grow (which reallocates the buffer) can restore it — paint is not re-sent per frame. */
  paint: VehiclePaint;
  /** This car's plate, kept for the same reason as `paint`: a capacity grow must restore it (082/03). */
  plate: { city: number; textSlot: number };
  slot: number;
  submeshVisible: Uint8Array;
}

interface VehicleModel {
  /** Keyed by a submesh's `array`: an index into this model's own textures, or a WORLD array ref when the
   *  model points into the shared plan. Built on demand and dropped whenever capacity grows. */
  bindGroups: Map<number, GPUBindGroup>;
  buffers: GPUBuffer[];
  capacity: number;
  index16: boolean;
  indexBuffer: GPUBuffer;
  /** Slot-indexed; `null` = free. A live instance owns matrix rows [slot × partCount, +partCount). */
  instances: (null | VehicleInstanceState)[];
  lampBuffer: GPUBuffer;
  matrixBuffer: GPUBuffer;
  paintBuffer: GPUBuffer;
  partCount: number;
  /** One plate vec4 per matrix row (plan 082/03) — text slot + city background, per instance. */
  plateBuffer: GPUBuffer;
  submeshes: readonly VehicleSubmesh[];
  /** Residency estimate per array, parallel to `textures` — each is destroyed with its own share. */
  textureBytes: number[];
  textures: GPUTexture[];
  /** Empty on all but the animated models — the per-frame advance skips those without paying for them. */
  uvAnimations: readonly UvAnimation[];
  /** Slot 0 = identity, slots 1..N = `uvAnimations`, {@link UV_ANIM_STRIDE} apart; the draw picks one with a
   *  dynamic offset. This is the engine's SHARED identity buffer on a model that animates nothing. */
  uvAnimBuffer: GPUBuffer;
  /** False when `uvAnimBuffer` is the shared identity: destroying it would take every other model down. */
  uvAnimOwned: boolean;
  /** True when `submeshes[].array` are refs into the SHARED world plan — the model owns no textures, and
   *  a submesh whose array has not streamed in yet is simply not drawn this frame. */
  worldArrays: boolean;
}

/** Interleaved debris vertex (B7·a): position, uv, colour, centroid, velocity, spin, (landTime, layer). */
const DEBRIS_STRIDE = 80;
/** Simultaneous breaks. Each is one draw and one small texture; a pile-up must not creep the frame. */
const MAX_ACTIVE_DEBRIS = 8;

/** A smashed clutter instance's matrix (074/20): every vertex collapses to the engine origin, so the
 *  triangles are zero-area and rasterize nothing — the instance vanishes without changing the draw's count. */
const DEGENERATE_CLUTTER_MATRIX = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);

/** Env-probe cadence (074/16 step 2): one face every N frames. 2 halves the probe's ~1 ms face cost to
 *  ~0.5 ms amortised (the plan gate); a full cube refresh is 12 frames = 100 ms at 120 Hz — invisible on
 *  blurred paint. 1 = every frame if the budget ever allows. */
const PROBE_FRAME_INTERVAL = 2;

/** Light-pool capacity (074/06 row 7) — mirrored by the WGSL loop bound. Holds HOST DYNAMICS only since
 *  2026-07-17 (static 2dfx lamps removed — their binary pool admission read as "lamps igniting ahead of
 *  the car"; the redesign is plan 17's, the corona glow still marks every lamp). A smooth-admission
 *  restore was tried and REVERTED 2026-07-22 (085 row E: "not what we need", paraphrased — the user owes the
 *  precise description of the wanted ground-glow behaviour before this is touched again). */
const LIGHT_POOL_CAP = 64;
/** Floats per pooled light: position+radius, colour, direction+cone cosine (2 = point, no cone). */
const LIGHT_STRIDE = 12;
/** `dir.w` sentinel for "no cone" — mirrors the three pool's convention exactly. */
const LIGHT_POINT = 2;

export class Engine {
  cells!: CellStore;

  /**
   * Draw the scattered procedural clutter at all. A debug toggle in the same shape as {@link waterEnabled}:
   * procobj is GENERATED, not authored, so an inspector has to be able to subtract it and see the map the
   * IPLs actually place — and read its cost straight off the draw/triangle counters.
   *
   * It gates the DRAW only. The scatter, its buffers and its COLLIDERS stay exactly as they were, so this
   * hides the bushes without moving anything a run would notice.
   */
  clutterEnabled = true;
  /**
   * Debug normals (074/22): shade every surface by its world normal instead of its material — the three
   * build's scene-wide `MeshNormalMaterial` override, which WebGPU has no equivalent of. Shares one frame
   * lane with {@link debugUnlit} and WINS over it: one lane, one view, as the old override slot behaved.
   */
  debugNormals = false;
  /**
   * Debug prelit scale (074/13 phase 4): 1 = as authored, 0 = prelit off (texture only), 2 = SA's
   * MODULATE2X. An ASSET-INSPECTION knob for the viewers — "is this model dark because its baked vertex
   * light is dark?" — not a look tunable. Never anything but 1 in normal play.
   */
  debugPrelitScale = 1;
  /** Debug unlit (074/13 phase 4): drop the sun/moon/pool lighting term and show the flat albedo. */
  debugUnlit = false;
  /** Host-owned coronas (vehicle lamps) — replace the contents each frame; drawn with the 2dfx ones. */
  readonly dynamicCoronas: DynamicCorona[] = [];

  /** Host-owned dynamic lights (vehicle head/taillights …) — replace the contents each frame. */
  readonly dynamicLights: DynamicLight[] = [];

  /** Live environment — host mutates freely; written into the frame UBO every frame. Noon defaults. */
  readonly environment: Environment = {
    // Midday LA timecyc `Amb` (78,83,89)/255 linearized — the drivers overwrite it per hour/weather.
    ambientColor: [0.074, 0.084, 0.098],
    // Modest by default: SA prelit already carries baked darkening — full-strength AO double-darkens.
    aoStrength: 0.6,
    bloomIntensity: 0.7,
    bloomThreshold: 0.7,
    cloudAlpha: 0.9,
    cloudBottomColor: [0.45, 0.48, 0.55],
    cloudCover: 0.12,
    cloudDark: 0,
    cloudScale: 1,
    cloudTopColor: [0.78, 0.8, 0.85],
    dn: 0,
    emissiveBoost: 1.6,
    fogCutDistance: 2400,
    fogHeightK: 1 / 180,
    fogHeightMin: 0.35,
    fogStartDistance: 250,
    godrayStrength: 1,
    hour: 12,
    moonColor: [0, 0, 0],
    moonDir: [-0.3, 0.8, -0.25],
    moonPhase: 0.5,
    reflectionStrength: 1,
    skyExposure: 0.55,
    skyHorizon: [0.42, 0.55, 0.72],
    skyModel: 'hosek',
    skyMood: 0.7,
    skyTop: [0.12, 0.32, 0.65],
    stochastic: 0,
    sunColor: [1, 0.96, 0.88],
    sunCoreColor: [1, 0.95, 0.68],
    sunCoronaColor: [1, 0.8, 0.4],
    sunDir: [0.35, 0.85, 0.25],
    sunDirect: 0.9,
    sunElevation: 1,
    sunIndirect: 0.75,
    sunSize: 4,
    sunVisStrength: 1,
    tonemap: 1,
    waterAlpha: 0.72,
    waterColor: [0.05, 0.14, 0.18],
    windStrength: 1,
  };

  /** `graphics.effects.enabled` gate (089/01) — hosts sync it from config; gates BOTH particle lanes. */
  particlesEnabled = true;

  /**
   * Env-probe centre (074/16 step 2), ENGINE space — the host feeds the followed car (or the player) every
   * frame; `null` skips the probe entirely (the lab, reflections off) and the rigid shader falls back to the
   * analytic sky. One cube face refreshes per frame while set.
   */
  probeCenter: null | Vec3 = null;

  /** Probe DEBUG view (074/16): replaces the frame with the cube sampled along the camera ray — the
   *  orientation/content check. Hosts wire a URL flag; never on in normal play. */
  probeView = false;

  /** Render scale (074/09 tiers): scene targets = canvas × scale (clamped 0.5–1), the post pass upscales
   *  to the swapchain. Live — the next frame rebuilds the targets. */
  renderScale = 1;

  /** Flat sky clear (M0 stand-in for the sky pass). LINEAR values — the sRGB target encodes on write. */
  skyColor: GPUColor = { a: 1, b: 0.71, g: 0.46, r: 0.24 };

  textures!: TextureArrays;

  /**
   * Draw the installed water surface at all (plan 094/07). A debug toggle, not a config: an inspector has to
   * be able to look at what is UNDER the sea sheet (a sunken road, a mis-levelled pool) without unloading
   * the mesh, so this gates the draw and leaves the buffers alone.
   */
  waterEnabled = true;

  get adapterInfo(): string {
    return this.engineDevice.adapterInfo;
  }
  /**
   * What the FIRST frames spent themselves on, by name (201/4-03).
   *
   * `engine-frame` measured **77.9 ms on the first frame in both 08-25 captures, to the tenth** — a fixed
   * cost with no owner, and now the largest item on that frame. The 08-25 overlay round is the reason this
   * is a split rather than a theory: the guess there (font resolution) measured wrong, and separating the
   * span answered it in one capture.
   *
   * It is NOT `frameSpans`. That recorder is for work between frames and the game shell SUBTRACTS its total
   * from the loop body to print `unattributed` — a span from inside the frame would drive that negative,
   * which is the exact failure its own rule warns about. This one is the engine's, read once by the host.
   */
  /** What `init` spent itself on, by phase — filled once, when `init` returns (201/4-03). */
  get bootPhases(): FrameSpanTotals {
    return this.bootTotals;
  }
  get device(): GPUDevice {
    return this.engineDevice.device;
  }
  /** The `device` block a mobile benchmark row is required to carry — see `describeDevice`. */
  get deviceReport(): ReturnType<typeof describeDevice> {
    return describeDevice(this.engineDevice, this.canvasElement);
  }
  get firstFrames(): readonly FrameSpanTotals[] {
    return this.firstFrameTotals;
  }
  /**
   * Bloom chain resources (074/09): prefilter (full res) + `levels` downsample mips + `levels−1` upsample
   * mips, all 16f, rebuilt with the targets on resize (with the previous chain destroyed — unlike the
   * one-off scene targets these are many small textures). `result` (up mip 0, half res) feeds the composite.
   */
  private bloomChain: null | {
    downBindGroups: GPUBindGroup[];
    downSizes: { height: number; width: number }[];
    downViews: GPUTextureView[];
    prefilterBindGroup: GPUBindGroup;
    prefilterView: GPUTextureView;
    resultView: GPUTextureView;
    textures: { bytes: number; texture: GPUTexture }[];
    uniforms: GPUBuffer[];
    upBindGroups: GPUBindGroup[];
    upViews: GPUTextureView[];
  } = null;
  /** Persistent scratch for the prefilter uniform (zero steady-state allocations — ground rule 3). */
  private readonly bloomPrefilterScratch = new Float32Array(8);
  /** Prefilter params (threshold animates with the night profile) — written every bloom frame. */
  private bloomPrefilterUniform!: GPUBuffer;
  private readonly bootSpans = new FrameSpans();
  private bootTotals: FrameSpanTotals = { byName: [], totalMs: 0 };
  private canvasContext!: GPUCanvasContext;
  /** Kept for `deviceReport` — a capture states the CSS size it was taken at. */
  private canvasElement!: HTMLCanvasElement;
  private cloudFieldBindGroup!: GPUBindGroup;
  private cloudFieldTexture!: GPUTexture;
  private cloudFieldView!: GPUTextureView;

  /** Breakable clutter instances (074/20): key hash → the matrix slot to degenerate on a hit. */
  private readonly clutterBreakables = new Map<number, { matrixBuffer: GPUBuffer; offset: number }>();
  /** Per streamed cell → its clutter draws (one per model). Replaced/removed as cells stream. */
  private readonly clutterCells = new Map<string, ClutterCellDraw[]>();
  /** Procedural-clutter models (074/19 B7·d) — shared grass/bush/rock geometry + texture, drawn instanced. */
  private readonly clutterModels = new Map<ClutterModelId, ClutterModel>();
  private clutterModelSeq = 0;
  private clutterSampler!: GPUSampler;
  private coronaInstances!: GPUBuffer;
  private coronaQuad!: GPUBuffer;
  private readonly coronaScratch = new Float32Array(CORONA_CAP * 8);
  private coronaTexture!: GPUTexture;
  private readonly debris: DebrisEntry[] = [];
  private readonly debugLines = new Map<DebugLineSetId, DebugLineSet>();
  private depthView!: GPUTextureView;
  /** Dynamic one-shot particle lane (089/01) — null until a host installs a library. */
  private dynamicParticles: DynamicParticles | null = null;
  private engineDevice!: EngineDevice;
  /** How many more frames are split. Three: the first pays for everything, the next two say what was
   *  one-shot and what is steady state. After that the split costs nothing at all. */
  private firstFrameDetail = 3;
  private readonly firstFrameSpans = new FrameSpans();
  /** One entry per split frame, in order — the first is the expensive one, and the two after it are what
   *  says which of its phases was one-shot. Summing them would hide exactly that. */
  private readonly firstFrameTotals: FrameSpanTotals[] = [];
  private frameBindGroup!: GPUBindGroup;
  /** Triangles recorded by the out-of-bundle draw passes this frame; reset at the top of `frame`. A field
   *  rather than a return value because every `draw*` already returns its draw count. */
  private frameTriangles = 0;
  private frameUniform!: GPUBuffer;
  private readonly frustumPlanes = new Float32Array(24);
  /** The engine-wide identity UV transform every non-animated rigid model binds (plan 099/02). */
  private identityUvAnim!: GPUBuffer;
  private readonly invViewProj: Mat4 = mat4Identity();
  private lightPoolBuffer!: GPUBuffer;
  private readonly lightPoolScratch = new Float32Array(LIGHT_POOL_CAP * LIGHT_STRIDE);
  private msaaView!: GPUTextureView;
  private nextDebugLineId = 1;
  /** 2dfx particles (B6) — the whole map's emitters in two instance buffers, one per blend mode. */
  private particles: null | {
    bindGroup: GPUBindGroup;
    countAdd: number;
    countBlend: number;
    instancesAdd: GPUBuffer;
    instancesBlend: GPUBuffer;
    systems: GPUBuffer;
    texture: GPUTexture;
    textureBytes: number;
  } = null;
  /** Skinning probe (074/08 B1) — a single skinned entity outside the static bundles. */
  private ped: null | {
    buffers: GPUBuffer[];
    indexBuffer: GPUBuffer;
    palette: Float32Array;
    paletteBuffer: GPUBuffer;
    /** One bind group per submesh: each holds a 2D view of the single array layer that submesh draws. */
    submeshes: readonly { bindGroup: GPUBindGroup; indexCount: number; indexOffset: number }[];
  } = null;
  private pedTextureBytes = 0;
  private pedTextures: GPUTexture[] = [];
  private pipelines!: PipelineSet;
  /** Scene env probe (074/16 step 2) + its per-frame scratch (zero steady-state allocations). */
  /** The three city backgrounds a `carpback` quad samples — replaced once the game's TXD is parsed. */
  private plateBackTexture!: GPUTexture;
  /** The generated plate TEXT rasters, one layer per distinct plate the world is wearing. */
  private plateTexture!: GPUTexture;
  /** Resolved scene (16f) + the godrays composite resources (074/09 stage 1); bind group is rebuilt on
   *  resize — it is NOT referenced by any bundle, so this is safe (unlike the frame bind group). */
  private postBindGroup!: GPUBindGroup;
  private postSampler!: GPUSampler;
  private postUniform!: GPUBuffer;
  private probe!: EnvProbe;
  private readonly probeFrameData = new Float32Array(104);
  private readonly probeFrustum = new Float32Array(24);
  private readonly probeInvViewProj: Mat4 = mat4Identity();
  /** Face-render cadence counter (renders when it wraps to 0 — see PROBE_FRAME_INTERVAL). */
  private probeTick = -1;
  /** Probe DEBUG view bind group (cube + sampler), created once at init. */
  private probeViewBindGroup!: GPUBindGroup;
  private readonly probeViewProj: Mat4 = mat4Identity();
  private readonly proj: Mat4 = mat4Identity();
  private resources!: Resources;
  private sceneColorView!: GPUTextureView;
  /** Scene targets (msaa colour + resolve + depth) with byte estimates — destroyed on rebuild: the
   *  renderScale knob rebuilds targets LIVE, so leaking a 4×MSAA target per change is real. */
  private readonly sceneTargets: { bytes: number; texture: GPUTexture }[] = [];
  /** Skid-mark decal lane (089/03) — null until a host installs the particleskid sprite. */
  private skidMarks: null | SkidMarks = null;
  private skyLutCurrentKey = '';
  private skyLutTexture!: GPUTexture;
  private readonly startedMs = performance.now();
  private readonly statsValue: EngineStats = {
    cellsTotal: 0,
    cellsVisible: 0,
    drawsRecorded: 0,
    gpuPassMs: 0,
    gpuPostMs: 0,
    gpuProbeMs: 0,
    residencyBytes: 0,
    roadsignQuadsRecorded: 0,
    submitMs: 0,
    trianglesRecorded: 0,
  };
  private targetKey = '';
  private timers!: GpuTimers;
  /** UV-scroll animations (B7·c / plan 074/18): the pak's global UVAnimDict entries, keyframes time-sorted.
   *  A kind-4 objectTable draw stores a slot index into this list; the engine advances all of them per frame. */
  private uvAnimations: { duration: number; keyframes: { time: number; uv: number[] }[] }[] = [];
  private readonly uvAnimScratch = new Float32Array(4);
  /** Current transform per animation, slot-indexed: (offsetX, offsetY, scaleX, scaleY) for `uv·zw + xy`. */
  private uvAnimTransforms = new Float32Array(0);
  /** Rigid-entity models (074/08 B2→B5) — vehicle part hierarchies, always outside the static bundles. */
  private readonly vehicleModels = new Map<VehicleModelId, VehicleModel>();
  private vehicleModelSeq = 0;
  /** Part definitions per model — every instance builds its own `RigidEntity` from these. */
  private readonly vehicleParts = new Map<VehicleModelId, readonly RigidPartInit[]>();
  private readonly view: Mat4 = mat4Identity();

  private readonly viewProj: Mat4 = mat4Identity();

  /** Water surface (074/06 row 12 v1) — one static translucent mesh; null until the host installs it. */
  private water: null | {
    bindGroup: GPUBindGroup;
    indexCount: number;
    indices: GPUBuffer;
    vertices: GPUBuffer;
  } = null;

  /**
   * Smash one breakable clutter instance (074/20): collapse its matrix to a zero-area point so it stops
   * rendering, without touching the draw's instance count. Returns false when the key is unknown (its cell
   * streamed out, or it was already broken). The host removes the collider and spawns debris alongside.
   */
  /**
   * Lay one skid-mark segment NOW (089/03), engine space, corners pre-lifted off the road. Dropped when no
   * lane is installed or the effects gate is off; the ring recycles the oldest mark when full.
   */
  addSkidSegment(segment: SkidSegment): void {
    if (!this.skidMarks || !this.particlesEnabled) {
      return;
    }
    this.skidMarks.add(segment, (performance.now() - this.startedMs) / 1000);
  }

  breakClutterInstance(keyHash: number): boolean {
    const entry = this.clutterBreakables.get(keyHash);
    if (!entry) {
      return false;
    }
    this.device.queue.writeBuffer(entry.matrixBuffer, entry.offset, DEGENERATE_CLUTTER_MATRIX);
    this.clutterBreakables.delete(keyHash);

    return true;
  }

  /**
   * Upload a procedural-clutter MODEL (074/19 B7·d): geometry + texture, shared by every scattered instance.
   * Per-instance placement arrives via {@link setCellClutter}. `cutout` picks the A2C variant (grass/bushes).
   */
  createClutterModel(init: ClutterModelInit): ClutterModelId {
    const upload = (label: string, bytes: Uint8Array, usage: number): GPUBuffer => {
      const size = Math.max(4, Math.ceil(bytes.byteLength / 4) * 4);
      const buffer = this.resources.createBuffer('cellVertex', {
        label: `clutter-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      let payload = bytes;
      if (bytes.byteLength !== size) {
        payload = new Uint8Array(size);
        payload.set(bytes);
      }
      this.device.queue.writeBuffer(buffer, 0, payload);

      return buffer;
    };
    const buffers = [
      upload('positions', init.positions, GPUBufferUsage.VERTEX),
      upload('normals', init.normals, GPUBufferUsage.VERTEX),
      upload('uvs', init.uvs, GPUBufferUsage.VERTEX),
      upload('colors', init.colors, GPUBufferUsage.VERTEX),
      upload('meta', init.meta, GPUBufferUsage.VERTEX),
      upload('night', init.night, GPUBufferUsage.VERTEX),
    ];
    const indexBuffer = upload('indices', init.indices, GPUBufferUsage.INDEX);
    const { byteEstimate: textureBytes, texture } = this.createModelTexture(init.texture, 'clutter-texture');
    const id = this.clutterModelSeq;
    this.clutterModelSeq += 1;
    this.clutterModels.set(id, {
      buffers,
      cutout: init.cutout,
      indexBuffer,
      indexCount: init.indices.byteLength / 2,
      texture,
      textureBytes,
    });

    return id;
  }

  /**
   * Upload a DEBUG WIREFRAME (074/13 phase 4): a world-space line list drawn unlit over the scene, for
   * COL collision hulls and mesh edges. `positions` is xyz pairs — every two vertices are one segment,
   * already in ENGINE space (the host owns the GTA Z-up → Y-up change, as with every rigid draw).
   */
  createDebugLines(
    positions: Float32Array,
    color: readonly [number, number, number, number],
    options: { throughDepth?: boolean } = {},
  ): DebugLineSetId {
    const id = this.nextDebugLineId;
    this.nextDebugLineId += 1;

    const vertices = this.resources.createBuffer('cellVertex', {
      label: `debug-line-${id}`,
      size: Math.max(4, Math.ceil(positions.byteLength / 4) * 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertices, 0, positions);

    const uniform = this.resources.createBuffer('uniform', {
      label: `debug-line-${id}`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(uniform, 0, new Float32Array(color));

    this.debugLines.set(id, {
      bindGroup: this.device.createBindGroup({
        entries: [{ binding: 0, resource: { buffer: uniform } }],
        label: `debug-line-${id}`,
        layout: this.pipelines.debugLineLayout,
      }),
      throughDepth: options.throughDepth ?? false,
      uniform,
      vertexCount: Math.floor(positions.length / 3),
      vertices,
      visible: true,
    });

    return id;
  }

  /** Spawn one instance of an uploaded model (074/08 B5). Every instance owns its own part transforms. */
  createVehicle(id: VehicleModelId): VehicleInstance {
    const model = this.vehicleModels.get(id);
    const parts = this.vehicleParts.get(id);
    if (!model || !parts) {
      throw new Error(`createVehicle: unknown model ${id}`);
    }
    let slot = model.instances.indexOf(null);
    if (slot === -1) {
      slot = model.capacity;
      this.growVehicleModel(model, model.capacity * 2);
    }
    const state: VehicleInstanceState = {
      entity: new RigidEntity(parts),
      lamps: { brakes: false, headlights: false, intensity: 1, smashed: 0 },
      paint: DEFAULT_PAINT,
      // Slot 0 of each array until the host assigns one: an unplated car shows the stock placeholder.
      plate: { city: 0, textSlot: 0 },
      slot,
      submeshVisible: new Uint8Array(model.submeshes.length).fill(1),
    };
    model.instances[slot] = state;
    this.writeVehiclePaint(model, slot, DEFAULT_PAINT);

    return {
      entity: state.entity,
      model: id,
      setLamps: (headlights: boolean, brakes: boolean, intensity: number, smashed: number): void => {
        const lamps = state.lamps;
        if (
          lamps.headlights === headlights &&
          lamps.brakes === brakes &&
          lamps.intensity === intensity &&
          lamps.smashed === smashed
        ) {
          return; // lamp state is written on CHANGE, not per frame
        }
        state.lamps = { brakes, headlights, intensity, smashed };
        this.writeVehicleLamps(model, state.slot, state.lamps);
      },
      setPaint: (paint: VehiclePaint): void => {
        this.writeVehiclePaint(model, state.slot, paint);
      },
      setPlate: (textSlot: number, city: number): void => {
        if (state.plate.city === city && state.plate.textSlot === textSlot) {
          return; // like lamps, written on CHANGE — a parked car re-requests the same plate every respawn
        }
        state.plate = { city, textSlot };
        this.writeVehiclePlate(model, state.slot, textSlot, city);
      },
      setSubmeshVisible: (submesh: number, visible: boolean): void => {
        state.submeshVisible[submesh] = visible ? 1 : 0;
      },
    };
  }

  /**
   * Upload a vehicle MODEL (074/08 B5): geometry + texture array, shared by every instance of that car.
   * Instances come from `createVehicle`.
   */
  createVehicleModel(init: VehicleModelInit): VehicleModelId {
    const upload = (label: string, bytes: Uint8Array, usage: number): GPUBuffer => {
      const size = Math.ceil(bytes.byteLength / 4) * 4;
      const buffer = this.resources.createBuffer('cellVertex', {
        label: `vehicle-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      let payload = bytes;
      if (bytes.byteLength !== size) {
        payload = new Uint8Array(size);
        payload.set(bytes);
      }
      this.device.queue.writeBuffer(buffer, 0, payload);

      return buffer;
    };
    const buffers = [
      upload('positions', init.positions, GPUBufferUsage.VERTEX),
      upload('normals', init.normals, GPUBufferUsage.VERTEX),
      upload('uvs', init.uvs, GPUBufferUsage.VERTEX),
      upload('colors', init.colors, GPUBufferUsage.VERTEX),
      upload('meta', init.meta, GPUBufferUsage.VERTEX),
      upload('reflect', init.reflect, GPUBufferUsage.VERTEX),
      upload('night', init.night, GPUBufferUsage.VERTEX),
    ];
    const indexBuffer = upload('indices', init.indices, GPUBufferUsage.INDEX);
    const matrixBuffer = this.createVehicleMatrixBuffer(init.parts.length, VEHICLE_CAPACITY);
    const paintBuffer = this.createVehiclePaintBuffer(init.parts.length, VEHICLE_CAPACITY);
    const lampBuffer = this.createVehicleLampBuffer(init.parts.length, VEHICLE_CAPACITY);
    const plateBuffer = this.createVehiclePlateBuffer(init.parts.length, VEHICLE_CAPACITY);
    const uvAnim = this.createModelUvAnim(init.uvAnimations ?? []);
    const uploads = init.textures.map((texture) => this.createModelTexture(texture, 'vehicle-texture'));
    const textures = uploads.map((upload) => upload.texture);
    const textureBytes = uploads.map((upload) => upload.byteEstimate);
    const id = this.vehicleModelSeq;
    this.vehicleModelSeq += 1;
    const model: VehicleModel = {
      bindGroups: new Map<number, GPUBindGroup>(),
      buffers,
      capacity: VEHICLE_CAPACITY,
      index16: init.index16 ?? true,
      indexBuffer,
      instances: new Array<null | VehicleInstanceState>(VEHICLE_CAPACITY).fill(null),
      lampBuffer,
      matrixBuffer,
      paintBuffer,
      partCount: init.parts.length,
      plateBuffer,
      submeshes: init.submeshes,
      textureBytes,
      textures,
      uvAnimations: uvAnim.animations,
      uvAnimBuffer: uvAnim.buffer,
      uvAnimOwned: uvAnim.owned,
      worldArrays: init.textures.length === 0,
    };
    this.vehicleModels.set(id, model);
    this.vehicleParts.set(id, init.parts);

    return id;
  }

  /**
   * The debug VIEW the frame lane carries: 0 normal · 1 unlit · 2 normals.
   *
   * Normals WIN over unlit — one lane means one view at a time, exactly as the three build's single
   * scene-wide override slot behaved.
   */
  debugViewMode(): number {
    if (this.debugNormals) {
      return 2;
    }

    return this.debugUnlit ? 1 : 0;
  }

  destroyDebugLines(id: DebugLineSetId): void {
    const set = this.debugLines.get(id);
    if (!set) {
      return;
    }
    this.resources.destroyBuffer('cellVertex', set.vertices);
    this.resources.destroyBuffer('uniform', set.uniform);
    this.debugLines.delete(id);
  }

  destroyVehicle(instance: VehicleInstance): void {
    const model = this.vehicleModels.get(instance.model);
    if (!model) {
      return;
    }
    const slot = model.instances.findIndex((state) => state?.entity === instance.entity);
    if (slot !== -1) {
      model.instances[slot] = null;
    }
  }

  destroyVehicleModel(id: VehicleModelId): void {
    const model = this.vehicleModels.get(id);
    if (!model) {
      return;
    }
    for (const buffer of model.buffers) {
      this.resources.destroyBuffer('cellVertex', buffer);
    }
    this.resources.destroyBuffer('cellVertex', model.indexBuffer);
    this.resources.destroyBuffer('uniform', model.matrixBuffer);
    this.resources.destroyBuffer('uniform', model.paintBuffer);
    this.resources.destroyBuffer('uniform', model.lampBuffer);
    this.resources.destroyBuffer('uniform', model.plateBuffer);
    // NOT the shared identity: every non-animated model binds that one buffer, and destroying it with the
    // first prop unloaded would take the whole rigid lane down.
    if (model.uvAnimOwned) {
      this.resources.destroyBuffer('uniform', model.uvAnimBuffer);
    }
    model.textures.forEach((texture, array) => {
      this.resources.destroyTexture('texture', texture, model.textureBytes[array] ?? 0);
    });
    this.vehicleModels.delete(id);
    this.vehicleParts.delete(id);
  }

  /** Render one frame. Returns the stats snapshot (the HUD's input). */
  frame(camera: CameraState): EngineStats {
    const submitStart = performance.now();
    // The first three frames are SPLIT by phase and nothing else is (201/4-03) — see `firstFrames` for why
    // this is the engine's own recorder. Two `performance.now()` per phase for three frames, then nothing.
    const detail = this.firstFrameDetail > 0;
    if (detail) {
      this.firstFrameDetail -= 1;
    }
    const step = <T>(name: string, run: () => T): T => (detail ? this.firstFrameSpans.measure(name, run) : run());
    const canvasTexture = this.canvasContext.getCurrentTexture();
    step('frame:targets', () => {
      this.ensureTargets(canvasTexture.width, canvasTexture.height);
    });

    // The projection convention (reversed-Z, plan view) lives in ONE place — the streamer decides
    // residency against the same frustum this frame culls with (201/1-05).
    cameraProjection(this.proj, camera);
    mat4LookAt(this.view, camera.eye, camera.target, camera.up);
    mat4Multiply(this.viewProj, this.proj, this.view);
    mat4Invert(this.invViewProj, this.viewProj);
    const frameData = new Float32Array(104);
    frameData.set(this.viewProj, 0);
    frameData.set(this.invViewProj, 16);
    // camera.w = spare (held the retired cloud-panorama crossfade blend).
    frameData.set([...camera.eye, 0], 32);
    const env = this.environment;
    const seconds = (performance.now() - this.startedMs) / 1000;
    const sunLen = Math.hypot(env.sunDir[0], env.sunDir[1], env.sunDir[2]) || 1;
    // sunDir.w = current arc elevation (the sun-vis v2 threshold input — 074/07).
    frameData.set([env.sunDir[0] / sunLen, env.sunDir[1] / sunLen, env.sunDir[2] / sunLen, env.sunElevation], 36);
    frameData.set([...env.sunColor, 1], 40);
    frameData.set([env.dn, env.sunIndirect, env.sunDirect, env.emissiveBoost], 44);
    frameData.set([...env.skyTop, 1], 48);
    frameData.set([...env.skyHorizon, 1], 52);
    frameData.set([env.fogCutDistance, env.fogStartDistance, env.fogHeightK, env.fogHeightMin], 56);
    frameData.set([env.aoStrength, env.sunVisStrength, seconds, env.windStrength], 60);
    const moonLen = Math.hypot(env.moonDir[0], env.moonDir[1], env.moonDir[2]) || 1;
    // moonDir.w doubles as the stochastic de-tiling toggle (074/12) — the vec4 slot was spare.
    frameData.set([env.moonDir[0] / moonLen, env.moonDir[1] / moonLen, env.moonDir[2] / moonLen, env.stochastic], 64);
    // moonColor.w = the debug VIEW mode (074/13, widened 074/22): 0 normal · 1 unlit · 2 normals. The slot
    // was spare (it held the retired cloud-panorama rotation speed). Debug knobs ride spare lanes on
    // purpose: GROWING the frame uniform would mint a new buffer and bind group, and that bind group is
    // recorded into every cell bundle — every bundle would go stale.
    frameData.set([...env.moonColor, this.debugViewMode()], 68);
    // params3 = [light count (row 7), cloud layer on, cloudDark, cloud layer alpha] — row 15.
    frameData[72] = this.fillLightPool();
    // params4.x = how many of those lights are DYNAMIC (they come first in the pool). The world shades the
    // static 2dfx lamps per VERTEX (cheap, and they never move), but a headlight sweeping a 30-metre road
    // polygon has no vertex near it to light: the beam breaks into blotches that follow the road's normals
    // and vanishes entirely once the car sits mid-polygon. Dynamic lights must be shaded per PIXEL.
    frameData[88] = this.dynamicLights.length;
    frameData[89] = env.moonPhase;
    frameData[90] = env.reflectionStrength;
    // params3.y = the debug PRELIT scale (074/13) — the slot was spare (retired cloud-panorama enable).
    frameData[73] = this.debugPrelitScale;
    frameData[74] = env.cloudDark;
    frameData[75] = Math.min(1, Math.max(0, env.cloudAlpha));
    // sunCore/sunCorona = the SUN VISUAL (timecyc columns — the disc is yellow/orange; the white-ish
    // env.sunColor stays the LIGHT). sunCore.w = angular core radius (rad) from timecyc sunSize;
    // sunCorona.w = weather cloud COVER (prod's uCloudClear source — hides stars globally under overcast).
    frameData.set([...env.sunCoreColor, env.sunSize * SUN_SIZE_TO_RAD], 76);
    frameData.set([...env.sunCoronaColor, Math.min(1, Math.max(0, env.cloudCover))], 80);
    // Water v1 (074/06 row 12): timecyc WaterRGBA — deep tint + base opacity.
    frameData.set([...env.waterColor, Math.min(1, Math.max(0, env.waterAlpha))], 84);
    // timecyc cloud colours (074/09 sky round 2): lowClouds/bottomClouds tint the cloud deck — dawn
    // turns the WHOLE sky's clouds pink (both sides of the sun), noon reads bright, night near-black.
    // cloudTop.w = the cumulus clump-size multiplier (sky v2 weather identity).
    frameData.set([...env.cloudTopColor, env.cloudScale], 92);
    frameData.set([...env.cloudBottomColor, 1], 96);
    // World ambient floor (plan 093): SA's building formula adds timecyc ambient ON TOP of prelit —
    // normal-independent, so black-authored shadow verts stay shadow instead of holes. .w spare.
    frameData.set([...env.ambientColor, 0], 100);
    step('frame:sky-lut', () => {
      this.refreshSkyLut(); // before the probe submit — the probe's sky pass samples the LUT too
    });
    step('frame:probe', () => {
      this.scheduleProbe(frameData);
    });
    this.device.queue.writeBuffer(this.frameUniform, 0, frameData);

    frustumFromViewProj(this.frustumPlanes, this.viewProj);
    // The two big phases are marked rather than wrapped: a closure around a hundred lines of commented
    // pass-building would reindent all of it to add two timestamps. `FrameSpans.add` exists for exactly
    // this — a segment the caller timed itself.
    const mark = (): number => (detail ? performance.now() : 0);
    const since = (name: string, started: number): void => {
      if (detail) {
        this.firstFrameSpans.add(name, performance.now() - started);
      }
    };
    const cullStart = mark();
    const bundles: GPURenderBundle[] = [];
    const blendCells: { bundle: GPURenderBundle; distanceSq: number }[] = [];
    let draws = 0;
    let total = 0;
    let triangles = 0;
    let roadsignQuads = 0;
    this.frameTriangles = 0;
    for (const cell of this.cells.all()) {
      total += 1;
      // Fog distance cull (plan 074/21 P1): a cell entirely at/past the fog cut is 100 % fog = pixel-equal
      // to the sky behind it — skip its bundles (and, via cell.visible, its coronas/objects/lights). With
      // the fog ⊂ LOD-ring invariant the streaming margin band becomes loaded-but-not-drawn warm-up.
      cell.visible =
        !sphereFullyBeyond(
          camera.eye,
          cell.bounds[0],
          cell.bounds[1],
          cell.bounds[2],
          cell.bounds[3],
          env.fogCutDistance,
        ) &&
        frustumIntersectsSphere(this.frustumPlanes, cell.bounds[0], cell.bounds[1], cell.bounds[2], cell.bounds[3]);
      if (cell.visible) {
        bundles.push(cell.bundle);
        if (cell.blendBundle) {
          blendCells.push({
            bundle: cell.blendBundle,
            distanceSq:
              (cell.bounds[0] - camera.eye[0]) ** 2 +
              (cell.bounds[1] - camera.eye[1]) ** 2 +
              (cell.bounds[2] - camera.eye[2]) ** 2,
          });
        }
        draws += cell.draws;
        triangles += cell.triangles;
        roadsignQuads += cell.roadsignQuads;
      }
    }
    // Blend phase back-to-front by CELL distance — cross-cell transparency ordering (per-group order inside
    // a cell stays baked; the standard within-bundle transparency caveat).
    const blendBundles = blendCells.sort((a, b) => b.distanceSq - a.distanceSq).map((entry) => entry.bundle);
    since('frame:cull', cullStart);

    const recordStart = mark();
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    // Cumulus field bake (sky v2 perf): rewrite the tiny fbm field before anything samples it this frame
    // (256² × 10 vnoise ≈ fixed ~0.05 ms — full-deck weathers stopped scaling with the swapchain).
    const cloudFieldPass = encoder.beginRenderPass({
      colorAttachments: [{ loadOp: 'clear', storeOp: 'store', view: this.cloudFieldView }],
      label: 'cloud-field',
    });
    cloudFieldPass.setPipeline(this.pipelines.get('cloud-field'));
    cloudFieldPass.setBindGroup(0, this.cloudFieldBindGroup);
    cloudFieldPass.draw(3);
    cloudFieldPass.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.skyColor,
          loadOp: 'clear',
          resolveTarget: this.sceneColorView,
          storeOp: 'discard',
          view: this.msaaView,
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 0, // reversed-Z far plane
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: this.depthView,
      },
      label: 'world',
      ...this.timers.passTimestampWrites(),
    });
    // TWO-PHASE frame (field fix): every cell's OPAQUE first (complete depth), then the sky (background
    // pixels only), then every cell's BLENDS over the finished depth — a later cell's opaque can no longer
    // repaint an earlier cell's foliage/glass, and blends depth-test against the whole world.
    if (bundles.length > 0) {
      pass.executeBundles(bundles);
    }
    // ObjectTable draws (074/06 row 9): hour-gated timed objects + kind-4 UV-scroll (B7·c), in the opaque
    // phase (their blend groups sort with the world blends only approximately — the standard caveat).
    this.advanceUvAnimations(seconds);
    // The rigid lane's own animations (plan 099/02), stepped from the SAME clock: a script object's film
    // strip and a cell's scrolling sign must not drift apart.
    this.advanceModelUvAnimations(seconds);
    draws += this.drawObjects(pass);
    // Procedural clutter (074/19): grass/bushes/rocks, instanced, in the opaque phase before the sky.
    draws += this.drawClutter(pass, camera);
    draws += this.drawPed(pass);
    draws += this.drawVehicles(pass, false, camera.eye);
    pass.setPipeline(this.pipelines.get('sky'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.draw(3);
    // Water v1 (074/06 row 12): after the sky (fresnel reflects the finished dome direction-wise), before
    // the blends (foliage/glass then sort over the surface); depth READ hides it under land.
    draws += this.drawWater(pass);
    // Skid marks (089/03): ground decals over the finished opaque world, BEFORE the blends — foliage and
    // glass sort over a mark exactly as they sort over the road it lies on. No new pass (the plan's
    // alpha-sorting risk): this is a draw inside the phase that already exists.
    draws += this.drawSkidMarks(pass, seconds);
    if (blendBundles.length > 0) {
      pass.executeBundles(blendBundles);
    }
    // Entity glass after the world blends (074/08 B2): composites over the finished frame.
    draws += this.drawVehicles(pass, true, camera.eye);
    // 2dfx coronas last (074/06 row 13): additive on top of everything, depth-read hides occluded ones.
    draws += this.drawParticles(pass);
    draws += this.drawDynamicParticles(pass, seconds);
    draws += this.drawDebris(pass);
    draws += this.drawCoronas(pass, camera);
    draws += this.drawDebugLines(pass);
    // Probe DEBUG view (074/16): overdraw the frame with the cube panorama — orientation checked by eye.
    if (this.probeView) {
      pass.setPipeline(this.pipelines.get('probe-view'));
      pass.setBindGroup(0, this.frameBindGroup);
      pass.setBindGroup(1, this.probeViewBindGroup);
      pass.draw(3);
    }
    pass.end();
    // Bloom chain (074/09): full-res luminance prefilter → 13-tap down mips → tent upsamples. Skipped
    // ENTIRELY at intensity 0 (the composite multiplies the stale texture by 0, so it can't leak in).
    const bloomChain = this.bloomChain;
    const bloomOn = bloomChain !== null && this.environment.bloomIntensity > 0;
    if (bloomChain && bloomOn) {
      const scratch = this.bloomPrefilterScratch;
      scratch[4] = this.environment.bloomThreshold;
      scratch[5] = BLOOM_SMOOTHING;
      this.device.queue.writeBuffer(this.bloomPrefilterUniform, 0, scratch);
      this.runFullscreenPass(
        encoder,
        'bloom-prefilter',
        bloomChain.prefilterBindGroup,
        bloomChain.prefilterView,
        this.timers.postBeginTimestampWrites(),
      );
      for (let i = 0; i < bloomChain.downViews.length; i += 1) {
        this.runFullscreenPass(encoder, 'bloom-down', bloomChain.downBindGroups[i], bloomChain.downViews[i], {});
      }
      for (let i = bloomChain.upViews.length - 1; i >= 0; i -= 1) {
        this.runFullscreenPass(encoder, 'bloom-up', bloomChain.upBindGroups[i], bloomChain.upViews[i], {});
      }
    }
    // Godrays + bloom composite + ACES (074/09): written to the sRGB swapchain. Uniform updated first.
    this.device.queue.writeBuffer(this.postUniform, 0, this.fillPostUniform());
    const postPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 1, b: 0, g: 0, r: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view: canvasTexture.createView({ format: this.engineDevice.colorFormat }),
        },
      ],
      label: 'post',
      ...(bloomOn ? this.timers.postEndTimestampWrites() : this.timers.postOnlyTimestampWrites()),
    });
    postPass.setPipeline(this.pipelines.get('post'));
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3);
    postPass.end();
    since('frame:record', recordStart);

    const submitPhase = mark();
    this.timers.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timers.read();
    since('frame:submit', submitPhase);
    if (detail) {
      this.firstFrameTotals.push(this.firstFrameSpans.drain());
    }

    this.statsValue.submitMs = performance.now() - submitStart;
    this.statsValue.gpuPassMs = this.timers.lastPassMs;
    this.statsValue.gpuPostMs = this.timers.lastPostMs;
    this.statsValue.gpuProbeMs = this.timers.lastProbeMs;
    this.statsValue.cellsTotal = total;
    this.statsValue.cellsVisible = bundles.length;
    this.statsValue.drawsRecorded = draws;
    this.statsValue.trianglesRecorded = triangles + this.frameTriangles;
    this.statsValue.roadsignQuadsRecorded = roadsignQuads;
    this.statsValue.residencyBytes = this.resources.totalBytes();

    return this.statsValue;
  }

  /**
   * `coronaSprites` are the SA billboards (particle.txd): layer 0 = `coronastar` for lamps and headlights,
   * layer 1 = `coronamoon`. They arrive at INIT because the frame bind group is recorded into every cell
   * bundle and is immutable afterwards — the texture must exist before the first cell loads. Its size comes
   * from the DATA, not from a constant, so a higher-resolution moon drops straight in.
   */
  async init(canvas: HTMLCanvasElement, coronaSprites?: CoronaSprites): Promise<void> {
    // Boot is split the way the first frames are (201/4-03), and for the same reason: the phone measured
    // `engine.init` at 2 607.5 ms on 2026-08-26 — larger than everything else in the boot put together —
    // and a number that big with no breakdown is the next confident wrong guess waiting to be made.
    const bootStarted = performance.now();
    const bootPhase = (name: string, from: number): number => {
      this.bootSpans.add(name, performance.now() - from);

      return performance.now();
    };
    this.engineDevice = await initDevice();
    let at = bootPhase('init:device', bootStarted);
    this.canvasElement = canvas;
    this.canvasContext = configureCanvas(canvas, this.engineDevice);
    this.resources = new Resources(this.device);
    this.timers = new GpuTimers(this.device, this.engineDevice.hasTimestamps);
    at = bootPhase('init:canvas', at);
    // Scene pipelines target the 16-float offscreen (godrays bright-pass needs the HDR overshoot); only
    // the post pipeline writes the sRGB swapchain.
    this.pipelines = await compileAll(this.device, SCENE_FORMAT, DEPTH_FORMAT, this.engineDevice.colorFormat);
    at = bootPhase('init:pipelines', at);
    // Scene env probe (074/16 step 2) — fixed-size, allocated once, BEFORE any vehicle model binds its cube.
    this.probe = new EnvProbe(this.device, this.resources, this.pipelines);
    // License-plate arrays (plan 082/03), allocated here for the same reason as the probe: their views go
    // into every vehicle bind group, so they must exist before the first car binds one. The text atlas is
    // final at its CAP size; the backgrounds start as a placeholder because their real size is whatever the
    // game's `generic/vehicle.txd` ships (64×32 stock, 512×256 in the pack that is installed).
    this.plateTexture = this.createPlateTexture(PLATE_SLOT_WIDTH, PLATE_SLOT_HEIGHT, PLATE_CAPACITY, 'plate-text');
    this.plateBackTexture = this.createPlateTexture(1, 1, PLATE_BACKGROUNDS, 'plate-backgrounds');
    this.probeViewBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: this.probe.cubeView },
        { binding: 1, resource: this.probe.sampler },
      ],
      label: 'probe-view',
      layout: this.pipelines.probeViewLayout,
    });
    // The rigid lane's shared IDENTITY UV transform (plan 099/02). One buffer for the whole engine: every
    // model that animates nothing binds it, so a car costs no allocation and its draws stay a no-op.
    this.identityUvAnim = this.resources.createBuffer('uniform', {
      label: 'uv-anim-identity',
      size: UV_ANIM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.identityUvAnim, 0, new Float32Array(UV_ANIM_IDENTITY));
    this.frameUniform = this.resources.createBuffer('uniform', {
      label: 'frame',
      size: 416, // viewProj + invViewProj (128) + 18 × vec4 (camera/sun/params/sky×2/fog/params2/moon×2/params3/sunCore/sunCorona/water/params4/cloudTop/cloudBottom/ambient)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Local light pool (074/06 row 7): CPU-filled point lights, shared by every frame-layout pipeline.
    this.lightPoolBuffer = this.resources.createBuffer('uniform', {
      label: 'light-pool',
      size: this.lightPoolScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // PBR sky LUT (074/06 row 4): CPU-built Preetham dome, refreshed when the environment moves.
    this.skyLutTexture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba16float',
        label: 'sky-lut',
        size: { height: SKY_LUT_HEIGHT, width: SKY_LUT_WIDTH },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      SKY_LUT_WIDTH * SKY_LUT_HEIGHT * 8,
    );
    // Cumulus field (sky v2 perf): the tiny bake target the cloud-field pass rewrites each frame.
    this.cloudFieldTexture = this.resources.createTexture(
      'texture',
      {
        format: 'rg16float',
        label: 'cloud-field',
        size: { height: CLOUD_FIELD_SIZE, width: CLOUD_FIELD_SIZE },
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      },
      CLOUD_FIELD_SIZE * CLOUD_FIELD_SIZE * 4,
    );
    this.cloudFieldView = this.cloudFieldTexture.createView();
    this.cloudFieldBindGroup = this.device.createBindGroup({
      entries: [{ binding: 0, resource: { buffer: this.frameUniform } }],
      label: 'cloud-field',
      layout: this.pipelines.cloudFieldLayout,
    });
    const sprites = coronaSprites ?? proceduralCoronaSprites();
    this.coronaTexture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'corona-sprites',
        size: { depthOrArrayLayers: sprites.layers, height: sprites.height, width: sprites.width },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      sprites.rgba.byteLength,
    );
    const spriteLayerBytes = sprites.width * sprites.height * 4;
    for (let layer = 0; layer < sprites.layers; layer += 1) {
      this.device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: layer }, texture: this.coronaTexture },
        sprites.rgba.subarray(layer * spriteLayerBytes, (layer + 1) * spriteLayerBytes),
        { bytesPerRow: sprites.width * 4 },
        { height: sprites.height, width: sprites.width },
      );
    }
    this.frameBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.frameUniform } },
        { binding: 1, resource: this.skyLutTexture.createView() },
        {
          binding: 2,
          resource: this.device.createSampler({ label: 'sky-lut', magFilter: 'linear', minFilter: 'linear' }),
        },
        { binding: 3, resource: { buffer: this.lightPoolBuffer } },
        { binding: 6, resource: this.coronaTexture.createView({ dimension: '2d-array' }) },
        { binding: 7, resource: this.cloudFieldView },
      ],
      label: 'frame',
      layout: this.pipelines.frameLayout,
    });
    at = bootPhase('init:resources', at);
    this.refreshSkyLut();
    at = bootPhase('init:sky-lut', at);
    this.textures = new TextureArrays(this.device, this.resources, this.pipelines.materialLayout);
    // Corona pass buffers (074/06 row 13): a unit quad + a per-frame instance buffer (CPU-filled, tiny).
    this.coronaQuad = this.resources.createBuffer('cellVertex', {
      label: 'corona-quad',
      size: 48,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.coronaQuad, 0, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.coronaInstances = this.resources.createBuffer('cellVertex', {
      label: 'corona-instances',
      size: CORONA_CAP * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.postUniform = this.resources.createBuffer('uniform', {
      label: 'post',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postSampler = this.device.createSampler({ label: 'post', magFilter: 'linear', minFilter: 'linear' });
    this.bloomPrefilterUniform = this.resources.createBuffer('uniform', {
      label: 'bloom-prefilter',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Clutter (074/19): mip + repeat so scattered grass/bush cards filter and their UVs tile like the world.
    this.clutterSampler = this.device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      label: 'clutter',
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.cells = new CellStore({
      colorFormat: SCENE_FORMAT,
      depthFormat: DEPTH_FORMAT,
      device: this.device,
      frameBindGroup: this.frameBindGroup,
      pipelines: this.pipelines,
      resources: this.resources,
      textures: this.textures,
    });
    this.ensureTargets(canvas.width, canvas.height);
    bootPhase('init:targets', at);
    this.bootTotals = this.bootSpans.drain();
  }

  /**
   * Install (replacing) the dynamic one-shot lane's library (089/01): its sprite atlas, its baked system
   * records and their blend routing. Called ONCE at boot by the host — per-frame work is `spawnParticle`
   * plus at most one partial buffer write per blend mode inside `frame`.
   */
  initDynamicParticles(library: DynamicParticleLibrary): void {
    this.removeDynamicParticles();
    if (library.systems.length === 0) {
      return;
    }
    this.dynamicParticles = new DynamicParticles(this.device, this.resources, this.pipelines.particleLayout, library);
  }

  /** Install (replacing) the skid-mark decal lane (089/03): SA's particleskid sprite, once at boot. */
  initSkidMarks(sprite: { height: number; rgba: Uint8Array; width: number }): void {
    this.removeSkidMarks();
    this.skidMarks = new SkidMarks(this.device, this.resources, this.pipelines.skidLayout, sprite);
  }

  /** Residency ledger passthrough (HUD + leak assertions). */
  ledger(): ReturnType<Resources['ledger']> {
    return this.resources.ledger();
  }

  /**
   * Streaming's eviction seam for a WORLD texture array. A live rigid instance still drawing with `ref`
   * KEEPS the array (its cached bind group references the shared texture — destroying it under a recorded
   * bundle is "destroyed texture used in a submit", the black screen at the ferris wheel). Otherwise every
   * cached world-array bind group over `ref` is dropped first — a later reload mints a NEW texture, and a
   * stale cache would keep submitting the destroyed one — and the array is unloaded. True = unloaded.
   */
  releaseWorldArray(ref: number): boolean {
    for (const model of this.vehicleModels.values()) {
      if (!model.worldArrays || !model.instances.some((state) => state !== null)) {
        continue;
      }
      if (model.submeshes.some((submesh) => (submesh.array ?? 0) === ref)) {
        return false;
      }
    }
    for (const model of this.vehicleModels.values()) {
      if (model.worldArrays) {
        model.bindGroups.delete(ref);
      }
    }
    this.textures.unload(ref);

    return true;
  }

  /** Drop a streamed-out cell's clutter (074/19). */
  removeCellClutter(key: string): void {
    const draws = this.clutterCells.get(key);
    if (!draws) {
      return;
    }
    for (const draw of draws) {
      for (const hash of draw.keyHashes) {
        this.clutterBreakables.delete(hash);
      }
      this.resources.destroyBuffer('uniform', draw.matrixBuffer);
      this.resources.destroyBuffer('uniform', draw.drawDistanceBuffer);
    }
    this.clutterCells.delete(key);
  }

  removeDynamicParticles(): void {
    this.dynamicParticles?.destroy();
    this.dynamicParticles = null;
  }

  removeParticles(): void {
    if (!this.particles) {
      return;
    }
    this.resources.destroyBuffer('cellVertex', this.particles.instancesAdd);
    this.resources.destroyBuffer('cellVertex', this.particles.instancesBlend);
    this.resources.destroyBuffer('cellVertex', this.particles.systems);
    this.resources.destroyTexture('texture', this.particles.texture, this.particles.textureBytes);
    this.particles = null;
  }

  removePedProbe(): void {
    if (!this.ped) {
      return;
    }
    for (const buffer of this.ped.buffers) {
      this.resources.destroyBuffer('cellVertex', buffer);
    }
    this.resources.destroyBuffer('cellVertex', this.ped.indexBuffer);
    this.resources.destroyBuffer('uniform', this.ped.paletteBuffer);
    for (const texture of this.pedTextures) {
      this.resources.destroyTexture('texture', texture, this.pedTextureBytes / Math.max(1, this.pedTextures.length));
    }
    this.pedTextures = [];
    this.ped = null;
  }

  removeSkidMarks(): void {
    this.skidMarks?.destroy();
    this.skidMarks = null;
  }

  /**
   * Install (replacing) one streamed cell's clutter (074/19): per model, its instance world matrices (engine
   * space). Call when a cell streams in; `removeCellClutter` on unload. The instance count is bounded by the
   * host's per-cell budget (prod's `procObjLimit`), so this stays cheap.
   */
  setCellClutter(key: string, entries: readonly CellClutter[]): void {
    this.removeCellClutter(key);
    const draws: ClutterCellDraw[] = [];
    for (const entry of entries) {
      const model = this.clutterModels.get(entry.model);
      if (!model || entry.matrices.length === 0) {
        continue;
      }
      const matrixBuffer = this.resources.createBuffer('uniform', {
        label: `clutter-matrices:${key}:${entry.model}`,
        size: entry.matrices.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(matrixBuffer, 0, entry.matrices);
      // The group's visibility radius, squared, for the vertex shader's per-instance test (16 bytes is the
      // uniform-buffer minimum; only .x is read).
      const drawDistanceBuffer = this.resources.createBuffer('uniform', {
        label: `clutter-range:${key}:${entry.model}`,
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(
        drawDistanceBuffer,
        0,
        new Float32Array([entry.drawDistance * entry.drawDistance, 0, 0, 0]),
      );
      // Breakable clutter (074/20): register each instance's key → its matrix slot, so a hit can degenerate it.
      const keyHashes: number[] = [];
      const instanceCount = entry.matrices.length / 16;
      if (entry.keyHashes) {
        for (let index = 0; index < instanceCount; index += 1) {
          const hash = entry.keyHashes[index];
          if (hash !== 0) {
            this.clutterBreakables.set(hash, { matrixBuffer, offset: index * 64 });
            keyHashes.push(hash);
          }
        }
      }
      draws.push({
        bindGroup: this.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: matrixBuffer } },
            { binding: 1, resource: model.texture.createView({ dimension: '2d-array' }) },
            { binding: 2, resource: this.clutterSampler },
            { binding: 3, resource: { buffer: drawDistanceBuffer } },
          ],
          label: `clutter:${key}:${entry.model}`,
          layout: this.pipelines.clutterLayout,
        }),
        bounds: clutterBounds(entry.matrices),
        drawDistance: entry.drawDistance,
        drawDistanceBuffer,
        instanceCount,
        keyHashes,
        matrixBuffer,
        model: entry.model,
      });
    }
    if (draws.length > 0) {
      this.clutterCells.set(key, draws);
    }
  }

  setDebugLinesVisible(id: DebugLineSetId, visible: boolean): void {
    const set = this.debugLines.get(id);
    if (set) {
      set.visible = visible;
    }
  }

  /**
   * Replace the whole particle set (B6). Called when the streamed cell set changes — rarely, and never per
   * frame: the lifecycle itself lives in the shader, so a static upload animates forever.
   */
  setParticles(upload: ParticleUpload): void {
    this.removeParticles();
    if (upload.systems.length === 0) {
      return;
    }
    const buffer = (label: string, data: Float32Array, usage: number): GPUBuffer => {
      const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
      const gpu = this.resources.createBuffer('cellVertex', {
        label: `particle-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(gpu, 0, data);

      return gpu;
    };
    const layerBytes = upload.atlas.width * upload.atlas.height * 4;
    const texture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'particle-atlas',
        size: {
          depthOrArrayLayers: Math.max(1, upload.atlas.layers),
          height: upload.atlas.height,
          width: upload.atlas.width,
        },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      upload.atlas.rgba.byteLength,
    );
    for (let layer = 0; layer < upload.atlas.layers; layer += 1) {
      this.device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: layer }, texture },
        upload.atlas.rgba.subarray(layer * layerBytes, (layer + 1) * layerBytes),
        { bytesPerRow: upload.atlas.width * 4 },
        { height: upload.atlas.height, width: upload.atlas.width },
      );
    }
    const systems = buffer('systems', upload.systems, GPUBufferUsage.STORAGE);
    this.particles = {
      bindGroup: this.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: systems } },
          { binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
          {
            binding: 2,
            resource: this.device.createSampler({ label: 'particle', magFilter: 'linear', minFilter: 'linear' }),
          },
        ],
        label: 'particle',
        layout: this.pipelines.particleLayout,
      }),
      countAdd: upload.instancesAdd.length / PARTICLE_STRIDE,
      countBlend: upload.instancesBlend.length / PARTICLE_STRIDE,
      instancesAdd: buffer('add', upload.instancesAdd, GPUBufferUsage.VERTEX),
      instancesBlend: buffer('blend', upload.instancesBlend, GPUBufferUsage.VERTEX),
      systems,
      texture,
      textureBytes: upload.atlas.rgba.byteLength,
    };
  }

  /** Create (or replace) the skinning probe entity (074/08 B1). Returns the live palette handle. */
  setPedProbe(init: PedProbeInit): PedProbe {
    this.removePedProbe();
    const upload = (label: string, bytes: Uint8Array, usage: number): GPUBuffer => {
      const size = Math.ceil(bytes.byteLength / 4) * 4;
      const buffer = this.resources.createBuffer('cellVertex', {
        label: `ped-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      // writeBuffer length must be %4 (the M0 lesson) — odd u16 index payloads get a zero-padded copy.
      let payload = bytes;
      if (bytes.byteLength !== size) {
        payload = new Uint8Array(size);
        payload.set(bytes);
      }
      this.device.queue.writeBuffer(buffer, 0, payload);

      return buffer;
    };
    const buffers = [
      upload('positions', init.positions, GPUBufferUsage.VERTEX),
      upload('normals', init.normals, GPUBufferUsage.VERTEX),
      upload('uvs', init.uvs, GPUBufferUsage.VERTEX),
      upload('joints', init.joints, GPUBufferUsage.VERTEX),
      upload('weights', init.weights, GPUBufferUsage.VERTEX),
    ];
    const indexBuffer = upload('indices', init.indices, GPUBufferUsage.INDEX);
    const palette = new Float32Array((1 + init.boneCount) * 16);
    const paletteBuffer = this.resources.createBuffer('uniform', {
      label: 'ped-palette',
      size: palette.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // One GPU texture per dictionary, then a bind group per SUBMESH holding a 2D view of the one layer it
    // draws with. That is why the ped shader needs no change to support several arrays: a `2d` view over
    // `baseArrayLayer` looks exactly like the single image it used to bind.
    const uploads = init.textures.map((texture) => this.createModelTexture(texture, 'ped-texture'));
    const sampler = this.device.createSampler({ label: 'ped', magFilter: 'linear', minFilter: 'linear' });
    const submeshes = init.submeshes.map((submesh) => ({
      bindGroup: this.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: paletteBuffer } },
          {
            binding: 1,
            resource: (uploads[submesh.array] ?? uploads[0]).texture.createView({
              arrayLayerCount: 1,
              baseArrayLayer: submesh.layer,
              dimension: '2d',
            }),
          },
          { binding: 2, resource: sampler },
        ],
        label: 'ped',
        layout: this.pipelines.pedLayout,
      }),
      indexCount: submesh.indexCount,
      indexOffset: submesh.indexOffset,
    }));
    this.ped = { buffers, indexBuffer, palette, paletteBuffer, submeshes };
    this.pedTextures = uploads.map((upload) => upload.texture);
    this.pedTextureBytes = uploads.reduce((sum, upload) => sum + upload.byteEstimate, 0);

    return { palette };
  }

  /**
   * Install the pak's UV-scroll animations (B7·c / plan 074/18) — call once after the manifest loads. A cell's
   * kind-4 objectTable draw stores a slot index into this list; the engine advances every entry each frame and
   * feeds each visible scroller its current transform. Empty is fine (scrollers render static).
   */
  setUvAnimations(animations: readonly OspakUvAnimation[]): void {
    this.uvAnimations = animations.map((animation) => ({
      duration: animation.duration,
      keyframes: [...animation.keyframes].sort((a, b) => a.time - b.time),
    }));
    this.uvAnimTransforms = new Float32Array(this.uvAnimations.length * 4);
    for (let index = 0; index < this.uvAnimations.length; index += 1) {
      this.uvAnimTransforms.set([0, 0, 1, 1], index * 4);
    }
  }

  /** Install the water surface (074/06 row 12 v2): interleaved [x,y,z,shoreDist] vertices (ENGINE space —
   *  the baked tessellated mesh, or the flat runtime fallback with a constant deep field); `ripple` /
   *  `foam` = the authored particle.txd textures (waterclear256 / waterwake), 1×1 stubs when absent.
   *  One static mesh — call once at load (re-call replaces it). */
  setWater(
    vertexData: Float32Array,
    indices: Uint32Array,
    ripple: null | { height: number; rgba: Uint8Array; width: number },
    foam: null | { height: number; rgba: Uint8Array; width: number },
  ): void {
    const vertices = this.resources.createBuffer('cellVertex', {
      label: 'water-vertices',
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertices, 0, vertexData);
    const indexBuffer = this.resources.createBuffer('cellIndex', {
      label: 'water-indices',
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, indices);
    const upload = (
      source: null | { height: number; rgba: Uint8Array; width: number },
      label: string,
      stub: Uint8Array,
    ): GPUTexture => {
      const width = source?.width ?? 1;
      const height = source?.height ?? 1;
      const texture = this.resources.createTexture(
        'texture',
        {
          format: 'rgba8unorm',
          label,
          size: { height, width },
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        },
        width * height * 4,
      );
      this.device.queue.writeTexture({ texture }, source?.rgba ?? stub, { bytesPerRow: width * 4 }, { height, width });

      return texture;
    };
    const rippleTexture = upload(ripple, 'water-ripple', new Uint8Array([128, 128, 128, 255]));
    const foamTexture = upload(foam, 'water-foam', new Uint8Array([0, 0, 0, 0]));
    const bindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: rippleTexture.createView() },
        {
          binding: 1,
          // The ripple/foam TILE across the sea — repeat addressing (the default clamp smears them).
          resource: this.device.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            label: 'water',
            magFilter: 'linear',
            minFilter: 'linear',
          }),
        },
        { binding: 2, resource: foamTexture.createView() },
      ],
      label: 'water',
      layout: this.pipelines.waterLayout,
    });
    this.water = { bindGroup, indexCount: indices.length, indices: indexBuffer, vertices };
  }

  /**
   * Spawn one break's debris (B7·a). The shards' whole flight is baked into the vertices, so this uploads
   * once and costs one draw per frame until it expires — no simulation, no per-frame writes.
   *
   * `vertices` is the interleaved layout the debris pipeline declares (80 bytes/vertex), already in ENGINE
   * space. Oldest breaks are evicted past the budget: a pile-up of smashes must not creep the frame.
   */
  spawnDebris(upload: DebrisUpload): void {
    if (this.debris.length >= MAX_ACTIVE_DEBRIS) {
      this.destroyDebris(this.debris.shift()!);
    }
    const vertexBuffer = this.resources.createBuffer('debris', {
      label: 'debris:vb',
      size: upload.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, upload.vertices);
    const uniform = this.resources.createBuffer('uniform', {
      label: 'debris:uniform',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const spawn = (performance.now() - this.startedMs) / 1000;
    this.device.queue.writeBuffer(uniform, 0, new Float32Array([spawn, upload.lifetime, upload.fade, upload.gravity]));
    const { byteEstimate: textureBytes, texture } = this.createModelTexture(upload.texture, 'debris:shards');
    this.debris.push({
      bindGroup: this.device.createBindGroup({
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
          {
            binding: 2,
            resource: this.device.createSampler({ label: 'debris', magFilter: 'linear', minFilter: 'linear' }),
          },
        ],
        label: 'debris',
        layout: this.pipelines.debrisLayout,
      }),
      expiresAt: spawn + upload.lifetime,
      texture,
      textureBytes,
      uniform,
      vertexBuffer,
      vertexCount: upload.vertices.byteLength / DEBRIS_STRIDE,
    });
  }

  /**
   * Rewrite a debug wireframe's vertices in place. For overlays that DEFORM — a skinned character's
   * skeleton or mesh edges — where re-creating the buffer every frame would churn GPU allocations.
   * The new data must not exceed the size the set was created with.
   */
  /**
   * Spawn one one-shot particle NOW at a world point (089/01). `systemIndex` addresses the installed
   * dynamic library; velocity is engine-space units/second; `alpha` scales the system's authored alpha
   * envelope for THIS particle (089/02 round 2 — a gentle slide's smoke is fainter, not just shorter).
   * Returns false — and DROPS the spawn — when no library is installed, the index is unknown, the pool is
   * full, or the effects gate is off.
   */
  spawnParticle(
    systemIndex: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    alpha = 1,
  ): boolean {
    if (!this.dynamicParticles || !this.particlesEnabled) {
      return false;
    }
    const now = (performance.now() - this.startedMs) / 1000;

    return this.dynamicParticles.spawn(now, systemIndex, x, y, z, vx, vy, vz, life, alpha);
  }

  updateDebugLines(id: DebugLineSetId, positions: Float32Array): void {
    const set = this.debugLines.get(id);
    if (!set) {
      return;
    }
    this.device.queue.writeBuffer(set.vertices, 0, positions);
    set.vertexCount = Math.floor(positions.length / 3);
  }

  /** Upload the probe's palette after the host wrote it (model matrix slot 0 + sampled bones). */
  updatePedPalette(): void {
    if (this.ped) {
      this.device.queue.writeBuffer(this.ped.paletteBuffer, 0, this.ped.palette);
    }
  }

  /** Flatten every live instance and upload its matrix rows (call once after mutating the entities). */
  updateVehicles(): void {
    for (const model of this.vehicleModels.values()) {
      const rowBytes = model.partCount * 64;
      for (const state of model.instances) {
        if (!state) {
          continue;
        }
        state.entity.flatten();
        this.device.queue.writeBuffer(model.matrixBuffer, state.slot * rowBytes, state.entity.matrices);
      }
    }
  }

  /**
   * Install the three city backgrounds a `carpback` quad samples (plan 082/03). Called ONCE at boot, from
   * whatever `models/generic/vehicle.txd` the running game ships — the rasters are re-created at the size
   * that TXD carries, because a mod may replace them wholesale (64×32 stock, 512×256 in the installed
   * pack), and any model bind group built before this point is dropped so it re-binds the real array.
   *
   * Backgrounds live apart from the text atlas rather than as fixed slots inside it: a texture array is one
   * size for every layer, and 512×256 backgrounds would make each 64×16 text slot cost 512 KB.
   */
  uploadPlateBackgrounds(rasters: readonly { height: number; rgba: Uint8Array; width: number }[]): void {
    const first = rasters[0];
    if (!first || rasters.length !== PLATE_BACKGROUNDS) {
      return; // a dictionary we could not read: every plate keeps the stock placeholder
    }
    this.plateBackTexture.destroy();
    this.plateBackTexture = this.createPlateTexture(first.width, first.height, PLATE_BACKGROUNDS, 'plate-backgrounds');
    rasters.forEach((raster, layer) => {
      // A mod that ships the three at DIFFERENT sizes gets the first one's; writing a mismatched raster
      // would be a validation error, and a missing background is worse than a resampled one.
      if (raster.width === first.width && raster.height === first.height) {
        this.writePlateLayer(this.plateBackTexture, layer, raster.rgba, raster.width, raster.height);
      }
    });
    for (const model of this.vehicleModels.values()) {
      model.bindGroups.clear();
    }
  }

  /**
   * Put one generated plate raster into the shared text atlas (plan 082/03). The slot is the host's to
   * choose and to recycle — the engine only owns the array. Out-of-range slots are ignored rather than
   * throwing: a plate is cosmetic, and the alternative is taking the frame down over a number.
   */
  uploadPlateText(slot: number, rgba: Uint8Array): void {
    if (slot < 0 || slot >= PLATE_CAPACITY || rgba.byteLength !== PLATE_SLOT_WIDTH * PLATE_SLOT_HEIGHT * 4) {
      return;
    }
    this.writePlateLayer(this.plateTexture, slot, rgba, PLATE_SLOT_WIDTH, PLATE_SLOT_HEIGHT);
  }

  /**
   * Step every ANIMATED rigid model's transforms to `seconds` (plan 099/02) — the same clock the world lane
   * reads, or a sign on a building and a sign on a script object would visibly disagree.
   *
   * Gated twice: a model with no animations is skipped (that is every car), and so is one with no LIVE
   * instance — the buffer of an unspawned model cannot be sampled, so writing it would be pure cost.
   */
  private advanceModelUvAnimations(seconds: number): void {
    for (const model of this.vehicleModels.values()) {
      if (model.uvAnimations.length === 0 || !model.instances.some((state) => state !== null)) {
        continue;
      }
      model.uvAnimations.forEach((animation, index) => {
        stepUvAnimation(animation, seconds, this.uvAnimScratch, 0);
        // Slot index + 1: slot 0 is the identity every static submesh of this same model binds.
        this.device.queue.writeBuffer(model.uvAnimBuffer, (index + 1) * UV_ANIM_STRIDE, this.uvAnimScratch);
      });
    }
  }

  /** ObjectTable draws for visible cells (074/06 row 9). Timed: render when `hour` is inside [on, off). */
  /** Advance every UV-scroll animation to wall-clock `seconds` (B7·c / plan 074/18). The prod lerp: equal-time
   *  keyframe pairs snap (DolSign's stepped flipbook), the rest lerp. A handful of entries — cheap per frame. */
  private advanceUvAnimations(seconds: number): void {
    for (let index = 0; index < this.uvAnimations.length; index += 1) {
      stepUvAnimation(this.uvAnimations[index], seconds, this.uvAnimTransforms, index * 4);
    }
  }

  /**
   * Put group 1 in the state this submesh needs, if it is not already. Returns false when the submesh's
   * WORLD texture array has not streamed in yet — the caller skips it and it appears the frame it lands.
   *
   * The UV-anim slot is tracked beside the array rather than folded into it (plan 099/02): the dynamic
   * offset is part of the binding, so two submeshes sharing one array but animating differently still need
   * a rebind each. `current` is mutated — it is the caller's running state across the whole model.
   */
  private bindRigidSubmesh(
    pass: GPURenderPassEncoder,
    model: VehicleModel,
    submesh: VehicleSubmesh,
    current: { array: number; offset: number },
  ): boolean {
    const array = submesh.array ?? 0;
    const offset = uvAnimOffset(submesh.uvAnim, model.uvAnimations.length);
    if (array === current.array && offset === current.offset) {
      return true;
    }
    const group = this.rigidBindGroup(model, array);
    if (!group) {
      return false;
    }
    pass.setBindGroup(1, group, [offset]);
    current.array = array;
    current.offset = offset;

    return true;
  }

  /**
   * (Re)build the bloom mip chain for the current target size (074/09 — prod BloomEffect geometry:
   * iterative `round(size/2)`, 8 levels). The previous chain IS destroyed on resize — unlike the two
   * scene targets this is a dozen-and-a-half small textures and uniforms.
   */
  private buildBloomChain(width: number, height: number): void {
    const previous = this.bloomChain;
    if (previous) {
      for (const { bytes, texture } of previous.textures) {
        this.resources.destroyTexture('target', texture, bytes);
      }
      for (const uniform of previous.uniforms) {
        this.resources.destroyBuffer('uniform', uniform);
      }
    }
    const textures: { bytes: number; texture: GPUTexture }[] = [];
    const uniforms: GPUBuffer[] = [];
    const makeTarget = (label: string, w: number, h: number): GPUTextureView => {
      const bytes = w * h * 8;
      const texture = this.resources.createTexture(
        'target',
        {
          format: SCENE_FORMAT,
          label,
          size: { height: h, width: w },
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        },
        bytes,
      );
      textures.push({ bytes, texture });

      return texture.createView();
    };
    // Static per-level params: texel = 1/INPUT size (the kernels step in input texels), radius for tents.
    const makeUniform = (label: string, inputW: number, inputH: number, radius: number): GPUBuffer => {
      const buffer = this.resources.createBuffer('uniform', {
        label,
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buffer, 0, new Float32Array([1 / inputW, 1 / inputH, 0, 0, 0, 0, radius, 0]));
      uniforms.push(buffer);

      return buffer;
    };
    // Prefilter (FULL res — prod thresholds texel-wise before the chain so sub-pixel emitters survive).
    const prefilterView = makeTarget('bloom-prefilter', width, height);
    const prefilterBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.bloomPrefilterUniform } },
        { binding: 1, resource: this.sceneColorView },
        { binding: 2, resource: this.postSampler },
      ],
      label: 'bloom-prefilter',
      layout: this.pipelines.bloomLayout,
    });
    const downSizes: { height: number; width: number }[] = [];
    const downViews: GPUTextureView[] = [];
    const downBindGroups: GPUBindGroup[] = [];
    let w = width;
    let h = height;
    for (let i = 0; i < BLOOM_LEVELS; i += 1) {
      const inputW = w;
      const inputH = h;
      w = Math.max(1, Math.round(w * 0.5));
      h = Math.max(1, Math.round(h * 0.5));
      downSizes.push({ height: h, width: w });
      downViews.push(makeTarget(`bloom-down-${i}`, w, h));
      downBindGroups.push(
        this.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: makeUniform(`bloom-down-${i}`, inputW, inputH, 0) } },
            { binding: 1, resource: i === 0 ? prefilterView : downViews[i - 1] },
            { binding: 2, resource: this.postSampler },
          ],
          label: `bloom-down-${i}`,
          layout: this.pipelines.bloomLayout,
        }),
      );
    }
    // Upsample mips: up[i] = tent(coarser) blended over down[i]; the coarsest input is down[levels−1].
    const upViews: GPUTextureView[] = [];
    const upBindGroups: GPUBindGroup[] = [];
    for (let i = 0; i < BLOOM_LEVELS - 1; i += 1) {
      upViews.push(makeTarget(`bloom-up-${i}`, downSizes[i].width, downSizes[i].height));
    }
    for (let i = 0; i < BLOOM_LEVELS - 1; i += 1) {
      const input = downSizes[i + 1];
      upBindGroups.push(
        this.device.createBindGroup({
          entries: [
            { binding: 0, resource: { buffer: makeUniform(`bloom-up-${i}`, input.width, input.height, BLOOM_RADIUS) } },
            { binding: 1, resource: i === BLOOM_LEVELS - 2 ? downViews[BLOOM_LEVELS - 1] : upViews[i + 1] },
            { binding: 2, resource: this.postSampler },
            { binding: 3, resource: downViews[i] },
          ],
          label: `bloom-up-${i}`,
          layout: this.pipelines.bloomUpLayout,
        }),
      );
    }
    this.bloomChain = {
      downBindGroups,
      downSizes,
      downViews,
      prefilterBindGroup,
      prefilterView,
      resultView: upViews[0],
      textures,
      uniforms,
      upBindGroups,
      upViews,
    };
  }

  /**
   * A model's texture array, from either side of the optimized/unoptimized split. The `ostex` branch is
   * the whole reason the per-model dictionary is compressed: the payload reaches video memory untouched.
   */
  private createModelTexture(
    init: ModelTextureInit,
    label = 'model-texture',
  ): { byteEstimate: number; texture: GPUTexture } {
    if (init.kind === 'ostex') {
      const upload = uploadOstexTexture(this.device, this.resources, init.bytes, label);

      return { byteEstimate: upload.byteEstimate, texture: upload.texture };
    }
    const layerBytes = init.width * init.height * 4;
    const texture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label,
        size: { depthOrArrayLayers: init.layers, height: init.height, width: init.width },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      init.rgba.byteLength,
    );
    for (let layer = 0; layer < init.layers; layer += 1) {
      this.device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: layer }, texture },
        init.rgba.subarray(layer * layerBytes, (layer + 1) * layerBytes),
        { bytesPerRow: init.width * 4 },
        { height: init.height, width: init.width },
      );
    }

    return { byteEstimate: init.rgba.byteLength, texture };
  }

  /**
   * A model's UV-animation uniform (plan 099/02): slot 0 identity, slots 1..N its animations, one
   * {@link UV_ANIM_STRIDE} apart so a draw can select its own with a dynamic offset.
   *
   * A model with NO animations gets the engine's shared identity buffer instead of one of its own — which
   * is every car, every ped and nearly every prop, so the common path allocates nothing and writes nothing.
   */
  private createModelUvAnim(animations: readonly UvAnimation[]): {
    animations: readonly UvAnimation[];
    buffer: GPUBuffer;
    owned: boolean;
  } {
    if (animations.length === 0) {
      return { animations, buffer: this.identityUvAnim, owned: false };
    }
    const buffer = this.resources.createBuffer('uniform', {
      label: 'vehicle-uv-anim',
      size: (animations.length + 1) * UV_ANIM_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Slot 0 stays identity for the model's own static submeshes — the ferris ring animates ONE material
    // and draws the rest of its geometry through the same bind group.
    this.device.queue.writeBuffer(buffer, 0, new Float32Array(UV_ANIM_IDENTITY));

    return { animations, buffer, owned: true };
  }

  /**
   * An RGBA8 texture ARRAY for the plate rasters. No mips: a plate is 64×16 and SA samples its own with
   * `rwFILTERNEAREST`, so there is no chain to build and nothing to lose by not having one.
   */
  private createPlateTexture(width: number, height: number, layers: number, label: string): GPUTexture {
    return this.device.createTexture({
      dimension: '2d',
      format: 'rgba8unorm',
      label,
      size: { depthOrArrayLayers: layers, height, width },
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  private createVehicleBindGroup(model: {
    lampBuffer: GPUBuffer;
    matrixBuffer: GPUBuffer;
    paintBuffer: GPUBuffer;
    plateBuffer: GPUBuffer;
    texture: GPUTexture;
    uvAnimBuffer: GPUBuffer;
  }): GPUBindGroup {
    return this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: model.matrixBuffer } },
        { binding: 1, resource: model.texture.createView({ dimension: '2d-array' }) },
        {
          binding: 2,
          // REPEAT, like prod's vehicle textures (`build-texture.ts` sets RepeatWrapping). SA vehicle UVs run
          // outside [0,1] — the lamp atlas addresses its quadrants that way — and the default clamp-to-edge
          // smears them into the border, which reads as lamps CUT OFF at a straight edge. The water shader
          // was bitten by exactly this.
          resource: this.device.createSampler({
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            label: 'vehicle',
            magFilter: 'linear',
            minFilter: 'linear',
          }),
        },
        { binding: 3, resource: { buffer: model.paintBuffer } },
        { binding: 4, resource: { buffer: model.lampBuffer } },
        // The scene env probe (074/16 step 2): one shared cube, allocated at init — the view is immutable,
        // only its CONTENTS refresh, so per-model bind groups can hold it safely.
        { binding: 5, resource: this.probe.cubeView },
        { binding: 6, resource: this.probe.sampler },
        { binding: 7, resource: { buffer: model.plateBuffer } },
        { binding: 8, resource: this.plateTexture.createView({ dimension: '2d-array' }) },
        { binding: 9, resource: this.plateBackTexture.createView({ dimension: '2d-array' }) },
        // The UV transform (plan 099/02). `size` bounds the binding to ONE slot so the per-draw dynamic
        // offset can slide it across the model's list; without it the binding would claim the whole buffer
        // and every offset past slot 0 would run off its end.
        { binding: 10, resource: { buffer: model.uvAnimBuffer, offset: 0, size: 16 } },
      ],
      label: 'vehicle',
      layout: this.pipelines.rigidLayout,
    });
  }

  /** One lamp-state vec4 per matrix row — indexed by the same `instance_index` as matrices and paint. */
  private createVehicleLampBuffer(partCount: number, capacity: number): GPUBuffer {
    return this.resources.createBuffer('uniform', {
      label: 'vehicle-lamps',
      size: partCount * capacity * LAMP_ROW_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private createVehicleMatrixBuffer(partCount: number, capacity: number): GPUBuffer {
    return this.resources.createBuffer('uniform', {
      label: 'vehicle-matrices',
      size: partCount * capacity * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /** 4 paint colours per matrix row — indexed by the same `instance_index` the matrices are (B5). */
  private createVehiclePaintBuffer(partCount: number, capacity: number): GPUBuffer {
    return this.resources.createBuffer('uniform', {
      label: 'vehicle-paint',
      size: partCount * capacity * PAINT_ROW_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  /** One plate vec4 per matrix row — indexed by the same `instance_index` as the matrices (082/03). */
  private createVehiclePlateBuffer(partCount: number, capacity: number): GPUBuffer {
    return this.resources.createBuffer('uniform', {
      label: 'vehicle-plates',
      size: partCount * capacity * PLATE_ROW_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private destroyDebris(entry: DebrisEntry): void {
    this.resources.destroyBuffer('debris', entry.vertexBuffer);
    this.resources.destroyBuffer('uniform', entry.uniform);
    this.resources.destroyTexture('texture', entry.texture, entry.textureBytes);
  }

  /**
   * Draw every live instance of every model. `firstInstance` carries the matrix row — slot × partCount +
   * part — so the WGSL side is unchanged from the single-probe days. One draw per visible submesh per car:
   * the known cost knob if a street full of parked cars ever pushes the draw budget.
   */
  /**
   * Two draws for every 2dfx emitter on the map (one per blend mode). The vertex shader owns the lifecycle,
   * so this is genuinely all there is to it per frame.
   */
  /** Draw the live breaks and retire the finished ones (their GPU resources go back immediately). */
  /** Debug wireframes (074/13 phase 4) — one draw per registered set, skipped entirely when there are none. */

  private drawClutter(pass: GPURenderPassEncoder, camera: CameraState): number {
    if (!this.clutterEnabled) {
      return 0;
    }
    let draws = 0;
    const [eyeX, eyeY, eyeZ] = camera.eye;
    for (const cellDraws of this.clutterCells.values()) {
      for (const draw of cellDraws) {
        const model = this.clutterModels.get(draw.model);
        // Per-category RANGE, whole-group half (the per-instance half is in `vsClutter`): a group whose
        // bounding sphere lies entirely past its draw distance is skipped here, so it costs neither vertex
        // work nor a triangle in the frame count. The shader's test is what handles a group the camera is
        // standing inside — it cannot be done here, because one group spans a 256-unit cell.
        const [boundX, boundY, boundZ, boundRadius] = draw.bounds;
        const nearest = Math.hypot(boundX - eyeX, boundY - eyeY, boundZ - eyeZ) - boundRadius;
        if (nearest > draw.drawDistance) {
          continue;
        }
        // Frustum-cull each cell-model group — clutter is streamed by DISTANCE (all around the player), so
        // most groups are off-screen; without this a dense area pays hundreds of behind-camera draws. Also skip
        // empty groups: a clutter DFF that built no geometry (indexCount 0) or a fully-broken cell (every
        // instance degenerated, instanceCount 0) would otherwise issue a zero-count draw WebGPU warns on.
        if (
          !model ||
          model.indexCount === 0 ||
          draw.instanceCount === 0 ||
          !frustumIntersectsSphere(this.frustumPlanes, draw.bounds[0], draw.bounds[1], draw.bounds[2], draw.bounds[3])
        ) {
          continue;
        }
        pass.setPipeline(this.pipelines.get(model.cutout ? 'clutter-cutout' : 'clutter-opaque'));
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setBindGroup(1, draw.bindGroup);
        model.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
        // Clutter species are small by construction (one scattered plant), and the loader derives their
        // count as byteLength / 2 — the uint16 assumption is the format here, not an oversight.
        pass.setIndexBuffer(model.indexBuffer, 'uint16');
        pass.drawIndexed(model.indexCount, draw.instanceCount);
        this.frameTriangles += (model.indexCount / 3) * draw.instanceCount;
        draws += 1;
      }
    }

    return draws;
  }

  /** 2dfx corona billboards of visible cells (074/06 row 13): CPU-gated by night + farClip, one
   *  instanced draw. Colour is premultiplied by the dn gate — coronas are a NIGHT phenomenon (v1). */
  private drawCoronas(pass: GPURenderPassEncoder, camera: CameraState): number {
    const gate = Math.min(1, Math.max(0, this.environment.dn * 1.5));
    let count = 0;
    const scratch = this.coronaScratch;
    // Host coronas (vehicle lamps) are already gated and faded by the caller — they do NOT ride the world's
    // day/night gate, so they must be filled before the 2dfx early-out.
    for (const corona of this.dynamicCoronas) {
      if (count >= CORONA_CAP) {
        break;
      }
      const at = count * 8;
      scratch[at] = corona.position[0];
      scratch[at + 1] = corona.position[1];
      scratch[at + 2] = corona.position[2];
      scratch[at + 3] = corona.size;
      scratch[at + 4] = corona.color[0];
      scratch[at + 5] = corona.color[1];
      scratch[at + 6] = corona.color[2];
      scratch[at + 7] = corona.fade;
      count += 1;
    }
    for (const cell of gate <= 0.02 ? [] : this.cells.all()) {
      if (!cell.visible || cell.lights.length === 0) {
        continue;
      }
      for (const light of cell.lights) {
        if (count >= CORONA_CAP) {
          break;
        }
        const dx = light.x - camera.eye[0];
        const dy = light.y - camera.eye[1];
        const dz = light.z - camera.eye[2];
        const dist = Math.hypot(dx, dy, dz);
        // farClip floor: SA clips street coronas ~100 units (street-level tuning) — the lab camera flies
        // high, so v1 keeps them alive to 350; the game integration restores the authored clip.
        const reach = Math.max(light.farClip, 350);
        if (dist > reach) {
          continue;
        }
        const fade = gate * Math.min(1, (1 - dist / reach) * 4) * (light.color[3] / 255);
        const at = count * 8;
        scratch[at] = light.x;
        scratch[at + 1] = light.y;
        scratch[at + 2] = light.z;
        scratch[at + 3] = light.size * 1.5;
        scratch[at + 4] = (light.color[0] / 255) ** 2.2;
        scratch[at + 5] = (light.color[1] / 255) ** 2.2;
        scratch[at + 6] = (light.color[2] / 255) ** 2.2;
        scratch[at + 7] = fade;
        count += 1;
      }
    }
    if (count === 0) {
      return 0;
    }
    this.device.queue.writeBuffer(this.coronaInstances, 0, scratch, 0, count * 8);
    pass.setPipeline(this.pipelines.get('corona'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.setVertexBuffer(0, this.coronaQuad);
    pass.setVertexBuffer(1, this.coronaInstances);
    pass.draw(6, count);
    this.frameTriangles += 2 * count; // billboard quads

    return 1;
  }

  private drawDebris(pass: GPURenderPassEncoder): number {
    const now = (performance.now() - this.startedMs) / 1000;
    while (this.debris.length > 0 && this.debris[0].expiresAt <= now) {
      this.destroyDebris(this.debris.shift()!);
    }
    if (this.debris.length === 0) {
      return 0;
    }
    pass.setPipeline(this.pipelines.get('debris'));
    pass.setBindGroup(0, this.frameBindGroup);
    for (const entry of this.debris) {
      pass.setBindGroup(1, entry.bindGroup);
      pass.setVertexBuffer(0, entry.vertexBuffer);
      pass.draw(entry.vertexCount);
    }

    return this.debris.length;
  }

  private drawDebugLines(pass: GPURenderPassEncoder): number {
    if (this.debugLines.size === 0) {
      return 0;
    }
    pass.setBindGroup(0, this.frameBindGroup);
    let draws = 0;
    let pipeline: boolean | null = null;
    for (const set of this.debugLines.values()) {
      if (!set.visible) {
        continue;
      }
      if (pipeline !== set.throughDepth) {
        pass.setPipeline(this.pipelines.get(set.throughDepth ? 'debug-line-through' : 'debug-line'));
        pipeline = set.throughDepth;
      }
      pass.setBindGroup(1, set.bindGroup);
      pass.setVertexBuffer(0, set.vertices);
      pass.draw(set.vertexCount);
      draws += 1;
    }

    return draws;
  }

  /** The dynamic one-shot lane (089/01): prune on the shader's clock, upload what changed, draw. */
  private drawDynamicParticles(pass: GPURenderPassEncoder, now: number): number {
    if (!this.dynamicParticles || !this.particlesEnabled) {
      return 0;
    }
    const draws = this.dynamicParticles.draw(pass, this.pipelines, this.frameBindGroup, this.coronaQuad, now);
    this.frameTriangles += 2 * this.dynamicParticles.count;

    return draws;
  }

  /** One out-of-bundle object's draws: kind-4/5 scrollers first refresh their live uvAnim uniform (offset
   *  16), then every object binds its own group 1 (the cell bind group for timed, the per-object one for
   *  scroll). Kind 5 packs its animation slot in the LOW 16 bits (the window rides the high ones). */
  private drawObjectGroups(pass: GPURenderPassEncoder, object: CellHandle['objects'][number]): number {
    if ((object.kind === 4 || object.kind === 5) && object.uvAnimUniform) {
      const at = (object.kind === 5 ? object.params & 0xffff : object.params) * 4;
      if (at + 4 <= this.uvAnimTransforms.length) {
        this.uvAnimScratch.set(this.uvAnimTransforms.subarray(at, at + 4));
        this.device.queue.writeBuffer(object.uvAnimUniform, 16, this.uvAnimScratch);
      }
    }
    pass.setBindGroup(1, object.bindGroup);
    let draws = 0;
    for (const group of object.groups) {
      pass.setPipeline(this.pipelines.get(pipelineIdFor(group.pipelineClass, group.side)));
      pass.setBindGroup(2, this.textures.get(group.textureArrayRef).bindGroup);
      pass.drawIndexed(group.indexCount, 1, group.indexOffset, 0, 0);
      this.frameTriangles += group.indexCount / 3;
      draws += 1;
    }

    return draws;
  }

  private drawObjects(pass: GPURenderPassEncoder): number {
    const hour = ((this.environment.hour % 24) + 24) % 24;
    let draws = 0;
    for (const cell of this.cells.all()) {
      if (!cell.visible || cell.objects.length === 0) {
        continue;
      }
      let bound = false;
      for (const object of cell.objects) {
        // kind 0 = timed (hour-gated), kind 4 = UV-scroll (always on), kind 5 = timed UV-scroll (both:
        // minor 7 — the Fremont facade's stripes run only inside their tobj window). All draw OUTSIDE the
        // recorded bundle.
        const active =
          object.kind === 4 ||
          (object.kind === 0 && timedActive(object.params, hour)) ||
          (object.kind === 5 && timedActive((object.params >> 16) & 0xffff, hour));
        if (!active) {
          continue;
        }
        if (!bound) {
          // Cell-shared bindings (the geometry lives in the cell's buffers even for out-of-bundle draws).
          pass.setBindGroup(0, this.frameBindGroup);
          pass.setVertexBuffer(0, cell.vertexBuffer);
          pass.setIndexBuffer(cell.indexBuffer, cell.index16 ? 'uint16' : 'uint32');
          bound = true;
        }
        draws += this.drawObjectGroups(pass, object);
      }
    }

    return draws;
  }

  private drawParticles(pass: GPURenderPassEncoder): number {
    if (!this.particles || !this.particlesEnabled) {
      return 0;
    }
    let draws = 0;
    for (const [id, instances, count] of [
      ['particle-blend', this.particles.instancesBlend, this.particles.countBlend],
      ['particle-add', this.particles.instancesAdd, this.particles.countAdd],
    ] as const) {
      if (count === 0) {
        continue;
      }
      pass.setPipeline(this.pipelines.get(id));
      pass.setBindGroup(0, this.frameBindGroup);
      pass.setBindGroup(1, this.particles.bindGroup);
      pass.setVertexBuffer(0, this.coronaQuad); // the same unit quad the coronas billboard with
      pass.setVertexBuffer(1, instances);
      pass.draw(6, count);
      this.frameTriangles += 2 * count; // billboard quads
      draws += 1;
    }

    return draws;
  }

  private drawPed(pass: GPURenderPassEncoder): number {
    if (!this.ped) {
      return 0;
    }
    pass.setPipeline(this.pipelines.get('ped'));
    pass.setBindGroup(0, this.frameBindGroup);
    this.ped.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
    pass.setIndexBuffer(this.ped.indexBuffer, 'uint16');
    for (const submesh of this.ped.submeshes) {
      pass.setBindGroup(1, submesh.bindGroup);
      pass.drawIndexed(submesh.indexCount, 1, submesh.indexOffset);
      this.frameTriangles += submesh.indexCount / 3;
    }

    return this.ped.submeshes.length;
  }

  /** One model's live instances. Binds the shared geometry once, then draws each visible submesh per car.
   *  The TRANSLUCENT phase draws back-to-front by each submesh's part-transformed centroid (074/16 round 6 —
   *  unsorted, the steering wheel drew OVER the windscreen whenever it followed it in model order). */
  /** The skid-mark decal lane (089/03): prune on the wall clock, draw the live ring window. */
  private drawSkidMarks(pass: GPURenderPassEncoder, now: number): number {
    if (!this.skidMarks || !this.particlesEnabled) {
      return 0;
    }
    const draws = this.skidMarks.draw(pass, this.pipelines.get('skid'), this.frameBindGroup, now);
    this.frameTriangles += 2 * this.skidMarks.ring.count;

    return draws;
  }

  private drawVehicleModel(pass: GPURenderPassEncoder, model: VehicleModel, translucent: boolean, eye: Vec3): number {
    let draws = 0;
    let bound = false;
    // What group 1 currently holds: the texture ARRAY and the UV-anim SLOT. Cars and map objects both ship
    // size-bucketed dictionaries, and the opaque order groups submeshes by array, so switches stay rare.
    const group1 = { array: -1, offset: -1 };
    const indexFormat: GPUIndexFormat = model.index16 ? 'uint16' : 'uint32';
    for (const state of model.instances) {
      if (!state) {
        continue;
      }
      for (const index of this.submeshDrawOrder(state, model, translucent, eye)) {
        const submesh = model.submeshes[index];
        if (!bound) {
          pass.setPipeline(this.pipelines.get(translucent ? 'rigid-blend' : 'rigid-opaque'));
          pass.setBindGroup(0, this.frameBindGroup);
          model.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
          pass.setIndexBuffer(model.indexBuffer, indexFormat);
          bound = true;
        }
        if (!this.bindRigidSubmesh(pass, model, submesh, group1)) {
          continue; // a world array still streaming in — the submesh appears the frame it lands
        }
        pass.drawIndexed(submesh.indexCount, 1, submesh.indexOffset, 0, state.slot * model.partCount + submesh.part);
        this.frameTriangles += submesh.indexCount / 3;
        draws += 1;
      }
    }

    return draws;
  }

  private drawVehicles(pass: GPURenderPassEncoder, translucent: boolean, eye: Vec3): number {
    let draws = 0;
    for (const model of this.vehicleModels.values()) {
      draws += this.drawVehicleModel(pass, model, translucent, eye);
    }

    return draws;
  }

  private drawWater(pass: GPURenderPassEncoder): number {
    if (!this.water || !this.waterEnabled) {
      return 0;
    }
    pass.setPipeline(this.pipelines.get('water'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.setBindGroup(1, this.water.bindGroup);
    pass.setVertexBuffer(0, this.water.vertices);
    pass.setIndexBuffer(this.water.indices, 'uint32');
    pass.drawIndexed(this.water.indexCount);
    this.frameTriangles += this.water.indexCount / 3;

    return 1;
  }

  private ensureTargets(canvasWidth: number, canvasHeight: number): void {
    // Tier knob (074/09): render scale shrinks the scene targets (the post pass upscales to the
    // swapchain). LIVE — a key change rebuilds everything.
    const scale = Math.min(1, Math.max(0.5, this.renderScale));
    const width = Math.max(2, Math.round(canvasWidth * scale));
    const height = Math.max(2, Math.round(canvasHeight * scale));
    const key = `${width}x${height}`;
    if (this.targetKey === key) {
      return;
    }
    this.targetKey = key;
    for (const { bytes, texture } of this.sceneTargets) {
      this.resources.destroyTexture('target', texture, bytes);
    }
    this.sceneTargets.length = 0;
    const bytes = width * height * (8 + 4) * MSAA_SAMPLES; // 16f color + depth estimate
    const msaa = this.resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'msaa-color',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    this.sceneTargets.push({ bytes: bytes / 2, texture: msaa });
    // The MSAA resolve lands here; the godrays post pass samples it and writes the swapchain.
    const sceneColor = this.resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'scene-color',
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      },
      width * height * 8,
    );
    this.sceneTargets.push({ bytes: width * height * 8, texture: sceneColor });
    this.sceneColorView = sceneColor.createView();
    this.buildBloomChain(width, height);
    const bloomChain = this.bloomChain;
    if (!bloomChain) {
      throw new Error('bloom chain must exist after buildBloomChain');
    }
    this.postBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.postUniform } },
        { binding: 1, resource: this.sceneColorView },
        { binding: 2, resource: this.postSampler },
        { binding: 3, resource: bloomChain.resultView },
      ],
      label: 'post',
      layout: this.pipelines.postLayout,
    });
    const depth = this.resources.createTexture(
      'target',
      {
        format: DEPTH_FORMAT,
        label: 'msaa-depth',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    this.sceneTargets.push({ bytes: bytes / 2, texture: depth });
    this.msaaView = msaa.createView();
    this.depthView = depth.createView();
  }

  /**
   * Fill the local light pool (074/06 row 7) with the HOST DYNAMICS only (vehicle head/taillights).
   * Returns the light count (params3.x — bounds the WGSL loop).
   *
   * Static 2dfx street lamps were REMOVED from the pool (2026-07-17, user decision): the nearest-24 /
   * 100 u admission made lamp pools visibly IGNITE ahead of a driving car — binary pool entry has no
   * fade, and in dense streets the nearest-set rotation popped mid-distance lamps on and off. A
   * smooth-admission restore was tried and REVERTED (085 row E, 2026-07-22) — the user wants a different
   * behaviour and owes its precise description; the corona pass still draws every lamp's glow.
   */
  private fillLightPool(): number {
    const scratch = this.lightPoolScratch;
    let count = 0;
    const push = (
      x: number,
      y: number,
      z: number,
      radius: number,
      r: number,
      g: number,
      b: number,
      cone?: DynamicLight['cone'],
    ): void => {
      if (count >= LIGHT_POOL_CAP) {
        return;
      }
      const at = count * LIGHT_STRIDE;
      scratch[at] = x;
      scratch[at + 1] = y;
      scratch[at + 2] = z;
      scratch[at + 3] = radius;
      scratch[at + 4] = r;
      scratch[at + 5] = g;
      scratch[at + 6] = b;
      scratch[at + 7] = 0;
      scratch[at + 8] = cone ? cone.direction[0] : 0;
      scratch[at + 9] = cone ? cone.direction[1] : 0;
      scratch[at + 10] = cone ? cone.direction[2] : 1;
      scratch[at + 11] = cone ? cone.cosAngle : LIGHT_POINT;
      count += 1;
    };
    for (const light of this.dynamicLights) {
      push(light.position[0], light.position[1], light.position[2], light.radius, ...light.color, light.cone);
    }
    if (count > 0) {
      this.device.queue.writeBuffer(this.lightPoolBuffer, 0, scratch, 0, count * LIGHT_STRIDE);
    }

    return count;
  }

  /** Godrays uniform (074/09 stage 1): [sunU, sunV, intensity, decay] + [tint rgb, threshold] +
   *  [ACES tonemap 0/1, reserved ×3]. Intensity gates on the sun being in front of the camera, above the
   *  horizon (sunCoreColor is black at night), and near/inside the frame (soft edge fade — rays die
   *  gracefully as the sun leaves the screen). */
  private fillPostUniform(): Float32Array {
    const out = new Float32Array(12);
    const env = this.environment;
    const vp = this.viewProj;
    const len = Math.hypot(env.sunDir[0], env.sunDir[1], env.sunDir[2]) || 1;
    const [dx, dy, dz] = [env.sunDir[0] / len, env.sunDir[1] / len, env.sunDir[2] / len];
    // Direction at infinity: clip = viewProj × (dir, 0) — column-major, translation column skipped.
    const clipX = vp[0] * dx + vp[4] * dy + vp[8] * dz;
    const clipY = vp[1] * dx + vp[5] * dy + vp[9] * dz;
    const clipW = vp[3] * dx + vp[7] * dy + vp[11] * dz;
    let intensity = 0;
    let u = 0.5;
    let v = 0.5;
    if (clipW > 1e-4 && dy > 0) {
      u = 0.5 + (0.5 * clipX) / clipW;
      v = 0.5 - (0.5 * clipY) / clipW;
      const outside = Math.max(0, -u, u - 1, -v, v - 1);
      const edgeFade = Math.max(0, 1 - outside / 0.45);
      const dayGate = Math.min(1, Math.max(...env.sunCoreColor));
      // The bare `dy > 0` gate snapped the whole radial-ray term on/off the frame the sun crossed the
      // horizon (field: the picture jumps at 5:59→6:00 / 19:59→20:00). ~8 game-minutes of climb
      // (sin-elevation 0 → 0.045) ease the rays in at dawn and out before the disc sinks at dusk.
      const horizonFade = Math.min(1, dy / 0.045);
      intensity = GODRAY_INTENSITY * edgeFade * dayGate * horizonFade * Math.max(0, env.godrayStrength);
    }
    out.set([u, v, intensity, GODRAY_DECAY], 0);
    out.set([...env.sunCoronaColor, GODRAY_THRESHOLD], 4);
    out[8] = env.tonemap;
    out[9] = Math.max(0, env.bloomIntensity);

    return out;
  }

  /** Grow the matrix + paint buffers (and the bind group — vehicles are never inside a bundle: safe). */
  private growVehicleModel(model: VehicleModel, capacity: number): void {
    this.resources.destroyBuffer('uniform', model.matrixBuffer);
    this.resources.destroyBuffer('uniform', model.paintBuffer);
    this.resources.destroyBuffer('uniform', model.lampBuffer);
    this.resources.destroyBuffer('uniform', model.plateBuffer);
    model.matrixBuffer = this.createVehicleMatrixBuffer(model.partCount, capacity);
    model.paintBuffer = this.createVehiclePaintBuffer(model.partCount, capacity);
    model.lampBuffer = this.createVehicleLampBuffer(model.partCount, capacity);
    model.plateBuffer = this.createVehiclePlateBuffer(model.partCount, capacity);
    // The groups hold the OLD buffers; drop them and let the draw path rebuild against the new ones.
    model.bindGroups.clear();
    model.instances.length = capacity;
    model.instances.fill(null, model.capacity, capacity);
    model.capacity = capacity;
    // The fresh buffers are uninitialized: re-upload the live instances NOW, or a frame drawn before the
    // next `updateVehicles()` reads garbage matrices and flings the existing cars across the map. Paint has
    // no such flush (it is written on demand, not per frame), so it MUST be restored here too.
    const rowBytes = model.partCount * 64;
    for (const state of model.instances) {
      if (state) {
        this.device.queue.writeBuffer(model.matrixBuffer, state.slot * rowBytes, state.entity.matrices);
        this.writeVehiclePaint(model, state.slot, state.paint);
        this.writeVehicleLamps(model, state.slot, state.lamps);
        this.writeVehiclePlate(model, state.slot, state.plate.textSlot, state.plate.city);
      }
    }
  }

  /** Rebuild the sky LUT when its environment inputs moved (quantized key — ~a few rebuilds per game
   *  minute under a day cycle; each build is ~5 k texels of scalar math + a 72 KB upload). */
  private refreshSkyLut(): void {
    const env = this.environment;
    // pbrNight (prod's uPbrNight): the gradient takes over only once the sun is BELOW the horizon — NOT
    // the litFade `dn`, which ramps during golden hour and suppressed the Preetham sunrise (074/09 sky
    // field round; prod fixed the same bug). Widened to [−0.22, −0.01] (sky round 3): the handover to the
    // night gradient spans the whole post-sunset sinking margin instead of snapping in ~40 real seconds.
    const sinkT = Math.min(1, Math.max(0, (env.sunDir[1] + 0.22) / 0.21));
    const input = {
      cloudCover: env.cloudCover,
      cloudDark: env.cloudDark,
      exposure: env.skyExposure,
      model: env.skyModel,
      mood: env.skyMood,
      pbrNight: 1 - sinkT * sinkT * (3 - 2 * sinkT),
      skyHorizon: env.skyHorizon,
      skyTop: env.skyTop,
      sunElevation: env.sunElevation,
    };
    const key = skyLutKey(input);
    if (key === this.skyLutCurrentKey) {
      return;
    }
    this.skyLutCurrentKey = key;
    this.device.queue.writeTexture(
      { texture: this.skyLutTexture },
      buildSkyLut(input),
      { bytesPerRow: SKY_LUT_WIDTH * 8 },
      { height: SKY_LUT_HEIGHT, width: SKY_LUT_WIDTH },
    );
  }

  private renderProbeFace(center: Vec3, frameData: Float32Array): number {
    const { face, mix } = this.probe.beginFrame(center);
    this.probe.faceMatrices(face, center, this.probeViewProj, this.probeInvViewProj);
    const probeData = this.probeFrameData;
    probeData.set(frameData);
    probeData.set(this.probeViewProj, 0);
    probeData.set(this.probeInvViewProj, 16);
    probeData[32] = center[0];
    probeData[33] = center[1];
    probeData[34] = center[2];
    probeData[91] = mix;
    this.device.queue.writeBuffer(this.frameUniform, 0, probeData);
    // OPAQUE bundles only, culled to the face frustum AND the probe range — a 128² reflection has no use
    // for the far field (the sky pass still fills the horizon), and vertex cost is resolution-independent.
    frustumFromViewProj(this.probeFrustum, this.probeViewProj);
    const bundles: GPURenderBundle[] = [];
    for (const cell of this.cells.all()) {
      const dx = cell.bounds[0] - center[0];
      const dy = cell.bounds[1] - center[1];
      const dz = cell.bounds[2] - center[2];
      const reach = PROBE_RANGE + cell.bounds[3];
      if (dx * dx + dy * dy + dz * dz > reach * reach) {
        continue;
      }
      if (frustumIntersectsSphere(this.probeFrustum, cell.bounds[0], cell.bounds[1], cell.bounds[2], cell.bounds[3])) {
        bundles.push(cell.bundle);
      }
    }
    const encoder = this.device.createCommandEncoder({ label: 'env-probe' });
    this.probe.encodeFace(encoder, face, bundles, this.frameBindGroup, this.skyColor, {
      begin: this.timers.probeBeginTimestampWrites(),
      end: this.timers.probeEndTimestampWrites(),
    });
    this.device.queue.submit([encoder.finish()]);

    return mix;
  }

  /**
   * The bind group for one of a model's texture arrays, built on first use and cached. A world-array model
   * binds the SHARED cell texture — never its own upload — so a texture referenced by a hundred map objects
   * is resident once. Null while that array is still streaming.
   */
  private rigidBindGroup(model: VehicleModel, array: number): GPUBindGroup | null {
    const cached = model.bindGroups.get(array);
    if (cached) {
      return cached;
    }
    let texture: GPUTexture | undefined;
    if (model.worldArrays) {
      if (!this.textures.has(array)) {
        return null;
      }
      texture = this.textures.get(array).texture;
    } else {
      texture = model.textures[array] ?? model.textures[0];
    }
    if (!texture) {
      return null;
    }
    const group = this.createVehicleBindGroup({ ...model, texture });
    model.bindGroups.set(array, group);

    return group;
  }

  /** One fullscreen-triangle pass into `view` (the bloom chain's unit of work — no depth, no MSAA). */
  private runFullscreenPass(
    encoder: GPUCommandEncoder,
    id: PipelineId,
    bindGroup: GPUBindGroup,
    view: GPUTextureView,
    timestamps: { timestampWrites?: GPURenderPassTimestampWrites },
  ): void {
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ clearValue: { a: 0, b: 0, g: 0, r: 0 }, loadOp: 'clear', storeOp: 'store', view }],
      label: id,
      ...timestamps,
    });
    pass.setPipeline(this.pipelines.get(id));
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /**
   * Render one env-probe face (074/16 step 2) in its own submit and return the probe mix for params4.w.
   * The face camera is written into the SHARED frame uniform first — queue ordering guarantees the probe
   * submit sees it and the main pass (whose write follows) sees the real camera again.
   */
  /**
   * Env-probe scheduling (074/16 step 2): one face every PROBE_FRAME_INTERVAL frames, in its OWN submit
   * before the main pass. writeBuffer is queue-ordered against submits, so the ONE frame uniform (recorded
   * into every bundle) holds the face camera for the probe submit and the main camera for the frame submit —
   * no second bind group needed. Off frames still write the CURRENT mix into params4.w, or the paint would
   * flicker between the probe and the analytic fallback at half the frame rate.
   */
  private scheduleProbe(frameData: Float32Array): void {
    const probeCenter = this.probeCenter;
    if (!probeCenter || this.environment.reflectionStrength <= 0) {
      this.timers.probeSkipped();

      return;
    }
    this.probeTick = (this.probeTick + 1) % PROBE_FRAME_INTERVAL;
    frameData[91] = this.probeTick === 0 ? this.renderProbeFace(probeCenter, frameData) : this.probe.mix();
  }

  /** Visible submesh indices for one phase; the translucent phase comes back-to-front (074/16 round 6). */
  private submeshDrawOrder(
    state: VehicleInstanceState,
    model: VehicleModel,
    translucent: boolean,
    eye: Vec3,
  ): number[] {
    const order: { distSq: number; index: number }[] = [];
    for (let index = 0; index < model.submeshes.length; index += 1) {
      const submesh = model.submeshes[index];
      if (submesh.translucent === translucent && state.submeshVisible[index] !== 0) {
        order.push({ distSq: translucent ? this.submeshSortDistance(state, model, index, eye) : 0, index });
      }
    }
    if (translucent) {
      order.sort((a, b) => b.distSq - a.distSq);
    } else {
      // Opaque has no order requirement (depth decides), so group by texture ARRAY: a multi-array map object
      // otherwise re-binds on every submesh. Translucency keeps its back-to-front order — correctness first.
      order.sort((a, b) => (model.submeshes[a.index].array ?? 0) - (model.submeshes[b.index].array ?? 0));
    }

    return order.map((entry) => entry.index);
  }

  /**
   * Translucent sort key: the eye's distance to the submesh's NEAREST extent, under its part's CURRENT
   * world matrix. A raked windscreen's centre sits behind the wheel at down-looking angles while its
   * overhang is in front; the plain centroid distance drew the wheel OVER the glass there (074/16 field
   * round). Where the fixture carries an AABB the key is the nearest of its 8 corners — the exact form of
   * that idea: the earlier `centroid − radius` sphere over-reached on SCATTERED submeshes (a mod's gauge
   * cluster spanning the whole dash, radius 1.8, counted as nearer than the equally-distant window SHEET
   * in front of it, and the cabin drew over the glass). Old fixtures keep the sphere fallback.
   */
  private submeshSortDistance(state: VehicleInstanceState, model: VehicleModel, index: number, eye: Vec3): number {
    const submesh = model.submeshes[index];
    const m = state.entity.matrices;
    const at = submesh.part * 16;
    const distanceTo = (px: number, py: number, pz: number): number => {
      const x = m[at] * px + m[at + 4] * py + m[at + 8] * pz + m[at + 12];
      const y = m[at + 1] * px + m[at + 5] * py + m[at + 9] * pz + m[at + 13];
      const z = m[at + 2] * px + m[at + 6] * py + m[at + 10] * pz + m[at + 14];

      return Math.hypot(x - eye[0], y - eye[1], z - eye[2]);
    };
    const bounds = submesh.bounds;
    if (!bounds) {
      const center = submesh.center ?? [0, 0, 0];

      return distanceTo(center[0], center[1], center[2]) - (submesh.radius ?? 0);
    }
    // Exact point-to-AABB: the eye into the part's LOCAL frame (affine inverse — parts carry a uniform
    // scale at most), clamped into the box, back through the matrix. Nearest-corner alone over-reports
    // for an eye facing the middle of a large sheet, which is exactly the close-up-at-the-window case.
    const [ex, ey, ez] = [eye[0] - m[at + 12], eye[1] - m[at + 13], eye[2] - m[at + 14]];
    const scaleSq = m[at] * m[at] + m[at + 1] * m[at + 1] + m[at + 2] * m[at + 2];
    const inv = scaleSq > 0 ? 1 / scaleSq : 0;
    const lx = (m[at] * ex + m[at + 1] * ey + m[at + 2] * ez) * inv;
    const ly = (m[at + 4] * ex + m[at + 5] * ey + m[at + 6] * ez) * inv;
    const lz = (m[at + 8] * ex + m[at + 9] * ey + m[at + 10] * ez) * inv;
    const qx = Math.min(Math.max(lx, bounds.min[0]), bounds.max[0]);
    const qy = Math.min(Math.max(ly, bounds.min[1]), bounds.max[1]);
    const qz = Math.min(Math.max(lz, bounds.min[2]), bounds.max[2]);

    return distanceTo(qx, qy, qz);
  }

  /** One RGBA layer into a plate array. */
  private writePlateLayer(texture: GPUTexture, layer: number, rgba: Uint8Array, width: number, height: number): void {
    this.device.queue.writeTexture(
      { origin: { x: 0, y: 0, z: layer }, texture },
      rgba,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { depthOrArrayLayers: 1, height, width },
    );
  }

  private writeVehicleLamps(
    model: VehicleModel,
    slot: number,
    lamps: { brakes: boolean; headlights: boolean; intensity: number; smashed: number },
  ): void {
    const row = new Float32Array(model.partCount * 4);
    for (let part = 0; part < model.partCount; part += 1) {
      row[part * 4] = lamps.headlights ? 1 : 0;
      row[part * 4 + 1] = lamps.brakes ? 1 : 0;
      row[part * 4 + 2] = lamps.intensity;
      // The spare component was always there; the light-damage mask is what finally uses it. The vertex
      // stage resolves it against the submesh's lamp tag, where both the tag and the instance still exist.
      row[part * 4 + 3] = lamps.smashed;
    }
    this.device.queue.writeBuffer(model.lampBuffer, slot * model.partCount * LAMP_ROW_BYTES, row);
  }

  /**
   * Write one instance's four carcols colours. The shader indexes paint by `instance_index` — the same row
   * index as the matrices — so the colours are REPLICATED across the instance's part rows. That costs a few
   * hundred bytes per car and buys the alternative's absence: no partCount uniform and no integer division
   * in the vertex shader. Paint is written on spawn/change, never per frame.
   */
  private writeVehiclePaint(model: VehicleModel, slot: number, paint: VehiclePaint): void {
    const state = model.instances[slot];
    if (state) {
      state.paint = paint;
    }
    const row = new Float32Array(model.partCount * 16);
    for (let part = 0; part < model.partCount; part += 1) {
      const at = part * 16;
      row.set(paint.primary, at);
      row.set(paint.secondary, at + 4);
      row.set(paint.tertiary, at + 8);
      row.set(paint.quaternary, at + 12);
    }
    this.device.queue.writeBuffer(model.paintBuffer, slot * model.partCount * PAINT_ROW_BYTES, row);
  }

  /**
   * Write one instance's plate reference. REPLICATED across the instance's part rows for the same reason
   * paint is: the shader indexes by `instance_index`, which already folds in the part, so replication buys
   * the absence of a partCount uniform and an integer division in the vertex shader. Written on
   * spawn/change, never per frame.
   */
  private writeVehiclePlate(model: VehicleModel, slot: number, textSlot: number, city: number): void {
    const row = new Float32Array(model.partCount * 4);
    for (let part = 0; part < model.partCount; part += 1) {
      row[part * 4] = textSlot;
      row[part * 4 + 1] = city;
    }
    this.device.queue.writeBuffer(model.plateBuffer, slot * model.partCount * PLATE_ROW_BYTES, row);
  }
}

/** SA timed-object gate: params = on | off << 8; the window wraps midnight when on > off. */
/** Margin (m) added to a clutter group's sphere for the models' own extent (a bush/cactus/rock/small tree). */
const CLUTTER_MODEL_RADIUS = 8;

/** Bounding sphere [x, y, z, r] of clutter instances, from their matrices' translations (074/19 culling). */
function clutterBounds(matrices: Float32Array): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let at = 0; at < matrices.length; at += 16) {
    const [x, y, z] = [matrices[at + 12], matrices[at + 13], matrices[at + 14]];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];

  return [
    center[0],
    center[1],
    center[2],
    Math.hypot(maxX - center[0], maxY - center[1], maxZ - center[2]) + CLUTTER_MODEL_RADIUS,
  ];
}

/**
 * Fallback billboards when no particle.txd is supplied (the lab): a soft radial glow for lamps and a plain
 * disc for the moon. The real SA sprites are far better — this only keeps the engine standalone.
 */
function proceduralCoronaSprites(): CoronaSprites {
  const size = 128;
  const rgba = new Uint8Array(size * size * 4 * 2);
  const centre = (size - 1) / 2;
  for (let layer = 0; layer < 2; layer += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const r = Math.hypot(x - centre, y - centre) / centre;
        // Layer 0 = a soft glow (bright core, wide falloff); layer 1 = a hard-edged disc for the moon.
        const value = layer === 0 ? Math.max(0, 1 - r) ** 2.2 + Math.max(0, 1 - r) ** 8 * 0.7 : r < 0.92 ? 1 : 0;
        const at = (layer * size * size + y * size + x) * 4;
        rgba[at] = 255;
        rgba[at + 1] = 255;
        rgba[at + 2] = 255;
        rgba[at + 3] = Math.round(Math.min(1, value) * 255);
      }
    }
  }

  return { height: size, layers: 2, rgba, width: size };
}

function timedActive(params: number, hour: number): boolean {
  const on = params & 0xff;
  const off = (params >> 8) & 0xff;

  return on < off ? hour >= on && hour < off : hour >= on || hour < off;
}
