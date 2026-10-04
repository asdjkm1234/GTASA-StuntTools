import type * as MapOptimizerRun from '@opensa/map-optimizer/run';

import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertDefinitionOrder,
  assertGtaDatFiles,
  assertLodLinks,
  assertOneOwnerPerEntry,
  buildPerfectMap,
  checkImgIdBudgets,
  checkInstBearingIplSlots,
  EXCLUDABLE_STAGES,
  type ExcludableStage,
  flaIdPools,
  INST_BEARING_IPL_SLOTS,
  installRequirements,
  OPENSA_BUDGET_NOTICE,
  parseExcludedStages,
  reportTextIplCensus,
  resolveBuildTarget,
  runsStage,
  shipPerfectCutsceneAsi,
  shipPerfectMapAsi,
  type StageTiming,
  writeStageTimings,
} from './pipeline';

/** The three map builders the split calls — mocked so the target-split test costs no map build. Each one
 *  creates its output dir, which is all the pipeline needs from them between the call and the next stage. */
const procobjLods = vi.hoisted(() =>
  vi.fn<(step: { config: { density: unknown }; gamePath: string; outPath: string; target: string }) => void>((step) => {
    mkdirSync(step.outPath, { recursive: true });
  }),
);
const saLods = vi.hoisted(() =>
  vi.fn<(step: { gameDir: string; outDir: string }) => void>((step) => {
    mkdirSync(step.outDir, { recursive: true });
  }),
);
const opensaLods = vi.hoisted(() =>
  vi.fn<(step: { gameDir: string; outDir: string }) => void>((step) => {
    mkdirSync(step.outDir, { recursive: true });
  }),
);
vi.mock('@opensa/sa-procobj-placement/build', () => ({ buildProcobjLods: procobjLods }));
vi.mock('@opensa/sa-lod-generator/build', () => ({ buildSaLods: saLods }));
vi.mock('@opensa/opensa-lod-generator/build', () => ({
  buildOpensaLods: opensaLods,
  // The bake STATES its screen-error promise and the pack carries it (201/1-05); the resume path reads it
  // from the config instead, which is this export.
  opensaLodPromise: (): { hdDrawDistance: number; screenPixels: number } => ({
    hdDrawDistance: 300,
    screenPixels: 2,
  }),
}));

/** The two vehicle-family installers, mocked so the cutscene-stage tests cost no real conversion. The
 *  cutscene fake mirrors the real summary shape: per-slot ERRORS fail the stage, the rest is a fragment. */
const vehicleInstall = vi.hoisted(() =>
  vi.fn<(options: { gamePath: string; inPath: string; outPath: string }) => void>((options) => {
    mkdirSync(options.outPath, { recursive: true });
  }),
);
const cutsceneInstall = vi.hoisted(() =>
  vi.fn<
    (options: { gamePath: string; inPath: string; outPath: string }) => {
      converted: string[];
      errors: { csName: string; message: string }[];
      imgBytesAfter: number;
      imgBytesBefore: number;
      painted: never[];
      plates: { csName: string; text: string }[];
      skipped: { csName: string; reason: string }[];
      txdBytes: number;
      warnings: never[];
    }
  >((options) => {
    mkdirSync(options.outPath, { recursive: true });

    return {
      converted: ['csbobcat92'],
      errors: [],
      imgBytesAfter: 2048,
      imgBytesBefore: 1024,
      painted: [],
      plates: [{ csName: 'csbobcat92', text: 'BX41 KHT' }],
      skipped: [{ csName: 'cscopcarsf', reason: 'no mod' }],
      txdBytes: 40,
      warnings: [],
    };
  }),
);
vi.mock('@opensa/vehicle-installer/install', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  install: vehicleInstall,
}));
vi.mock('@opensa/vehicle-cutscene/install', () => ({ installCutscene: cutsceneInstall }));

/** The added-cars installer, mocked: the stage's contract at this level is that it runs, and for which target. */
const addedInstall = vi.hoisted(() =>
  vi.fn<
    (options: { gamePath: string; inPath: string }) => { installed: unknown[]; skipped: number; warnings: string[] }
  >(() => ({ installed: [], skipped: 0, warnings: [] })),
);
vi.mock('@opensa/add-vehicles/install', () => ({ addVehicles: addedInstall }));

/** The mod installer, mocked so the split-order test costs no real merge. */
const modInstall = vi.hoisted(() =>
  vi.fn<(options: { gamePath: string; inPath: string; outPath: string; target?: 'opensa' | 'sa' }) => void>(
    (options) => {
      mkdirSync(options.outPath, { recursive: true });
    },
  ),
);
vi.mock('@opensa/mod-installer/install', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  install: modInstall,
}));

/** The archive split, mocked: the stage's contract here is WHEN it runs and on what, not how it divides. */
const splitArchives = vi.hoisted(() =>
  vi.fn<(options: { buckets?: readonly string[]; gamePath: string; outPath: string }) => void>((options) => {
    mkdirSync(options.outPath, { recursive: true });
  }),
);
vi.mock('@opensa/img-splitter/split', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  split: splitArchives,
}));

/** The optimizer, mocked ONLY where a test opts in — a real run needs a real game dir. Its report is what
 *  the optimize stage turns into a report fragment, so the fake carries one recognizable failure. */
const optimizer = vi.hoisted(() =>
  vi.fn<
    (options: { gameDir: string; outDir: string }) => Promise<{
      assets: never[];
      failures: { error: string; name: string }[];
      game: string;
      outDir: string;
    }>
  >((options) => {
    mkdirSync(options.outDir, { recursive: true });

    return Promise.resolve({
      assets: [],
      failures: [{ error: 'boom', name: 'broken.dff' }],
      game: 'fake',
      outDir: options.outDir,
    });
  }),
);
vi.mock('@opensa/map-optimizer/run', async (importOriginal) => ({
  ...(await importOriginal<typeof MapOptimizerRun>()),
  runOptimizer: optimizer,
}));

/** A game dir whose gta.dat registers `n` text IPLs with one inst row each. */
function writeGame(dir: string, n: number): void {
  mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < n; i += 1) {
    lines.push(`IPL DATA\\MAPS\\a${i}.IPL`);
    writeFileSync(join(dir, 'data', 'maps', `a${i}.IPL`), 'inst\n1, thing, 0, 0,0,0, 0,0,0,1, -1\nend\n');
  }
  lines.push('IPL DATA\\MAPS\\empty.IPL'); // no inst rows — takes no slot
  writeFileSync(join(dir, 'data', 'maps', 'empty.IPL'), 'inst\nend\n');
  writeFileSync(join(dir, 'data', 'gta.dat'), lines.join('\n') + '\n');
}

describe('EXCLUDABLE_STAGES', () => {
  describe('negative cases', () => {
    it('does not offer the `lod` alias, which names no stage to skip', () => {
      expect(EXCLUDABLE_STAGES).not.toContain('lod');
    });
  });

  describe('positive cases', () => {
    it('offers both targets and every common-chain stage', () => {
      expect(EXCLUDABLE_STAGES).toEqual([
        // split runs FIRST so every entry name lands in exactly one archive before anything installs into it
        // (docs/architecture/img-archive-layout.md).
        'split',
        'mods',
        'vehicles',
        // cutscene is the vehicles stage's shadow (vehicle-cutscene plan 002 step 11): it reads the
        // INSTALLED game, so it sits right after `vehicles` and shares its source folder.
        'cutscene',
        'peds',
        'optimize',
        'trees',
        'sa',
        // procobj sits AFTER sa since plan 014: it is baked inside that branch, so its place in the pipeline
        // order — which is what `--until` reads — is after the LOD build it follows.
        'procobj',
        'opensa',
        'pack',
      ]);
    });
  });
});

