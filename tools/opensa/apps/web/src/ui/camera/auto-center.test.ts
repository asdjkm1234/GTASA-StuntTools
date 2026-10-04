import { describe, expect, it } from 'vitest';

import { aimAt, cancelAutoCenter, createAutoCenter, stepAutoCenter, yawBehind } from './auto-center';
import { TEST_CAMERA_CONFIG as CONFIG } from './camera-test-config';

const DT = 1 / 60;
const RUN = 7;

/** Step past the manual grace (the rig starts as if the player had just looked) without turning. */
const settleGrace = (state: ReturnType<typeof createAutoCenter>, yaw: number, heading = 0): void => {
  for (let elapsed = 0; elapsed < CONFIG.manualGraceSec + 2 * DT; elapsed += DT) {
    stepAutoCenter(state, yaw, heading, RUN, CONFIG, DT);
  }
};

/** Hold a heading for `seconds` at `speed` and report the last step. */
const hold = (
  state: ReturnType<typeof createAutoCenter>,
  yaw: number,
  heading: number,
  speed: number,
  seconds: number,
): { steerTo: null | number; yaw: number } => {
  let step = { steerTo: null as null | number, yaw };
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    step = stepAutoCenter(state, step.yaw, heading, speed, CONFIG, DT);
  }

  return step;
};

describe('yawBehind', () => {
  describe('positive cases', () => {
    it('puts the camera on the far side of the direction the character faces', () => {
      // GTA: the camera looks along (sin yaw, −cos yaw), a heading h points along (−sin h, cos h).
      const yaw = yawBehind(0.7);

      expect(Math.sin(yaw)).toBeCloseTo(-Math.sin(0.7), 12);
      expect(-Math.cos(yaw)).toBeCloseTo(Math.cos(0.7), 12);
    });
  });
});

