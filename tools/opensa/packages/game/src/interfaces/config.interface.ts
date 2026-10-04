/** Bloom (glow on bright areas) tuning. */
export interface BloomConfig {
  /** Master toggle (off = the bloom pass is skipped). */
  enabled: boolean;
  /** Glow strength. */
  intensity: number;
  /** Luminance above which pixels bloom (lower = more of the scene glows). */
  threshold: number;
}

/** Follow/play camera tuning (the debug overview camera is fixed top-down). */
export interface CameraConfig {
  /** How far the camera bobs at the run gait (world units, 0 = off). Scaled by speed and damped in/out, so
   *  walking is a hint and stopping fades. SUBTLE is the whole art here — this is the effect that reads as
   *  life at 0.05 and as seasickness at 0.15. */
  bobAmplitude: number;
  /** Bob cycles per METRE travelled. Phasing by distance (not by wall time) makes the frequency track the
   *  stride for free, and freezes the bob when the player stands still. */
  bobCyclesPerMetre: number;
  /** The closest collision may ever pull the eye to the look point (world units). A wall can shove the camera
   *  in, but never INTO the player — below this it stops, accepting a little wall clip over a face full of ped. */
  collisionMinDistance: number;
  /** Radius of the sphere the collision layer sweeps toward the eye (world units) — covers the near plane so
   *  a wall never clips through. Bigger keeps the camera further off walls. 0 disables collision. */
  collisionRadius: number;
  /** How fast the camera eases back OUT after an occlusion clears (seconds). Pulling IN is instant (a wall is
   *  never shown); releasing glides so leaving a doorway doesn't pop. */
  collisionReleaseTime: number;
  /** Whisker cast spread (radians): two extra casts at ±this around the eye direction let the camera start
   *  easing in BEFORE a wall edge crosses screen centre. 0 = primary cast only. */
  collisionWhiskerAngle: number;
  /** Focus movement under this (world units) does not pull the camera at all — idle jitter leaves the frame
   *  still. Blended back in over the next two dead-zone widths, so there is no kink at the edge. */
  deadZone: number;
  /** How much of a slide the camera looks ALONG (0..1) while driving: the yaw target leans from the car's
   *  heading toward its actual travel direction by this fraction of the slip angle, so a drift shows the
   *  player where the car is going. 0 = always frame the car's nose. */
  driftLookBlend: number;
  /** Below this speed (units/s) a slip angle is parking-manoeuvre noise, not a slide — no drift lean. */
  driftMinSpeed: number;
  /** Slip under this (radians) contributes nothing: straight driving has a permanent small slip and must
   *  not tilt the frame. Faded in over the next dead-band width, so there is no kink at the edge. */
  driftSlipDeadZone: number;
  /** Initial distance from the player in follow mode (GTA/world units); wheel zoom moves it within the range. */
  followDistance: number;
  /** Height above the player the camera orbits + looks at (world units) — raises the framing off the feet. */
  followHeight: number;
  /** How fast the camera swings behind the player when they change direction (per second). */
  followLerp: number;
  /** Lowest the camera may drop toward the horizon (radians from straight up); keeps it above the floor. */
  followMaxPolar: number;
  /** Highest the camera may rise toward straight-down (radians from straight up). */
  followMinPolar: number;
  /** Initial pitch — the "behind + above" angle (radians from straight up); the mouse then moves it freely. */
  followPolar: number;
  /** Allow wheel zoom in follow/play mode. */
  followZoom: boolean;
  /** Farthest the wheel can zoom out (world units). */
  followZoomMax: number;
  /** Nearest the wheel can zoom in (world units). */
  followZoomMin: number;
  /** Full stillness (no movement, look or zoom) for this long eases the follow distance IN a little —
   *  a resting camera settles closer; any input returns it at the ordinary zoom pace (plan 080/09 §2). */
  footIdleDelaySec: number;
  /** How far the idle ease closes the distance (world units). 0 = off. */
  footIdleDistanceEase: number;
  /** How far a run opens the on-foot follow distance (world units), faded in between walk pace and
   *  `footRunFullSpeed` — the character gets room when moving fast, back when stopping (plan 080/09 §2). */
  footRunDistanceGain: number;
  /** The speed (u/s) where the run distance gain is fully open. */
  footRunFullSpeed: number;
  /** The directional yaw authority band (plan 080/09 §1): movement may rotate the camera in proportion to
   *  how cleanly it is AWAY from it. `Start`..`Full` shape a smoothstep over the normalized away-component
   *  of the velocity — below Start (a strafe, walking at the camera) movement never turns the camera, above
   *  Full (walking away) the recenter has its whole rate. */
  footYawAuthorityFull: number;
  footYawAuthorityStart: number;
  /** How long a pointer flick is spread over (seconds). Total rotation is conserved — the movement is only
   *  redistributed across a few frames, which is what separates "dampened" from "laggy". 0 = raw. */
  inputSmoothTime: number;
  /** The responsiveness floor: however fast the player moves, the look point never trails the focus by more
   *  than this (world units). The player can never leave the frame. */
  lagMaxDistance: number;
  /** The fall speed (units/s) at which the landing dip is full; faster landings are clamped at 2x it. */
  landingDipFullSpeed: number;
  /** How deep a full-speed landing dips the eye (world units) — the knee-bend beat. Capped internally, and
   *  the look point dips half as far so the frame pitches down a whisker. */
  landingDipScale: number;
  /** How far the frame leans toward where the player is heading (world units, at full speed). 0 = off. */
  lookAheadDistance: number;
  /** The speed (units/s) at which look-ahead and the idle recenter reach their full strength — the run gait,
   *  so a walk gets a hint and a sprint the whole shift. */
  lookAheadFullSpeed: number;
  /** How long the look-ahead offset takes to follow a change of direction (seconds, spring). Slow on purpose:
   *  it should read as composition, not as tracking. */
  lookAheadTime: number;
  /** How fast the look-behind flip swings (seconds, smooth-damp time) — both ways: to the car's front on
   *  hold and back behind it on release. Deliberately quicker than `vehicleYawLagTime`: a mirror check is
   *  a glance, not a composition move. */
  lookBehindLagTime: number;
  /** After a look input, auto-centering is held off for this long (seconds) — the 036 manual grace, so a
   *  small correction is not immediately undone by the camera. */
  manualGraceSec: number;
  /** Below this speed (units/s) the framed object counts as standing still: no heading tracking, no
   *  recentering, no look-ahead. */
  moveThreshold: number;
  /** Highest the look may pitch (radians, positive = up). */
  pitchMax: number;
  /** Lowest the gameplay look may pitch (radians, negative = down). The map viewer needs the full range down
   *  to straight-down, so it clamps at its own top-down margin instead of this floor. */
  pitchMin: number;
  /** How long the look point takes to catch up to the focus in the horizontal plane (seconds, spring). This
   *  is the weight: a hard direction change leaves the character leading the frame for a beat. */
  positionLagTime: number;
  /** How long the look must stay idle before the camera starts easing behind a MOVING player (seconds). */
  recenterDelaySec: number;
  /** How fast the idle recenter closes on "behind the player" (per second, scaled by speed). */
  recenterRate: number;
  /** Master off-switch for the whole additive motion layer (bob, landing dip, shake, FOV kicks) — the
   *  comfort setting. Every effect also has its own scale for a lighter touch. */
  reducedMotion: boolean;
  /** How far the mouse look turns the rig: radians per pixel of pointer movement. */
  sensitivity: number;
  /** Turn-follow stops once the yaw is within this of behind the player (radians). */
  settleEpsilon: number;
  /** The contact force (N) that produces a FULL impact shake. Calibrated against the damage system's own
   *  measurements: a light hit is ~207k, a real crash ~377k. */
  shakeImpactForce: number;
  /** The most an impact may shake the camera (world units, 0 = off). */
  shakeScale: number;
  /** How much the lens widens at a sprint (radians) — a couple of degrees whose only job is feeling faster. */
  sprintFovKick: number;
  /** A focus jump beyond this (world units) is a TELEPORT, not movement: the rig snaps instead of flying
   *  across the map (respawn, debugger warp, vehicle entry from far away). */
  teleportSnapDistance: number;
  /** A heading change faster than this (radians/second) swings the camera behind the new direction. Walking
   *  straight never reaches it, so a framing the player chose survives a straight run. */
  turnThreshold: number;
  /** How far a full LAUNCH (~0.6 g, low-passed) stretches the follow distance beyond the speed curve
   *  (world units) — acceleration reads as the camera hanging back, gear noise does not (plan 080/09 §3).
   *  0 = off. */
  vehicleAccelDistanceGain: number;
  /** How long the collision release takes in a CAR (seconds) — longer than on foot, because a car clears an
   *  occluder at a speed that makes the on-foot ease read as a snap. */
  vehicleCollisionReleaseTime: number;
  /** How much further out the camera sits at {@link vehicleDistanceSpeed} (world units, added to the
   *  size-based distance). The speed sense of #5: the frame opens up as the car gets quick, and visibly
   *  glides back in under braking. */
  vehicleDistanceGain: number;
  /** In a car the follow distance at REST is the car's LENGTH × this (a bus frames further out than a
   *  hatchback); {@link vehicleDistanceGain} then opens it up with speed. Collision caps the result, so a
   *  car against a wall doesn't push the camera through. */
  vehicleDistanceScale: number;
  /** The speed (units/s) at which {@link vehicleDistanceGain} is fully applied (smoothstep from 0). */
  vehicleDistanceSpeed: number;
  /** How much the field of view widens at {@link vehicleFovMaxSpeed} (radians). The speed sense that
   *  distance alone cannot give — but it PUMPS if it reacts to throttle blips, hence the dead-band below. */
  vehicleFovKick: number;
  /** How fast the FOV closes on its target (per second). Deliberately slower than the zoom channel. */
  vehicleFovLambda: number;
  /** Speed (units/s) at which the FOV kick is full. */
  vehicleFovMaxSpeed: number;
  /** Below this speed (units/s) the FOV does not move at all — the dead-band that stops city-speed noise
   *  from pumping the lens. */
  vehicleFovMinSpeed: number;
  /** How long the look must stay idle before the camera eases behind a moving CAR (seconds). Shorter than
   *  on foot: hands-off is the norm while driving. */
  vehicleRecenterDelaySec: number;
  /** The vertical look-point lag while seated (seconds). Faster than on foot — suspension bounce must not
   *  pump the horizon, and a car's vertical motion is the road, not a jump arc. */
  vehicleVerticalLagTime: number;
  /** How long the camera takes to swing behind a turning CAR (seconds). Longer than the on-foot swing: this
   *  IS the "camera hangs outside the corner, then swings through" weight. */
  vehicleYawLagTime: number;
  /** How long the look point takes to follow the focus VERTICALLY (seconds). Slower than the planar channel
   *  on purpose — stairs, curbs and jump arcs must not jolt the horizon. */
  verticalLagTime: number;
  /** How long a steered yaw takes to swing home (seconds) — the massy catch-up when something other than the
   *  player aims the camera (vehicle entry today, auto-center in plan 03). Manual look always cancels it. */
  yawLagTime: number;
  /** How fast the live zoom distance closes on its target (per second; the damp half-life is ln2/lambda). */
  zoomLambda: number;
}

