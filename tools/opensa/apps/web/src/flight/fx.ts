/**
 * Replay-time sprite FX (smoke + explosions) on the engine's dynamic one-shot particle lane.
 *
 * The library is baked from the owner's own `effects.fxp` / `effectsPC.txd` (written into the pak by
 * `bake-map.mts`) through the SHARED `@opensa/renderware` bake — the same arithmetic the world 2dfx lane
 * runs, not a second copy of it. Nothing is procedural stand-in geometry: an explosion is SA's own `fire` +
 * smoke systems, sampled at their authored tracks.
 *
 * The driver reconstructs the short live particle window from recorded time on every update. Each particle
 * is born at its recorded tick/event time with a stable seed, so playback, rewind, seek and video export show
 * the same state. Old particles cannot survive a track switch or rewind.
 *
 * The smoke anchor is the model's `exhaust`/`engine` DUMMY position when the DFF authors one — an engine
 * smoke column. The stock Hydra has no separate nozzle mesh: `jetthrust` plume direction displays the
 * recorded nozzle setting; modded models with prop frames can additionally animate via `aircraft.applyProps`.
 */
import type { DynamicParticleLibrary, Engine } from '@opensa/engine';
import type { FxBakedEmitter, FxSystem } from '@opensa/renderware';

import {
  bakeFxSystem,
  FX_SYSTEM_STRIDE,
  normalizeSpriteAlpha,
  parseFxp,
  sampleFxParticle,
  writeFxSystemRecord,
} from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

import type { AircraftHandle } from './aircraft';
import type { FlightTrack, SampledPose } from './csv';
import type { FlightEventFx } from './track-fx';
import type { Vec3 } from './math';

import { gtaToEngine, rotateVec } from './math';
import { eventsOf, rowFx } from './track-fx';
import { sampleTrack } from './csv';
import { deriveNozzleAngle, hasNozzleRotation } from './nozzle';

/** Atlas side when no sprite resolves (every emitter's texture missing) — the procedural dot fallback. */
const FALLBACK_ATLAS_SIZE = 64;
/** Draw distance for a flight FX system, engine units. The dynamic lane's own reach floor. */
const FLIGHT_FX_DRAW_DISTANCE = 300;
/** Spacing of the smoke emission, REPLAY seconds — one deterministic tick per this much recorded time. */
const SMOKE_PERIOD = 1 / 25;
/** Particles per smoke tick (each of the system's layers spawns this many). */
const SMOKE_PER_TICK = 2;
/** Rebuild only particles that might still be alive. */
const FX_WINDOW = 4;
/** Particles per explosion layer for one recorded explosion. */
const EXPLOSION_PER_LAYER = 8;

/**
 * The systems preloaded into the lane. `alias` registers the same `effects.fxp` system under a second name
 * (the lane's index space is built once at load), so the explosion smoke can be tinted/sized apart from the
 * engine's without a second `effects.fxp` entry. Everything is optional — a system the install lacks is
 * simply skipped and its spawns do nothing.
 */
const FLIGHT_SYSTEMS: readonly {
  alias: string;
  name: string;
  sizeScale?: number;
  tint?: [number, number, number];
}[] = [
  { alias: 'engine-smoke', name: 'smoke30m' },
  { alias: 'hydra-jet', name: 'jetthrust', sizeScale: 1.5 },
  { alias: 'aircraft-explosion', name: 'explosion_large' },
  { alias: 'explosion-flash', name: 'explosion_fuel_car', sizeScale: 2 },
];

/** One baked emitter of one aliased system, with the lane index it spawns against. */
interface FxEntry {
  baked: FxBakedEmitter;
  systemIndex: number;
}

interface Sprite {
  height: number;
  rgba: Uint8Array;
  width: number;
}

/** The installed lane plus the name → emitters index the driver spawns through. */
export interface FlightEffects {
  dispose(): void;
  /** Advance the effects to `elapsed` replay seconds. `aircraft` supplies the smoke anchor dummy. */
  update(track: FlightTrack, pose: SampledPose, elapsed: number, aircraft: AircraftHandle | null): void;
}

/**
 * Build and install the flight FX lane. Returns null when the pak carries no `effects.fxp` — the replay then
 * simply has no sprite smoke/explosions and everything else keeps working. Never throws on a missing TXD.
 */
