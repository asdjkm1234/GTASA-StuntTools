import type { OspakManifest } from '@opensa/engine-formats';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { encodeLodTxd } from '@opensa/lod-common/encode-txd';
import { type ScopedRegistry, scopedSource } from '@opensa/lod-common/scoped-texture';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { convertDistrict } from '@opensa/opensa-pack/convert';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { formatBuildTime } from '@opensa/opensa-pack/pack';
import { buildVer2Buffer, type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Asset } from '../../tools/map-optimizer/src/core/asset';
import type { MapData, PlacedInstance } from '../lib/game';

import { encodeDff } from '../../tools/map-optimizer/src/adapters/gta-sa/codec/dff';
import { clumpToIr } from '../../tools/map-optimizer/src/adapters/gta-sa/read';
import { createDedupeFaces } from '../../tools/map-optimizer/src/plugins/dedupe-faces';
import { createRemoveDegenerateTriangles } from '../../tools/map-optimizer/src/plugins/degenerate-triangles';
import { createPruneVertices } from '../../tools/map-optimizer/src/plugins/prune-vertices';
import { createSmoothNormals } from '../../tools/map-optimizer/src/plugins/smooth-normals';
import { createWeldVertices } from '../../tools/map-optimizer/src/plugins/weld-vertices';
import { createGtaSaLodAdapter } from '../../tools/opensa-lod-generator/src/adapters/gta-sa';
import { cellModelName, SHARED_TXD } from '../../tools/opensa-lod-generator/src/adapters/gta-sa/finalize';
import { config as lodConfig } from '../../tools/opensa-lod-generator/src/lod.config';
import { loadMapDefsAt, readBytes } from '../lib/game';
import { indexModAssets, type ModAssets, resolveDff, resolveTxd } from '../lib/mod-assets';

/**
 * model-repack — swap EXPERIMENTAL versions of world models into a servable copy of the built game
 * WITHOUT a full rebuild (map-optimizer plan 024 phase 0). The engine renders the static world from
 * `pak/world.ospak` welded cells, so editing a DFF in the built tree changes nothing — this script
 * re-welds only the cells the target models touch:
 *
 *   1. resolves each rect model's source DFF/TXD the way the build does (last mod shipping the file
 *      wins, numeric folder order; PNG texture-folders are replayed onto the TXD; vanilla otherwise),
 *   2. re-runs the map-optimizer GEOMETRY chain in-memory (weld → degenerate → dedupe → prune →
 *      smooth-normals) — targets get the experimental options, neighbours the build defaults,
 *   3. re-bakes the rect's CELL LODs the way `opensa-lod-generator` does (`bakeCell` over the overlay,
 *      overlay archive first, so the swapped HD is what the far view is cut from — opensa-lod-generator plan 007): the
 *      `lod_<cx>_<cy>.dff` cells + a rect-scoped `lods.txd` land in the overlay and shadow the built ones,
 *   4. feeds convertDistrict a synthetic game dir (built `data/` + built IMGs for streams/collision,
 *      regenerated models + rebaked LODs as an overlay) with a rect covering just the affected cells,
 *   5. writes `build/<game>/opensa-lab` — a per-file-symlink mirror of the built game whose `pak/`
 *      is the freshly welded rect — servable by `npm run serve:static` like the real build.
 *
 * Known caveats (fine for an A/B eyeball of ONE model, documented in plan 024 phase 0 + opensa-lod-generator plan 007):
 *   - world-context prelight passes (019 level/seam/night verdicts) and texture mips are NOT
 *     replayed — neighbours may differ slightly from the main build;
 *   - generated LOD models (trees/procobj) have no source here → the lab cells' LOD level is thinner,
 *     and the rebaked cell LODs are cut without the pipeline's `excludeItems` (generated models);
 *   - `.osm` props reference the MAIN pak's texture dictionary → props inside the lab rect may lose
 *     textures. World geometry — the thing under test — is welded correctly.
 *   - the lab pak is a SEPARATE small pak: it never patches `build/<game>/opensa/pak` (the shipping
 *     pak's texture layer indexes are not persisted, so a subset weld cannot reproduce them — see opensa-lod-generator plan 007).
 *
 * Run: npx tsx scripts/debug/model-repack.ts <model...> [--game original] [--strip-normals]
 *      [--crease <deg>] [--prelit-floor <luma>] [--margin <cells>] [--no-ao] [--no-lod] [--out <dir>]
 *      [--dff <file.dff> [--txd <file.txd>]]      (ONE target: a mod's loose files instead of the resolved source)
 *   --strip-normals      drop the targets' authored normals before the chain (forces a clean rebuild)
 *   --crease <deg>       per-run crease override for the targets' smooth-normals rebuild
 *   --prelit-floor <l>   lift the targets' day prelit to a luma floor (Family B ambient experiment)
 *   --margin <n>         extra cell ring around the targets' cells (default 0)
 *   --no-lod             keep the built cell LODs (skip the rebake — the far view stays the old model)
 *   --dff/--txd          swap a LOOSE file in for the single target (its txd under the target's txd name)
 * Then: npm run serve:static  →  app with ?src=/build/<game>/opensa-lab
 * Teleports: npx tsx scripts/debug/teleport-spot.ts <model> --game <game>
 */

