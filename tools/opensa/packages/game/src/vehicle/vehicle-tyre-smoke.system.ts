/**
 * Tyre smoke (plan 089/02): WHERE and HOW HARD the driven car's tyres slide, turned into spawn requests
 * for the dynamic particle lane (089/01). No new physics — everything here is a READ of what the physics
 * layer already decided this step.
 *
 * WHY not the telemetry slip ratio: Rapier's wheel ROTATION is cosmetic — it follows the ground exactly
 * (measured: 0.05 m/s of "slide" during a −1.1 g full-brake stop), so a rotation-derived ratio can never
 * see a lockup or a burnout. The honest longitudinal signal is DEMAND OVER CAP, recorded by
 * `setVehicleControls` at the only moment both are known ({@link VehicleWheelSlip}): brake demand past the
 * tyre = SA's locked wheel, engine force past the tyre = wheelspin. The lateral half needs no inference —
 * `planarMotion.speedLateral` IS the slide velocity.
 *
 * The three channels reduce to one EQUIVALENT SLIDE SPEED (m/s) per wheel:
 * - lateral: |speedLateral| — the patch slides sideways at the body's lateral speed;
 * - locked (brakeExcess): the patch slides at the car's ground speed, scaled in by how far past the cap
 *   the demand went;
 * - wheelspin (spinExcess): the tread's overspeed is not recoverable from Rapier, so the surplus ratio is
 *   mapped through {@link SPIN_TO_SLIDE} — an eye-fit, like every constant here (SA's `CFx::AddWheel*`
 *   bodies are stubs in gta-reversed; recorded in `docs/hacks/tyre-smoke-intensity-fit.md`).
 *
 * DELIBERATELY off the telemetry sampler: `VehicleTelemetry.enabled` is the F2-tab/capture gate, and smoke
 * that only appears while the debugger is open would be a bug shaped like a feature.
 */
import type { System } from '../core/system';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleController, VehicleWheelReading, VehicleWheelSlip } from '../physics/physics-world';

import { planarMotion, type PlanarMotion } from './vehicle-telemetry';

/** The car slice the smoke reads — the driven car's live pose and its controller. */
export interface TyreSmokeCar {
  body: number;
  controller: VehicleController;
  orientation: [number, number, number, number];
}

/** The field dials (session-overridable via `?smokeStart/?smokeFull/?smokeRate` — the 081/09 pattern). */
export interface TyreSmokeDials {
  /** Particles per wheel per second at FULL intensity. */
  rate: number;
  /** Equivalent slide speed (m/s) of full intensity — a locked motorway stop, a full-throttle burnout. */
  slideFull: number;
  /** Equivalent slide speed (m/s) where smoke STARTS — below it a tyre grips, above it it slips. */
  slideStart: number;
}

/** The narrow physics slice (kept small so tests drive the system with plain fakes). */
export interface TyreSmokePhysics {
  getLinvel(body: number): Vec3;
  readVehicleWheels(controller: VehicleController): readonly VehicleWheelReading[];
  readVehicleWheelSlip(controller: VehicleController): null | readonly VehicleWheelSlip[];
  wheelContactPoint(controller: VehicleController, wheel: number): [number, number, number] | null;
}

/** One wheel's spawn request for this step. `position` is the contact point, native GTA space. */
export interface TyreSmokePuff {
  count: number;
  /** 0..1 — how far between the start and full dials the slide sits; the sink scales the look with it. */
  intensity: number;
  position: [number, number, number];
}

/** Defaults of the eye-fit (see the hack doc): grip noise stays silent, a real slide reads immediately. */
export const TYRE_SMOKE_DEFAULTS: TyreSmokeDials = { rate: 6, slideFull: 12, slideStart: 4 };

/**
 * Equivalent slide speed (m/s) of a full wheelspin surplus — the one channel with no physical speed to
 * read (Rapier has no tread overspeed), so the surplus ratio buys slide speed at this exchange rate.
 */
const SPIN_TO_SLIDE = 7;

/**
 * The wheelspin channel FADES OUT with ground speed (field round 2: puffs on every gear shift while just
 * driving straight — each upshift's demand spike crossed the deadzone). Tyre-lighting wheelspin is a
 * low-speed phenomenon (a launch, a burnout); past this speed the surplus is drivetrain noise. The fade —
 * not the deadzone — is what silences the shifts: even a FULL surplus at 6+ m/s stays under `slideStart`.
 */
