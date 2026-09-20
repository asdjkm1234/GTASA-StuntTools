/**
 * sa-procobj-placement CLI. Bakes GTA-SA procobj scatter species into static, PERMANENT IPL instances at
 * `lod = -1`, with their range raised in the stock `procobj.ide` (plan 014 — no LOD twin, no binary stream).
 * Usage:
 *   tsx tools/sa-procobj-placement/src/cli.ts --out <path> --game <path> [--in <dir>]
 *     --in      optional folder holding the HD procobj models (`<model>.dff` + `<model>.txd`), intersected with
 *               procobj.dat to pick the species; when omitted, **all** procobj.dat species are converted straight
 *               from the game's own gta3.img (no model/texture swap)
 *     --out     output drop-in directory
 *     --game    game-data dir (gta.dat + data/ + models/gta3.img)
 *     --draw    draw distance written onto the baked species' stock procobj.ide rows, in game units — the
 *               layer's only range mechanism. Must stay under 300 (default from config: 299)
 *     --max     cap on converted procobj objects (0 disables; default from config)
 *     --species-floor  objects every species with a candidate is guaranteed per 250 u cell (default 1, 0 = off)
 *     --slope <steep,flat>  ROCK candidate multipliers on steep vs flat faces (plan 011). Omitted = unchanged
 *     --sampler <area|corner>  where in a triangle a placement lands — ours, or the original's corner-biased
 *               routine (plan 010 task 12). Default area
 *     --height  optional min HD height (m) gate, drops short clutter (0 = off; default from config)
 *     --density scatter density cutoff, 1 = vanilla, max 3 (the scatter's candidate ceiling). The placed
 *               count scales with it until MINDIST or `--max` binds; the run prints the density it used
 *     --target  the host this layer is built FOR (sa|opensa, default sa) — it names which ceilings the layer's
 *               cost is reported against; pmb passes the whole build's target down (see its `--target`)
 *     --prelight [info]  copy the stock model's prelight onto the swapped HD (with `--in`); foliage kept. Optionally pass `--prelight ./info.json` of per-model `{ "<model>": { "skip": true } }`
 *                        overrides to opt a model out of the transfer.
 *     --modloader emit TWO Modloader mods (real game) under `<out>`: `lod/` (the permanent IPLs + the raised
 *                 procobj.ide + stripped `procobj.dat` + a `loader.txt` of IPL lines) and `hd/` (the swapped HD
 *                 models + custom TXD, parented via a `txdp` IDE so NO stock IDE is rewritten). No `gta.dat` patch.
 *                 Without it, writes into `<out>` + patches `data/gta.dat`, HD swap inlined into gta3.img.
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import type { ProcObjSlopeConfig } from '@opensa/renderware/map/procobj-scatter';

import { parsePrelightInfo, type PrelightInfo } from '@opensa/lod-common/prelight';
import { parseBuildTarget } from '@opensa/tool-kit/target';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { run } from './build';
import { config } from './config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const inArg = argValue('--in');
  const outArg = argValue('--out');
  const gameArg = argValue('--game');

  if (!outArg || !gameArg) {
    throw new Error('usage: tsx tools/sa-procobj-placement/src/cli.ts --out <path> --game <path> [--in <dir>]');
  }

  const inPath = inArg === undefined ? undefined : fromCwd(inArg);
  const outPath = fromCwd(outArg);
  const gamePath = fromCwd(gameArg);

  if (inPath !== undefined && !existsSync(inPath)) {
    throw new Error(`--in not found: ${inPath}`);
  }
  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gamePath}`);
  }
  mkdirSync(outPath, { recursive: true });

  const merged = {
    ...config,
    density: Number(argValue('--density') ?? config.density),
    drawDistance: Number(argValue('--draw') ?? config.drawDistance),
    procObjHeight: Number(argValue('--height') ?? config.procObjHeight),
    procObjMax: Number(argValue('--max') ?? config.procObjMax),
    procObjSpeciesFloor: Number(argValue('--species-floor') ?? config.procObjSpeciesFloor),
    ...slopeArg(argValue('--slope')),
    ...(argValue('--sampler') === 'corner' ? { procObjSampler: 'corner' as const } : {}),
  };

  const modloader = process.argv.includes('--modloader');
  const prelight = process.argv.includes('--prelight');

  // `--prelight` is a bare flag, OR `--prelight <info.json>` of per-model overrides (a following non-flag token).
  const prelightArg = argValue('--prelight');
  let prelightInfo: PrelightInfo | undefined;
  if (prelight && prelightArg !== undefined && !prelightArg.startsWith('--')) {
    const file = fromCwd(prelightArg);
    if (!existsSync(file)) {
      throw new Error(`--prelight info file not found: ${file}`);
    }
    prelightInfo = parsePrelightInfo(readFileSync(file, 'utf8'));
  }

  run({
    config: merged,
    gamePath,
    inPath,
    modloader,
    outPath,
    prelight,
    prelightInfo,
    target: parseBuildTarget(argValue('--target')) ?? 'sa',
  });
}

/** `--slope <steep>,<flat>`: the rock-category multipliers, matching the host's `?procobjSlope=`. */
function slopeArg(raw: string | undefined): { procObjSlope?: ProcObjSlopeConfig } {
  if (raw === undefined) {
    return {};
  }
  const [steep, flat] = raw.split(',').map(Number);
  if (!Number.isFinite(steep) || steep < 0) {
    throw new Error(`--slope wants <steep>[,<flat>] as non-negative numbers: got '${raw}'.`);
  }

  return { procObjSlope: { flat: { rocks: Number.isFinite(flat) && flat >= 0 ? flat : 1 }, steep: { rocks: steep } } };
}

main();