interface Args {
  ao: boolean;
  crease: number | undefined;
  /** A loose `.dff` for the single target — a mod's file before it is installed. */
  dff: string | undefined;
  game: string;
  /** Re-bake the rect's cell LODs from the overlay (default on). */
  lod: boolean;
  margin: number;
  /** With --no-mods: models that STILL resolve from mods (file-level bisection). */
  modOnly: Set<string>;
  /** Resolve DFF/TXD from VANILLA only, ignoring mods (bisection lever). */
  noMods: boolean;
  out: string;
  prelitFloor: number | undefined;
  /** Bypass the optimizer chain entirely (bisection lever): weld the RESOLVED source bytes. */
  raw: boolean;
  stripNormals: boolean;
  targets: string[];
  /** A loose `.txd` for the single target, written under the target's OWN txd name. */
  txd: string | undefined;
}

/** The servable lab dir: symlink mirror of the built game, `pak/` replaced by the lab weld. */
function assembleLab(args: Args, builtDir: string, manifest: OspakManifest, pak: Uint8Array, report: object): void {
  rmSync(args.out, { force: true, recursive: true });
  mirrorWithFileSymlinks(builtDir, args.out, new Set(['pak']));
  const pakDir = join(args.out, 'pak');
  mkdirSync(pakDir, { recursive: true });
  writeFileSync(join(pakDir, 'world.ospak'), pak);
  // Water comes from the main pak verbatim — the lab weld skips the bake.
  const mainManifest = JSON.parse(readFileSync(join(builtDir, 'pak', 'manifest.json'), 'utf8')) as OspakManifest;
  if (mainManifest.water && process.env.LAB_NO_WATER !== '1') {
    manifest.water = mainManifest.water;
    symlinkSync(resolve(builtDir, 'pak', mainManifest.water.file), join(pakDir, mainManifest.water.file));
  }
  manifest.buildTime = formatBuildTime(new Date());
  manifest.game = `${args.game}-lab`;
  writeFileSync(join(pakDir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(pakDir, 'report.json'), JSON.stringify(report, null, 2));
}

/**
 * Re-bake the rect's cell LODs from the overlay, the way `opensa-lod-generator` does (opensa-lod-generator plan 007): the swapped HD
 * is what the far view is cut from, so an HD-only swap would leave the lab's LOD level showing the OLD model.
 * The overlay archive is searched FIRST (`createModelSource` is first-wins), then the SOURCE game's archives; the
 * built `lod_*` cells themselves are excluded from the bake or they would be merged in as HD twice.
 * Emits `lod_<cx>_<cy>.dff` + ONE `lods.txd` scoped to the rect's cells into the overlay — both shadow the
 * built entries by basename, and the lab pak welds only the rect, so a rect-scoped dictionary is complete.
 */
function bakeRectLods(
  rect: readonly [number, number, number, number],
  inputDir: string,
  overlayDir: string,
  vanilla: ImgArchive,
  game: string,
): number {
  if (lodConfig.cellSize !== CELL_SIZE) {
    throw new Error(`lod cellSize ${lodConfig.cellSize} ≠ render CELL_SIZE ${CELL_SIZE} — the lab cannot rebake`);
  }
  const overlayArchive = openArchive(
    buildVer2Buffer(
      readdirSync(overlayDir)
        .filter((name) => /\.(?:dff|txd)$/i.test(name))
        .map((name) => ({ data: new Uint8Array(readFileSync(join(overlayDir, name))), name })),
    ),
  );
  // The built archives hold `.osm` where the HD `.dff`s were — the bake reads the overlay, then the SOURCE game.
  const archives = [overlayArchive, vanilla];
  const lodNames = builtLodCellNames(inputDir);
  const excludeItems = [...(lodConfig.excludeItems ?? []), ...lodNames];
  const adapter = createGtaSaLodAdapter(game, inputDir, { ...lodConfig, excludeItems }, { archives });
  const [x0, y0, x1, y1] = rect;
  const cells = adapter
    .resolveCells()
    .filter((cell) => cell.cx >= x0 && cell.cx <= x1 && cell.cy >= y0 && cell.cy <= y1);
  const registry: ScopedRegistry = new Map();
  const textures = new Set<string>();
  for (const cell of cells) {
    const baked = adapter.bakeCell(cell);
    const name = cellModelName(cell.cx, cell.cy);
    writeFileSync(
      join(overlayDir, `${name}.dff`),
      encodeLodDff(baked.mesh, name, { doubleSided: true, ...(baked.effects ? { effects: baked.effects } : {}) }),
    );
    for (const group of baked.mesh.groups) if (group.texture.length > 0) textures.add(group.texture);
    for (const [scoped, entry] of baked.textureMap ?? []) registry.set(scoped, entry);
  }
  writeFileSync(
    join(overlayDir, `${SHARED_TXD}.txd`),
    encodeLodTxd(
      [...textures].sort(),
      scopedSource(createTextureSource(archives), registry),
      lodConfig.lodTextureSize,
      'linear',
    ),
  );

  return cells.length;
}

/** Regenerate every rect model's DFF (targets with the experimental options) + TXDs into the overlay. */
function buildOverlay(
  rectModels: ReadonlyMap<string, { txd: string }>,
  mods: ModAssets,
  vanilla: ImgArchive,
  args: Args,
  overlayDir: string,
): void {
  const targetSet = new Set(args.targets);
  const missing: string[] = [];
  const txdsNeeded = new Set<string>();
  for (const [model, { txd }] of rectModels) {
    txdsNeeded.add(txd);
    const isTarget = targetSet.has(model);
    const source = isTarget && args.dff ? looseSource(args.dff) : resolveDff(model, mods, vanilla);
    if (!source) {
      // The built `lod_<cx>_<cy>` cells have no source by design — the LOD rebake writes them into the overlay next.
      if (!/^lod_-?\d+_-?\d+$/.test(model)) missing.push(model);
      continue;
    }
    const options = isTarget
      ? { crease: args.crease, prelitFloor: args.prelitFloor, stripNormals: args.stripNormals }
      : {};
    writeFileSync(
      join(overlayDir, `${model}.dff`),
      args.raw ? source.bytes : runGeometryChain(model, source.bytes, options),
    );
    if (isTarget) console.log(`· target ${model}: ${describeTarget(args, source.from)}`);
  }
  if (missing.length > 0) {
    console.warn(
      `  ⚠ no DFF source for ${missing.length} model(s) (generated LODs etc.): ${missing.slice(0, 8).join(', ')}…`,
    );
  }
  for (const txd of txdsNeeded) {
    const bytes = resolveTxd(txd, mods, vanilla);
    if (bytes) writeFileSync(join(overlayDir, `${txd}.txd`), bytes);
  }
  if (args.txd) writeLooseTxd(args.txd, args.targets[0], rectModels, overlayDir);
}

/** The `lod_<cx>_<cy>` names the built tree's `data/maps/lods.ide` declares — the previous bake's output. */
function builtLodCellNames(inputDir: string): string[] {
  const path = join(inputDir, 'data', 'maps', 'lods.ide');
  if (!existsSync(path)) return [];

  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*\d+\s*,\s*([^,\s]+)/.exec(line)?.[1]?.toLowerCase())
    .filter((name): name is string => name !== undefined);
}

