/**
 * The renderer-agnostic half of the 2dfx particle path (plan 074/06 row 13, B6).
 *
 * An `effects.fxp` system is a bundle of keyframed tracks (emission rate, life, speed, cone angle, force,
 * size, colour, alpha). Neither renderer wants the tracks at runtime: both bake them once into a flat record
 * plus a stream of per-particle attributes, and then loop the lifecycle entirely in the VERTEX shader — so a
 * hundred smoke plumes cost nothing per frame. That baking is pure arithmetic and belongs here, shared.
 */
import type { FxEmitter, FxSystem } from '../parsers/text/fxp.parser';

import { sampleFxTrack } from '../parsers/text/fxp.parser';

/** Floats per particle instance: spawn(3) + velocity(3) + life/phase/systemIndex(3). */
export const FX_INSTANCE_STRIDE = 9;
/** Floats per baked system: force+layer(4) + size envelope+drawDistance(4) + 3 × (rgb + alpha)(12). */
export const FX_SYSTEM_STRIDE = 20;

/** One emitter of one system, baked flat. */
export interface FxBakedEmitter {
  /** Additive (fire, sparks) vs alpha-blended (smoke, steam). SA authors it as a D3D dst-blend id. */
  additive: boolean;
  /** Colour + alpha at age 0 / 0.5 / 1 — the 0 → peak → 0 shapes the tracks actually draw. */
  colors: [number, number, number, number][];
  /** Emission cone half-angle (radians) and the authored direction. */
  cone: { angle: number; direction: [number, number, number] };
  /** Constant acceleration: gravity for sparks, buoyancy for smoke. */
  force: [number, number, number];
  life: { bias: number; seconds: number };
  /** How many particles keep a plume continuous: rate × lifetime. */
  perEmitter: number;
  /** Authored emission rate (particles/second) — the DYNAMIC lane simulates it; the baked lane only
   *  sizes its loop budget from it (089/01). */
  rate: number;
  /** Size at age 0 / 0.5 / 1. */
  sizes: [number, number, number];
  speed: { bias: number; magnitude: number };
  /** Sprite name in effectsPC.txd (lowercased; '' when the emitter has none). */
  texture: string;
}

/** A placed emitter: a 2dfx type-1 anchor in world space. */
export interface FxPlacement {
  effectName: string;
  position: readonly [number, number, number];
}

/** A cap so a pathological rate cannot flood the buffer (prod uses the same idea). */
const MAX_PER_EMITTER = 64;
const MIN_LIFE = 0.15;
const MIN_SIZE = 0.05;

/**
 * Generate the per-particle attributes for one baked emitter at a set of placements. Deterministic: the same
 * cells rebuild the same cloud, so a streamed-out chimney does not re-randomise its smoke on return.
 */
export function bakeFxInstances(
  baked: FxBakedEmitter,
  placements: readonly FxPlacement[],
  systemIndex: number,
): Float32Array {
  const out = new Float32Array(placements.length * baked.perEmitter * FX_INSTANCE_STRIDE);
  const random = mulberry32(0x9e3779b9 ^ (systemIndex + placements.length * 31));
  let cursor = 0;
  for (const placement of placements) {
    for (let index = 0; index < baked.perEmitter; index += 1) {
      const at = cursor * FX_INSTANCE_STRIDE;
      out[at] = placement.position[0];
      out[at + 1] = placement.position[1];
      out[at + 2] = placement.position[2];
      sampleFxParticle(baked, random, out, at + 3);
      // The PHASE is what turns a pulse into a stream: every particle sits at a different point of one loop.
      out[at + 7] = random() * out[at + 6];
      out[at + 8] = systemIndex;
      cursor += 1;
    }
  }

  return out;
}

/**
 * Bake every emitter of a system. A system layers several (fire = flame + smoke + haze); an emitter with no
 * emission rate produces nothing when PLACED — SA leaves such prims in the file as heat-haze/dead layers.
 *
 * `includeTriggered` (089/01) keeps the rate-LESS emitters too: SA's code-triggered systems (the `prt_*`
 * family — tyre smoke, collision smoke) carry no `emrate` track at all, because the CALLER decides how many
 * particles to spawn. The dynamic lane needs those; a placed 2dfx anchor must keep skipping them.
 */
export function bakeFxSystem(system: FxSystem, options?: { includeTriggered?: boolean }): FxBakedEmitter[] {
  return system.emitters
    .map((emitter) => bakeFxEmitter(emitter, options?.includeTriggered ?? false))
    .filter((baked): baked is FxBakedEmitter => baked !== null);
}

