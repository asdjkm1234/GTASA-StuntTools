import type { TexturePlanner } from '@opensa/cell-weld/textures';
/**
 * `opensa-pack` as a LIBRARY (plan opensa-pack/003 phase 6).
 *
 * The converter's real home is a stage inside perfect-map-builder, where the full modded game is assembled —
 * and a pipeline stage must not go through argv. So the whole convert lives here, taking options, and the
 * CLI is nothing but flag parsing on top of it.
 *
 * The order is the data's, not a preference: weld the district into cells, convert every model class against
 * the shared texture plan the weld produced (the ONE moment that plan is complete and still open), copy the
 * game dir, then rewrite the archives so each `.osm` replaces the `.dff` it was built from.
 */
import type { OspakManifest } from '@opensa/engine-formats';
import type { MapDefinitions } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { isVegetationDef } from '@opensa/cell-weld/weld';
import { breakableModelsFromText } from '@opensa/renderware/breakable/models';
import { copyGameDir, guardOut } from '@opensa/tool-kit/game-dir';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LodBakePromise } from './geometric-error';

import { rewriteModelArchives } from './archive-edit';
import { createAstcEncoder } from './astc-encode';
import { buildRecipe, readGitCommit } from './build-recipe';
import { convertDistrict } from './convert';
import { buildDistrictTable } from './districts';
import { openGameDir } from './game-fs';
import { WaterHeightGrid } from './height-grid';
import { createModelBundles } from './model-bundle';
import { packAnimObjects } from './pack-anim-objects';
import { packBreakables } from './pack-breakables';
import { packClutter } from './pack-clutter';
import { packMapObjects } from './pack-map-objects';
import { packPeds } from './pack-peds';
import { packProps } from './pack-props';
import { packVehicles } from './pack-vehicles';
import { placedModelNames } from './placed-models';
import { assertPlatformSupport, platformDemand, satisfiedTargets } from './platforms';
import { bakeWater } from './water';