/** Every model with an instance inside the rect — the welded cells must be complete. */
function collectRectModels(
  defs: MapData,
  rect: readonly [number, number, number, number],
): Map<string, { txd: string }> {
  const rectModels = new Map<string, { txd: string }>();
  for (const instance of defs.instances) {
    const cx = Math.floor(instance.position[0] / CELL_SIZE);
    const cy = Math.floor(instance.position[1] / CELL_SIZE);
    if (cx < rect[0] || cx > rect[2] || cy < rect[1] || cy > rect[3]) continue;
    const def = defs.catalog.get(instance.id);
    if (def) rectModels.set(def.modelName.toLowerCase(), { txd: def.txdName.toLowerCase() });
  }

  return rectModels;
}

/** The targets' pivot cells ± margin, as an inclusive GTA cell rect. */
function computeRect(placements: readonly PlacedInstance[], margin: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of placements) {
    x0 = Math.min(x0, Math.floor(p.position[0] / CELL_SIZE));
    x1 = Math.max(x1, Math.floor(p.position[0] / CELL_SIZE));
    y0 = Math.min(y0, Math.floor(p.position[1] / CELL_SIZE));
    y1 = Math.max(y1, Math.floor(p.position[1] / CELL_SIZE));
  }

  return [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
}

/** Human line for a target's source + the experimental options applied to it. */
function describeTarget(args: Args, from: string): string {
  const parts = [from === 'vanilla' ? 'vanilla' : `mod (${from})`];
  if (args.stripNormals) parts.push('strip-normals');
  if (args.crease !== undefined) parts.push(`crease ${args.crease}`);
  if (args.prelitFloor !== undefined) parts.push(`prelit-floor ${args.prelitFloor}`);

  return parts.join(' + ');
}

