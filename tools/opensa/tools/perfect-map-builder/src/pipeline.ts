import type { AssetFailure, RunSummary } from '@opensa/map-optimizer/run';
import type { ProcObjDensityInput } from '@opensa/map-placement/procobj-density';

import { addVehicles } from '@opensa/add-vehicles/install';
import { assertArchiveSlots, split as splitArchives } from '@opensa/img-splitter/split';
import { parsePrelightInfo, type PrelightInfo } from '@opensa/lod-common/prelight';
import { buildTreeLods } from '@opensa/lod-trees-generator/build';
import { parseOnlyList, runOptimizer, summarizeReport } from '@opensa/map-optimizer/run';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { install as installMods } from '@opensa/mod-installer/install';
import { buildOpensaLods, opensaLodPromise } from '@opensa/opensa-lod-generator/build';
import { packGameDir } from '@opensa/opensa-pack/pack';
import { install as installPeds } from '@opensa/ped-installer/install';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { buildSaLods } from '@opensa/sa-lod-generator/build';
/**
 * The perfect-map build pipeline (plan 001): chain every map tool via its Node API, each stage's output feeding the
 * next as a **complete** game dir (full passthrough), then split the common build into the `sa` (real game) and
 * `opensa` final LOD targets. Intermediate stages live under `<out>/.work-<target>` (plan 005 — one dir per
 * target, so building one never destroys the other's kept stages) and are deleted as they're consumed — unless
 * `keepWork`/`until` is set, in which case every stage build is kept for step-by-step in-game debugging.
 * Each target that runs writes `<out>/report-<target>.json` at the end of its chain (plan 005).
 */
import { buildProcobjLods } from '@opensa/sa-procobj-placement/build';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { openLazyVer2, writeArchiveManifest } from '@opensa/tool-kit/archive/layout';
import { checkDefinitionOrder, formatLateDefinition } from '@opensa/tool-kit/dat-order';
import { countImgArchives } from '@opensa/tool-kit/game-dir';
import { isLayeredTree } from '@opensa/tool-kit/layers';
import { checkLodLinks, formatLodLink } from '@opensa/tool-kit/lod-links';
import { type BuildTarget } from '@opensa/tool-kit/target';
import { installCutscene } from '@opensa/vehicle-cutscene/install';
import { install as installVehicles } from '@opensa/vehicle-installer/install';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuilderConfig } from './config';
import type { ResumeStage } from './resume';

import { config as defaultConfig, PACK_RECTS } from './config';
import { checkEntityPoolBudgets, type EntityPoolSpend } from './entity-pools';
import { fingerprintSources, gitHead, hashRunConfig, openResumeSession } from './resume';

/**
 * Valid `--until <name>` values. Common-chain + `sa`/`opensa` stop after the named one; the special `lod` value
 * runs the whole pipeline (**both** sa + opensa) while keeping every intermediate for debugging.
 */
export const STAGE_NAMES = [
  // FIRST, and the ordering is the point rather than a convenience: after the split every entry name lives
  // in exactly one archive, so a mod replaces `admiral.dff` inside `vehicles.img` by name. Split later and a
  // stock car would sit in `gta3.img` while its replacement landed elsewhere — see
  // `docs/architecture/img-archive-layout.md`.
  'split',
  'mods',
  'vehicles',
  // The cutscene fleet is the vehicles stage's shadow (plan 002 step 11): it reads the INSTALLED game —
  // the merged carcols.dat and the mod TXDs already in gta3.img are what the conversion bakes/resolves
  // against — so it sits right after `vehicles` and shares its source folder and its populated-check.
  'cutscene',
  'peds',
  'optimize',
  'trees',
  'sa',
  // procobj is baked INSIDE the sa branch, after the LOD build (plan 014) — it is that target's layer alone, so
  // it must not reach the common build both targets share. Its place in this list is its place in the RUN order,
  // which is what `--until` reads: `--until sa` stops before the clutter, `--until procobj` includes it.
  'procobj',
  'opensa',
  'pack',
  'lod',
] as const;

/**
 * The stages `--exclude` accepts — every real one. `lod` is not a stage but an `--until` alias for "run both
 * targets", so excluding it would name nothing.
 */
export const EXCLUDABLE_STAGES = STAGE_NAMES.filter((name): name is ExcludableStage => name !== 'lod');

/**
 * What the `opensa` target gets in place of SA's ceilings — today, an announcement that it has none. Our
 * engine has no building pool, no int16 `IplDef` index and no `IplEntityIndexArrays`, so
 * {@link reportTextIplCensus} does not run here; what replaces it is a STREAMING budget whose number does not
 * exist yet (07/04 decisions 4–5 — it has to be measured in our engine, and a cap taken from SA's numbers
 * would be a guess wearing a measurement's clothes).
 *
 * **The CLUTTER half of that budget was measured 2026-08-10 and yielded no number**, which is a result and not
 * a gap: at 3× vanilla density — every candidate the current headroom generates — the layer costs less than a
 * single sweep's A/A drift on every column and never hitches, so there is no frame-time ceiling to cap it at.
 * See sa-procobj-placement plan 013, and note that its two knobs stop for different reasons (`procObjLimit` at
 * 300 because the authored SPACING column runs out; density at ×3 because `PROC_OBJ_MAX_DENSITY` is ours).
 * What remains unmeasured is the budget for everything ELSE the branch streams.
 *
 * It is announced rather than left silent because an unguarded build and a well-behaved one look exactly
 * alike from the outside — the same reason the shared-stage guard survived a fortnight.
 */
/**
 * Where the cross-compiled `perfect-map.asi` is picked up from. `dist/` is GITIGNORED, so a fresh checkout has
 * no artifact and {@link shipPerfectMapAsi} warns — which is the honest state, not a failure: the asi is built
 * by `npm run build:asi` in `asi/perfect-map` and that needs MinGW, which a map build should not.
 */
export const PERFECT_MAP_ASI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../asi/perfect-map/dist/perfect-map.asi',
);

/**
 * Where the cross-compiled `perfect-cutscene.asi` is picked up from — same deal as {@link PERFECT_MAP_ASI}: a
 * pre-built artifact under a gitignored `dist/`, never a build step (asi/perfect-cutscene plan 001 step 7).
 */
export const PERFECT_CUTSCENE_ASI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../asi/perfect-cutscene/dist/perfect-cutscene.asi',
);

/**
 * Where the cross-compiled `perfect-vehicle.asi` is picked up from — same deal as {@link PERFECT_MAP_ASI}. It
 * lifts `carmods.dat`'s two fixed-size arrays, so a build whose added cars need more than the stock 30 `link`
 * pairs is only correct with it (asi/perfect-vehicle plan 002; the installer refuses the overflow either way).
 */
export const PERFECT_VEHICLE_ASI = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../asi/perfect-vehicle/dist/perfect-vehicle.asi',
);

export const OPENSA_BUDGET_NOTICE =
  "opensa: SA's row/slot ceilings do not apply here — and no streaming budget guard exists yet " +
  '(07/04 decision 5: the number must be measured in our engine, never inherited from SA). ' +
  'The clutter half is measured and does not bind: at 3x vanilla density the layer stays under one sweep of ' +
  'measurement noise and never hitches, so there is no frame-time ceiling to cap it at';

export interface BuildPerfectMapOptions {
  config?: Partial<BuilderConfig>;
  /**
   * Stages to SKIP, whatever else the run asks for — the target-split directive. Unlike `--until` (which cuts
   * the pipeline at a point) this removes named stages and keeps everything after them, so one source tree can
   * produce a target that needs only part of the chain:
   *
   * - `sa` — no real-game LOD build, and no `checkImgIdBudgets` with it (that guard reads the `sa/` tree).
   * - `opensa` — no cell-LOD build and no convert; `pack` goes with it, being that target's tail.
   * - `pack` alone — build `opensa/` and leave it in GAME format (same result as `--until opensa`).
   * - any common-chain stage (`mods`/`vehicles`/`cutscene`/`peds`/`optimize`/`trees`/`procobj`) — dropped
   *   from the chain.
   *
   * An excluded stage leaves whatever a previous run wrote in its place: the builder only clears its own
   * `<out>/.work-<target>` (plus the legacy shared `.work`), so an opensa-only run does not touch a `sa/`
   * built earlier — nor the other target's kept `.work-<target>`.
   */
  exclude?: readonly ExcludableStage[];
  /** Clean base game dir (`gta.dat` + `data/` + `models/`). */
  gamePath: string;
  /** mods-src root — one subfolder per stage (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `procobj/`). */
  inPath: string;
  /** Keep all intermediate stage builds under `<out>/.work-<target>` (implied by `until`). */
  keepWork?: boolean;
  /** Output root; the builder creates `<out>/sa` and `<out>/opensa`. */
  outPath: string;
  /**
   * Re-enter a failed run at its last finished step (plan 006): `<out>/.work-<target>/resume.json` says which
   * steps are done and what the run was made of; a resume whose sources, config or code differ is REFUSED.
   * The work dir is not wiped — only the failed step's partial dir is.
   */
  resume?: boolean;
  /**
   * The HOST this build is for (`--target`) — what picks every knob whose right value is a fact about the
   * host rather than about the source data. Omitted, it is DERIVED from `exclude` (see
   * {@link resolveBuildTarget}), which is what already declares a target today.
   */
  target?: BuildTarget;
  /** Stop after this stage and keep every stage build (for step-by-step in-game debugging). */
  until?: StageName;
}

export interface BuildResult {
  /** Every produced stage build, in order (`{ name, dir }`) — testable full game dirs when kept. */
  produced: { dir: string; name: string }[];
  /** Whether the run stopped early at `until` (before the sa/opensa split). */
  stoppedEarly: boolean;
}

/** The cutscene stage's summary (plan `vehicle-cutscene` 002 step 11) — per-slot errors FAIL the stage,
 *  so a report only ever carries the converted/skipped/warning shape of a build that succeeded. */
export interface CutsceneFragment {
  converted: string[];
  imgBytesAfter: number;
  /** Slots that got a baked readable plate pair (vehicle-cutscene plan 003). */
  plates: { csName: string; text: string }[];
  skipped: { csName: string; reason: string }[];
  txdBytes: number;
  warnings: { csName: string; message: string }[];
}

/** Every stage name except the `lod` alias — see {@link EXCLUDABLE_STAGES}. */
export type ExcludableStage = Exclude<StageName, 'lod'>;

/** The optimize stage's totals + isolated failures. The per-asset list lives and dies with the stage build. */
export interface OptimizeFragment {
  failures: AssetFailure[];
  summary: RunSummary;
}

/** The pack stage's summary. `report` POINTS at the pack's own full report beside its pak — never a copy. */
export interface PackFragment {
  cells: number;
  pakBytes: number;
  report: string;
}

/** The `sa` branch's ceilings, read off the tree the real game loads — console-only before plan 005. */
export interface SaFragment {
  census: { instBearingIpls: number; largestIpl: number; rows: number };
  /** What the map spends of `CPool<CBuilding>` / `CPool<CDummy>`, split the way the game splits it. */
  entityPools: EntityPoolSpend;
  imgBudgets: Record<string, number>;
  /** Set only when this build carries a converted cutscene fleet — the two ship together or not at all. */
  perfectCutsceneAsiSha256: null | string;
  perfectMapAsiSha256: null | string;
  requirements: InstallRequirement[];
}

export type StageName = (typeof STAGE_NAMES)[number];

