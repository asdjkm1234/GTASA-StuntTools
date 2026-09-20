/**
 * Vehicle lamps, renderer-agnostic (plan 074/08 B5 step 5). The three path's `VehicleHeadlightSystem` keeps
 * its sprites and uniform arrays; this system does the same job through SINKS, so the own engine feeds its
 * light pool and its existing corona pass without a second copy of the lore.
 *
 * The three parts of a lit car, all from the shared {@link lampStateFor} / {@link lampsOf}:
 *   - the LAMPS themselves (texture twin + glow) → the handle;
 *   - the POOL lights that pool on the asphalt ahead and glow red behind → `light` sink;
 *   - the CORONAS at each lamp, faded by how much the lamp faces the camera → `corona` sink.
 */
import type { System } from '../core/system';
import type { HeadlightConfig } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';
import type { VehicleLamp } from './vehicle-lamps';

import { isLightSmashed, lampsOf, lampStateFor } from './vehicle-lamps';

/** A lamp corona the renderer should draw this frame. */
export interface LampCorona {
  color: [number, number, number];
  /** 0..1 — already faded by viewing angle and brake state. */
  fade: number;
  position: Vec3;
  size: number;
}

/** A pool light the renderer should add this frame. */
export interface LampLight {
  /** Linear RGB × intensity. */
  color: [number, number, number];
  /**
   * SPOT cone for a headlight: the cosine of its half-angle plus the unit direction it points. Absent for
   * the tail lamps, which are point lights. Without a cone a headlight floods the whole street — the road
   * BEHIND the car included — because a point light has no idea which way it is aimed.
   */
  cone?: { cosAngle: number; direction: [number, number, number] };
  position: Vec3;
  radius: number;
}

export interface VehicleLampSinks {
  /** Called once per visible corona; the host clears its own buffer before `update`. */
  corona: (corona: LampCorona) => void;
  /** Camera position (native Z-up) — the corona facing fade needs it. */
  eye: () => Vec3;
  /** Called once per pool light. */
  light: (light: LampLight) => void;
  /** Cleared at the start of every update (both sinks refill from scratch). */
  reset: () => void;
}

/** Linear-space lamp colours. */
const HEAD_RGB: [number, number, number] = [1, 0.93, 0.72];
const TAIL_RGB: [number, number, number] = [1, 0.08, 0.04];
/**
 * Beam cone half-angle cosine and how steeply the beam aims DOWN at the asphalt. Prod's numbers (0.55 ≈ 57°,
 * drop 0.5 ≈ 27°) came from a pool that was ALSO shoved metres ahead of the bumper. With the source back at
 * the lamp where it belongs, that cone is so wide and so steep that the two beams merge into one blob under
 * the nose — you cannot tell a car has two headlights. Narrower (≈ 38°) and flatter (≈ 18°) gives two
 * separate pools that reach down the road.
 */
const BEAM_CONE_COS = 0.78;
const BEAM_DROP = 0.32;
/** Tail lamps run dim and jump to full on the brakes. */
const TAIL_RUNNING = 0.2;
/** A rear corona at its running level; brakes take it to 1 and swell it. */
const REAR_RUNNING = 0.4;
const BRAKE_CORONA_SCALE = 1.25;
/**
 * The corona billboard is nudged TOWARDS THE CAMERA by this much, not outwards.
 *
 * The lamp dummy sits ON the lens surface, so a camera-facing quad centred there is half-buried in the
 * bodywork: the depth test slices it along the car's own silhouette, leaving a hard straight edge across the
 * lens and the panel above it. (That clipped quad — not the lighting, not the texture — is what read as a
 * "cropped" tail light.) Pushing it OUT along the lamp's facing fixes the clipping but detaches the glow from
 * the car — it visibly floats behind the bumper. Along the VIEW RAY it barely moves on screen (the offset is
 * pure depth) while clearing the bodywork from any angle.
 */
const CORONA_DEPTH_BIAS = 0.35;

export class VehicleLampSystem implements System {
  readonly name = 'vehicle-lamps';

  private readonly config: () => HeadlightConfig;
  private readonly enter: EnterVehicleSystem;
  private readonly isNight: () => boolean;
  /**
   * The car we lit LAST frame. It cannot be re-derived from the enter system: by the time the driver is out,
   * `getActive()` is already null, so there would be nobody left to switch off — and the car would drive away
   * with its lamps burning forever. Lamp state lives on the VEHICLE, not here.
   */
  private lit: EnterableVehicle | null = null;
  private readonly sinks: VehicleLampSinks;

