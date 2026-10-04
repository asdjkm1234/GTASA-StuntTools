import { describe, expect, it, type Mock, vi } from 'vitest';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { CollisionStreamingSystem } from './collision-streaming.system';

/** A one-instance breakable model whose world matrix stands at `at` (column-major, translation at 12..14). */
function breakableProp(key: string, at: readonly [number, number, number]): ModelColliders {
  const elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1];

  return { ...modelColliders(key), instanceKeys: [key], transforms: [{ elements }] as ModelColliders['transforms'] };
}

function config(collisionDrawDistance: number): Config {
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
    gameState: 'play',
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
    streaming: { cellSize: 250, collisionDrawDistance, hdDrawDistance: 300, lodDrawDistance: 1500 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, plates: { la: '', sf: '', vegas: '' }, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
  };
}

function modelColliders(name: string): ModelColliders {
  return {
    name,
    shape: { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array() },
    transforms: [],
  };
}

function stubAdapter(): {
  cellSize: number;
  loadCellColliders: Mock<(cx: number, cy: number) => Promise<ModelColliders[]>>;
} {
  return {
    cellSize: 250,
    loadCellColliders: vi.fn(
      (cx: number, cy: number): Promise<ModelColliders[]> => Promise.resolve([modelColliders(`${cx},${cy}`)]),
    ),
  };
}

/**
 * The physics seam the streamer drives (plan 200/3-02): a build that yields after `perStep` placements, so a
 * test can watch a cell land over several frames. `perStep: Infinity` (the default) completes in one drain,
 * which is what every pre-existing test expects.
 */
