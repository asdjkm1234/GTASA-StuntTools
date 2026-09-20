/**
 * 2dfx particles on the own engine (074/06 row 13, B6) — the `?engine=opensa` twin of canvas-host's FX
 * block. The pak carries the emitter ANCHORS (welded per cell by the converter); this module owns the
 * LIBRARY: `effects.fxp` systems and `effectsPC.txd` sprites, baked through the shared
 * `@opensa/renderware/fx/bake-fx` — the same arithmetic the three path runs, not a second copy of it.
 *
 * Both files are absent-tolerant: no library, no particles, and the map still streams.
 */
import type { CoronaSprites, DynamicParticleLibrary, Engine, ParticleUpload } from '@opensa/engine';
import type { FxBakedEmitter, FxPlacement, FxSystem } from '@opensa/renderware';
import type { AssetFileSystem } from '@opensa/renderware';

import {
  bakeFxInstances,
  bakeFxSystem,
  FX_SYSTEM_STRIDE,
  normalizeSpriteAlpha,
  parseFxp,
  sampleFxParticle,
  writeFxSystemRecord,
} from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

/** Atlas side used only when NO sprite resolves (every emitter's texture missing) — the procedural dot. */
const FALLBACK_ATLAS_SIZE = 64;
/**
 * Draw distance for a system with no authored `cullDist` (world units) — beyond it the vertex shader
 * collapses the quad. Every stock system authors one, so this is the fallback for a mod's that does not.
 */
const FALLBACK_DRAW_DISTANCE = 300;

/**
 * Floor under the DYNAMIC lane's reach (`docs/hacks/vehicle-fx-lane-reach.md`). Every `prt_*` system authors
 * `cullDist` 50, which reads as another car's tyre smoke ending 50 m away — SA spawns these for the player's
 * own events, we spawn them for every vehicle in the world. A LANE floor, not a per-system row: it applies to
 * whatever {@link DYNAMIC_SYSTEMS} carries, including a mod's.
 */
const DYNAMIC_LANE_DRAW_DISTANCE = 300;

/**
 * The two places we knowingly do NOT draw an effect for the distance `effects.fxp` authors, both the user's
 * call and both recorded in `docs/hacks/`. Everything absent from this table takes its authored number
 * verbatim — the point of the step is that the table wins.
 */
const DRAW_DISTANCE_DEPARTURES: readonly {
  /** `atLeast` raises a too-tight authored value to a floor; `world` draws it as far as the world is drawn. */
  rule: 'atLeast' | 'world';
  systems: readonly string[];
  value?: number;
}[] = [
  // `docs/hacks/smoke-drawn-to-world-edge.md` — authored 150–255, and a plume that dies while its chimney is
  // still drawn is the defect plan 100 exists to fix. 42 of the map's 878 anchors, so it is a cheap departure.
  { rule: 'world', systems: ['ws_factorysmoke', 'smoke30m', 'smoke30lit', 'smoke50lit'] },
  // `docs/hacks/tiny-fx-distance-floor.md` — authored 15, which reads literally as arm's length. 100 is the
  // accepted compromise and still 3× tighter than the flat 300 these had before.
  { rule: 'atLeast', systems: ['insects', 'cigarette_smoke'], value: 100 },
];

/**
 * Systems preloaded into the DYNAMIC one-shot lane (089/01) — lowercased, as `parseFxp` keys them. The
 * lane's atlas and system records are built ONCE at boot, so an effect must be listed here before a
 * runtime emitter can spawn it.
 *
 * `sizeScale` shrinks a system's authored size envelope in the lane's record: some SA systems are authored
 * for a different trigger (prt_sand is a BULLET-hit plume, 8–13 m) and would dwarf a wheel puff.
 *
 * `tint` multiplies the authored colour envelope, and `alias` registers the SAME fxp system as another
 * lane entry — together they stand in for the original's PER-SPAWN colour: SA passes a ground-derived
 * colour into every `prt_*` spawn (`FxPrtMult_c`), which is why its wheel dust matches the surface while
 * the systems themselves are authored pure WHITE (measured: prt_wheeldirt's envelope is 255/255/255 and
 * smokeii_3/bullethitsmoke are neutral grey). The lane has per-spawn alpha but no per-spawn colour, so
 * the tint is per CLASS, not per ground — an eye-fit, recorded in `docs/hacks/surface-fx-fit.md`.
 */
const DYNAMIC_SYSTEMS: readonly {
  alias?: string;
  name: string;
  sizeScale?: number;
  tint?: [number, number, number];
}[] = [
  { name: 'prt_collisionsmoke' },
  { name: 'prt_smokeii_3_expand' },
  { alias: 'wheeldirt-dust', name: 'prt_wheeldirt', tint: [0.62, 0.54, 0.42] },
  { alias: 'wheeldirt-grass', name: 'prt_wheeldirt', tint: [0.45, 0.5, 0.3] },
  { alias: 'wheeldirt-mud', name: 'prt_wheeldirt', tint: [0.4, 0.32, 0.22] },
  { name: 'prt_sand', sizeScale: 0.35, tint: [0.82, 0.72, 0.52] },
];

