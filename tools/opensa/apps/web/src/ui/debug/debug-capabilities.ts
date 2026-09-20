/**
 * What the F2 debugger may show for a given host (plan 074/22 phase 1).
 *
 * The overlay itself is renderer-agnostic: every control mutates the shared runtime `Config`. What differs is
 * which controls have a counterpart in the host that consumes that config — three-WebGL supports all of them,
 * the own engine has no CSM/SSAO/pipeline switch/water sliders. Unsupported rows are HIDDEN here (never dead
 * buttons); nothing is deleted from prod until the post-flip cleanup (plan 13 / C2).
 */

/** Per-screen / per-control switches; `true` = the host can honour the control. */
export interface DebugCapabilities {
  /** Follow-rig sliders (height/angle/response/angle limits) — the engine host's orbit is yaw+pitch by
   *  mouse with a fixed eye height; only distance and the zoom bounds have a counterpart there. */
  readonly cameraRig: boolean;
  /** CLEO screen: runner/trace toggles, thread list, coverage + atlas gaps, per-thread trace
   *  (plan 097/07). Needs the script VM behind it, which only the engine host boots. */
  readonly cleoScreen: boolean;
  /** Cloud COVER slider — on the engine, cover/scale/tint come from the per-weather cloud profile
   *  (sky v2); only `clouds.opacity` reaches the frame. */
  readonly cloudCover: boolean;
  /** Corona draw-distance cap — the engine restores the authored 2dfx farClip instead. */
  readonly coronaDistance: boolean;
  /** Night fill for dynamic objects (player + cars) — a plan-034 three shader. */
  readonly dynamicObjectsFill: boolean;
  /** God-rays shader sliders (density/exposure/weight) — the engine godrays pass has ONE strength. */
  readonly godrayShader: boolean;
  /** Vehicle-headlight beam/brake sliders — engine light intensities are host constants. */
  readonly headlightSliders: boolean;
  /** Night street-lamp (2dfx) light toggle — the static lamp pool restarts in plan 17. */
  readonly lampsToggle: boolean;
  /** Map screen: the map viewer + section inspector. Restored on the engine host (074/22 phase 7) —
   *  the streaming driver pins cells, the host detaches the camera. Selection is gated separately. */
  readonly mapScreen: boolean;
  /** Show NORMALS on the Map screen. Restored on the engine host (074/22) as a debug VIEW mode riding a
   *  spare frame-uniform lane, rather than three's scene-wide material override. */
  readonly meshOverrides: boolean;
  /** Moon SIZE + ELEVATION — the engine builds its own moon arc and draws the disc from the sky model;
   *  `moon.brightness` is the one knob that reaches it. */
  readonly moonRig: boolean;
  /** Physics screen: live vehicle telemetry + the shared tuning constants (plan 081/01). Needs the raycast
   *  vehicle controller behind it, which only the engine host drives. */
  readonly physicsScreen: boolean;
  /** Rendering-pipeline master switch classic/modern — the switch IS what C2 deletes. */
  readonly pipelineSwitch: boolean;
  /** Car-reflection PRESETS (enhanced/PC/PS2); off + intensity stay on both hosts. */
  readonly reflectionPresets: boolean;
  /** Sun-shadow toggle + CSM distance — the engine has baked sun-vis, no cascades. */
  readonly shadows: boolean;
  /** Night sky glow — built into the engine sky model (city glow + moon scatter). */
  readonly skyGlow: boolean;
  /** Sky-model switch classic/pbr — the engine sky is always physical. */
  readonly skyModelToggle: boolean;
  /** SSAO — replaced by the baked AO channel on the engine. */
  readonly ssao: boolean;
  /** Night stars toggle — the starfield is part of the engine sky model, no flag. */
  readonly starsToggle: boolean;
  /** Sun disc size — on the engine it comes from timecyc through the environment driver. */
  readonly sunSize: boolean;
  /** Tone-mapping CURVE/placement selector — the engine ships one prod-exact ACES (on/off only). */
  readonly toneMappingModes: boolean;
  /** Volumetric-cloud toggle — the engine decks are the baked 256² field, no raymarcher. */
  readonly volumetricClouds: boolean;
  /** Water shader sliders — the engine water is its own shader (sea/inland, baked shore). */
  readonly water: boolean;
  /** Night window glow — superseded by the baked emissive mask (emissiveBoost stays). */
  readonly windowGlow: boolean;
  /** World 2dfx particle-effects distance — knob not wired on the engine (plan-17 round). */
  readonly worldEffects: boolean;
  /** The five three-only world-light scalars (dusk/LOD-night/shadow/sun direct+indirect keep). The engine
   *  drives its world light from day + night-prelit brightness alone. */
  readonly worldLightExtras: boolean;
}