const SPIN_FADE_SPEED = 12;

/**
 * Demand-over-cap DEADZONES (field round 1, 2026-07-28: "smoke pours constantly while just driving").
 * Keyboard pedals are binary: a full-throttle pull-away in first and an ordinary full-pedal stop both
 * demand past the tyre's cap, and a demand that merely RIDES the cap is gripping (ABS-shaped), not
 * skidding. Only demand well PAST the cap reads as slide; the handbrake's exact 1 still maps to full.
 * The spin deadzone was 0.75 until field round 3 ("launch smoke disappeared") — the speed fade above now
 * owns the shift-spike problem, so the deadzone only decides WHICH launches light up.
 */
const BRAKE_DEADZONE = 0.25;
const SPIN_DEADZONE = 0.4;

/**
 * The SHARED slide signal (089/02, reused by the skid marks 089/03): one equivalent slide speed (m/s) for
 * a wheel, from the demand-over-cap record and the body's planar motion. Smoke rates and mark darkness
 * both read this — the two effects may never disagree about whether a tyre is sliding.
 */
export function equivalentSlideSpeed(slip: undefined | VehicleWheelSlip, motion: PlanarMotion): number {
  const locked = Math.min(1, Math.max(0, ((slip?.brakeExcess ?? 0) - BRAKE_DEADZONE) / (1 - BRAKE_DEADZONE)));
  const spinFade = Math.max(0, 1 - Math.abs(motion.speed) / SPIN_FADE_SPEED);
  const spinning = Math.min(1, Math.max(0, ((slip?.spinExcess ?? 0) - SPIN_DEADZONE) / (1 - SPIN_DEADZONE))) * spinFade;

  return Math.max(Math.abs(motion.speedLateral), locked * Math.abs(motion.speed), spinning * SPIN_TO_SLIDE);
}

/** More wheels than any SA vehicle carries — the per-wheel state array is sized once. */
const MAX_WHEELS = 8;

export class VehicleTyreSmokeSystem implements System {
  readonly name = 'vehicle-tyre-smoke';

  /** Fractional particles owed per wheel — a 0.4/step rate must still smoke, just less often. */
  private readonly accumulators = new Float64Array(MAX_WHEELS);
  /** The car whose per-wheel state above is valid — a car change resets it. */
  private car: null | TyreSmokeCar = null;

  constructor(
    private readonly driven: () => null | TyreSmokeCar,
    private readonly physics: TyreSmokePhysics,
    private readonly sink: (puff: TyreSmokePuff) => void,
    private readonly dials: TyreSmokeDials,
    private readonly enabled: () => boolean,
  ) {}

  fixedUpdate(step: number): void {
    const car = this.enabled() ? this.driven() : null;
    if (car !== this.car) {
      this.accumulators.fill(0);
      this.car = car;
    }
    if (car === null || step <= 0) {
      return;
    }
    const slips = this.physics.readVehicleWheelSlip(car.controller);
    if (slips === null) {
      return; // no controls have ever been applied — a car this fresh cannot be sliding
    }
    const wheels = this.physics.readVehicleWheels(car.controller);
    const motion = planarMotion(car.orientation, this.physics.getLinvel(car.body));
    for (let index = 0; index < Math.min(wheels.length, MAX_WHEELS); index += 1) {
      if (!wheels[index].contact) {
        this.accumulators[index] = 0; // an airborne wheel touches nothing — nothing to smoke
        continue;
      }
      const slide = equivalentSlideSpeed(slips[index], motion);
      const span = Math.max(0.001, this.dials.slideFull - this.dials.slideStart);
      const intensity = Math.min(1, Math.max(0, (slide - this.dials.slideStart) / span));
      if (intensity <= 0) {
        this.accumulators[index] = 0; // a gripping tyre owes nothing — no stale fraction puffs later
        continue;
      }
      this.accumulators[index] += this.dials.rate * intensity * step;
      const count = Math.floor(this.accumulators[index]);
      if (count === 0) {
        continue;
      }
      this.accumulators[index] -= count;
      const point = this.physics.wheelContactPoint(car.controller, index);
      if (point !== null) {
        this.sink({ count, intensity, position: point });
      }
    }
  }
}