/** A runtime spawner over one preloaded system: park it somewhere, burst it or stream it, step it. */
export interface DynamicFxEmitter {
  /** Per-spawn opacity multiplier over the authored alpha envelope (089/02 round 2): SA's envelopes assume
   *  its own sparse spawns, and per-step bursts stack — callers scale the look with how hard the event is. */
  alphaScale: number;
  /** Spawn `count` particles NOW from every layer — the shape SA's code-triggered `prt_*` systems use
   *  (no authored rate; the caller decides per call, e.g. per fixed step from slip). */
  burst(count: number): void;
  /** Multiplier over the authored particle life for the NEXT spawns — a gentle slide's smoke wisps away,
   *  a burnout's lingers (089/02). The per-particle life field is the one free per-spawn look knob. */
  lifeScale: number;
  /** World position (engine space) the next spawns come from — mutate freely, particles keep flying. */
  readonly position: [number, number, number];
  /** Multiplier over the authored emission rate; 0 stops the stream (live particles finish their life).
   *  Layers with NO authored rate (code-triggered) ignore this and respond to `burst` only. */
  rate: number;
  /** Advance on the FIXED step: accumulates rate × dt and spawns whole particles into the engine pool. */
  update(dt: number): void;
}

export interface EngineParticles {
  /** A dynamic emitter for one preloaded system (089/01) — null when this profile does not ship it. */
  createEmitter(name: string): DynamicFxEmitter | null;
  /**
   * Rebuild the GPU buffers from the currently STREAMED cells. Cheap and rare — call on a cell-set change.
   * `drawDistanceScale` is the live knob; a changed value re-bakes BOTH lanes, which is why it arrives here
   * rather than being read once at boot.
   */
  rebuild(drawDistanceScale: number): void;
}

interface Sprite {
  height: number;
  rgba: Uint8Array;
  width: number;
}

/**
 * How far one fx system is drawn, in world units: its own authored `cullDist`, with the departures above
 * applied. `worldDrawDistance` is the host's LOD radius — the distance the geometry an emitter sits on is
 * still drawn at — so the smoke departure is derived from the world rather than fitted.
 *
 * `floor` is the calling LANE's minimum (the dynamic lane's, see {@link DYNAMIC_LANE_DRAW_DISTANCE}); `scale`
 * is the live `graphics.effects.drawDistanceScale` knob, applied LAST so it moves every system — floored,
 * departed or authored — by the same factor. 1 = exactly what the data (and the departures) say.
 */
export function fxDrawDistance(
  system: FxSystem,
  worldDrawDistance: number,
  options: { floor?: number; scale?: number } = {},
): number {
  const { floor = 0, scale = 1 } = options;

  return Math.max(departedDrawDistance(system, worldDrawDistance), floor) * scale;
}

/**
 * The SA corona billboards from `particle.txd` (B6): `coronastar` for lamps and headlights, `coronamoon` for
 * the moon. Layers are packed at the LARGEST of the two sizes — nothing here is pinned to 64², so dropping in
 * a higher-resolution moon just works. Returns undefined when the profile ships no particle.txd; the engine
 * then falls back to its procedural glow.
 */
export function loadCoronaSprites(fs: AssetFileSystem): CoronaSprites | undefined {
  const bytes = fs.get('models/particle.txd');
  if (!bytes) {
    return undefined;
  }
  const sprites = decodeSprites(bytes);
  const star = sprites.get('coronastar');
  const moon = sprites.get('coronamoon');
  if (!star || !moon) {
    return undefined;
  }
  const width = Math.max(star.width, moon.width);
  const height = Math.max(star.height, moon.height);
  const rgba = new Uint8Array(width * height * 4 * 2);
  rgba.set(resampleTo(star, width, height), 0);
  rgba.set(resampleTo(moon, width, height), width * height * 4);

  return { height, layers: 2, rgba, width };
}

/**
 * SA's skid-mark decal sprite from `particle.txd` (089/03) — white with the tread pattern in the alpha
 * channel; the engine's skid shader applies the dark rubber tint. Undefined when the profile ships no
 * particle.txd (the marks are then simply absent, like the coronas' fallback).
 */
export function loadSkidSprite(fs: AssetFileSystem): undefined | { height: number; rgba: Uint8Array; width: number } {
  const bytes = fs.get('models/particle.txd');
  if (!bytes) {
    return undefined;
  }

  return decodeSprites(bytes).get('particleskid');
}

