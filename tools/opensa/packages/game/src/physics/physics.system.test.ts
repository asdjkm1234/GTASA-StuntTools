import { addComponent, addEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';

import type { Config } from '../interfaces/config.interface';

import { RigidBody, Transform } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { PhysicsWorld } from './physics-world';
import { PhysicsSystem } from './physics.system';
import { initRapier } from './rapier';

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
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
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

async function fallingEntity(): Promise<{
  eid: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}> {
  const physics = new PhysicsWorld(await initRapier());
  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, Transform);
  addComponent(world, eid, RigidBody);
  RigidBody.handle[eid] = physics.createBox([0, 0, 10], [0.5, 0.5, 0.5]); // falling, no ground
  Transform.z[eid] = 10;

  return { eid, physics, world };
}

describe('PhysicsSystem', () => {
  describe('negative cases', () => {
    it('does not step or write transforms while paused', async () => {
      const { eid, physics, world } = await fallingEntity();

      new PhysicsSystem(world, physics, config('pause')).fixedUpdate(1 / 60);

      expect(Transform.z[eid]).toBe(10); // unchanged
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('writes each rigid body transform onto its entity Transform while playing', async () => {
      const { eid, physics, world } = await fallingEntity();

      new PhysicsSystem(world, physics, config('play')).fixedUpdate(1 / 60);

      expect(Transform.x[eid]).toBe(0);
      expect(Transform.y[eid]).toBe(0);
      expect(Transform.z[eid]).toBeLessThan(10); // gravity pulled it down
      expect(Transform.qw[eid]).toBeCloseTo(1); // unrotated
      physics.dispose();
    });
  });
});