export interface PackOptions {
  /** lod-TARGET models welded into BOTH levels (plan 087 `lod-always.json` — the stub-HD/real-LOD TC
   *  pattern); lowercased names, passed through to the convert. */
  alwaysOnLods?: readonly string[];
  /** Bake per-vertex AO/skyVis. ON by default — it stands in for prod's SSAO, so a shipping pak needs it. */
  ao?: boolean;
  /** astcenc worker threads for `--textures astc`; 0 (the default) is one per core. A PHONE cannot afford
   *  that: every worker is a V8 isolate reserving its own code range, and on a 2026 arm64 device with the
   *  convert's 4 GB heap setting inherited by each one, the encode stage dies with
   *  `Failed to reserve virtual memory for CodeRange` — once per worker that lost the race. */
  astcThreads?: number;
  /** Bake every cell's COLLISION into the pak (plan 200/3-01) so the browser never parses a COL. OFF by
   *  default while the runtime still reads the archives: it costs build time and nothing reads it yet. */
  bakeCollision?: boolean;
  /** Bake per-vertex SUN VISIBILITY — the heavy shadow bake. OFF by default; production converts need it. */
  bakes?: boolean;
  /** Bake worker pool size; the default is a quarter of the cores. */
  bakeWorkers?: number;
  /** Per-chunk checkpoints of the weld (pmb plan 006) — written here after every chunk; with `resume`,
   *  replayed and continued from. Absent = no checkpoints. */
  checkpointDir?: string;
  /** Emit every world texture as RGBA8 instead of passing SA's DXT through, so the pak loads on a GPU
   *  without BC (every mobile one). 4-8x the texture memory — pair it with a district {@link rect}.
   *  The older spelling of `textures: 'rgba8'`; {@link textures} wins when both are given. */
  forceRgba8?: boolean;
  /** The game dir to convert. */
  gameDir: string;
  /** Fetch game id stamped into the manifest (plan 086: `game-src/<id>` — folder name IS the id).
   *  Defaults to `basename(gameDir)`; pmb passes its `--game` basename because ITS gameDir here is a
   *  work-stage intermediate. */
  gameId?: string;
  /**
   * Build the **baked 3D city map** (201/6-01): the cell LOD tier as the world's ONLY tier.
   *
   * A mode the operator picks rather than a quality the frame fell back to — the LODs are a whole
   * simplified city already, and a map is what they are the right shape for. Recorded in the recipe, because
   * a pak that carries half the tiers and does not say so is one a reuse check will hand back for a run it
   * cannot serve.
   */
  lodOnly?: boolean;
  /** What the cell-LOD bake promised (plan 201/1-05) — `buildOpensaLods` returns it, pmb hands it over, and
   *  the manifest turns it into the screen-error fields the streamer picks HD by. Absent = a pak whose
   *  runtime keeps its ring radii. */
  lodPromise?: LodBakePromise;
  log?: (message: string) => void;
  /** Convert only the map objects the `rect` actually PLACES, instead of every model the IDEs name (~14 000).
   *  A district places a few hundred, so this is the difference between a convert in minutes and one in
   *  hours on a phone. Ignored without an explicit `rect`. See `placed-models.ts` for why the cut is safe. */
  mapObjectsInRect?: boolean;
  /** Largest texture edge the pak may carry (0 = uncapped) — the other half of making an RGBA8 pak fit. */
  maxTextureSize?: number;
  /** Convert the per-model half (and rewrite the ~1 GB archives). ON by default. */
  models?: boolean;
  /** The output game dir — a COPY of `gameDir`; the pak products go to `pakDir`. */
  outDir: string;
  /** Where the pak products land (`world.ospak`, `manifest.json`, `water.bin`, `report.json`).
   *  Defaults to `<outDir>/pak` (plan 086 phase 8: the game dir is SELF-CONTAINED — one folder pick
   *  serves the whole game; `pak/` replaced the confusing nested `opensa/` name). */
  pakDir?: string;
  /** Convert only these PEDS (lowercased model names); every ped when absent. The player's model must be in
   *  the list or the game has nobody to move (`GAME_CONFIG.mainCharacter`). */
  peds?: readonly string[];
  /** GPU families this build CLAIMS to run on (`desktop`, `mobile`). The pack fails when the textures it
   *  wrote demand a feature the named family does not carry — the one moment that is still checkable, since
   *  after this the answer belongs to someone else's device. Unset = claim nothing, only report. */
  platforms?: readonly string[];
  /** Inclusive GTA CELL-coordinate rect [x0, y0, x1, y1]. Absent = auto-fit to every cell with content
   *  (plan 087: a fixed rect silently dropped gostown's far islands). */
  rect?: readonly [number, number, number, number];
  /** Continue the weld from the checkpoints in `checkpointDir` (the model classes after it re-run). */
  resume?: boolean;
  /** Stochastic de-tiling name lists; defaults to the curated `data/stochastic.txt`. */
  stochasticFiles?: readonly string[];
  /** Which texture format the build WRITES (plan 200/2-02). Defaults to `bc` — SA's own DXT, passed through
   *  untouched, desktop-only. See {@link TextureTarget}. */
  textures?: TextureTarget;
  /** Convert only these VEHICLES (lowercased model names); every car when absent. A car left out keeps its
   *  `.dff`/`.txd`, so on an `--rgba8` build it stays in the ORIGINAL format — see the note in
   *  `pack-vehicles.ts`: the caller has to make sure nothing spawns it. */
  vehicles?: readonly string[];
}

export interface PackResult {
  models: null | object;
  report: Awaited<ReturnType<typeof convertDistrict>>['report'];
}

/**
 * The texture format a build writes — one choice for the world AND every model dictionary, because a device
 * that cannot display one cannot display the other (`docs/restrictions/assets-and-data.md`: it is decided at
 * build time and no runtime option can re-take it).
 *
 * - `bc` — SA's own DXT passed through, no re-encode and no second generation of loss. Desktop only.
 * - `astc` — ASTC 4x4, one byte per texel: the same cost as BC3 and a quarter of RGBA8, on the GPUs that
 *   have no BC. Costs build time (the encode) and one generation of loss on the world's textures.
 * - `rgba8` — uncompressed. Portable everywhere and 4x an ASTC payload; what a no-BC device got before ASTC,
 *   and still the reference when a format question is about the ENCODER rather than the pipeline.
 */