/**
 * `worldDrawDistance` is the host's LOD radius (`GAME_CONFIG[game].drawDistance`, the same number
 * `setupStreaming` is given) — how far the world itself is drawn. It is what the smoke departure in
 * {@link fxDrawDistance} is measured against, so a profile that draws further smokes further.
 * `drawDistanceScale` is the boot value of the live knob (1 = as authored); `rebuild` carries it after that.
 */
export function setupEngineParticles(
  engine: Engine,
  fs: AssetFileSystem,
  worldDrawDistance: number,
  drawDistanceScale = 1,
): EngineParticles | null {
  const fxpText = fs.getText('models/effects.fxp');
  const txdBytes = fs.get('models/effectspc.txd') ?? fs.get('models/effectsPC.txd');
  if (!fxpText || !txdBytes) {
    return null; // no library shipped with this profile — the map simply renders without particles
  }
  const systems = parseFxp(fxpText);
  const sprites = decodeSprites(txdBytes);
  let scale = drawDistanceScale;
  const dynamic = buildDynamicLibrary(systems, sprites, worldDrawDistance, scale);
  engine.initDynamicParticles(dynamic.library);

  let signature = '';

  return {
    createEmitter(name: string): DynamicFxEmitter | null {
      const entries = dynamic.index.get(name.toLowerCase());
      if (!entries) {
        return null;
      }
      const accumulators = new Float64Array(entries.length);
      const scratch = new Float32Array(4); // vx, vy, vz, life — reused, no allocation per particle
      const spawnOne = (entry: (typeof entries)[number], position: readonly [number, number, number]): void => {
        sampleFxParticle(entry.baked, Math.random, scratch, 0);
        engine.spawnParticle(
          entry.systemIndex,
          position[0],
          position[1],
          position[2],
          scratch[0],
          scratch[1],
          scratch[2],
          scratch[3] * emitter.lifeScale,
          emitter.alphaScale,
        );
      };
      const emitter: DynamicFxEmitter = {
        alphaScale: 1,
        burst(count: number): void {
          for (const entry of entries) {
            for (let index = 0; index < count; index += 1) {
              spawnOne(entry, emitter.position);
            }
          }
        },
        lifeScale: 1,
        position: [0, 0, 0],
        rate: 1,
        update(dt: number): void {
          entries.forEach((entry, at) => {
            accumulators[at] += entry.baked.rate * emitter.rate * dt;
            while (accumulators[at] >= 1) {
              accumulators[at] -= 1;
              spawnOne(entry, emitter.position);
            }
          });
        },
      };

      return emitter;
    },
    rebuild(drawDistanceScale: number): void {
      if (drawDistanceScale !== scale) {
        scale = drawDistanceScale;
        // The dynamic lane's records are baked once at boot, so the knob has to re-install them. `dynamic.index`
        // is deliberately NOT replaced: DYNAMIC_SYSTEMS is a fixed list, so the new records land at the same
        // indices and every emitter handed out earlier keeps spawning into the right system.
        engine.initDynamicParticles(buildDynamicLibrary(systems, sprites, worldDrawDistance, scale).library);
      }
      // The cell set changes only when streaming crosses a ring, so a signature check keeps this off the
      // per-frame path entirely. The scale is in the signature too — changing it must re-upload.
      const cells = [...engine.cells.all()].filter((cell) => cell.particles.length > 0);
      const next = [scale, ...cells.map((cell) => cell.key)].join('|');
      if (next === signature) {
        return;
      }
      signature = next;

      const placements = new Map<string, FxPlacement[]>();
      for (const cell of cells) {
        for (const particle of cell.particles) {
          const list = placements.get(particle.effectName) ?? [];
          list.push({ effectName: particle.effectName, position: [particle.x, particle.y, particle.z] });
          placements.set(particle.effectName, list);
        }
      }
      engine.setParticles(buildUpload(systems, sprites, placements, worldDrawDistance, scale));
    },
  };
}

/**
 * The FX tracks are authored in GTA space (Z up); the engine works in Y up. The converter already puts the
 * emitter POSITIONS through that basis change — the direction and the force must follow, or a fountain
 * sprays sideways and smoke crawls along the ground. e = (x, z, -y), the same change the cell vertices take.
 */
export function toEngineSpace(emitter: FxBakedEmitter): FxBakedEmitter {
  const swap = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], -v[1]];

  return {
    ...emitter,
    cone: { angle: emitter.cone.angle, direction: swap(emitter.cone.direction) },
    force: swap(emitter.force),
  };
}

/**
 * Bake the DYNAMIC lane's library (089/01): system records + atlas for the preloaded systems, plus a
 * name → baked-emitters index runtime emitters spawn through. Built once at boot — the lane's atlas
 * cannot grow later, which is why `DYNAMIC_SYSTEMS` is a boot-time list.
 */