/**
 * One target's build report — `<out>/report-<target>.json`, assembled at the end of the target's chain (plan
 * 005). The NAME is the target: two targets share one `--out`, so a single unnamed `report.json` was a
 * summary of whichever run finished last. Fragments are typed per stage — a stage that learned nothing
 * contributes nothing.
 */
export interface TargetReport {
  builtAt: string;
  fragments: TargetReportFragments;
  /** The fetch game id — basename of the run's `--game`. */
  game: string;
  gamePath: string;
  target: 'opensa' | 'sa';
  timings: StageTiming[];
}

export interface TargetReportFragments {
  cutscene?: CutsceneFragment;
  optimize?: OptimizeFragment;
  pack?: PackFragment;
  sa?: SaFragment;
}

/** What a common-chain stage may hand the report assembler (plan 005); most stages produce nothing. */
type ChainOutcome =
  | undefined
  | void
  | { fragment: CutsceneFragment; stage: 'cutscene' }
  | { fragment: OptimizeFragment; stage: 'optimize' };

/** Run the pipeline (optionally up to `until`). Returns each produced stage build. */
export async function buildPerfectMap(options: BuildPerfectMapOptions): Promise<BuildResult> {
  const config = { ...defaultConfig, ...options.config };
  const { gamePath, inPath, outPath, until } = options;
  const { subfolders } = config;
  const keepWork = options.keepWork || until !== undefined;
  const excluded: ReadonlySet<ExcludableStage> = new Set(options.exclude ?? []);
  const target = resolveBuildTarget(options.target, excluded);
  logTarget(target, options.target !== undefined, excluded);

  // One work dir per resolved target (plan 005): under --keepWork a `sa` run used to silently delete
  // everything a previous opensa run was keeping, because both shared `<out>/.work`.
  const work = join(outPath, `.work-${target}`);
  // The pre-005 shared dir is still cleared: it was wiped at the start of every run by contract, and left
  // alone it is multi-GB garbage no new build will ever read.
  const legacyWork = join(outPath, '.work');
  refuseSourceInsideWork(work, gamePath, inPath);
  refuseSourceInsideWork(legacyWork, gamePath, inPath);
  rmSync(legacyWork, { force: true, recursive: true });

  const source = (sub: string): string => join(inPath, sub);
  const populated = (sub: string): boolean => existsSync(source(sub)) && readdirSync(source(sub)).length > 0;

  // The resume point (plan 006). A fresh run wipes the work dir and starts a manifest; `--resume` reads the
  // manifest a failed run left, refuses it if the sources / config / code differ, and keeps the work dir.
  const identity = {
    commit: gitHead(),
    configHash: hashRunConfig({ config, exclude: [...excluded].sort(), target, until: until ?? null }),
    sources: fingerprintSources({
      game: gamePath,
      ...Object.fromEntries(Object.entries(subfolders).map(([key, sub]) => [`in/${key}`, source(sub)])),
    }),
    target,
  };
  const { doneStep, recordFailure, recordStep } = openResumeSession({
    identity,
    log,
    resume: options.resume === true,
    work,
  });
  // Only now, past every refusal: clear the two files this run REPLACES, so a run that dies leaves nothing of
  // an earlier one to be read as its own (`build-timings.json` carried no date at all, and a stale
  // `report-<target>.json` differs only in a `builtAt` deep inside it). Both are re-written below — on
  // success, and on failure with the step that threw and the stages that had finished.
  rmSync(join(outPath, 'build-timings.json'), { force: true });
  rmSync(join(outPath, `report-${target}.json`), { force: true });
  const startedAt = new Date().toISOString();

  // The common chain (installers → optimizer → LODs). Conditional stages are skipped when their source is empty.
  // A stage may RETURN a fragment for the target report (plan 005) — the runner collects them, keyed by stage.
  const chain: { name: ExcludableStage; run: (game: string, out: string) => ChainOutcome | Promise<ChainOutcome> }[] =
    [];
  chain.push({
    name: 'split',
    run: (game, out) => void splitArchives({ buckets: config.splitBuckets, gamePath: game, outPath: out }),
  });
  if (populated(subfolders.mods)) {
    // A LAYERED mods folder (mod-installer plan 011) makes this stage target-DEPENDENT, and the stage sits
    // in the chain both targets share — so a run that would build BOTH cannot serve it. Refused HERE,
    // before any stage runs, rather than by producing one install and calling it two.
    refuseLayeredBothTargets(source(subfolders.mods), 'mods', until, excluded);
    chain.push({
      name: 'mods',
      run: (game, out) => installMods({ gamePath: game, inPath: source(subfolders.mods), outPath: out, target }),
    });
  }
  if (populated(subfolders.vehicles)) {
    refuseLayeredBothTargets(source(subfolders.vehicles), 'vehicles', until, excluded);
    chain.push({
      name: 'vehicles',
      // The installer returns the archive FAMILY it wrote (one file, or numbered siblings once the cap
      // bites). Registering a sibling in `gta.dat` belongs to the split stage, not here — img-splitter plan
      // 001 step 4 — so this stage contributes no fragment yet and the installer warns if one appears.
      run: (game, out) =>
        void installVehicles({ gamePath: game, inPath: source(subfolders.vehicles), outPath: out, target }),
    });
  }
  // The cutscene stage exists only downstream of a RUN vehicles stage: the conversion reads the installed
  // game (merged carcols, mod TXDs as txdp parents), so on a tree without them every slot fails closure.
  // `--exclude vehicles` therefore drops this stage too — loudly, because a silently missing stage reads
  // as a broken build (build:game:original:sa excludes vehicles today).
  stageCutscene(chain, excluded, populated(subfolders.vehicles), source(subfolders.vehicles), target, gamePath);
  if (populated(subfolders.peds)) {
    refuseLayeredBothTargets(source(subfolders.peds), 'peds', until, excluded);
    chain.push({
      name: 'peds',
      run: (game, out) => installPeds({ gamePath: game, inPath: source(subfolders.peds), outPath: out, target }),
    });
  }
  // map-optimizer prelight FORCE list (user decision, reversing the earlier only-mode): the statistical pass
  // corrects the whole map by default, and `broken-prelight.json` (mods-src root or the mods subfolder)
  // ADDITIONALLY forces the listed models past the skip-guards — see plan 019 iterations 5/6 for the formats.
  const prelitForce = loadPrelitOnly(inPath, source(subfolders.mods));
  chain.push({
    name: 'optimize',
    // The per-asset report would sit in `.work/<n>-optimize`, which is deleted as the stage is consumed —
    // so the fragment carries the totals and the isolated failures, the two things a build summary needs.
    run: async (game, out) => {
      const report = await runOptimizer({
        gameDir: game,
        outDir: out,
        passes: config.optimizerPasses,
        ...(prelitForce ? { prelitOptions: { force: prelitForce } } : {}),
      });

      return { fragment: { failures: report.failures, summary: summarizeReport(report) }, stage: 'optimize' as const };
    },
  });
  if (populated(subfolders.vegetation)) {
    chain.push({
      name: 'trees',
      run: (game, out) =>
        buildTreeLods({
          config: { textureSize: config.treeTex },
          gamePath: game,
          inPath: source(subfolders.vegetation),
          outPath: out,
          prelight: true,
          prelightInfo: loadPrelight(source(subfolders.vegetation)),
        }),
    });
  }
  const runnable = planChain(chain, excluded, {
    cutscene: subfolders.vehicles,
    mods: subfolders.mods,
    peds: subfolders.peds,
    trees: subfolders.vegetation,
    vehicles: subfolders.vehicles,
  });

  const produced: { dir: string; name: string }[] = [];
  const timings: StageTiming[] = [];
  /** The fetch game id — the user-facing `--game` folder name, stamped into each target report. */
  const gameId = basename(resolve(gamePath));
  /** Fragments the COMMON chain produced — shared by every target report this run writes (plan 005). */
  const common: TargetReportFragments = {};
  /** The asi shipped beside this map, for the manifest — a map at this density is correct only with it. */
  let shippedAsi: null | { sha256: string } = null;
  /** The asi shipped beside the cutscene fleet, same manifest reasoning — null when no fleet was converted. */
  let shippedCutsceneAsi: null | { sha256: string } = null;
  // Timed per stage and logged AS EACH ONE ENDS, not only in the summary: a long build that is killed part
  // way still leaves its numbers in the log. Nothing recorded a build's duration before 2026-08-09, so the
  // first question asked of the procobj density change ("what did it cost in build time?") had no baseline.
  const timed = async <T>(name: string, run: () => Promise<T> | T): Promise<T> => {
    const started = Date.now();
    const result = await run();
    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    timings.push({ name, seconds });
    log(`${name} — ${seconds}s`);

    return result;
  };
  /** The run's timings file — written at the end, and by whichever step throws first (with what it managed). */
  const finishTimings = (failed?: { error: string; step: string }): void =>
    writeStageTimings(
      outPath,
      timings,
      {
        ...asiPairings(shippedAsi, shippedCutsceneAsi),
        procobjDensity: config.procobjDensity,
        procobjMax: config.procobjMax,
        target,
      },
      { failed, startedAt },
    );
  const untilIndex = until === undefined ? Infinity : STAGE_NAMES.indexOf(until);
  /** Run a step through `timed`, record it in the resume manifest, and mark the manifest failed if it throws. */
  const step = async <T>(name: string, dir: string, run: () => Promise<T> | T): Promise<T> => {
    try {
      const result = await timed(name, run);
      recordStep(name, dir, timings[timings.length - 1]?.seconds ?? 0);

      return result;
    } catch (error) {
      recordFailure(name, error);
      finishTimings({ error: error instanceof Error ? error.message : String(error), step: name });
      throw error;
    }
  };
  /** A recorded step's dir, which the run is about to READ, must still be there. Checked at the point of use
   *  and not for every recorded step: the chain deletes each stage dir as the next stage consumes it (disk),
   *  so of a finished chain only the LAST stage's dir survives — and that is the only one a resume reads
   *  (2026-08-17: the first real killed build, gostown mid-pack, was refused over the long-gone `1-split`). */
  const assertResumedDir = (done: ResumeStage): void => {
    if (!existsSync(done.dir)) {
      throw new Error(`--resume: step '${done.name}' is recorded as done but its dir is gone: ${done.dir}`);
    }
  };
  /** A step the manifest already has: take its recorded seconds instead of running it. */
  const skipDone = (done: ResumeStage): void => {
    timings.push({ name: done.name, resumed: true, seconds: done.seconds });
    log(`${done.name} — done in the run being resumed (${done.seconds}s), skipped`);
  };
  let game = gamePath;
  /** The recorded chain stage whose dir `game` currently points at (undefined while `game` is the source). */
  let gameStep: ResumeStage | undefined;
  /** One chain stage: taken from the manifest if the resumed run finished it, run (and recorded) otherwise. */
  const runChainStage = async (index: number, stage: (typeof runnable)[number]): Promise<void> => {
    const out = join(work, `${index + 1}-${stage.name}`);
    const done = doneStep(stage.name);
    if (done) {
      skipDone(done);
      game = done.dir;
      gameStep = done;
      produced.push({ dir: done.dir, name: stage.name });

      return;
    }
    if (gameStep) {
      assertResumedDir(gameStep); // this stage reads the resumed run's last finished dir
    }
    log(stage.name);
    // A partial dir a failed attempt left behind is worse than none — a half-installed stage reads as whole.
    rmSync(out, { force: true, recursive: true });
    collectFragment(common, await step(stage.name, out, () => stage.run(game, out)));
    // Consumed → free disk; a resumed run's kept stage dir is left for the run being resumed to own.
    if (!keepWork && game !== gamePath && !doneStep(basename(game).replace(/^\d+-/, ''))) {
      rmSync(game, { force: true, recursive: true });
    }
    game = out;
    gameStep = undefined;
    produced.push({ dir: out, name: stage.name });
  };
  for (const [index, stage] of runnable.entries()) {
    if (STAGE_NAMES.indexOf(stage.name) > untilIndex) {
      return { produced, stoppedEarly: true }; // `until` names a skipped stage — everything before it has run
    }
    await runChainStage(index, stage);
    if (until === stage.name) {
      return { produced, stoppedEarly: true }; // stop before the split; intermediates kept
    }
  }

  // Split: the common baked build (`game`) feeds both final LOD generators. `lod` runs BOTH (keeping every step).
  // lod-trees/lod-procobj already gave their models final LODs/impostors — hand those names to both generators as
  // `excludeItems` so neither re-processes them (double far-view geometry → streaming overload; see the LOD memories).
  // User-curated LOD exclusions (`lod-exclude.json` at the mods-src root or inside mods/): models that must
  // not enter the far LODs at all — e.g. HD street-furniture replacements (a 22k-tri ELECTRICA traffic light
  // placed 729× exploded the cell bake ~50×; at 300+ u it is a few unreadable pixels anyway).
  if (gameStep) {
    assertResumedDir(gameStep); // the split reads the resumed run's last finished chain dir
  }
  const userExcluded = loadLodExclude(inPath, source(subfolders.mods));
  const excludeItems = [...collectGeneratedModels(game), ...userExcluded];
  log(
    `excluding ${excludeItems.length} models from sa/opensa LODs ` +
      `(${userExcluded.length} user-curated via lod-exclude.json)`,
  );
  // Hole-fill list (plan 086 phase 5): per-GAME data, not code — stock SA's list lives in
  // mods-src/original/lod-holes.json; a TC without the file gets none (the curated names are SA's).
  const holeFillModels = loadLodHoles(inPath, source(subfolders.mods));
  // Always-on lods (plan 087, `lod-always.json`): lod-target models that ARE the content (a stub HD, the
  // real geometry behind its lod link — gostown's LODEnsemble* forests). The strip keeps them and the
  // pak welds them into BOTH levels; the cell bake still skips them (it bakes HD, i.e. the stub).
  const alwaysOnLods = loadLodAlways(inPath, source(subfolders.mods));
  const saDone = doneStep('sa');
  if (runsStage('sa', until, excluded) && saDone) {
    assertResumedDir(saDone); // the finished target IS the deliverable — gone means the resume cannot stand in
    skipDone(saDone);
    produced.push({ dir: saDone.dir, name: 'sa' });
  } else if (runsStage('sa', until, excluded)) {
    // Recorded as ONE resume step (its `sa` + `procobj` timings stay their own rows): a real-SA target that
    // dies in a gate re-enters at the LOD build, not at stage 1.
    const saStarted = Date.now();
    const built = await buildSaTarget({
      addVehiclesIn: source(subfolders.addVehicles),
      config,
      cutsceneFleet: common.cutscene !== undefined,
      excluded,
      excludeItems,
      game,
      hasAddedVehicles: populated(subfolders.addVehicles),
      holeFillModels,
      outPath,
      procobjIn: source(subfolders.procobj),
      sourceGame: gamePath,
      timed,
      until,
    }).catch((error: unknown) => {
      recordFailure('sa', error);
      finishTimings({ error: error instanceof Error ? error.message : String(error), step: 'sa' });
      throw error;
    });
    recordStep('sa', join(outPath, 'sa'), Number(((Date.now() - saStarted) / 1000).toFixed(1)));
    shippedAsi = built.shippedAsi;
    shippedCutsceneAsi = built.shippedCutsceneAsi;
    produced.push(built.produced);
    // The report this target never had (plan 005): the census, the FLA pools and the lift requirements used
    // to exist only as console output nobody could diff.
    writeTargetReport(outPath, {
      builtAt: new Date().toISOString(),
      fragments: { ...common, sa: built.fragment },
      game: gameId,
      gamePath,
      target: 'sa',
      timings: [...timings],
    });
  }
  if (runsStage('opensa', until, excluded)) {
    log(OPENSA_BUDGET_NOTICE);
    const built = await step('opensa', join(outPath, 'opensa'), () =>
      buildOpensaTarget({
        alwaysOnLods,
        config,
        excludeItems,
        game,
        gamePath,
        holeFillModels,
        // The LOD build + linear-txd swap is its own resume step: a pack that dies (the archive rewrite,
        // 2026-08-17) re-enters at the pack with the kept `opensa-lod`, not at the 40-minute cell bake.
        lodDone: doneStep('opensa-lod') !== undefined && existsSync(join(work, 'opensa-lod')),
        log,
        onLodDone: (seconds) => recordStep('opensa-lod', join(work, 'opensa-lod'), seconds),
        outPath,
        packing: until !== 'opensa' && !excluded.has('pack'),
        work,
      }),
    );
    produced.push(...built.produced);
    writeTargetReport(outPath, {
      builtAt: new Date().toISOString(),
      fragments: { ...common, ...(built.pack ? { pack: built.pack } : {}) },
      game: gameId,
      gamePath,
      target: 'opensa',
      timings: [...timings],
    });
  }

  // The sidecars are split-time inputs, not game content — keep the final targets clean. (The opensa side
  // already dropped its own above, before the convert read the dir.)
  for (const target of produced.filter(({ name }) => name === 'sa')) {
    rmSync(join(target.dir, 'linear-txd'), { force: true, recursive: true });
    rmSync(join(target.dir, 'opensa-dff'), { force: true, recursive: true });
  }

  if (!keepWork) {
    rmSync(work, { force: true, recursive: true });
  }
  finishTimings();

  return { produced, stoppedEarly: until !== undefined };
}