/**
 * Sample one particle's launch: velocity (the authored direction tilted by a random angle inside the
 * emission cone, speed ± bias) into out[at..at+2] and life into out[at+3]. Shared by the static bake and
 * the runtime emitters (089/01), so a dynamic plume draws the same distribution a baked one does.
 */
export function sampleFxParticle(baked: FxBakedEmitter, random: () => number, out: Float32Array, at: number): void {
  const tilt = baked.cone.angle * Math.sqrt(random());
  const azimuth = random() * Math.PI * 2;
  const sin = Math.sin(tilt);
  const [dx, dy, dz] = baked.cone.direction;
  const v = [dx + Math.cos(azimuth) * sin, dy + Math.sin(azimuth) * sin, dz * Math.cos(tilt)];
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  const magnitude = baked.speed.magnitude + (random() * 2 - 1) * baked.speed.bias;
  out[at] = (v[0] / length) * magnitude;
  out[at + 1] = (v[1] / length) * magnitude;
  out[at + 2] = (v[2] / length) * magnitude;
  out[at + 3] = Math.max(MIN_LIFE, baked.life.seconds + (random() * 2 - 1) * baked.life.bias);
}

/** Write one baked emitter into the engine's system record (see FX_SYSTEM_STRIDE). */
export function writeFxSystemRecord(
  out: Float32Array,
  index: number,
  baked: FxBakedEmitter,
  textureLayer: number,
  drawDistance: number,
): void {
  const at = index * FX_SYSTEM_STRIDE;
  out.set(baked.force, at);
  out[at + 3] = textureLayer;
  out.set(baked.sizes, at + 4);
  out[at + 7] = drawDistance;
  for (let key = 0; key < 3; key += 1) {
    out.set(baked.colors[key], at + 8 + key * 4);
  }
}

function bakeFxEmitter(emitter: FxEmitter, includeTriggered: boolean): FxBakedEmitter | null {
  // HEAT HAZE is a screen-space DISTORTION layer, not a sprite: SA authors it as a big additive blob
  // (`sphere_cj`, size 2) that the engine is supposed to refract the frame through. Drawn as an ordinary
  // sprite it is a huge white ball that swallows the fire underneath it.
  if (emitter.name.toLowerCase().includes('heathaze')) {
    return null;
  }
  const track = (name: string, t: number, fallback: number): number => {
    const keys = emitter.tracks.get(name);

    return keys && keys.length > 0 ? sampleFxTrack(keys, t) : fallback;
  };
  // Colour rides either the COLOUR or the COLOURBRIGHT block (fire and explosions use the latter).
  const channel = (name: string, t: number, fallback: number): number => {
    const keys = emitter.tracks.get(`colour.${name}`) ?? emitter.tracks.get(`colourbright.${name}`);

    return keys && keys.length > 0 ? sampleFxTrack(keys, t) : fallback;
  };
  const colorAt = (t: number, alphaFallback: number): [number, number, number, number] => [
    channel('red', t, 255) / 255,
    channel('green', t, 255) / 255,
    channel('blue', t, 255) / 255,
    channel('alpha', t, alphaFallback) / 255,
  ];

  const rate = track('emrate.rate', 0, 0);
  if (rate <= 0 && !includeTriggered) {
    return null; // a dead layer (heat haze, an unused prim) — SA leaves these in the file
  }
  const life = Math.max(MIN_LIFE, track('emlife.life', 0, 1));
  const lifeBias = track('emlife.bias', 0, 0);

  return {
    additive: emitter.dstBlendId === 1,
    colors: [colorAt(0, 255), colorAt(0.5, 128), colorAt(1, 0)],
    cone: {
      angle: (track('emangle.max', 0, 15) * Math.PI) / 180,
      direction: [track('emdir.dirx', 0, 0), track('emdir.diry', 0, 0), track('emdir.dirz', 0, 1)],
    },
    force: [track('force.forcex', 0, 0), track('force.forcey', 0, 0), track('force.forcez', 0, 0)],
    life: { bias: lifeBias, seconds: life },
    perEmitter: Math.min(MAX_PER_EMITTER, Math.max(2, Math.ceil(rate * (life + lifeBias)))),
    rate,
    sizes: [
      Math.max(MIN_SIZE, track('size.sizex', 0, 0.5)),
      Math.max(MIN_SIZE, track('size.sizex', 0.5, 0.75)),
      Math.max(MIN_SIZE, track('size.sizex', 1, 1)),
    ],
    speed: { bias: track('emspeed.bias', 0, 0), magnitude: track('emspeed.speed', 0, 1) },
    texture: emitter.texture,
  };
}

/** Deterministic RNG (mulberry32) so a rebuilt cell emits an identical particle cloud. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