/**
 * Field-experiment lever for plan 024 Family B: lift day-prelit vertices below `floor` luma up to it,
 * hue-preserving (pure black becomes grey `floor`). Emulates ON THE DATA the ambient term real SA adds
 * on top of prelit — if a black wall reads correctly with the floor, the missing-engine-ambient theory
 * is field-proven. Alpha is never touched (vegetation sway / beam semantics ride prelit alpha).
 */
function floorPrelit(prelit: null | Uint8Array, floor: number): boolean {
  if (!prelit) return false;
  let changed = false;
  for (let i = 0; i < prelit.length; i += 4) {
    const l = 0.299 * prelit[i] + 0.587 * prelit[i + 1] + 0.114 * prelit[i + 2];
    if (l >= floor) continue;
    changed = true;
    if (l < 1) {
      prelit[i] = prelit[i + 1] = prelit[i + 2] = Math.round(floor);
    } else {
      const scale = floor / l;
      prelit[i] = Math.min(255, Math.round(prelit[i] * scale));
      prelit[i + 1] = Math.min(255, Math.round(prelit[i + 1] * scale));
      prelit[i + 2] = Math.min(255, Math.round(prelit[i + 2] * scale));
    }
  }

  return changed;
}

/** The curated stochastic de-tiling list — same default the full pack uses. */
function loadStochastic(): Set<string> {
  const names = new Set<string>();
  const path = join('tools', 'opensa-pack', 'data', 'stochastic.txt');
  if (!existsSync(path)) return names;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith('#') && !line.startsWith('//')) names.add(line.toLowerCase());
  }

  return names;
}