/**
 * The HD + LOD model names (lowercased) that lod-trees/lod-procobj produced in the common build — the set the final
 * sa/opensa LOD generators must skip. Sourced from the generated data files: `lodtrees.ide` (tree impostor LODs) +
 * the tree HD roster, `lod_procobj.ide` (procobj LODs), `lod_procobj.models` (converted HD species — the HD
 * placement layer is binary streams now) and `lod_procobj.ipl` (legacy monolith builds).
 * Missing files (a stage that was skipped) contribute nothing.
 */
export function collectGeneratedModels(gameDir: string): string[] {
  const names = new Set<string>();
  const maps = join(gameDir, 'data', 'maps');
  const addIde = (rel: string): boolean => {
    const file = join(maps, rel);
    if (!existsSync(file)) {
      return false;
    }
    for (const def of parseIde(readFileSync(file, 'utf8'))) {
      names.add(def.modelName.toLowerCase());
    }

    return true;
  };
  const addIpl = (rel: string): void => {
    const file = join(maps, rel);
    if (existsSync(file)) {
      for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
        names.add(inst.modelName.toLowerCase());
      }
    }
  };
  if (addIde('lodtrees.ide')) {
    for (const tree of SA_TREE_MODELS) {
      names.add(tree); // swapped HD trees — their impostors are the far-LOD, don't re-clone/re-bake the HD
    }
  }
  addIde('lod_procobj.ide');
  addIpl('lod_procobj.ipl'); // legacy monolith layout (pre-binary-streams builds)
  // Binary-streams layout: HD species live in `<area>_streamN.ipl` (id-only), so their names come from the
  // manifest convertProcObj writes alongside the area IPLs.
  const manifest = join(maps, 'lod_procobj.models');
  if (existsSync(manifest)) {
    for (const line of readFileSync(manifest, 'utf8').split(/\r?\n/)) {
      if (line.trim()) {
        names.add(line.trim().toLowerCase());
      }
    }
  }

  return [...names];
}

/**
 * Every `--exclude` value on a command line, comma-separated and/or repeated, validated against
 * {@link EXCLUDABLE_STAGES}. A typo has to fail LOUDLY: silently ignoring one would produce a build missing
 * the target it was meant to keep, and nothing downstream can tell that from a target nobody asked for.
 */
export function parseExcludedStages(argv: readonly string[]): ExcludableStage[] {
  const names = argv
    .flatMap((arg, index) => (arg === '--exclude' ? (argv[index + 1] ?? '').split(',') : []))
    .map((name) => name.trim())
    .filter((name) => name !== '');
  for (const name of names) {
    if (!EXCLUDABLE_STAGES.includes(name as ExcludableStage)) {
      throw new Error(`--exclude must name one of: ${EXCLUDABLE_STAGES.join(' | ')} (got '${name}')`);
    }
  }

  return [...new Set(names as ExcludableStage[])];
}

/**
 * The host a run is building FOR — `--target`, or DERIVED from `--exclude` when it is omitted, because the
 * exclusion set is already what declares a target today (`build:game:<id>:opensa` is `--exclude sa`; see
 * `docs/restrictions/architecture.md`). A run that builds BOTH resolves to `sa`: the common chain is shared,
 * so its content has to satisfy the host that still has ceilings.
 *
 * One combination cannot be honest and is refused at CONFIG time rather than by a guard three stages later
 * (07/02 decision 3): `--target opensa` while the `sa` target is still being built would hand the real game a
 * layer priced against a host with no building pool and no RenderWare streaming at all. The reverse — an
 * opensa-only build carrying the `sa` profile — is merely conservative, so it is allowed and logged.
 *
 * The differences that remain are the HOST's, not a ceiling's: SA's `CBuilding` pool and its particle policy.
 * int16 stopped being one of them on 2026-08-09 (see {@link reportTextIplCensus}) — the target lifts it.
 */
export function resolveBuildTarget(
  explicit: BuildTarget | undefined,
  excluded: ReadonlySet<ExcludableStage>,
): BuildTarget {
  if (explicit === 'opensa' && !excluded.has('sa')) {
    throw new Error(
      '--target opensa builds the `sa` target too: add --exclude sa, or build with --target sa. The common ' +
        "chain is shared, so an opensa profile would price the real game's content against a host that has no " +
        'building pool and no RenderWare streaming.',
    );
  }

  return explicit ?? (excluded.has('sa') ? 'opensa' : 'sa');
}

/**
 * Whether a POST-SPLIT stage runs under the given `--until` and `--exclude` — the two targets, and `procobj`,
 * which is baked inside the `sa` branch since plan 014. `STAGE_NAMES` is the pipeline ORDER, so
 * `--until <stage>` means "run everything up to and including it" — `--until pack` builds `sa` too, because
 * `sa` precedes `pack`. (It used to be an explicit name list, which silently dropped the whole `sa` target from
 * `--until pack`/`--until opensa` runs: no log line, no error, just a missing build.) `--exclude` overrides that
 * ordering: an excluded stage never runs, whatever `--until` says.
 */
export function runsStage(
  stage: 'opensa' | 'procobj' | 'sa',
  until: StageName | undefined,
  exclude: ReadonlySet<ExcludableStage> = new Set(),
): boolean {
  if (exclude.has(stage)) {
    return false;
  }

  return until === undefined || until === 'lod' || STAGE_NAMES.indexOf(stage) <= STAGE_NAMES.indexOf(until);
}