export type TextureTarget = 'astc' | 'bc' | 'rgba8';

interface PackedModels {
  animObjects: ReturnType<typeof packAnimObjects>;
  breakables: ReturnType<typeof packBreakables>;
  clutter: ReturnType<typeof packClutter>;
  deletes: string[];
  mapObjects: ReturnType<typeof packMapObjects>;
  peds: ReturnType<typeof packPeds>['report'];
  props: ReturnType<typeof packProps>;
  vehicles: ReturnType<typeof packVehicles>['report'];
}
/** `HH:mm DD-MM-YYYY` in local time — the opensa manifest `buildTime`, e.g. `07:52 21-07-2026`. */
export function formatBuildTime(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    `${pad(now.getHours())}:${pad(now.getMinutes())} ` +
    `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`
  );
}

/** Convert one game dir into a packed one — everything the CLI used to do, minus the argv. */
export async function packGameDir(options: PackOptions): Promise<PackResult> {
  const { gameDir, outDir, rect } = options;
  const ao = options.ao ?? true;
  const bakes = options.bakes ?? false;
  const models = options.models ?? true;
  const log = options.log ?? ((message: string): void => console.log(`[opensa-pack] ${message}`));
  const textures = resolveTextureTarget(options);
  // ASTC is an RGBA8 build plus one encode pass: the planner has to decode every layer either way, so this
  // is the ONE place the two switches are tied together (`astc-encode.ts` refuses a BC layer on purpose).
  const forceRgba8 = textures !== 'bc';
  guardOut(outDir, gameDir);

  const started = Date.now();
  log(`loading game dir ${gameDir} …`);
  const fs = openGameDir(gameDir);
  log(
    `converting rect ${rect ? rect.join(',') : 'auto (fit to content)'} (cellSize ${CELL_SIZE}, ` +
      `ao ${ao ? 'on' : 'off'}, sunvis ${bakes ? 'on' : 'off'}) …`,
  );
  const stochasticNames = readStochasticNames(options.stochasticFiles);
  const waterHeights = new WaterHeightGrid();
  // ONE `.osm` per model, contributed to by every class the model belongs to (a cactus is clutter AND a
  // breakable). Emitting a file per class instead loses whichever contribution the archive editor dedupes
  // away — the accumulator is what makes that impossible.
  const bundles = createModelBundles();
  let packed: null | PackedModels = null;
  const { manifest, pak, report } = await convertDistrict(fs, {
    ...(options.alwaysOnLods !== undefined && options.alwaysOnLods.length > 0
      ? { alwaysOnLods: new Set(options.alwaysOnLods.map((name) => name.toLowerCase())) }
      : {}),
    ao,
    ...(options.bakeCollision ? { bakeCollision: true } : {}),
    ...(options.bakeWorkers !== undefined ? { bakeWorkers: options.bakeWorkers } : {}),
    cellSize: CELL_SIZE,
    ...(options.checkpointDir !== undefined
      ? { checkpointDir: options.checkpointDir, resume: options.resume === true }
      : {}),
    lodOnly: options.lodOnly === true,
    log,
    ...lodPromiseOption(options.lodPromise),
    ...modelPlanHook(fs, options, bundles, log, forceRgba8, models, (result) => {
      packed = result;
    }),
    ...(textures === 'astc' ? { astc: true, astcThreads: options.astcThreads ?? 0 } : {}),
    ...(forceRgba8 ? { forceRgba8: true } : {}),
    ...(options.maxTextureSize ? { maxTextureSize: options.maxTextureSize } : {}),
    ...(rect !== undefined ? { rect } : {}),
    stochasticNames,
    sunVis: bakes,
    waterHeights,
  });

  // The output is a game dir (003 phase 1): mirror the input; the pak products go to `<out>/pak` (plan
  // 086 phase 8) so ONE folder pick serves the whole game.
  const copyStarted = Date.now();
  copyGameDir(gameDir, outDir);
  const products = options.pakDir ?? join(outDir, 'pak');
  mkdirSync(products, { recursive: true });
  log(`copied the game dir → ${outDir} (${((Date.now() - copyStarted) / 1000).toFixed(1)} s)`);

  // Water bake (074/06 row 12 v2, user directive — water WITHOUT the shadow bakes): shore-field
  // tessellation from water.dat, pure 2D geometry (no rays, no BVH), always on — it costs seconds.
  const waterText = fs.getText('data/water.dat');
  if (waterText !== null) {
    const water = bakeWater(waterText, (x, y) => waterHeights.heightAt(x, y));
    writeFileSync(join(products, 'water.bin'), water.bin);
    manifest.water = { ...water.manifest, file: 'water.bin' };
    log(
      `water: ${water.manifest.vertexCount} verts / ${water.manifest.indexCount / 3} tris ` +
        `(shore field baked, ${(water.bin.byteLength / 1048576).toFixed(1)} MB)`,
    );
  }
  writeDistricts(fs, products, manifest, log);
  writeFileSync(join(products, 'world.ospak'), pak);
  // Stamp the build time so the debugger can show which pak the runtime is on. This is the one intentionally
  // non-reproducible field in the output (the pak bytes stay byte-identical); it is set here in the CLI, not
  // in `buildOspak`, so the deterministic core is untouched.
  manifest.buildTime = formatBuildTime(new Date());
  // Fetch identity (plan 086 phase 1): which game this pak IS and which app built it — the finishing
  // fetch-pack tool and the fetch client key their manifests/caches on the pair.
  manifest.game = options.gameId ?? basename(resolve(gameDir));
  const appVersion = readAppVersion();
  if (appVersion !== null) {
    manifest.appVersion = appVersion;
  }
  writeFileSync(join(products, 'manifest.json'), JSON.stringify(manifest));

  await retextureModels(bundles, textures, options.astcThreads ?? 0, log);

  // Which GPUs can run what we just wrote. Computed from BOTH halves — the pak's arrays and every model's
  // dictionary — because a car is not in the pak, so a world that loads on a phone can still fail at the
  // first spawn. Reported always; enforced only when the caller claimed a platform.
  const demand = platformDemand(manifest, bundles.ostexFormats());
  const targets = satisfiedTargets(demand);
  log(
    `platforms: needs [${demand.features.join(', ') || 'nothing'}] ` +
      `(world [${demand.world.join(', ') || 'nothing'}], models [${demand.models.join(', ') || 'nothing'}]) ` +
      `→ runs on ${targets.join(', ') || 'no known GPU family'}`,
  );
  if (options.platforms !== undefined && options.platforms.length > 0) {
    assertPlatformSupport(demand, options.platforms);
  }

  // Convert the by-name assets INTO the copied archives — `<model>.dff`/`<txd>.txd` out, `<model>.osm` in.
  const written = packed ? rewriteOptimizedArchives(outDir, bundles, packed, log) : null;
  // What this pak IS, beside what it contains: the rect and the flags it was converted with. A phone reuses
  // a pak for many runs rather than paying minutes-to-hours again, and reuse is only safe when the folder can
  // be asked what it is — `scripts/phone.sh` reads this back and refuses to serve a pak built for a different
  // area or a different collision side than the one being asked for.
  const build = buildRecipe(options, {
    appVersion,
    at: manifest.buildTime,
    commit: readGitCommit(resolve(gameDir)),
    game: manifest.game,
  });
  writeFileSync(
    join(products, 'report.json'),
    JSON.stringify(
      { ...report, build, platforms: { ...demand, satisfies: targets }, ...(written ? { models: written } : {}) },
      null,
      2,
    ),
  );
  log(
    `build: rect ${build.rect ? build.rect.join(',') : 'auto'} · textures=${build.textures} · ` +
      `max-texture=${build.maxTexture || 'none'} · bake-collision=${build.bakeCollision} · ` +
      `models=${build.models}${build.commit ? ` · ${build.commit}` : ''} — recorded in report.json`,
  );
  printReport(report, started, log);

  return { models: written, report };
}

