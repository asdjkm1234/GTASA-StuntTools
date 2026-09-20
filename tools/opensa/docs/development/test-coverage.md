# Test coverage

> **Before running any tests, run `npm run test:fixtures`** (mandatory). The real-asset fixtures under
> `fixtures/original/` are Rockstar assets — gitignored and regenerated locally from a clean, **unmodified**
> GTA San Andreas copy at **`game-src/original/`**. Without this step, fixture-backed tests fail
> (hard readers) or skip (guarded readers). CI runs no tests for this reason. See
> [scripts.md → test-fixtures.ts](./scripts.md#test-fixturests).

Run: `npm run test:coverage` (Vitest + v8). Scope (from `vitest.config.ts`): `apps/web/**` + `packages/**`
`.ts` logic. **Excluded, and the list is short enough to state in full** (`vitest.config.ts`):
`*.test.ts` · `index.ts` · `*.interface.ts` · `renderware/src/test-utils.ts` ·
`packages/engine/src/test/**` (the fake `GPUDevice` — test infrastructure, not product code) ·
`apps/web/src/standalone/**` (dev-only entry scripts) · and the **DOM glue** verified on the Playwright
e2e lane instead: `game/src/input/keyboard/keyboard.ts`, `apps/web/src/ui/**`, and the two asset-loader
files. **The rule that keeps the exclusion honest: anything excluded there MUST have an e2e spec
exercising it** — that is why the compare viewer tab gained one in 074/13 phase 4.3.

## Current (2026-07-18, after the plan-077 recovery)

**Statements 88.18 % · Branches 78.57 % · Functions 90.72 % · Lines 88.12 %** (300 test files, 2 100
passing, 0 skipped). Enforced floors in `vitest.config.ts`: statements 86 / lines 86 / functions 88 /
branches 77 — a small buffer below the achieved numbers, the repo's standing convention.

**How it got here, because the dip is instructive.** Plan [074/13](../plans/074-opensa-engine/13-cleanup.md)
deleted the three-WebGL renderer — a large, heavily unit-tested body of code — and `packages/engine`, the
WebGPU renderer that replaced it, was effectively untested because it needs a GPU device. Coverage fell
88.9 % → 72.3 % and the floors went red. The fix was NOT to lower them:
[plan 077](../plans/077-unit-coverage/readme.md) built a **device-independent seam** instead.

`packages/engine/src/test/fake-device.ts` is a recording stand-in for `GPUDevice` implementing the exact
WebGPU surface the engine uses. `Engine.init()` runs against it unmodified — the engine's own `initDevice()`
only touches `navigator.gpu` — so the engine boots and renders a frame with no GPU, and tests assert **what
the engine decided to draw**: the hour gate on `tobj` objects, cell culling, pass order, the residency
ledger returning to its prior line on unload. Zero changes to engine sources.

**The rule that keeps this honest:** a test that only proves `createBuffer` was called is coverage theatre.
If a test cannot fail for a reason a user would care about, it does not belong in the suite.

## Historical (2026-06-13, after It.1–7 + coverage hardening)

**Statements 88.9% · Branches 78.64% · Functions 87.21% · Lines 88.81%** over the headless scope above
(108 test files, 651 passing, 0 skipped). Enforced floors in `vitest.config.ts`
(`coverage.thresholds`): statements/lines/functions **85**, branches **77** — a small buffer below the
achieved numbers so an unrelated change can't silently erode coverage (`npm run test:coverage` fails below).
Branches sit lower by nature (error/edge + fetch paths in `resolve-map`/`img-archive`/`build-region`).

## Historical baseline (2026-06-13, Iteration 0)

90 test files, 543 passing / 8 skipped. (Iteration 1 committed the missing real fixtures → **551 passing, 0
skipped**; the 8 were real-asset `skipIf` tests gated on absent `testground.*` / a packed `gta3.img`.
Iteration 2 de-coupled the text parsers from `static/` and filled the surfinfo/text-lines gaps →
**92 files, 558 passing, 0 skipped**. Iteration 3 covered the three untested three/ builders
(corona/night-fill/animated-objects) and added real-model tests (admiral/tommy/washer/water/junk/col) →
**95 files, 582 passing, 0 skipped**. Iteration 4 covered `procobj-categories.ts` and audited the
map/collision/streaming edge registry (all locked) → **96 files, 586 passing, 0 skipped**. Iteration 5
covered the game systems with extractable logic (weather-transition, vehicle-damage, vehicle-physics,
character-animation, wind-mode) → **101 files, 617 passing, 0 skipped**. Iteration 6 covered the non-GL
plugin/core logic (clock, system-registry, cloud-profile, render-pipeline, reflection presets, fog plugin) →
**107 files, 644 passing, 0 skipped**. Iteration 7 added an adapter integration test (real cell build via a
fixture-backed archive + real timecyc/character loads through stubbed fetch) → **108 files, 647 passing, 0
skipped**. Iteration 8 scaffolded the Playwright e2e lane (object-viewer smoke + visual baseline, 3 tests) —
separate from `npm test`; see `e2e.md`.)

| Metric     | %     | covered/total |
| ---------- | ----- | ------------- |
| Statements | 66.9  | 3782/5653     |
| Branches   | 62.17 | 1351/2173     |
| Functions  | 64.25 | 550/856       |
| Lines      | 66.42 | 3650/5495     |

### Per area (statements %)

- **Strong (≥90):** `parsers/binary` 97, `parsers/text` 96, `three/` 91.5, `streaming/` 96, `collision/` 97,
  `events/` 100, `time/` 94.
- **Partial:** `map/` 81, `archive/` 77, `vehicle/` 60 (enter/lod high; damage/headlight/physics 0),
  `physics/` 52, `adapters/` 34, `character/` 30, `weather/` 32.
- **Zero / very low:** `game.ts` 0, `core/*` 0, `plugins/*` 0 (cloud-profile, presets, all plugin GL),
  `input/keyboard` 0, `three/corona` 18, `three/night-fill` 59, `three/build-col-wireframe` 67,
  `weather-transition` 0, `vehicle/{damage,headlight,physics}.system` 0, `character/{animation.system,setup}` 0.

### Untested-module triage (HISTORICAL — plan-046 era, 2026-06)

> **Most of the files below no longer exist.** They were the three-WebGL renderer, deleted in
> [074/13](../plans/074-opensa-engine/13-cleanup.md). Kept as the record of how that iteration was
> planned; do NOT read it as a live TODO list.

#### Unit-testable now (pure / extractable logic) — target of Iterations 1–6

- Parsers/util: `parsers/text/surfinfo.parser.ts`, `parsers/text/text-lines.ts`, `parsers/binary/col-types.ts`,
  `parsers/binary/constants.ts`, `map/procobj-categories.ts`.
- three/: `three/corona.ts` (buildCoronaPoints), `three/night-fill.ts` (onBeforeCompile inject, like
  world-material), `three/animated-objects.ts` (update logic), `three/build-col-wireframe.ts` (raise to full).
- game logic: `weather/weather-transition.ts` (blend), `plugins/cloud-profile.ts` (weather→profile),
  `plugins/vehicle-reflection/presets.ts` (registry), `plugins/render-pipeline.ts` (ordering),
  `plugins/fog.plugin.ts` (distance→density pure bits), `vehicle/vehicle-damage.system.ts`,
  `vehicle/vehicle-part.ts`, `vehicle/vehicle-physics.system.ts` (math via physics mock),
  `character/character-animation.system.ts` (clip selection), `core/clock.ts`, `core/system.ts`,
  `ecs/world.ts`, `ecs/components.ts`, `events/events.global.ts`, `input/keyboard.ts` (mockable),
  `mods/wind-mode.ts`, `ui/locations.ts`.

#### Viewer / e2e only (canvas / GL / DOM / full loop) — Iteration 8

- `game.ts` (whole loop), `core/camera-controller.ts`, `core/renderer.ts`, `input/keyboard.ts` (DOM — low value
  to mock), `plugins/{sky,water,postfx,ambient-light,directional-light}.plugin.ts`,
  `plugins/vehicle-reflection/vehicle-reflection.plugin.ts` (GL/shader output — extract pure bits in It.6,
  leave GL to e2e), `vehicle/vehicle-headlight.system.ts` (canvas textures — logic already covered in
  build-vehicle), `character/setup-character.ts` (model load — adapter integration in It.7),
  `ui/hud/load-fonts.ts`, `ui/debug/debug-styles.ts` (trivial styles), the three `standalone/*-viewer.ts`
  (these are the e2e harness, not units).

## Notes

- v8 counts `.ts` files loaded during the run plus the `include` glob, so zero-coverage files still appear.
- **Thresholds ARE enforced** (`vitest.config.ts` `coverage.thresholds`) — `npm run test:coverage` fails
  below them. The plan-046-era note that said "intentionally NOT gated yet" was superseded when the floors
  were first armed, and re-armed at 86/86/88/77 by [plan 077](../plans/077-unit-coverage/readme.md).
