import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { openLazyVer2 } from '@opensa/tool-kit/archive/layout';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { join } from 'node:path';

/**
 * Every DXT texture in a tree's `models/gta3.img` whose top level is NOT a multiple of 4 on both sides — the
 * raster the real game refuses, taking its whole dictionary (and every model on it) down with it
 * (`docs/restrictions/dxt-raster-dimensions.md`; open issue `sa-lod-visibility-budget.md` round 16). Also counts
 * the non-power-of-two textures (4-aligned ones LOAD — listed only with `--npot`). Stock: 26 004 textures, 0 of
 * either. This census is what turned "~6 LODs missing all over the city" into five named dictionaries.
 *
 * Run:
 *   npx tsx scripts/debug/txd-dimension-census.ts --game <game dir> [--filter '^salod'] [--npot]
 */
function main(): void {
  const game = fromCwd(argValue('--game') ?? 'game-src/original');
  const filterArg = argValue('--filter');
  const filter = filterArg === undefined ? null : new RegExp(filterArg, 'i');
  const listNpot = process.argv.includes('--npot');
  const img = openLazyVer2(join(game, 'models', 'gta3.img'));
  if (!img) {
    throw new Error(`${game}/models/gta3.img is not a VER2 archive`);
  }
  const isPow2 = (n: number): boolean => (n & (n - 1)) === 0;
  let dictionaries = 0;
  let textures = 0;
  let npot = 0;
  const fatal: string[] = [];
  const npotOnly: string[] = [];
  for (const name of img.names) {
    if (!name.toLowerCase().endsWith('.txd') || (filter && !filter.test(name))) {
      continue;
    }
    let dictionary;
    try {
      dictionary = parseTxd(img.get(name)!);
    } catch {
      continue;
    }
    dictionaries += 1;
    for (const texture of dictionary.textures) {
      textures += 1;
      const { height, width } = texture;
      const dxt = String(texture.format).startsWith('dxt');
      const line = `${name}: ${texture.name} ${width}x${height} ${texture.format} mips=${texture.mipmaps.length}`;
      if (dxt && (width % 4 !== 0 || height % 4 !== 0)) {
        fatal.push(line);
      } else if (!isPow2(width) || !isPow2(height)) {
        npot += 1;
        npotOnly.push(line);
      }
    }
  }
  console.log(
    `${game}: ${dictionaries} dictionaries, ${textures} textures — ` +
      `DXT not block-aligned (FATAL): ${fatal.length}, non-power-of-two but aligned (loads): ${npot}`,
  );
  for (const line of fatal) {
    console.log(`  FATAL ${line}`);
  }
  if (listNpot) {
    for (const line of npotOnly) {
      console.log(`  npot  ${line}`);
    }
  }
}

main();