/** The repo root `package.json` version (module-relative — cwd-independent), or null outside the repo. */
export function readAppVersion(): null | string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };

    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Which format a build WRITES, from the two spellings that can ask for it.
 *
 * One function rather than the expression in two places: the pack and the recipe it records must never
 * disagree about what the pak is — a report that describes a different build than the one on disk is worse
 * than no report, because it is believed.
 */
export function resolveTextureTarget(options: Pick<PackOptions, 'forceRgba8' | 'textures'>): TextureTarget {
  return options.textures ?? (options.forceRgba8 === true ? 'rgba8' : 'bc');
}

/**
 * The convert's `onWorldPlanned` hook: every model class converts HERE — the by-name ones first (they own
 * their private dictionaries), then the map objects, which resolve into the world plan the hook is handed
 * while it is still open. `--no-models` returns no hook at all.
 */
/** The bake's promise as a convert option — a helper so the absent case is not a branch inside `packGameDir`. */
function lodPromiseOption(promise: LodBakePromise | undefined): { lodPromise?: LodBakePromise } {
  return promise === undefined ? {} : { lodPromise: promise };
}

/** The two texture-resolution ledgers (085 rows B/F): cross-TXD rescues (info) and true misses (warn). */
function logTextureLedgers(
  textures: Awaited<ReturnType<typeof convertDistrict>>['report']['textures'],
  log: (message: string) => void,
): void {
  const crossTxd = Object.values(textures.crossTxd);
  if (crossTxd.length > 0) {
    // Names the def's own chain lacked but another TXD supplied (085 row F) — the mod-triage view:
    // a mod TXD that dropped names its stock predecessor had shows up here, one line per name.
    log(`ℹ ${crossTxd.length} texture name(s) resolved through the global index:`);
    for (const entry of crossTxd.slice(0, 24)) {
      const models = entry.models.slice(0, 6).join(', ') + (entry.models.length > 6 ? ', …' : '');
      log(`  ${entry.txd} lacks '${entry.texture}' ← taken from ${entry.donor} — model(s): ${models || '?'}`);
    }
    if (crossTxd.length > 24) {
      log(`  … ${crossTxd.length - 24} more — full list in report.json textures.crossTxd`);
    }
  }
  const missing = Object.entries(textures.missing);
  if (missing.length > 0) {
    // Missing textures render as the material colour (vanilla parity) — quiet in the frame, loud here:
    // one line per failed name WITH the models that asked for it, so a broken mod is identifiable
    // straight from the console (user decides what to do with the mod afterwards).
    log(`⚠ ${missing.length} texture name(s) resolved nowhere (material-colour stand-ins):`);
    for (const [key, entry] of missing.slice(0, 24)) {
      const models = entry.models.slice(0, 6).join(', ') + (entry.models.length > 6 ? ', …' : '');
      log(`  ${key} ×${entry.count} — model(s): ${models === '' ? '?' : models}`);
    }
    if (missing.length > 24) {
      log(`  … ${missing.length - 24} more — full list in report.json textures.missing`);
    }
  }
}