/** A mod's loose `.dff`, in the shape `resolveDff` returns. */
function looseSource(file: string): { bytes: Uint8Array; from: string } {
  return { bytes: new Uint8Array(readFileSync(file)), from: `loose ${file}` };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const builtDir = join('build', args.game, 'opensa');
  const modsDir = join('mods-src', args.game, 'mods');
  if (!existsSync(builtDir)) throw new Error(`built game dir not found: ${builtDir}`);

  console.log(`· reading built tree ${builtDir} …`);
  const builtArchive = openArchive(readBytes(join(builtDir, 'models', 'gta3.img')));
  const defs = loadMapDefsAt(builtDir, builtArchive);
  // EVERY archive of the source game, not `gta3.img` alone: a TC ships its world in its own (`gostown6.img`),
  // and the built tree cannot serve as the fallback — the pack replaced every converted `.dff` with an `.osm`.
  const vanilla = openArchiveIndex(join('game-src', args.game));

  const targetSet = new Set(args.targets);
  const placements = defs.instances.filter((i) =>
    targetSet.has((defs.catalog.get(i.id)?.modelName ?? i.modelName ?? '').toLowerCase()),
  );
  if (placements.length === 0) throw new Error(`no placed instances of ${args.targets.join(', ')}`);
  const rect = computeRect(placements, args.margin);
  console.log(`· targets placed ${placements.length}× → rect ${rect.join(',')}`);
  const rectModels = collectRectModels(defs, rect);
  console.log(`· rect holds ${rectModels.size} distinct models`);

  console.log(`· indexing ${modsDir} …`);
  const allMods = indexModAssets(modsDir);
  const mods =
    args.noMods && args.modOnly.size === 0
      ? { dff: new Map<string, string>(), txd: new Map<string, { kind: 'file' | 'png'; path: string }[]>() }
      : args.noMods
        ? {
            dff: new Map([...allMods.dff].filter(([k]) => args.modOnly.has(k))),
            txd: allMods.txd, // txds stay modded — the dff is the bisection unit here
          }
        : allMods;

  // Synthetic convert input: built data/ + built IMGs (streams/collision) + regenerated model overlay.
  const labRoot = join('build', args.game, '.opensa-lab');
  const inputDir = join(labRoot, 'input');
  const overlayDir = join(labRoot, 'overlay');
  rmSync(labRoot, { force: true, recursive: true });
  mkdirSync(overlayDir, { recursive: true });
  mkdirSync(join(inputDir, 'models'), { recursive: true });
  symlinkSync(resolve(builtDir, 'data'), join(inputDir, 'data'));
  for (const img of readdirSync(join(builtDir, 'models')).filter((n) => n.toLowerCase().endsWith('.img'))) {
    symlinkSync(resolve(builtDir, 'models', img), join(inputDir, 'models', img));
  }
  buildOverlay(rectModels, mods, vanilla, args, overlayDir);
  if (args.lod) {
    const started = Date.now();
    const baked = bakeRectLods(rect, inputDir, overlayDir, vanilla, args.game);
    console.log(`· rebaked ${baked} cell LOD(s) from the overlay in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }

  console.log(`· welding rect ${rect.join(',')} (ao ${args.ao ? 'on' : 'off'}) …`);
  const fs = openGameDir(inputDir, [overlayDir]);
  const { manifest, pak, report } = await convertDistrict(fs, {
    ao: args.ao,
    cellSize: CELL_SIZE,
    log: (message): void => console.log(`  [convert] ${message}`),
    rect,
    stochasticNames: loadStochastic(),
    sunVis: false,
  });
  assembleLab(args, builtDir, manifest, pak, report);

  console.log(`\n✔ lab build → ${args.out}`);
  console.log(`  pak: ${(pak.byteLength / 1048576).toFixed(1)} MB, ${Object.keys(manifest.cells).length} cell entries`);
  console.log(`  serve:  npm run serve:static`);
  console.log(`  app:    ?src=/${args.out.replace(/\\/g, '/')}\n`);
  for (const target of args.targets) {
    console.log(`  teleport: npx tsx scripts/debug/teleport-spot.ts ${target} --game ${args.game}`);
  }
  for (const p of placements.slice(0, 6)) {
    const name = defs.catalog.get(p.id)?.modelName ?? p.modelName;
    console.log(`    ${name} @ ${p.position.map((v) => v.toFixed(1)).join(', ')}`);
  }
}

/** Mirror `src` into `dst` as REAL directories + per-file symlinks (serve-static's index walks Dirents,
 *  so a symlinked directory would read as an opaque file — files must be the symlinked unit). */
function mirrorWithFileSymlinks(src: string, dst: string, skip: ReadonlySet<string>): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) mirrorWithFileSymlinks(from, to, new Set());
    else symlinkSync(resolve(from), to);
  }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const targets: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const VALUE_FLAGS = new Set([
    '--crease',
    '--dff',
    '--game',
    '--margin',
    '--mod-only',
    '--out',
    '--prelit-floor',
    '--txd',
  ]);
  const BOOL_FLAGS = new Set(['--no-ao', '--no-lod', '--no-mods', '--raw', '--strip-normals']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) values.set(arg, argv[++i]);
    else if (BOOL_FLAGS.has(arg)) flags.add(arg);
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`);
    else targets.push(arg.toLowerCase());
  }
  const number = (flag: string): number | undefined => (values.has(flag) ? Number(values.get(flag)) : undefined);
  const game = values.get('--game') ?? 'original';
  const dff = values.get('--dff');
  const txd = values.get('--txd');
  if (targets.length === 0) throw new Error('usage: model-repack.ts <model...> [--strip-normals] [--crease N]');
  if ((dff || txd) && targets.length !== 1) throw new Error('--dff/--txd take exactly ONE target model');
  if (txd && !dff) throw new Error('--txd needs --dff (a texture swap alone is --raw with a mod folder)');

  return {
    ao: !flags.has('--no-ao'),
    crease: number('--crease'),
    dff,
    game,
    lod: !flags.has('--no-lod'),
    margin: number('--margin') ?? 0,
    modOnly: new Set(
      (values.get('--mod-only') ?? '')
        .split(',')
        .filter(Boolean)
        .map((m) => m.toLowerCase()),
    ),
    noMods: flags.has('--no-mods'),
    out: values.get('--out') ?? join('build', game, 'opensa-lab'),
    prelitFloor: number('--prelit-floor'),
    raw: flags.has('--raw'),
    stripNormals: flags.has('--strip-normals'),
    targets,
    txd,
  };
}