export type Screen =
  | 'atmosphere'
  | 'camera'
  | 'cleo'
  | 'graphics'
  | 'map'
  | 'perf'
  | 'physics'
  | 'player'
  | 'position'
  | 'procobj'
  | 'root'
  | 'time'
  | 'vehicles'
  | 'weather';

/** Everything on — the three-WebGL host (unchanged behaviour until C2). */
export const ALL_DEBUG_CAPABILITIES: DebugCapabilities = {
  cameraRig: true,
  cleoScreen: false, // the script VM is engine-only (plan 097) — no runner exists on the three host
  cloudCover: true,
  coronaDistance: true,
  dynamicObjectsFill: true,
  godrayShader: true,
  headlightSliders: true,
  lampsToggle: true,
  mapScreen: true,
  meshOverrides: true,
  moonRig: true,
  physicsScreen: false, // no raycast-vehicle telemetry on the three host — 081 is engine-only
  pipelineSwitch: true,
  reflectionPresets: true,
  shadows: true,
  skyGlow: true,
  skyModelToggle: true,
  ssao: true,
  starsToggle: true,
  sunSize: true,
  toneMappingModes: true,
  volumetricClouds: true,
  water: true,
  windowGlow: true,
  worldEffects: true,
  worldLightExtras: true,
};

/** The own-engine host: bucket-C rows off (see plan 074/22 for the per-row disposition). */
export const ENGINE_DEBUG_CAPABILITIES: DebugCapabilities = {
  cameraRig: true, // 080/01 — the rig rows are the director's own config now, not the three follow orbit
  cleoScreen: true, // 097/07 — the VM, tracer and coverage ride this host's fixed step
  cloudCover: false,
  coronaDistance: false,
  dynamicObjectsFill: false,
  godrayShader: false,
  headlightSliders: false,
  lampsToggle: false,
  mapScreen: true, // restored 074/22 phase 7 — pinned cells + detached camera // restored 074/22 — a storage-buffer wireframe pass (no edge geometry needed)
  meshOverrides: true, // restored 074/22 — a debug VIEW mode on a spare frame lane, not a material override
  moonRig: false,
  physicsScreen: true, // 081/01 — the telemetry sampler rides this host's fixed step
  pipelineSwitch: false,
  reflectionPresets: false,
  shadows: false,
  skyGlow: false,
  skyModelToggle: false,
  ssao: false,
  starsToggle: false,
  sunSize: false,
  toneMappingModes: false,
  volumetricClouds: false,
  water: false,
  windowGlow: false,
  worldEffects: false,
  worldLightExtras: false,
};

const ALL_MENU: readonly { label: string; screen: Screen }[] = [
  { label: 'Player', screen: 'player' },
  { label: 'Vehicles', screen: 'vehicles' },
  { label: 'Physics', screen: 'physics' },
  { label: 'CLEO', screen: 'cleo' },
  { label: 'Time', screen: 'time' },
  { label: 'Atmosphere', screen: 'atmosphere' },
  { label: 'Camera', screen: 'camera' },
  { label: 'Graphics', screen: 'graphics' },
  { label: 'Perf', screen: 'perf' },
  { label: 'ProcObj', screen: 'procobj' },
  { label: 'Weather', screen: 'weather' },
  { label: 'Position', screen: 'position' },
  { label: 'Map', screen: 'map' },
];

/** Authoring / live-tuning screens hidden only in the deploy build (`build:prod` sets `__DEBUGGER_HIDE__`). */
const DEV_ONLY_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  'atmosphere',
  'camera',
  'graphics',
  'map',
  'physics',
  'procobj',
]);

/** Screens that exist only where the host can drive them (the rest are renderer-agnostic). */
const SCREEN_CAPABILITY: Partial<Record<Screen, keyof DebugCapabilities>> = {
  cleo: 'cleoScreen',
  map: 'mapScreen',
  physics: 'physicsScreen',
};

/**
 * Menu items visible for this host: dev-only screens drop in the deploy build, unsupported screens drop by
 * capability. The Position screen always shows (coords readout + city); its teleport list is just empty when
 * the game defines none.
 */
export function menuFor(capabilities: DebugCapabilities, hideDevOnly: boolean): { label: string; screen: Screen }[] {
  return ALL_MENU.filter((item) => {
    const gate = SCREEN_CAPABILITY[item.screen];

    return (!hideDevOnly || !DEV_ONLY_SCREENS.has(item.screen)) && (gate === undefined || capabilities[gate]);
  }).map((item) => ({ ...item }));
}