function modelPlanHook(
  fs: ReturnType<typeof openGameDir>,
  options: PackOptions,
  bundles: ReturnType<typeof createModelBundles>,
  log: (message: string) => void,
  forceRgba8: boolean,
  models: boolean,
  onPacked: (packed: PackedModels) => void,
): { onWorldPlanned?: (planner: TexturePlanner, mapDefs: MapDefinitions) => void } {
  if (!models) {
    return {};
  }

  return {
    onWorldPlanned: (planner, mapDefs): void => {
      onPacked(
        packModels(fs, mapDefs, planner, bundles, log, forceRgba8, {
          // Only with an explicit rect: without one the convert auto-fits to every cell with content, and
          // "the models this rect places" is then the whole catalogue anyway.
          ...(options.mapObjectsInRect && options.rect !== undefined
            ? { mapObjects: placedModelNames(mapDefs, options.rect, CELL_SIZE) }
            : {}),
          ...(options.peds ? { peds: new Set(options.peds.map((name) => name.toLowerCase())) } : {}),
          ...(options.vehicles ? { vehicles: new Set(options.vehicles.map((name) => name.toLowerCase())) } : {}),
        }),
      );
    },
  };
}

/**
 * Convert every model class into `bundles` (003 phases 3–5). Runs from `convertDistrict`'s world-plan hook,
 * because the last class — map objects — resolves into the SHARED texture plan and that plan is only
 * complete and still open at that one moment.
 *
 * Order is load-bearing: the by-name classes go first so a model they own keeps its PRIVATE dictionary (a
 * clutter species is one instanced draw and cannot switch texture arrays mid-mesh), and map objects then
 * take only what is left.
 */
