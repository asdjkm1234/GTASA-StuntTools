/**
 * Procedural clutter on the own engine (074/19 B7·d): grass/bushes/rocks scattered per cell from procobj.dat,
 * rendered INSTANCED. The scatter + budget come from {@link GtaSaWorldAdapter.cellClutter} — the SAME memoized
 * scatter the colliders use, so what the engine draws is exactly what physics collides (one budget, no
 * divergence — the field lesson that cost 17 ms/step). Geometry is built through the shared vehicle-model
 * builder (a clutter model is a model with no paint), so no new extractor is needed.
 */
import type { CellClutter, ClutterModelId, ClutterModelInit, Engine } from '@opensa/engine';
import type { CellClutterRender } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { AssetFileSystem } from '@opensa/renderware';

import { decodeOstex, OstexAlphaClass } from '@opensa/engine-formats';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { getClump, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

export interface EngineClutter {
  /** Install (replacing) one streamed cell's clutter from the adapter's render product. */
  applyCell(key: string, renders: readonly CellClutterRender[]): void;
  /** Drop a streamed-out cell's clutter. */
  removeCell(key: string): void;
}

/**
 * How far clutter CELLS must stream: the widest per-category range, because a category cannot be drawn past
 * the radius its cell is loaded at. Each category is then brought back to its own distance by the shader's
 * per-instance cull, so widening this ring costs scatter and upload — never fill.
 */
export function clutterRingRadius(
  procobj: Readonly<Record<string, { drawDistance: number; enabled: boolean }>>,
): number {
  let widest = 0;
  for (const setting of Object.values(procobj)) {
    if (setting.enabled && setting.drawDistance > widest) {
      widest = setting.drawDistance;
    }
  }

  return widest;
}

/**
 * `drawDistanceOf` reads the host's per-category range (`graphics.procobj[category].drawDistance`). It is
 * passed in rather than read here so the engine layer stays free of the app's config shape.
 */
export function setupEngineClutter(
  engine: Engine,
  fs: AssetFileSystem,
  drawDistanceOf: (category: CellClutterRender['category']) => number,
): EngineClutter {
  // One upload per clutter model TYPE (a handful map-wide); null = not renderable (skipped, never crashes).
  const models = new Map<string, ClutterModelId | null>();

  const modelOf = (modelName: string, txdName: string): ClutterModelId | null => {
    const cached = models.get(modelName);
    if (cached !== undefined) {
      return cached;
    }
    let id: ClutterModelId | null = null;
    try {
      id = engine.createClutterModel(optimized(fs, modelName) ?? unoptimized(fs, modelName, txdName));
    } catch {
      id = null;
    }
    models.set(modelName, id);

    return id;
  };

  return {
    applyCell(key, renders): void {
      const entries: CellClutter[] = [];
      for (const render of renders) {
        const model = modelOf(render.modelName, render.txdName);
        if (model !== null) {
          entries.push({
            ...(render.keyHashes ? { keyHashes: render.keyHashes } : {}),
            drawDistance: drawDistanceOf(render.category),
            matrices: gtaMatricesToEngine(render.matrices),
            model,
          });
        }
      }
      engine.setCellClutter(key, entries);
    },
    removeCell(key): void {
      engine.removeCellClutter(key);
    },
  };
}

/** GTA (Z-up) → engine (x, z, −y) for a stream of column-major 4×4 matrices — the same axis change the welded
 *  world takes, applied to each column so instances sit in the baked cells. */
function gtaMatricesToEngine(gta: Float32Array): Float32Array {
  const out = new Float32Array(gta.length);
  for (let base = 0; base < gta.length; base += 16) {
    for (let column = 0; column < 4; column += 1) {
      const at = base + column * 4;
      out[at] = gta[at];
      out[at + 1] = gta[at + 2];
      out[at + 2] = -gta[at + 1];
      out[at + 3] = gta[at + 3];
    }
  }

  return out;
}

/** True when the texture carries transparency — the cutout (A2C) gate for grass/bush cards. */
function hasAlpha(rgba: Uint8Array): boolean {
  for (let at = 3; at < rgba.length; at += 4) {
    if (rgba[at] < 250) {
      return true;
    }
  }

  return false;
}

/**
 * The OPTIMIZED build (opensa-pack 003 phase 5): the species' `.osm` — geometry and its BC dictionary read
 * as sections, no `parseDff`, no TXD decode, on the CELL STREAM path. Null when the species is unconverted.
 *
 * `cutout` comes from the `.ostex` layer classes rather than from scanning every alpha byte: the converter
 * already classified each layer, and the compressed payload has no bytes to scan.
 */
function optimized(fs: AssetFileSystem, modelName: string): ClutterModelInit | null {
  const osm = fs.get(`${modelName.toLowerCase()}.osm`);
  if (!osm) {
    return null;
  }
  const { model } = readModelOsm(modelName, new Uint8Array(osm));
  const texture = model.textures[0];
  // The clutter pipeline draws a whole species in ONE instanced call — it has no submeshes, so it cannot
  // switch texture arrays mid-mesh. A species that planned more than one array must take the unoptimized
  // path, which renders it correctly, rather than silently drawing every leaf out of array 0.
  if (model.textures.length !== 1 || texture.kind !== 'ostex') {
    return null;
  }
  const dictionary = decodeOstex(texture.bytes);

  return {
    colors: model.colors,
    cutout: dictionary.layers.some((layer) => layer.alphaClass !== OstexAlphaClass.OPAQUE),
    indices: model.indices,
    meta: model.meta,
    night: model.night,
    normals: model.normals,
    positions: model.positions,
    texture,
    uvs: model.uvs,
  };
}

/** The UNOPTIMIZED build: a stock or modded DFF/TXD, parsed and built the moment the cell streams in. */
function unoptimized(fs: AssetFileSystem, modelName: string, txdName: string): ClutterModelInit {
  const model = buildVehicleModel(getClump(fs, modelName), new VehicleTextures(getTxdChain(fs, txdName)));
  const bytes = (values: Float32Array): Uint8Array =>
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

  return {
    colors: model.colors,
    // Grass/bushes carry alpha (cutout/A2C); rocks/cacti are opaque — read it off the built texture.
    cutout: hasAlpha(model.texture.rgba),
    indices: new Uint8Array(model.indices.buffer, model.indices.byteOffset, model.indices.byteLength),
    meta: model.meta,
    night: model.night,
    normals: bytes(model.normals),
    positions: bytes(model.positions),
    texture: {
      height: model.texture.height,
      kind: 'rgba',
      layers: model.texture.layers,
      rgba: model.texture.rgba,
      width: model.texture.width,
    },
    uvs: bytes(model.uvs),
  };
}
