# 074 — OpenSA engine (own WebGPU framework + native formats) — chain umbrella

**Goal: 60 fps on M3-class hardware with the FULL current WebGL effect set, on the same world data.**

> ## Where this chain stands — verified against the tree, 2026-08-11
>
> **The engine SHIPPED and is the one the game runs.** Its per-step checklists were never ticked, so a
> checkbox scan reported 46 live tasks in a chain that has been in production for weeks. Each step was checked
> against the code rather than assumed, and the answer splits three ways:
>
> - **Struck as done (32 boxes, steps 01/02/04/05/11/13):** `packages/engine` and `packages/engine-formats`
>   exist, `apps/engine-lab` exists, the bench harness runs (`bench-scenes.ts`, 75 recorded runs in
>   `docs/benchmarks/opensa-engine/`, `bench-compare.ts`), and 13 already declared itself COMPLETE.
> - **Genuinely NOT built — [15 (LOD baked lights)](15-lod-baked-lights.md).** There is no `bakeNightLights`
>   anywhere in the tree. This is the one whole step of the chain that never happened, and its boxes stay open
>   for that reason.
> - **Part-shipped, so the boxes stay open and name their own tails** — 06, 07, 08, 09, 10, 12, 14. Verified
>   present: god-rays, coronas/particles, skinning, breakables, IDE anim objects, the `_vlo` vehicle LOD band,
>   water. Verified ABSENT: **vehicle lamp head/tail STATE** and the **dynamics-only near shadow pass** (08),
>   and 14's full-profile conversions (anderius/carcer/gostown) and BC α-subset. 07's directional v2 is
>   deferred to roadmap 0.6.0 by its own text; 12 ships default-off by the user's verdict.
>
> Nothing here is a debt list to work through. It is the honest inventory: what the engine has, and the four
> places where a box means what it says.
Graduated from the [00-concept](00-concept.md) research record after the
[073 three-WebGPU migration](../073-webgpu-migration-threejs/readme.md) FAILED on three's side. Every design
decision below traces to a 073 field measurement — this chain exists because we now know exactly what the
browser can do (Babylon snapshot 0.12 ms CPU @ 15k draws; vanilla SA 100+ fps on this GPU) and exactly what
killed the framework attempt (per-object pipelines, lazy compiles, naga codegen traps, retained-memory
pressure, black-box GPU time).

**WebGPU only.** No WebGL backend, no abstraction tax. The intact three-WebGL prod path IS the fallback for
non-WebGPU browsers during the whole build-out (additive, no flag day — the 066 ground rule).

## The chain

| #   | Plan                                                                          | One-liner                                                                                                             |
| --- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 01  | [Framework architecture](01-framework-architecture.md)                        | The renderer design: module map, bind model, frame graph, shader system, extension points.                            |
| 02  | [Native formats](02-native-formats.md)                                        | `.oscell` / `.ostex` / `.ospak` — GPU-ready, versioned, batching + texture arrays + alpha.                            |
| 03  | [Converter tool](../../../tools/opensa-pack/docs/plans/000-converter-tool.md) | `tools/opensa-pack`: game-ready set → native pak; the ALPHA PIPELINE lives here (early).                              |
| 04  | [Engine lab + P0 gate](04-engine-lab-p0.md)                                   | `apps/engine-lab`: the vertical-slice spike, bench parity, numeric gates, Safari check.                               |
| 05  | [Streaming runtime](05-streaming-runtime.md)                                  | Cell lifecycle, worker IO, range reads, GPU residency/eviction — the memory model.                                    |
| 06  | [World effects parity](06-world-effects-parity.md)                            | Effect-by-effect WGSL ledger: sun/fog/sky/lights/emissives/wind/water, each measured.                                 |
| 07  | [Baked channels](07-baked-channels.md)                                        | Static shadows + AO/skyVis + emissive mask — 066/03-04 executed against the new target.                               |
| 08  | [Dynamics](08-dynamics.md)                                                    | Skinning (EARLY probe), character + IFP, vehicles, particles, procobj instancing.                                     |
| 09  | [Post-FX & AA](09-postfx-aa.md)                                               | MSAA+A2C, bloom, ACES, god-rays; render-scale tiers.                                                                  |
| 10  | [Integration & flip](10-integration-flip.md)                                  | Boundary refactor, game-app integration, flip criteria, 073-flags cleanup decision.                                   |
| 11  | [Performance testing](11-performance-testing.md)                              | Pinned `game-src` input + bench scenes + committed series — every engine change perf-gated.                           |
| 12  | [Stochastic texturing](12-stochastic-texturing.md)                            | De-tiling ground/grass/roads (skygfx-researched 3-tap blend); offline name-list selection.                            |
| 13  | [Post-flip cleanup](13-cleanup.md)                                            | AFTER the flip: drop the three-WebGL path, the 073 debug-flag zoo, three/babylon/postprocessing deps.                 |
| 14  | [pmb integration + final measure](14-pmb-integration.md)                      | Embed opensa-pack into perfect-map-builder; full modded-map conversion + the chain's exit-exam bench.                 |
| 16  | [Vehicle paint](16-vehicle-paint.md)                                          | Deep vehicle reflections — PARKED with a rejected v1; the rework plan (tonemapper, env probe, SSR, normals).          |
| 17  | [Map lighting](17-map-lighting.md)                                            | B6.5 — broken normals + 2dfx lamps. Round 1 REVERTED (per-pixel lamps cost 120→25 fps); measurements + open blockers. |
| 18  | [UV-scroll animation](18-uv-anim.md)                                          | B7·c — the crawling neon / conveyor belts. Parsed already, rendered by prod, ignored by the engine.                   |
| 15  | [LOD baked lights](15-lod-baked-lights.md)                                    | Bake 2dfx lamp light into LOD night prelit — far-field streetlight pools / billboard glow at night.                   |
| 21  | [Fog draw-distance](21-fog-draw-distance.md)                                  | Fog ⊂ LOD-ring invariant (streaming becomes invisible) + fog-into-clouds v2 + distance cull + 05's parked prefetch.   |
| 22  | [Debug tools port](22-debug-tools.md)                                         | The LAST pre-flip BLOCKER: F2 debugger port (7 phases) + photo mode K+M + pointer-capture button.                     |

## Roadmap — vertical slices with numeric gates (plans ≠ phases; each milestone cuts across plans)

| Milestone                          | Cuts through                                                                                                                                                            | Gate (numbers, not vibes)                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 — vertical slice** (~1–2 wks) | 01+02+03+04 minimal: format v0 (batching + texture arrays + alpha pipeline), converter for ONE district, renderer core (opaque + cutout + flat sky), HUD+GPU timestamps | district @2× retina **<5 ms GPU, <1 ms submit**; **alpha fringe visually dead** (vgsebushes/fences); boots in Safari TP                             |
| **M1 — streaming proof**           | 04+05 full: worker IO, range reads, cell lifecycle, stress harness                                                                                                      | ls-noon flythrough (SAME camera path as the WebGL bench): **no frame >20 ms during swaps**, cold start < WebGL prod, **JS heap flat** while driving |
| **M2 — world parity**              | 06+07: all world effects + baked channels                                                                                                                               | bench scenes visually ≥ WebGL prod (screenshot compare); **fps ≥ 2× WebGL prod** on every scene                                                     |
| **M3 — dynamics**                  | 08: character walks/drives in the lab                                                                                                                                   | playable; skinning ≤1 ms CPU+GPU                                                                                                                    |
| **M4 — ship**                      | 09+10: post chain, integration, tiers                                                                                                                                   | **60 fps ls-noon @2× retina M3 Pro**; better than WebGL prod on EVERY bench scene → default flip                                                    |

An M0 failure is a cheap, honest answer — that is the point of gating first.

## Ground rules (carried from 066 + hard 073 lessons)