/** Camera-screen sliders: `[config key, label, min, max, step]`. The first three (distance + zoom bounds)
 *  drive every host's zoom; the rest are the RIG group (plan 080/01), gated by `cameraRig`. */
const CAMERA_ZOOM_ROWS = [
  ['followDistance', 'DISTANCE', 4, 80, 1],
  ['followZoomMin', 'MIN ZOOM', 4, 40, 1],
  ['followZoomMax', 'MAX ZOOM', 6, 80, 1],
] as const;

/** The live-tuning rows a field round turns: framing height, look speed and the pitch clamps. Sliders are how
 *  the 036 rounds tuned without a rebuild, and 080's rounds work the same way. */
// PRUNED at the chain's close-out (plan 07/3): the tab is a TUNING tool, not a settings screen, so the
// reference points a round never touches (`landingDipFullSpeed`, `shakeImpactForce`, `vehicleFovLambda`)
// went config-only. Every row below earned its place by being turned during an actual field round.
const CAMERA_RIG_ROWS = [
  ['followHeight', 'HEIGHT', 0, 4, 0.1],
  ['sensitivity', 'LOOK SPEED', 0.001, 0.012, 0.0005],
  ['pitchMin', 'PITCH MIN', -1.55, -0.2, 0.05],
  ['pitchMax', 'PITCH MAX', 0.2, 1.55, 0.05],
  // The 080/02 feel channels — a field round tunes these live, which is the whole point of the tab.
  ['inputSmoothTime', 'INPUT SMOOTH', 0, 0.12, 0.005],
  ['positionLagTime', 'LAG PLANAR', 0, 0.5, 0.01],
  ['verticalLagTime', 'LAG VERTICAL', 0, 1, 0.02],
  ['deadZone', 'DEAD ZONE', 0, 0.5, 0.01],
  ['yawLagTime', 'YAW SWING', 0, 1, 0.05],
  // 080/03 composition: when the camera finds its own way home, and how far the frame leans ahead.
  ['recenterDelaySec', 'RECENTER AFTER', 0, 6, 0.25],
  ['recenterRate', 'RECENTER RATE', 0, 5, 0.1],
  ['lookAheadDistance', 'LOOK AHEAD', 0, 3, 0.1],
  ['lookAheadTime', 'LOOK AHEAD TIME', 0.05, 1.5, 0.05],
  ['turnThreshold', 'TURN THRESHOLD', 0.2, 3, 0.1],
  // 080/09 follow policy: how cleanly AWAY movement must be before it may rotate the camera, and the
  // on-foot distance breathing (a run opens it, real stillness eases it in).
  ['footYawAuthorityStart', 'YAW AUTH FROM', 0, 1, 0.05],
  ['footYawAuthorityFull', 'YAW AUTH FULL', 0, 1, 0.05],
  ['footRunDistanceGain', 'RUN DIST GAIN', 0, 2, 0.1],
  ['footRunFullSpeed', 'RUN DIST FULL AT', 2, 12, 0.5],
  ['footIdleDelaySec', 'IDLE ZOOM AFTER', 0, 15, 0.5],
  ['footIdleDistanceEase', 'IDLE ZOOM IN', 0, 1.5, 0.05],
  // 080/05: the vehicle tuning table. The rig is shared — these are the numbers driving substitutes into
  // it, plus the two writers driving adds (the speed curves and the drift lean).
  ['vehicleDistanceScale', 'CAR DIST x', 1, 4, 0.25],
  ['vehicleDistanceGain', 'CAR DIST GAIN', 0, 6, 0.25],
  ['vehicleDistanceSpeed', 'CAR DIST SPEED', 10, 80, 5],
  ['vehicleAccelDistanceGain', 'CAR ACCEL PULL', 0, 3, 0.25],
  ['vehicleFovKick', 'CAR FOV KICK', 0, 0.5, 0.01],
  ['vehicleFovMinSpeed', 'CAR FOV FROM', 0, 30, 1],
  ['vehicleFovMaxSpeed', 'CAR FOV FULL', 10, 90, 5],
  ['vehicleYawLagTime', 'CAR YAW SWING', 0, 1.5, 0.05],
  ['vehicleRecenterDelaySec', 'CAR RECENTER AFTER', 0, 6, 0.25],
  ['vehicleVerticalLagTime', 'CAR LAG VERTICAL', 0, 1, 0.02],
  ['vehicleCollisionReleaseTime', 'CAR COLLIDE RELEASE', 0, 1.5, 0.05],
  ['driftLookBlend', 'DRIFT LEAN', 0, 1, 0.05],
  ['driftSlipDeadZone', 'DRIFT DEAD ZONE', 0, 0.5, 0.02],
  ['driftMinSpeed', 'DRIFT FROM SPEED', 0, 30, 1],
  // 080/06 motion feel. Small numbers by design — this is the group that reads as life at one setting and
  // as seasickness at the next, so the field round tunes DOWN by default. `reducedMotion` is the master
  // off-switch and lives with the wheel-zoom toggle below the sliders.
  ['bobAmplitude', 'BOB', 0, 0.15, 0.005],
  ['bobCyclesPerMetre', 'BOB PER METRE', 0.2, 2, 0.05],
  ['landingDipScale', 'LANDING DIP', 0, 0.4, 0.02],
  ['shakeScale', 'SHAKE', 0, 0.2, 0.01],
  ['sprintFovKick', 'SPRINT FOV', 0, 0.2, 0.01],
  // 080/04 collision (VEHICLE only): eye off walls, closest pull-in, release ease, whisker spread.
  ['collisionRadius', 'COLLIDE RADIUS', 0, 0.8, 0.05],
  ['collisionMinDistance', 'COLLIDE MIN', 0.5, 4, 0.1],
  ['collisionReleaseTime', 'COLLIDE RELEASE', 0, 1, 0.05],
  ['collisionWhiskerAngle', 'COLLIDE WHISKER', 0, 0.6, 0.02],
] as const;