/** CLEO script runtime (plan 097/04). `enabled: false` = zero per-frame overhead. */
export interface CleoConfig {
  enabled: boolean;
  /** Boot-discovery cap: scripts beyond this many `cleo/*.cs` are skipped with a log. */
  maxScripts: number;
  /** Log every host call the scripts make (field debugging; plan 097/07 grows this). */
  trace: boolean;
}

/** Procedural sky-dome cloud tuning. */
export interface CloudsConfig {
  /** Cloud cover 0 (clear) → 1 (overcast). */
  coverage: number;
  /** Cloud opacity over the sky (0 = off, skips the cloud shader branch). */
  opacity: number;
  /** Volumetric raymarched clouds (plan 067 Stage B, ultra tier): replaces the flat deck with a lit
   *  3D layer. Default OFF — measurably heavier (march on every sky pixel). */
  volumetric: boolean;
}

/** Top-level game configuration. Mutated in place so `PluginContext.config` stays live. */
export interface Config {
  camera: CameraConfig;
  /** CLEO script runtime (plan 097/04) — live-read every fixed step. */
  cleo: CleoConfig;
  controls: ControlsConfig;
  fog: FogConfig;
  fonts: FontsConfig;
  gameState: GameState;
  graphics: GraphicsConfig;
  hud: HudConfig;
  /** Map-viewer mode: free-fly camera + manual cell render + click-to-pick (debug map inspector). */
  mapViewer: boolean;
  movement: MovementConfig;
  /** Overlay collision (COL) wireframes on the current region (debug). */
  showCollision: boolean;
  /** Diagnostic log floor: `false` = silent (default); otherwise emit `'log'` events at this level or higher. */
  showLogs: false | LogLevel;
  staticUrl: string;
  streaming: StreamingConfig;
  time: TimeConfig;
  vehicle: VehicleConfig;
  /** Seconds a weather change eases over (≤0 = instant switch). The current weather is a load param. */
  weatherTransitionSeconds: number;
}

