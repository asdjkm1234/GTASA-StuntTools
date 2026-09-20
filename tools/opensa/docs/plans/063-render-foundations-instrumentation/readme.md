# 063 — Foundations: instrumentation & colour pipeline

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**
**The one engine-agnostic tail — the "streamed-out cells may not release GPU resources" leak concept — was
verified a NON-ISSUE on the own engine the same day: the ledger unit test (`engine.frame.test.ts`) plus a
30-min headless soak, residency/texture/heap all flat →
[benchmarks #20](../../benchmarks/opensa-engine/2026-07-21-soak30-headless.json).**

**Status: ✅ shipped 2026-07-10** (perf HUD + GPU timer + bench harness + baselines on the M3 Pro reference
machine + `graphics.pipeline` switch + colour decision frozen: post-pass ACES). Open follow-up: possible
cell-disposal leak (geometries/textures climb across bench scenes) — tracked here, investigate separately.

Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). No visual changes — this plan makes every later stage MEASURABLE and cheap to A/B. Nothing else in the chain starts before the baselines exist.

## Context

- There is currently **no runtime FPS/draw-call instrumentation** anywhere (`renderer.info` unused, no Stats, no GPU timers) — a genuine gap given the chain's "very beautiful AND very fast" constraint.
- Tone mapping is an ACES `EffectPass` in the composer (`postfx.plugin.ts`), renderer keeps three defaults; the engine already runs a linear-space texture pipeline (`swapLinearTxds`, memory: linear-space colour math).
- 038 shipped its rework behind a `worldLighting` mode switch and deleted the old path after sign-off — the same rollout pattern serves the whole chain.

## Decisions

1. **Perf HUD + benchmark harness before anything else.** Every following plan records before/after numbers from the SAME harness; a stage that blows its budget doesn't merge.
2. **Fixed benchmark scenes**: 4–6 deterministic camera paths (downtown LS noon, SF fog dawn, LV night neon, countryside dusk, ocean horizon, rain) selectable via URL (`?bench=ls-noon`), each producing avg/p95 frame ms + draw calls + triangle count as JSON to console/clipboard.
3. **GPU timing**: `EXT_disjoint_timer_query_webgl2` where available (per-pass timings via the postprocessing composer hooks); CPU fallback otherwise. Per-plugin cost visibility (sky / water / shadows / post) is the goal — budget disputes get settled by data.
4. **Colour pipeline decision up front**: pick renderer-level `outputColorSpace`+tone mapping (candidates: keep post-ACES vs renderer AgX/ACES) and freeze it BEFORE lighting calibration starts in 002 — recalibrating twice is the most expensive mistake available. Document the choice + reasoning here.
5. **A/B scaffolding**: a single `graphics.pipeline: 'classic' | 'modern'` master switch plus per-feature toggles (added by each later plan), all live via the debug overlay like existing graphics config.

## Tasks

- [x] Perf HUD (debug overlay panel): **shipped** — `PerfMonitor` (`packages/game/src/perf/perf-monitor.ts`, 2 s rolling window, avg/p95/fps + `renderer.info` draws/tris/programs/geometries/textures) + the overlay's new **Perf** screen (`apps/web/src/ui/debug/perf-panel.tsx`, 4 Hz poll). Sampling only while the panel is open (or a bench runs) — zero cost hidden.
- [x] GPU timer wrapper: **shipped** — `GpuTimer` (`packages/game/src/perf/gpu-timer.ts`): labelled query pool over `EXT_disjoint_timer_query_webgl2`, in-order poll drain, EMA per label, disjoint discard, no-op fallback. Wired as a whole-`frame` label around `pipeline.render()` in `game.ts`; per-pass labels inside the composer arrive with the plans that need them (065 shadows first).
- [x] Benchmark harness: **shipped** — `BenchPlugin` (`packages/game/src/perf/bench.ts`; a plugin so it ticks after the camera controller and can own the camera): teleport the player anchor → `withStreamingFreeze` settle → 1.5 s warm-up → timed path run captured by PerfMonitor → JSON report (console `[bench]` + clipboard). 6 scenes in `apps/web/src/bench-scenes.ts` (ls-noon / sf-fog-dawn / lv-night / country-dusk / ocean-horizon / ls-rain-night), run via `?bench=<key>` or `?bench=all`. **BASELINE numbers pending the user's run on the reference machine.**
- [x] Colour pipeline spike: **DONE, decision FROZEN (2026-07-10): ACES in the post pass** — the shipped look. Live A/B via the debug selector (curves ACES/AgX/Neutral/None in the ToneMappingEffect): user verdict — ACES best, Neutral worst (too contrasty), AgX ≈ None-ish. Placement was decided by architecture (renderer-level tone mapping is a no-op under the composer — three skips material-stage tone mapping into render targets). All 064+ calibration assumes post-ACES; the selector stays as a debug tool.
- [x] `graphics.pipeline` master switch: **shipped** — `GraphicsConfig.pipeline: 'classic' | 'modern'` (default `'classic'`), `game.setGraphicsPipeline`, Graphics-screen toggle (`PipelineToggle`). No behaviour change yet by design.
- [x] Lint/tsc green; unit tests: perf-monitor (percentile/window/capture), gpu-timer (fake-GL state machine), bench (samplePath + runner lifecycle) — 21 new tests, all passing; config-fixture tests updated for the new field.