/**
 * Swap the OpenSA sidecars of the common build into the opensa target's `gta3.img`, by entry name.
 *
 * Two sidecars, one rule — the built tree carries the REAL-SA shape so every bootable `.work` stage stays
 * SA-correct, and what OpenSA needs differently rides beside it:
 * - `linear-txd/*.txd` — the same texels in the linear convention OpenSA's pipeline decodes (plan 012);
 * - `opensa-dff/*.dff` — the impostor cage as OpenSA's weld wants it, four full-alpha cards against the
 *   three thinned ones SA composites (lod-trees plan 013 step 06).
 */
export function swapLinearTxds(commonDir: string, opensaDir: string): void {
  const sidecars = [
    { dir: join(commonDir, 'linear-txd'), what: 'linear-convention TXD' },
    { dir: join(commonDir, 'opensa-dff'), what: 'impostor DFF' },
  ].filter((sidecar) => existsSync(sidecar.dir));
  const swaps = sidecars
    .map((sidecar) => ({ ...sidecar, names: readdirSync(sidecar.dir) }))
    .filter((s) => s.names.length > 0);
  if (swaps.length === 0) {
    return;
  }
  const imgPath = join(opensaDir, 'models', 'gta3.img');
  const buffer = readFileSync(imgPath);
  const img = editArchive(openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)));
  for (const swap of swaps) {
    for (const name of swap.names) {
      const bytes = readFileSync(join(swap.dir, name));
      img.set(name.toLowerCase(), new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    }
    log(`opensa: swapped ${swap.names.length} ${swap.what}(s)`);
  }
  writeFileSync(imgPath, img.build());
}

/**
 * Written whenever the target's branch RAN — `--until opensa` / `--exclude pack` still get a (pack-less)
 * `report-opensa.json`; a run stopped in the common chain writes none, deliberately: no target finished.
 */