/** Remappable keyboard bindings; values are `KeyboardEvent.code`. */
export interface ControlsConfig {
  back: string;
  forward: string;
  jump: string;
  left: string;
  /** Hold to look BEHIND while driving (plan 080/05 §6) — the camera flips to the car's front through a
   *  fast damp and swings back on release. Optional; unbound = the feature is off. */
  lookBehind?: string;
  right: string;
  /** Legacy full-speed modifier (the default gait IS run since 088/03) — kept for touch parity. Optional. */
  run?: string;
  /** Hold to sprint (the top gait tier). Optional. */
  sprint?: string;
  /** Hold to walk slowly (the bottom gait tier). Optional. */
  walk?: string;
}

/** Night-fill tuning for dynamic objects (player/vehicles) — plan 034. */
export interface DynamicObjectsFillConfig {
  /** Fresnel edge-rim strength (cool sheen on silhouettes). */
  rim: number;
  /** Overall fill strength (× the night factor → the moonlit albedo term). 0 = off. */
  strength: number;
}

/** World 2dfx particle effects (fires/smoke/fountains; plan 044) — live-tunable. */
export interface EffectsConfig {
  /** Multiplier over every fx system's SHIPPED draw distance — its authored `cullDist` with the two
   *  recorded departures and the dynamic lane's floor already applied (`fxDrawDistance`). 1 = as the data
   *  says; it scales the whole set rather than replacing it, so the authored table still wins the shape. */
  drawDistanceScale: number;
  /** Master toggle (off = no particle emitters render). */
  enabled: boolean;
}

