# 001 — Scaffold & workspace wiring

Part of the [cleo/sdk chain](readme.md). No dependencies — the chain's first step. Delivers the
project skeleton every later plan builds inside: the root `cleo/` category, the `cleo/sdk`
workspace project, the `cleo/scripts/` home, and a build command that runs green while still empty.

## Context

The `asi/perfect-map` precedent is the shape: a self-contained root project (outside `packages/`
and `tools/`) because it AUTHORS runtime content rather than building the map, with its own
`docs/architecture.md` + `docs/plans/` and a `package.json` wired into the npm workspace. This plan
copies that shape for `cleo/`, so 002–005 land into a project that already compiles, lints and
tests like every other workspace member.

## Decisions

1. **Names as decided in the architecture:** root category `cleo/`, project `cleo/sdk`, package
   `@opensa/cleo-sdk` (`private: true`, nx tag `type:tool` — the `asi/perfect-map` pattern).
   Authored script sources live in `cleo/scripts/`, one folder per script; compiled artifacts in
   `cleo/sdk/dist/` (git-ignored, never committed).
2. **Workspace dependency direction:** `@opensa/cleo-sdk` depends on `@opensa/cleo` (the decoder,
   the generated opcode table, the disassembler, `var-space` semantics). The runtime never imports
   the SDK — build-time only, zero runtime cost.
3. **Build command:** `npm run build:cleo-scripts` at the root → `tsx cleo/sdk/src/build.ts`. In
   this plan it discovers `cleo/scripts/` and reports "0 scripts" — the pipeline exists before the
   assembler does, so 002–004 develop against a running command.
4. **Tests co-located** (`*.test.ts` beside sources, vitest) — the `packages/` convention, not
   `asi/`'s separate `test/`: this project is plain TS, there is no cross-compile boundary to keep
   apart.
5. **Docs live here** (`cleo/sdk/docs/`), the root plan `097/08` points at this chain — one home
   for the SDK's architecture and plans, no duplication.

## Tasks

- [x] `cleo/sdk/package.json`, added to the root `workspaces` list. (No per-package tsconfig and no
      declared dependency — the repo convention is ONE root tsconfig and workspace-wide resolution;
      `@opensa/cleo` resolves by name like every other cross-package import.)
- [x] `cleo/sdk/src/build.ts` (discovery, exported + unit-tested) + `src/cli.ts` (the top-level
      entry, the `tools/*/src/cli.ts` pattern); `build:cleo-scripts` root script.
- [x] `cleo/scripts/` home with its README (sources, never artifacts).
- [x] `cleo/sdk/dist/` git-ignored (verified with a probe file).
- [x] `cleo/sdk/README.md` — the layout, the why-root-not-tools line, pointers to
      `docs/architecture.md` and the plan chain.
- [x] Meta-checks: root tsc, full eslint, vitest (glob `cleo/**/*.test.ts` added), `npm run arch`.
      **Found + fixed:** `scripts/arch-graph.ts` `layerOf()` classifies by path prefix and did not
      know `cleo/` — the SDK landed in the ENGINE layer and leaked into `runtime-packages.svg`.
      Added `cleo/` to the tool branch; diagrams re-rendered (the real dependency guard, the
      nx-tag eslint boundary, was correct all along — only the picture lied).
- [x] `docs/commands.md` — the new build command, in the same change.

## Verification

Full lint + typecheck + test run green with the empty project in the tree; `npm run
build:cleo-scripts` runs and reports zero scripts; `git status` clean after a build (dist ignored).

## Measurements / notes

### Shipped (2026-08-06)

- `npm run build:cleo-scripts` → `[cleo-sdk] 0 script(s) discovered` — the pipeline shell runs
  before the assembler exists, as planned.
- Full suite with the project in the tree: **421 files / 3 664 tests green** (was 420 / 3 661 —
  +1 file / +3 tests are the SDK's discovery tests); root `tsc --noEmit` clean; full `eslint .`
  clean.
- `npm run arch`: `cleo-sdk` in the TOOLS subgraph; `runtime-packages.svg` (app+engine layers)
  byte-identical to its pre-SDK render — the runtime picture is untouched by the new project.
- Layering: nx tag `type:tool` → may depend on `type:engine` (`@opensa/cleo`) + `type:tool`;
  the runtime cannot import the SDK without the eslint boundary going red.
- Unrelated repo fix ridden along: a pre-existing prettier error in
  `tools-debug/bench-harness/warnings.js` (committed in `bbc5f4c`) made full `eslint .` red;
  autofixed to restore the repo-wide lint gate.