describe('aimAt', () => {
  describe('negative cases', () => {
    it('yields pitch 0 when the target is the spot you stand on', () => {
      // atan2 of a zero horizontal leg would otherwise decide the pitch from a rounding artefact.
      expect(aimAt([10, 20, 3], [10, 20, 3]).pitch).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('points the CAMERA at the target once the heading goes through yawBehind', () => {
      // The round trip is the contract: aimAt returns a HEADING, and the rig seeds `yawBehind(heading)`.
      // A sign slip here aims 180° away, which is exactly what a headless probe cannot see for itself.
      const from: [number, number, number] = [100, 200, 10];
      const target: [number, number, number] = [140, 230, 10];
      const yaw = yawBehind(aimAt(from, target).heading);
      const flat = Math.hypot(target[0] - from[0], target[1] - from[1]);

      expect(Math.sin(yaw)).toBeCloseTo((target[0] - from[0]) / flat, 12);
      expect(-Math.cos(yaw)).toBeCloseTo((target[1] - from[1]) / flat, 12);
    });

    it('reproduces the boot facing for a target due SOUTH', () => {
      // The default camera looks south (`yawBehind(SPAWN_FACING)`, SPAWN_FACING = π), so a target at −y must
      // come back to the same heading — the one case a field probe can check against the old behaviour.
      const heading = aimAt([0, 0, 0], [0, -500, 0]).heading;

      expect(Math.sin(heading)).toBeCloseTo(Math.sin(Math.PI), 12);
      expect(Math.cos(heading)).toBeCloseTo(Math.cos(Math.PI), 12);
    });

    it('tilts UP for a target above the eye and DOWN for one below', () => {
      expect(aimAt([0, 0, 0], [0, 100, 100]).pitch).toBeCloseTo(Math.PI / 4, 12);
      expect(aimAt([0, 0, 0], [0, 100, -100]).pitch).toBeCloseTo(-Math.PI / 4, 12);
    });
  });
});

describe('stepAutoCenter', () => {
  describe('negative cases', () => {
    it('never rotates a player who is standing still, however long the look is idle', () => {
      const state = createAutoCenter();
      const step = hold(state, 1.2, 0, 0, 10);

      expect(step.yaw).toBe(1.2);
      expect(step.steerTo).toBeNull();
    });

    it('does not engage turn-follow on a straight run — only a real turn arms it', () => {
      const state = createAutoCenter();
      hold(state, 1.2, 0, RUN, 5);

      expect(state.following).toBe(false); // the yaw still drifts home, but through the idle recenter
    });

    it('holds off auto-centering for the manual grace after a look input', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      cancelAutoCenter(state); // the player just moved the mouse

      // A hard turn inside the grace window must not engage the follow.
      stepAutoCenter(state, 1.2, 0, RUN, CONFIG, DT);
      stepAutoCenter(state, 1.2, 1.5, RUN, CONFIG, DT);

      expect(state.following).toBe(false);
    });

    it('forgets the tracked heading when the player stops, so stopping never fakes a turn', () => {
      const state = createAutoCenter();
      stepAutoCenter(state, 1.2, 0, RUN, CONFIG, DT);
      stepAutoCenter(state, 1.2, 0, 0, CONFIG, DT); // stopped

      expect(state.lastHeading).toBeNull();

      // Resuming in a completely different direction is not a "turn" — there is nothing to compare against.
      stepAutoCenter(state, 1.2, 3, RUN, CONFIG, DT);

      expect(state.following).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('engages turn-follow on a fast heading change and steers behind the new direction', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      // 0.05 rad in one frame is 3 rad/s, well past the 0.9 threshold.
      const step = stepAutoCenter(state, 1.2, 0.05, RUN, CONFIG, DT);

      expect(state.following).toBe(true);
      expect(step.steerTo).toBeCloseTo(yawBehind(0.05), 12);
    });

    it('settles and stops steering once the yaw is behind the player', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      stepAutoCenter(state, 1.2, 0.05, RUN, CONFIG, DT);
      expect(state.following).toBe(true);

      const step = stepAutoCenter(state, yawBehind(0.05), 0.05, RUN, CONFIG, DT);

      expect(state.following).toBe(false);
      expect(step.steerTo).toBeNull();
    });

    it('eases behind a moving player once the look has been idle long enough', () => {
      const state = createAutoCenter();
      const away = yawBehind(0) + 1; // a whole radian off
      const step = hold(state, away, 0, RUN, CONFIG.recenterDelaySec + 2);

      expect(step.yaw).toBeLessThan(away);
      expect(step.yaw).toBeCloseTo(yawBehind(0), 1);
    });

    it('recenters a walk far more slowly than a sprint (the rate scales with speed)', () => {
      const away = yawBehind(0) + 1;
      const walk = createAutoCenter();
      const sprint = createAutoCenter();
      const walked = hold(walk, away, 0, 2, CONFIG.recenterDelaySec + 0.5);
      const sprinted = hold(sprint, away, 0, 10, CONFIG.recenterDelaySec + 0.5);

      expect(away - walked.yaw).toBeLessThan(away - sprinted.yaw);
    });

    it('does not recenter before the delay has passed', () => {
      const state = createAutoCenter();
      const away = yawBehind(0) + 1;
      const step = hold(state, away, 0, RUN, CONFIG.recenterDelaySec - 0.5);

      expect(step.yaw).toBe(away);
    });

    it('chases every frame in continuous mode, with no arm/settle latch to hitch on', () => {
      const state = createAutoCenter();
      const behind = yawBehind(0);
      // Sitting ALREADY within the settle epsilon: the latched path would report nothing to steer to (and
      // zero the swing spring on the way), which is exactly the hitch a long corner showed.
      const near = behind + CONFIG.settleEpsilon / 2;

      const latched = stepAutoCenter(createAutoCenter(), near, 0, RUN, CONFIG, DT);
      const continuous = stepAutoCenter(state, near, 0, RUN, CONFIG, DT, { continuous: true });

      expect(latched.steerTo).toBeNull();
      expect(continuous.steerTo).toBeCloseTo(behind, 12);
      expect(state.following).toBe(false); // the latch is not used at all on this path
    });
  });
});

/**
 * Directional authority (plan 080/09 §1): movement may rotate the camera only in proportion to how cleanly
 * it is AWAY from it. The latch demands near-full authority; the continuous channels fade with it; a steer
 * cut short reports `released` so the director drops the in-flight target too.
 */
describe('stepAutoCenter — directional authority (plan 080/09)', () => {
  describe('negative cases', () => {
    it('arms no swing on a sharp turn without near-full authority (the strafe case)', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      hold(state, 1.2, 0, RUN, 0.5);

      // The same heading jump that arms turn-follow at full authority (see the positive case above)...
      const step = stepAutoCenter(state, 1.2, 1.4, RUN, CONFIG, DT, { authority: 0.5 });

      expect(state.following).toBe(false);
      expect(step.steerTo).toBeNull();
    });

    it('releases an in-flight swing the moment the authority collapses', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      hold(state, 1.2, 0, RUN, 0.5);
      stepAutoCenter(state, 1.2, 1.4, RUN, CONFIG, DT, { authority: 1 }); // arms and steers
      expect(state.following).toBe(true);

      const step = stepAutoCenter(state, 1.2, 1.4, RUN, CONFIG, DT, { authority: 0.2 });

      expect(state.following).toBe(false);
      expect(step.steerTo).toBeNull();
      expect(step.released).toBe(true);
    });

    it('suppresses the continuous chase at zero authority (a reversing car) and releases', () => {
      const state = createAutoCenter();

      const step = stepAutoCenter(state, 1.2, 0, RUN, CONFIG, DT, { authority: 0, continuous: true });

      expect(step.steerTo).toBeNull();
      expect(step.released).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('scales the idle recenter rate with the authority — a diagonal drifts home slower than a walk away', () => {
      const full = createAutoCenter();
      const half = createAutoCenter();
      const start = yawBehind(0) + 0.8;
      let fullStep = { steerTo: null as null | number, yaw: start };
      let halfStep = { steerTo: null as null | number, yaw: start };
      for (let elapsed = 0; elapsed < CONFIG.recenterDelaySec + 2; elapsed += DT) {
        fullStep = stepAutoCenter(full, fullStep.yaw, 0, RUN, CONFIG, DT, { authority: 1 });
        halfStep = stepAutoCenter(half, halfStep.yaw, 0, RUN, CONFIG, DT, { authority: 0.4 });
      }
      const behind = yawBehind(0);

      expect(Math.abs(fullStep.yaw - behind)).toBeLessThan(Math.abs(halfStep.yaw - behind));
      expect(Math.abs(halfStep.yaw - behind)).toBeLessThan(0.8); // scaled, not suppressed — it still moves
    });

    it('leaves a swing already in flight alone while the authority stays high', () => {
      const state = createAutoCenter();
      settleGrace(state, 1.2);
      hold(state, 1.2, 0, RUN, 0.5);
      stepAutoCenter(state, 1.2, 1.4, RUN, CONFIG, DT, { authority: 1 });

      const step = stepAutoCenter(state, 1.2, 1.4, RUN, CONFIG, DT, { authority: 0.97 });

      expect(state.following).toBe(true);
      expect(step.steerTo).toBeCloseTo(yawBehind(1.4), 12);
    });
  });
});