/** Distance fog tuning. */
export interface FogConfig {
  /** Distance (world units) at which the world is fully fogged (the horizon); fog ramps in before it.
   *  Classic pipeline: the only range knob. Modern (plan 068): the FALLBACK/cap — the live range comes
   *  from timecyc `fogStart`/`farClip` × {@link timecycScale}. */
  distance: number;
  /** Modern pipeline (plan 068): multiplier on the timecyc `farClip`/`fogStart` ranges — fog distance
   *  becomes a per-weather/hour MOOD (SF fog actually rolls in). 1 = as authored. */
  timecycScale: number;
}

/** Font family names per HUD widget (registered by the font loader before the scene). */
export interface FontsConfig {
  hud: { clock: string; zone: string };
}

/** Whether the simulation is running (physics + control) or frozen. `'streaming'` (plan 061) freezes
 *  gameplay exactly like `'pause'` (every gate checks `!== 'play'`) while the render loop + streaming
 *  systems keep running — the world loads behind a veil (boot, teleports). */
export type GameState = 'pause' | 'play' | 'streaming';

/** Post-processing / graphics-effect toggles (cost-sensitive; off-able on weak machines). */
export interface GraphicsConfig {
  /** Bloom (bright-area glow) tuning. */
  bloom: BloomConfig;
  /** Procedural clouds on the sky dome. */
  clouds: CloudsConfig;
  /** World 2dfx particle effects (fires/smoke/fountains; plan 044). */
  effects: EffectsConfig;
  /** Vehicle headlights (the occupied car's night beams). */
  headlights: HeadlightConfig;
  /** Night light sources (2d-effect coronas — street lamps etc.). */
  lights: LightsConfig;
  /** Night moon disc + glow. */
  moon: MoonConfig;
  /** Night ambient/atmosphere tuning (how dark + the moonlight tint). */
  night: NightConfig;
  /** Rendering-overhaul master switch (plan 063): `'classic'` = the shipped 038 look; `'modern'` opts into
   *  the new pipeline stages as plans 064+ land behind it. No stage branches on it yet. */
  pipeline: 'classic' | 'modern';
  /** Procedural ground clutter (procobj.dat scatter; plan 042) — per-category tuning. */
  procobj: ProcObjConfig;
  /** Own-engine render scale (074/09 tiers): scene targets sized `canvas × scale` (0.5–1), the post pass
   *  upscales to the swapchain. 1 = native. Live — no reload needed. The three path ignores it. */
  renderScale: number;
  /** Sun shadows (directional shadow map). */
  shadows: ShadowsConfig;
  /** Sky/sun god-rays shader tuning (shaft look). */
  sky: SkyConfig;
  /** Screen-space ambient occlusion (contact shadows in corners/under objects). */
  ssao: SsaoConfig;
  /** Procedural night stars on the sky dome. */
  stars: StarsConfig;
  /** Sun disc + god-rays source/toggle. */
  sun: SunConfig;
  /** ACES tone mapping. ON by design since the SA prelit pipeline (plan 038) — the night blend
   *  and world tints are calibrated against it; the toggle remains as a debug/perf escape hatch. */
  toneMapping: boolean;
  /** Colour-pipeline spike selector (plan 063): the tone-mapping CURVE of the post pass. `'aces'` = today's
   *  look; `'agx'`/`'neutral'` = alternative curves (same placement, applies to the whole frame incl.
   *  sky/water); `'none'` = pass disabled (raw). The live A/B tool for the 063 decision — remove after. */
  toneMappingMode: ToneMappingModeName;
  /** Vehicle env-map reflections (preset-driven; see plan 030). */
  vehicleReflection: VehicleReflectionConfig;
  /** Water surface shader tuning (reflection + sun glint). */
  water: WaterConfig;
  /** SA prelit world-lighting calibration (plan 038) — tints/strengths of the unlit map pipeline. */
  worldLight: WorldLightConfig;
}

