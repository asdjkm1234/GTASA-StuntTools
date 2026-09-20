import { stockPrelightColor } from '@opensa/lod-common/prelight';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
/**
 * Load an HD tree the way the pmb `trees` stage does — for the debug scripts that bake impostors in process
 * (`impostor-atlas-census.ts`, `impostor-density.ts`) instead of spending a ~10 min stage.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DecodedTexture, HdTree } from '../../tools/lod-trees-generator/src/core';

import {
  applyTrunkPrelight,
  loadTextures,
  loadTree,
  openTemplateArchive,
} from '../../tools/lod-trees-generator/src/adapters/gta-sa/io';

/** The game tree the stock trunk prelight is read from (the stage's `--prelight`). */
export const GAME_DIR = 'game-src/original';
/** The HD vegetation mod folder the stage bakes from (`--in`). */
export const HD_DIR = 'mods-src/original/vegetation';

/**
 * One HD tree, textured and prelit exactly as the stage bakes it.
 *
 * The textures are resolved across the WHOLE folder because a tree's materials routinely name textures that
 * live in ANOTHER mod's dictionary — load only `<model>.txd` and those materials come out UNTEXTURED, which
 * bakes a solid grey atlas that measures like a perfect canopy.
 */
export function loadHdTree(model: string, hdDir = HD_DIR, gameDir = GAME_DIR): HdTree {
  const dff = join(hdDir, `${model}.dff`);
  if (!existsSync(dff)) {
    throw new Error(`no HD model at ${dff}`);
  }
  const bytes = new Uint8Array(readFileSync(dff));
  const tree = loadTree(bytes, model, resolveTextures(bytes, model, hdDir));
  const stock = openTemplateArchive(gameDir).get(`${model.toLowerCase()}.dff`);
  const trunk = stock ? stockPrelightColor(new Uint8Array(stock)) : null;
  if (trunk) {
    applyTrunkPrelight(tree, trunk);
  }

  return tree;
}

/** Every texture the model's materials name, found across the HD folder's dictionaries (own TXD first). */
function resolveTextures(dffBytes: Uint8Array, model: string, hdDir: string): Map<string, DecodedTexture> {
  // Read the material names off the DFF itself: baking a probe tree with no textures would print io.ts's
  // "not in --txd → untextured" warning for every one of them, which is exactly the wrong thing to log here.
  const wanted = new Set(
    parseDff(dffBytes.buffer.slice(dffBytes.byteOffset, dffBytes.byteOffset + dffBytes.byteLength) as ArrayBuffer)
      .geometries.flatMap((geometry) => geometry.materials.map((material) => material.texture?.name?.toLowerCase()))
      .filter((name): name is string => name !== undefined),
  );
  const own = join(hdDir, `${model}.txd`);
  const files = [
    ...(existsSync(own) ? [own] : []),
    ...readdirSync(hdDir)
      .filter((file) => file.toLowerCase().endsWith('.txd'))
      .map((file) => join(hdDir, file))
      .filter((file) => file !== own),
  ];

  const textures = new Map<string, DecodedTexture>();
  for (const file of files) {
    if (wanted.size === 0) {
      break;
    }
    // Cheap pre-filter: a TextureNative writes its name as plain ASCII, so a dictionary that cannot contain
    // any wanted name is skipped without decoding it (the folder is 81 MB of DXT).
    const raw = readFileSync(file, 'latin1');
    if (![...wanted].some((name) => raw.includes(name))) {
      continue;
    }
    for (const [name, texture] of loadTextures(file)) {
      if (wanted.delete(name)) {
        textures.set(name, texture);
      }
    }
  }
  if (wanted.size > 0) {
    console.log(`  ! ${model}: ${wanted.size} texture(s) found nowhere in ${hdDir}: ${[...wanted].join(', ')}`);
  }

  return textures;
}