export function writeTargetReport(outPath: string, report: TargetReport): void {
  const path = join(outPath, `report-${report.target}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  log(`${report.target}: report → ${path}`);
}

/**
 * The `opensa` target: the cell-LOD build, then OUR conversion of it.
 *
 * `--until opensa` (or `--exclude pack`) asks for the LOD build itself, so it lands in the final directory and
 * stops there. Otherwise the pack stage is the last thing to touch this target, so the LOD build is an
 * intermediate and the CONVERTED dir takes the `opensa/` name — every stage still hands the next a complete
 * game tree.
 */
async function buildOpensaTarget(step: {
  /** Per-game always-on lod-target list (`lod-always.json`) — kept by the strip, welded into both levels. */
  alwaysOnLods: string[];
  config: BuilderConfig;
  excludeItems: string[];
  game: string;
  /** The run's ORIGINAL `--game` dir — the fetch game id source (plan 086); `game` above is a work stage. */
  gamePath: string;
  /** Per-game hole-fill list (`lod-holes.json`) — exempt from the cell bake's reduction tracks. */
  holeFillModels: string[];
  /** `--resume`: the LOD build + swap already finished in the run being resumed and its dir is in place. */
  lodDone?: boolean;
  log: (message: string) => void;
  /** Called once the LOD build + swap is done, with its seconds — the resume point inside this target. */
  onLodDone?: (seconds: number) => void;
  outPath: string;
  /** Whether the convert runs. False (`--until opensa` / `--exclude pack`) leaves `opensa/` in GAME format. */
  packing: boolean;
  work: string;
}): Promise<{ pack: null | PackFragment; produced: { dir: string; name: string }[] }> {
  const { alwaysOnLods, config, excludeItems, game, holeFillModels, log, outPath, packing, work } = step;
  const opensa = join(outPath, 'opensa');
  const lodDir = packing ? join(work, 'opensa-lod') : opensa;
  // The bake's screen-error promise (201/1-05) — read from the config on a resumed run, whose kept
  // `opensa-lod` was baked by an earlier run of the same pinned config, and returned by the bake otherwise.
  let lodPromise = opensaLodPromise();
  if (step.lodDone) {
    log(`opensa-lod — done in the run being resumed, skipped (${lodDir})`);
  } else {
    const lodStarted = Date.now();
    log(`opensa → ${packing ? `${basename(work)}/opensa-lod` : 'opensa/'} (baking cells — can take several minutes)`);
    lodPromise = await buildOpensaLods({
      cellSize: config.lodCellSize,
      config: { excludeItems, holeFillModels },
      gameDir: game,
      keepLods: alwaysOnLods,
      outDir: lodDir,
      stripLods: true,
    });
    // The LOD build is the last thing that mutates the game dir, and `swapLinearTxds` rewrites the very texels
    // the pak carries — so it must run BEFORE the convert, not after it. The sidecar goes with it: it is a
    // split-time input, not game content.
    swapLinearTxds(game, lodDir);
    rmSync(join(lodDir, 'linear-txd'), { force: true, recursive: true });
    rmSync(join(lodDir, 'opensa-dff'), { force: true, recursive: true });
    step.onLodDone?.(Number(((Date.now() - lodStarted) / 1000).toFixed(1)));
  }
  if (!packing) {
    return { pack: null, produced: [{ dir: opensa, name: 'opensa' }] };
  }
  log('pack → opensa/ (converting the map into our format — several minutes)');
  // The fetch game id (plan 086): the USER-FACING --game folder, not this work-stage intermediate.
  const gameId = basename(resolve(step.gamePath));
  // Per-game rect (plan 087): a run-config override wins, else the game's pinned `full` rect from
  // PACK_RECTS, else the convert auto-fits to content (a new TC without a pinned extent).
  const packRect = config.pack.rect ?? PACK_RECTS[gameId]?.full;
  const packed = await packGameDir({
    ...(alwaysOnLods.length > 0 ? { alwaysOnLods } : {}),
    ao: config.pack.ao,
    // 200/3-01: when on, every cell's collision is written into the pak and the browser stops parsing COL
    // for it. Passed through rather than defaulted here — the flag IS the A/B.
    ...(config.pack.bakeCollision ? { bakeCollision: true } : {}),
    ...(config.pack.bakeWorkers !== undefined ? { bakeWorkers: config.pack.bakeWorkers } : {}),
    bakes: config.pack.bakes,
    // The weld's per-chunk checkpoints live beside the pack input (plan 006): a pack that dies re-enters at
    // its last finished chunk when the run is resumed, and the dir goes with the work dir when the run is green.
    checkpointDir: join(work, 'pack-checkpoints'),
    gameDir: lodDir,
    gameId,
    // The bake states its own screen-error promise and the pak carries it, so the streamer picks HD by
    // projected error rather than by a ring radius (plan 201/1-05).
    lodPromise,
    log: (message) => log(`pack: ${message}`),
    // Plan 086 phase 8: the game dir is self-contained — the pak lands in `<out>/opensa/pak` (the default).
    outDir: opensa,
    resume: step.lodDone === true,
    ...(packRect !== undefined ? { rect: packRect } : {}),
  });

  // The pack's FULL report stays beside its pak (`<out>/opensa/pak/report.json`) — the fragment is a summary
  // plus that pointer, never a root-level copy of the pack's report wearing the run's name (plan 005).
  return {
    pack: {
      cells: packed.report.cells.length,
      pakBytes: packed.report.pakBytes,
      report: join('opensa', 'pak', 'report.json'),
    },
    produced: [
      { dir: lodDir, name: 'opensa-lod' },
      { dir: opensa, name: 'pack' },
    ],
  };
}

/**
 * The `sa` (real game) target: the LOD build, the in-place procobj bake, every ceiling gate on the FINISHED
 * tree, and the asi shipped beside the map. Returns the tree it produced and its report fragment (plan 005).
 */
async function buildSaTarget(step: {
  /** The mods-src `add-vehicles/` subfolder — the ADDED cars, this target's alone (central plan 102). */
  addVehiclesIn: string;
  config: BuilderConfig;
  /** Whether the cutscene stage ran — the gate on shipping `perfect-cutscene.asi` beside the fleet it needs. */
  cutsceneFleet: boolean;
  excluded: ReadonlySet<ExcludableStage>;
  excludeItems: string[];
  /** The common baked build both targets are fed from. */
  game: string;
  /** Whether that folder actually holds cars — an empty root is not a stage. */
  hasAddedVehicles: boolean;
  holeFillModels: string[];
  outPath: string;
  /** The mods-src `procobj/` subfolder (may be absent — the bake falls back to the built-in roster). */
  procobjIn: string;
  /** The UNTOUCHED `--game` tree — the baseline for what the original itself already ships twice. */
  sourceGame: string;
  timed: <T>(name: string, run: () => Promise<T> | T) => Promise<T>;
  until: StageName | undefined;
}): Promise<{
  fragment: SaFragment;
  produced: { dir: string; name: string };
  shippedAsi: null | { sha256: string };
  shippedCutsceneAsi: null | { sha256: string };
}> {
  const { config, cutsceneFleet, excluded, excludeItems, game, holeFillModels, outPath, procobjIn, timed, until } =
    step;
  const sa = join(outPath, 'sa');
  log('sa → sa/');
  await timed('sa', () => buildSaLods({ config: { excludeItems, holeFillModels }, gameDir: game, outDir: sa }));
  // The procobj clutter is baked into the FINISHED sa tree, in place (plan 014). It belongs to this target
  // alone: OpenSA scatters the same species at runtime, where draw distance is a setting and none of SA's
  // ceilings exist, so baking it into the common build would cost that target a stripped `procobj.dat` (9
  // rules of 96 survived it) and 91 092 vertex-duplicated instances in its pak for nothing.
  //
  // After `buildSaLods`, not before: the LOD generators work from placements, so clutter that does not exist
  // yet gets no far-LODs — which is what we want for objects whose range now comes from their IDE row.
  if (runsStage('procobj', until, excluded)) {
    log('procobj → sa/');
    await timed('procobj', () =>
      buildProcobjLods({
        config: {
          density: config.procobjDensity,
          ...(config.procobjMax !== undefined ? { procObjMax: config.procobjMax } : {}),
        },
        gamePath: sa,
        inPath: procobjIn,
        outPath: sa,
        prelight: true,
        target: 'sa',
      }),
    );
  }
  // The added cars belong to this target alone, and they are added to a build that already exists — so the
  // plugin that legalises their `carmods.dat` goes in first, then the cars, then the guards price them.
  shipPerfectVehicleAsi(sa, PERFECT_VEHICLE_ASI);
  addVehiclesIntoSa(sa, step.addVehiclesIn, step.hasAddedVehicles);
  // Every SA ceiling is checked HERE, on the tree the real game loads — not on the shared build. The LOD
  // stage appends hole-fill instances to the copied text IPLs, so the common build undercounts the rows.
  const census = reportTextIplCensus(sa);
  checkInstBearingIplSlots(census.instBearingIpls);
  // Every stage that edited an `inst` section has now had its turn, so this is the only place the LOD links
  // can be judged whole — see {@link assertLodLinks}.
  assertLodLinks(sa);
  // …and that nothing the tree places is defined further down `gta.dat` than the row placing it.
  assertDefinitionOrder(sa);
  // …and the same for what `gta.dat` claims the tree holds: a line pointing at nothing is a crash in the
  // data load, and the field only ever sees it as an access violation in ntdll.
  assertGtaDatFiles(sa);
  // The archive table, checked on the FINISHED tree — the split registers what it creates and the vehicle
  // install registers its spill sibling, so the total is only known here. A ceiling the game answers with a
  // crash at load and no build-side symptom, which is exactly the kind this branch gates rather than prints.
  assertArchiveSlots(countImgArchives(sa), false);
  const imgBudgets = checkImgIdBudgets(sa);
  // One name, one archive. The game resolves an entry by name across every registered archive, so a name held
  // twice means one of the two files never loads — and the symptom is a car wearing another's textures, not
  // an error (plan 103). The STOCK game ships six such names; those are a fact about it, not our defect.
  assertOneOwnerPerEntry(sa, step.sourceGame);
  // The other pair of configured pools: an `inst` row spends a CBuilding or a CDummy depending on whether
  // `object.dat` tunes its model, and until 2026-08-19 nothing counted the second — which is how a build
  // shipped 17 644 dummies against a 50 000 pool and the field met `0x00538103` on the third LOAD GAME.
  const entityPools = checkEntityPoolBudgets(sa);
  reportInstallRequirements(census, imgBudgets);
  // The archive report, restated on the FINISHED tree: the split wrote it six stages ago, and everything
  // since has grown gta3.img and added a spill sibling. A report that ships describing an earlier tree is
  // worse than none.
  writeArchiveManifest(sa);
  // Ship the fix beside the map that needs it — stating a requirement and not satisfying it is half a job.
  const shippedAsi = shipPerfectMapAsi(sa, PERFECT_MAP_ASI);
  // Same rule for the fleet: a build that converted the cutscene cars ships the plugin they were swept with.
  const shippedCutsceneAsi = cutsceneFleet ? shipPerfectCutsceneAsi(sa, PERFECT_CUTSCENE_ASI) : null;

  return {
    fragment: {
      census,
      entityPools,
      imgBudgets,
      perfectCutsceneAsiSha256: shippedCutsceneAsi?.sha256 ?? null,
      perfectMapAsiSha256: shippedAsi?.sha256 ?? null,
      requirements: installRequirements(census, imgBudgets),
    },
    produced: { dir: sa, name: 'sa' },
    shippedAsi,
    shippedCutsceneAsi,
  };
}

/** File a stage's outcome under its stage name — the runner-side half of the fragment contract (plan 005). */
function collectFragment(fragments: TargetReportFragments, outcome: ChainOutcome): void {
  if (!outcome) {
    return;
  }
  if (outcome.stage === 'cutscene') {
    fragments.cutscene = outcome.fragment;
  } else {
    fragments.optimize = outcome.fragment;
  }
}

/**
 * The cutscene stage (vehicle-cutscene plan 002 step 11): reads the INSTALLED game the vehicles stage
 * produced — merged carcols for the paint bake, mod TXDs in gta3.img as the empty-TXD route's txdp
 * parents. A slot error here is a broken build, not a per-slot condition to carry: with the parents
 * installed, a closure miss means the vehicle install itself is incomplete — fail loudly, every slot named.
 */
function runCutsceneStage(
  game: string,
  inPath: string,
  out: string,
  target: BuildTarget,
): { fragment: CutsceneFragment; stage: 'cutscene' } {
  const summary = installCutscene({ gamePath: game, inPath, outPath: out, target });
  if (summary.errors.length > 0) {
    const named = summary.errors.map((error) => `${error.csName}: ${error.message}`).join('\n  ');
    throw new Error(`cutscene conversion failed for ${summary.errors.length} slot(s):\n  ${named}`);
  }
  log(
    `  cutscene — ${summary.converted.length} converted, ${summary.skipped.length} skipped, ` +
      `${summary.plates.length} plate(s) baked, ` +
      `img ${(summary.imgBytesBefore / 1e6).toFixed(1)} → ${(summary.imgBytesAfter / 1e6).toFixed(1)} MB, ` +
      `${summary.txdBytes} B of cs TXDs`,
  );

  return {
    fragment: {
      converted: summary.converted,
      imgBytesAfter: summary.imgBytesAfter,
      plates: summary.plates,
      skipped: summary.skipped,
      txdBytes: summary.txdBytes,
      warnings: summary.warnings,
    },
    stage: 'cutscene',
  };
}

/**
 * Stage the cutscene conversion — only downstream of a RUN vehicles stage: on a tree without the
 * installed parents every slot fails closure, so `--exclude vehicles` drops this stage too, loudly (a
 * silently missing stage reads as a broken build; `build:game:original:sa` excludes vehicles today).
 */
function stageCutscene(
  chain: { name: ExcludableStage; run: (game: string, out: string) => ChainOutcome | Promise<ChainOutcome> }[],
  excluded: ReadonlySet<ExcludableStage>,
  vehiclesPopulated: boolean,
  vehiclesSource: string,
  target: BuildTarget,
  gamePath: string,
): void {
  if (!vehiclesPopulated) {
    return;
  }
  if (excluded.has('vehicles')) {
    if (!excluded.has('cutscene')) {
      log('cutscene — skipped (vehicles stage excluded; the conversion needs the INSTALLED game)');
    }

    return;
  }
  // A total conversion may ship no cutscene archive at all (gostown has none) — there is nothing to convert
  // the fleet's twins INTO, so the stage is skipped, loudly, instead of dying on the missing file at run time
  // (2026-08-17: the first gostown build since the stage was added died here after the vehicles stage).
  if (!existsSync(join(gamePath, 'models', 'cutscene.img'))) {
    if (!excluded.has('cutscene')) {
      log('cutscene — skipped (the game ships no models/cutscene.img; no cutscene fleet to convert)');
    }

    return;
  }
  chain.push({ name: 'cutscene', run: (game, out) => runCutsceneStage(game, vehiclesSource, out, target) });
}

/** FLA ID-pool budgets for the real-SA build. Each row counts ARCHIVE FILES = ID slots. `stock` is the pool
 *  FLA builds when its ini line is absent or `#`-disabled (the ini states it in the comment above each line);
 *  the OPERATIVE ceiling is read from the adjuster ini THIS BUILD SHIPS into the tree root — {@link flaIdPools}.
 *  The margins leave room for SA's runtime slots (script/generic/ped-remap TXDs etc.) — exhausting a pool
 *  corrupts the heap during data load, with the crash landing somewhere unrelated a few seconds later.
 *
 *  **These were constants until 2026-08-18, and that is precisely how the class recurs.** A guard number ABOVE
 *  the install's pool is silent by construction: it claimed TXD 6000 while the shipped ini said 5000, so a
 *  5 177-archive build reported headroom and the game died at boot the first time a delivery carried the ini
 *  ([write-up](../../../docs/open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md); the 2026-07
 *  `FILE_TYPE_IPL` exhaustion was the same class). Per the target rule in `CLAUDE.md` a real FLA pool is a
 *  configured NUMBER — raised in the ini rather than designed down to — so the guard has to read the number
 *  that will actually be in force, and say where it read it.
 */
const IMG_ID_BUDGETS = [
  { ext: '.txd', key: 'FILE_TYPE_TXD', label: 'TXD archives', margin: 50, stock: 5000 },
  { ext: '.col', key: 'FILE_TYPE_COL', label: 'COL archives', margin: 8, stock: 255 },
  { ext: '.ipl', key: 'FILE_TYPE_IPL', label: 'binary IPL files', margin: 8, stock: 256 },
] as const;

/** One stage's wall clock. `seconds` is measured, never derived from a diff of two other numbers. */
export interface StageTiming {
  name: string;
  /** Recorded by an earlier run and carried over by `--resume` — never a fresh measurement of this run. */
  resumed?: true;
  seconds: number;
}

/**
 * Refuse a built tree that holds one entry name in two of the archives THE SPLIT OWNS.
 *
 * The game resolves a streaming entry by NAME across every registered archive, so two files under one name
 * means one of them never loads — silently, with every file valid and every archive registered. It cost a
 * field round on 2026-08-20: `slamvan.txd` sat in `gta3.img` (stock) and in `vehicles2.img` (the mod's), the
 * stock one won, and the car rendered with no textures at all because the mod's model names textures the
 * stock dictionary does not carry.
 *
 * **Scope: `gta3.img` and whatever came OUT of it** — the buckets the split writes and their spill siblings,
 * recognised as the archives the SOURCE tree does not have. Those are the only ones whose contents this
 * build decides, and every car and car part is in there (the user's call, 2026-08-20).
 *
 * The archives it therefore does not police are the original's own, and they carry six duplicates that are
 * not defects: `player.img` is the CLOTHES archive and its `coach.txd` is a single 256×256 texture named
 * `coach`, nothing to do with the bus of that name in `gta3.img`; `gta_int.img` repeats four map and
 * interior dictionaries. None of them is ours to resolve, and a baseline read by NAME would have let a
 * duplicate of ours ride in under one of them.
 */
export function assertOneOwnerPerEntry(gameDir: string, sourceGameDir?: string): void {
  const stockArchives = new Set(archiveNames(sourceGameDir));
  const ours = archiveNames(gameDir).filter((name) => name.toLowerCase() === 'gta3.img' || !stockArchives.has(name));
  const held = duplicateEntryNames(gameDir, ours);
  if (held.size === 0) {
    log(`  archive entries: one owner each across ${ours.length} archive(s) the split owns`);

    return;
  }
  throw new Error(
    `${held.size} archive entry name(s) are held by more than one archive this build writes. The game ` +
      `resolves an entry by name across every registered archive, so one of the two files never loads and ` +
      `the symptom is geometric, not an error:\n  ` +
      [...held].map(([name, archives]) => `${name} — ${archives.join(', ')}`).join('\n  '),
  );
}

/**
 * Fail the build when a real-SA ID pool is at (or within `margin` of) its cap — loud at build time instead of
 * heap corruption at boot. Counts every entry across the build's IMG archives.
 */
export function checkImgIdBudgets(gameDir: string): Record<string, number> {
  const names: string[] = [];
  // EVERY archive in the tree, enumerated rather than listed. The four stock names were hard-coded until the
  // split started producing `vehicles.img` and its spill siblings — and an archive this guard does not know
  // about is an UNDER-count, which is the silent direction: the pools stay unreported until the game
  // corrupts its heap during data load.
  const modelsDir = join(gameDir, 'models');
  const archives = existsSync(modelsDir)
    ? readdirSync(modelsDir).filter((name) => name.toLowerCase().endsWith('.img'))
    : [];
  for (const img of archives) {
    const path = join(modelsDir, img);
    if (!existsSync(path)) {
      continue;
    }
    const buffer = readFileSync(path);
    const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    names.push(...archive.names.map((name) => name.toLowerCase()));
  }
  const { pools, source } = flaIdPools(gameDir);
  const counted: Record<string, number> = {};
  for (const budget of IMG_ID_BUDGETS) {
    const limit = pools[budget.ext] ?? budget.stock;
    const count = names.filter((name) => name.endsWith(budget.ext)).length;
    counted[budget.ext] = count;
    const message = `${budget.label}: ${count} of ${limit} ID slots (margin ${budget.margin} for SA's runtime slots)`;
    if (count > limit - budget.margin) {
      throw new Error(
        `real-SA ID pool nearly exhausted — ${message}. Ceiling read from: ${source}. Raise ${budget.key} in ` +
          'the adjuster ini the build SHIPS (mods-src/<game>/mods/sa/…, not just the bottle) and record the new ' +
          'value in docs/gta-sa-original/reference-install-config.md, or trim the build (the salod txdp ' +
          'partition is the biggest TXD consumer).',
      );
    }
    log(`  id budget — ${message}, per ${source}`);
  }

  return counted;
}

/**
 * The ID pools the target will really run, read off the adjuster ini this build ships into the tree root
 * (`fastman92limitAdjuster*.ini`, installed by the mods stage — so the ini is a build OUTPUT and a delivery
 * carries it). Three things are NOT a value and fall back to FLA's own defaults, each said out loud: a
 * `#`/`;`-disabled line, an ini whose `Apply ID limit patch` is off (every raise in it is inert), and a tree
 * with no adjuster ini at all. Falling back DOWN is the safe direction — it can only make the guard stricter.
 */
export function flaIdPools(gameDir: string): { pools: Record<string, number>; source: string } {
  const stock = Object.fromEntries(IMG_ID_BUDGETS.map((budget) => [budget.ext, budget.stock as number]));
  const ini = existsSync(gameDir)
    ? readdirSync(gameDir).find((name) => /^fastman92limitadjuster.*\.ini$/i.test(name))
    : undefined;
  if (ini === undefined) {
    return { pools: stock, source: 'no fastman92limitAdjuster*.ini in the tree, so FLA defaults' };
  }
  const text = readFileSync(join(gameDir, ini), 'utf8');
  // A leading `#` or `;` disables a line in fastman92's format, so the pattern anchors on the key itself.
  const active = (key: string): number | undefined => {
    const match = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(\\d+)`, 'im').exec(text);

    return match === null ? undefined : Number(match[1]);
  };
  if ((active('Apply ID limit patch') ?? 0) === 0) {
    return { pools: stock, source: `${ini} (ID limit patch NOT applied, so FLA defaults)` };
  }

  return {
    pools: Object.fromEntries(IMG_ID_BUDGETS.map((budget) => [budget.ext, active(budget.key) ?? budget.stock])),
    source: ini,
  };
}

/** The `models/*.img` names a tree carries — none when it has no such folder, or none was given. */
function archiveNames(gameDir: string | undefined): string[] {
  const modelsDir = gameDir === undefined ? undefined : join(gameDir, 'models');

  return modelsDir !== undefined && existsSync(modelsDir)
    ? readdirSync(modelsDir).filter((name) => name.toLowerCase().endsWith('.img'))
    : [];
}

/** Entry name → which of `archives` holds it, for names held more than once. Read through the directories. */
function duplicateEntryNames(gameDir: string, archives: readonly string[]): Map<string, string[]> {
  const modelsDir = join(gameDir, 'models');
  const holders = new Map<string, string[]>();
  for (const file of archives) {
    const reader = openLazyVer2(join(modelsDir, file));
    for (const name of reader?.names ?? []) {
      holders.set(name.toLowerCase(), [...(holders.get(name.toLowerCase()) ?? []), file]);
    }
  }

  return new Map([...holders].filter(([, archives]) => archives.length > 1));
}

/**
 * **Stock ceilings this artifact would breach** — plan 013 decision 8, and the honest replacement for the
 * int16 throw deleted on 2026-08-09. The build stopped shaping its output down to a stock 1.0 that we do not
 * ship to; what it owes instead is a plain statement of the install it DOES require, printed every run so the
 * requirement is read off the artifact rather than remembered.
 *
 * Every number here is one the build already has. Each row is a stock ceiling, what we spend against it, and
 * the setting that lifts it — the third column is the whole point: a breach is an instruction, not a fault.
 */
export const STOCK_CEILINGS = {
  /** `gpLoadedBuildings`, per text IPL plus its boot streams. */
  rowsPerIpl: 4_096,
  /** `CIplStore::IncludeEntity` truncates the building-pool index to int16, map-wide. */
  rowsTotal: 32_767,
} as const;

/** One stock ceiling this build crosses, and the setting that lifts it. */
export interface InstallRequirement {
  ceiling: number;
  lift: string;
  spent: number;
  what: string;
}

/**
 * Fail the build when `gta.dat` registers a file the tree does not have.
 *
 * SA opens what its `gta.dat` lists **without checking**, so a line pointing at nothing is an access violation
 * during the data load — the crash names the path only in a stack dump, if the player thinks to send one. The
 * class is real and cheap to create: a stage that registers a file it then does not write (or stops writing,
 * as `salod-txdp.ide` did when the `txdp` parent was retired on 2026-08-16) leaves exactly this. It also
 * catches the delivery half — a hand-copied install whose `data/` and `gta.dat` came from different builds.
 */
export function assertGtaDatFiles(gameDir: string): void {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    console.warn(`  ! sa gta.dat file check SKIPPED — no data/gta.dat under ${gameDir}`);

    return;
  }
  const missing: string[] = [];
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^(IDE|IPL|IMG|COLFILE|TEXDICTION|MODELFILE|HIERFILE|SPLASH)\s+(?:\d+\s+)?(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toUpperCase() === 'SPLASH') {
      continue;
    }
    const relative = match[2].trim().replace(/\\/g, '/');
    if (!existsSync(join(gameDir, relative))) {
      missing.push(`${match[1].toUpperCase()} ${match[2].trim()}`);
    }
  }
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `data/gta.dat registers ${missing.length} file(s) the tree does not have — SA opens them without a ` +
      `bounds check and dies during the data load:\n${missing.map((entry) => `  ${entry}`).join('\n')}`,
  );
}

/** The requirement list for a built tree — pure, so the wording is testable without a game dir. */
export function installRequirements(
  census: { largestIpl: number; rows: number },
  imgCounts: Record<string, number>,
): InstallRequirement[] {
  const rows: InstallRequirement[] = [
    {
      ceiling: STOCK_CEILINGS.rowsTotal,
      lift: 'perfect-map.asi (no adjuster provides it — measured 2026-08-07)',
      spent: census.rows,
      what: 'permanent text-IPL rows, map-wide',
    },
    {
      ceiling: STOCK_CEILINGS.rowsPerIpl,
      lift: 'OLA `EntitiesPerIpl`',
      spent: census.largestIpl,
      what: 'rows in one text IPL',
    },
    ...IMG_ID_BUDGETS.map((budget) => ({
      ceiling: budget.stock,
      lift: `FLA ${budget.label.split(' ')[0]} id pool`,
      spent: imgCounts[budget.ext] ?? 0,
      what: budget.label,
    })),
  ];

  return rows.filter((row) => row.spent > row.ceiling);
}

/** Print it. A LINE, never a throw — the guards above own the ceilings that are real on the target. */
export function reportInstallRequirements(
  census: { largestIpl: number; rows: number },
  imgCounts: Record<string, number>,
): void {
  const needed = installRequirements(census, imgCounts);
  if (needed.length === 0) {
    log('sa install requirements: none — this build fits a stock 1.0 unaided');

    return;
  }
  log(`sa install requirements: ${needed.length} stock ceiling(s) crossed, each lifted by a setting:`);
  for (const row of needed) {
    log(`  needs ${row.lift} — ${row.what}: ${row.spent} over stock's ${row.ceiling}`);
  }
}

/**
 * What the built `sa/` tree COSTS in permanent text-IPL rows and inst-bearing IPL slots. **A census for the
 * ROWS, a gate for the SLOTS** — the row half stayed a census on 2026-08-09 (the user's call: `perfect-map.asi`
 * lifts the int16 pool index where our data lands, so it is not a limit our content is designed against —
 * `docs/project-goals.md` directive 3). The slot half became {@link checkInstBearingIplSlots} on 2026-08-10,
 * when the field killed the belief that OLA lifts it too. The two halves of this function are now the two sides
 * of the same rule: **delete the museum pieces, keep the gates** — and which is which is answered by the
 * target, never by an ini.
 *
 * What died with the gate, and why it was never a gate worth having:
 *
 * - **the throw** failed every `sa` build to ration an install we do not build for. Past the 2026-08-09
 *   procobj column fix the layer alone costs 39 219 rows, so the condition was constant — and a condition that
 *   is always true is a print statement wearing a guard's clothes.
 * - **the `TEXT_ROW_CAP = 30000` budget** under it, 2 767 of unmeasured headroom below a ceiling that is itself
 *   lifted. It never shaped content: nothing culled to fit it. (What DOES shape rows is `linkedHeight` — short
 *   species ride binary streams at zero permanent rows — and lod-trees' per-area `AREA_ROW_CAP` migration.)
 * - **`--allow-text-row-overflow`**, which had nothing left to permit.
 * - **int16's 32 767 as printed scale** (field-bisected to exactly 2^15: 31 300 rows clean, 33 210 corrupt) —
 *   lifted by our asi, so printing it measured our build against a machine it never runs on. It lives in
 *   `docs/gta-sa-original/reference-install.md` and `docs/open-issues/fixed/ghost-barriers.md`.
 *   **`IplEntityIndexArrays` was dropped alongside it on the same reasoning and that was WRONG** — it is real,
 *   and it is back as a gate. The lesson is not "keep every ceiling": it is that "lifted" needs the artifact
 *   that enforces the limit to say so, and for this one nothing ever had.
 *
 * **This is not "guards are bad".** {@link checkImgIdBudgets} beside it still THROWS, and correctly: FLA's
 * pools are what the target is actually configured with — real numbers, not `unlimited` — and exhausting one
 * corrupts the heap during data load. It proved that on the first `sa` build after the density fix, which is
 * the difference between the two: a ceiling the target HAS is a gate, a ceiling it lifted is a museum piece.
 * A gate is answered by raising the number in the install's ini, never by shaping the build down to it.
 *
 * **The census names its own scope**, because both halves of it used to read a missing file as zero rows: an
 * IPL listed in `gta.dat` but absent on disk silently subtracted its rows, and an absent `gta.dat` skipped the
 * whole thing without a line. The error only ever ran DOWNWARD, so the count could only ever be falsely quiet —
 * and it is the number that prices the `CBuilding` pool (013's deferred task), so a lower bound sold as a total
 * is a wrong answer to a question we have not asked yet.
 *
 * Runs on the BUILT `sa/` tree, like {@link checkImgIdBudgets} — never on the shared build, which undercounts
 * it (the sa LOD stage appends hole-fill instances to the text IPLs after the split).
 */
export function reportTextIplCensus(gameDir: string): { instBearingIpls: number; largestIpl: number; rows: number } {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    console.warn(`  ! sa text-IPL census SKIPPED — no data/gta.dat under ${gameDir}; this build's row cost is unknown`);

    return { instBearingIpls: 0, largestIpl: 0, rows: 0 };
  }
  const listed: string[] = [];
  const missing: string[] = [];
  const used: string[] = [];
  let totalRows = 0;
  let largestIpl = 0;
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toLowerCase().endsWith('.zon')) {
      continue;
    }
    listed.push(match[1]);
    const file = join(gameDir, match[1].replace(/\\/g, '/'));
    if (!existsSync(file)) {
      missing.push(match[1]);
      continue;
    }
    const rows = parseIpl(readFileSync(file, 'utf8')).length;
    if (rows > 0) {
      used.push(match[1]);
      totalRows += rows;
      largestIpl = Math.max(largestIpl, rows);
    }
  }
  log(
    `sa map cost: ${totalRows} permanent text-IPL rows, ${used.length} inst-bearing IPLs, ` +
      `read ${listed.length - missing.length}/${listed.length} listed`,
  );
  if (missing.length > 0) {
    const named = missing.slice(0, 3).join(', ');
    console.warn(
      `  ! ${missing.length} of ${listed.length} IPLs listed in gta.dat are MISSING on disk (${named}` +
        `${missing.length > 3 ? ', …' : ''}) — ${totalRows} is a LOWER BOUND, not this build's row cost`,
    );
  }

  return { instBearingIpls: used.length, largestIpl, rows: totalRows };
}