/** Vehicle headlight tuning (the occupied car's night lamps; plan 033). MVP: glowing lamp glass + coronas
 *  only — no road beam yet (to be redone properly). */
export interface HeadlightConfig {
  /** Road-beam strength (plan 070 light pool): the headlight spots' brightness on the world. */
  beamIntensity: number;
  /** Road-beam reach (world units) — the spot's radius. */
  beamRange: number;
  /** Brake-light pool strength behind the car (× when braking). */
  brakeIntensity: number;
  /** Lamp corona brightness (additive flare opacity at each lamp). */
  coronaIntensity: number;
  /** Lamp corona size (world units) — the small flare on each lamp. */
  coronaSize: number;
  /** Lamp-glass glow strength (emissive multiplier on the lit lamp glass; bloom turns it into the halo). */
  intensity: number;
}

/** HUD widget styling (the DOM overlay above the canvas; immune to post-processing). */
export interface HudConfig {
  clock: HudTextStyle;
  zone: HudTextStyle;
}

/** Text style for a HUD widget: fill `color` + an outline (`borderColor`/`borderWidth` px). */
export interface HudTextStyle {
  borderColor: string;
  borderWidth: number;
  color: string;
  fontSize: number;
}

/** Night light-source (2d-effect corona) tuning. */
export interface LightsConfig {
  /** Master toggle (off = coronas never render). */
  enabled: boolean;
  /** Hour the lamps switch off in the morning (e.g. 6 = 06:00). */
  nightEndHour: number;
  /** Hour the lamps switch on in the evening (e.g. 20 = 20:00). */
  nightStartHour: number;
}

/**
 * Clock schedule (hours 0–24) for the night-lit content — the SA baked **night vertex colours** (lit
 * windows/signs/road lamp-pools) **and** the ACES night tonemap, which rides the same window. Fades in over
 * dusk `[duskStart, duskEnd]` (0→1), full overnight, fades out over dawn `[dawnStart, dawnEnd]` (1→0).
 */
export interface LitFadeConfig {
  /** Hour the dawn fade-out completes — fully day (e.g. 7). */
  dawnEnd: number;
  /** Hour the dawn fade-out begins — still fully lit (e.g. 6). */
  dawnStart: number;
  /** Hour the dusk fade-in completes — fully lit (e.g. 20). */
  duskEnd: number;
  /** Hour the dusk fade-in begins — still day (e.g. 19). */
  duskStart: number;
}

