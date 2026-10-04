/**
 * The own-engine player body (plan 074/10 B3): the B1 ped probe driven by GAMEPLAY state — position from
 * the physics Transform, heading from planar velocity, idle↔walk clip by speed. The model is the game's
 * `GAME_CONFIG.mainCharacter` `.osm` read BY NAME from the VFS (opensa-pack 003 phase 5f — see
 * {@link loadEnginePlayer}; hardcoded `male01` until 2026-07-23, a 074 bring-up leftover); the old
 * ped-probe fixture is gone.
 */
import type { Engine, PedProbe, SamplerClip } from '@opensa/engine';
import type { MovementConfig } from '@opensa/game/interfaces/config.interface';
import type { AssetFileSystem } from '@opensa/renderware';

import { IfpSampler } from '@opensa/engine';
import { writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import {
  IDLE_SPEED_THRESHOLD,
  LOCOMOTION_AIRBORNE,
  LOCOMOTION_COLLAPSE,
  LOCOMOTION_FALL,
  LOCOMOTION_GROUNDED,
  LOCOMOTION_HARD_LAND,
  LOCOMOTION_LAND,
  LOCOMOTION_LAUNCH,
  LOCOMOTION_SLIDE,
} from '@opensa/game/character/locomotion';
import { VEHICLE_SCRIPTED_CLIPS } from '@opensa/game/vehicle/vehicle-clips';
import { getIfp } from '@opensa/renderware/archive/asset-cache';
import { type PedClip, pedClip, rootMotion, sampleRootMotion } from '@opensa/renderware/ped/build-ped-model';

import { GaitSelector } from './gait-selector';
import { DEFAULT_FADE_SECONDS, LocomotionMixer } from './locomotion-mixer';

export interface EnginePlayer {
  /** Face a yaw directly (enter/exit uses it on the way out of the car). */
  faceTo(yaw: number): void;
  /** Lowest posed vertex of the model (GTA Z-up) — the host aligns it to the physics ground. */
  minZ: number;
  /** A scripted clip's authored root travel (088/09a — `EnterVehicleSystem` replays it), or null. */
  scriptedMotion(clip: string): null | { duration: number; sample(time: number): readonly [number, number, number] };
  /**
   * Play a named clip (climb-in / sit / climb-out) instead of the speed-driven locomotion, or `null` to hand
   * control back. This is the {@link VehicleAnimator} surface `EnterVehicleSystem` drives — the same contract
   * the three `CharacterAnimationSystem` satisfies.
   */
  setScripted(
    clip: null | string,
    options?: { facing?: number; loop?: boolean; orientation?: readonly [number, number, number, number] },
  ): void;
  /** Advance the clip clock and upload the palette for this frame (`speed` = planar GTA m/s;
   *  `state`/`stateTime` = the controller's `Locomotion.state`+`stateTime` — pick the 088/04 air/land
   *  clip over the gait, and drive the 088/07 collapse→getup handoff). */
  update(
    positionEngine: readonly [number, number, number],
    headingYaw: number,
    speed: number,
    dt: number,
    state?: number,
    stateTime?: number,
  ): void;
}

/** The tier speeds the animation side needs: gait thresholds + cycle-speed references (088/03). */
export type GaitTiers = Pick<MovementConfig, 'runSpeed' | 'sprintSpeed' | 'walkSpeed'>;

/** Where the player's clips live. The archives hold it bare; a game dir keeps it under `anim/`, and the
 *  browser VFS keys loose files by their relative path — so both spellings have to be tried. */
const PLAYER_IFP_NAMES = ['ped', 'anim/ped'];
/** Clip order the state machine below indexes: the gaits, then the 088/04 air/land states. */
const PLAYER_CLIPS = [
  'idle_stance',
  'walk_civi',
  'run_civi',
  'sprint_civi',
  'jump_launch',
  'jump_glide',
  'jump_land',
  'fall_glide',
  // The severe tier goes FACE DOWN in one motion + rises from face-down. NOT `fall_collapse`: that
  // clip is a standing-knockout crumple whose buckle→straighten→drop prefix read as TWO clips on a
  // landing (field 2026-07-24: "crouch, then he stood up, then ALSO a fall").
  'fall_front',
  'fall_land',
  'getup_front',
];
const IDLE_CLIP = 0;
const WALK_CLIP = 1;
const RUN_CLIP = 2;
const SPRINT_CLIP = 3;
const LAUNCH_CLIP = 4;
const GLIDE_CLIP = 5;
const LAND_CLIP = 6;
const FALL_GLIDE_CLIP = 7;
const COLLAPSE_CLIP = 8;
const FALL_LAND_CLIP = 9;
const GETUP_CLIP = 10;
/** Gait tier (the {@link GaitSelector} output) → locomotion clip. */
const GAIT_CLIPS = [IDLE_CLIP, WALK_CLIP, RUN_CLIP, SPRINT_CLIP];
/** Air/land clips that HOLD their last frame. Launch/land/collapse are obvious one-shots; the GLIDES
 *  are too — `JUMP_glide` is ~0.4 s but a jump hangs ~0.9 s, and letting the sampler wrap it snapped
 *  the pose back to frame 0 mid-flight (field 2026-07-24: "the jump animation plays twice, legs jerk"). */
const ONE_SHOT_CLIPS: ReadonlySet<number> = new Set([
  COLLAPSE_CLIP,
  FALL_GLIDE_CLIP,
  FALL_LAND_CLIP,
  GETUP_CLIP,
  GLIDE_CLIP,
  LAND_CLIP,
  LAUNCH_CLIP,
]);
/** Landings snap in faster than gait fades; the launch pours into the glide almost seamlessly. */
const LAND_FADE_SECONDS = 0.12;
const LAUNCH_TO_GLIDE_FADE_SECONDS = 0.1;
/**
 * Scripted clips `EnterVehicleSystem` asks for BY NAME (climb-in / climb-out / sit). Shared from the game
 * package ({@link VEHICLE_SCRIPTED_CLIPS}) so the requester and this resolver can't desync. They are resolved
 * from the SAME `ped.ifp` as locomotion; without them `setScripted` fell through to `idle_stance`, so the
 * driver rode STANDING with his legs out of the car.
 */
const SCRIPTED_CLIPS = VEHICLE_SCRIPTED_CLIPS;
/** The cyclic gaits that carry normalized phase through a crossfade (088/02) — legs stay in step. */
const CYCLIC_CLIPS: ReadonlySet<number> = new Set([RUN_CLIP, SPRINT_CLIP, WALK_CLIP]);
/** Cycle-speed sync clamp (088/03): how far the clip clock may stretch to match the ground speed. */
const RATE_MIN = 0.7;
const RATE_MAX = 1.4;

/**
 * Name → index for `setScripted`. Locomotion (the first `locomotionCount`, always addressable by the state
 * machine) is registered unconditionally; a SCRIPTED clip earns a name entry ONLY when it actually resolved
 * from the IFP (`duration > 0`). An unresolved scripted clip MUST fall through to the standing locomotion
 * stand-in — sampling its empty clip would drop the ped to the flat bind pose (SA's bind mesh lies along X).
 * Pure + exported so the gate that decides "driver sits" vs "driver rides standing" is unit-testable.
 */
export function buildClipIndex(
  resolved: readonly Pick<PedClip, 'duration' | 'name'>[],
  locomotionCount: number,
): Map<string, number> {
  const clipByName = new Map<string, number>();
  resolved.forEach((clip, index) => {
    if (index < locomotionCount || clip.duration > 0) {
      clipByName.set(clip.name.toLowerCase(), index);
    }
  });

  return clipByName;
}

/**
 * The player, loaded BY NAME from the game's own assets (opensa-pack 003 phase 5f).
 *
 * It used to fetch `/ped/ped.json` + `/ped/ped.bin` over HTTP — the LAB's probe fixture, baked by a CLI —
 * in the production host. So the shipped player was whatever a developer last converted, animations frozen
 * at bake time, and the game dir the user picked had no say. Now the model comes from `<model>.osm` in the
 * archives and the clips are resolved from `ped.ifp` at load, exactly like every other asset.
 */
export function loadEnginePlayer(engine: Engine, fs: AssetFileSystem, model: string, tiers: GaitTiers): EnginePlayer {
  const name = model.toLowerCase();
  const osm = fs.get(`${name}.osm`);
  if (!osm) {
    throw new Error(
      `player model ${name}.osm not found (GAME_CONFIG.mainCharacter) — check the model exists in the ` +
        'game/peds install and opensa-pack ran over the game dir',
    );
  }
  const { fixture, geometry, textureArrays } = readPedOsm(name, new Uint8Array(osm));
  const probe: PedProbe = engine.setPedProbe({
    boneCount: fixture.bones.length,
    indexCount: fixture.indexCount,
    indices: geometry.indices,
    joints: geometry.joints,
    normals: geometry.normals,
    positions: geometry.positions,
    submeshes: fixture.submeshes,
    textures: textureArrays.map((bytes) => ({ bytes, kind: 'ostex' as const })),
    uvs: geometry.uvs,
    weights: geometry.weights,
  });
  const sampler = new IfpSampler(fixture.bones);
  // The clips are resolved against THIS model's bones, from the game's own IFP — a modded ped.ifp changes
  // how the player walks, which a baked fixture could never express.
  const animations = PLAYER_IFP_NAMES.map((name) => getIfp(fs, name)).find((entries) => entries.length > 0) ?? [];
  if (animations.length === 0) {
    // Without clips the sampler holds the BIND pose — and SA's bind mesh lies flat along X, so the player
    // would lie on the ground instead of standing. Say so rather than shipping a corpse.
    // eslint-disable-next-line no-console -- a silent bind-pose player is worse than a console line
    console.warn(`[player] no ped.ifp found (tried ${PLAYER_IFP_NAMES.join(', ')}) — the player cannot animate`);
  }
  // Returns pedClip's richer (NAMED) shape, not the engine's name-free SamplerClip: we need the resolved
  // clip's name below to key `clipByName`.
  const resolveClip = (name: string): PedClip => {
    const animation = animations.find((entry) => entry.name.toLowerCase() === name);

    return animation ? pedClip(animation, fixture.bones) : { duration: 0, name, tracks: [] };
  };
  // Locomotion first (its indices are the [idle, walk, run] the state machine hard-codes), scripted after.
  const resolved = [...PLAYER_CLIPS, ...SCRIPTED_CLIPS].map(resolveClip);
  const clips: SamplerClip[] = resolved;
  const clipByName = buildClipIndex(resolved, PLAYER_CLIPS.length);
  const durations = clips.map((clip) => clip.duration);
  // Gait thresholds sit halfway between the tier speeds; the selector's hysteresis stops the
  // boundary flicker. Cycle-speed refs = the tier speeds — rate 1 exactly at each tier's target.
  const selector = new GaitSelector([
    IDLE_SPEED_THRESHOLD,
    (tiers.walkSpeed + tiers.runSpeed) / 2,
    (tiers.runSpeed + tiers.sprintSpeed) / 2,
  ]);
  const referenceSpeeds = [0, tiers.walkSpeed, tiers.runSpeed, tiers.sprintSpeed];
  const rateOf = (clip: number, speed: number): number => {
    const reference = referenceSpeeds[clip] ?? 0;

    return reference > 0 ? Math.min(RATE_MAX, Math.max(RATE_MIN, speed / reference)) : 1;
  };
  const fadeFor = (from: number, to: number): number => {
    if (to === LAND_CLIP || to === COLLAPSE_CLIP || to === FALL_LAND_CLIP) {
      return LAND_FADE_SECONDS;
    }
    if (from === LAUNCH_CLIP && to === GLIDE_CLIP) {
      return LAUNCH_TO_GLIDE_FADE_SECONDS;
    }

    return DEFAULT_FADE_SECONDS;
  };
  const mixer = new LocomotionMixer(durations, CYCLIC_CLIPS, IDLE_CLIP, { fadeFor, oneShot: ONE_SHOT_CLIPS, rateOf });
  let clipTime = 0; // the SCRIPTED clock — locomotion time lives in the mixer
  let scripted: null | { index: number; loop: boolean } = null;
  let scriptedFacing = 0;
  /**
   * The car's FULL orientation while riding (prod passes it every fixed step). It OVERRIDES the yaw: a
   * yaw-only root cannot express the body's tilt and roll, and rebuilding the angle from our own atan2
   * leaves the driver turning out of sync with the car he is bolted into.
   */
  let scriptedOrientation: null | readonly [number, number, number, number] = null;
  const root = new Float32Array(16);

  // Root-travel tracks by (lowercased) clip name, extracted from the same IFP on first use.
  const motionByName = new Map<string, null | ReturnType<EnginePlayer['scriptedMotion']>>();

  return {
    faceTo(yaw: number): void {
      scriptedFacing = yaw;
    },
    minZ: fixture.minZ,
    scriptedMotion(clip: string): null | { duration: number; sample(time: number): readonly [number, number, number] } {
      const key = clip.toLowerCase();
      if (!motionByName.has(key)) {
        const animation = animations.find((entry) => entry.name.toLowerCase() === key);
        const track = animation ? rootMotion(animation) : null;
        motionByName.set(
          key,
          track && track.duration > 0
            ? {
                duration: track.duration,
                sample: (time): readonly [number, number, number] => sampleRootMotion(track, time),
              }
            : null,
        );
      }

      return motionByName.get(key) ?? null;
    },
    setScripted(clip, options = {}): void {
      if (clip === null) {
        if (scripted !== null) {
          // Handing control back: fade the held scripted pose into locomotion (climb-out → stance)
          // instead of popping — update() re-picks the speed-appropriate gait on the next frame.
          mixer.restartFromHold(IDLE_CLIP);
        }
        scripted = null;
        scriptedOrientation = null;
        clipTime = 0;

        return;
      }
      const index = clipByName.get(clip.toLowerCase());
      if (index === undefined) {
        scripted = null; // the fixture lacks the clip — locomotion keeps running rather than freezing
        scriptedOrientation = null;

        return;
      }
      // Re-issued EVERY fixed step while seated (with a fresh orientation) — restarting the clock on each
      // call would freeze the sit clip on its first frame, so only a CHANGE of clip rewinds it.
      if (scripted?.index !== index) {
        clipTime = 0;
      }
      scripted = { index, loop: options.loop ?? false };
      scriptedOrientation = options.orientation ?? null;
      if (options.facing !== undefined) {
        scriptedFacing = options.facing;
      }
    },
    update(positionEngine, headingYaw, speed, dt, state = LOCOMOTION_GROUNDED, stateTime = 0): void {
      if (scripted) {
        const clip = clips[scripted.index];
        clipTime += dt;
        // A one-shot clip HOLDS its last pose (the seated driver stays seated); a looping one wraps.
        const time = scripted.loop ? clipTime : Math.min(clipTime, clip.duration);
        sampler.sample(clip, time, probe.palette, 1);
      } else {
        // The air/land state overrides the gait; with no (resolved) air clip the gait carries on — the
        // jump PHYSICS still runs, the visual just degrades to v1 (rule 3).
        const wanted =
          airClipFor(state, durations, stateTime) ?? resolveGaitClip(durations, GAIT_CLIPS[selector.update(speed)]);
        const { captureHold, pose } = mixer.update(wanted, dt, speed);
        if (captureHold) {
          sampler.holdPose(); // freeze the on-screen pose BEFORE sampling — the hold-fade's source
        }
        if (pose.kind === 'single') {
          sampler.sample(clips[pose.clip] ?? clips[0], pose.time, probe.palette, 1);
        } else if (pose.kind === 'blend') {
          sampler.sampleBlended(
            clips[pose.from],
            pose.fromTime,
            clips[pose.to],
            pose.toTime,
            pose.alpha,
            probe.palette,
            1,
          );
        } else {
          sampler.sampleFromHold(clips[pose.to], pose.toTime, pose.alpha, probe.palette, 1);
        }
        scriptedFacing = headingYaw;
      }
      if (scriptedOrientation) {
        // Riding: the car's full transform — the same matrix its own parts ride, so the driver is welded to
        // the seat through turns, lean and flips.
        writeGtaRoot(root, positionEngine, [...scriptedOrientation] as [number, number, number, number]);
        probe.palette.set(root, 0);
      } else {
        const yaw = scripted ? scriptedFacing : headingYaw;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        probe.palette.set(
          [c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, positionEngine[0], positionEngine[1], positionEngine[2], 1],
          0,
        );
      }
      engine.updatePedPalette();
    },
  };
}

/**
 * The clip a gait tier actually plays. Only the 088/03 addition degrades: a TC whose `ped.ifp` lacks
 * `sprint_civi` keeps the RUN cycle at sprint speed (the pre-sprint v1 behaviour) — sampling the empty
 * clip would drop the ped to the flat bind pose. Pure + exported so the gate is unit-testable.
 */
export function resolveGaitClip(durations: readonly number[], wanted: number): number {
  return wanted === SPRINT_CLIP && (durations[SPRINT_CLIP] ?? 0) <= 0 ? RUN_CLIP : wanted;
}

/** Per-state clip choice with degradation: try the authored clip, then its stand-in; every entry must
 *  have resolved (duration > 0) or the next is tried — an absent air set degrades to the speed gait. */
const AIR_CLIP_CHAINS: Readonly<Record<number, readonly number[]>> = {
  [LOCOMOTION_AIRBORNE]: [GLIDE_CLIP],
  [LOCOMOTION_COLLAPSE]: [COLLAPSE_CLIP, FALL_LAND_CLIP, LAND_CLIP],
  [LOCOMOTION_FALL]: [FALL_GLIDE_CLIP, GLIDE_CLIP],
  [LOCOMOTION_HARD_LAND]: [FALL_LAND_CLIP, LAND_CLIP],
  [LOCOMOTION_LAND]: [LAND_CLIP],
  [LOCOMOTION_LAUNCH]: [LAUNCH_CLIP],
  // No authored slide clip exists in SA — the fall-glide balance pose is the stand-in (field-judged).
  [LOCOMOTION_SLIDE]: [FALL_GLIDE_CLIP, GLIDE_CLIP],
};

/**
 * The clip an 088/04 FSM state plays, or `null` for "not airborne / nothing resolved — use the speed
 * gait" (the rule-3 v1 fallback: jump PHYSICS works on every TC even when its IFP has no jump clips).
 * `stateTime` drives the 088/07 COLLAPSE chain: `fall_collapse` until its clip has played out, then
 * `getup` (when resolved — else the collapse holds its last frame for the whole recovery).
 * Pure + exported so the degradation chains are unit-testable.
 */
export function airClipFor(state: number, durations: readonly number[], stateTime = 0): null | number {
  const collapseDuration = durations[COLLAPSE_CLIP] ?? 0;
  if (
    state === LOCOMOTION_COLLAPSE &&
    collapseDuration > 0 && // no collapse clip → the ped never went down, so getup would read wrong
    stateTime >= collapseDuration &&
    (durations[GETUP_CLIP] ?? 0) > 0
  ) {
    return GETUP_CLIP;
  }
  for (const clip of AIR_CLIP_CHAINS[state] ?? []) {
    if ((durations[clip] ?? 0) > 0) {
      return clip;
    }
  }

  return null;
}