/**
 * The SECOND asi the `sa` target ships (asi/perfect-cutscene plan 001 step 7) — and it is shipped only when
 * the cutscene stage RAN, because that is when it is required and when its effect is one we have measured.
 *
 * **The fleet and the plugin are COUPLED.** A converted cutscene car carries real translucent atomics where
 * vanilla ships almost none, and a `CCutsceneObject` is rendered inline in world-sector scan order, so
 * without the deferral a pane z-writes over whichever actor the scan visited later — the roulette the whole
 * plugin exists to end. The 35-scene sweep was taken on fleet + plugin together; either half alone is a
 * configuration nobody has measured.
 *
 * **Which is also why it does not ship on a build WITHOUT the fleet**: the deferred path renders at
 * `RenderEntity`'s alpha-test ref (100, or 0 in an interior) instead of the outdoor pass's 140, so on vanilla
 * cutscene models it could start drawing glass the main pass had always discarded. Shipping it there would be
 * an unmeasured look change bought for nothing.
 */
export function shipPerfectCutsceneAsi(saDir: string, asiPath: string): null | { sha256: string } {
  return shipAsi(
    saDir,
    asiPath,
    'perfect-cutscene.asi',
    'This build carries a CONVERTED cutscene fleet and the two are coupled; build it with `npm run build:asi` ' +
      'in asi/perfect-cutscene, or install it by hand. Without it a scene actor is erased by whichever car ' +
      'pane the sector scan happened to draw later.',
  );
}