### Verification still owed (user)

1. Boot the game, F2 → **Perf**: numbers should match devtools FPS within noise.
2. `?bench=ls-noon` (or `?bench=all`): watch the flyover, collect the `[bench]` JSON lines → paste into Measurements (they are THE chain baselines). Scene coords/paths are a first cut — tune anchors if a path clips geometry.
3. Colour spike session (screenshots at 12/19/00 h) → freeze the tone-mapping decision here.

### Decomposition (2026-07-10, from the code recon in [062](../062-rendering-overhaul/readme.md))

File-level plan, honouring the repo's split (engine logic in `packages/game`, React/debug glue in `apps/web`;
`game.ts`/plugins are vitest-excluded → pure logic goes in its own unit-testable modules):

1. **`packages/game/src/perf/perf-monitor.ts`** — `PerfMonitor`: 2 s ring window of frame durations,
   `frame(deltaS, renderer)` sampling `renderer.info` (no-op unless `enabled`), `stats()` → avg/p95/fps/draws/
   tris/programs/geometries/textures. Pure percentile math unit-tested.
2. **`packages/game/src/perf/gpu-timer.ts`** — `GpuTimer` over `EXT_disjoint_timer_query_webgl2`: labelled
   begin/end query pool, per-frame `poll()`, EMA-smoothed per-label ms, disjoint discard, `available=false`
   no-op fallback when the extension is missing. State machine unit-tested with a fake GL.