function packModels(
  fs: ReturnType<typeof openGameDir>,
  defs: MapDefinitions,
  planner: TexturePlanner,
  bundles: ReturnType<typeof createModelBundles>,
  log: (message: string) => void,
  // A car is not in the pak, so `--rgba8` has to reach every class that ships its OWN dictionary; the map
  // objects plan into the world planner, which already has it.
  forceRgba8: boolean,
  /** Optional per-class subsets (`--vehicles` / `--peds` / the rect's placed map objects); absent = the
   *  whole class. */
  only: { mapObjects?: ReadonlySet<string>; peds?: ReadonlySet<string>; vehicles?: ReadonlySet<string> } = {},
): PackedModels {
  const vehicles = packVehicles(fs, bundles, log, { forceRgba8, ...(only.vehicles ? { only: only.vehicles } : {}) });
  // Smashable props (5b): only a `SHAT` section, so the model keeps its `.dff` — the shatter mesh is the
  // ONLY thing the runtime resolves by name for a prop, and it is what costs a main-thread DFF parse.
  const breakables = packBreakables(fs, breakableModelsFromText(fs.getText('data/object.dat')), bundles, log);
  // Clutter species (5c): the HOT by-name class — a species builds on cell stream-in, not on a rare event.
  const clutter = packClutter(fs, defs, bundles, log, { forceRgba8 });
  // Topple props (5d): the collider hull the host otherwise collects with a SECOND clump walk per prop.
  const props = packProps(fs, defs, bundles, log, { forceRgba8 });
  // Animated map objects (5e): the frame tree the IFP matches by name — the clip stays a separate asset.
  const animObjects = packAnimObjects(fs, defs, bundles, log, { forceRgba8 });
  // Peds (5f): their own DESC/GEOM — no colours, no paint slots, but joints/weights and a real skeleton.
  const peds = packPeds(fs, bundles, log, { forceRgba8, ...(only.peds ? { only: only.peds } : {}) });
  // Map objects (5g): everything else the IDEs name, against the shared dictionary.
  const mapObjects = packMapObjects(fs, defs, planner, bundles, isVegetationDef, log, defs.txdParents, only.mapObjects);

  return {
    animObjects,
    breakables,
    clutter,
    deletes: [...vehicles.deletes, ...peds.deletes, ...mapObjects.deletes],
    mapObjects,
    peds: peds.report,
    props,
    vehicles: vehicles.report,
  };
}

/** Parse a de-tiling list: plain names (one per line, `#` comments) OR skygfx `texdb.txt` lines
 *  (`"name" … stochastic=1`) — drop the mod's own database in via `--stochastic` and it just works. */
function parseStochasticList(text: string): Set<string> {
  const names = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    if (line.startsWith('"')) {
      // skygfx texdb entry: only the stochastic-tagged ones matter here.
      if (/stochastic=0*[1-9]/.test(line)) {
        const quoted = /^"([^"]+)"/.exec(line);
        if (quoted) {
          names.add(quoted[1].toLowerCase());
        }
      }
    } else {
      names.add(line.toLowerCase());
    }
  }

  return names;
}

