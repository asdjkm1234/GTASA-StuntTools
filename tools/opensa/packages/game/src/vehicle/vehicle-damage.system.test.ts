import { beforeEach, describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Impact, PhysicsWorld } from '../physics/physics-world';

import { Logger } from '../diagnostics/logger';
import { BLANK_PLATE_SLOT, PlateSlots } from './plate-slots';
import { VehicleDamageSystem } from './vehicle-damage.system';
import { FakeVehicleHandle } from './vehicle-handle.fake';

const SILENT_LOGGER = new Logger({ emit: (): undefined => undefined }, { showLogs: false });
const STRONG = 300000; // STRONG_HIT
const CAR_BODY = 7;

/** A fake physics world: a queued impact list (drained by takeImpacts) and an identity car body. */
function fakePhysics(): { impacts: Impact[]; world: PhysicsWorld } {
  const impacts: Impact[] = [];
  const world = {
    readBody: (): { position: Vec3; quaternion: [number, number, number, number] } => ({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1], // identity → world point == car-local point
    }),
    takeImpacts: (): Impact[] => impacts.splice(0, impacts.length),
  } as unknown as PhysicsWorld;

  return { impacts, world };
}

function impact(force: number, point: null | Vec3): Impact {
  return { bodyA: CAR_BODY, bodyB: null, force, point };
}

describe('VehicleDamageSystem', () => {
  let physics: { impacts: Impact[]; world: PhysicsWorld };
  let system: VehicleDamageSystem;
  let handle: FakeVehicleHandle;

  beforeEach(() => {
    physics = fakePhysics();
    system = new VehicleDamageSystem(physics.world, SILENT_LOGGER);
    handle = new FakeVehicleHandle([
      { name: 'bonnet', position: [0, 2, 0] }, // front
      { name: 'boot', position: [0, -2, 0] }, // rear
    ]);
    system.add({ body: CAR_BODY, handle });
  });

  describe('negative cases', () => {
    it('ignores a weak impact (below the strong-hit threshold)', () => {
      physics.impacts.push(impact(STRONG - 1, [0, 2, 0]));
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });

    it('ignores an impact with no contact point', () => {
      physics.impacts.push(impact(STRONG * 2, null));
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });

    it('ignores an impact on a body it does not own', () => {
      physics.impacts.push({ bodyA: 999, bodyB: 998, force: STRONG * 2, point: [0, 2, 0] });
      system.update(0.016);
      expect(handle.damaged.size).toBe(0);
    });

    it('never fires the strong-hit sink for weak, pointless or foreign impacts (089/04)', () => {
      const hits: number[] = [];
      system.onStrongHit = (force): void => {
        hits.push(force);
      };
      physics.impacts.push(
        impact(STRONG - 1, [0, 2, 0]), // a kerb tap
        impact(STRONG * 2, null), // no contact point to puff at
        { bodyA: 999, bodyB: 998, force: STRONG * 2, point: [0, 2, 0] }, // somebody else's crash
      );

      system.update(0.016);

      expect(hits).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('deforms the part nearest the hit (swaps ok→dam)', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0])); // at the bonnet
      system.update(0.016);
      expect(handle.damaged.has('bonnet')).toBe(true);
      expect(handle.damaged.has('boot')).toBe(false); // the rear panel is untouched
    });

    it('detaches an already-damaged part on a second strong hit', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach

      expect(handle.detached.has('bonnet')).toBe(true);
      // It falls as WORLD-space data now: the system poses it through the handle every frame.
      expect(handle.poses.get('bonnet')).toBeDefined();
    });

    it('fires the strong-hit sink with the force and the contact point (089/04)', () => {
      const hits: { force: number; point: readonly number[] }[] = [];
      system.onStrongHit = (force, point): void => {
        hits.push({ force, point: [...point] });
      };
      physics.impacts.push(impact(STRONG * 2, [0, 2, 0]));

      system.update(0.016);

      expect(hits).toEqual([{ force: STRONG * 2, point: [0, 2, 0] }]);
    });

    it('changes a part state at most once per frame (deform XOR detach)', () => {
      // Two strong hits on the bonnet in one update: it should deform, not deform AND detach.
      physics.impacts.push(impact(STRONG, [0, 2, 0]), impact(STRONG, [0, 2, 0]));
      system.update(0.016);

      expect(handle.damaged.has('bonnet')).toBe(true);
      expect(handle.detached.has('bonnet')).toBe(false);
    });

    it('holds the plate refcount through deform, detach and debris expiry (082/04)', () => {
      // A plate face lives INSIDE a part mesh, so the whole damage lifecycle runs over it. The refcount
      // belongs to the CAR and only a despawn may hand it back: evicting the layer while the panel is still
      // falling would repaint a raster that is on screen.
      const slots = new PlateSlots({ uploadPlateText: (): undefined => undefined }, 3);
      const blank = (): Uint8Array => new Uint8Array(0);
      const slot = slots.claim('LVA 123', blank);

      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform (ok→dam swaps under the plate)
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach
      system.update(2); // past FALL_TTL — the debris is gone

      slots.claim('SFX 998', blank); // slot 0 is reserved, so the atlas is now full
      expect(slots.claim('LSY 771', blank)).toBe(BLANK_PLATE_SLOT); // nothing evictable → still worn
      let recomposed = 0;
      const again = slots.claim('LVA 123', () => {
        recomposed += 1;

        return blank();
      });
      expect(again).toBe(slot);
      expect(recomposed).toBe(0); // the car's own raster never left the atlas
    });

    it('a detached part falls (gravity pulls its pose down) and is removed once its time expires', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach → starts falling (TTL 1.5s)
      system.update(0.5);
      const falling = handle.poses.get('bonnet');
      expect(falling?.position[2]).toBeLessThan(0); // gravity beat the initial upward knock

      system.update(2); // past FALL_TTL

      expect(handle.removed.has('bonnet')).toBe(true);
      expect(handle.detached.has('bonnet')).toBe(false);
    });
  });
});
