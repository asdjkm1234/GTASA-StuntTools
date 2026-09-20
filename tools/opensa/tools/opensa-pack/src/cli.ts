#!/usr/bin/env node
/**
 * `opensa-pack` CLI (plan 074/03) — argv on top of {@link packGameDir}, nothing else. The convert itself is
 * a library (plan 003 phase 6), because its real home is a stage inside perfect-map-builder and a pipeline
 * stage must not go through argv.
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> [--rect x0,y0,x1,y1]
 *     [--no-ao] [--no-models] [--bakes] [--bake-workers N] [--textures astc|bc|rgba8] [--max-texture N]
 *     [--lod-only]
 *     [--map-objects-in-rect]
 *     [--stochastic <file>[,<file>…]]
 *     [--checkpoints <dir> [--resume]]   per-chunk weld checkpoints (pmb plan 006); --resume continues from them
 *
 * **`--resume` here guards the CHUNK PLAN and nothing else.** It refuses a journal whose chunk rects differ,
 * and says nothing about a journal written with different textures, a different game tree or older code — a
 * caller that changes one of those and resumes gets a pak no set of flags reproduces, silently. pmb's own
 * `resume.json` carries the full "sources, flags or code moved" check; a caller driving this CLI directly
 * does not get it and has to bring its own (`scripts/phone.sh` stamps a recipe beside the journal).
 *
 * REMOVED FLAGS (2026-07-19, user): `--cell-size` (the pak and the runtime must agree on it and nothing
 * checked that — it is the `CELL_SIZE` constant now), `--chunk-cells` (a welding tuning knob from the A2
 * speed work; the default stands), `--no-sunvis` (it said exactly what omitting `--bakes` says), and
 * `--wind` — whose wind-ADAPTED vegetation DFFs move into pmb config with the rest of the input data
 * (074/14). Until that lands, unadapted vegetation sways by height-above-base instead of authored
 * per-vertex weights. (`--in <mods-src>` went earlier, 2026-07-17, with the painted cloud panorama.)
 *
 * AO/skyVis is ON BY DEFAULT (2026-07-17 user decision — it replaces prod's SSAO, so a default pak must
 * carry it; `--no-ao` skips it for fast iteration reconverts). `--bakes` gates the HEAVY shadow bake
 * (sun-vis, 074/07): production, bench-ritual and pre-flip converts MUST pass it — without it the direct
 * sun renders unshadowed (bridges/canyons) by design.
 *
 * `--textures astc|bc|rgba8` picks the format the build WRITES — for the world arrays and every model
 * dictionary alike, because a GPU that cannot display one cannot display the other. `bc` (the default) passes
 * SA's own DXT blocks through untouched and is desktop-only. `astc` re-encodes to ASTC 4x4, which every
 * mobile GPU carries and which costs ONE byte per texel — the same as BC3 and a quarter of RGBA8; it costs
 * build time (the encode) and one generation of loss. `rgba8` leaves the pixels uncompressed: portable
 * everywhere, 4x an ASTC payload, and the reference when the question is about the encoder rather than the
 * pipeline. `--rgba8` is the older spelling of `--textures rgba8`.
 *
 * `--bake-collision` writes every cell's collision into the pak (`.oscol`, GAME grid) so the browser never
 * parses a COL — the largest named spike cost there is. Off by default while the runtime still reads the
 * archives; it costs build time and nothing reads the entries yet.
 *
 * `--platforms desktop|mobile[,…]` makes the build ASSERT it can run there. The pack always reports which GPU
 * families its textures allow (world arrays ∪ model dictionaries); naming one turns that report into a build
 * failure, which is the last moment the answer is ours rather than a stranger's phone.
 *
 * `--max-texture N` (power of two) caps every texture's edge, halving both axes together so aspect survives.
 * `--map-objects-in-rect` converts only the map objects `--rect` actually PLACES instead of all ~14 000 the
 * IDEs name — the district lever that turns a phone convert from hours into minutes. Needs an explicit
 * `--rect`; a model left out keeps its `.dff`, so the runtime parses one if anything ever asks for it.
 * With `--textures rgba8` it is what makes a district affordable: RGBA8 costs 4-8x its BC original, and one halving
 * takes three quarters of that back. A capped texture is decoded rather than passed through — a DXT block
 * cannot be resized without decoding it.
 *
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / CELL_SIZE)). OPTIONAL since plan 087:
 * the default auto-fits every cell with content — a fixed rect silently dropped whatever a TC placed
 * outside it (gostown's far islands). Pass it only to convert a deliberate SUBSET (bench districts).
 *
 * OUTPUT (plan 003 phase 1 + 086 phase 8): `--out` is a COPY of `--game` — the chain convention, so every
 * stage hands the next a complete game tree, and the game dir is SELF-CONTAINED: the pak products
 * (`world.ospak`, `manifest.json`, `water.bin`, `report.json`) go to `<out>/pak` (override with
 * `--pak-out`). Point a host at the game dir (`?src=<out>`).
 */
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { statSync } from 'node:fs';

import { packGameDir, type TextureTarget } from './pack';

