import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FxEmitter, FxSystem } from '../parsers/text/fxp.parser';

import { parseFxp } from '../parsers/text/fxp.parser';
import { bakeFxInstances, bakeFxSystem, FX_INSTANCE_STRIDE, FX_SYSTEM_STRIDE, writeFxSystemRecord } from './bake-fx';

function emitter(tracks: Record<string, number>, overrides: Partial<FxEmitter> = {}): FxEmitter {
  return {
    alphaOn: true,
    dstBlendId: 5, // alpha blend unless a test says otherwise
    name: 'prim',
    srcBlendId: 4,
    texture: 'smoke',
    tracks: new Map(Object.entries(tracks).map(([name, value]) => [name, [{ time: 0, value }]])),
    ...overrides,
  };
}

function system(emitters: FxEmitter[]): FxSystem {
  return { boundingSphere: [0, 0, 0, 10], cullDist: 100, emitters, name: 'ws_factorysmoke' };
}

/** A plausible smoke plume: 10 particles a second, alive 4 s, drifting up. */
const SMOKE = {
  'emlife.life': 4,
  'emrate.rate': 10,
  'emspeed.speed': 2,
  'force.forcez': 1.5,
  'size.sizex': 1,
};

describe('bake-fx', () => {
  describe('negative cases', () => {
    it('an emitter with no emission rate bakes to nothing (SA leaves dead heat-haze prims in the file)', () => {
      expect(bakeFxSystem(system([emitter({ 'emlife.life': 4 })]))).toHaveLength(0);
    });

    it('skips HEAT-HAZE prims — they are screen distortion, not sprites', () => {
      // SA authors heat haze as a big additive blob (sphere_cj, size 2) meant to REFRACT the frame. Drawn as
      // an ordinary sprite it is a huge white ball that swallows the fire underneath it.
      const haze = emitter({ ...SMOKE, 'size.sizex': 2 }, { dstBlendId: 1, name: 'heathaze' });

      expect(bakeFxSystem(system([haze]))).toHaveLength(0);
      expect(bakeFxSystem(system([haze, emitter(SMOKE)]))).toHaveLength(1);
    });

    it('a system with no live emitters yields no instances at all', () => {
      const baked = bakeFxSystem(system([emitter({ 'emrate.rate': 0 })]));

      expect(baked).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('includeTriggered keeps a rate-less emitter but still drops heat haze (089/01)', () => {
      // The prt_* family (tyre/collision smoke) carries NO emrate track: SA spawns those from code with an
      // explicit count. The dynamic lane bakes them; a placed 2dfx anchor must keep skipping them.
      const haze = emitter({ 'emlife.life': 4 }, { dstBlendId: 1, name: 'heathaze' });

      const baked = bakeFxSystem(system([emitter({ 'emlife.life': 5 }), haze]), { includeTriggered: true });

      expect(baked).toHaveLength(1);
      expect(baked[0].rate).toBe(0);
      expect(baked[0].life.seconds).toBe(5);
    });

    it('particle count keeps the plume continuous: rate x lifetime', () => {
      const [baked] = bakeFxSystem(system([emitter(SMOKE)]));

      expect(baked.perEmitter).toBe(40); // 10/s alive for 4 s
    });

    it('the blend mode comes from the authored D3D dst id (fire adds, smoke alpha-blends)', () => {
      const [smoke] = bakeFxSystem(system([emitter(SMOKE)]));
      const [fire] = bakeFxSystem(system([emitter(SMOKE, { dstBlendId: 1 })]));

      expect(smoke.additive).toBe(false);
      expect(fire.additive).toBe(true);
    });

    it('every particle of a plume sits at a DIFFERENT point of the same loop', () => {
      // The phase is what turns a pulse into a stream: without it the whole chimney would puff in unison.
      const [baked] = bakeFxSystem(system([emitter(SMOKE)]));

      const instances = bakeFxInstances(baked, [{ effectName: 'ws_factorysmoke', position: [1, 2, 3] }], 0);

      const phases = new Set<number>();
      for (let index = 0; index < baked.perEmitter; index += 1) {
        const at = index * FX_INSTANCE_STRIDE;
        expect([...instances.subarray(at, at + 3)]).toEqual([1, 2, 3]); // all born at the emitter
        expect(instances[at + 6]).toBeGreaterThan(0); // lifetime
        phases.add(instances[at + 7]);
      }
      expect(phases.size).toBeGreaterThan(baked.perEmitter / 2);
    });

    it('is deterministic — a streamed-out chimney returns with the SAME smoke', () => {
      const [baked] = bakeFxSystem(system([emitter(SMOKE)]));
      const placed = [{ effectName: 'ws_factorysmoke', position: [1, 2, 3] as const }];

      const first = bakeFxInstances(baked, placed, 0);
      const second = bakeFxInstances(baked, placed, 0);

      expect([...first]).toEqual([...second]);
    });

    it('writes the system record the engine shader reads', () => {
      const [baked] = bakeFxSystem(system([emitter(SMOKE)]));
      const records = new Float32Array(FX_SYSTEM_STRIDE);

      writeFxSystemRecord(records, 0, baked, 3, 250);

      expect(records[2]).toBeCloseTo(1.5); // force z — smoke is buoyant
      expect(records[3]).toBe(3); // sprite layer
      expect(records[7]).toBe(250); // draw distance
      expect(records[8 + 3]).toBeCloseTo(1); // alpha at age 0 (opaque), fading to 0 by age 1
      expect(records[8 + 8 + 3]).toBeCloseTo(0);
    });
  });
});

// The synthetic emitters above pin the arithmetic; only the real library proves the TRACK NAMES we sample are
// the ones SA actually authors. The `fire` system is the one that shipped broken: its heat-haze prim rendered
// as a white ball until the baker learned to skip it.
const EFFECTS = 'fixtures/original/models/effects.fxp';

describe.skipIf(!existsSync(EFFECTS))('bake-fx (real effects.fxp)', () => {
  const systems = parseFxp(readFileSync(EFFECTS, 'utf8'));

  describe('positive cases', () => {
    it('bakes every stock system into sane emitters — no NaN, no zero-life, no empty sprite', () => {
      let baked = 0;
      for (const system of systems.values()) {
        for (const emitter of bakeFxSystem(system)) {
          baked += 1;
          expect(emitter.perEmitter).toBeGreaterThan(0);
          expect(emitter.life.seconds).toBeGreaterThan(0);
          expect(emitter.sizes.every((size) => size > 0)).toBe(true);
          expect(emitter.colors.flat().every(Number.isFinite)).toBe(true);
          expect(emitter.cone.direction.every(Number.isFinite)).toBe(true);
        }
      }
      expect(baked).toBeGreaterThan(50); // the stock library is ~200 systems
    });

    it('the real `fire` system keeps its flame layers and DROPS the heat-haze prim', () => {
      const fire = systems.get('fire');
      expect(fire).toBeDefined();
      expect(fire!.emitters.some((emitter) => emitter.name.toLowerCase().includes('heathaze'))).toBe(true);

      const baked = bakeFxSystem(fire!);

      expect(baked.length).toBeGreaterThan(0);
      expect(baked.every((emitter) => emitter.texture !== '')).toBe(true);
      // Nothing the size of the haze blob (it is authored huge, and drew over the whole fire).
      expect(baked.every((emitter) => Math.max(...emitter.sizes) < 2)).toBe(true);
    });

    it('instances of a real system are finite and spawn at the placement', () => {
      const [emitter] = bakeFxSystem(systems.get('water_fountain')!);

      const instances = bakeFxInstances(emitter, [{ effectName: 'water_fountain', position: [10, 20, 30] }], 0);

      expect([...instances].every(Number.isFinite)).toBe(true);
      expect([...instances.subarray(0, 3)]).toEqual([10, 20, 30]);
    });
  });
});
