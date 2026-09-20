import { Matrix4 } from '@opensa/math';
import { addComponent, addEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';

import type { KeyboardInput } from '../input';
import type { Config } from '../interfaces/config.interface';
import type { CharacterController } from '../physics/physics-world';

import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { KeyboardSource } from '../input';
import { PhysicsWorld } from '../physics/physics-world';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem, type LookDirectionSource } from './character-controller.system';
import {
  LOCOMOTION_AIRBORNE,
  LOCOMOTION_COLLAPSE,
  LOCOMOTION_FALL,
  LOCOMOTION_GROUNDED,
  LOCOMOTION_HARD_LAND,
  LOCOMOTION_LAND,
  LOCOMOTION_LAUNCH,
  LOCOMOTION_SLIDE,
} from './locomotion';

const STEP = 1 / 60;

// A default camera looks down −Z, which maps to GTA +Y → "forward" is +Y (north).
const CAMERA: LookDirectionSource = { getWorldDirection: (target) => target.set(0, 0, -1) };

interface Player {
  controller: CharacterController;
  eid: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}

function config(gameState: Config['gameState']): Config {
  return {
    camera: {
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
      followDistance: 12,
      followHeight: 1.5,
      followLerp: 3,
      followMaxPolar: 1.5,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 40,
      followZoomMin: 6,
      footIdleDelaySec: 5,
      footIdleDistanceEase: 0.4,
      footRunDistanceGain: 0.6,
      footRunFullSpeed: 7,
      footYawAuthorityFull: 0.9,
      footYawAuthorityStart: 0.2,
      inputSmoothTime: 0.03,
      lagMaxDistance: 1.2,
      landingDipFullSpeed: 5,
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
    cleo: { enabled: false, maxScripts: 32, trace: false },
    controls: {
      back: 'KeyS',
      forward: 'KeyW',
      jump: 'Space',
      left: 'KeyA',
      right: 'KeyD',
      sprint: 'ShiftLeft',
      walk: 'AltLeft',
    },
    fog: { distance: 800, timecycScale: 1 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState,
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85, volumetric: false },
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
      moon: { brightness: 1, elevationDeg: 35, size: 150 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.5, strength: 0.35 },
        emissiveBoost: 1.6,
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 21, duskStart: 20 },
        skyGlow: 1,
        skylight: 0.6,
        windowGlow: 1,
      },
      pipeline: 'classic',
      procobj: {
        bushes: { density: 1, drawDistance: 80, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 50, enabled: true },
        grass: { density: 1, drawDistance: 50, enabled: true },
        rocks: { density: 1, drawDistance: 80, enabled: true },
        trees: { density: 1, drawDistance: 150, enabled: true },
        underwater: { density: 1, drawDistance: 60, enabled: true },
      },
      renderScale: 1,
      shadows: { distance: 800, enabled: true },
      sky: { density: 0.96, exposure: 0.5, model: 'classic', mood: 0.7, pbrExposure: 0.55, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
      toneMappingMode: 'aces',
      vehicleReflection: { intensity: 1, preset: 'enhanced' },
      water: {
        darkness: 0.55,
        foam: 1,
        glint: 1.5,
        reflection: 0.6,
        shore: true,
        shoreClarity: 0.55,
        shoreDepth: 6,
        waves: 1,
      },
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
    movement: {
      accel: 20,
      airControl: 0.3,
      collapseRecoverySeconds: 1.8,
      collapseSpeed: 16,
      coyoteSeconds: 0.12,
      deceleration: 25,
      hardLandRecoverySeconds: 0.5,
      hardLandSpeed: 12,
      jumpBufferSeconds: 0.15,
      jumpSpeed: 6,
      landRecoverySeconds: 0.15,
      launchDelaySeconds: 0.1,
      runSpeed: 26,
      slideSlopeDeg: 45,
      sprintSpeed: 39,
      turnRateFullDeg: 240,
      turnRateIdleDeg: 720,
      walkSpeed: 10,
    },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1500 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, plates: { la: '', sf: '', vegas: '' }, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
  };
}