/** The end-of-convert summary block, incl. the plan-001 missing-normals guard. */
function printReport(
  report: Awaited<ReturnType<typeof convertDistrict>>['report'],
  started: number,
  log: (message: string) => void,
): void {
  const cellCount = report.cells.length;
  const groupHistogram = report.cells.map((cell) => cell.groups);
  const maxGroups = Math.max(0, ...groupHistogram);
  const avgGroups = groupHistogram.reduce((sum, value) => sum + value, 0) / Math.max(1, cellCount);
  log(
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${cellCount} cell entries, ` +
      `pak ${(report.pakBytes / (1024 * 1024)).toFixed(1)} MB, groups avg ${avgGroups.toFixed(1)} max ${maxGroups}, ` +
      `textures pass=${report.textures.opaquePass} processed=${report.textures.processed} ` +
      `colors=${report.textures.colors} dedup=${report.textures.dedup} arrays=${report.textures.arrays}, ` +
      `timed objects=${report.timedObjects}, animated(live)=${report.animatedObjects}, ` +
      `animated(static)=${report.animatedStatic}, particles=${report.particles}, ` +
      `breakables=${report.breakables}, uv-scroll=${report.uvAnimObjects}/${report.uvAnimations}, ` +
      `roadsigns=${report.roadsigns}, normals authored=${report.normals.authored} computed=${report.normals.computed}`,
  );
  logTextureLedgers(report.textures, log);
  const normalsTotal = report.normals.authored + report.normals.computed;
  if (normalsTotal > 0 && report.normals.computed / normalsTotal > 0.1) {
    // opensa-pack plan 001: computed normals = the runtime invents them (naive average, no crease model) —
    // the plan-17 polygon-patch lighting bugs. A map-optimizer build ships normals on every world model.
    log(
      `⚠ ${report.normals.computed} of ${normalsTotal} models have no authored normals — ` +
        `run the map through map-optimizer first (its plans 020-023) or expect polygon-patch lighting`,
    );
  }
  if (report.ao) {
    log(
      `ao bake: ${(report.ao.ms / 1000).toFixed(1)}s — ${report.ao.vertices} verts ` +
        `(${report.ao.uniqueVertices} unique), ${report.ao.rays} rays vs ${report.ao.triangles} tris`,
    );
  }
  if (report.sunVis) {
    log(
      `sunvis bake: ${(report.sunVis.ms / 1000).toFixed(1)}s — ${report.sunVis.vertices} verts ` +
        `(${report.sunVis.uniqueVertices} unique), ${report.sunVis.rays} rays`,
    );
  }
}

/**
 * Stochastic de-tiling list (074/12): the CURATED uniform-noise list is the ONLY default — the skygfx
 * texdb (`data/skygfx-texdb.txt`) scrambled structured textures in the field.
 */
function readStochasticNames(files?: readonly string[]): Set<string> {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const paths = files && files.length > 0 ? files : [join(dataDir, 'stochastic.txt')];
  const names = new Set<string>();
  for (const path of paths) {
    for (const name of parseStochasticList(readFileSync(path, 'utf8'))) {
      names.add(name);
    }
  }

  return names;
}
/**
 * The models' half of the texture-format choice (200/2-02): re-encode every model dictionary.
 *
 * It runs after every asset class has contributed and BEFORE the platform check reads the formats, so what
 * the check reports is what the archives will carry. A no-op for any target but `astc` — `bc` and `rgba8`
 * are what the per-model writers already produced.
 */
async function retextureModels(
  bundles: ReturnType<typeof createModelBundles>,
  textures: TextureTarget,
  astcThreads: number,
  log: (message: string) => void,
): Promise<void> {
  if (textures !== 'astc') {
    return;
  }
  const encoder = createAstcEncoder({ threads: astcThreads });
  // A line every ~5 s, because this stage is minutes long at one thread and silence reads as a hang — it was
  // reported as one. Elapsed time rather than a bundle count as the trigger: bundles differ in size by two
  // orders of magnitude, so a per-N-bundles line is a burst and then nothing.
  let announced = Date.now();
  const arrays = await bundles.retexture(
    (array) => encoder.ostex(array),
    (done, total) => {
      if (Date.now() - announced < 5000) {
        return;
      }
      announced = Date.now();
      log(
        `astc: model dictionaries ${done}/${total} (${((100 * done) / Math.max(1, total)).toFixed(0)} %), ` +
          `${(encoder.stats.texels / 1e6).toFixed(1)} M texels in ${(encoder.stats.ms / 1000).toFixed(0)} s`,
      );
    },
  );
  log(
    `astc: ${arrays} model dictionary arrays, ${(encoder.stats.texels / 1e6).toFixed(1)} M texels in ` +
      `${(encoder.stats.ms / 1000).toFixed(1)} s`,
  );
}
/**
 * Write the accumulated `.osm` files into the copied archives and report what moved. Rebuilding the
 * archives is the expensive half — it streams, but it still rewrites ~1 GB of `gta3.img`.
 */
function rewriteOptimizedArchives(
  out: string,
  bundles: ReturnType<typeof createModelBundles>,
  packed: PackedModels,
  log: (message: string) => void,
): object {
  const started = Date.now();
  const rewrite = rewriteModelArchives(out, { deletes: packed.deletes, inserts: bundles.inserts() });
  for (const archive of rewrite.archives) {
    log(
      `archive ${archive.file}: +${archive.inserted} -${archive.deleted} entries, ` +
        `${(archive.bytes / 1048576).toFixed(0)} MB`,
    );
  }
  if (rewrite.unplaced.length > 0) {
    // An insert whose origin no archive held would be a SILENT no-render at runtime — never let it pass quietly.
    console.warn(
      `[opensa-pack] ⚠ ${rewrite.unplaced.length} optimized entries had no home archive: ` +
        rewrite.unplaced.slice(0, 8).join(', '),
    );
  }
  reportFailures(packed, log);
  log(`${bundles.size()} models bundled; archive rewrite done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  return { ...packed, rewrite };
}

/**
 * Bake the district table beside the pak (201/5-03): `info.zon`'s boxes with their GXT text resolved HERE,
 * because neither file is reachable from a surface that streams the pak. Loose next to the manifest, like
 * the water. A game shipping no `info.zon` simply gets no table, and the manifest field stays absent.
 */
function writeDistricts(
  fs: ReturnType<typeof openGameDir>,
  products: string,
  manifest: OspakManifest,
  log: (message: string) => void,
): void {
  const table = buildDistrictTable(fs);
  if (table === null) {
    return;
  }
  writeFileSync(join(products, 'districts.json'), JSON.stringify(table));
  manifest.districts = { count: table.districts.length, file: 'districts.json' };
  log(
    `districts: ${table.districts.length} named boxes` +
      (table.gxt === null ? ' (no GXT — the keys ship as their own names)' : ` from ${table.gxt}`),
  );
}

/** How many model names one failure class prints before it says "+N more" — `report.json` always has all. */
const MAX_LISTED_FAILURES = 20;

/**
 * Name what did not convert, grouped by failure CLASS. The counts in each stage's summary say how MANY
 * failed but never which, so nothing was debuggable from the console; the raw per-model dump this replaces
 * bypassed the injected `log` and buried the signal (41 map objects failing for ONE reason read as 41
 * unrelated problems). Every failure is still in `report.json` in full — this is the index into it.
 */
function reportFailures(packed: PackedModels, log: (message: string) => void): void {
  const classes = new Map<string, { models: string[]; title: string }>();
  for (const [label, failures] of [
    ['vehicle', packed.vehicles.failed],
    ['clutter', packed.clutter.failed],
    ['ped', packed.peds.failed],
    ['anim object', packed.animObjects.failed],
    ['prop', packed.props.failed],
    ['breakable', packed.breakables.failed],
    ['map object', packed.mapObjects.failed],
  ] as const) {
    for (const failure of failures) {
      // Drop the per-model detail (the name, the vertex count) so one cause collapses into one line.
      const reason = failure.error.split(failure.model).join('<model>').replace(/\d+/g, 'N');
      // NUL as the composite-key separator (written as an ESCAPE — a literal one makes the file binary
      // to grep): no label or error message can contain it, so two classes can never collide.
      const key = `${label}\u0000${reason}`;
      const bucket = classes.get(key) ?? { models: [], title: `${label} — ${reason}` };
      bucket.models.push(failure.model);
      classes.set(key, bucket);
    }
  }
  if (classes.size === 0) {
    return;
  }
  const total = [...classes.values()].reduce((count, bucket) => count + bucket.models.length, 0);
  log(`⚠ ${total} models did not convert, in ${classes.size} failure class(es) — full list in report.json:`);
  for (const { models, title } of classes.values()) {
    const shown = models.slice(0, MAX_LISTED_FAILURES);
    const rest = models.length - shown.length;
    log(`  ⚠ ${title} (${models.length}): ${shown.join(', ')}${rest > 0 ? `, +${rest} more` : ''}`);
  }
}