describe('parseExcludedStages', () => {
  describe('negative cases', () => {
    it('throws on a stage name that does not exist rather than silently building the wrong target', () => {
      expect(() => parseExcludedStages(['--exclude', 'vehicle'])).toThrow(/got 'vehicle'/);
    });

    it('refuses the `lod` alias, which is an --until value and names nothing to skip', () => {
      expect(() => parseExcludedStages(['--exclude', 'lod'])).toThrow(/--exclude must name one of/);
    });

    it('yields nothing when the flag is absent or empty', () => {
      expect(parseExcludedStages(['--game', 'x'])).toEqual([]);
      expect(parseExcludedStages(['--exclude', ''])).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads a comma-separated list (the build:game:original:sa spelling)', () => {
      expect(parseExcludedStages(['--exclude', 'vehicles,peds,opensa'])).toEqual(['vehicles', 'peds', 'opensa']);
    });

    it('accumulates repeated flags and de-duplicates, ignoring surrounding whitespace', () => {
      expect(parseExcludedStages(['--exclude', 'sa', '--exclude', ' sa , peds '])).toEqual(['sa', 'peds']);
    });
  });
});

describe('resolveBuildTarget', () => {
  const excluding = (...stages: ExcludableStage[]): ReadonlySet<ExcludableStage> => new Set(stages);

  describe('negative cases', () => {
    it('refuses an opensa profile while the sa target is still being built', () => {
      expect(() => resolveBuildTarget('opensa', excluding())).toThrow(/--exclude sa/);
      expect(() => resolveBuildTarget('opensa', excluding('peds', 'vehicles'))).toThrow(/no building pool/);
    });

    it('never derives opensa from a run that builds both targets', () => {
      expect(resolveBuildTarget(undefined, excluding())).not.toBe('opensa');
      expect(resolveBuildTarget(undefined, excluding('pack'))).not.toBe('opensa');
    });
  });

  describe('positive cases', () => {
    it('derives the target from --exclude when none is given (what the build scripts already declare)', () => {
      expect(resolveBuildTarget(undefined, excluding('sa'))).toBe('opensa');
      expect(resolveBuildTarget(undefined, excluding('opensa', 'peds', 'vehicles'))).toBe('sa');
      expect(resolveBuildTarget(undefined, excluding())).toBe('sa');
    });

    it('allows the conservative mismatch — an opensa-only build carrying the sa profile', () => {
      expect(resolveBuildTarget('sa', excluding('sa'))).toBe('sa');
    });

    it('honours an explicit opensa once the sa target is excluded', () => {
      expect(resolveBuildTarget('opensa', excluding('sa'))).toBe('opensa');
    });
  });
});

describe('runsStage', () => {
  describe('negative cases', () => {
    it('does not run opensa when the run stops at sa', () => {
      expect(runsStage('opensa', 'sa')).toBe(false);
    });

    it('does not run either target when the run stops in the common chain', () => {
      expect(runsStage('sa', 'trees')).toBe(false);
      expect(runsStage('opensa', 'trees')).toBe(false);
    });

    it('does not bake procobj when the run stops at sa — the clutter follows the LOD build', () => {
      expect(runsStage('procobj', 'sa')).toBe(false);
      expect(runsStage('procobj', undefined, new Set(['procobj']))).toBe(false);
    });

    it('does not run an EXCLUDED target on an otherwise full run (the :opensa / :sa split)', () => {
      expect(runsStage('sa', undefined, new Set(['sa']))).toBe(false);
      expect(runsStage('opensa', undefined, new Set(['opensa']))).toBe(false);
    });

    it('lets --exclude override the --until ordering rather than the other way round', () => {
      // `--until pack` would otherwise run `sa`, since `sa` precedes `pack` in the pipeline order.
      expect(runsStage('sa', 'pack', new Set(['sa']))).toBe(false);
      expect(runsStage('sa', 'lod', new Set(['sa']))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('runs both targets on a full run', () => {
      expect(runsStage('sa', undefined)).toBe(true);
      expect(runsStage('opensa', undefined)).toBe(true);
    });

    it('runs sa when a later stage is the stop point (the silently-missing-sa bug)', () => {
      expect(runsStage('sa', 'pack')).toBe(true);
      expect(runsStage('sa', 'opensa')).toBe(true);
    });

    it('runs both targets on --until lod', () => {
      expect(runsStage('sa', 'lod')).toBe(true);
      expect(runsStage('opensa', 'lod')).toBe(true);
    });

    it('keeps the target that was NOT excluded (excluding one must not cost the other)', () => {
      expect(runsStage('opensa', undefined, new Set(['sa']))).toBe(true);
      expect(runsStage('sa', undefined, new Set(['opensa', 'peds', 'vehicles']))).toBe(true);
    });
  });
});

describe('buildPerfectMap source/out overlap', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-work-'));
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it("refuses a source inside the run's own .work-<target> instead of wiping it, leaving the intermediate intact", async () => {
      const stage = join(out, '.work-opensa', '5-trees');
      mkdirSync(join(stage, 'models'), { recursive: true });
      writeFileSync(join(stage, 'models', 'gta3.img'), 'intermediate');

      await expect(
        buildPerfectMap({ exclude: ['sa'], gamePath: stage, inPath: '/nonexistent', outPath: out }),
      ).rejects.toThrow(/inside .*\.work-opensa/);
      expect(existsSync(join(stage, 'models', 'gta3.img'))).toBe(true);
    });

    it('refuses a source inside the legacy shared .work, which the run still clears', async () => {
      const stage = join(out, '.work', '5-trees');
      mkdirSync(join(stage, 'models'), { recursive: true });
      writeFileSync(join(stage, 'models', 'gta3.img'), 'intermediate');

      await expect(
        buildPerfectMap({ exclude: ['sa'], gamePath: stage, inPath: '/nonexistent', outPath: out }),
      ).rejects.toThrow(/inside .*\.work/);
      expect(existsSync(join(stage, 'models', 'gta3.img'))).toBe(true);
    });

    it('refuses a mods root inside a wiped work dir for the same reason', async () => {
      const mods = join(out, '.work-opensa', 'mods-src');
      mkdirSync(mods, { recursive: true });

      await expect(
        buildPerfectMap({ exclude: ['sa'], gamePath: '/nonexistent', inPath: mods, outPath: out }),
      ).rejects.toThrow(/--in .*is inside/);
    });
  });

  describe('positive cases', () => {
    it("does NOT refuse a source inside the OTHER target's work dir — that dir is not touched", async () => {
      // `.work-sa` starts with `.work`, so a prefix-string check would refuse it; only the run's own dir
      // (here `.work-opensa`) and the legacy `.work` are wiped, so a kept sa intermediate is a valid source.
      const stage = join(out, '.work-sa', '5-trees');
      mkdirSync(join(stage, 'data', 'maps'), { recursive: true });

      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: stage,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(existsSync(stage)).toBe(true);
    });
  });
});

/**
 * The invariant that makes `sa/` and `opensa/` the SAME WORLD: the procobj scatter runs ONCE, in the common
 * chain, and both targets are handed that one stage build. Measured 2026-08-10 across two separate runs
 * (opensa 08-09 13:53, sa 08-10) — all 46 `plobj*.ipl` and all 331 `plobj*_stream*.ipl` byte-identical,
 * 91 092 objects each side. Nothing tested it, and it can only break silently: procobj positions are
 * DERIVED (seeded scatter over collision geometry), so two targets fed from different dirs would each hold a
 * plausible-looking world, and every cross-target verdict — above all 013's "does the real game cope at the
 * shipped density" — would be comparing two different maps while reading as one.
 */