/** A kinematic capsule resting on a static ground, plus its ECS entity. */
async function groundedPlayer(groundHalfExtent = 500): Promise<Player> {
  const physics = new PhysicsWorld(await initRapier());
  // Top at z = 0.5. The default is wide enough that the fast gaits (088/03: run 26 / sprint 39 u/s
  // over ~3 s of ramp-up) never run off the edge mid-test — airborne accel is 0.3× and starves the
  // target speed. The FSM ledge tests pass a TINY extent instead, to walk off it on purpose.
  physics.createStaticBox([0, 0, 0], [groundHalfExtent, groundHalfExtent, 0.5]);
  const controller = physics.createCharacterController();
  const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6); // rests on the ground

  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, PlayerControlled);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Velocity);
  addComponent(world, eid, Locomotion);
  RigidBody.handle[eid] = body;
  RigidBody.collider[eid] = collider;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Velocity.grounded[eid] = 0;
  Locomotion.heading[eid] = 0; // facing +Y (north), where the test camera walks W toward
  // bitECS stores are module-level and eids restart per world — zero the FSM fields or the previous
  // test's state leaks into this one.
  Locomotion.state[eid] = 0;
  Locomotion.stateTime[eid] = 0;
  Locomotion.fallSpeed[eid] = 0;
  physics.step(STEP); // build the query pipeline so the controller sees the ground

  return { controller, eid, physics, world };
}

function keys(...codes: string[]): KeyboardInput {
  const down = new Set(codes);

  return { isDown: (code) => down.has(code) };
}

function run(player: Player, cfg: Config, ...held: string[]): void {
  new CharacterControllerSystem(
    player.world,
    player.physics,
    new KeyboardSource(keys(...held), cfg.controls),
    cfg,
    player.controller,
    CAMERA,
  ).fixedUpdate(STEP);
  player.physics.step(STEP); // mirror the controller → physics step order
}