export type CameraControlRow = (typeof CAMERA_RIG_ROWS)[number] | (typeof CAMERA_ZOOM_ROWS)[number];

/** Camera sliders this host may show, in display order. */
export function cameraControlsFor(capabilities: DebugCapabilities): readonly CameraControlRow[] {
  return capabilities.cameraRig ? [...CAMERA_ZOOM_ROWS, ...CAMERA_RIG_ROWS] : [...CAMERA_ZOOM_ROWS];
}

/** World-light sliders: `[config key, label, min, max, step]`. The first two drive the engine's world
 *  lighting; the rest are three-only scalars (`worldLightExtras`). */
const WORLD_LIGHT_ROWS = [
  ['dayBrightness', 'WORLD DAY', 0.3, 1.2, 0.05],
  ['nightPrelitBrightness', 'WORLD NIGHT PRELIT', 0.2, 1.5, 0.05],
  ['ambient', 'WORLD AMBIENT (093)', 0, 2, 0.05],
  ['ambientFloor', 'WORLD AMB FLOOR (093)', 0, 0.3, 0.01],
] as const;

const WORLD_LIGHT_EXTRA_ROWS = [
  ['duskBrightness', 'WORLD DUSK', 0.1, 1, 0.05],
  ['lodNightAmbScale', 'LOD NIGHT AMB', 0.2, 4, 0.1],
  ['shadowStrength', 'WORLD SHADOW', 0, 1, 0.05],
  ['sunDirect', 'SUN DIRECT (064, modern)', 0, 2, 0.05],
  ['sunIndirect', 'SUN INDIRECT KEEP (064)', 0, 1, 0.05],
] as const;

export type WorldLightControlRow = (typeof WORLD_LIGHT_EXTRA_ROWS)[number] | (typeof WORLD_LIGHT_ROWS)[number];

/** World-light sliders this host may show, in display order. */
export function worldLightControlsFor(capabilities: DebugCapabilities): readonly WorldLightControlRow[] {
  return capabilities.worldLightExtras ? [...WORLD_LIGHT_ROWS, ...WORLD_LIGHT_EXTRA_ROWS] : [...WORLD_LIGHT_ROWS];
}

/** God-rays shader keys on the Sky slider block; `mood`/`pbrExposure` reach both hosts, the rest are three-only. */
const GODRAY_SHADER_KEYS = ['density', 'exposure', 'weight'] as const;

const SHARED_SKY_KEYS = ['mood', 'pbrExposure'] as const;

export type SkyControlKey = (typeof GODRAY_SHADER_KEYS)[number] | (typeof SHARED_SKY_KEYS)[number];

/** Sky slider keys this host may show, in display order. */
export function skyControlsFor(capabilities: DebugCapabilities): readonly SkyControlKey[] {
  return capabilities.godrayShader ? [...GODRAY_SHADER_KEYS, ...SHARED_SKY_KEYS] : [...SHARED_SKY_KEYS];
}
