# Session 23 (2026-08-17): `@opensa/validation`, and the Cutscene Converter app

**On `main`, 6 commits after `6ea15dc0` (session 22's audit), tree clean, suite 501 files / 4 558 green /
1 pre-existing flake, tsc + eslint + knip clean.** His order, as left by session 22: `packages/validation`
001, then `apps/cutscene-converter` 001/002. Both chains are the standalone-app work — the first thing this
repo has built for people who will never clone it. Nothing here touches the engine, the pak or a build.

The GPU-pass regression (`docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md`) was NOT started and
stays next in his order.

## What changed

| area | change | commit |
| --- | --- | --- |
| `blog/` | the English post gets the closing note about returning to graphics after the living city | `8807eb34` |
| `mods-src/original/mods/sa` | `1.1 SilentPatch` → `2.`, everything after it +1 (68 folders, 1..68). Order taken from `sortMods`, two-phase rename, install result unchanged. Not under git; no doc pins these numbers | — |
| **`packages/validation`** (new) | The SHAPE of "can I proceed, and what do I tell the user?" — the verdict union, generic path/file checks, the SA game-folder and exe gates, the coverage adapter. 45 tests | `92bdc742` |
| `scripts/arch-graph.ts` | a package's layer comes from its `nx.tags`, not its folder (+ `scripts/lib/package-layer.ts`, 10 tests) | `39827971`, `f4f4410c` |
| `tools/vehicle-cutscene` | `./cli` added to the exports map — the app forks the tool's own CLI | `3f853e84` |
| **`apps/cutscene-converter`** (new) | Electron app, plan 002 steps 1–5: window, portable exe, the plugin embedded at build time, the three-step wizard, the failure surface. 17 tests | `36495d8e`, `f4f4410c` |

## What it cost / what it bought

- **`@opensa/validation`**: 45 tests / 171 ms. The whole first-consumer gate against `game-src/original`
  (folder + seven files + a 14 MB SHA1) runs in **9 ms**. The union earns its keep by making `fix` REQUIRED
  on an error and optional on a warning — "an error a user cannot act on" is a compile error now.
- **The app**: portable exe **88 871 868 B (84.8 MB)**, cross-built from macOS with **no wine** — the part
  of plan 002 that was scheduled early because nobody here had done it turned out to be the cheap part.
  Renderer bundle 195 KB. Conversion of the 23-slot fleet ~3.1 s, output 579 MB.
- **The facade does not lie, and it is checked**: `diff -rq` clean and md5-of-md5s equal (`7533b5b9…5c7ad6`)
  between `tsx tools/vehicle-cutscene/src/cli.ts …` and the app's own child run on the same inputs.
- Suite 4 489 → 4 558 (+69: validation 45, app 17, package-layer 7 — `it.each` counts per case).

## The three things worth remembering

1. **`electron-builder` packs the WORKSPACE ROOT's runtime dependencies.** The first artifact carried
   rapier, bitecs, react and meshoptimizer inside its asar — 18 MB this app never loads, because esbuild
   bundles the main process and vite bundles the renderer. `!node_modules/**` in `files`: asar
   **18 112 416 → 199 198 B (−98.9 %)**. Nothing warns about this; the exe just works and is fatter.
2. **npm 11 blocks install scripts by default**, so electron installed without its binary and nothing ran.
   Approved narrowly — `allowScripts: { "electron@43.4.0": true }` in the root `package.json`, the user's
   call over two alternatives (a local `install.js` run that no clone would repeat, or `--allow-scripts-pending`,
   which would also unblock esbuild, nx and fsevents for no reason).
3. **The folder is not the layer.** `packages/validation` reads `node:fs` and imports `@opensa/asi-sdk`;
   `apps/cutscene-converter` imports two `type:tool` packages and a `type:app` may reach apps and engine
   only. Both are `type:tool` — the tag follows what a package IMPORTS. `arch-graph` derived the layer from
   the FOLDER and would have drawn both inside the browser runtime graph; it reads `nx.tags` now. Recorded
   as a rule in `docs/restrictions/architecture.md`, and the case that catches nothing is spelled out there:
   a bare `node:fs` in an engine package lints, typechecks, and fails only when a browser bundle pulls it in.

## Docs and tests: what this session added, and what it deliberately did not

Every change carries its docs in the same commit:

- `packages/validation/README.md` (the boundary, and why the coverage adapter may never learn a slot name),
  plan 001 closed with numbers per step, `docs/architecture/README.md` (the package row + the tag rule),
  `docs/restrictions/architecture.md` (+ its index row).
- `apps/cutscene-converter/README.md`, plan 002 steps 1–5 closed with numbers **and a Deviations section**
  (no `build/` folder, no Tailwind — `apps/web`'s shell is `--sa-*` custom properties, not Tailwind, so 001's
  "same Tailwind tokens" described something that does not exist), `docs/commands.md` (the three commands),
  `docs/architecture/README.md` (the app row).
- No `docs/features/` entry: that folder is per-ENGINE-feature. No `docs/hacks/` entry: nothing here stands
  in for an honest approach. No `docs/edge-cases/`: no new limitation was found. No benchmark file: the two
  numbers this app is designed around (cold start and wall-clock **on Windows**) cannot be measured here,
  and recording macOS stand-ins under `docs/benchmarks/` would be recording the wrong machine.

The audit pass found three gaps and closed them in `f4f4410c` rather than listing them:

- the build's refusal without `perfect-cutscene.asi` was verified only BY HAND (moving the file); `readAsi`
  and `requireAsi` now take the path, and a test pins that the failure names both the path and the command;
- `validateCars`'s census-failure branch had no test — the branch that decides whether an unreadable folder
  reads as "error" or as a reassuring empty coverage warning;
- `scripts/arch-graph.ts` had **no test at all** and I had just changed its layer rule. `layerOf` moved to
  `scripts/lib/package-layer.ts` (importing the script itself would run the generator) with 10 cases,
  including the two real disagreements between folder and tag.

Also dropped in the same commit: the **cancel path** (`ConverterApi.cancelConvert` → IPC → `convert.ts`),
wired end to end and called by nothing. A run is seconds; killing one mid-write would leave a half-written
`cutscene.img`. Dead code that looks like a feature is worse than a missing feature.

**What is still verified by hand rather than by a test, and why:**

- **The renderer.** No unit tests: the repo's rule is that `.tsx` UI is excluded from coverage and covered on
  the Playwright lane, and this app has no e2e lane (`e2e/` drives the browser game). It was verified by
  reading the running app over CDP — three steps rendered, the preload bridge exposing all its functions,
  the about line carrying the real plugin SHA — the same "the DOM is a verdict" method the bench harness
  uses. **If the wizard grows a fourth step or a real state machine, that is the moment it needs a lane.**
- **`convert.ts`'s spawn.** The argv it builds is a pure function with four tests (the two mandatory flags
  each have their own, because that is what a facade can get wrong while looking like it works); the actual
  fork is covered by the byte-identical A/B above, not by a unit test.
- **The portable exe on Windows.** Built, but never run — that is his machine, and it is the one open item
  in plan 002 step 2.

## Left for session 24

1. **Plan 002 steps 6–8 are HIS by definition**: the look (a judgement he owns), the tutorial
   (`docs/tutorial/cutscene-converter/<version>/`, which does not exist yet), the release triple. Plus the
   one Windows run of `apps/cutscene-converter/release/cutscene-converter-0.4.0.exe`, and the two numbers
   that need it.
2. **The GPU-pass regression**, untouched and next: the UNCAPPED headless sweep on the fresh pak first
   (`docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md` carries the ordered steps).
3. **A pre-existing flake**, not from this session — `tools/opensa-pack/src/model-osm-uv-anim.test.ts`
   times out at 5 000 ms under full-suite load (3.7 s alone). Confirmed by stashing this session's work and
   running the suite at `6ea15dc0`: same failure. It needs either an explicit `testTimeout` or a lighter
   fixture; today it is a red line in a green suite, which is the worst state for it to be in.