/** Diagnostic severity, low → high. The configured `showLogs` value is the floor that is emitted. */
export type LogLevel = 'debug' | 'error' | 'log' | 'warn';

/** Night moon tuning (a static sprite that fades in as night falls). */
export interface MoonConfig {
  /** Brightness multiplier for the (additive) moon sprite. */
  brightness: number;
  /** Height of the static moon above the horizon, in degrees. */
  elevationDeg: number;
  /** Moon disc size (world units). */
  size: number;
}

/** Player movement tuning (world units/second; rates in units/s²). */
export interface MovementConfig {
  /** Horizontal acceleration toward the input target (ramp-up + turn momentum). */
  accel: number;
  /** Fraction (0..1) of accel/deceleration applied while airborne (air control). */
  airControl: number;
  /** Recovery seconds after a COLLAPSE landing — covers the fall-down AND the stand-back-up clips. */
  collapseRecoverySeconds: number;
  /** Vertical impact speed (units/s) above which a landing collapses outright (088/07 top tier). */
  collapseSpeed: number;
  /** Seconds after leaving the ground during which a jump is still accepted (coyote time, 088/04). */
  coyoteSeconds: number;
  /** Horizontal deceleration toward rest when there is no input. */
  deceleration: number;
  /** Recovery seconds after a HARD landing (the impact-crouch tier — control reduced throughout). */
  hardLandRecoverySeconds: number;
  /** Vertical impact speed (units/s) above which a landing takes the impact crouch (088/07 mid tier). */
  hardLandSpeed: number;
  /** Seconds a jump press is remembered — landing within the window fires it on the landing frame. */
  jumpBufferSeconds: number;
  /** Upward launch velocity when jumping. */
  jumpSpeed: number;
  /** Recovery seconds after a normal landing (a beat of reduced control, not a stun). */
  landRecoverySeconds: number;
  /** Seconds between the jump being accepted and the impulse — the anticipation crouch is REAL time. */
  launchDelaySeconds: number;
  /** Planar speed of the DEFAULT gait (no modifier held) — SA jogs by default (088/03). */
  runSpeed: number;
  /** Slope steepness (deg) above which the ped SLIDES (088/08) — match the physics MIN_SLOPE_SLIDE. */
  slideSlopeDeg: number;
  /** Planar speed while the sprint modifier is held (the top gait tier). */
  sprintSpeed: number;
  /** Turn rate (deg/s) at the top tier speed — low = wide readable arcs while sprinting. */
  turnRateFullDeg: number;
  /** Turn rate (deg/s) while near-standing — high = snappy repositioning on the spot. */
  turnRateIdleDeg: number;
  /** Planar speed while the walk modifier is held (or a partial touch-stick deflection). */
  walkSpeed: number;
}

/** Night ambient / atmosphere tuning (the "dark night" look). */
export interface NightConfig {
  /** Distance (world units) past which lamp coronas fade out (a near-field cap over their per-lamp far-clip). */
  coronaDrawDistance: number;
  /** Cheap shader night-fill for dynamic objects (player/vehicles) so they aren't black at night (plan 034). */
  dynamicObjectsFill: DynamicObjectsFillConfig;
  /** Night EMISSIVE glow (plan 071, modern pipeline): how brightly SA's baked night sources (lit windows,
   *  neon, signs — the night-vertex hot spots) self-illuminate into bloom. 0 = off. Costs a few ALU. */
  emissiveBoost: number;
  /** Dusk/dawn fade schedule for the night vertex colours + the night tonemap (they share one window). */
  litFade: LitFadeConfig;
  /** Night SKY glow (plan 067/071, modern sky): moon Rayleigh halo + urban horizon skyglow strength —
   *  the authored SA night gradient is near-black; this lifts the sky physically-plausibly (0 = off). */
  skyGlow: number;
  /** Night skylight (hemisphere "moonlight from above") strength — top-down fill that gives objects form. */
  skylight: number;
  /** Night-vertex-colour glow strength — how strongly the SA baked night lighting (lit windows / signs /
   *  road lamp-pools) self-illuminates at night. */
  windowGlow: number;
}

/** License-plate mask per city (plan 082/04) — the background is chosen by where the car SPAWNED. */
export interface PlateMaskConfig {
  la: string;
  sf: string;
  vegas: string;
}

