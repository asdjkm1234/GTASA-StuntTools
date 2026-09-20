import type { Config } from '@opensa/game/interfaces/config.interface';

/**
 * The game's runtime `Config` (extracted from `canvas-host.tsx` 2026-07-13 so the own-engine host
 * (plan 074/10 B3, `?engine=opensa`) reuses the SAME controls/movement/streaming/graphics values as the
 * three-WebGL path — behavioural parity by construction, one source of truth).
 */
import { GAME_CELL_SIZE } from '@opensa/cell-weld/cell-size';

const BASE = import.meta.env.VITE_STATIC_URL;

/** Streaming grid cell edge — shared by Config.streaming + the adapter; MUST match opensa-lod-generator's
 *  cellSize (its baked lod_<cx>_<cy> cells map 1:1 onto engine cells). */
/**
 * The GAME-side cell grid: collision streaming, procobj scatter, LOD-impostor placement.
 *
 * Distinct from the RENDER grid — opensa-pack welds `.oscell` blobs on its own `CELL_SIZE` (250) and the
 * manifest carries that to the engine. The two have never matched and nothing requires them to.
 */
export { GAME_CELL_SIZE };

export function createGameRuntimeConfig(): Config {
  return {
    // 080/01: the rig values the host used to hard-code (eye height 0.9, sensitivity 0.004, pitch clamps)
    // are config now — same numbers, so the camera feels exactly as it did, but a field round can tune them
    // from the debug Camera tab without a rebuild.
    // The POSITION weight (positionLagTime / verticalLagTime / deadZone) is ON: the camera trails a sharp
    // direction change and eases back (behaviour #3), and height follows slower so stairs don't jolt the
    // horizon. This is only stable because the host draws the ped/car/focus at an interpolated pose (render
    // interpolation, plan 080/03) — a continuous focus, so the spring smooths real motion, not the
    // fixed-step saw. Turn all three to 0 to go back to a rigid attach.
    camera: {
      // Collision keeps the eye out of a wall directly behind the player/car (whisker angle 0: the ±15°
      // flanking casts fired on a pole/wall BESIDE you, so only the straight-back cast counts). The floor is
      // the NEAR-PLANE radius — a wall closer than that pulls the eye up to the surface (it may sit inside the
      // ped for a frame) rather than sliding BEHIND the wall, which reads far worse. Field-accepted stopping
      // point: the slide can clip the ped a little, but it never falls through the wall or stalls.
      bobAmplitude: 0.025,
      bobCyclesPerMetre: 0.25,
      collisionMinDistance: 0.5,
      collisionRadius: 0.35,
      collisionReleaseTime: 0.4,
      collisionWhiskerAngle: 0,
      deadZone: 0.08,
      driftLookBlend: 0.5,
      driftMinSpeed: 6,
      driftSlipDeadZone: 0.05,
      followDistance: 7,
      followHeight: 0.9,
      followLerp: 3,
      followMaxPolar: Math.PI / 2 - 0.05,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 10,
      followZoomMin: 4,
      footIdleDelaySec: 5,
      footIdleDistanceEase: 0.4,
      footRunDistanceGain: 0.6,
      footRunFullSpeed: 7,
      footYawAuthorityFull: 0.9,
      footYawAuthorityStart: 0.2,
      inputSmoothTime: 0.03,
      lagMaxDistance: 1.2,
      landingDipFullSpeed: 5,
      // Landing dip: SHIPPED OFF (080/06 field round 3). It works and is tested — it simply never read at a
      // 7 m third-person orbit, at any depth tried. Raise `LANDING DIP` on the Camera tab to bring it back;
      // it is likely to earn its place with 08's first-person preset, where the eye is the head.
      landingDipScale: 0,
      lookAheadDistance: 0.8,
      lookAheadFullSpeed: 7,
      lookAheadTime: 0.45,
      lookBehindLagTime: 0.15,
      manualGraceSec: 0.25,
      moveThreshold: 0.6,
      pitchMax: 0.9,
      pitchMin: -1.2,
      positionLagTime: 0.12,
      recenterDelaySec: 2,
      recenterRate: 1.6,
      reducedMotion: false,
      sensitivity: 0.004,
      settleEpsilon: 0.03,
      shakeImpactForce: 250000,
      shakeScale: 0.08,
      sprintFovKick: 0.07,
      teleportSnapDistance: 20,
      turnThreshold: 0.9,
      vehicleAccelDistanceGain: 1,
      vehicleCollisionReleaseTime: 0.6,
      vehicleDistanceGain: 5,
      vehicleDistanceScale: 1,
      vehicleDistanceSpeed: 40,
      vehicleFovKick: 0.175,
      vehicleFovLambda: 2.5,
      vehicleFovMaxSpeed: 28,
      vehicleFovMinSpeed: 6,
      vehicleRecenterDelaySec: 1.5,
      vehicleVerticalLagTime: 0.15,
      vehicleYawLagTime: 0.35,
      verticalLagTime: 0.28,
      yawLagTime: 0.25,
      zoomLambda: 8,
    },
    // CLEO scripts: ON by default (user's call 2026-08-06, priced by the A/B/A — ~0 CPU frame,
    // ~0.45 ms GPU where the mod content is visible; both wheel field reports began as "cleo was
    // just off"). `?cleo=0` opts a session out; live-read, F2 CLEO can pause it.
    cleo: {
      enabled: true,
      maxScripts: 32,
      trace: false,
    },
    // 088/03: RUN is the default gait (SA jogs); Shift sprints. `walk` is left unbound — the slow tier
    // is reachable by a partial touch-stick deflection, or bind a key here.
    controls: {
      back: 'KeyS',
      forward: 'KeyW',
      jump: 'Space',
      left: 'KeyA',
      lookBehind: 'KeyC',
      right: 'KeyD',
      sprint: 'ShiftLeft',
    },
    fog: { distance: 800, timecycScale: 1 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState: 'play',
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85, volumetric: false },
      // World 2dfx particle effects (plan 044) — each system is drawn for its own authored CULLDIST
      // (plan 100/04); the scale is a live multiplier over that, 1 = exactly what the fxp says.
      effects: { drawDistanceScale: 1, enabled: true },
      headlights: {
        beamIntensity: 2.2,
        beamRange: 34,
        brakeIntensity: 1.6,
        coronaIntensity: 0.8,
        coronaSize: 0.28,
        intensity: 1,
      },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 5, size: 55 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.1, strength: 0.8 }, // plan 034: dynamic-object night fill
        emissiveBoost: 1.6,
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 },
        skyGlow: 1,
        skylight: 0.6,
        windowGlow: 1.0,
      },
      // Rendering-overhaul master switch (plan 063). DEFAULT-FLIPPED to 'modern' (2026-07-10): the whole
      // chain (064–071) is on by default — hybrid sun, CSM shadows, PBR sky+LUT, unified fog, local lights,
      // night emissives. Volumetric clouds stay OFF (heavy; ultra-tier). The formal quality-tier ladder +
      // budget contract is plan 072, PARKED for now — this is a straight "everything but volumetric" flip.
      pipeline: 'modern',
      // Procedural ground clutter (procobj.dat; plan 042) — per-category, live-tunable in debug → ProcObj.
      //
      // `drawDistance` is world units, and it is REAL since 2026-08-10: the values below were dead config for
      // as long as they existed (written by the slider, read by nothing), so every category was really drawn
      // at the collision ring's 150. The range is now applied per instance in the clutter shader.
      //
      // The scale, and why it is not the original's: SA draws ALL procedural clutter at a flat
      // `PLANTS_MAX_DISTANCE = 100` (`docs/gta-sa-original/procedural-objects.md`) — one number, no species
      // variation, a 2004 compromise in a create/destroy system with a pool. We have neither the pool nor the
      // per-frame creation, and our `sa` target already shows this same clutter at 299 (plan 014's permanent
      // rows), so matching 100 would make the two targets disagree about the same world. The floor is
      // therefore 100 — the original's number is our MINIMUM — and size decides the rest: what reads as a
      // silhouette on the horizon carries far, what reads as ground texture does not.
      procobj: {
        // Waist-height masses; they read as cover rather than as a silhouette.
        bushes: { density: 1, drawDistance: 150, enabled: true },
        // Tall desert landmarks — the thing you navigate by in Bone County.
        cacti: { density: 1, drawDistance: 300, enabled: true },
        flowers: { density: 1, drawDistance: 100, enabled: true },
        // Ground texture: past ~100 it is sub-pixel noise that costs pure fill.
        grass: { density: 1, drawDistance: 100, enabled: true },
        // Mixed by nature — `searock01` boulders down to `p_rubble` gravel — so mid-range.
        rocks: { density: 1, drawDistance: 200, enabled: true },
        // The biggest silhouette, and the one `sa` shows at 299.
        trees: { density: 1, drawDistance: 300, enabled: true },
        // Water attenuates long before the range does.
        underwater: { density: 1, drawDistance: 100, enabled: true },
      },
      renderScale: 1,
      shadows: { distance: 800, enabled: true },
      sky: { density: 0.96, exposure: 0.5, model: 'pbr', mood: 0.7, pbrExposure: 0.55, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: true,
      toneMappingMode: 'aces',
      vehicleReflection: { intensity: 0.25, preset: 'enhanced' },
      water: {
        darkness: 0.9,
        foam: 1,
        glint: 0.5,
        reflection: 0.2,
        shore: true,
        shoreClarity: 0.55,
        shoreDepth: 6,
        waves: 1,
      },
      // SA prelit world (plan 038) calibration — live-tunable in debug → Atmosphere.
      worldLight: {
        ambient: 1,
        ambientFloor: 0.13,
        dayBrightness: 0.85,
        duskBrightness: 0.45,
        lodNightAmbScale: 1.6,
        nightPrelitBrightness: 0.7,
        shadowStrength: 0.55,
        sunDirect: 1,
        sunIndirect: 0.7,
      },
    },
    hud: {
      clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
      zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
    },
    mapViewer: false,
    // Turn rates (plan 088/01): near-idle spins snappily, the top tier arcs at a third of that.
    // Jump (plan 088/04): jumpSpeed 4.5 → apex ≈ 1.03 m, air ≈ 0.92 s (3.5 gave a weak 0.62 m hop).
    // accel 14 (field 2026-07-24, was 20): 0→run in ~0.5 s — the start stopped ripping; decel stays
    // higher so stopping keeps its snap.
    movement: {
      accel: 14,
      airControl: 0.3,
      // 2.2 covers the full fall_front (0.73 s) + getup_front (1.37 s) chain — a shorter recovery
      // CUT the riser mid-motion and popped to idle.
      collapseRecoverySeconds: 2.2,
      collapseSpeed: 16,
      coyoteSeconds: 0.12,
      deceleration: 25,
      hardLandRecoverySeconds: 0.5,
      hardLandSpeed: 12,
      jumpBufferSeconds: 0.15,
      jumpSpeed: 4.5,
      landRecoverySeconds: 0.15,
      launchDelaySeconds: 0.1,
      runSpeed: 7,
      // 40° (field 2026-07-24, was 45): the LS river banks (~42°) must slide — 45 left the ped
      // standing on them, and jump-laddering up any hillside worked.
      slideSlopeDeg: 40,
      sprintSpeed: 10,
      turnRateFullDeg: 240,
      turnRateIdleDeg: 720,
      walkSpeed: 2,
    },
    showCollision: false,
    // Diagnostics off by default. Flip to 'debug' | 'log' | 'warn' | 'error' here to stream
    // gated `log` events to the console; filter by `type` in the subscriber below.
    showLogs: false,
    staticUrl: BASE,
    // lodDrawDistance kept just past fog.distance (800): geometry is culled shortly after it's fully
    // fogged, so the distant skyline isn't rendered as pale ghosts (and it's cheaper).
    streaming: { cellSize: GAME_CELL_SIZE, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1000 },
    time: { secondsPerGameMinute: 1.5 },
    vehicle: {
      hdDistance: 80,
      lodDistance: 250,
      // Empty masks take the game's own shape (LLDD DLL). Per-city so a mod can give each state its style.
      plates: { la: '', sf: '', vegas: '' },
      unloadDistance: 500,
    },
    weatherTransitionSeconds: 6,
  };
}
