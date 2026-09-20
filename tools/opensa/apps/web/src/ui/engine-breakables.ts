/**
 * Smashable props on the own engine (074/08 B7·a) — the `?engine=opensa` twin of canvas-host's `breakables`
 * system. The physics half is already shared: colliders are tagged with their placement key at cell load, and
 * Rapier reports contact forces on the vehicle chassis (so, as in vanilla, you cannot smash a crate on foot).
 * This module decides whether a hit is hard enough, tells the engine to shatter that placement, and spawns the
 * debris.
 *
 * The engine breaks a prop by degenerating its triangles inside the cell's index buffer (see
 * `CellStore.breakPlacement`) — the prop stays inside the merged batch, so the break costs no draw call.
 */
import type { Engine } from '@opensa/engine';
import type { Vec3 } from '@opensa/game';
import type { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { Impact, PhysicsWorld } from '@opensa/game/physics/physics-world';
import type { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import type { AssetFileSystem } from '@opensa/renderware';

import { breakableKeyHash } from '@opensa/renderware/breakable/key';

import { spawnEngineDebris } from './engine-debris';
import { type EngineProps } from './engine-props';

/** Contact force (N) a hit must reach; object.dat's damage multiplier scales it per model. */
const BREAK_FORCE = 3000;
/**
 * Above this mass a prop is a fixture and never breaks. NOT 50 000: SA gives breakable FENCES that mass (it
 * reads as an uproot limit), and cutting there wrongly made them indestructible — the field lesson of plan 045.
 */
const INDESTRUCTIBLE_MASS = 90000;
/** How far below a prop's base to look for ground (a bin on a kerb, a lamppost on a slope). */
const GROUND_PROBE = 12;

export interface EngineBreakables {
  /** Smash the loaded prop nearest the player (the debugger trigger — on foot no contact can break one).
   *  Ignores the force threshold, like prod's debug action; tuned-indestructible props still survive. */
  breakNearest(position: Vec3, radius: number): boolean;
  /** Drain this frame's impacts and smash whatever they hit. Cheap: the queue is usually empty. */
  update(): void;
}

export function setupEngineBreakables(
  engine: Engine,
  physics: PhysicsWorld,
  collision: CollisionStreamingSystem,
  adapter: GtaSaWorldAdapter,
  fs: AssetFileSystem,
  props: EngineProps,
): EngineBreakables {
  /** The prop a contact-force event hit, if it hit one, plus whatever hit it. */
  const propOf = (impact: Impact): null | { hitter: null | number; key: string } => {
    const fromA = collision.breakableKeyOf(impact.bodyA);
    const key = fromA ?? collision.breakableKeyOf(impact.bodyB);
    if (key === undefined) {
      return null;
    }

    return { hitter: fromA === undefined ? impact.bodyA : impact.bodyB, key };
  };

  /** SA tunes toughness per model: heavy fixtures never break, and colDamageMultiplier scales the threshold. */
  const survives = (modelName: string, force: number): boolean => {
    const info = adapter.breakableInfo(modelName);
    if (info && info.mass >= INDESTRUCTIBLE_MASS) {
      return true;
    }
    const toughness = Math.min(3, Math.max(0.5, info?.colDamageMultiplier ?? 1));

    return force < BREAK_FORCE / toughness;
  };

  /** Break one placement by key. `force` gates the toughness check (Infinity = the debugger's forced smash);
   *  `hitter` is the body that hit it (its velocity flings the shards) and `point` the contact it topples from. */
  const smashKey = (key: string, force: number, hitter: null | number, point?: Vec3): void => {
    const modelName = key.slice(0, key.indexOf('|'));
    if (survives(modelName, force)) {
      return;
    }
    // Welded prop (degenerate its index range) OR breakable clutter (074/20 — degenerate its instance matrix).
    const hash = breakableKeyHash(key);
    const welded = engine.cells.breakPlacement(hash);
    const clutter = welded ? false : engine.breakClutterInstance(hash);
    if (!welded && !clutter) {
      return; // the prop's cell has streamed out, or it is already broken
    }
    // The collider must go with the geometry, or the car keeps hitting a ghost.
    collision.removeBreakable(key);

    const transform = collision.breakableTransform(key);
    if (!transform) {
      return; // no transform recorded — the prop vanishes without shards rather than shattering wrongly
    }
    const info = adapter.breakableInfo(modelName);
    const txdName = adapter.txdOf(modelName);
    const hit = hitter !== null ? physics.getLinvel(hitter) : undefined;
    // SA's UPROOT LIMIT (object.dat column G) says this prop is knocked OVER, not burst: a lamppost carries
    // 240 there, a crate 0. A street lamp bursting into shards reads as wrong at a glance — so it becomes a
    // real dynamic body and Rapier decides where it falls and what it lands on.
    if ((info?.uprootLimit ?? 0) > 0) {
      props.topple({
        // The contact point is what the pole falls away from — the car's velocity is only a fallback.
        ...(point ? { contact: point } : {}),
        ...(hit ? { impact: hit } : {}),
        ...(info?.mass !== undefined ? { mass: info.mass } : {}),
        modelName,
        transform,
        ...(txdName !== undefined ? { txdName } : {}),
      });

      return;
    }
    // The prop's own base is NOT the ground. Probing it is the fix this port carries over the three path,
    // whose shards, having nothing to land on, fall through the floor and sink while they fade.
    const ground = physics.groundBelow([transform[12], transform[13], transform[14] + 0.5], GROUND_PROBE);
    spawnEngineDebris(engine, fs, {
      ...(ground !== null ? { groundZ: ground } : {}),
      ...(hit ? { impact: hit } : {}),
      modelName,
      transform,
      ...(txdName !== undefined ? { txdName } : {}),
    });
  };

  return {
    breakNearest(position: Vec3, radius: number): boolean {
      const key = collision.nearestBreakable(position, radius);
      if (key === undefined) {
        return false;
      }
      smashKey(key, Number.POSITIVE_INFINITY, null);

      return true;
    },
    update(): void {
      const impacts = physics.takeBreakableImpacts();
      for (const impact of impacts) {
        const prop = propOf(impact);
        if (prop) {
          smashKey(prop.key, impact.force, prop.hitter, impact.point ?? undefined);
        }
      }
    },
  };
}