describe('CharacterControllerSystem', () => {
  describe('negative cases', () => {
    it('applies no input while paused', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 3;

      run(player, config('pause'), 'KeyW');

      expect(Velocity.x[player.eid]).toBe(3); // untouched
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('accelerates forward (+Y) toward — but not instantly to — the default run speed', async () => {
      const player = await groundedPlayer();

      run(player, config('play'), 'KeyW');

      // one step: ramping up, not yet at run speed (26), and no sideways drift
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      expect(Velocity.y[player.eid]).toBeLessThan(26);
      expect(Velocity.x[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('reaches the default run speed after sustained input (RUN is the no-modifier gait, 088/03)', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 120; i += 1) {
        run(player, config('play'), 'KeyW');
      }
      expect(Velocity.y[player.eid]).toBeCloseTo(26, 1);
      player.physics.dispose();
    });

    it('the walk modifier caps the target at walk speed', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 120; i += 1) {
        run(player, config('play'), 'KeyW', 'AltLeft');
      }
      expect(Velocity.y[player.eid]).toBeCloseTo(10, 1);
      player.physics.dispose();
    });

    it('the sprint modifier lifts the target to the sprint tier', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 160; i += 1) {
        run(player, config('play'), 'KeyW', 'ShiftLeft');
      }
      expect(Velocity.y[player.eid]).toBeCloseTo(39, 1);
      player.physics.dispose();
    });

    it('decelerates toward rest (inertia) when keys are released', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 5;
      Velocity.y[player.eid] = 5;

      run(player, config('play')); // no keys held

      // slowing toward 0 but not there in a single step
      expect(Velocity.x[player.eid]).toBeLessThan(5);
      expect(Velocity.x[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('jumps (+Z velocity) once the launch anticipation has played out', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      expect(Velocity.grounded[player.eid]).toBe(1);

      for (let i = 0; i < 8; i += 1) {
        run(player, config('play'), 'Space'); // launchDelay 0.1 s = 6 fixed steps of crouch first
      }

      expect(Velocity.z[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('fly mode lifts off on activation, then climbs on jump at 2x run speed (run animation, never falling)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const z = (): number => player.physics.readBody(handle).position[2];
      const grounded = z();
      const system = systemFor(player, keys('Space')); // Space = jump = up

      system.setFlying(true);
      player.physics.step(STEP); // apply the lift teleport
      expect(system.isFlying()).toBe(true);
      expect(z()).toBeCloseTo(grounded + 4, 1); // immediate lift-off (FLY_INITIAL_LIFT)

      const lifted = z();
      system.fixedUpdate(STEP);
      player.physics.step(STEP);
      expect(z()).toBeCloseTo(lifted + 26 * 2 * STEP, 1); // climbs at runSpeed 26 × 2
      expect(Velocity.grounded[player.eid]).toBe(1); // never the fall clip while flying
      player.physics.dispose();
    });

    it('fly mode hovers (holds its height) when no vertical key is held', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const system = systemFor(player, keys()); // nothing held

      system.setFlying(true);
      player.physics.step(STEP);
      const lifted = player.physics.readBody(handle).position[2];
      system.fixedUpdate(STEP);
      player.physics.step(STEP);

      expect(player.physics.readBody(handle).position[2]).toBeCloseTo(lifted, 2); // unchanged → hovering
      player.physics.dispose();
    });

    it('fly mode descends on Control (descend)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      const handle = RigidBody.handle[player.eid];
      const system = systemFor(player, keys('ControlLeft'));

      system.setFlying(true);
      player.physics.step(STEP);
      const lifted = player.physics.readBody(handle).position[2];
      system.fixedUpdate(STEP);
      player.physics.step(STEP);

      expect(player.physics.readBody(handle).position[2]).toBeCloseTo(lifted - 26 * 2 * STEP, 1);
      player.physics.dispose();
    });
  });
});

/** A player whose ECS Transform tracks a chosen planar position (what the scripted run steers by). */
async function placedPlayer(x: number, y: number): Promise<Player> {
  const player = await groundedPlayer();
  addComponent(player.world, player.eid, Transform);
  Transform.x[player.eid] = x;
  Transform.y[player.eid] = y;

  return player;
}

/** A controller bound to a fixed keyboard, for the tests that keep ONE system instance across steps. */
function systemFor(
  player: Player,
  keyboard: KeyboardInput,
  camera: LookDirectionSource = CAMERA,
): CharacterControllerSystem {
  const cfg = config('play');

  return new CharacterControllerSystem(
    player.world,
    player.physics,
    new KeyboardSource(keyboard, cfg.controls),
    cfg,
    player.controller,
    camera,
  );
}

describe('CharacterControllerSystem.setEnabled', () => {
  describe('negative cases', () => {
    it('a disabled controller ignores the keyboard (the player is scripted into a car)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'));

      system.setEnabled(false);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('disabling zeroes stale velocity so it cannot drive facing when control returns', async () => {
      const player = await placedPlayer(0, 0);
      Velocity.x[player.eid] = 7;
      Velocity.y[player.eid] = -4;
      Velocity.z[player.eid] = 2;
      const system = systemFor(player, keys());

      system.setEnabled(false);

      expect([Velocity.x[player.eid], Velocity.y[player.eid], Velocity.z[player.eid]]).toEqual([0, 0, 0]);
      player.physics.dispose();
    });

    it('disabling abandons a scripted path (a cutscene must not resume the old walk)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      system.runPath([[0, 20, 1.4]]);

      system.setEnabled(false);
      system.setEnabled(true);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBe(0); // no keys, no path → standing still
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('re-enabling restores manual control', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'));

      system.setEnabled(false);
      system.setEnabled(true);
      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem.runPath', () => {
  describe('negative cases', () => {
    it('an empty path counts as already arrived (manual control restored)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());

      system.runPath([]);

      expect(system.arrived).toBe(true);
      player.physics.dispose();
    });

    it('a fresh path is NOT arrived until it is walked', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());

      system.runPath([[0, 20, 1.4]]);

      expect(system.arrived).toBe(false);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('the scripted run overrides the keyboard — walking BACK still heads to the waypoint', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyS')); // holding backward the whole time
      system.runPath([[0, 20, 1.4]]);

      system.fixedUpdate(STEP);

      expect(Velocity.y[player.eid]).toBeGreaterThan(0); // toward the waypoint, not away from it
      player.physics.dispose();
    });

    it('reaching the last waypoint stops the player and flags arrival', async () => {
      const player = await placedPlayer(0, 0.3); // already inside the 0.6 m arrive radius
      const system = systemFor(player, keys());
      system.runPath([[0, 0, 1.4]]);

      system.fixedUpdate(STEP);

      expect(system.arrived).toBe(true);
      expect(Velocity.x[player.eid]).toBe(0);
      expect(Velocity.y[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('a waypoint already reached is skipped and the run continues to the next one', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      // The first point is inside the arrive radius; the second is 20 m along −Y — a 180° reversal,
      // so the heading plant (088/01) pivots in place for a few steps before the walk starts.
      system.runPath([
        [0, 0.3, 1.4],
        [0, -20, 1.4],
      ]);

      for (let i = 0; i < 15; i += 1) {
        system.fixedUpdate(STEP);
      }

      expect(system.arrived).toBe(false); // the path is not finished
      expect(Velocity.y[player.eid]).toBeLessThan(0); // pivoted and heading to the SECOND waypoint
      player.physics.dispose();
    });

    it('the default gait is RUN — the shipped enter-vehicle approach is unchanged by the gait argument', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      system.runPath([[0, 400, 1.4]]); // no gait argument: exactly how enter-vehicle calls it

      for (let i = 0; i < 180; i += 1) {
        system.fixedUpdate(STEP);
      }

      expect(Velocity.y[player.eid]).toBeCloseTo(26, 0); // config runSpeed
      player.physics.dispose();
    });

    it('a path asked for at WALK tier is followed at the walk speed (096/07)', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys());
      system.runPath([[0, 400, 1.4]], 'walk');

      for (let i = 0; i < 180; i += 1) {
        system.fixedUpdate(STEP);
      }

      expect(Velocity.y[player.eid]).toBeCloseTo(10, 0); // config walkSpeed, not runSpeed
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem camera-relative movement', () => {
  describe('negative cases', () => {
    it('a camera looking straight down picks a stable axis instead of freezing the player', async () => {
      const straightDown: LookDirectionSource = { getWorldDirection: (target) => target.set(0, -1, 0) };
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyW'), straightDown);

      system.fixedUpdate(STEP);

      // The projected forward is degenerate, so the fallback +Y axis carries the move.
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      expect(Number.isFinite(Velocity.x[player.eid])).toBe(true);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('strafing right is perpendicular to the camera forward', async () => {
      const player = await placedPlayer(0, 0);
      const system = systemFor(player, keys('KeyD')); // camera forward = GTA +Y → right = +X

      system.fixedUpdate(STEP);

      expect(Velocity.x[player.eid]).toBeGreaterThan(0);
      expect(Velocity.y[player.eid]).toBeCloseTo(0, 6);
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem heading (plan 088/01)', () => {
  describe('negative cases', () => {
    it('standing still holds the heading (no input never turns the model)', async () => {
      const player = await groundedPlayer();
      Locomotion.heading[player.eid] = 1;

      run(player, config('play')); // no keys

      expect(Locomotion.heading[player.eid]).toBe(1);
      player.physics.dispose();
    });

    it('a reversal holds the old heading while the speed is still high (plant, not pirouette)', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0; // facing +Y
      Velocity.y[player.eid] = 10; // at walk speed

      run(player, config('play'), 'KeyS'); // intent = −Y, 180° behind

      expect(Locomotion.heading[player.eid]).toBe(0); // facing held
      // and the plant DECELERATES on the old heading instead of accelerating backward
      expect(Velocity.y[player.eid]).toBeLessThan(10);
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('turns toward the intent at the rate — not instantly', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0;

      run(player, config('play'), 'KeyD'); // strafe right → intent yaw −π/2, only 90° away

      // One step at the near-idle rate (720°/s) turns 12°, nowhere near the full quarter.
      expect(Locomotion.heading[player.eid]).toBeCloseTo(-(720 / 60) * (Math.PI / 180), 2);
      expect(Locomotion.heading[player.eid]).toBeGreaterThan(-Math.PI / 2);
      player.physics.dispose();
    });

    it('settles on the intent after sustained input', async () => {
      const player = await groundedPlayer();
      Locomotion.heading[player.eid] = 0;
      for (let i = 0; i < 90; i += 1) {
        run(player, config('play'), 'KeyD');
      }
      expect(Locomotion.heading[player.eid]).toBeCloseTo(-Math.PI / 2, 2);
      expect(Velocity.x[player.eid]).toBeCloseTo(26, 1); // strafe carries at the default run speed
      player.physics.dispose();
    });

    it('a reversal about-faces once the plant has bled the speed off', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      Locomotion.heading[player.eid] = 0;
      Velocity.y[player.eid] = 10;

      for (let i = 0; i < 200; i += 1) {
        run(player, config('play'), 'KeyS');
      }

      expect(Math.abs(Locomotion.heading[player.eid])).toBeCloseTo(Math.PI, 2); // faced about
      expect(Velocity.y[player.eid]).toBeCloseTo(-26, 1); // and running the other way
      player.physics.dispose();
    });

    it('fly mode turns instantly from its velocity (debug mode skips the rate)', async () => {
      const player = await groundedPlayer();
      addComponent(player.world, player.eid, Transform);
      Locomotion.heading[player.eid] = 2;
      const system = systemFor(player, keys('KeyW')); // fly forward = +Y → yaw 0

      system.setFlying(true);
      player.physics.step(STEP);
      system.fixedUpdate(STEP);

      expect(Locomotion.heading[player.eid]).toBeCloseTo(0, 6);
      player.physics.dispose();
    });
  });
});

/** A persistent system whose held keys can CHANGE mid-test — jump-edge detection needs one instance. */
function liveSystem(player: Player): { down: Set<string>; step: () => void } {
  const down = new Set<string>();
  const cfg = config('play');
  const system = new CharacterControllerSystem(
    player.world,
    player.physics,
    new KeyboardSource({ isDown: (code): boolean => down.has(code) }, cfg.controls),
    cfg,
    player.controller,
    CAMERA,
  );
  const step = (): void => {
    system.fixedUpdate(STEP);
    player.physics.step(STEP);
  };

  return { down, step };
}

/** Step until the player is grounded (a fall test's touchdown), with a hard safety cap. */
function stepUntilGrounded(player: Player, step: () => void, cap = 400): void {
  for (let i = 0; i < cap && Velocity.grounded[player.eid] !== 1; i += 1) {
    step();
  }
  expect(Velocity.grounded[player.eid]).toBe(1);
}

describe('CharacterControllerSystem jump & fall FSM (plan 088/04)', () => {
  describe('negative cases', () => {
    it('never double-jumps mid-air — a second press while airborne does not relaunch', async () => {
      const player = await groundedPlayer();
      const { down, step } = liveSystem(player);
      step();
      down.add('Space');
      for (let i = 0; i < 10 && Velocity.z[player.eid] <= 0; i += 1) {
        step();
      }
      expect(Velocity.z[player.eid]).toBeGreaterThan(0); // airborne, rising

      down.delete('Space');
      step();
      down.add('Space'); // a fresh press mid-air
      const rising = Velocity.z[player.eid];
      step();
      step();

      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_AIRBORNE); // not re-launched
      expect(Velocity.z[player.eid]).toBeLessThan(rising); // still on the same ballistic arc
      player.physics.dispose();
    });

    it('a press early in a COLLAPSE recovery expires unfired (no bounce out of a knockdown)', async () => {
      const player = await groundedPlayer();
      const { down, step } = liveSystem(player);
      player.physics.teleport(RigidBody.handle[player.eid], [0, 0, 17]); // impact ≈ 17.5 > collapseSpeed 16
      player.physics.step(STEP); // commit the kinematic teleport BEFORE the first controller move
      stepUntilGrounded(player, step);
      step(); // the FSM sees the touchdown → COLLAPSE
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_COLLAPSE);

      down.add('Space'); // pressed at recovery start; the 0.15 s buffer dies inside the 1.8 s recovery
      let vzMax = -Infinity;
      for (let i = 0; i < 130; i += 1) {
        step();
        vzMax = Math.max(vzMax, Velocity.z[player.eid]);
      }

      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_GROUNDED); // recovery over…
      expect(vzMax).toBeLessThanOrEqual(0); // …and the stale press never fired
      player.physics.dispose();
    });

    it('an expired coyote window refuses the mid-air jump (state FALL keeps falling)', async () => {
      const player = await groundedPlayer(1); // a 1 m ledge to walk off
      const { down, step } = liveSystem(player);
      step();
      step(); // settle → grounded
      down.add('KeyW');
      for (let i = 0; i < 100 && Velocity.grounded[player.eid] === 1; i += 1) {
        step();
      }
      expect(Velocity.grounded[player.eid]).toBe(0); // off the edge
      for (let i = 0; i < 10; i += 1) {
        step(); // 0.16 s airborne > coyote 0.12 s
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_FALL);

      down.add('Space');
      for (let i = 0; i < 8; i += 1) {
        step();
      }

      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_FALL); // no launch
      expect(Velocity.z[player.eid]).toBeLessThan(0); // still falling
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('the launch anticipation delays the impulse: crouch first, leave the ground after launchDelay', async () => {
      const player = await groundedPlayer();
      const { down, step } = liveSystem(player);
      step(); // settle → grounded

      down.add('Space');
      step();
      step();
      step();
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_LAUNCH); // crouching, no lift yet
      expect(Velocity.z[player.eid]).toBeLessThanOrEqual(0);

      for (let i = 0; i < 6; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_AIRBORNE);
      expect(Velocity.z[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('the coyote window honours a press just after walking off a ledge', async () => {
      const player = await groundedPlayer(1);
      const { down, step } = liveSystem(player);
      step();
      step(); // settle → grounded
      down.add('KeyW');
      for (let i = 0; i < 100 && Velocity.grounded[player.eid] === 1; i += 1) {
        step();
      }
      expect(Velocity.grounded[player.eid]).toBe(0);

      step(); // 2 steps airborne ≈ 0.03 s — well inside the 0.12 s window
      down.add('Space');
      let vzMax = -Infinity;
      for (let i = 0; i < 12; i += 1) {
        step();
        vzMax = Math.max(vzMax, Velocity.z[player.eid]);
      }

      expect(vzMax).toBeGreaterThan(0); // the jump fired mid-air
      player.physics.dispose();
    });

    it('a buffered press fires exactly once, on the landing frame', async () => {
      const player = await groundedPlayer();
      const { down, step } = liveSystem(player);
      step();
      down.add('Space');
      for (let i = 0; i < 10 && Velocity.z[player.eid] <= 0; i += 1) {
        step();
      }
      down.delete('Space');
      // Descend; press again just before touchdown (impact will be ≈ jumpSpeed 6 → inside the buffer).
      for (let i = 0; i < 200 && Velocity.z[player.eid] > -5; i += 1) {
        step();
      }
      down.add('Space');
      stepUntilGrounded(player, step);
      step(); // touchdown frame: buffered press bypasses LAND straight into LAUNCH
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_LAUNCH);

      let vzMax = -Infinity;
      for (let i = 0; i < 10; i += 1) {
        step();
        vzMax = Math.max(vzMax, Velocity.z[player.eid]);
      }
      expect(vzMax).toBeGreaterThan(0); // the second flight happened…

      for (let i = 0; i < 200 && Velocity.z[player.eid] > -5; i += 1) {
        step(); // …and with the key still held (no new edge) the NEXT landing recovers normally
      }
      stepUntilGrounded(player, step);
      step();
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_LAND);
      player.physics.dispose();
    });

    it('a soft landing takes the quick recovery, then control returns', async () => {
      const player = await groundedPlayer();
      const { down, step } = liveSystem(player);
      step();
      down.add('Space');
      for (let i = 0; i < 10 && Velocity.z[player.eid] <= 0; i += 1) {
        step();
      }
      down.delete('Space');
      for (let i = 0; i < 200 && Velocity.z[player.eid] > -1; i += 1) {
        step(); // ride past the apex first — the post-launch snap frame can flash grounded while rising
      }
      stepUntilGrounded(player, step);
      step(); // FSM sees the touchdown
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_LAND); // jumpSpeed-6 impact is under the hard tier

      for (let i = 0; i < 12; i += 1) {
        step(); // landRecoverySeconds 0.15 = 9 steps
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_GROUNDED);
      player.physics.dispose();
    });

    it('a mid-tier impact takes the HARD_LAND crouch and its 0.5 s recovery (088/07)', async () => {
      const player = await groundedPlayer();
      const { step } = liveSystem(player);
      player.physics.teleport(RigidBody.handle[player.eid], [0, 0, 10]); // impact ≈ 13 ∈ (12, 16)
      player.physics.step(STEP); // commit the kinematic teleport BEFORE the first controller move
      stepUntilGrounded(player, step);
      step();

      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_HARD_LAND);
      expect(Locomotion.fallSpeed[player.eid]).toBeGreaterThan(12);
      expect(Locomotion.fallSpeed[player.eid]).toBeLessThan(16);

      for (let i = 0; i < 12; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_HARD_LAND); // still crouched past the soft window

      for (let i = 0; i < 25; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_GROUNDED); // 0.5 s served
      player.physics.dispose();
    });

    it('a severe impact COLLAPSES (fallSpeed recorded) and takes the long stand-back-up recovery', async () => {
      const player = await groundedPlayer();
      const { step } = liveSystem(player);
      player.physics.teleport(RigidBody.handle[player.eid], [0, 0, 17]); // impact ≈ 17.5 > 16
      player.physics.step(STEP);
      stepUntilGrounded(player, step);
      step();

      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_COLLAPSE);
      expect(Locomotion.fallSpeed[player.eid]).toBeGreaterThan(16);

      for (let i = 0; i < 40; i += 1) {
        step(); // 0.67 s — a HARD_LAND would have recovered by now
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_COLLAPSE);

      for (let i = 0; i < 80; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_GROUNDED); // 1.8 s served
      player.physics.dispose();
    });
  });
});

describe('CharacterControllerSystem slope slide (plan 088/08)', () => {
  /** A 48° ramp (steeper than slideSlopeDeg 45, shallower than the 50° climb limit), as a trimesh. */
  async function rampPlayer(): Promise<Player> {
    const player = await groundedPlayer(2); // a small flat pad far from the ramp
    const rise = Math.tan((48 * Math.PI) / 180);
    // A wide inclined quad through x∈[-20,20], y∈[6,26], z = (y − 6)·tan(48°) + 0.5.
    const vertices = new Float32Array([-20, 6, 0.5, 20, 6, 0.5, 20, 26, 20 * rise + 0.5, -20, 26, 20 * rise + 0.5]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    player.physics.createStaticColliders([
      { name: 'ramp', shape: { boxes: [], indices, spheres: [], vertices }, transforms: [new Matrix4()] },
    ]);
    player.physics.step(STEP); // rebuild the query pipeline with the ramp in it

    return player;
  }

  describe('negative cases', () => {
    it('flat ground never slides', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 30; i += 1) {
        run(player, config('play'), 'KeyW');
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_GROUNDED);
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it("a 48° slope enters SLIDE and actually accelerates DOWNHILL (the push is ours, not Rapier's)", async () => {
      const player = await rampPlayer();
      const { step } = liveSystem(player);
      // Drop onto the ramp surface: y = 12 → surface z ≈ 6.66 + 0.5; capsule centre ~1 above.
      player.physics.teleport(RigidBody.handle[player.eid], [0, 12, (12 - 6) * Math.tan((48 * Math.PI) / 180) + 2]);
      player.physics.step(STEP);
      for (let i = 0; i < 60 && Locomotion.state[player.eid] !== LOCOMOTION_SLIDE; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_SLIDE);

      for (let i = 0; i < 60; i += 1) {
        step();
      }
      expect(Velocity.y[player.eid]).toBeLessThan(-2); // gathering speed toward −y (downhill)
      player.physics.dispose();
    });

    it('refuses the jump while sliding (no jump-laddering up a steep hillside)', async () => {
      const player = await rampPlayer();
      const { down, step } = liveSystem(player);
      player.physics.teleport(RigidBody.handle[player.eid], [0, 12, (12 - 6) * Math.tan((48 * Math.PI) / 180) + 2]);
      player.physics.step(STEP);
      for (let i = 0; i < 60 && Locomotion.state[player.eid] !== LOCOMOTION_SLIDE; i += 1) {
        step();
      }
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_SLIDE);

      down.add('Space');
      let vzMax = -Infinity;
      for (let i = 0; i < 20; i += 1) {
        step();
        vzMax = Math.max(vzMax, Velocity.z[player.eid]);
      }
      expect(vzMax).toBeLessThanOrEqual(0); // the press never launched
      player.physics.dispose();
    });
  });
});

/**
 * A WARP is a discontinuity: the body is put somewhere else by something that is not this controller
 * (the debugger teleport, a bench leg's anchor, a respawn). Whatever the fall before it had accumulated
 * belongs to the place the player LEFT — carrying it across is how one bench scene's lost collision race
 * put the player under the mesh at terminal velocity for every scene after it (plan 102).
 *
 * The velocity only self-heals when the warp lands ON ground (`moveOnFoot` zeroes it on contact); these
 * cases warp into the air, which is exactly what a teleport into a cell whose colliders are still building
 * looks like.
 */
describe('CharacterControllerSystem warped body', () => {
  describe('negative cases', () => {
    it('does not carry a fall’s velocity across a warp into the air', async () => {
      const player = await groundedPlayer();
      const { step } = liveSystem(player);
      const handle = RigidBody.handle[player.eid];
      player.physics.teleport(handle, [0, 0, 200]); // off the ground entirely → free fall
      for (let i = 0; i < 120; i += 1) {
        step();
      }
      expect(Velocity.z[player.eid]).toBeLessThan(-15); // the fall really accumulated (2 s of gravity)
      expect(Locomotion.state[player.eid]).toBe(LOCOMOTION_FALL);

      player.physics.teleport(handle, [0, 0, 400]); // a genuine warp, still with no ground under it
      step();

      // Only THIS step's gravity may survive the warp — not the 20 m/s the previous place had built up.
      expect(Velocity.z[player.eid]).toBeGreaterThan(-1);
      player.physics.dispose();
    });

    it('does not carry the land-tier impact speed across a warp (no phantom collapse on arrival)', async () => {
      const player = await groundedPlayer();
      const { step } = liveSystem(player);
      const handle = RigidBody.handle[player.eid];
      player.physics.teleport(handle, [0, 0, 200]);
      for (let i = 0; i < 120; i += 1) {
        step();
      }

      player.physics.teleport(handle, [0, 0, 1.4]); // warped back onto the ground, at rest
      stepUntilGrounded(player, step); // the warped collider takes a frame to be where the body is
      step(); // the frame the FSM picks the landing tier on

      expect(Velocity.grounded[player.eid]).toBe(1);
      expect(Locomotion.state[player.eid]).not.toBe(LOCOMOTION_COLLAPSE);
      expect(Locomotion.state[player.eid]).not.toBe(LOCOMOTION_HARD_LAND);
      player.physics.dispose();
    });
  });
});