1. **Additive.** New app (`apps/engine-lab`), new package (`packages/engine`), new tool (`tools/opensa-pack`);
   the prod web app and its tool chain are untouched. `packages/engine` must not import from `packages/game`
   or three — the boundary is enforced by nx tags from day one.
2. **The converter consumes the FINAL game-ready set** (post map-optimizer / lod-generator / installer — the
   exact files the prod web app loads). Existing tools never learn about the new format.
3. **No lazy anything on the hot path.** Every pipeline compiles behind the load veil; every buffer/texture is
   created at cell load; the steady-state frame allocates zero (JS and GPU). Cold-start storms and GC-vs-GPU
   ambiguity are 073 wounds — designed out, not fixed later.
4. **Measure or it didn't happen.** GPU timestamp queries + the frame-segment HUD land in M0 before the first
   effect. Every plan doc keeps a measurement ledger (the standing rule).
5. **Format versioned from day one** (magic + version + optional-channel bitmask); v0 is explicitly throwaway;
   readers reject unknown majors loudly.
6. **Budget guards in the tool** (bytes/draws per cell, determinism with fixed seeds) — pmb spirit.
7. **Effects are uniform-gated where possible, variants where necessary** — the `uPipelineMix` pattern worked;
   variant explosion is the enemy (pipelines stay enumerable, target: dozens).

## What we reuse (nothing starts from zero)

- **Parsers**: `@opensa/renderware` (DFF/TXD/COL/IPL/IDE/IFP) — the converter is mostly composition.
- **Bake stack**: map-optimizer prelight (day+night), opensa-lod-generator cell-LODs (QEM chain, prelit/2dfx
  transplant), lod-trees/procobj atlases — all feed the converter unchanged.
- **Math already ported in 073**: world material (classic+modern), fog, moon, pool-as-texture, sky-lite arcs.
- **Streaming design**: rings/hysteresis/atomic-swap semantics (plan 060) — reimplemented thin, three-free.
- **Instrumentation**: the 073 HUD (frame/fixed/update/unaccounted/heap/longtasks) + bench scenes/paths.
- **The alpha-edge groundwork**: dilation BFS + DXT software decode exist from the
  [open issue](../../open-issues/fixed/alpha-edge.md).

## Handoff status (2026-07-19, end of day — resume from here)

**The user is running the full pmb rebuild.** Ask how it went before anything else — three fixes only take
effect on the other side of it, and three measurements are owed (see
[078 ledger](../078-global-bug-fixing/readme.md) and the `.oscell` minor-6 note in
[02 native formats](02-native-formats.md)).

Shipped this day, all in `95bd544` (suite 2282/321, `npm run lint` 0 errors):

- **[078 global bug fixing](../078-global-bug-fixing/readme.md) rounds 1–3** — the first full pmb run's
  fallout. 7 rows: 5 fixed, 1 not-a-bug, **1 still open (row 7: 42 `<model>.dff not found` — triage only,
  no rebuild needed; the cheapest next task).** The load-bearing find: map objects, props, clutter and cars
  all share ONE builder, so its uint16 throw was a map-wide outage — two hi-poly custom cars killed vehicle
  spawning for all 201 models and took 41 cell LODs with them. Fixed by carrying uint32 index width through
  the whole rigid path, plus per-placement isolation.
- **[22 debug tools](22-debug-tools.md) phase 7** — the F2 **Map screen restored** on the engine host
  (plan 13 had recorded it as a deliberate loss; the user called it the most important element). The
  streaming driver gained `listCells()` / `setManualCells()`.
- **[22 debug tools](22-debug-tools.md) phase 8 + `.oscell` minor 6** — the **placement mapper**, so the
  debugger can pick / name / hide one welded object. Runtime-optional behind `CellStore.debugPicking`.

Unchanged from the 07-18 handoff below: `three` does not exist in this repo, C2 is done, and the agreed
order after 078 closes is **079 viewers/lab → full migration audit → merge `webgpu-migration` into `main`**.

## Handoff status (2026-07-18 — history)

**THE TEARDOWN IS COMPLETE — [13 cleanup](13-cleanup.md) ran phases 1–8 in a day and `three` no longer
exists in this repository.** The flip was decided in the morning ([10-flip-decision](10-flip-decision.md),
user sign-off "parity ok"), C2 followed, and the old stack came out package by package: the four asset
viewers ported onto `@opensa/engine` · the WebGL host + render path + `renderware/src/three/` (43 files)
deleted · `@opensa/math` extracted with a parity suite captured from three@0.185.1 itself · seven
three-era modules found to be **dead code the engine had already superseded** (the AnimationMixer triple,
`TimedObjectSystem`, `hidden-instances`, `render-sync`, `orient-character`) and deleted with their tests ·
the dependency, `postprocessing`, `@types/three` and our 207-line three patch dropped (`patch-package`
went with it — it was the only patch). **Numbers: importers 122 → 0 · `node_modules` 512 → 455 MB ·
prod JS 5.4 → 2.88 MB · `npm run lint` green.** (Suite counts moved again immediately after — see the 077 paragraph.)

Ritual re-run PASS — 119.9–120.0 fps on all six scenes, `lateCreates` 0, **draws within ±4 of the
reference row** (the measurement that proves nothing live was deleted); the `gpuMs.pass` column read
uniformly high on a busy machine and is flagged as not-a-baseline in
[series § 13·post-teardown ritual](../../benchmarks/opensa-engine/2026-07-18-series.md).

**The one open decision the close-out left — RESOLVED the same day by [plan 077](../077-unit-coverage/readme.md).**
The teardown had sunk coverage 88.9 % → 72.3 % (71.9 % mid-teardown; the denominator kept moving as more untested code was deleted) (the deleted WebGL code was heavily unit-tested; the engine
that replaced it needs a GPU) and the floors went red. The answer was NOT to lower them: 077 built a
**device-independent seam** — `packages/engine/src/test/fake-device.ts`, a recording `GPUDevice`
stand-in. `Engine.init()` runs against it unmodified, so the engine boots and renders a frame headlessly
and tests assert **what it decided to draw** (hour gate, cell culling, pass order,
ledger-returns-on-unload). **Coverage 72.29 → 88.18 % stmt · 78.57 % br · 90.72 % fn; floors re-armed
86/86/88/77; suite 300 files / 2 100 tests, e2e 24 passed.** No engine source was touched, so nothing is
owed to the bench. 077 also found four defects (two real: `createFalling`'s box fallback is unreachable so
an unhullable prop CRASHED; `setColliderEnabled` silently did nothing and was dead). They were recorded
UNPATCHED first — a coverage pass that also changes behaviour cannot tell you which change broke what —
then fixed in their own commit the same session:
[open-issues/fixed/physics-collider-defects.md](../../open-issues/fixed/physics-collider-defects.md).

**Also standing from the close-out:** `?scale`, `?draw` and friends now have a canonical home —
[query-parameters.md](../../development/query-parameters.md). Phase 2.4 decided AGAINST a central
`flags.ts` (22 names, most read once, two hosts with different defaults); the reasoning is in the doc so
it can be re-decided.

**Next per the agreed sequence:** ③ the **opensa-pack REWORK** — **DONE 2026-07-19**, in its own plan
[`tools/opensa-pack/docs/plans/003-game-shaped-output.md`](../../../tools/opensa-pack/docs/plans/003-game-shaped-output.md)
(phases 0–6, closed). `--out` is a game-dir copy, every class in the archives converts (including the
~14 000 map objects, against the SHARED world dictionary), and opensa-pack is a perfect-map-builder `pack`
STAGE. The one thing left there is a full pmb run, which the USER does. → ④ the lab consumes that output
like a game dir ([plan 079](../079-canonical-build-source/readme.md)); `manifest.timecyc` + `setup.timecyc` are
already gone. Post-flip perf lever unchanged: per-ring texture laziness (~767 MB world-array boot baseline).

