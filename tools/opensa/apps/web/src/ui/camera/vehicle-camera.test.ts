import { describe, expect, it } from 'vitest';

import { TEST_CAMERA_CONFIG } from './camera-test-config';
import { CAMERA_FOV_Y } from './engine-camera';
import { driftHeading, vehicleDistanceForSpeed, vehicleFovTarget, vehicleTuning } from './vehicle-camera';

const CONFIG = TEST_CAMERA_CONFIG;
/** Comfortably past every dead-band, so a case is about the channel under test and not about a gate. */
const FAST = CONFIG.vehicleFovMaxSpeed;
/** A slide big enough to clear the slip dead-band and its fade-in. */
const SLIDE = CONFIG.driftSlipDeadZone * 3;

describe('driftHeading', () => {
  describe('negative cases', () => {
    it('does not lean below the drift speed — a parking manoeuvre is not a slide', () => {
      const heading = driftHeading(1, SLIDE, CONFIG.driftMinSpeed - 0.01, CONFIG);

      expect(heading).toBe(1);
    });

    it('does not lean on the small permanent slip of straight driving', () => {
      const heading = driftHeading(1, CONFIG.driftSlipDeadZone * 0.9, FAST, CONFIG);

      expect(heading).toBe(1);
    });

    it('does not lean when the blend is turned off', () => {
      const heading = driftHeading(1, SLIDE, FAST, { ...CONFIG, driftLookBlend: 0 });

      expect(heading).toBe(1);
    });

    it('never leans past the slip itself, however hard the slide', () => {
      const slip = 1.2; // a full-on spin
      const heading = driftHeading(0, slip, FAST, CONFIG);

      // The blend is a FRACTION of the slip: the camera looks partway along the travel, never past it.
      expect(Math.abs(heading)).toBeLessThan(Math.abs(slip));
    });
  });

  describe('positive cases', () => {
    it('leans toward the travel direction in a slide, by the configured fraction', () => {
      const heading = driftHeading(0, SLIDE, FAST, CONFIG);

      expect(heading).toBeCloseTo(SLIDE * CONFIG.driftLookBlend, 6); // past the fade-in, relief is 1
    });

    it('follows the SIGN of the slip — a slide either way leans that way', () => {
      expect(driftHeading(0, SLIDE, FAST, CONFIG)).toBeGreaterThan(0);
      expect(driftHeading(0, -SLIDE, FAST, CONFIG)).toBeLessThan(0);
    });

    it('fades in across the dead-band instead of stepping at its edge', () => {
      // The 04 lesson: a discontinuous gate flickers the framing. Just past the band the lean is a
      // fraction of what it is well past it, not the whole thing.
      const justPast = driftHeading(0, CONFIG.driftSlipDeadZone * 1.1, FAST, CONFIG);
      const wellPast = driftHeading(0, CONFIG.driftSlipDeadZone * 1.1 * 3, FAST, CONFIG);

      expect(justPast).toBeGreaterThan(0);
      expect(justPast / CONFIG.driftSlipDeadZone).toBeLessThan(0.1);
      expect(wellPast).toBeGreaterThan(justPast);
    });

    it('leans while REVERSING out of a slide too — |speed| is what gates it', () => {
      expect(driftHeading(0, SLIDE, -FAST, CONFIG)).toBeCloseTo(SLIDE * CONFIG.driftLookBlend, 6);
    });
  });
});