function buildDynamicLibrary(
  systems: Map<string, FxSystem>,
  sprites: Map<string, Sprite>,
  worldDrawDistance: number,
  scale: number,
): { index: Map<string, { baked: FxBakedEmitter; systemIndex: number }[]>; library: DynamicParticleLibrary } {
  const baked: { distance: number; emitter: FxBakedEmitter }[] = [];
  const index = new Map<string, { baked: FxBakedEmitter; systemIndex: number }[]>();
  for (const { alias, name, sizeScale, tint } of DYNAMIC_SYSTEMS) {
    const system = systems.get(name);
    if (!system) {
      continue; // this profile does not ship the system — createEmitter(name) then returns null
    }
    const entries: { baked: FxBakedEmitter; systemIndex: number }[] = [];
    const distance = fxDrawDistance(system, worldDrawDistance, { floor: DYNAMIC_LANE_DRAW_DISTANCE, scale });
    // includeTriggered: the prt_* family carries NO emrate track — the runtime caller owns the count.
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
      baked.push({ distance, emitter: engineEmitter });
    }
    if (entries.length > 0) {
      index.set(alias ?? name, entries);
    }
  }

  const additive: boolean[] = [];
  const layers: string[] = [];
  const records = new Float32Array(baked.length * FX_SYSTEM_STRIDE);
  baked.forEach(({ distance, emitter }, at) => {
    let layer = layers.indexOf(emitter.texture);
    if (layer < 0) {
      layers.push(emitter.texture);
      layer = layers.length - 1;
    }
    writeFxSystemRecord(records, at, emitter, layer, distance);
    additive.push(emitter.additive);
  });

  return { index, library: { additive, atlas: packAtlas(layers, sprites), systems: records } };
}

/** Assemble the systems, the instances and the sprite array actually used by the loaded cells. */
function buildUpload(
  systems: Map<string, FxSystem>,
  sprites: Map<string, Sprite>,
  placements: Map<string, FxPlacement[]>,
  worldDrawDistance: number,
  scale: number,
): ParticleUpload {
  const baked: { distance: number; emitter: FxBakedEmitter; placed: FxPlacement[] }[] = [];
  for (const [name, placed] of placements) {
    const system = systems.get(name);
    if (!system) {
      continue; // an emitter naming a system this profile does not ship
    }
    const distance = fxDrawDistance(system, worldDrawDistance, { scale });
    for (const emitter of bakeFxSystem(system)) {
      baked.push({ distance, emitter: toEngineSpace(emitter), placed });
    }
  }

  const layers: string[] = [];
  const records = new Float32Array(baked.length * FX_SYSTEM_STRIDE);
  const add: Float32Array[] = [];
  const blend: Float32Array[] = [];
  baked.forEach(({ distance, emitter, placed }, index) => {
    let layer = layers.indexOf(emitter.texture);
    if (layer < 0) {
      layers.push(emitter.texture);
      layer = layers.length - 1;
    }
    writeFxSystemRecord(records, index, emitter, layer, distance);
    const instances = bakeFxInstances(emitter, placed, index);
    (emitter.additive ? add : blend).push(instances);
  });

  return {
    atlas: packAtlas(layers, sprites),
    instancesAdd: concat(add),
    instancesBlend: concat(blend),
    systems: records,
  };
}

function concat(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
}

function decodeSprites(bytes: ArrayBuffer): Map<string, Sprite> {
  const sprites = new Map<string, Sprite>();
  for (const texture of parseTxd(bytes).textures) {
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

/** The authored `cullDist` with {@link DRAW_DISTANCE_DEPARTURES} applied — before any lane floor or scale. */
function departedDrawDistance(system: FxSystem, worldDrawDistance: number): number {
  const authored = system.cullDist > 0 ? system.cullDist : FALLBACK_DRAW_DISTANCE;
  const name = system.name.toLowerCase();
  for (const departure of DRAW_DISTANCE_DEPARTURES) {
    if (!departure.systems.includes(name)) {
      continue;
    }

    return departure.rule === 'world' ? worldDrawDistance : Math.max(authored, departure.value ?? authored);
  }

  return authored;
}

/**
 * One texture array over every sprite the loaded emitters use; missing sprites become a soft white dot.
 *
 * A WebGPU texture array forces ONE size on every layer, so the size is the LARGEST source sprite rather than
 * a constant: swapping in higher-resolution FX sprites is picked up, and the stock 128 px ones stop being
 * needlessly downsampled to 64. Nothing here is pinned to a resolution.
 */
function packAtlas(layers: readonly string[], sprites: Map<string, Sprite>): ParticleUpload['atlas'] {
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

/** Fallback sprite: a soft round dot, so an emitter with a missing texture still reads as a puff. */
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