**Engine changes that arrived WITH the converter rework** (they alter how anything drawn BY NAME looks, so
a look-round must know): the rigid path reads PRELIT and NIGHT vertex colours (map objects were rendering
~3× too bright; cars are untouched — none carries a prelit set), `vsRigid` emits on the cell path's
night−day luma heuristic, clutter reads its authored night set instead of guessing, a rigid submesh names
a texture ARRAY (with world-array models binding the shared cell textures), and `buildVehicleModel` emits
vertices per MATERIAL GROUP — fixing wrong per-vertex attributes on 6.9 % of map models on BOTH paths.

## Handoff status (2026-07-16 — history)

**Plan [09](09-postfx-aa.md) FULLY SHIPPED + benched (2026-07-16):** ACES (prod-exact curve, `?aces=0`) ≈
free; bloom (prod dual-filter chain + plan-071 night threshold profile, `?bloom=`) — full post chain
1.05–1.25 ms at 2× retina (2.6× inside the ≤3 ms budget; **gpuMs.post is now a measured column** — the
post pass was untimed before, and the first post metric was a Metal TBDR overlap artifact, fixed as
`postEnd − worldEnd`); tiers — **`renderScale` is the ONE knob** (0.75 → −16…−25 % world GPU; msaa/bloomq
knobs field-tested and REMOVED: WebGPU sampleCount is 1|4 only + A2C needs 4; bloom levels saved ~0.05 ms).
All six bench scenes stayed vsync-locked 120 Hz through every step (series rows 09·ACES/bloom/post-fix/tiers).