/**
 * The asi this build's map REQUIRES, shipped beside it — plan 006 task 1, and the whole of what that plan
 * still is. The build already emits maps a plain install cannot run (110 055 permanent rows against a stock
 * 32 767), and until now nothing put the fix in the tree: the requirement was stated and then left to be
 * satisfied by hand.
 *
 * **A pre-built artifact, not a build step.** `perfect-map.asi` is cross-compiled macOS→Win32 with MinGW
 * (`npm run build:asi` in `asi/perfect-map`), and a map build has no business requiring a cross-compiler. So
 * this copies what is there and **warns loudly when it is not** — `dist/` is gitignored, so absent is the
 * common case on a fresh checkout and it must never be quiet: a `sa/` tree without it is a map that corrupts
 * exactly as it did before the fix (decision 5, fallback honesty).
 *
 * Returns the pairing for the build manifest: a map built at this density is only correct with THIS asi, and
 * a sha256 is what makes a mismatch detectable rather than a mystery crash (decision 4).
 */
export function shipPerfectMapAsi(saDir: string, asiPath: string): null | { sha256: string } {
  return shipAsi(
    saDir,
    asiPath,
    'perfect-map.asi',
    "This build's map needs it (see the install requirements above); build it with `npm run build:asi` in " +
      'asi/perfect-map, or install it by hand. Without it the game corrupts exactly as it did before the fix.',
  );
}

/**
 * The vehicle-side plugin, shipped when the build HAS added cars — it is what makes their `carmods.dat`
 * legal past the stock 30 `link` pairs, and a tree without it is one the installer would have refused.
 */
export function shipPerfectVehicleAsi(saDir: string, asiPath: string): null | { sha256: string } {
  return shipAsi(
    saDir,
    asiPath,
    'perfect-vehicle.asi',
    "This build's added cars need it past 30 carmods `link` pairs; build it with `npm run build:asi` in " +
      'asi/perfect-vehicle. Without it the 31st pair writes past the array — silent static corruption.',
  );
}

/** The two asi pairings in the shape `build-timings.json` carries — each absent when nothing was shipped, so
 *  a run states which plugins its output is paired with and never invents a hash it does not have. */
function asiPairings(
  map: null | { sha256: string },
  cutscene: null | { sha256: string },
): { perfectCutsceneAsiSha256?: string; perfectMapAsiSha256?: string } {
  return {
    ...(cutscene ? { perfectCutsceneAsiSha256: cutscene.sha256 } : {}),
    ...(map ? { perfectMapAsiSha256: map.sha256 } : {}),
  };
}

/**
 * Copy one pre-built `.asi` into the game ROOT — where the reference install's 23 plugins live
 * (`gta-sa-original/reference-install-config.md`), not `scripts/`, though the loader accepts both — and
 * return its sha256 for the build manifest.
 *
 * `absentAdvice` is the caller's own answer to "so what?": each asi is required for a different reason and a
 * warning that does not say which is a warning nobody acts on.
 */
function shipAsi(saDir: string, asiPath: string, fileName: string, absentAdvice: string): null | { sha256: string } {
  if (!existsSync(asiPath)) {
    console.warn(`  ! ${fileName} NOT SHIPPED — no artifact at ${asiPath}. ${absentAdvice}`);

    return null;
  }
  const bytes = readFileSync(asiPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(saDir, fileName), bytes);
  log(`sa asi: ${fileName} shipped into the game root (sha256 ${sha256.slice(0, 12)}…, ${bytes.length} B)`);

  return { sha256 };
}

/** How many broken links the error names before it stops listing — the rest are counted. */
const LOD_LINK_REPORT_LIMIT = 20;

/**
 * Fail the build when a LOD link no longer points at its own LOD.
 *
 * **The class this catches is silent by construction.** A `lod` cell is a ROW INDEX into the area's `inst`
 * section (its binary streams index the same space), so a stage that drops or inserts a row re-points every
 * link past it at another VALID row: no error, no missing file, and in the field a building that simply has
 * no LOD. That is exactly how `0. Map Fixes Pack`'s stream merges shipped links one row off for a month —
 * `docs/open-issues/ipl-row-removal-breaks-lod-links.md`, found by eye from a car park in Los Santos.
 *
 * Runs on the FINISHED `sa/` tree because every earlier point is a half-answer: the merge, the strip, the
 * trees layer and the LOD generators each rewrite `inst` rows, and the links are only whole once they all
 * have. Stock passes it with zero findings (6 103 links), so any finding is ours.
 */
export function assertLodLinks(gameDir: string): void {
  if (!existsSync(join(gameDir, 'data', 'gta.dat'))) {
    console.warn(`  ! sa lod-link check SKIPPED — no data/gta.dat under ${gameDir}`);

    return;
  }
  const report = checkLodLinks(gameDir);
  const bad = [...report.outOfRange, ...report.broken];
  if (bad.length === 0) {
    log(`lod links: ${report.checked} checked, every one resolves onto its owner`);

    return;
  }
  const listed = bad.slice(0, LOD_LINK_REPORT_LIMIT).map((link) => `  ${formatLodLink(link)}`);
  const rest = bad.length - listed.length;
  throw new Error(
    `${bad.length} of ${report.checked} lod links do not resolve onto their owner ` +
      `(${report.outOfRange.length} point past the end of their section):\n${listed.join('\n')}` +
      `${rest > 0 ? `\n  … and ${rest} more` : ''}\n` +
      'A lod cell is a ROW INDEX — some stage inserted or dropped an inst row without rebasing the links ' +
      "that point past it, in the text IPL or in the area's binary streams. Diagnose with " +
      '`npx tsx scripts/debug/lod-link-check.ts <game-dir>` (stock reports zero) and see ' +
      'docs/open-issues/ipl-row-removal-breaks-lod-links.md.',
  );
}

/** How many late definitions the error names before it stops listing — the rest are counted. */
const DAT_ORDER_REPORT_LIMIT = 12;

/**
 * Fail the build when a placed model is defined further down `gta.dat` than the `inst` row placing it.
 *
 * `CFileLoader::LoadLevel` reads the file top to bottom, so a definition listed later does not exist yet for a
 * row read earlier and the game refuses the row outright — with `modloader.asi` off, which is the only
 * configuration that reports it (modloader supplies the same mod IDEs itself, early, and hides the fault). The
 * `sa` build shipped 137 such rows for months: the installer appended a mod's IDE refs at the end while the IPL
 * slot fold moved that mod's rows into stock hosts chosen by CAPACITY, 55+ lines earlier.
 *
 * Every other check we have asks whether a placed id is defined ANYWHERE — `dangling-models`, `assertLodLinks`,
 * the IPL census — and all of them pass on such a tree. This one compares two POSITIONS. Stock reports zero over
 * its 9 268 rows, so any finding is ours. `docs/open-issues/mod-inst-rows-folded-before-their-ide.md`.
 */
export function assertDefinitionOrder(gameDir: string): void {
  if (!existsSync(join(gameDir, 'data', 'gta.dat'))) {
    console.warn(`  ! sa definition-order check SKIPPED — no data/gta.dat under ${gameDir}`);

    return;
  }
  const report = checkDefinitionOrder(gameDir);
  if (report.late.length === 0) {
    log(`definition order: ${report.checked} inst rows, every model defined before the row placing it`);

    return;
  }
  const rows = report.late.reduce((sum, row) => sum + row.count, 0);
  const listed = report.late.slice(0, DAT_ORDER_REPORT_LIMIT).map((row) => `  ${formatLateDefinition(row)}`);
  const rest = report.late.length - listed.length;
  throw new Error(
    `${rows} inst row(s) of ${report.checked} place a model whose IDE is listed LATER in gta.dat ` +
      `(${report.late.length} ids):\n${listed.join('\n')}${rest > 0 ? `\n  … and ${rest} more` : ''}\n` +
      'The game reads gta.dat top to bottom, so those rows load against an undefined id (visible only with ' +
      'modloader.asi off). Mod IDE refs must be SPLICED before the first IPL line — see mergeGtaDat. ' +
      'Diagnose with `npx tsx scripts/debug/dat-order-check.ts <game-dir>` (stock reports zero) and see ' +
      'docs/open-issues/fixed/mod-inst-rows-folded-before-their-ide.md.',
  );
}

/** SA's `IplEntityIndexArrays` — one slot per text IPL that carries `inst` rows, written past without a bounds
 *  check. **Real on the target**, twice-measured 2026-08-10 (see {@link checkInstBearingIplSlots}). */
export const INST_BEARING_IPL_SLOTS = 40;

/**
 * Fail the build when the tree carries more inst-bearing text IPLs than SA has slots for.
 *
 * **This one was a museum piece until the field made it a gate.** The census above used to print the 39/40
 * `IplEntityIndexArrays` figure and then stopped, on the grounds that OLA lifts it — `EntityIpl = unlimited` is
 * set in the reference install and documents itself as *"Maximum number of IPL files that creates entities"*.
 * The lift does not work. The `sa` build at the shipped density ships **75** inst-bearing IPLs and the game dies
 * loading the **40th** (`plobj10.ipl`), measured twice: with the shipping `perfect-map.asi` and with an
 * `-DPM_FIX_INT16=0` probe of it, so our own asi is not the cause.
 *
 * A ceiling nobody had crossed was not a ceiling anyone had lifted, and the reference install carries only 36 —
 * which is why nothing caught this for a month. The number a plan writes down has to be READ by something:
 * plan 007 budgeted *"stock 30 + 8 = 38 ≤ the 40-slot array"* at 15 283 objects, the density fix took the layer's
 * areas 8 → 46, and no code re-checked it. Pure so it is testable without a game dir — the layer's own share is
 * reported at emit time by `buildLinkedAreas`.
 */