/** Semantic groups of procobj.dat clutter models — each tuned independently (plan 042). */
export type ProcObjCategory = 'bushes' | 'cacti' | 'flowers' | 'grass' | 'rocks' | 'trees' | 'underwater';

/** Procedural ground clutter (procobj.dat) — one tuning block per {@link ProcObjCategory}. */
export type ProcObjConfig = Record<ProcObjCategory, ProcObjTypeConfig>;

/** Tuning of one clutter category. Pure decoration with a perf cost — all knobs are live. */
export interface ProcObjTypeConfig {
  /** Density multiplier on the authored spacing (1 = vanilla, 0.5 = half the objects). */
  density: number;
  /**
   * Visibility distance (world units) for this category's scattered objects, applied PER INSTANCE. The
   * widest enabled category also sets the radius clutter cells stream at, so a category can never be visible
   * past its own number nor past the widest one.
   *
   * SA has no per-category equivalent — it draws all procedural clutter at a flat `PLANTS_MAX_DISTANCE = 100`
   * — so this is deliberately not the original's shape. 100 is the FLOOR here, not the target.
   */
  drawDistance: number;
  enabled: boolean;
}

/** Sun shadow (directional shadow map) tuning. */
export interface ShadowsConfig {
  /** CSM shadow reach (plan 065, modern pipeline): far-cascade end, world units. Dawn/dusk auto-clamps. */
  distance: number;
  /** Master toggle (off = the sun stops casting → no shadow-map render, materials drop shadow code). */
  enabled: boolean;
}

/** God-rays shader tuning (pmndrs GodRaysEffect); higher = denser/brighter shafts. */
export interface SkyConfig {
  /** Density of the light rays along the sample march. */
  density: number;
  /** Constant attenuation coefficient (overall brightness). */
  exposure: number;
  /** Sky model (plan 067): `'classic'` = the timecyc gradient dome; `'pbr'` = the Preetham physical sky
   *  (timecyc-driven inputs + mood tint), night-blended back to the SA gradient. */
  model: 'classic' | 'pbr';
  /** PBR-sky mood (plan 067): how strongly the timecyc palette tints the physical sky (0 = pure Preetham). */
  mood: number;
  /** PBR-sky exposure (plan 067): scales the physical sky before its in-shader Reinhard (LDR composer). */
  pbrExposure: number;
  /** Per-sample light weight. */
  weight: number;
}

/** Screen-space ambient occlusion (SSAO) tuning. */
export interface SsaoConfig {
  /** Master toggle (off = the normal pass + SSAO pass are skipped, zero cost). */
  enabled: boolean;
  /** Occlusion strength. */
  intensity: number;
  /** Sampling radius (relative to resolution; larger = wider, softer occlusion). */
  radius: number;
}

/** Procedural night-stars tuning. */
export interface StarsConfig {
  /** Master toggle (off = the dome shader skips the star branch). */
  enabled: boolean;
}

/** World streaming / LOD tuning (sectioned grid render). */
export interface StreamingConfig {
  /** Grid cell edge in world units (must match the adapter's grid). */
  cellSize: number;
  /** Static collision is streamed within this distance of the view (small + a margin). */
  collisionDrawDistance: number;
  /** Full (HD) models are streamed within this distance of the view. */
  hdDrawDistance: number;
  /** LODs are streamed within this distance (beyond the HD ring). */
  lodDrawDistance: number;
}

/** Sun disc + god-rays source tuning. */
export interface SunConfig {
  /** Volumetric light shafts from the sun (post-FX). */
  godrays: boolean;
  /** Base size of the god-rays light source (world units), independent of the visible disc — bigger = stronger shafts. */
  godraysSize: number;
  /** Visible sun disc base size (world units); the timecyc per-hour size scales this. */
  sunSize: number;
}

/** Game-clock tuning. */
export interface TimeConfig {
  /** Real seconds per in-game minute (e.g. 1.5 → a full day is 36 real minutes). */
  secondsPerGameMinute: number;
}

/** Tone-mapping CURVE for the plan-063 colour spike (see GraphicsConfig.toneMappingMode). Placement is
 *  fixed by architecture: with the composer, three skips renderer-level (material-stage) tone mapping when
 *  rendering into a render target — verified live (renderer modes were a no-op) — so the post pass is the
 *  only place; the spike compares CURVES there. */