function arg(name: string): null | string {
  return argValue(`--${name}`) ?? null;
}

async function main(): Promise<void> {
  const gameRaw = arg('game');
  const outRaw = arg('out');
  const rectRaw = arg('rect');
  if (!gameRaw || !outRaw) {
    console.error(
      'usage: opensa-pack --game <dir> --out <dir> [--rect x0,y0,x1,y1] ' +
        '[--pak-out <dir>] [--game-id <id>] [--no-ao] [--no-models] [--bakes] [--bake-workers N] ' +
        '[--textures astc|bc|rgba8] [--astc-threads N] [--max-texture N] [--map-objects-in-rect] [--lod-only] ' +
        '[--platforms desktop|mobile[,…]] [--bake-collision] [--stochastic <file>[,<file>…]] ' +
        '[--vehicles a,b] [--peds a,b]',
    );
    process.exitCode = 2;

    return;
  }
  const rect = rectRaw?.split(',').map(Number);
  if (rect !== undefined && (rect.length !== 4 || rect.some(Number.isNaN))) {
    throw new Error(`bad --rect '${rectRaw}' (want x0,y0,x1,y1 in cell coords)`);
  }
  const bakeWorkers = Number(arg('bake-workers') ?? 0) || undefined;
  const stochastic = (arg('stochastic') ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map(fromCwd);

  const textures = readTextureTarget();
  // `--astc-threads N` caps astcenc's worker pool. Unset means one per core, which is right on a desktop and
  // fatal on a phone: see PackOptions.astcThreads.
  const astcThreads = Number(arg('astc-threads') ?? 0) || 0;
  if (astcThreads < 0) {
    throw new Error(`bad --astc-threads '${astcThreads}' (want a positive count, or omit it for one per core)`);
  }
  const maxTexture = Number(arg('max-texture') ?? 0) || 0;
  if (maxTexture !== 0 && (maxTexture < 4 || (maxTexture & (maxTexture - 1)) !== 0)) {
    throw new Error(`bad --max-texture '${maxTexture}' (want a power of two >= 4, or omit it)`);
  }
  // Per-class subsets: convert two cars instead of the whole roster (minutes instead of hours on a phone).
  // A model left out keeps its .dff/.txd and therefore its ORIGINAL texture format — on an --rgba8 build for
  // a device without BC, spawning one would fail, so whoever passes this must keep it from being spawned.
  const csv = (name: string): string[] =>
    (arg(name) ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  const vehicles = csv('vehicles');
  const peds = csv('peds');
  const gameId = arg('game-id');
  const pakOut = arg('pak-out');
  const platforms = (arg('platforms') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const checkpoints = arg('checkpoints');
  await packGameDir({
    ao: !process.argv.includes('--no-ao'),
    ...(astcThreads > 0 ? { astcThreads } : {}),
    ...(bakeWorkers !== undefined ? { bakeWorkers } : {}),
    bakeCollision: process.argv.includes('--bake-collision'),
    bakes: process.argv.includes('--bakes'),
    ...(maxTexture ? { maxTextureSize: maxTexture } : {}),
    ...(checkpoints ? { checkpointDir: fromCwd(checkpoints), resume: process.argv.includes('--resume') } : {}),
    gameDir: requireDir('game', gameRaw),
    lodOnly: process.argv.includes('--lod-only'),
    mapObjectsInRect: process.argv.includes('--map-objects-in-rect'),
    ...(gameId ? { gameId } : {}),
    models: !process.argv.includes('--no-models'),
    ...(peds.length > 0 ? { peds } : {}),
    outDir: fromCwd(outRaw),
    ...(pakOut ? { pakDir: fromCwd(pakOut) } : {}),
    ...(platforms.length > 0 ? { platforms } : {}),
    ...(rect !== undefined ? { rect: rect as unknown as readonly [number, number, number, number] } : {}),
    ...(stochastic.length > 0 ? { stochasticFiles: stochastic } : {}),
    textures,
    ...(vehicles.length > 0 ? { vehicles } : {}),
  });
}

/**
 * `--textures astc|bc|rgba8`, with `--rgba8` still accepted as its older spelling.
 *
 * The two are rejected when they DISAGREE rather than silently ranked: a script that still passes `--rgba8`
 * and a caller that added `--textures astc` mean two different builds, and picking one of them quietly is how
 * a pak ships in a format nobody asked for.
 */
function readTextureTarget(): TextureTarget {
  const named = arg('textures')?.trim().toLowerCase();
  const legacy = process.argv.includes('--rgba8');
  if (named !== undefined && named !== 'astc' && named !== 'bc' && named !== 'rgba8') {
    throw new Error(`bad --textures '${named}' (want astc, bc or rgba8)`);
  }
  if (named !== undefined && legacy && named !== 'rgba8') {
    throw new Error(`--rgba8 and --textures ${named} disagree — pass one of them`);
  }

  return named ?? (legacy ? 'rgba8' : 'bc');
}

/** A `--flag` that must name an existing directory. */
function requireDir(flag: string, value: string): string {
  const path = fromCwd(value);
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`--${flag} '${value}' is not a directory`);
  }

  return path;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