function stubPhysics(perStep = Infinity): {
  beginStaticColliders: Mock<
    (
      models: readonly ModelColliders[],
      onBreakable?: (key: string, handle: number) => void,
    ) => { handles: number[]; step(budgetMs: number): boolean }
  >;
  removeBodies: Mock<(handles: readonly number[]) => void>;
} {
  let nextHandle = 0;

  return {
    beginStaticColliders: vi.fn(
      (models: readonly ModelColliders[], onBreakable?: (key: string, handle: number) => void) => {
        const handles: number[] = [];
        let index = 0;

        return {
          handles,
          step(): boolean {
            let made = 0;
            while (index < models.length && made < perStep) {
              const model = models[index];
              const handle = nextHandle++;
              handles.push(handle);
              for (const key of model.instanceKeys ?? []) {
                onBreakable?.(key, handle);
              }
              index += 1;
              made += 1;
            }

            return index >= models.length;
          },
        };
      },
    ),
    removeBodies: vi.fn<(handles: readonly number[]) => void>(),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One full streaming round: desire the cells, let the adapter's promise resolve, then drain the builds.
 *
 * The second `update` is the point of plan 200/3-02 — a cell's bodies are created a slice at a time under a
 * frame budget, so a cell is NOT loaded the instant its colliders arrive. It becomes loaded when its build
 * finishes, which is what keeps a car from spawning where only half the ground exists.
 */
async function stream(system: CollisionStreamingSystem): Promise<void> {
  system.update();
  await flush();
  system.update();
}

describe('CollisionStreamingSystem', () => {
  describe('negative cases', () => {
    it('is not settled before the first update or while colliders are loading (plan 061)', async () => {
      const adapter = stubAdapter();
      const system = new CollisionStreamingSystem(adapter, stubPhysics(), () => [0, 0, 0] as Vec3, config(100));
      expect(system.settled()).toBe(false); // no update ran yet

      system.update(); // requested, unresolved
      expect(system.settled()).toBe(false);
      await flush();
      // Colliders have ARRIVED but no body exists yet — the build is queued, not drained (200/3-02).
      expect(system.settled()).toBe(false);
      system.update();
      expect(system.settled()).toBe(true); // all desired cells built
    });

    it('removeBreakable is a no-op for an unknown key', () => {
      const system = new CollisionStreamingSystem(stubAdapter(), stubPhysics(), () => [0, 0, 0] as Vec3, config(100));
      expect(system.removeBreakable('nope')).toBe(false);
    });

    it('breakableKeyOf returns undefined for a null or unknown body handle', () => {
      const system = new CollisionStreamingSystem(stubAdapter(), stubPhysics(), () => [0, 0, 0] as Vec3, config(100));
      expect(system.breakableKeyOf(null)).toBeUndefined();
      expect(system.breakableKeyOf(999)).toBeUndefined();
    });

    it('nearestBreakable finds nothing when no prop is loaded, or none is inside the radius', async () => {
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation(() => Promise.resolve([breakableProp('bin@0', [125, 125, 0])]));
      const system = new CollisionStreamingSystem(adapter, stubPhysics(), () => [125, 125, 0] as Vec3, config(100));
      expect(system.nearestBreakable([125, 125, 0], 8)).toBeUndefined(); // nothing streamed yet

      await stream(system);

      expect(system.nearestBreakable([125, 125, 40], 8)).toBeUndefined(); // 40 m above it — out of range
    });
  });

  describe('positive cases', () => {
    it('nearestBreakable returns the closest loaded prop within the radius', async () => {
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation(() =>
        Promise.resolve([breakableProp('far@0', [130, 125, 0]), breakableProp('near@0', [126, 125, 0])]),
      );
      const system = new CollisionStreamingSystem(adapter, stubPhysics(), () => [125, 125, 0] as Vec3, config(100));

      await stream(system);

      expect(system.nearestBreakable([125, 125, 0], 8)).toBe('near@0');
      expect(system.nearestBreakable([131, 125, 0], 8)).toBe('far@0'); // nearest is relative to the caller
    });

    it('drops a smashed breakable body without disturbing the rest of the cell', async () => {
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation((cx, cy) =>
        Promise.resolve([{ ...modelColliders(`${cx},${cy}`), instanceKeys: ['bin@0'] }]),
      );
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      await stream(system);

      expect(system.breakableKeyOf(0)).toBe('bin@0'); // contact-force impact resolves the prop
      expect(system.removeBreakable('bin@0')).toBe(true);
      expect(physics.removeBodies).toHaveBeenCalledWith([0]); // only the prop's body
      expect(system.breakableKeyOf(0)).toBeUndefined(); // reverse lookup cleared
      expect(system.removeBreakable('bin@0')).toBe(false); // already gone
    });

    it('creates static colliders for cells within the radius', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      await stream(system);

      expect(adapter.loadCellColliders).toHaveBeenCalledWith(0, 0);
      expect(physics.beginStaticColliders).toHaveBeenCalledTimes(1);
    });

    it('removes a cell’s bodies when the view leaves it and loads the new cell', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      let view: Vec3 = [125, 125, 0];
      const system = new CollisionStreamingSystem(adapter, physics, () => view, config(100));

      await stream(system);

      view = [100125, 100125, 0]; // a far cell (400, 400)
      await stream(system);

      expect(physics.removeBodies).toHaveBeenCalledWith([0]); // the old cell's handles freed
      expect(adapter.loadCellColliders).toHaveBeenCalledWith(400, 400);
    });

    it('BUDGETS a cell over several frames, and does not call it loaded until it is whole', async () => {
      // The point of 200/3-02: a cell measured 5.6-28.1 ms built in one go (plan 091). Announcing it early
      // would let a car spawn where only half the ground exists, so `settled` stays false until the last
      // body is in the world.
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation((cx, cy) =>
        Promise.resolve([modelColliders(`${cx},${cy}`), modelColliders(`${cx},${cy}`), modelColliders(`${cx},${cy}`)]),
      );
      const physics = stubPhysics(1); // one placement per drain
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      system.update();
      await flush();
      system.update(); // 1 of 3
      expect(system.settled()).toBe(false);
      system.update(); // 2 of 3
      expect(system.settled()).toBe(false);
      system.update(); // 3 of 3 — whole
      expect(system.settled()).toBe(true);
      expect(physics.beginStaticColliders).toHaveBeenCalledTimes(1); // one build, not one per frame
    });

    it('leaves nothing behind when a cell is abandoned mid-build', async () => {
      // A partially built cell that is never cleaned up is bodies in the world with no owner — invisible
      // until something collides with a wall that is no longer streamed.
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation((cx, cy) =>
        Promise.resolve([modelColliders(`${cx},${cy}`), modelColliders(`${cx},${cy}`)]),
      );
      const physics = stubPhysics(1);
      let view: Vec3 = [125, 125, 0];
      const system = new CollisionStreamingSystem(adapter, physics, () => view, config(100));

      system.update();
      await flush();
      system.update(); // one body exists, the build is half done

      view = [100125, 100125, 0]; // walk away before it finishes
      system.update();

      expect(physics.removeBodies).toHaveBeenCalledWith([0]); // exactly what the build had created
      expect(system.settled()).toBe(false);
    });

    it('reload drops every loaded cell and re-streams it on the next update', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      await stream(system);
      expect(adapter.loadCellColliders).toHaveBeenCalledTimes(1);

      system.reload(); // clutter knobs changed — physics must match the new rendered set
      expect(physics.removeBodies).toHaveBeenCalledWith([0]);

      await stream(system);
      expect(adapter.loadCellColliders).toHaveBeenCalledTimes(2); // same cell rebuilt
    });
  });
});