  constructor(
    enter: EnterVehicleSystem,
    isNight: () => boolean,
    config: () => HeadlightConfig,
    sinks: VehicleLampSinks,
  ) {
    this.enter = enter;
    this.isNight = isNight;
    this.config = config;
    this.sinks = sinks;
  }

  update(): void {
    const cfg = this.config();
    const braking = this.enter.isBraking();
    const { car, state } = lampStateFor(
      this.enter.getActive(),
      this.enter.isSeated(),
      braking,
      this.isNight(),
      cfg.intensity,
    );
    this.sinks.reset();
    if (this.lit && this.lit !== car) {
      this.lit.handle.setLamps({
        brakes: false,
        headlights: false,
        intensity: cfg.intensity,
        smashed: this.lit.handle.lightsSmashed(),
      });
      this.lit.rig.setPopUpLights(false);
    }
    this.lit = car;
    if (!car) {
      return;
    }
    // Retractable headlights follow the same signal that lights the lamps — the pods are only up because the
    // lights are on. The RIG owns the travel (it runs in the fixed step, where a smooth arc can be timed).
    car.rig.setPopUpLights(state.headlights);
    // …but a pod car does not LIGHT until the pods are all the way up: a lamp still parked in the nose aims
    // its beam into the bodywork, and its corona glows out of a closed panel. Going the other way the light
    // dies the moment the pods start folding, which is the same switch a real car's. Everything without a pod
    // lights the instant the state says so — the gate must never delay a car that has no arc to wait for.
    const headlights = state.headlights && (!car.handle.hasPopUpLights || car.rig.popUpTravel >= 1);
    car.handle.setLamps({ ...state, headlights });

    const eye = this.sinks.eye();
    for (const lamp of lampsOf(car)) {
      if (lamp.kind === 'head' && !headlights) {
        continue; // no pool light and no corona from a lamp that is still buried in the nose
      }
      if (isLightSmashed(state.smashed, lamp.light)) {
        continue; // a smashed lamp is a hole in the bodywork: no beam, no pool, no corona
      }
      this.emit(lamp, cfg, braking, eye);
    }
  }

  /** One lamp → a pool light on the road (or behind) and, if it faces the camera, a corona. */
  private emit(lamp: VehicleLamp, cfg: HeadlightConfig, braking: boolean, eye: Vec3): void {
    const head = lamp.kind === 'head';
    this.sinks.light({
      color: scale(head ? HEAD_RGB : TAIL_RGB, head ? cfg.beamIntensity : brakeLevel(cfg, braking)),
      // The beam AIMS forward and down; the source stays AT the lamp (prod does the same). Shoving the
      // source metres ahead of the bumper — which the lab demo did, having no cone to aim — throws the pool
      // way out in front of the car and lets it spill past kerbs and fences it should never have reached.
      ...(head
        ? { cone: { cosAngle: BEAM_CONE_COS, direction: normalize([lamp.facing[0], lamp.facing[1], -BEAM_DROP]) } }
        : {}),
      position: lamp.position,
      radius: head ? cfg.beamRange : braking ? 10 : 5,
    });
    // A corona is only visible from IN FRONT of its lamp: fade it by how squarely the lamp faces the eye,
    // squared so it is clearly off from the side (a tail light must not glow through the boot).
    const facing = Math.max(0, dot(lamp.facing, normalize(sub(eye, lamp.position))));
    const fade = facing * facing * cfg.coronaIntensity * (head || braking ? 1 : REAR_RUNNING);
    if (fade > 0.01) {
      const toEye = normalize(sub(eye, lamp.position));
      this.sinks.corona({
        color: head ? HEAD_RGB : TAIL_RGB,
        fade,
        position: [
          lamp.position[0] + toEye[0] * CORONA_DEPTH_BIAS,
          lamp.position[1] + toEye[1] * CORONA_DEPTH_BIAS,
          lamp.position[2] + toEye[2] * CORONA_DEPTH_BIAS,
        ],
        size: cfg.coronaSize * (!head && braking ? BRAKE_CORONA_SCALE : 1),
      });
    }
  }
}

function brakeLevel(cfg: HeadlightConfig, braking: boolean): number {
  return braking ? cfg.brakeIntensity : cfg.brakeIntensity * TAIL_RUNNING;
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

function scale(rgb: readonly [number, number, number], by: number): [number, number, number] {
  return [rgb[0] * by, rgb[1] * by, rgb[2] * by];
}

function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