export function checkInstBearingIplSlots(instBearingIpls: number): void {
  if (instBearingIpls <= INST_BEARING_IPL_SLOTS) {
    return;
  }
  throw new Error(
    `${instBearingIpls} inst-bearing text IPLs of ${INST_BEARING_IPL_SLOTS} SA slots ` +
      "(IplEntityIndexArrays) — the game crashes loading the slot past the last, and OLA's EntityIpl " +
      "lift does not work (measured 2026-08-10). Group the layer's permanent rows into FEWER areas: a text " +
      'IPL with no inst rows costs no slot, and rows inside one file are cheap (the field runs 9 627 of them). ' +
      'See tools/map-placement/docs/plans/002-ipl-slot-budget.md.',
  );
}

/**
 * The run's wall clock per stage → `<out>/build-timings.json`, plus a summary table in the log.
 *
 * **Self-describing** (the A/B rule): the file states the target, the procobj knobs and the asi it was
 * produced with, because a duration is only comparable against another run whose configuration is known.
 * Comparing two builds is otherwise a guess about what each one was told to do — and the asi hash is what
 * turns "this map crashes" into "this map is paired with a different asi".
 *
 * **And which run it was.** It carries `startedAt`/`finishedAt` and a `status`, and a run that DIES writes it
 * too, with the step that threw and the stages that had finished. Before that (until 2026-08-22) a failed run
 * left the previous one's file untouched and undated, so `build/<game>/` after a crash showed yesterday's
 * numbers with nothing saying so; the run also clears both this file and its `report-<target>.json` on entry.
 */
export function writeStageTimings(
  outPath: string,
  timings: readonly StageTiming[],
  config: {
    /** sha256 of the `perfect-cutscene.asi` shipped into `sa/` — the fleet↔asi pairing, same reasoning.
     *  Absent when this build converted no fleet, or when no artifact was available. */
    perfectCutsceneAsiSha256?: string;
    /** sha256 of the `perfect-map.asi` shipped into `sa/` — the map↔asi pairing (006 decision 4). Absent when
     *  no artifact was available, which the run also warns about. */
    perfectMapAsiSha256?: string;
    procobjDensity: ProcObjDensityInput;
    procobjMax?: number;
    target: BuildTarget;
  },
  run?: {
    /** Set when a step threw: which one, and what it said. Absent = the run finished. */
    failed?: { error: string; step: string };
    /** ISO time the run began — the pair with `finishedAt` is what dates the file. */
    startedAt?: string;
  },
): void {
  const failed = run?.failed;
  if (timings.length === 0 && !failed) {
    return;
  }
  const total = timings.reduce((sum, stage) => sum + stage.seconds, 0);
  log(failed ? `build time (RUN FAILED in '${failed.step}' — the stages below are what finished)` : 'build time');
  for (const { name, seconds } of timings) {
    const share = total > 0 ? ((100 * seconds) / total).toFixed(0) : '0';
    console.log(`  ${name.padEnd(10)} ${formatMinutes(seconds).padStart(8)}  ${share.padStart(3)} %`);
  }
  console.log(`  ${'TOTAL'.padEnd(10)} ${formatMinutes(total).padStart(8)}`);
  writeFileSync(
    join(outPath, 'build-timings.json'),
    JSON.stringify(
      {
        config,
        finishedAt: new Date().toISOString(),
        ...(failed ? { failed } : {}),
        ...(run?.startedAt ? { startedAt: run.startedAt } : {}),
        stages: timings,
        status: failed ? 'failed' : 'ok',
        total,
      },
      null,
      2,
    ),
  );
}

/**
 * The run's work dir (`.work-<target>`, plus the legacy shared `.work`) is wiped before any stage reads
 * `--game`/`--in`, so a source pointing INTO it (the obvious fast path for re-running one stage:
 * `--game <out>/.work-sa/5-trees`) is deleted before it is read. Silent otherwise — the run dies on a missing
 * `gta3.img` seconds after the intermediates are already gone, naming the symptom and never the cause. It
 * cost a full rebuild on 2026-08-09. The OTHER target's work dir is not touched, so a source there is safe.
 */
/**
 * Refuse a run that would build BOTH targets out of a LAYERED mods folder (mod-installer plan 011).
 *
 * The `mods` stage lives in the chain both targets share, and a layered folder makes its result depend on
 * the target — so one run cannot produce both installs, and `resolveBuildTarget` would silently pick `sa`
 * for both. Config-time, like the `--target opensa` refusal beside it: the alternative is an `opensa/`
 * build carrying the real game's mod layer, which nothing downstream can detect.
 *
 * A run that stops inside the COMMON chain is fine and is not refused — it builds neither target, and the
 * resolved target (logged at the top of the run) is what its intermediate carries.
 */
/**
 * The added cars, into the FINISHED `sa` tree, in place — the placement `procobj` taught: this content
 * belongs to ONE target, so it must not reach the common build both targets are made from (an `opensa` pak
 * would carry 115 cars nothing can spawn, and the whole machinery — ModelVariations, FLA's audio loader,
 * Parked Maker, CLEO's FXT loader — is the real game's).
 *
 * Runs after the plugin is shipped and BEFORE this branch's budget guards, so the ids, TXDs and archive
 * members it adds are counted by the same `checkImgIdBudgets` that prices everything else, and so its own
 * `carmods.dat` ceiling check sees `perfect-vehicle.asi` sitting in the tree.
 */
function addVehiclesIntoSa(saDir: string, inPath: string, hasCars: boolean): void {
  if (!hasCars) {
    return;
  }
  log('add-vehicles → sa/');
  const report = addVehicles({ gamePath: saDir, inPath });
  report.warnings.forEach((warning) => console.warn(`add-vehicles: ${warning}`));
  const cars = report.installed.filter(({ kind }) => kind === 'car').length;
  log(`add-vehicles: ${cars} car(s), ${report.installed.length - cars} tuning part(s) added to sa/`);
}

/** `1234.5` → `20m 34s` — the unit a build is actually discussed in. */
function formatMinutes(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** The first `lod-always.json` found among `dirs` → lowercased lod-TARGET models that are the real content
 *  behind a stub HD (plan 087, gostown `LODEnsemble*` forests): kept by the strip, welded into BOTH levels. */
function loadLodAlways(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-always.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-always — ${names.length} always-on lod model(s) from ${file}`);

      return (names as string[]).map((name) => name.toLowerCase());
    }
  }

  return [];
}

/** The first `lod-exclude.json` found among `dirs` → lowercased model names kept out of the LOD bakes. */
function loadLodExclude(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-exclude.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-exclude — ${names.length} model(s) from ${file}`);

      return (names as string[]).map((name) => name.toLowerCase());
    }
  }

  return [];
}

/** The first `lod-holes.json` found among `dirs` → lowercased models that ship NO LOD and hole the far
 *  view (plan 086 phase 5 — moved out of `sa-lod-generator/lod.config.ts`, whose list was SA-specific). */
function loadLodHoles(...dirs: string[]): string[] {
  for (const dir of dirs) {
    const file = join(dir, 'lod-holes.json');
    if (existsSync(file)) {
      const names = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
        throw new Error(`${file} must be a JSON array of model names`);
      }
      log(`lod-holes — ${names.length} hole-fill model(s) from ${file}`);

      return (names as string[]).map((name) => name.toLowerCase());
    }
  }

  return [];
}

/** Parse `<vegetation>/prelight.json` if present (per-model prelight-skip overrides), else undefined. */
function loadPrelight(vegetationDir: string): PrelightInfo | undefined {
  const file = join(vegetationDir, 'prelight.json');

  return existsSync(file) ? parsePrelightInfo(readFileSync(file, 'utf8')) : undefined;
}

/** The first `broken-prelight.json` found among `dirs` → the map-optimizer prelight FORCE list, else null. */
function loadPrelitOnly(...dirs: string[]): null | ReturnType<typeof parseOnlyList> {
  for (const dir of dirs) {
    const file = join(dir, 'broken-prelight.json');
    if (existsSync(file)) {
      log(`optimize — prelight force-list from ${file}`);

      return parseOnlyList(JSON.parse(readFileSync(file, 'utf8')));
    }
  }

  return null;
}

function log(message: string): void {
  console.log(`· ${message}`);
}

/**
 * Drop the `--exclude`d stages from the assembled chain, first REPORTING everything this run will not do —
 * both reasons, separately: a stage whose source folder is empty, and a stage the run excluded on purpose. A
 * silently missing stage reads as a broken build, and the two causes need different fixes.
 */
/**
 * Announce the resolved target, and whether it was asked for or DERIVED — a run has to say which host it
 * priced itself against, because designing down to a ceiling the target does not have is silent (the build
 * succeeds and just carries less). The conservative mismatch is legal, so it is named rather than refused.
 */
function logTarget(target: BuildTarget, explicit: boolean, excluded: ReadonlySet<ExcludableStage>): void {
  log(`target: ${target}${explicit ? '' : ' (derived from --exclude)'}`);
  if (target === 'sa' && excluded.has('sa')) {
    log('  ! an opensa-only build carrying the sa profile — allowed, but it leaves opensa headroom unused');
  }
}

function planChain<T extends { name: ExcludableStage }>(
  chain: readonly T[],
  excluded: ReadonlySet<ExcludableStage>,
  stageSource: Readonly<Record<'cutscene' | 'mods' | 'peds' | 'trees' | 'vehicles', string>>,
): T[] {
  const staged = new Set(chain.map((stage) => stage.name));
  for (const name of ['mods', 'vehicles', 'cutscene', 'peds', 'trees'] as const) {
    // A cutscene stage dropped for a reason OTHER than an empty vehicles/ (vehicles excluded, no
    // cutscene.img in the game) has already said why in `stageCutscene` — do not call it "empty" here.
    if (name === 'cutscene' && staged.has('vehicles')) {
      continue;
    }
    if (!staged.has(name) && !excluded.has(name)) {
      log(`${name} — skipped (${stageSource[name]}/ empty)`);
    }
  }
  for (const name of EXCLUDABLE_STAGES) {
    if (excluded.has(name)) {
      log(`${name} — excluded (--exclude)`);
    }
  }

  return chain.filter((stage) => !excluded.has(stage.name));
}

function refuseLayeredBothTargets(
  modsPath: string,
  what: 'mods' | 'peds' | 'vehicles',
  until: StageName | undefined,
  excluded: ReadonlySet<ExcludableStage>,
): void {
  const bothTargets = runsStage('sa', until, excluded) && runsStage('opensa', until, excluded);
  if (!bothTargets || !isLayeredTree(modsPath)) {
    return;
  }
  throw new Error(
    `${modsPath} is a LAYERED ${what} folder (common/sa/opensa), so its content differs per target — but this ` +
      'run builds both `sa` and `opensa` out of one shared chain. Build them one at a time: ' +
      '--exclude opensa, then --exclude sa.',
  );
}

function refuseSourceInsideWork(work: string, gamePath: string, inPath: string): void {
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ] as const) {
    // Segment-aware: `.work-opensa` must not read as inside `.work` — only that dir itself or its children.
    if (resolve(path) === resolve(work) || resolve(path).startsWith(`${resolve(work)}/`)) {
      throw new Error(
        `${flag} ${path} is inside ${work}, which this run wipes before it reads anything. Copy the ` +
          'intermediate out of `.work` first, or point --out somewhere else.',
      );
    }
  }
}