export function setupFlightEffects(engine: Engine, fxpText: null | string, txdBytes: null | Uint8Array): FlightEffects | null {
  if (!fxpText) {
    return null;
  }
  const systems = parseFxp(fxpText);
  const sprites = txdBytes ? decodeSprites(txdBytes) : new Map<string, Sprite>();
  const library = buildLibrary(systems, sprites);
  if (library.index.size === 0) {
    return null; // none of the systems resolve — nothing to draw
  }
  engine.initDynamicParticles(library.library);

  return createDriver(engine, library.index);
}

/** The driver state — one instance per installed lane. */
function createDriver(engine: Engine, index: Map<string, FxEntry[]>): FlightEffects {
  const scratch = new Float32Array(4); // vx, vy, vz, life — reused; no per-particle allocation

  const spawn = (
    entries: readonly FxEntry[], position: Vec3, random: () => number,
    bornAt: number, elapsed: number, alpha = 1, lifeScale = 1, direction?: Vec3,
  ): void => {
    for (const entry of entries) {
      sampleFxParticle(entry.baked, random, scratch, 0);
      const life = Math.min(FX_WINDOW, scratch[3] * lifeScale);
      if (bornAt + life <= elapsed) continue;
      // The original jetthrust emitter is authored around 1 unit/s. Replay extends that visual vector so
      // the recorded swivel is legible from the analysis camera, while keeping the original sprite/lifetime.
      const speed = Math.max(1, Math.hypot(scratch[0], scratch[1], scratch[2])) * (direction ? 4 : 1);
      const vx = direction ? direction[0] * speed + (random() - 0.5) * 0.6 : scratch[0];
      const vy = direction ? direction[1] * speed + (random() - 0.5) * 0.6 : scratch[1];
      const vz = direction ? direction[2] * speed + (random() - 0.5) * 0.6 : scratch[2];
      engine.spawnParticleAt(
        bornAt,
        entry.systemIndex,
        position[0],
        position[1],
        position[2],
        vx,
        vy,
        vz,
        life,
        alpha,
      );
    }
  };

  return {
    dispose(): void {
      engine.removeDynamicParticles();
    },
    update(track, _pose, elapsed, aircraft): void {
      engine.clearParticles();
      const windowStart = Math.max(0, elapsed - FX_WINDOW);

      // Burst particles retain their recorded birth time. Seeking beyond their lifetime leaves no burst.
      const events = eventsOf(track);
      events.forEach((event: FlightEventFx, eventIndex: number) => {
        if (event.s < windowStart || event.s > elapsed) return;
        const position = explosionPosition(event);
        if (!position) return;
        const random = mulberry32(0x9e3779b9 ^ (eventIndex + 1));
        const explosion = index.get('aircraft-explosion') ?? [];
        const flash = index.get('explosion-flash') ?? [];
        for (let n = 0; n < EXPLOSION_PER_LAYER; n += 1) {
          spawn(explosion, position, random, event.s, elapsed);
          spawn(flash, position, random, event.s, elapsed);
        }
      });

      // Smoke and jet thrust follow the actual recorded pose at each emission tick.
      const firstTick = Math.ceil(windowStart / SMOKE_PERIOD);
      const lastTick = Math.floor(elapsed / SMOKE_PERIOD);
      for (let tick = firstTick; tick <= lastTick; tick += 1) {
        const bornAt = tick * SMOKE_PERIOD;
        const pose = sampleTrack(track, bornAt);
        if (trackFxSmoke(pose)) {
          const position = smokePosition(pose, aircraft);
          const entries = index.get('engine-smoke') ?? [];
          for (let n = 0; n < SMOKE_PER_TICK; n += 1) {
            spawn(entries, position, mulberry32(0x85ebca6b ^ (tick * 4 + n)), bornAt, elapsed, 0.7);
          }
        }
        const nozzleRotation = rowFx(pose.row).nozzleRotation;
        if (track.model === 520 && pose.row.health > 0 && hasNozzleRotation(nozzleRotation)) {
          const angle = deriveNozzleAngle(nozzleRotation);
          const direction = rotateVec(pose.orientation, [0, -Math.cos(angle), -Math.sin(angle)]);
          const alpha = Math.min(1, Math.max(0.8, Math.abs(pose.row.throttle)));
          const entries = index.get('hydra-jet') ?? [];
          for (let side = 0; side < 2; side += 1) {
            const position = jetPosition(pose, aircraft, side === 1);
            spawn(entries, position, mulberry32(0xc2b2ae35 ^ (tick * 2 + side)), bornAt, elapsed, alpha, 1, direction);
          }
        }
      }
    },
  };
}