export type ToneMappingModeName = 'aces' | 'agx' | 'neutral' | 'none';

/** Vehicle distance-LOD thresholds (world units from the player view). */
export interface VehicleConfig {
  /** Within this distance the full HD model is shown. */
  hdDistance: number;
  /** Between `hdDistance` and this the low-detail `_vlo` is shown; beyond it the car is culled. */
  lodDistance: number;
  /**
   * License-plate text masks per city (plan 082): `L` → a letter, `D` → a digit, `*` → either, anything
   * else passes through. Empty falls back to the game's own shape, `LLDD DLL`. Eight characters max — a
   * plate has eight cells. Applies to NEW spawns; the fleet already on the street keeps its plates.
   */
  plates: PlateMaskConfig;
  /** Beyond this the car is unloaded from memory; it respawns when back within `lodDistance`. */
  unloadDistance: number;
}

/** Vehicle env-map reflection tuning (plan 030). */
export interface VehicleReflectionConfig {
  /** Global reflection-intensity multiplier over the preset/DFF values. */
  intensity: number;
  /** Preset key into the reflection PRESETS registry; `'off'` (or unknown) = matte, no reflections. */
  preset: string;
}

/** Water surface shader tuning. */
export interface WaterConfig {
  /** How much to darken the deep (top-down) water tint, 0 (raw timecyc) → 1 (black). */
  darkness: number;
  /** Foam amount (plan 069): whitecaps on crests + the shoreline band. 0 = none. */
  foam: number;
  /** Sun specular glint strength (sparkle along the sun direction). */
  glint: number;
  /** How much the sky reflects at grazing angles (0–1). Modern samples the 067 sky LUT per direction. */
  reflection: number;
  /** Depth-based shore (plan 069): clear shallows + surf foam. Needs a scene DepthPass (extra geometry render)
   *  so it is OPT-IN (a quality-tier feature); off = deep water everywhere, no extra render cost. */
  shore: boolean;
  /** How CLEAR the shallows get, 0 (keeps the authored opacity) → 1 (near-glass). Guards against the
   *  "water looks like glass" failure — the timecyc alpha stays the floor. */
  shoreClarity: number;
  /** Depth (world units) over which the shallows go from clear to the deep tint (plan 069 shore). */
  shoreDepth: number;
  /** Wave-height multiplier over the weather's sea state (plan 069). 0 = flat water. */
  waves: number;
}

/**
 * SA prelit world lighting (plan 038): the map renders unlit — `texture × day/night prelit blend ×
 * tint` — and these scalars calibrate the tints. All read live each frame (debug → Atmosphere).
 */
export interface WorldLightConfig {
  /** Scale on the additive timecyc-ambient term (plan 093 — SA's `Color.rgb += ambient*surfAmb`
   *  building term): 1 = the game's own column, 0 = off. */
  ambient: number;
  /** DELIBERATE day-time lower bound (linear) under the timecyc ambient — `max()`, day-shaped, our
   *  deviation from SA (vanilla authors day `Amb` ≈ 0 and shows black-prelit walls black). Fitted to
   *  the field-approved prelit-floor-40 experiment (`docs/hacks/world-ambient-floor.md`); 0 = strict
   *  SA parity. */
  ambientFloor: number;
  /** Noon world brightness (× prelit). Sub-white compensates the always-on ACES tone curve. */
  dayBrightness: number;
  /** Dawn/dusk dim level the sun-height day arc sinks to near the horizon (warm hue is fixed). */
  duskBrightness: number;
  /** Deep-night brightness scale for models WITHOUT night prelit (the distant LOD ring) — multiplies
   *  the timecyc `amb` colour of the active weather. */
  lodNightAmbScale: number;
  /** Deep-night brightness of the night-prelit set itself (1 = exactly as authored by Rockstar). */
  nightPrelitBrightness: number;
  /** How dark dynamic-object (car/ped) shadows read on the unlit world (0 = off, 1 = black). */
  shadowStrength: number;
  /** Hybrid lighting (plan 064, modern pipeline only): master direct-sun strength (0 = classic look). */
  sunDirect: number;
  /** Hybrid lighting (plan 064): prelit retention at full sun (1 = classic, ~0.7 = plan intuition). */
  sunIndirect: number;
}