describe('buildPerfectMap target split', () => {
  let out: string;
  let game: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-split-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-game-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    procobjLods.mockClear();
    saLods.mockClear();
    opensaLods.mockClear();
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
  });

  describe('positive cases', () => {
    it('bakes procobj into the sa tree ALONE, and never into what opensa is built from', async () => {
      // Plan 014 retired the old invariant here ("one scatter handed to both targets"): the clutter is an SA
      // layer now. OpenSA scatters the same species at runtime, so a bake in the common build would only cost
      // it a stripped procobj.dat and 91 092 vertex-duplicated instances in its pak.
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      expect(procobjLods).toHaveBeenCalledTimes(1); // one scatter — a second is a second lottery, another world
      const bake = procobjLods.mock.calls[0][0];
      expect(saLods).toHaveBeenCalledTimes(1);
      expect(opensaLods).toHaveBeenCalledTimes(1);

      // Baked IN PLACE into the finished sa tree, after its LOD build.
      const saDir = saLods.mock.calls[0][0].outDir;
      expect(bake.gamePath).toBe(saDir);
      expect(bake.outPath).toBe(saDir);
      expect(bake.target).toBe('sa');

      // Both targets are still built from the same common build — the split point is unchanged.
      expect(opensaLods.mock.calls[0][0].gameDir).toBe(saLods.mock.calls[0][0].gameDir);
      expect(opensaLods.mock.calls[0][0].gameDir).not.toBe(saDir);
    });

    it('keeps the density a property of the build, not of the target it is being built for', async () => {
      // Scope call 2026-08-09: `sa` ships the SAME density as `opensa`. The scatter takes the run's density
      // and its own target only for REPORTING, so a density that varied by target could not reach it here.
      await buildPerfectMap({
        config: { procobjDensity: 2 },
        exclude: ['optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(procobjLods.mock.calls[0][0].config.density).toBe(2);
    });
  });
});

/**
 * The split stage (img-splitter plan 001 step 4). Its whole contract at this level is ORDER: it runs before
 * anything installs, because that is what puts every entry name in exactly one archive.
 */
describe('buildPerfectMap split stage', () => {
  let out: string;
  let game: string;
  let mods: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-split-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-split-game-'));
    mods = mkdtempSync(join(tmpdir(), 'pmb-split-mods-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    mkdirSync(join(mods, 'mods', 'a mod'), { recursive: true });
    writeFileSync(join(mods, 'mods', 'a mod', 'x.txd'), 'x');
    splitArchives.mockClear();
    modInstall.mockClear();
  });

  afterEach(() => {
    for (const dir of [out, game, mods]) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  describe('negative cases', () => {
    it('does not run under --exclude split, and the mods stage still does', async () => {
      await buildPerfectMap({ exclude: ['split', 'optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      expect(splitArchives).not.toHaveBeenCalled();
      expect(modInstall).toHaveBeenCalledTimes(1);
    });
  });

  describe('positive cases', () => {
    it('runs FIRST, on the untouched game, and hands its output to the mods stage', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      expect(splitArchives).toHaveBeenCalledTimes(1);
      // The split reads --game itself; nothing has installed into it yet.
      expect(splitArchives.mock.calls[0][0].gamePath).toBe(game);
      expect(modInstall.mock.calls[0][0].gamePath).toBe(splitArchives.mock.calls[0][0].outPath);
    });

    it('splits ONLY the buckets a stock archive table can register', async () => {
      // 8 slots, 6 already spent: vehicles plus its spill sibling is exactly what fits.
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      expect(splitArchives.mock.calls[0][0].buckets).toEqual(['vehicles']);
    });
  });
});

/**
 * The mods stage's TARGET (mod-installer plan 011). A layered mods folder (`common/`+`sa/`+`opensa/`) makes
 * this stage's result depend on the target, and the stage sits in the chain both targets share — so the run
 * either has exactly one target, or it is refused before anything is built.
 */
describe('buildPerfectMap mods target', () => {
  let out: string;
  let game: string;
  let mods: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-layers-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-layers-game-'));
    mods = mkdtempSync(join(tmpdir(), 'pmb-layers-mods-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    modInstall.mockClear();
  });

  afterEach(() => {
    for (const dir of [out, game, mods]) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  function layered(): void {
    mkdirSync(join(mods, 'mods', 'common', '0. everyone'), { recursive: true });
    mkdirSync(join(mods, 'mods', 'sa', '0. real game'), { recursive: true });
  }

  function flat(): void {
    mkdirSync(join(mods, 'mods', 'a mod'), { recursive: true });
  }

  describe('negative cases', () => {
    it('refuses a layered mods folder in a run that builds BOTH targets, before any stage runs', async () => {
      layered();

      await expect(
        buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out }),
      ).rejects.toThrow(/LAYERED mods folder/);
      expect(modInstall).not.toHaveBeenCalled();
    });
  });

  describe('positive cases', () => {
    it('builds a layered folder one target at a time', async () => {
      layered();

      await buildPerfectMap({ exclude: ['opensa', 'optimize'], gamePath: game, inPath: mods, outPath: out });
      expect(modInstall.mock.calls[0][0].target).toBe('sa');

      modInstall.mockClear();
      await buildPerfectMap({ exclude: ['sa', 'optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });
      expect(modInstall.mock.calls[0][0].target).toBe('opensa');
    });

    it('leaves a FLAT folder alone in a both-target run, and still tells it the resolved target', async () => {
      flat();

      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      expect(modInstall).toHaveBeenCalledTimes(1);
      expect(modInstall.mock.calls[0][0].target).toBe('sa');
    });
  });
});

/**
 * The cutscene stage (vehicle-cutscene plan 002 step 11): the vehicles stage's shadow — same source
 * folder, same populated-check, runs right after it on the INSTALLED game. Per-slot errors FAIL the
 * build; a clean run contributes a fragment to every target report.
 */
describe('buildPerfectMap cutscene stage', () => {
  let out: string;
  let game: string;
  let mods: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-cutscene-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-cutscene-game-'));
    mods = mkdtempSync(join(tmpdir(), 'pmb-cutscene-mods-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    // The stage converts the fleet's twins INTO the game's cutscene archive — a game without one has no stage.
    mkdirSync(join(game, 'models'), { recursive: true });
    writeFileSync(join(game, 'models', 'cutscene.img'), 'x');
    mkdirSync(join(mods, 'vehicles', 'bobcat - a truck - author'), { recursive: true });
    writeFileSync(join(mods, 'vehicles', 'bobcat - a truck - author', 'bobcat.dff'), 'x');
    vehicleInstall.mockClear();
    cutsceneInstall.mockClear();
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
    rmSync(mods, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('FAILS the build when a slot errors — installed parents make a closure miss a broken build', async () => {
      cutsceneInstall.mockReturnValueOnce({
        converted: [],
        errors: [{ csName: 'cstaxi92', message: 'unresolved textures (txdp parent taxi.txd): tx_body_taxi' }],
        imgBytesAfter: 0,
        imgBytesBefore: 0,
        painted: [],
        plates: [],
        skipped: [],
        txdBytes: 0,
        warnings: [],
      });

      await expect(
        buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out }),
      ).rejects.toThrow(/cutscene conversion failed for 1 slot\(s\)[\s\S]*cstaxi92/);
    });

    it('does not run under --exclude cutscene, and the vehicles stage still does', async () => {
      await buildPerfectMap({
        exclude: ['cutscene', 'optimize', 'pack'],
        gamePath: game,
        inPath: mods,
        outPath: out,
      });

      expect(vehicleInstall).toHaveBeenCalledTimes(1);
      expect(cutsceneInstall).not.toHaveBeenCalled();
    });

    it('drops out with --exclude vehicles — no installed parents, every slot would fail closure', async () => {
      // build:game:original:sa excludes vehicles today; the cutscene shadow must follow it out, loudly.
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
      await buildPerfectMap({
        exclude: ['vehicles', 'optimize', 'pack'],
        gamePath: game,
        inPath: mods,
        outPath: out,
      });
      spy.mockRestore();

      expect(vehicleInstall).not.toHaveBeenCalled();
      expect(cutsceneInstall).not.toHaveBeenCalled();
      expect(logs.join('\n')).toMatch(/cutscene — skipped \(vehicles stage excluded/);
    });

    it('skips, loudly, when the game ships no models/cutscene.img — a total conversion has no cutscene fleet', async () => {
      // gostown: the first build after the stage was added died on the missing archive AFTER the vehicles stage.
      rmSync(join(game, 'models', 'cutscene.img'));
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });
      spy.mockRestore();

      expect(vehicleInstall).toHaveBeenCalledTimes(1);
      expect(cutsceneInstall).not.toHaveBeenCalled();
      expect(logs.join('\n')).toMatch(/cutscene — skipped \(the game ships no models\/cutscene\.img/);
    });

    it('does not even ADDRESS perfect-cutscene.asi when no fleet was converted', async () => {
      // The gate short-circuits before the artifact is looked for, so a fleetless build neither ships the
      // plugin nor warns about it: without our translucent atomics there is nothing for it to reorder, and
      // its deferred pass renders at a LOWER alpha-test ref than the inline one it replaces.
      const said: string[] = [];
      const record = (m: unknown): void => void said.push(String(m));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record);
      await buildPerfectMap({ exclude: ['cutscene', 'optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });
      logSpy.mockRestore();
      warnSpy.mockRestore();

      expect(said.join('\n')).not.toMatch(/perfect-cutscene\.asi/);
      expect(existsSync(join(out, 'sa', 'perfect-cutscene.asi'))).toBe(false);
      expect(saReport(out).fragments.sa.perfectCutsceneAsiSha256).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('runs right after vehicles, reading the INSTALLED game that stage produced', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      expect(cutsceneInstall).toHaveBeenCalledTimes(1);
      const installedDir = vehicleInstall.mock.calls[0][0].outPath;
      expect(cutsceneInstall.mock.calls[0][0].gamePath).toBe(installedDir);
      expect(cutsceneInstall.mock.calls[0][0].inPath).toBe(join(mods, 'vehicles'));
    });

    it('contributes its fragment to BOTH target reports', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });

      const fragment = (target: 'opensa' | 'sa'): { converted: string[]; txdBytes: number } =>
        (
          JSON.parse(readFileSync(join(out, `report-${target}.json`), 'utf8')) as {
            fragments: { cutscene: { converted: string[]; txdBytes: number } };
          }
        ).fragments.cutscene;
      expect(fragment('sa').converted).toEqual(['csbobcat92']);
      expect(fragment('sa').txdBytes).toBe(40);
      expect(fragment('opensa').converted).toEqual(fragment('sa').converted);
    });

    it('ADDRESSES perfect-cutscene.asi on a build that converted a fleet — shipped, or said to be missing', async () => {
      // The fleet and the plugin are coupled (asi/perfect-cutscene plan 001 step 7), so a converted build must
      // never be silent about it. Which of the two happens depends on whether `dist/` holds a cross-compiled
      // artifact — gitignored, hence absent on a fresh checkout — so the deterministic claim is that the run
      // NAMED the plugin either way.
      const said: string[] = [];
      const record = (m: unknown): void => void said.push(String(m));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(record);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(record);
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: mods, outPath: out });
      logSpy.mockRestore();
      warnSpy.mockRestore();

      expect(said.join('\n')).toMatch(/perfect-cutscene\.asi (?:shipped into the game root|NOT SHIPPED)/);
      const shipped = existsSync(join(out, 'sa', 'perfect-cutscene.asi'));
      expect(saReport(out).fragments.sa.perfectCutsceneAsiSha256 !== null).toBe(shipped);
    });
  });
});

/** The `sa` target report — the manifest half of the asi pairing. */
function saReport(outPath: string): { fragments: { sa: { perfectCutsceneAsiSha256: null | string } } } {
  return JSON.parse(readFileSync(join(outPath, 'report-sa.json'), 'utf8')) as {
    fragments: { sa: { perfectCutsceneAsiSha256: null | string } };
  };
}

/**
 * Plan 005: one report per target, `.work` split the same way. The regression the whole plan exists for:
 * before it, the second target's build overwrote the first's `report.json`, and under `--keepWork` it also
 * deleted the first's `.work`.
 */
describe('buildPerfectMap target reports (plan 005)', () => {
  let out: string;
  let game: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-report-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-report-game-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    procobjLods.mockClear();
    saLods.mockClear();
    opensaLods.mockClear();
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
  });

  const report = (target: 'opensa' | 'sa'): { fragments: Record<string, unknown>; game: string; target: string } =>
    JSON.parse(readFileSync(join(out, `report-${target}.json`), 'utf8')) as {
      fragments: Record<string, unknown>;
      game: string;
      target: string;
    };

  describe('negative cases', () => {
    it('writes NO unnamed report.json — the name is the target, always', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      expect(existsSync(join(out, 'report.json'))).toBe(false);
    });

    it('writes no target report when the run stops in the common chain — no target finished', async () => {
      await buildPerfectMap({
        exclude: ['optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
        until: 'trees',
      });

      expect(existsSync(join(out, 'report-sa.json'))).toBe(false);
      expect(existsSync(join(out, 'report-opensa.json'))).toBe(false);
    });

    it("building one target leaves the OTHER's report untouched — the overwrite this plan retires", async () => {
      writeFileSync(join(out, 'report-sa.json'), '{"target":"sa","sentinel":true}');

      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(readFileSync(join(out, 'report-sa.json'), 'utf8')).toBe('{"target":"sa","sentinel":true}');
      expect(report('opensa').target).toBe('opensa');
    });
  });

  describe('positive cases', () => {
    it('a full run writes BOTH reports, each naming its own target and the fetch game id', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      expect(report('sa').target).toBe('sa');
      expect(report('opensa').target).toBe('opensa');
      expect(report('sa').game).toBe(basename(game));
    });

    it('the sa report carries the ceilings that used to be console-only, and only the sa report does', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      const sa = report('sa').fragments['sa'] as {
        census: { rows: number };
        imgBudgets: Record<string, number>;
        requirements: unknown[];
      };
      expect(sa.census.rows).toBe(0); // the test game has no gta.dat — the census reports, never invents
      expect(sa.requirements).toEqual([]);
      expect(report('opensa').fragments['sa']).toBeUndefined();
    });

    it('an opensa run without the pack stage still gets a report — just no pack fragment', async () => {
      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(report('opensa').fragments['pack']).toBeUndefined();
    });

    it("the optimize stage's fragment travels through the runner into BOTH target reports", async () => {
      // The runner-collect half of the plan: a chain stage RETURNS its fragment, the runner keys it by stage,
      // and every target report this run writes carries it — with the totals and the isolated failures.
      await buildPerfectMap({ exclude: ['pack'], gamePath: game, inPath: '/nonexistent', outPath: out });

      const fragment = (target: 'opensa' | 'sa'): { failures: unknown[]; summary: { models: number } } =>
        report(target).fragments['optimize'] as { failures: unknown[]; summary: { models: number } };
      expect(fragment('sa').failures).toEqual([{ error: 'boom', name: 'broken.dff' }]);
      expect(fragment('sa').summary.models).toBe(0);
      expect(fragment('opensa').failures).toEqual(fragment('sa').failures);
    });
  });
});

describe('buildPerfectMap work dirs per target (plan 005)', () => {
  let out: string;
  let game: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-workdir-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-workdir-game-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it("still wipes the run's OWN work dir — re-running a target keeps the old contract", async () => {
      mkdirSync(join(out, '.work-opensa', 'junk'), { recursive: true });

      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(existsSync(join(out, '.work-opensa', 'junk'))).toBe(false);
    });

    it('clears the legacy shared .work a pre-005 build left behind — it was wiped every run by contract', async () => {
      mkdirSync(join(out, '.work', 'junk'), { recursive: true });

      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
      });

      expect(existsSync(join(out, '.work'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it("keeps both targets' intermediates side by side under --keepWork — the deletion this plan retires", async () => {
      await buildPerfectMap({
        exclude: ['sa', 'optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        keepWork: true,
        outPath: out,
      });
      expect(existsSync(join(out, '.work-opensa'))).toBe(true);

      await buildPerfectMap({
        exclude: ['opensa', 'vehicles', 'peds', 'optimize'],
        gamePath: game,
        inPath: '/nonexistent',
        keepWork: true,
        outPath: out,
      });

      expect(existsSync(join(out, '.work-sa'))).toBe(true);
      expect(existsSync(join(out, '.work-opensa'))).toBe(true);
    });
  });
});

describe('writeStageTimings', () => {
  let out: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-timings-'));
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
  });

  const knobs = { procobjDensity: 1, procobjMax: 100000, target: 'opensa' } as const;

  describe('negative cases', () => {
    it('writes nothing when no stage ran — an empty file would read as a build that took no time', () => {
      writeStageTimings(out, [], knobs);

      expect(existsSync(join(out, 'build-timings.json'))).toBe(false);
    });

    it("DOES write when a run failed before any stage finished — the file must not stay yesterday's", () => {
      writeStageTimings(out, [], knobs, { failed: { error: 'boom', step: 'mods' } });

      expect(written().status).toBe('failed');
      expect(written().stages).toEqual([]);
    });
  });

  const written = (): {
    config: unknown;
    failed?: { error: string; step: string };
    finishedAt: string;
    stages: StageTiming[];
    startedAt?: string;
    status: string;
    total: number;
  } => JSON.parse(readFileSync(join(out, 'build-timings.json'), 'utf8')) as ReturnType<typeof written>;

  describe('positive cases', () => {
    it('records the knobs the run was configured with, so two durations are comparable', () => {
      writeStageTimings(out, [{ name: 'procobj', seconds: 420 }], knobs);

      expect(written().config).toEqual(knobs);
      expect(written().stages).toEqual([{ name: 'procobj', seconds: 420 }]);
      expect(written().total).toBe(420);
    });

    it('dates the file and marks the run ok, so a later reader knows which run it is', () => {
      writeStageTimings(out, [{ name: 'procobj', seconds: 420 }], knobs, { startedAt: '2026-08-22T07:00:00.000Z' });

      expect(written().status).toBe('ok');
      expect(written().startedAt).toBe('2026-08-22T07:00:00.000Z');
      expect(Date.parse(written().finishedAt)).not.toBeNaN();
      expect(written().failed).toBeUndefined();
    });

    it('records the step that threw, with the stages that had finished', () => {
      writeStageTimings(out, [{ name: 'mods', seconds: 84 }], knobs, {
        failed: { error: '137 inst rows place a model whose IDE is listed LATER', step: 'sa' },
        startedAt: '2026-08-22T07:00:00.000Z',
      });

      expect(written().status).toBe('failed');
      expect(written().failed?.step).toBe('sa');
      expect(written().stages).toEqual([{ name: 'mods', seconds: 84 }]);
      expect(written().total).toBe(84);
    });

    it('totals the stages it was given rather than re-deriving them', () => {
      writeStageTimings(
        out,
        [
          { name: 'mods', seconds: 84 },
          { name: 'opensa', seconds: 2221.5 },
        ],
        knobs,
      );

      expect(written().total).toBe(2305.5);
    });
  });
});

describe('reportTextIplCensus', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-slots-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** A game dir whose whole map is one text IPL of `n` inst rows. */
  const writeRows = (n: number): void => {
    mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
    const rows = Array.from({ length: n }, (_, i) => `${i}, thing, 0, 0,0,0, 0,0,0,1, -1`).join('\n');
    writeFileSync(join(dir, 'data', 'maps', 'big.IPL'), `inst\n${rows}\nend\n`);
    writeFileSync(join(dir, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\big.IPL\n');
  };

  /** The reported lines, `console.log` and `console.warn` kept apart — severity is part of what is asserted. */
  const capture = (): { logs: string[]; warns: string[] } => {
    const logs: string[] = [];
    const warns: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
    reportTextIplCensus(dir);
    logSpy.mockRestore();
    warnSpy.mockRestore();

    return { logs, warns };
  };

  describe('negative cases', () => {
    it("does NOT throw past stock SA's int16 pool ceiling — the target lifts it, so the count is only reported", () => {
      writeRows(32768); // one past 2^15, the row count that used to fail the build

      expect(() => reportTextIplCensus(dir)).not.toThrow();
      expect(capture().logs.join('\n')).toMatch(/sa map cost: 32768 permanent text-IPL rows/);
    });

    it('MEASURES the slot count past 40 and leaves the failing to the gate beside it', () => {
      // The census reports; `checkInstBearingIplSlots` is what fails the build. Kept apart so the gate is a
      // pure function testable without a game dir — and because the census must still print a number when the
      // gate is about to throw, which is how the field crash got its count (75 of 40, plan 002).
      writeGame(dir, 45);

      expect(() => reportTextIplCensus(dir)).not.toThrow();
      expect(reportTextIplCensus(dir).instBearingIpls).toBe(45);
      expect(capture().logs.join('\n')).toMatch(/45 inst-bearing IPLs/);
    });

    it('WARNS that the count is a lower bound when a listed IPL is missing on disk, instead of reading it as zero rows', () => {
      writeGame(dir, 3);
      rmSync(join(dir, 'data', 'maps', 'a1.IPL'));

      const { logs, warns } = capture();

      expect(warns.join('\n')).toMatch(/1 of 4 IPLs listed in gta\.dat are MISSING on disk .*LOWER BOUND/);
      expect(logs.join('\n')).toMatch(/read 3\/4 listed/);
    });

    it('WARNS rather than passing silently when the built tree has no gta.dat to count', () => {
      const { logs, warns } = capture();

      expect(warns.join('\n')).toMatch(/census SKIPPED — no data\/gta\.dat/);
      expect(logs).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('counts every listed IPL, and an inst-less one is listed but takes no slot and no rows', () => {
      writeGame(dir, 2);

      const { logs, warns } = capture();

      expect(logs.join('\n')).toMatch(/sa map cost: 2 permanent text-IPL rows, 2 inst-bearing IPLs, read 3\/3 listed/);
      expect(warns).toHaveLength(0);
    });

    it('reports the cost alone — no stock ceiling is quoted at a build that never runs on one', () => {
      writeGame(dir, 45);

      expect(capture().logs.join('\n')).not.toMatch(/32767|\b39\b|stock/i);
    });
  });
});

describe('OPENSA_BUDGET_NOTICE', () => {
  describe('positive cases', () => {
    it('says both halves: no SA ceiling here, and no measured budget of our own yet', () => {
      expect(OPENSA_BUDGET_NOTICE).toMatch(/do not apply/);
      expect(OPENSA_BUDGET_NOTICE).toMatch(/no streaming budget guard exists yet/);
    });

    it('names the one half that IS measured, so the notice cannot read as wholly unmeasured', () => {
      expect(OPENSA_BUDGET_NOTICE).toMatch(/clutter half is measured and does not bind/);
      expect(OPENSA_BUDGET_NOTICE).toMatch(/no frame-time ceiling to cap it at/);
    });
  });
});

describe('assertOneOwnerPerEntry', () => {
  let tree: string;
  let stock: string;

  const writeTreeImg = (root: string, name: string, entries: string[]): void => {
    mkdirSync(join(root, 'models'), { recursive: true });
    writeFileSync(
      join(root, 'models', name),
      buildVer2Buffer(entries.map((entryName) => ({ data: Uint8Array.of(1), name: entryName }))),
    );
  };

  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'pmb-one-owner-'));
    stock = mkdtempSync(join(tmpdir(), 'pmb-one-owner-stock-'));
  });

  afterEach(() => {
    for (const path of [tree, stock]) {
      rmSync(path, { force: true, recursive: true });
    }
  });

  describe('negative cases', () => {
    it('refuses a name held by two archives, naming both — one of the two files never loads', () => {
      writeTreeImg(stock, 'gta3.img', []);
      writeTreeImg(tree, 'gta3.img', ['slamvan.txd']);
      writeTreeImg(tree, 'vehicles2.img', ['slamvan.txd']);

      expect(() => assertOneOwnerPerEntry(tree, stock)).toThrow(/slamvan\.txd — gta3\.img, vehicles2\.img/);
    });

    it('refuses a duplicate between gta3.img and a sibling the split spilled', () => {
      writeTreeImg(stock, 'gta3.img', ['blade.txd']);
      writeTreeImg(tree, 'gta3.img', ['blade.txd']);
      writeTreeImg(tree, 'vehicles.img', ['blade.txd']);

      expect(() => assertOneOwnerPerEntry(tree, stock)).toThrow(/blade\.txd — gta3\.img, vehicles\.img/);
    });
  });

  describe('positive cases', () => {
    it("does not police an archive the original brought — player.img's `coach` is a clothing texture", () => {
      // The clothes archive holds a 256x256 texture named `coach`, unrelated to the bus of that name in
      // gta3.img. Six such names ship in a clean install and none of them is ours to resolve.
      writeTreeImg(stock, 'gta3.img', ['coach.dff']);
      writeTreeImg(stock, 'player.img', ['coach.dff']);
      writeTreeImg(tree, 'gta3.img', ['coach.dff']);
      writeTreeImg(tree, 'player.img', ['coach.dff']);

      expect(() => assertOneOwnerPerEntry(tree, stock)).not.toThrow();
    });

    it('passes a tree where every name has one owner', () => {
      writeTreeImg(tree, 'gta3.img', ['kb_bar.dff']);
      writeTreeImg(tree, 'vehicles.img', ['slamvan.txd']);

      expect(() => assertOneOwnerPerEntry(tree, stock)).not.toThrow();
    });
  });
});