describe('vehicleDistanceForSpeed', () => {
  describe('negative cases', () => {
    it('adds nothing at a standstill — the distance is the car size alone', () => {
      expect(vehicleDistanceForSpeed(9, 0, CONFIG)).toBe(9);
    });
  });

  describe('positive cases', () => {
    it('opens up with speed, to the full gain at the reference speed', () => {
      const half = vehicleDistanceForSpeed(9, CONFIG.vehicleDistanceSpeed / 2, CONFIG);

      expect(half).toBeGreaterThan(9);
      expect(half).toBeLessThan(9 + CONFIG.vehicleDistanceGain);
      expect(vehicleDistanceForSpeed(9, CONFIG.vehicleDistanceSpeed, CONFIG)).toBeCloseTo(
        9 + CONFIG.vehicleDistanceGain,
        6,
      );
    });

    it('is capped by the reference speed — going faster cannot open it further', () => {
      const at = vehicleDistanceForSpeed(9, CONFIG.vehicleDistanceSpeed, CONFIG);
      const past = vehicleDistanceForSpeed(9, CONFIG.vehicleDistanceSpeed * 3, CONFIG);

      expect(past).toBeCloseTo(at, 12);
    });

    it('treats reverse by its magnitude, so backing up fast frames the same', () => {
      expect(vehicleDistanceForSpeed(9, -CONFIG.vehicleDistanceSpeed, CONFIG)).toBeCloseTo(
        vehicleDistanceForSpeed(9, CONFIG.vehicleDistanceSpeed, CONFIG),
        12,
      );
    });

    it('frames a bigger car further out at the same speed', () => {
      const hatchback = vehicleDistanceForSpeed(7, 20, CONFIG);
      const bus = vehicleDistanceForSpeed(14, 20, CONFIG);

      expect(bus - hatchback).toBeCloseTo(7, 12); // the speed term is shared, the size term is not
    });
  });
});

describe('vehicleFovTarget', () => {
  describe('negative cases', () => {
    it('holds the base lens below the dead-band — city speeds must not pump the FOV', () => {
      expect(vehicleFovTarget(CONFIG.vehicleFovMinSpeed - 0.01, CONFIG)).toBe(CAMERA_FOV_Y);
      expect(vehicleFovTarget(0, CONFIG)).toBe(CAMERA_FOV_Y);
    });
  });

  describe('positive cases', () => {
    it('widens toward the full kick as the car approaches top speed', () => {
      const mid = vehicleFovTarget((CONFIG.vehicleFovMinSpeed + CONFIG.vehicleFovMaxSpeed) / 2, CONFIG);

      expect(mid).toBeGreaterThan(CAMERA_FOV_Y);
      expect(vehicleFovTarget(CONFIG.vehicleFovMaxSpeed, CONFIG)).toBeCloseTo(CAMERA_FOV_Y + CONFIG.vehicleFovKick, 9);
    });

    it('stops at the full kick however far past top speed the car goes', () => {
      expect(vehicleFovTarget(CONFIG.vehicleFovMaxSpeed * 4, CONFIG)).toBeCloseTo(
        CAMERA_FOV_Y + CONFIG.vehicleFovKick,
        9,
      );
    });
  });
});

describe('vehicleTuning', () => {
  describe('negative cases', () => {
    it('leaves the authored table untouched — the rig reads a copy, the sliders keep their values', () => {
      const tuned = vehicleTuning(CONFIG);

      expect(tuned).not.toBe(CONFIG);
      expect(CONFIG.yawLagTime).toBe(TEST_CAMERA_CONFIG.yawLagTime);
      expect(tuned.yawLagTime).not.toBe(CONFIG.yawLagTime);
    });

    it('changes ONLY the driving channels — everything else is the shared rig', () => {
      const tuned = vehicleTuning(CONFIG);
      const changed = Object.keys(tuned).filter(
        (key) => tuned[key as keyof typeof tuned] !== CONFIG[key as keyof typeof CONFIG],
      );

      expect(changed.sort()).toEqual(['collisionReleaseTime', 'recenterDelaySec', 'verticalLagTime', 'yawLagTime']);
    });
  });

  describe('positive cases', () => {
    it('swings slower, settles sooner, follows height faster and releases later than on foot', () => {
      const tuned = vehicleTuning(CONFIG);

      expect(tuned.yawLagTime).toBeGreaterThan(CONFIG.yawLagTime); // the corner-entry weight
      expect(tuned.recenterDelaySec).toBeLessThan(CONFIG.recenterDelaySec); // hands-off is the norm
      expect(tuned.verticalLagTime).toBeLessThan(CONFIG.verticalLagTime); // suspension must not pump the horizon
      expect(tuned.collisionReleaseTime).toBeGreaterThan(CONFIG.collisionReleaseTime);
    });
  });
});