/** The row's `smokeActive`, undefined-safe (an older parser has no such column). */
function trackFxSmoke(pose: SampledPose): boolean {
  return rowFx(pose.row).smokeActive === true;
}

/** An explosion event's GTA position in engine space, or null when it is malformed. */
function explosionPosition(event: FlightEventFx): null | Vec3 {
  const p = event.pos;
  if (!Array.isArray(p) || p.length < 3 || !p.slice(0, 3).every((v) => Number.isFinite(v))) {
    return null;
  }

  return gtaToEngine(p[0], p[1], p[2]);
}

/**
 * Where the engine smoke leaves the aircraft: the model's `exhaust`/`engine` DUMMY, rotated by the recorded
 * orientation into engine space. Falls back to a point behind and below the origin (still deterministic, and
 * still an ENGINE anchor — never the nozzle geometry) when the DFF authors no such dummy.
 */
function smokePosition(pose: SampledPose, aircraft: AircraftHandle | null): Vec3 {
  const base = gtaToEngine(pose.pos[0], pose.pos[1], pose.pos[2]);
  const dummy = localDummy(aircraft, ['exhaust', 'engine', 'exhaust_1', 'exhaust_secondary']);
  const local: Vec3 = dummy ?? [0, -1.5, -0.2];
  const offset = rotateVec(pose.orientation, local);

  return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
}

/** The stock Hydra has one exhaust dummy on the right; mirror it for the left nozzle. */
function jetPosition(pose: SampledPose, aircraft: AircraftHandle | null, mirrored: boolean): Vec3 {
  const base = gtaToEngine(pose.pos[0], pose.pos[1], pose.pos[2]);
  const dummy = localDummy(aircraft, ['exhaust', 'engine']) ?? [0.76, -2.8, -0.02];
  const local: Vec3 = [mirrored ? -dummy[0] : dummy[0], dummy[1], dummy[2]];
  const offset = rotateVec(pose.orientation, local);
  return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
}

/** The first matching dummy by lower-cased name (with or without the `_dummy` suffix). */
function localDummy(aircraft: AircraftHandle | null, names: readonly string[]): null | Vec3 {
  if (!aircraft) {
    return null;
  }
  for (const want of names) {
    const dummy = aircraft.data.dummies.find((entry) => {
      const name = entry.name.toLowerCase();

      return name === want || name === `${want}_dummy`;
    });
    if (dummy) {
      return [dummy.position[0], dummy.position[1], dummy.position[2]];
    }
  }

  return null;
}

/**
 * Bake the lane library: system records + a sprite atlas for the aliased {@link FLIGHT_SYSTEMS}, plus the
 * name → baked-emitter index the driver spawns through. Mirrors the world lane's builder (`engine-particles`)
 * so a flight effect and a map effect draw through identical system records.
 */
function buildLibrary(
  systems: Map<string, FxSystem>,
  sprites: Map<string, Sprite>,
): { index: Map<string, FxEntry[]>; library: DynamicParticleLibrary } {
  const baked: FxBakedEmitter[] = [];
  const index = new Map<string, FxEntry[]>();
  for (const { alias, name, sizeScale, tint } of FLIGHT_SYSTEMS) {
    const system = systems.get(name);
    if (!system) {
      continue;
    }
    const entries: FxEntry[] = [];
    // includeTriggered keeps rate-less systems too; a flight effect is CALLER-driven (bursts/ticks), so a
    // system authored without an emission rate must not be dropped as "dead".
    for (const emitter of bakeFxSystem(system, { includeTriggered: true })) {
      const engineEmitter = toEngineSpace(emitter);
      if (sizeScale !== undefined) {
        engineEmitter.sizes = engineEmitter.sizes.map((size) => size * sizeScale) as [number, number, number];
      }
      if (tint !== undefined) {
        engineEmitter.colors = engineEmitter.colors.map(([r, g, b, a]): [number, number, number, number] => [
          r * tint[0],
          g * tint[1],
          b * tint[2],
          a,
        ]);
      }
      entries.push({ baked: engineEmitter, systemIndex: baked.length });
      baked.push(engineEmitter);
    }
    if (entries.length > 0) {
      index.set(alias, entries);
    }
  }

  const additive: boolean[] = [];
  const layers: string[] = [];
  const records = new Float32Array(baked.length * FX_SYSTEM_STRIDE);
  baked.forEach((emitter, at) => {
    let layer = layers.indexOf(emitter.texture);
    if (layer < 0) {
      layers.push(emitter.texture);
      layer = layers.length - 1;
    }
    writeFxSystemRecord(records, at, emitter, layer, FLIGHT_FX_DRAW_DISTANCE);
    additive.push(emitter.additive);
  });

  return { index, library: { additive, atlas: packAtlas(layers, sprites), systems: records } };
}