describe('checkImgIdBudgets', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-idbudget-'));
    mkdirSync(join(dir, 'models'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  function writeImg(name: string, entries: string[]): void {
    writeFileSync(
      join(dir, 'models', name),
      buildVer2Buffer(entries.map((entryName) => ({ data: Uint8Array.of(1), name: entryName }))),
    );
  }

  /** The adjuster ini as the mods stage installs it into the tree root — the file the guard reads its pools from. */
  function writeIni(lines: string[], name = 'fastman92limitAdjuster_GTASA.ini'): void {
    writeFileSync(join(dir, name), ['[ID LIMITS]', 'Apply ID limit patch = 1', ...lines].join('\r\n'));
  }

  describe('negative cases', () => {
    it('throws when the TXD pool is within the runtime margin of the FLA cap (the shopping.dat crash class)', () => {
      // 5,960 TXDs > 6,000 − 50 margin — exhausting an FLA FILE_TYPE_* pool boots into heap corruption.
      writeIni(['FILE_TYPE_TXD = 6000']);
      writeImg(
        'gta3.img',
        Array.from({ length: 5960 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5960 of 6000/);
    });

    it('throws when binary IPL files approach the FILE_TYPE_IPL pool (the field boot-crash case)', () => {
      writeIni(['FILE_TYPE_IPL = 1024']);
      writeImg(
        'gta3.img',
        Array.from({ length: 1019 }, (_, i) => `a${i}_stream0.ipl`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/binary IPL files: 1019 of 1024/);
    });

    it('judges the build against the SHIPPED ini, not against the pool someone raised in the bottle', () => {
      // 2026-08-18: the guard carried 6000 as a constant while the shipped ini said 5000, so a 5,177-archive
      // build reported headroom and the game died at boot. The ini is the number in force.
      writeIni(['FILE_TYPE_TXD = 5000']);
      writeImg(
        'gta3.img',
        Array.from({ length: 5177 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5177 of 5000/);
    });

    it('falls back to FLA defaults when the raise is `#`-disabled — a commented line is not a value', () => {
      writeIni(['#FILE_TYPE_TXD = 6000']);
      writeImg(
        'gta3.img',
        Array.from({ length: 5177 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5177 of 5000/);
    });

    it('falls back to FLA defaults when the ini does not apply the ID limit patch at all', () => {
      writeFileSync(
        join(dir, 'fastman92limitAdjuster_GTASA.ini'),
        ['[ID LIMITS]', '#Apply ID limit patch = 0', 'FILE_TYPE_TXD = 6000'].join('\r\n'),
      );
      writeImg(
        'gta3.img',
        Array.from({ length: 5177 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5177 of 5000/);
    });

    it('falls back to FLA defaults for a tree that carries no adjuster ini', () => {
      writeImg(
        'gta3.img',
        Array.from({ length: 5177 }, (_, i) => `t${i}.txd`),
      );
      expect(() => checkImgIdBudgets(dir)).toThrow(/TXD archives: 5177 of 5000/);
    });
  });

  describe('positive cases', () => {
    it('passes a build comfortably under every pool, counting across all IMG archives', () => {
      writeImg('gta3.img', ['a.txd', 'b.col', 'lae_stream0.ipl', 'x.dff']);
      writeImg('gta_int.img', ['c.txd']);
      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });

    it('reads the pools the tree will run under, naming the ini it read them from', () => {
      writeIni(['FILE_TYPE_TXD = 6000', 'FILE_TYPE_COL = 400', 'FILE_TYPE_IPL = 1024']);

      expect(flaIdPools(dir)).toEqual({
        pools: { '.col': 400, '.ipl': 1024, '.txd': 6000 },
        source: 'fastman92limitAdjuster_GTASA.ini',
      });
    });

    it('passes what the default pool would refuse once the shipped ini carries the raise', () => {
      writeIni(['FILE_TYPE_TXD = 6000']);
      writeImg(
        'gta3.img',
        Array.from({ length: 5177 }, (_, i) => `t${i}.txd`),
      );

      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });

    it('passes the 522 binary IPLs the first sa build at the recovered density produced', () => {
      writeIni(['FILE_TYPE_IPL = 1024']);
      // The build that found this gate (2026-08-10): 331 `plobj*_stream*` tiles + 191 stock ones. 242 over
      // the old 280-slot pool, comfortably under the raised one — the regression test for the raise itself.
      writeImg(
        'gta3.img',
        Array.from({ length: 522 }, (_, i) => `a${i}_stream0.ipl`),
      );
      expect(() => checkImgIdBudgets(dir)).not.toThrow();
    });
  });
});

describe('assertGtaDatFiles', () => {
  /** A tree whose gta.dat lists `town.ide` and, when `withGhost`, a file nobody wrote. */
  function tree(withGhost: boolean): string {
    const game = mkdtempSync(join(tmpdir(), 'pmb-gta-dat-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    writeFileSync(join(game, 'data', 'maps', 'town.ide'), 'objs\nend\n');
    writeFileSync(
      join(game, 'data', 'gta.dat'),
      `IDE DATA\\MAPS\\town.ide\n${withGhost ? 'IDE DATA\\MAPS\\salod-txdp.ide\n' : ''}`,
    );

    return game;
  }

  describe('negative cases', () => {
    it('fails on a registered file the tree does not have — SA opens it without a check', () => {
      // The 2026-08-16 field crash: an install whose gta.dat still registered `salod-txdp.ide` after the
      // txdp parent was retired. The access violation names the path only inside a stack dump.
      expect(() => assertGtaDatFiles(tree(true))).toThrow(/registers 1 file\(s\) the tree does not have/);
      expect(() => assertGtaDatFiles(tree(true))).toThrow(/salod-txdp\.ide/);
    });
  });

  describe('positive cases', () => {
    it('passes a tree that holds everything it registers', () => {
      expect(() => assertGtaDatFiles(tree(false))).not.toThrow();
    });
  });
});

describe('assertLodLinks', () => {
  /** A one-area tree whose single `inst` link points at `lod` — the shape the guard reads off a built tree. */
  function tree(lod: number): string {
    const game = mkdtempSync(join(tmpdir(), 'pmb-lod-links-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    writeFileSync(join(game, 'data', 'gta.dat'), 'IDE DATA\\MAPS\\town.ide\nIPL DATA\\MAPS\\town.ipl\n');
    writeFileSync(join(game, 'data', 'maps', 'town.ide'), 'objs\n100, house, houses, 300, 0\nend\n');
    writeFileSync(
      join(game, 'data', 'maps', 'town.ipl'),
      [
        'inst',
        `100, house, 0, 10, 10, 5, 0, 0, 0, 1, ${lod}`,
        '100, LODhouse, 0, 10, 10, 5, 0, 0, 0, 1, -1',
        '100, LODbarn, 0, 900, 900, 5, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n'),
    );

    return game;
  }

  describe('negative cases', () => {
    it('fails the build when a link resolves onto a row that is not where its owner is', () => {
      expect(() => assertLodLinks(tree(2))).toThrow(/1 of 1 lod links do not resolve onto their owner/);
    });

    it('names the script that diagnoses it, so the error is actionable off the log alone', () => {
      expect(() => assertLodLinks(tree(2))).toThrow(/scripts\/debug\/lod-link-check\.ts/);
    });
  });

  describe('positive cases', () => {
    it('passes a tree whose LOD stands on its owner', () => {
      expect(() => assertLodLinks(tree(1))).not.toThrow();
    });
  });
});

describe('assertDefinitionOrder', () => {
  /** A one-area tree whose IDE is listed BEFORE its IPL (`inOrder`) or after it — the shape the guard reads. */
  function tree(inOrder: boolean): string {
    const game = mkdtempSync(join(tmpdir(), 'pmb-dat-order-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    const ide = 'IDE DATA\\MAPS\\town.ide';
    const ipl = 'IPL DATA\\MAPS\\town.ipl';
    writeFileSync(join(game, 'data', 'gta.dat'), `${(inOrder ? [ide, ipl] : [ipl, ide]).join('\n')}\n`);
    writeFileSync(join(game, 'data', 'maps', 'town.ide'), 'objs\n7394, exteriorlit, houses, 300, 0\nend\n');
    writeFileSync(
      join(game, 'data', 'maps', 'town.ipl'),
      ['inst', '7394, exteriorlit, 0, 10, 10, 5, 0, 0, 0, 1, -1', 'end', ''].join('\n'),
    );

    return game;
  }

  describe('negative cases', () => {
    it('fails the build when a row is placed before the IDE that defines its model', () => {
      expect(() => assertDefinitionOrder(tree(false))).toThrow(/place a model whose IDE is listed LATER/);
    });

    it('names the model, both files and the script that diagnoses it', () => {
      expect(() => assertDefinitionOrder(tree(false))).toThrow(/exteriorlit/);
      expect(() => assertDefinitionOrder(tree(false))).toThrow(/scripts\/debug\/dat-order-check\.ts/);
    });
  });

  describe('positive cases', () => {
    it('passes a tree whose IDE is listed first', () => {
      expect(() => assertDefinitionOrder(tree(true))).not.toThrow();
    });
  });
});

describe('checkInstBearingIplSlots', () => {
  describe('negative cases', () => {
    it('fails the build the field crashed on: 75 inst-bearing IPLs against 40 slots', () => {
      // The `sa` build at the shipped density, 2026-08-10. The game died loading `plobj10.ipl` — slot 40 — with
      // OLA's `EntityIpl = unlimited` set, measured twice (with and without our own asi's int16 patch).
      expect(() => checkInstBearingIplSlots(75)).toThrow(/75 inst-bearing text IPLs of 40 SA slots/);
    });

    it('fails on the first slot past the array, not one later', () => {
      expect(() => checkInstBearingIplSlots(INST_BEARING_IPL_SLOTS + 1)).toThrow(/IplEntityIndexArrays/);
    });
  });

  describe('positive cases', () => {
    it('passes a tree that exactly fills the array', () => {
      expect(() => checkInstBearingIplSlots(INST_BEARING_IPL_SLOTS)).not.toThrow();
    });

    it('passes the budget plan 002 targets: 28 stock + 6 linked areas', () => {
      expect(() => checkInstBearingIplSlots(28 + 6)).not.toThrow();
    });
  });
});

describe('installRequirements', () => {
  /** A build that fits stock: nothing crossed, so nothing is required. */
  const tiny = { largestIpl: 100, rows: 1000 };
  /** The shipped `sa` tree of 2026-08-11, read off the census: 110 055 rows, biggest file 9 110. */
  const shipped = { largestIpl: 9110, rows: 110_055 };
  const pools = { '.col': 300, '.ipl': 200, '.txd': 4999 };

  describe('negative cases', () => {
    it('asks for nothing when the build fits a stock 1.0', () => {
      expect(installRequirements(tiny, { '.col': 10, '.ipl': 10, '.txd': 10 })).toEqual([]);
    });

    it('does not ask for a lift on a ceiling the build merely reaches', () => {
      // Exactly AT the ceiling is not over it — an off-by-one here would demand an asi for a stock-safe build.
      // Rows sit at the BUILDING pool's 13 000, which is the tightest of the two row ceilings and so the one
      // that decides: 32 767 would be stock-safe for int16 and already three times over the pool.
      expect(installRequirements({ largestIpl: 4096, rows: 13_000 }, { '.txd': 5000 })).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('names the asi for the int16 row ceiling, which no adjuster provides', () => {
      const asi = installRequirements(shipped, pools).find((row) => row.ceiling === 32_767);
      expect(asi?.lift).toMatch(/perfect-map\.asi/);
      expect(asi?.spent).toBe(110_055);
    });

    it('names every ceiling the shipped tree crosses, and only those', () => {
      const crossed = installRequirements(shipped, pools).map((row) => row.what);
      // 110 055 rows cross int16; 9 110 crosses the per-IPL buffer; COL 300 > 255. The entity pools are NOT
      // here — a row spends a CBuilding or a CDummy depending on `object.dat`, so pricing rows against
      // `CPool<CBuilding>` was wrong in both directions; `checkEntityPoolBudgets` owns that ceiling now.
      expect(crossed).toEqual(['permanent text-IPL rows, map-wide', 'rows in one text IPL', 'COL archives']);
    });

    it('reports the per-file buffer separately from the map-wide one — they are different ceilings', () => {
      const perFile = installRequirements({ largestIpl: 9110, rows: 1000 }, {});
      expect(perFile).toHaveLength(1);
      expect(perFile[0].lift).toMatch(/EntitiesPerIpl/);
    });
  });
});

describe('shipPerfectMapAsi', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-asi-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('WARNS loudly when there is no artifact, and does not fail the build', () => {
      // `dist/` is gitignored, so absent is the common case on a fresh checkout — and it must never be quiet:
      // the map this build emits corrupts a plain install exactly as it did before the fix.
      const warns: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
      const shipped = shipPerfectMapAsi(dir, join(dir, 'nope', 'perfect-map.asi'));
      spy.mockRestore();

      expect(shipped).toBeNull();
      expect(existsSync(join(dir, 'perfect-map.asi'))).toBe(false);
      expect(warns.join('\n')).toMatch(/NOT SHIPPED/);
      expect(warns.join('\n')).toMatch(/build:asi/); // says how to fix it, not just that it is broken
    });
  });

  describe('positive cases', () => {
    it('copies the artifact into the game ROOT and returns its sha256', () => {
      const source = join(dir, 'perfect-map.asi.src');
      writeFileSync(source, 'MZ-not-really-a-dll');
      const game = join(dir, 'sa');
      mkdirSync(game, { recursive: true });

      const shipped = shipPerfectMapAsi(game, source);

      // Root rather than scripts/: that is where the reference install's 23 plugins sit.
      expect(readFileSync(join(game, 'perfect-map.asi'), 'utf8')).toBe('MZ-not-really-a-dll');
      expect(shipped?.sha256).toBe(createHash('sha256').update('MZ-not-really-a-dll').digest('hex'));
    });

    it('pairs a map with the EXACT asi — two artifacts give two hashes', () => {
      const game = join(dir, 'sa');
      mkdirSync(game, { recursive: true });
      const a = join(dir, 'a.asi');
      const b = join(dir, 'b.asi');
      writeFileSync(a, 'one');
      writeFileSync(b, 'two');

      expect(shipPerfectMapAsi(game, a)?.sha256).not.toBe(shipPerfectMapAsi(game, b)?.sha256);
    });
  });
});

describe('shipPerfectCutsceneAsi', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-cs-asi-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('WARNS with the COUPLING, not with the map warning — the two asis are needed for different reasons', () => {
      const warns: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
      const shipped = shipPerfectCutsceneAsi(dir, join(dir, 'nope', 'perfect-cutscene.asi'));
      spy.mockRestore();

      expect(shipped).toBeNull();
      expect(existsSync(join(dir, 'perfect-cutscene.asi'))).toBe(false);
      expect(warns.join('\n')).toMatch(/perfect-cutscene\.asi NOT SHIPPED/);
      expect(warns.join('\n')).toMatch(/asi\/perfect-cutscene/); // its own build dir, not perfect-map's
      expect(warns.join('\n')).toMatch(/actor is erased/); // what it costs, so the warning is actionable
    });
  });

  describe('positive cases', () => {
    it('copies the artifact into the game ROOT beside the map asi, and returns its sha256', () => {
      const source = join(dir, 'perfect-cutscene.asi.src');
      writeFileSync(source, 'MZ-cutscene');
      const game = join(dir, 'sa');
      mkdirSync(game, { recursive: true });
      writeFileSync(join(dir, 'perfect-map.asi.src'), 'MZ-map');

      const shipped = shipPerfectCutsceneAsi(game, source);
      shipPerfectMapAsi(game, join(dir, 'perfect-map.asi.src'));

      expect(readFileSync(join(game, 'perfect-cutscene.asi'), 'utf8')).toBe('MZ-cutscene');
      expect(readFileSync(join(game, 'perfect-map.asi'), 'utf8')).toBe('MZ-map');
      expect(shipped?.sha256).toBe(createHash('sha256').update('MZ-cutscene').digest('hex'));
    });
  });
});

/**
 * `--resume` (plan 006): a run that dies in a target re-enters at the step that died, with every finished
 * step taken from `resume.json`; a resume over changed inputs is refused. The generators are the mocks
 * above, so "finished" is what the manifest says, not what the mocks did.
 */
describe('buildPerfectMap --resume', () => {
  let out: string;
  let game: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-resume-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-resume-game-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    procobjLods.mockClear();
    saLods.mockClear();
    opensaLods.mockClear();
  });

  afterEach(() => {
    rmSync(out, { force: true, recursive: true });
    rmSync(game, { force: true, recursive: true });
    opensaLods.mockImplementation((step) => {
      mkdirSync(step.outDir, { recursive: true });
    });
  });

  describe('negative cases', () => {
    it('refuses to resume when nothing failed here, and refuses a resume over a changed source', async () => {
      await expect(
        buildPerfectMap({
          exclude: ['optimize', 'pack'],
          gamePath: game,
          inPath: '/nonexistent',
          outPath: out,
          resume: true,
        }),
      ).rejects.toThrow(/nothing to resume/);

      opensaLods.mockImplementationOnce(() => {
        throw new Error('bake died');
      });
      await expect(
        buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out }),
      ).rejects.toThrow(/bake died/);
      // The source moved on — a resumed build over it is a build nobody can reproduce.
      writeFileSync(join(game, 'data', 'maps', 'new.ipl'), 'inst\nend\n');

      await expect(
        buildPerfectMap({
          exclude: ['optimize', 'pack'],
          gamePath: game,
          inPath: '/nonexistent',
          outPath: out,
          resume: true,
        }),
      ).rejects.toThrow(/refused[\s\S]*game: changed since the run/);
    });
  });

  describe('positive cases', () => {
    it('re-enters at the failed opensa step, taking the finished common chain and the sa target from the manifest', async () => {
      opensaLods.mockImplementationOnce(() => {
        throw new Error('bake died');
      });
      await expect(
        buildPerfectMap({ exclude: ['optimize', 'pack'], gamePath: game, inPath: '/nonexistent', outPath: out }),
      ).rejects.toThrow(/bake died/);
      const manifest = JSON.parse(readFileSync(join(out, '.work-sa', 'resume.json'), 'utf8')) as {
        failed?: { step: string };
        stages: { name: string }[];
      };
      expect(manifest.failed?.step).toBe('opensa');
      expect(manifest.stages.map((s) => s.name)).toContain('sa');
      const saCalls = saLods.mock.calls.length;
      const procobjCalls = procobjLods.mock.calls.length;

      const result = await buildPerfectMap({
        exclude: ['optimize', 'pack'],
        gamePath: game,
        inPath: '/nonexistent',
        outPath: out,
        resume: true,
      });

      expect(saLods.mock.calls.length).toBe(saCalls); // the sa target was NOT rebuilt
      expect(procobjLods.mock.calls.length).toBe(procobjCalls);
      expect(opensaLods.mock.calls.length).toBe(2); // once died, once resumed
      expect(result.produced.map((p) => p.name)).toContain('opensa');
      // A green run leaves no resume point behind (the work dir goes with it, as always).
      expect(existsSync(join(out, '.work-sa', 'resume.json'))).toBe(false);
    });

    it('resumes a chain whose consumed stage dirs are gone — only the LAST finished dir is read', async () => {
      // The chain deletes each stage dir as the next consumes it, so a run killed in a target has lost every
      // chain dir but the last. The first real killed build (gostown, mid-pack) was refused over `1-split`.
      const mods = mkdtempSync(join(tmpdir(), 'pmb-resume-mods-'));
      mkdirSync(join(mods, 'vehicles', 'bobcat - a truck - author'), { recursive: true });
      writeFileSync(join(mods, 'vehicles', 'bobcat - a truck - author', 'bobcat.dff'), 'x');
      opensaLods.mockImplementationOnce(() => {
        throw new Error('bake died');
      });
      await expect(
        buildPerfectMap({ exclude: ['cutscene', 'optimize', 'pack'], gamePath: game, inPath: mods, outPath: out }),
      ).rejects.toThrow(/bake died/);
      // split was consumed by vehicles: its dir is gone, vehicles' (the last) is there.
      expect(existsSync(join(out, '.work-sa', '1-split'))).toBe(false);
      expect(existsSync(join(out, '.work-sa', '2-vehicles'))).toBe(true);
      const vehicleCalls = vehicleInstall.mock.calls.length;

      const result = await buildPerfectMap({
        exclude: ['cutscene', 'optimize', 'pack'],
        gamePath: game,
        inPath: mods,
        outPath: out,
        resume: true,
      });

      expect(vehicleInstall.mock.calls.length).toBe(vehicleCalls); // the chain was NOT re-run
      expect(result.produced.map((p) => p.name)).toContain('opensa');
      rmSync(mods, { force: true, recursive: true });
    });
  });
});

/**
 * The added cars (central plan 102). Their contract at this level is WHERE they land: inside the `sa` branch,
 * on the finished tree — never in the common build both targets are made from, which is the placement
 * `procobj` established for content that belongs to one target.
 */
describe('buildPerfectMap added vehicles', () => {
  let out: string;
  let game: string;
  let inPath: string;

  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'pmb-added-out-'));
    game = mkdtempSync(join(tmpdir(), 'pmb-added-game-'));
    inPath = mkdtempSync(join(tmpdir(), 'pmb-added-in-'));
    mkdirSync(join(game, 'data', 'maps'), { recursive: true });
    mkdirSync(join(inPath, 'add-vehicles', 'models', '001veh - vega - x (manana)'), { recursive: true });
    addedInstall.mockClear();
  });

  afterEach(() => {
    for (const dir of [out, game, inPath]) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  describe('negative cases', () => {
    it("does not run for the opensa target — the feature is the real game's plugins", async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack', 'sa'], gamePath: game, inPath, outPath: out });

      expect(addedInstall).not.toHaveBeenCalled();
    });

    it('does not run when the root holds no cars', async () => {
      rmSync(join(inPath, 'add-vehicles'), { recursive: true });
      await buildPerfectMap({ exclude: ['optimize', 'pack', 'opensa'], gamePath: game, inPath, outPath: out });

      expect(addedInstall).not.toHaveBeenCalled();
    });
  });

  describe('positive cases', () => {
    it('runs once for the sa target, over its own source root', async () => {
      await buildPerfectMap({ exclude: ['optimize', 'pack', 'opensa'], gamePath: game, inPath, outPath: out });

      expect(addedInstall).toHaveBeenCalledTimes(1);
      expect(addedInstall.mock.calls[0][0].inPath).toBe(join(inPath, 'add-vehicles'));
    });
  });
});