**The look round is OPEN (gate lifted) — sky rounds 1–3 shipped the same day** (see the
[06 ledger row 4](06-world-effects-parity.md)): dawn/dusk ACCEPTED by the user (Preetham un-suppressed —
the dn-blend bug prod had already fixed; exposure 0.25→prod 0.55; timecyc lowClouds/bottomClouds tint the
whole deck both sides; night city glow + moon scatter + golden rims; night-glow FADE over the dusk hour;
prod cirrus wisps UNDER the panorama — the skybox stays per the user). Night world un-blackened
(`sunIndirect` night 0.4 → prod worldLight 0.7). **SKY v2 CLOSED — field-ACCEPTED 2026-07-17 ("everything is great"), six rounds in one day: (1) Hosek-Wilkie
replaces Preetham inside the sky LUT (the fit ran an INVERTED noon gradient, double-compressed by
Reinhard-then-ACES; verbatim BSD-3 reference port, linear HDR, `?sky=preetham` A/B) → (2) the painted
panorama RETIRED (byte analysis: a ~0.45-alpha grey veil over the whole dome buried any radiance model;
`?panorama=1` comparison — the whole dome path was then REMOVED 2026-07-17 on user command: engine
bindings + converter `clouds/` stage + `manifest.clouds` + flags + docs/licenses, see the 06 ledger
row-15 banner) → (3) procedural CUMULUS port of prod's applyClouds layer 2 + the normalized
cloud palette (timecyc = HUE only; raw luminance is authored for SA's gamma multiply — the 3rd hit of
that lesson) → (4) per-weather cloud IDENTITIES (profile grew scale+tint: EXTRASUNNY sparse · SUNNY =
the accepted look · CLOUDY dark broken banks · RAINY storm slate · SMOG dirty clumps) + the cloud-field
BAKE (256² rg16float per frame — full decks stopped scaling with the swapchain: 3.10 → 1.33 ms) + live
`[`/`]` weather keys → (5) the "clouds melting down" bug (prod has it too) = the hard projection floor
freezing the horizon band — softened to `dir.xz/(dir.y + 0.18)` → (6) prod's `WeatherTransition` wired
through the driver (`weatherBlend` getter + `lerpCloudProfiles`) — smooth 6 s weather changes are back.
Full history in the [06 ledger row 4](06-world-effects-parity.md); cost points in
[bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md) § Sky v2. FOG (the user's pre-C1 arc #2) = **plan
[21](21-fog-draw-distance.md): P1 (fog ⊂ LOD-ring invariant + `?draw=` knob + distance cull) and P2
(clouds composite into the fog colour) both FIELD-ACCEPTED 2026-07-17 across two rounds ("streaming pop-in
is almost unnoticeable" → "everything is great"), including the round-2 fixes: cutout fog no longer scales by texel.a
(ghost tree outlines) and the VEHICLE-MODEL BUILD WORKER (the ~170 ms new-car-type freeze — the
plan-060 dff-parse.worker pattern). P3 (adaptive 2-create + velocity prefetch + `lateCreates` metric +
the residency diagnosis: texture arrays, not cells) SHIPPED and FIELD-ACCEPTED the same day — user rode
LS with `late 0` everywhere: **the fog ARC IS CLOSED**. Owed as formalities: the ritual display sweep
row + the `?draw=` 800/1200/1600 sweep. Follow-ups in the plan-21 ledger: per-ring texture laziness
(~1.7 GB world arrays at boot) + vehicle-model LRU (+950 MB/sweep).\*\*

**Night brightness DIAGNOSED + FIXED (2026-07-16, awaiting field):** a controlled headless A/B (both
renderers, same spawn/hour, pixel-metered) showed deep night already ≈ prod but **20:00–21:30 ran 3–5×
darker** — the engine's moon LIGHT was gated by the moon DISC's arc elevation (zero until ~20:30), while
prod's world moonlight rides the sun-based night band (plan 071 §4) and is full within an hour of sunset.
The driver now ships prod's term verbatim (`(0.34,0.44,0.72) × band.moon × moon.brightness ×
night.skylight × 0.5` — this is also where prod's `night.skylight` reaches the world); the disc keeps its
arc, `moonFor` rescaled so the shipped disc look is untouched. Details in the [06 ledger row 6].

**Night arc CLOSED — field-ACCEPTED 2026-07-16 ("looks great") + benched (series 06·night-rounds).**
Four rounds total: prod moonlight band term (+ `night.skylight` reaches the world through it) → deep-night
normalization to prod's fixed-5° moon geometry → moon-park/sun-park continuity (the 19:59 azimuth teleport,
the 20:45 pbrNight step) → ~8-game-minute horizon eases on the three hard `sunDir.y > 0` gates (godrays +
the golden cloud tint ×2) that snapped the sky the frame the sun crossed. Bench: frame budget untouched;
country-dusk world pass 3.86 ms = new high, plausibly the by-design longer dusk (see the series row's
WATCH note). Full history in the [06 ledger row 6].

**Plan 16 steps 1–2 CLOSED, field-ACCEPTED (2026-07-16, six field rounds in one day):** the scene
ENVIRONMENT PROBE (128²×6×8-mip cube of the ACTUAL streamed world, one face / 2 frames in its own submit
reusing the recorded cell bundles; V-flip blit; mip ladder) + the **skygfx neo car reflection model**
(LERP the lit base toward the live probe by `lerp(b⁵, 1, 0.4) × coefficient`; broad specular, pool half
per VERTEX), material classes with a NO-NAME classifier (chrome = untextured neutral grey, a pure data
signal), the engine-lab **vehicle look bench** (`?vehicle=1&vmodel=…&at=…&orbit=…`, live hour buttons,
probe toggles), translucent-submesh sorting (the wheel-through-windscreen fix) and the night-fps roots
(config ×4 calibration, per-pixel pool loops off the car, pool nearest-cap 24). Full history in
[16 § step 2 rounds 1–6](16-vehicle-paint.md).

**BENCH ROAD CARS SHIPPED + FIELD-MEASURED (2026-07-16):** typed vehicles.ide cars on the NODES.DAT road
graph per bench scene (city 30 u / country 90 u spacing, lazy vehicle-lod streaming, `?benchcar=` pin);
the user's real-display sweep with 841 cars kept every scene vsync-locked 120 Hz (series row
11·bench-cars — draws ~2.4×, world pass +0.3–0.5 ms). Spawn robustness lessons live in
[11 § bench road cars](11-performance-testing.md). Vehicle normals SKIPPED to ideas 0.6.0/03 (user call);
a first-cut paths parser is noted in ideas 0.5.0/06-city-life (now `1-preparation/02-path-graph-import.md`
after the 2026-08-02 rework) as its head start.

**① DONE (2026-07-17): road cars WIRED into canvas-host + the WebGL-prod `?bench=all` BASELINE captured**
— shared `benchRoadCarPlacements` + `seatVehicleOnGround` in `packages/game` (both hosts assemble the
identical 841-car population; prod's map car generators inherited pitch/slide/defer seating). The user's
real-display prod sweep: 13.5–26.8 fps on land (54 fps empty ocean) vs the engine's vsync-locked 120 Hz
everywhere — frame-time ratio 4.5–8.9× on land, engine vsync-capped so the true ratio is larger. A
same-environment headless control (both renderers, one harness) confirms the gap is not display-specific.
Full tables in [bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md) § C1 WebGL-prod baseline.

**Plan 16 steps 3+6 BUILT AND ROLLED BACK (2026-07-17, user decision):** vehicle SSR (history-reproject
march) + contact blob shadows went through a full build + three field rounds in one day (night fps
110→60–70 → tuned to a clean 5/6-scene display sweep; "marching stripes" step-geometry bug; the decal
sinking under the road until a physics raycast placed it) — and the user called it: the stack worsened
the experience; a DIFFERENT approach next iteration; today stays the simple stable fast version. The
code is fully reverted; what survived the day: the translucent SORT fix (centroid − bounding radius —
the raked-windscreen wheel regression, an independent bug) and the lab's `?az/?el` orbit pins. The full
preserved record + constraints for the next attempt live in [16](16-vehicle-paint.md) § steps 3+6
(key ones: prod has NO SSR/blob — both are beyond-parity so they must be free or opt-in; march step-gap
≤ thickness-slope by construction; decal height from physics, never bind pose). Bench rows
16·ssr-grounding / 16·display-sweep in the series measure the ROLLED-BACK build; the display sweep also
tripped the country-dusk WATCH (pass 4.50 twice) — profile country-dusk before new dusk-hour effects.

**Evening close (2026-07-17) — the "simple stable fast version" batch, all field-confirmed:**

- **Static 2dfx lamps REMOVED from the light pool** (user decision — binary admission read as "lamps
  igniting ahead of the car"; pool = host dynamics only, coronas/emissives untouched; the
  [17 record](17-map-lighting.md) carries the two OPPOSITE cost data points: headless pass 2.9–3.8 → 1.4 ms vs the
  user's display "fps unchanged" — the real night bottleneck is elsewhere and unprofiled. User's field
  conclusion recorded as a DRAFT idea: light ALL lamps of loaded HD cells at once).
- **WEBGPU-FIRST, FINAL** (user: no dual-renderer support): flip criterion 4 replaced — the loader is a
  boot GATE (WebGPU → the engine IS the game; else a "sorry" screen); `?engine=three` = comparison
  override only, dies at C2.
- **opensa-pack: AO/skyVis bake ON BY DEFAULT** (`--no-ao` to skip — it replaces prod's SSAO; `--bakes`
  now gates only sun-vis) + the tool OWNS ITS PLANS (`tools/opensa-pack/docs/plans/`, the founding
  074/03 doc moved there as 000).
- **The baked-shadows open mystery DROPPED** (user: the whole shadow mechanic gets redesigned later —
  see the [0.6.0/04-graphic-improvements DRAFT bundle](../../roadmap/0.6.0/plans/04-graphic-improvements/readme.md):
  directional shadows + HD-cell lamps + dynamic contact darkening, one thinking round).
- **Vehicle-model texture LRU SHIPPED** (pre-flip item 1; series 21·vehicle-lru): 256 MB texture trim
  floor over the per-TYPE cache, live types pinned, worker rebuild on re-encounter; sweep texture bucket
  plateaus 1161 MB vs 2657 monotonic (−1.5 GB), 120 Hz, `lateCreates 0`. Round-1 lesson (claim-before-
  evict or fresh builds die "unknown model") in the plan-21 ledger. Awaiting the user's field ride.

**Resume (pre-flip order, 2026-07-17 close):** ~~① country-dusk PROFILE~~ **DONE 2026-07-17 — WATCH
RETIRED** (re-measured on the current build at retina-equivalent DPR-2 headless: country-dusk 2.17–2.36
ms sits inside the scene band 2.01–2.36, no longer the outlier; the 3.48 → 3.86 → 4.50 display trend was
measured on builds carrying SSR + the static lamp pool, both since removed; 4× pixels moved pass only
+0.0–0.45 ms so the cost was never resolution-bound — series row 06·dusk-watch; formal close rides the
C1 display sweep) → ~~② the WebGPU boot gate~~ **DONE 2026-07-17 — the ENGINE is now the DEFAULT host**
(webgpu-gate.ts probes adapter + BC mirroring initDevice; no WebGPU → sorry screen, menu never shows;
`?engine=three` = the comparison override, `?engine=opensa` still accepted; all three branches
harness-verified — plan 10 task note) → ~~③ the SOAK mode~~ **DONE 2026-07-17** (`?soak=<minutes>`
cycles the 6 bench scenes to the deadline; one `[soak] {json}` per leg + a final SELF-JUDGED verdict —
8 checks all relative to the run itself: coverage / heapFlat / residencyFlat / textureFlat / lateBounded /
longTasksBounded / frameStable / slowBounded; heap+longtask probes Chromium-only, judge skips them
elsewhere; verdict also lands on the HUD for the Safari read-off. Machinery: `soak.ts` pure judge +
14 unit tests, bench+soak legs SHARED via the extracted `engine-perf-runs.ts` (bench report verified
byte-shape-identical after the refactor). Mechanism field-checked: 4-min headless run = 15 legs, PASS,
heap flat 2661 MB, late 0, longTasks 0, slow 0.01 %) → ④ the C1 criteria run, RESCOPED by the user
2026-07-17: **parity screenshots SKIPPED for now · Safari NOT relevant** — what remains is (a) the
user's formal display `?bench=all` row, (b) **plan [22 debug tools](22-debug-tools.md) — RAISED TO
BLOCKER (user, late 2026-07-17): full F2 debugger PORT (the overlay is not mounted on the engine host
at all) + photo mode K+M + the pointer-capture button; 7 phases, detailed tasks in the plan**, (c) the
flip decision doc. 30-min Chrome soak DONE 2026-07-17: PASS all 8 checks (heap SHRANK
2661→2499 MB over 107 legs — series 10·soak30).

**2026-07-18 — plan 22 SHIPPED (phases 1–7, ledger in the plan) + the pre-measurement fix batch, all
field/headless-verified, ready for the user's runs:**

- **Black night ROOT-FIXED** — SA authors NEGATIVE timecyc cloud colours; the driver's `lin()` made
  them NaN and one NaN in the frame UBO poisoned every WGSL `mix()` even at factor 0 (sky AND fog).
  Floor at 0 + regression test; [open-issues/fixed/engine-night-sky-black.md](../../open-issues/fixed/engine-night-sky-black.md).
- **Timecyc source of truth → the LIVE game files** (user field finding: two different timecyc files
  rendered identical engine fog) — the host fed the driver the PAK-BAKED copy; now it reads
  `data/timecyc_24h.dat` / `timecyc.dat` from the VFS with prod's exact preference, manifest bake =
  pak-only fallback (the lab). Most of the engine-vs-prod fog "difference" was different DATA.
- **Clouds no longer walk onto buildings** — `fogColorFor`'s cloud composite now rides
  `smoothstep(0.7, 1.0, fogFactor)` (partial fog = haze; the deck only enters at the dissolve band,
  the pale-silhouette fix stays intact). Plan 21 ledger carries all three rows.

**① DONE (2026-07-18) — THE PRE-FLIP SWEEP IS CAPTURED.** The user's display `?bench=all` on both
renderers after the fix batch, 841 cars: engine **119.6–120.3 fps, p95 ≤ 9.3 ms, `lateCreates` 0 in all
six** vs prod's **16.2–37.8 fps** on land (59.6 ocean) — frame time 3.2–7.4× better, draws 4.8–12.0×
fewer, worst-scene total GPU 5.5 ms. This row supersedes the 22·debug-tools sweep and the invalidated
07-17 `ls-rain-night` / `country-dusk` rows (different fog DATA). Full table +
the honest tail (physics `fixed` 11–19 ms is the ONLY hitch source left; collider streamer still
unbudgeted) in [bench/series.md](../../benchmarks/opensa-engine/2026-07-18-series.md) § THE PRE-FLIP SWEEP. Parity screenshots taken by the
user — verdict pending. **The flip's performance case is CLOSED.**

**② THE FLIP IS DECIDED — 2026-07-18. [10-flip-decision.md](10-flip-decision.md).** The OpenSA WebGPU
engine is the shipping renderer; the user signed off parity ("parity ok") on the pre-flip sweep. All
four live criteria PASS (perf by 2×, parity, 30-min Chrome soak, WebGPU boot gate); criterion 5 (073
flag disposition) rides C2 by construction. **C2 STAYS GATED** — the three-WebGL path remains in the
tree behind `?engine=three` as the comparison rollback until the user's explicit deletion command. The
doc also records what the flip does NOT claim (map lighting 17 deferred · SSR rolled back · the residual
hitches are PHYSICS, 11–19 ms `fixed`, not the renderer · residency bounded at ~1.7 GB, not minimal).

**THE AGREED SEQUENCE (user, 2026-07-18): ~~① measurements + parity screenshots~~ DONE (above) →
~~② THE FLIP~~ DONE (decision doc; C2 stays GATED) → ③ on a successful flip: the
opensa-pack REWORK — output = "almost a copy of the game in our format", loose live-tunable files
(timecyc first) as FILES next to the pak ([074/14 tasks](14-pmb-integration.md)) → ④ the LAB updated
to consume that output like a game dir, then `manifest.timecyc` + `setup.timecyc` plumbing die.**
Known A/B caveat for the screenshot runs: the engine remaps weather REGIONALLY at spawn while the prod
bench sits on its literal id until a city crossing — `ls-rain-night` compares column 16 vs prod's 8
(recorded in the plan-21 ledger; call it before comparing those frames pixel-wise).
Post-migration queue (unchanged): opensa-pack plan 002 (fetch-game paks — gostown & co, user refines
scope) + bucket D debugger knobs. Post-flip residency follow-up: per-ring texture laziness (~767 MB
world-array boot baseline).

**Parity debts RESOLVED by user decision 2026-07-17: vehicle paint (16) CLOSED (user verdict — the
paint is good now) · map lighting (17) DEFERRED to the next iteration, not a pre-flip blocker (the
no-lamp-pool state is the accepted flip baseline).** Testing/bench knowledge extracted to
[docs/development/benchmarks.md](../../development/benchmarks.md) + the committed harness
`tools-debug/bench-harness/`.

## Handoff status (2026-07-14 — history)

**Done and field-confirmed today:** B5 vehicles · B5r reflections (SHIPPED but REJECTED — deep rework parked
in [16](16-vehicle-paint.md), do NOT retry by tuning constants: the engine has no tonemapper and no env probe,
prod has both) · B6 2dfx particles + textured coronas · **B7·a destruction objects** (shatter + topple as real
dynamic bodies + coronas die with the prop) · **B7·b animation objects** (garage doors, windmills, spinning
signs — no new engine machinery: an IFP's bones ARE the clump's frames).

**Ladder from here** — see [priority.md](priority.md):

1. ~~**B7·c UV-scroll animation** — [18](18-uv-anim.md).~~ **SHIPPED + FIELD-CONFIRMED 2026-07-15, CLOSED**
   (kind-4 objectTable draws + per-object cell uvAnim uniform; NO vertex-format growth; speed = prod-exact).
   Side change: opensa-pack `--clouds <dir>` retired → auto-detected from `--in <mods-src>/clouds`
   (the whole clouds stage + `--in` were later REMOVED 2026-07-17 with the painted panorama).
2. ~~**B7·d procedural clutter** — [19](19-procobj.md).~~ **SHIPPED + FIELD-CONFIRMED 2026-07-15, CLOSED**:
   host-generated + instanced (Option B), ONE memoized scatter drives render + colliders (re-enabled, cap 150) so
   they can't diverge; new engine `clutter` pipeline reusing the vehicle-model geometry. No reconvert. **Field
   fix that unblocked it (and 20):** the browser VFS (`asset-local-loader/build-vfs.ts`) only ingested IPL-placed
   models + peds/vehicles, so procobj species (scattered from `procobj.dat`, never placed) had NO DFF at runtime
   → clutter silently didn't render. `procObjModelRefs` now adds them.
   2b. ~~**B7·d breakable clutter** — [20](20-breakable-clutter.md).~~ **SHIPPED + FIELD-CONFIRMED 2026-07-15,
   CLOSED**: cacti/rocks/rubble shatter on a car hit (per-instance keyHash → `breakClutterInstance` degenerates
   the instance matrix); welded props unaffected; body count bounded. Same VFS fix above was the blocker.
3. **B6.5 map lighting** — [17](17-map-lighting.md). **UPDATE 2026-07-15: both symptoms EXPLAINED, bug left
   OPEN deliberately** while the user thinks over an architecture rethink —
   [concept/hd-realtime-lod-baked.md](concept/hd-realtime-lod-baked.md) (HD segment real-time light+shadows,
   opensa-pack bakes ONLY LODs, pipeline = full pmb chain incl. opensa-lod-generator; nothing scheduled).
   Patches = the UNCONDITIONED map (map-optimizer input fixes them); the Ten Green Bottles neon = pool
   hard-cut/no-sort + corona 350 floor (full diagnosis in the concept doc and plan 17). Do not fix piecemeal.
   3b. **map-optimizer normals batch** — queued by the user: map-optimizer plans 020 (preserve authored
   normals) · 021 (angle weighting) · 022 (two-sided groups, fixture-gated) · 023 (crease/weld knobs,
   fixture-gated) + opensa-pack plan 001 (missing-normals guard).
4. **09 COMPLETION — ACES + bloom + tiers (user decision 2026-07-15: the next engineering block).**
   The "graphics transfer" gap audit found most of prod-modern already landed or homed (HDR 16f ✅,
   MSAA4+A2C replaces SMAA ✅, godrays v1 ✅, LUT/config-API ✅, SSAO deliberately baked-instead) — the real
   gap is that [09](09-postfx-aa.md) is unfinished: **ACES tonemap and bloom are missing**, and ACES is the
   transfer curve the whole prod look is calibrated against. **RULE: no more look VERDICTS (plan 16 paint,
   plan 17 lighting, the HD-realtime concept decision) until ACES+bloom land** — every constant judged
   pre-tonemap is suspect (the B5r lesson generalized). Order inside: ACES (port the exact ACES_FILMIC
   curve, screenshot parity) → bloom (dual-filter, prod threshold + the 071 night profile) → tier knobs.
   Expected one-time cost: an env-constant re-judging round (sky/fog/moon were tuned against linear→sRGB).
   Budget already set: post chain ≤ 3 ms at 2× retina. Plan 16's first rung is this item — it unblocks
   vehicle paint automatically.
5. Then the WebGL-prod `?bench=all` baseline → the C1 criteria run → flip. **C2 cleanup stays GATED** on an
   explicit command.

**Standing debts before a parity sign-off:** vehicle paint (16) and map lighting (17) both look worse than
prod today. Two field-found prod-parity gaps pulled OUT of this chain into their own plans (2026-07-15), BOTH
SHIPPED + FIELD-CONFIRMED + CLOSED: [075 water SEA/INLAND classes](../075-water-body-classes/readme.md) (inland pools
calm + livelier ripple — no ocean waves/spillover) and [076 roadsign/billboard text](../076-roadsign-text/readme.md)
(2dfx type-7 text plates welded as unlit beam text). B7·d procobj + breakable clutter (19, 20) now SHIPPED +
FIELD-CONFIRMED. Back to the ladder: B6.5 map lighting (17) next.

**Tooling that earned its place today:** a slow-frame console log with per-block CPU timers in
`engine-canvas-host.tsx` (quiet on healthy frames). It ended a three-round guessing game in one reload — a
fixed-step catch-up spiral makes whatever is on screen look guilty.

## Handoff status (2026-07-12, end of the Fable session — history)

**The execution order lives in [priority.md](priority.md)** — milestones A (map deliverable) → B (player
in the world) → C (flip + endgame), each step with its plan link and a done-definition.

**Shipped & field-confirmed:** M0 (P0 gate) · M1 streaming core · effects ledger 06 = 12/14 (rows 1,2,3,6,
8,9,10,11,14 ✅; 4,5 sky/fog v1; 13 coronas v1 — textured sprites + 2dfx particles remain; 7 light pool
waits for M3 producers; 12 water user-deferred → ideas 0.5.0/01) · plan 07 closed (scalar sun-vis + AO
shipping; directional v2 built-and-reverted → ideas 0.5.0/03, prerequisite = receiver densification) ·
plan 12 built but UNSTABLE/default-off · reversed-Z engine-wide · plan 10 phase 1 (boundary audit, the
`opensa-engine.html` standalone boot in the web app, full-LS pak `?src=pak-ls`, range-read pak IO) ·
plan 11 harness + committed series incl. the three-engine comparison table.

**The integration queue (in order):** ① meshopt wire compression (+brotli; geometry = 82 % of the 1.15 GB
full-LS pak — the measured top lever) → ② bake worker pool + chunked welding (full-map convert; bakes = 91 %
of time, 16 GB heap held ONE city) → ③ capability-gated loader (the phase-1 page is its target) → ④ M3
dynamics (own IFP skinning probe FIRST — plan 08 schedules the risk early) → ⑤ water v1 for the game →
⑥ flip criteria (plan 10) → ⑦ cleanup (13) → ⑧ pmb + final measure (14).

**Parked with prerequisites written down:** directional shadows (ideas 0.5.0/03 — receiver-mesh
densification), weather wind (ideas 0.5.0/02), stochastic default-on (12 — histogram-preserving pass),
streaming create-budget tuning (05 — post-integration section).

**Test/verification state at handoff:** 61 tests green across engine-formats/engine/opensa-pack; golden
WGSL snapshots current; tsc + eslint clean; benches committed through the `city` full-LS run.

## Decision log

- 2026-07-11 — chain created; WebGPU-only; texture ARRAYS over atlases (GTA UVs tile — measured −7 % on atlases);
  two-level LOD system kept as-is (already cell-based; the converter only re-groups its output).
- 2026-07-11 (M0 build-out, session 1) — landed: `packages/engine-formats` (.oscell/.ostex/.ospak codecs,
  20 tests; vertex stride refined 40→36 B — layer+ao+emissive pack into one uint16x2 attribute),
  `packages/engine` (device/features, residency ledger, enumerated pipelines ×4 with compileAll + steady-miss
  assertion, WGSL store with include resolver + naga guardrails as unit tests + golden snapshots, cell store
  with per-cell GPURenderBundle record-at-load, sphere culling, MSAA4+A2C pass, GPU timestamps; 10 tests),
  `apps/engine-lab` (synthetic district fixture through the REAL format path, orbit camera, gate HUD; port
  4300). @webgpu/types added to the workspace.
- 2026-07-11 (M0 build-out, session 2) — synthetic FIRST LIGHT on M3 Pro: **submit 0.1–0.2 ms, GPU pass
  0.85–1.44 ms, 120 fps (vsync-capped), culling live** (04 ledger). Landed `tools/opensa-pack` (game-fs over a
  local dir, texture planner: opaque DXT pass-through incl. BC2 + alpha pipeline
  classify/dilate/premult/α-weighted-mips/coverage → RGBA8-in-M0, eager deterministic array bucketing; cell
  welder: transform-baked GTA→engine axes, groups per (array × class × side), timed/anim skipped+counted;
  convert orchestrator + CLI + report; 13 tests) and the lab's `?pak=1` mode (whole-pak fetch — the M0
  shortcut; worker range-reads are plan 05). Converter ran on the real LS
  district (rect 8,-9..11,-5): **P0 GATE PASSED** — 807 draws (~20× down), submit 0.2 ms, GPU 1.84 ms,
  instant load, **and the alpha-edge halo is DEAD (user-confirmed)** — the years-old open issue fixed by
  construction on first run. M0 ✅ → next milestone M1 (streaming proof, plan 05).
- 2026-07-12 (M1 build-out, session 1) — bench harness landed (074/11: `?bench=orbit|close|drive`, warmup 120 +
  measure 600, p50/p95/max, JSON download + `bench-compare.ts` with the >10 % gate; `docs/benchmarks/opensa-engine/2026-07-18-series.md` seeded)
  and the M1 streaming core: pak WORKER (bytes worker-side, transferable slices), thin driver (rings 380/1000 +
  hysteresis + atomic swap + ≤1 create/frame + eviction), manifest grew `cellSize`. Modes: `?pak=1&stream=1`,
  stress `&bench=drive`. Field drive bench:
  **M1 CORE GATES PASSED** — frame max 9.80 ms during active streaming (gate <20), worst cell create 1.1 ms,
  main-thread heap **8 MB** (vs GB on 073), 42 cells created invisibly at 120 Hz. Remaining M1: whip/teleport/
  soak scenarios + leak assertion (follow-ups). NEXT: M2 — world effects (plan 06 ledger order) + baked
  channels (07).
- 2026-07-12 (M2 slice 1) — effects rows 1-3 landed: frame UBO grew to 128 B (sunDir/sunColor/dn/split),
  world WGSL consumes normal + nightPrelit (per-vertex N·L + day↔night blend), converter synthesizes a night
  set (day × cool ambient) for geometry without one, `Engine.environment` API, lab `?hour=N`/`?daycycle=1`.
  Golden shader snapshots reviewed+updated (the mechanism works). Ritual run: effects cost ≈ FREE
  (drive GPU p95 1.77→1.84 ms, gate clean; series row added). Field screens exposed the LINEAR→sRGB output
  bug (world gamma-crushed dark): fixed by rendering into the swapchain's sRGB VIEW (viewFormats) + linear
  sky constants — the project's standing linear-space lesson, now encoded in `EngineDevice.colorFormat`.
- 2026-07-12 (M2 slices 2-4) — sky pass + unified fog (rows 4-5 v1, +0.39 ms GPU p95 ACCEPTED, fog-into-sky
  invariant field-confirmed on noon/dawn/dusk screens); REAL timecyc (row 14: converter embeds
  timecyc(\_24h).dat into the manifest, the lab samples with prod's own parser chain, `?weather=N`); night
  emissives (row 8: per-vertex luma-delta glow — lit windows/neon at night, ~free). Reconvert required
  (manifest grew timecyc).
- 2026-07-12 (07 v1) — baked AO/skyVis landed: district triangle BVH + 12-ray cosine hemisphere bake in
  `opensa-pack` (two-phase weld→bake→assemble; HD only, opaque+cutout occluders, unique-vertex dedup),
  stored in the reserved `layerChannels` low byte + `AO_SKY_VIS` bit (no format bump; byte 0 = unbaked →
  open, old paks render unchanged). WGSL modulates the INDIRECT term only via `env.aoStrength` (default 0.6;
  lab `?ao=N` A/B, `--no-ao` skips the bake). LS rect: bake 20.6 s, 12.5 M rays / 1.16 M verts, pak size
  unchanged. Reconvert required to see it; sun-vis + emissive-mask bakes remain (07 continues).
- 2026-07-12 (07 sun-vis v1) — baked static sun shadows landed (066/03 v1 scalar): elevation-weighted arc
  visibility per HD vertex (5 unique elevations of the fixed-azimuth parametric arc, disc-jittered pairs →
  baked penumbra, backface skip halves rays), stored in `normal.w` + `SUN_VIS` bit, gated per cell via
  `cell.origin.w` (no in-data sentinel — the AO byte-0 lesson). WGSL: direct term × sunVis; `?sunvis=N` A/B,
  `--no-sunvis`. Both bakes share ONE district BVH: convert 35.1 s total (AO 20.4 + sun 9.0). Under-bridge /
  canyon direct sun now dies at noon; the moving-sun directional bake is the v2 follow-up.
- 2026-07-12 (06 row 10 wind) — sway landed OFFLINE-first: converter bakes the final amplitude in METRES into
  nightPrelit.a (trigger = IDE IS_TREE/IS_PALM + plan-039 WIND_MODELS; per-vertex weights from wind-ADAPTED
  overlay DFFs via `--wind "mods-src/vegetation,mods-src/original/mods/21. Wind Project 1.0.2"`, height-above-base
  fallback for unadapted vegetation; the mods' shared `vegetation.txd` became a planner FALLBACK TXD — the
  offline twin of the installed txdp wiring). WGSL: two world-space sines phased by position, wind clock +
  strength in params2.zw, `?wind=N`. The overlay also swaps in the HD vegetation geometry: district verts
  1.16 M → 3.13 M, pak 99.5 → 245.7 MB, convert 92 s (bakes 81 s) — the price of the user's real build.
  894 k sway verts. v1 limitation: one sway speed for all kinds (no per-vertex speed byte).
- 2026-07-12 (06 row 9 objectTable) — timed objects land end-to-end: the welder no longer skips `time` defs —
  they weld into TRAILING `timed` buckets (sort key keeps equal (on,off) windows contiguous) and become
  objectTable entries (kind 0, params = on|off<<8, identity transform — instances are transform-baked like
  everything). The engine excludes object-owned groups from the recorded bundle and draws them after
  `executeBundles`, gated by the new `env.hour` (midnight-wrapping window; lab drivers feed the hour). Timed
  geometry is excluded from the bake occluder set (night windows are coplanar overlays; timed props are
  sometimes-absent). LS rect: 10 timed objects (night windows + scrapyard-style props return). Reconvert done.
- 2026-07-12 (06 row 11 beams + blend) — the last two pipelineClasses got REAL pipelines: `world-blend-*`
  (fsWorld, premultiplied (one, 1−src-α), depth read-only) and `world-beam-*` (new fsBeam: dn-mixed prelit
  tint × cone alpha from dayPrelit.a, no sun/glow, fog FADES the premult pair instead of tinting toward sky).
  fsWorld's fog term made premult-correct (sky × texel.a — opaque unchanged). Registry 5 → 9 pipelines, all
  behind the veil. LS rect exercises the blend pair (242 groups leave the cutout placeholder); beam groups =
  0 there — field verification waits for an SF stadium/airport rect. v1 limitation noted: cross-cell blended
  order arbitrary (class-sorted within a bundle only). No reconvert needed (classes were in the pak).
- 2026-07-12 (06 row 6 moon + doc sweep) — plan docs swept clean of Cyrillic (quoted field verdicts now
  paraphrased in English; user request). Moon landed: per-vertex WRAPPED N·L `clamp((N·moonDir+0.6)/1.6)`
  (the 073 formula), gated by the baked sunVis (static occlusion blocks moonlight too), added into the lit
  sum next to the sun term. Frame UBO 256→288 B (moonDir/moonColor vec4s). Lab drivers grew a moon arc
  (rises ~20:00, sets ~5:00, azimuth opposite the sun) with a dim cool colour gated by dn × elevation —
  black all day, so the day path is untouched. No reconvert needed.
- 2026-07-12 (07 emissive mask + moon disc + 0.5.0 stub) — three closers: (1) the emissive-mask bake landed —
  the night-window luma-delta detection moved OFFLINE into the welder (layerChannels high byte + EMISSIVE
  bit), WGSL glow consumes the mask when the cell carries it (cell.origin.w became FLAG BITS: 4 = 16-bit indices added by 074/22 for `cell-wire`; 1 sunVis,
  2 emissive; heuristic = old-pak fallback); LS rect 77.6 k masked verts, both paks reconverted. (2) The
  moon DISC joined the shared skyColorFor (smoothstep disc + faint halo on moonDir; moonColor black by day
  keeps day frames untouched, and fogged geometry dissolves into the moon behind it — the 068 invariant).
  (3) Weather-driven wind DEFERRED to 0.5.0 by user decision — idea stub at
  docs/roadmap/0.5.0/plans/02-weather-wind/.
- 2026-07-12 (plan 12 added) — stochastic texturing researched against the JuniorDjjr skygfx fork (shader =
  Deliot–Heitz 3-tap tiling-and-blending with ddx/ddy, selection = CURATED texdb name list — editorial, not
  inferred). Both blockers that parked improvements/stochastic-texturing die in this architecture: selection
  moves offline into the converter (name list + optional auto-candidate analysis), and the DXT/LUT conflict
  is moot (v1 needs no LUT; the tool already owns full texel processing for the upgrade). Flag rides bit 15
  of the layer u16 — no format bump. Plan doc: 12-stochastic-texturing.md.
- 2026-07-12 (12 v1 shipped + field-accepted) — stochastic de-tiling landed end-to-end: curated
  `data/stochastic.txt` + the skygfx mod's full `texdb.txt` (user-supplied, 307 tagged names) MERGED as
  default sources; planner → layer-u16 bit 15 → WGSL 3-tap `textureSampleGrad` behind a per-vertex flag
  (sample-then-override keeps the common path uniform); `?stoch=0` A/B via the spare moonDir.w. Round-1 field
  miss (LS beach = `sandnew_law`) produced the curation loop: `stochastic-candidates.ts` ranks a rect's
  textures by covered area and prints unlisted ones. LS 172.8 k flagged verts. User accepted v1 as-is;
  the ritual bench row is still owed (more flagged pixels now — watch the +0.5 ms gate).
- 2026-07-12 (06 row 13 v1 coronas) — the format's dormant light table came alive: the welder transforms
  every instance's DFF 2dfx corona anchors into cell-local engine coords (HD cells only — LOD would double
  lamps; LS 2,426 / SF 1,084 anchors), the engine draws ONE instanced additive billboard pass after the sky
  (unit quad + CPU-filled instance buffer capped at 2,048; procedural radial glow — particle.txd sprites
  later; depth-read so geometry occludes coronas; night gate dn×1.5; farClip fade with a 350-unit floor for
  the high lab camera — the game integration restores authored clips). Registry grew to 10 pipelines.
  Remaining in row 13: textured sprites (coronastar/coronamoon) + 2dfx particles (factory smoke/fire).
- 2026-07-12 (07 sun-vis v2 directional) — the moving-sun static shadow landed (066/03 v2): the bake finds a
  per-vertex THRESHOLD elevation (8-sample ascending scan, disc-jittered) + penumbra softness; runtime is one
  smoothstep against the current arc elevation (spare sunDir.w) — shadows recede/grow with the sun, no map,
  no jitter. Threshold lives in normal.w (/1.1 encoding, 1.1 = never lit), softness in layer-u16 bits 8–14.
  Moon now gates on noon visibility (open-sky proxy). v1's scalar average is superseded; both paks
  reconverted (LS bake 38 s / 27.5 M rays).
- 2026-07-12 (07 v2 revert) — directional sun-vis was built, field-tested and REVERTED the same day: on
  SA's metre-sparse receiver meshes, threshold shadows lose narrow occluders entirely (a bridge falls
  between road vertices), punch holes and darken LODs — five noon field screens documented in plan 07.
  The accepted scalar v1 consumer is restored; the round's KEEPERS: wire/sliver occluder filter, LOD-cell
  baking (kills HD/LOD shadow seams), zenith-converging sun arc (noon shadows sit under bridges), and the
  known-limit note that small-object shadows need texel-space baking or the dynamic near cascade. v2
  un-parks when the converter learns receiver subdivision (pmb-grade).
- 2026-07-12 (field cleanup round) — three fixes from the noon/night reports: (1) stochastic texturing
  marked UNSTABLE and default-OFF (`Environment.stochastic = 0`, `?stoch=1` A/B; data stays flagged) —
  grazing-angle ghosting joined the structured-texture scrambles; finish = histogram-preserving pass.
  (2) LOD bake artifacts capped: LOD ray push-off 0.6 → 1.0 + result FLOORS (sunVis ≥ 0.4, AO ≥ 0.5) —
  LOD self-shadow noise bounded while the HD/LOD seam stays soft. (3) REVERSED-Z landed engine-wide
  (depth32float, swapped near/far projection, clear 0, `greater` compares; blended classes get
  `greater-equal` so exactly-coplanar overlays — night windows, wall signs — composite stably): the
  systemic fix for the sign z-fighting and flickering tobj windows.
- 2026-07-12 (10 phase 1 + full-LS numbers) — the integration track opened: boundary table audited against
  code; the FULL-LS scaling measurement landed (pak 1.15 GB = 82 % GEOMETRY / 18 % textures → priority
  inversion: meshopt wire compression + bake worker-pool before any BC work; V8-Map-cap gotcha fixed with
  per-cell bake caches); the streaming driver graduated from the lab into `packages/engine/src/stream/`;
  and the first own-engine boot INSIDE the web app shipped (`opensa-engine.html`, free-fly over full LS,
  `?src=pak-ls`). The lab also streams the whole city now (`?src=pak-ls`). Bench JSON carries converter
  metrics (plan 11 task closed).
- 2026-07-12 (session close: plans 13/14 + handoff) — the chain gained its endgame plans: 13 post-flip
  CLEANUP (user decision: after a successful integration the old graphics DROP entirely — three-WebGL path,
  the 073 debug-flag zoo, three/babylon/postprocessing dependencies; supersedes flip criterion 4's WebGL
  fallback) and 14 PMB INTEGRATION (opensa-pack becomes a perfect-map-builder stage — wind/stochastic/
  subdivision data move into pmb config — plus the exit-exam measurement: full modded map, all profiles,
  60 fps verdict). Fixed open-issues moved to docs/open-issues/fixed/ (alpha-edge, ghost-barriers,
  lod-2dfx-particles — the latter two root-fixed by perfect-map.asi). A "Handoff status" section snapshots
  the resume point.
- 2026-07-12 (sky day, evening close) — the sky became REAL: row 4 ✅ (Preetham dome as a CPU-built 96×48
  LUT shared by sky AND fog — the 068 invariant by construction; env gained cloudCover/cloudDark/skyMood),
  row 16 ✅ (procedural starfield, second audit gap — found by the user's question), structured sun
  (disc + corona + circumsolar + haze; deliberate HDR overshoot that plan 09's bloom/god-rays will consume),
  dn night-blend (Preetham has no night model — the post-sunset horizon glow fix), and the TRUE east→west
  sun arc (runtime + standalone + the sun-vis bake's morning/evening ray pairs with a per-ray facing test).
  Also this evening: wire compression stage 1 (2.3–2.6×, deflate-raw + range-aware entries), the streaming
  revisit-lifecycle fix + whip/teleport/leak stress suite (leak PASS; whip heap 736 → 55 MB after the
  stale-blob backpressure fix), the lab WASD focus pan, and plans 13/14/15/16-rows + priority.md for the
  Opus handoff.
- 2026-07-12 (night field round: transparency + missing-object root causes) — three fixes off the user's
  screenshots, ALL AWAITING THE NEXT RECONVERT (converter-side; the engine sort is live immediately):
  (1) TWO-PHASE frame — every cell's opaque bundle, then sky, then every cell's blend bundle (cells now
  record separate opaque/blend bundles): a later cell's opaque could repaint an earlier cell's canopies
  (the "not quite right" screenshots), and the engine now also sorts blend bundles back-to-front by cell distance.
  (2) MISSING OBJECT solved — the "blue hole" at GTA (804, −1619) was `burger01_LAw`, a 22×35 m diner in the
  IDE **anim** section (its sign spins), and the welder SKIPPED all anim defs; the earlier "skipped-animated
  are all signs" reading was wrong. Anim defs now weld STATICALLY at bind pose with the frame chain applied
  (`frameWorldTransform` — the weld path had ignored RW frames entirely; identity for static DFFs so nothing
  else moves; report stat `animatedStatic`). Runtime IFP animation = a later dynamic-entity feature (row 17).
  (3) FOLIAGE → CUTOUT — trees-through-trees was blend-classed canopies writing no depth: `classifyAlpha`'s
  2 % mid-alpha bound mis-classes scanned foliage skirts; the welder now passes `preferCutout` for
  sway-kind (vegetation) defs, upgrading softBlend → cutout (vanilla SA alpha-tests foliage; our
  A2C + MSAA + coverage-preserved mips are the modern equivalent).
- 2026-07-13 (night-fix reconvert + A1 meshopt wire) — all three paks reconverted with the night fixes
  (`pak` 93.9 MB / `pak-sf` 52.3 MB / `pak-ls` 497.5 MB, full-LS 939 s; `animatedStatic` 0/1/4 — the
  burger01_LAw diner and three siblings weld again; field verdict pending). Then integration-queue item ①
  landed: meshopt wire compression (`.oswire` container + `enc: 'oswire-deflate-raw'`, worker-side meshopt
  decode via `meshoptimizer/decoder`, old paks stay readable) — ls-bench pak 93.9 → 68.9 MB, cell geometry
  4.23× over raw (deflate-only was ~2.4×), worst-cell decode NET FASTER (18.7 vs 24.9 ms, worker-side);
  numbers + the triangle-rotation safety note in the 14 ledger. Brotli consciously skipped (no
  DecompressionStream support; serve-time `Content-Encoding: br` remains available).
- 2026-07-13 (field round: hipoly stipple + bakes opt-in) — trees/diner field-CONFIRMED (night fixes hold);
  new report: `tree_hipoly07`-class trees semi-transparent at range = the preferCutout upgrade meeting
  BROADLY semi-transparent mod-canopy alpha (α≈0.5 everywhere → A2C = uniform screen-door). Fix: offline
  alpha SHARPENING (gain 8 around ref 128, before premultiply so RGB scales by the remapped alpha) applied
  ONLY to upgraded softBlend→cutout textures — natural cutouts untouched. Same round: heavy bakes went
  OPT-IN (`--bakes`, plan 03 note) — bakeless full-LS convert 31.8 s vs 939 s; bench/production converts
  must re-enable. A1 gate CLOSED with the measured full-LS wire: 497.5 → 311.2 MB. Bench row A1·meshopt
  accepted (GPU p95 +6 % vs 06·wind, inside gate; submit untouched — decode worker-side).
