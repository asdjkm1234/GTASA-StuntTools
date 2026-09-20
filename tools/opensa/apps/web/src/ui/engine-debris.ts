/**
 * Debris for a smashed prop on the own engine (074/08 B7·a step 4).
 *
 * The shard arithmetic is shared with the three path (`renderware/breakable/bake-debris`); this module only
 * gathers the inputs — the prop's shatter mesh, its world transform, the impact that hit it and, unlike prod,
 * a REAL ground height — turns the result into the engine's vertex layout, and hands it over.
 *
 * The ground probe is the fix this port carries: the three path never probed, so its shards fall through the
 * floor and sink while fading (its own TODO). Rapier already answers "what is under this point", so they land.
 */
import type { Engine, ModelTextureInit } from '@opensa/engine';
import type { AssetFileSystem } from '@opensa/renderware';
import type { BakedDebris } from '@opensa/renderware/breakable/bake-debris';

import { getClump, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { bakeDebris, DEBRIS_FADE, DEBRIS_GRAVITY, DEBRIS_LIFETIME } from '@opensa/renderware/breakable/bake-debris';
import { breakableFromGeometry, getBreakable } from '@opensa/renderware/breakable/mesh';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

/** Floats per debris vertex — the layout `pipelines.ts` declares for the debris pass. */
const STRIDE = 20;
/** The synthetic-shatter fallback re-uses u16 triangle indices, so the render mesh must fit them. */
const MAX_SYNTHETIC_VERTICES = 65535;
/** Layer side for the shard atlas; SA prop textures are small and all resample onto one array size. */
const SHARD_TEXTURE_SIZE = 64;

export interface DebrisSource {
  /** Ground height under the prop (GTA Z), probed by the caller. Omit and the shards never land. */
  groundZ?: number;
  /** Impact velocity of whatever hit the prop (GTA Z-up, m/s) — the shards fly away from it. */
  impact?: [number, number, number];
  modelName: string;
  /** The prop's world matrix, column-major (GTA Z-up). */
  transform: readonly number[];
  txdName?: string;
}

/** Bake a break and hand it to the engine. Returns false when the model ships nothing to shatter. */
export function spawnEngineDebris(engine: Engine, fs: AssetFileSystem, source: DebrisSource): boolean {
  const shatter = shatterMeshOf(fs, source.modelName);
  if (!shatter || shatter.triangleMaterials.length === 0) {
    return false;
  }
  const baked = bakeDebris(shatter, source.transform, {
    ...(source.groundZ !== undefined ? { groundZ: source.groundZ } : {}),
    ...(source.impact ? { impact: source.impact } : {}),
  });

  engine.spawnDebris({
    fade: DEBRIS_FADE,
    gravity: DEBRIS_GRAVITY,
    lifetime: DEBRIS_LIFETIME,
    texture: shardTextures(fs, source.txdName, baked),
    vertices: interleave(baked),
  });

  return true;
}

/**
 * Pack the baked shards into the engine's vertex layout, converting GTA Z-up → engine Y-up on the way.
 *
 * The basis change `e = (x, z, −y)` is a proper rotation, so the spin axis (a pseudo-vector) takes it too;
 * getting that wrong would make every shard spin about the wrong axis while still looking plausible.
 */
function interleave(baked: BakedDebris): Float32Array {
  const out = new Float32Array(baked.vertexCount * STRIDE);
  const layerOf = new Float32Array(baked.vertexCount);
  baked.groups.forEach((group, layer) => {
    for (let vertex = group.start / 3; vertex < (group.start + group.count) / 3; vertex += 1) {
      layerOf[vertex] = layer;
    }
  });
  for (let vertex = 0; vertex < baked.vertexCount; vertex += 1) {
    const at = vertex * STRIDE;
    const gta = (source: Float32Array, index: number, axis: number): number =>
      axis === 0 ? source[index * 3] : axis === 1 ? source[index * 3 + 2] : -source[index * 3 + 1];
    for (let axis = 0; axis < 3; axis += 1) {
      out[at + axis] = gta(baked.position, vertex, axis);
      out[at + 9 + axis] = gta(baked.center, vertex, axis);
      out[at + 12 + axis] = gta(baked.velocity, vertex, axis);
      out[at + 15 + axis] = gta(baked.angular, vertex, axis);
    }
    out[at + 3] = baked.uv[vertex * 2];
    out[at + 4] = baked.uv[vertex * 2 + 1];
    out.set(baked.color.subarray(vertex * 4, vertex * 4 + 4), at + 5);
    out[at + 18] = baked.landTime[vertex];
    out[at + 19] = layerOf[vertex];
  }

  return out;
}

/** The prop as you see it, wrapped in the same shard structure (the u16 index cap is why props only). */
function renderMeshOf(fs: AssetFileSystem, modelName: string): ReturnType<typeof getBreakable> {
  try {
    const geometry = getClump(fs, modelName).geometries[0];

    return geometry && geometry.positions.length / 3 <= MAX_SYNTHETIC_VERTICES
      ? breakableFromGeometry(geometry)
      : undefined;
  } catch {
    return undefined;
  }
}

function resample(source: { height: number; rgba: Uint8Array; width: number }): Uint8Array {
  const out = new Uint8Array(SHARD_TEXTURE_SIZE * SHARD_TEXTURE_SIZE * 4);
  for (let y = 0; y < SHARD_TEXTURE_SIZE; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor((y / SHARD_TEXTURE_SIZE) * source.height));
    for (let x = 0; x < SHARD_TEXTURE_SIZE; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor((x / SHARD_TEXTURE_SIZE) * source.width));
      out.set(
        source.rgba.subarray((sy * source.width + sx) * 4, (sy * source.width + sx) * 4 + 4),
        (y * SHARD_TEXTURE_SIZE + x) * 4,
      );
    }
  }

  return out;
}