/** Run the map-optimizer geometry chain on one DFF; returns re-encoded bytes (or source on failure). */
function runGeometryChain(
  name: string,
  source: Uint8Array,
  options: { crease?: number; prelitFloor?: number; stripNormals?: boolean },
): Uint8Array {
  try {
    const clump = parseDff(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer,
    );
    const ir = clumpToIr(clump);
    if (options.stripNormals) for (const mesh of ir.meshes) mesh.normals = null;
    let floored = false;
    if (options.prelitFloor !== undefined) {
      for (const mesh of ir.meshes) floored = floorPrelit(mesh.prelitColors, options.prelitFloor) || floored;
    }
    const asset: Asset = { dirty: false, ir, log: [], meta: {}, name, source };
    const context = { game: 'lab', log: (): void => undefined };
    const plugins = [
      createWeldVertices(),
      createRemoveDegenerateTriangles(),
      createDedupeFaces(),
      createPruneVertices(),
      createSmoothNormals({
        addWhereAbsent: true,
        ...(options.crease !== undefined ? { creaseFor: (): number | undefined => options.crease } : {}),
      }),
    ];
    for (const plugin of plugins) void plugin.transform(asset, context);

    return asset.dirty || options.stripNormals || floored ? encodeDff(source, asset.ir) : source;
  } catch (error) {
    console.warn(`  ⚠ ${name}: geometry chain failed (${(error as Error).message}) — using source bytes`);

    return source;
  }
}

/** The loose dictionary goes under the TARGET's txd name — that is the name every instance resolves. */
function writeLooseTxd(
  file: string,
  target: string,
  rectModels: ReadonlyMap<string, { txd: string }>,
  overlayDir: string,
): void {
  const txd = rectModels.get(target)?.txd;
  if (txd === undefined) throw new Error(`--txd: ${target} is not in the rect, no txd name to write under`);
  writeFileSync(join(overlayDir, `${txd}.txd`), readFileSync(file));
  console.log(`· target ${target}: txd ← loose ${file} (as ${txd}.txd)`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