/** GTA-space directions/forces → engine space (the same swap the cell vertices take). */
function toEngineSpace(emitter: FxBakedEmitter): FxBakedEmitter {
  const swap = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], -v[1]];

  return {
    ...emitter,
    cone: { angle: emitter.cone.angle, direction: swap(emitter.cone.direction) },
    force: swap(emitter.force),
  };
}

/** Decode `effectsPC.txd` (or whatever FX dictionary the pak carried) into lower-cased RGBA sprites. */
function decodeSprites(bytes: Uint8Array): Map<string, Sprite> {
  const sprites = new Map<string, Sprite>();
  // A copy into a plain ArrayBuffer: `parseTxd` takes `ArrayBuffer`, and a Uint8Array view's `.buffer`
  // may be a `SharedArrayBuffer` (and may over-span the view).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  for (const texture of parseTxd(copy.buffer).textures) {
    const base = texture.mipmaps[0];
    const rgba =
      texture.format === 'rgba8888'
        ? new Uint8Array(base.data)
        : decodeDxt(texture.format, base.data, base.width, base.height);
    normalizeSpriteAlpha(rgba);
    sprites.set(texture.name.toLowerCase(), { height: base.height, rgba, width: base.width });
  }

  return sprites;
}

/** One array over every sprite the systems use; a missing sprite becomes a soft white dot. */
function packAtlas(layers: readonly string[], sprites: Map<string, Sprite>): DynamicParticleLibrary['atlas'] {
  const used = layers.map((name) => sprites.get(name.toLowerCase())).filter((sprite): sprite is Sprite => !!sprite);
  const width = Math.max(FALLBACK_ATLAS_SIZE, ...used.map((sprite) => sprite.width));
  const height = Math.max(FALLBACK_ATLAS_SIZE, ...used.map((sprite) => sprite.height));
  const count = Math.max(1, layers.length);
  const stride = width * height * 4;
  const rgba = new Uint8Array(count * stride);
  layers.forEach((name, layer) => {
    const sprite = sprites.get(name.toLowerCase());
    rgba.set(sprite ? resampleTo(sprite, width, height) : softDot(width, height), layer * stride);
  });
  if (layers.length === 0) {
    rgba.set(softDot(width, height), 0);
  }

  return { height, layers: count, rgba, width };
}

function resampleTo(sprite: Sprite, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sprite.height - 1, Math.floor((y / height) * sprite.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sprite.width - 1, Math.floor((x / width) * sprite.width));
      const from = (sy * sprite.width + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = sprite.rgba[from];
      out[to + 1] = sprite.rgba[from + 1];
      out[to + 2] = sprite.rgba[from + 2];
      out[to + 3] = sprite.rgba[from + 3];
    }
  }

  return out;
}

/** Fallback sprite: a soft round dot, so an emitter whose texture is missing still reads as a puff. */
function softDot(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const r = Math.hypot((x - centreX) / centreX, (y - centreY) / centreY);
      const alpha = Math.max(0, 1 - r) ** 2;
      const at = (y * width + x) * 4;
      out[at] = 255;
      out[at + 1] = 255;
      out[at + 2] = 255;
      out[at + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}

/** Deterministic RNG (mulberry32) — the same seed draws the same particle stream everywhere. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