/** One layer per draw group. A missing texture becomes plain white — the shard keeps its vertex colours. */
function shardTextures(fs: AssetFileSystem, txdName: string | undefined, baked: BakedDebris): ModelTextureInit {
  const layers = Math.max(1, baked.groups.length);
  const rgba = new Uint8Array(layers * SHARD_TEXTURE_SIZE * SHARD_TEXTURE_SIZE * 4).fill(255);
  // The TXD lives in the IMG under its BARE name, not under models/ — the wrong path silently yielded no
  // texture, and the shards came out grey with only their vertex colours. `getTxdChain` also walks the
  // `txdp` parents, so an inherited texture is found too (opensa-pack 003).
  const chain = txdName ? getTxdChain(fs, txdName) : [];
  if (chain.length === 0) {
    return { height: SHARD_TEXTURE_SIZE, kind: 'rgba', layers, rgba, width: SHARD_TEXTURE_SIZE };
  }
  const textures = new Map<string, { height: number; rgba: Uint8Array; width: number }>();
  // Child first: the first TXD to define a name wins, which is what `txdp` inheritance means.
  for (const texture of chain.flatMap((bytes) => parseTxd(bytes).textures)) {
    const name = texture.name.toLowerCase();
    if (textures.has(name)) {
      continue; // already defined by a nearer TXD in the chain — a parent must never overwrite its child
    }
    const base = texture.mipmaps[0];
    const pixels =
      texture.format === 'rgba8888'
        ? new Uint8Array(base.data)
        : decodeDxt(texture.format, base.data, base.width, base.height);
    textures.set(name, { height: base.height, rgba: pixels, width: base.width });
  }
  baked.groups.forEach((group, layer) => {
    const source = textures.get(group.texture.toLowerCase());
    if (source) {
      rgba.set(resample(source), layer * SHARD_TEXTURE_SIZE * SHARD_TEXTURE_SIZE * 4);
    }
  });

  return { height: SHARD_TEXTURE_SIZE, kind: 'rgba', layers, rgba, width: SHARD_TEXTURE_SIZE };
}

/** The DFF's own shatter mesh, or — for the smash props that ship none (boxes, bags) — its render mesh. */
function shatterMeshOf(fs: AssetFileSystem, modelName: string): ReturnType<typeof getBreakable> {
  return getBreakable(fs, modelName) ?? renderMeshOf(fs, modelName);
}
