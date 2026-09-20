import type { DynamicParticleLibrary, Engine, ParticleUpload } from '@opensa/engine';
import type { AssetFileSystem, FxBakedEmitter } from '@opensa/renderware';

import { parseFxp } from '@opensa/renderware';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { fxDrawDistance, setupEngineParticles, toEngineSpace } from './engine-particles';

/** A fountain: SA authors "up" as +Z, and buoyant force the same way. */
function fountain(): FxBakedEmitter {
  return {
    additive: false,
    colors: [
      [1, 1, 1, 1],
      [1, 1, 1, 0.5],
      [1, 1, 1, 0],
    ],
    cone: { angle: 0.2, direction: [0, 0, 1] },
    force: [0, 0, -9.81],
    life: { bias: 0, seconds: 2 },
    perEmitter: 8,
    rate: 4,
    sizes: [0.2, 0.4, 0.6],
    speed: { bias: 0, magnitude: 5 },
    texture: 'wjet2',
  };
}

describe('engine particles', () => {
  describe('negative cases', () => {
    it('does not touch anything but the direction and the force', () => {
      const source = fountain();

      const converted = toEngineSpace(source);

      expect(converted.sizes).toEqual(source.sizes);
      expect(converted.colors).toEqual(source.colors);
      expect(converted.speed).toEqual(source.speed);
      expect(converted.cone.angle).toBe(source.cone.angle);
    });
  });

  describe('positive cases', () => {
    it('sprays UP in engine space: the FX tracks are GTA Z-up, the engine is Y-up', () => {
      // The converter already puts the emitter POSITIONS through e = (x, z, −y). Leave the direction and the
      // force behind and a fountain sprays sideways along the ground — which is exactly what it did.
      const converted = toEngineSpace(fountain());

      expect(converted.cone.direction).toEqual([0, 1, -0]); // +Z (GTA up) → +Y (engine up)
      expect(converted.force[1]).toBeCloseTo(-9.81); // gravity still pulls DOWN
    });
  });
});

// The synthetic half above pins the basis change; only the REAL library proves the dynamic lane's boot-time
// list resolves against what SA actually ships (system names, textures, the tint/size overrides).
const EFFECTS_FXP = 'fixtures/original/models/effects.fxp';
const EFFECTS_TXD = 'fixtures/original/models/effectsPC.txd';
/** A host LOD radius unlike any authored cullDist, so "drawn as far as the world" cannot pass by accident. */
const WORLD_DRAW_DISTANCE = 1500;

interface RecordedSpawn {
  alpha: number;
  life: number;
  system: number;
}

/** A recording Engine stand-in: the calls setupEngineParticles makes for the dynamic lane, plus the empty
 *  cell set `rebuild` walks (no streamed cells, so the PLACED lane uploads nothing). */
function fakeEngine(): {
  engine: Engine;
  library: () => DynamicParticleLibrary | null;
  spawns: RecordedSpawn[];
  uploads: ParticleUpload[];
} {
  let library: DynamicParticleLibrary | null = null;
  const spawns: RecordedSpawn[] = [];
  const uploads: ParticleUpload[] = [];
  const engine = {
    cells: { all: (): [] => [] },
    initDynamicParticles: (upload: DynamicParticleLibrary): void => {
      library = upload;
    },
    setParticles: (upload: ParticleUpload): void => {
      uploads.push(upload);
    },
    spawnParticle: (
      system: number,
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
      life: number,
      alpha = 1,
    ): boolean => {
      spawns.push({ alpha, life, system });

      return true;
    },
  } as unknown as Engine;

  return { engine, library: () => library, spawns, uploads };
}

/** The two fixture files behind the AssetFileSystem surface setupEngineParticles reads. */
function fixtureFs(): AssetFileSystem {
  const files = new Map<string, Buffer>([
    ['models/effects.fxp', readFileSync(EFFECTS_FXP)],
    ['models/effectspc.txd', readFileSync(EFFECTS_TXD)],
  ]);

  return {
    get: (name: string): ArrayBuffer | null => {
      const file = files.get(name.toLowerCase());
      if (!file) {
        return null;
      }
      const copy = new ArrayBuffer(file.byteLength);
      new Uint8Array(copy).set(file);

      return copy;
    },
    getText: (name: string): null | string => files.get(name.toLowerCase())?.toString('utf8') ?? null,
  } as unknown as AssetFileSystem;
}