3. **`game.ts` integration** — `getPerfMonitor()`; frame sampling after `pipeline.render()`; GPU `frame` label
   around the render + `poll()` per frame. (Per-pass labels inside the pmndrs composer arrive with the passes
   that need budgets — 065's shadow pass first; the wrapper API supports labels from day one.)
4. **`packages/game/src/perf/bench.ts`** — deterministic path sampling (`samplePath`, unit-tested) + a
   `BenchPlugin` (plugins tick AFTER `cameraController.update`, so it can own the camera without touching the
   controller): teleport → `withStreamingFreeze` settle → warm-up → timed run collecting PerfMonitor frames →
   JSON report (console + clipboard).
5. **`apps/web/src/bench-scenes.ts`** — the 6 fixed scenes (LS noon, SF fog dawn, LV night, countryside dusk,
   ocean horizon, rain) as data; `?bench=<key>` parsed in canvas-host after boot-ready.
6. **Config** — `GraphicsConfig.pipeline: 'classic' | 'modern'` (default `'classic'`, no behaviour change);
   debug-overlay toggle. Perf HUD = new debug-overlay screen polling `getPerfStats()` at 4 Hz while open
   (monitor enabled only while the panel is open or a bench runs).
7. **Colour spike** — separate step WITH the user (screenshots + live A/B): renderer-level tone-mapping modes
   vs the current post-ACES `EffectPass`; caveats to test: material-stage tone mapping happens BEFORE post
   effects when the composer is on (bloom input changes), and custom ShaderMaterials (water) skip renderer
   tone mapping entirely.

## Verification

- HUD numbers match an external reference (browser devtools FPS meter) within noise.
- Benchmark reruns are stable (<5% variance run-to-run on an idle machine).

## Measurements

_(record before closing — these are the chain's baseline)_

### First HUD reading (2026-07-10, user's machine — spec TBD)

- Idle at spawn: **32 FPS** (avg 31.10 ms, p95 34.20 ms), **GPU `frame` 29.96 ms** → the frame is **GPU-bound**
  already on the classic pipeline; programs 110, geometries 8 191, textures 4 437.
- During/after `?bench=all`: 24 FPS (avg 41.49, p95 49.90), geometries **16 476**, textures **9 020** — counts
  roughly double across the 6-scene sweep. FOLLOW-UP: check whether streamed-out cells release their
  geometries/textures or accumulate (could be legit multi-area residency, could be a disposal leak).
- **BUG found & fixed by this reading:** draws/triangles showed `1/1` — with the composer, three resets
  `renderer.info` per internal render call, so the post-frame sample saw only the final SMAA quad. Fixed:
  `renderer.info.autoReset = false` + manual `info.reset()` at the top of the frame loop (accumulates across
  shadow/normal/SSAO/scene/post passes). Draw/tri numbers before this fix are meaningless — re-run needed.

- **Reference machine: Apple M3 Pro, 18 GB RAM** (browser, retina; all chain budgets measure against this).

### BASELINES (2026-07-10, classic pipeline, post-info-fix `?bench=` runs)

| scene           | fps  | avg ms | p95 ms | draws  | tris   | GPU `frame` ms | note                                                    |
| --------------- | ---- | ------ | ------ | ------ | ------ | -------------- | ------------------------------------------------------- |
| ls-noon (run 1) | 18.7 | 53.47  | 66.0   | 10 394 | 7.07 M | 39.46          | GPU-bound                                               |
| ls-noon (run 2) | 19.1 | 52.47  | 59.2   | 10 143 | 6.62 M | 39.61          | avg variance vs run 1 ≈ 2 % ✓ (p95 noisier, ~11 %)      |
| sf-fog-dawn     | 30.1 | 33.24  | 41.6   | 7 116  | 6.42 M | 21.65          |                                                         |
| lv-night        | 30.0 | 33.32  | 49.1   | 7 373  | 3.42 M | 12.68          | **CPU-bound** (frame ≫ GPU)                             |
| country-dusk    | 43.4 | 23.04  | 26.0   | 3 978  | 2.67 M | 14.78          | lightest scene                                          |
| ocean-horizon   | 78.2 | 12.79  | 17.5   | **62** | 8 050  | 18.39¹         | near-empty frame — the fps ceiling of the machine+shell |
| ls-rain-night   | 20.9 | 47.85  | 58.3   | 10 445 | 7.19 M | 16.64          | **CPU-bound** (47.9 ms frame vs 16.6 ms GPU)            |

¹ GPU 18.4 ms > frame 12.8 ms is physically impossible sustained — on Apple Silicon (ANGLE→Metal) the
`EXT_disjoint_timer_query_webgl2` results are known to be coarse/unreliable. Treat GPU numbers on this machine as
INDICATIVE (relative comparisons within a scene), not absolute; frame avg/p95 are the trustworthy series.

**What the baselines already say (feeds every later stage):**

1. **Draw-call submission is the #1 cost.** 10 k draws in LS ≈ 48–53 ms frames even when the GPU is at 16 ms
   (rain-night). The modern chain must not ADD draw calls carelessly (CSM caster passes in 065 are the risk);
   batching/instancing wins would pay across every scene — worth a note for 072's budget work.
2. **Daytime GPU cost is disproportionate**: ls-noon GPU 39.5 ms vs ls-rain-night 16.6 ms at equal draws/tris.
   Prime suspects: the god-rays pass (sun visible by day only) + SSAO over full-detail day scenes. Per-pass GPU
   labels (065+) will attribute it; if god-rays ≈ 20 ms it becomes an early quality-tier knob.
3. Idle HUD after the sweep: geometries 22 801 / textures 12 390 and climbing across scenes — the
   **possible cell-disposal leak** follow-up stands (streamed-out areas may not release GPU resources).
4. 16.6 ms p95 (072's contract) is currently missed by 2–4× on every city scene on the reference machine —
   the chain's perf work is real, not cosmetic.

- Per-pass GPU cost snapshot (render / SSAO / god-rays / bloom / SMAA): … _(labels land with 065+)_
- **Colour-spike finding (2026-07-10): renderer-level tone mapping is ARCHITECTURALLY UNAVAILABLE** — with the
  composer, three skips material-stage tone mapping when rendering into a render target, so the
  'aces-renderer'/'agx-renderer' modes were live-verified no-ops (user: no visible difference, everything reads as None).
  **Placement decision therefore FIXED: the post ToneMappingEffect.** The spike selector now swaps the CURVE
  there instead (`toneMappingMode: 'aces' | 'agx' | 'neutral' | 'none'`, pmndrs modes ACES_FILMIC/AGX/NEUTRAL) —
  applies to the whole frame incl. sky/water, no shader recompiles.
- **Colour pipeline decision (FROZEN 2026-07-10): post-pass ACES** (placement forced by the composer
  architecture; curve chosen by A/B — ACES > AgX ≈ None > Neutral per the user at 12/19/00 h).