describe.skipIf(!existsSync(EFFECTS_FXP) || !existsSync(EFFECTS_TXD))('dynamic lane library (real fixtures)', () => {
  describe('negative cases', () => {
    it('returns null for a system outside the boot-time list', () => {
      const { engine } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE);

      expect(particles?.createEmitter('prt_blood')).toBeNull();
    });

    it('ships no lane at all when the profile has no FX library', () => {
      const { engine, library } = fakeEngine();
      const empty = { get: (): null => null, getText: (): null => null } as unknown as AssetFileSystem;

      expect(setupEngineParticles(engine, empty, WORLD_DRAW_DISTANCE)).toBeNull();
      expect(library()).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('every boot-time system resolves against the real library, aliases included', () => {
      const { engine } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE);

      for (const name of [
        'prt_collisionsmoke',
        'prt_smokeII_3_expand', // createEmitter lowercases — the caller may use SA's own casing
        'wheeldirt-dust',
        'wheeldirt-grass',
        'wheeldirt-mud',
        'prt_sand',
      ]) {
        expect(particles?.createEmitter(name), name).not.toBeNull();
      }
    });

    it('a burst spawns count particles with the emitter look applied', () => {
      const { engine, spawns } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE);
      const emitter = particles!.createEmitter('wheeldirt-grass')!;
      emitter.lifeScale = 0.5;
      emitter.alphaScale = 0.25;

      emitter.burst(3);

      expect(spawns.length).toBe(3); // prt_wheeldirt is a single-layer system
      for (const spawn of spawns) {
        expect(spawn.alpha).toBe(0.25);
        expect(spawn.life).toBeGreaterThan(0);
        expect(spawn.life).toBeLessThan(5); // authored 5 s × 0.5, ± the authored bias
      }
    });

    it('the grass alias carries its earthy tint and prt_sand its size cut in the baked records', () => {
      const { engine, library, spawns } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE);

      particles!.createEmitter('wheeldirt-grass')!.burst(1);
      const grassIndex = spawns[0].system;
      particles!.createEmitter('prt_sand')!.burst(1);
      const sandIndex = spawns[1].system;

      const systems = library()!.systems;
      // prt_wheeldirt is authored pure white, so the record's age-0 rgb IS the tint.
      expect(systems[grassIndex * 20 + 8]).toBeCloseTo(0.45, 3);
      expect(systems[grassIndex * 20 + 9]).toBeCloseTo(0.5, 3);
      expect(systems[grassIndex * 20 + 10]).toBeCloseTo(0.3, 3);
      // prt_sand's authored size-at-0 is 8 m (a bullet plume); the lane cuts it 0.35×.
      expect(systems[sandIndex * 20 + 4]).toBeCloseTo(8 * 0.35, 3);
    });
  });
});

describe.skipIf(!existsSync(EFFECTS_FXP))('fx draw distance (real effects.fxp)', () => {
  const systems = parseFxp(readFileSync(EFFECTS_FXP).toString('latin1'));
  const distanceOf = (name: string): number => fxDrawDistance(systems.get(name)!, WORLD_DRAW_DISTANCE);

  describe('negative cases', () => {
    it('does not apply a departure to a system that is not in the table', () => {
      // The whole point of the step: the fxp wins everywhere except the two recorded places. These four are
      // the ones the flat 300 stretched hardest — a vent used to be drawn 12× further than SA drew it.
      expect(distanceOf('vent')).toBe(25);
      expect(distanceOf('vent2')).toBe(25);
      expect(distanceOf('fire')).toBe(35);
      expect(distanceOf('carwashspray')).toBe(70);
    });

    it('falls back for a system that authors no cullDist at all', () => {
      expect(fxDrawDistance({ boundingSphere: [0, 0, 0, 0], cullDist: 0, emitters: [], name: 'modded' }, 1500)).toBe(
        300,
      );
    });

    it('leaves every system where it was at scale 1 — the knob is a multiplier, not a replacement', () => {
      for (const name of ['vent', 'fire', 'insects', 'ws_factorysmoke']) {
        expect(fxDrawDistance(systems.get(name)!, WORLD_DRAW_DISTANCE, { scale: 1 }), name).toBe(distanceOf(name));
      }
    });

    it('does not give a PLACED system the dynamic lane floor', () => {
      // The floor is the calling lane's, not a property of the system — a vent stays at its authored 25.
      expect(distanceOf('vent')).toBe(25);
    });
  });

  describe('positive cases', () => {
    it('draws every smoke system as far as the world is drawn, not the authored 150-255', () => {
      for (const name of ['ws_factorysmoke', 'smoke30m', 'smoke30lit', 'smoke50lit']) {
        expect(systems.get(name)!.cullDist, name).toBeLessThan(WORLD_DRAW_DISTANCE); // the departure is real
        expect(distanceOf(name), name).toBe(WORLD_DRAW_DISTANCE);
      }
    });

    it('floors the two tiny systems at 100 rather than their authored 15', () => {
      expect(systems.get('insects')!.cullDist).toBe(15);
      expect(distanceOf('insects')).toBe(100);
      expect(distanceOf('cigarette_smoke')).toBe(100);
    });

    it('scales every distance by the live knob, floors and departures included', () => {
      expect(fxDrawDistance(systems.get('vent')!, WORLD_DRAW_DISTANCE, { scale: 2 })).toBe(50); // authored 25
      expect(fxDrawDistance(systems.get('insects')!, WORLD_DRAW_DISTANCE, { scale: 0.5 })).toBe(50); // floored 100
      expect(fxDrawDistance(systems.get('smoke30m')!, WORLD_DRAW_DISTANCE, { scale: 0.5 })).toBe(
        WORLD_DRAW_DISTANCE / 2,
      );
      // The lane floor is applied BEFORE the scale, so the knob can still pull the dynamic lane back in.
      expect(fxDrawDistance(systems.get('prt_sand')!, WORLD_DRAW_DISTANCE, { floor: 300, scale: 0.5 })).toBe(150);
    });

    it('gives the dynamic lane its 300 u floor, not the 50 every prt_* system authors', () => {
      const { engine, library } = fakeEngine();
      setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE);

      // SA authors all four prt_* systems at 50, which reads as another car's tyre smoke ending 50 m away.
      // The lane floors them (docs/hacks/vehicle-fx-lane-reach.md). Read off the real records; the value is
      // at offset 7 of each 20-float system stride.
      expect(systems.get('prt_sand')!.cullDist).toBe(50); // the floor is a real departure, not a no-op
      const records = library()!.systems;
      const distances = new Set<number>();
      for (let index = 0; index * 20 < records.length; index += 1) {
        distances.add(records[index * 20 + 7]);
      }
      expect([...distances]).toEqual([300]);
    });

    it('re-bakes the dynamic lane when the live scale changes', () => {
      const { engine, library } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs(), WORLD_DRAW_DISTANCE)!;

      particles.rebuild(0.5);

      expect(library()!.systems[7]).toBe(150); // the floored 300, halved
    });
  });
});
