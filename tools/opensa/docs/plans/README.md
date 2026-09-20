# Plans index

The map of planning docs across the repo. **Engine plans live here and nothing else does** (the user's call,
2026-08-20) — one numbered folder per plan (`docs/plans/NNN-*/readme.md`, multi-part plans add sibling files
inside their folder). **Every toolchain plan lives beside its tool**, in `tools/<tool>/docs/plans/`, even when
its work spans several tools: it goes in the chain of the tool whose RULE it is, and its row there names what
else it reaches. Plans 102 (added vehicles → `tools/add-vehicles`) and 103 (one owner per archive entry →
`tools/img-splitter`) moved out on that rule. The **offline tools** therefore keep their own `docs/plans/` (so does the headless harness,
`tools-debug/bench-harness/docs/plans/`; a debug INSTRUMENT's plan sits beside the tool whose code it reuses —
`model-repack.ts`'s LOD half is `tools/opensa-lod-generator/docs/plans/007`). Open questions and parked
ideas live in [`../open-issues/`](../open-issues/) and [`../ideas/`](../ideas/).

> **Before writing one, check [`docs/restrictions/`](../restrictions/README.md).** It holds the rules a
> design has to satisfy — layer boundaries, format ceilings, engine splits, what is decided at build time and
> cannot be re-taken at runtime — and says for each whether a violation is caught or is SILENT. A doc that
> violates one is not ambitious; it is a doc that gets rewritten after the first build.

> The [Nx monorepo migration (plan 057)](./057-nx-monorepo-migration/readme.md) will move each tool's `docs/` under
> `tools/<name>/docs/` — update the links below when it lands.

## Engine (`docs/plans/`)

Core runtime + RenderWare parsing, world streaming, rendering, characters, vehicles, physics, UI. Upstream's
chains run `001`–`101`, one folder each (066, 073, 074, 078–082, 096–101 carry multi-part sub-plans; 083 kept
its row but its chain was superseded by 097); **this fork's own chains live in a `2xx` block of their own**.
Newest first:

> **WHY THE FORK NUMBERS FROM 200.** For two days three numbers meant two things here: the fork and upstream
> both numbered forward from 096 without knowing about each other, so `097`, `098` and `099` each named two
> unrelated chains — upstream's (CLEO, land vehicles, script-object UV animation) and this fork's. The
> folders were distinct and nothing was lost, but every bare citation was ambiguous, including the one
> `CLAUDE.md`'s reading order makes. Renumbered 2026-08-08 into a block upstream will not reach:
> **`200-platform-reach`, `201-dispatch-console`, `202-pcad-dispatch`** — the same chains, the same steps,
> new numbers (`098/1-01` is now `201/1-01`). Anything the fork adds continues from `203`.

### The fork's block (`2xx`)

- **[202 — PCAD Dispatch](./202-pcad-dispatch/readme.md)** — **THE FINAL PLAN**, opened 2026-08-06. The
  product every dispatch doc here now serves: a **web dispatch application for a SA-MP server**, paired with a
  client-side CAD plugin (PCAD). Three pieces — the plugin, a backend, and the web application — of which this
  repository owns exactly one thing: **the 3D map component**. The field survey behind it, **as corrected
  2026-08-26**: [SonoranCAD](https://sonorancad.com/fivem) ships a **3D live map** and
  [SnailyCAD](https://github.com/SnailyCAD/snaily-cadv4) a flat one — so "nobody has the world" is retracted
  and this row must not be quoted for it. What survives is narrower and holds: both are **FiveM**, and
  **nobody serves SA-MP** (re-checked 2026-08-29 by running the field); nobody has a **total-conversion**
  world; and nobody makes the map **the main screen**. Carries the borrowings from the open-source map
  engines (screen-space-error LOD, time as an axis, label collision, layer models, the SanMap projection), the
  three seams and who owns them (self-reported positions are **claims**, not facts), five delivery phases
  starting with the engine, and the honest statement that the four named budgets may not hold at once.
  [201](./201-dispatch-console/readme.md) is subordinate to it.
- **[201 — The dispatch console](./201-dispatch-console/readme.md)** — IN PROGRESS, opened 2026-08-06. The
  engine's second consumer, declared: a CAD operator surface over the streamed world, trimmed to what it
  actually draws, on a phone. `apps/dispatch` arrived in one commit with one write-up and no plan, no roadmap
  row and no line in [project-goals](../project-goals.md) — while being the only surface in the repo that runs
  on a mobile GPU, and therefore the cheapest instrument for the device measurement 200's phone-side steps are
  blocked on. Five chains: the map profile (cut what is provably never read — cars, peds, vegetation sway, the
  day cycle and the weather are protected, and one engine serves PC and mobile), real device truth (the repo's
  first real-world mobile row, handing 200/1-04 the residency ceiling it refused to invent), the operator
  surface at 360 CSS px, render-on-demand for a console that idles most of a shift, and picking taken off the
  `debugPicking` flag it stands on today. A requirements round on the same day added three more: **three
  display modes** (live render / a baked 3D city map / flat 2D tiles — two thirds of which already exist
  unrecognised, in `opensa-lod-generator` and `plan-mode.ts`), **the operator's map** (orthographic mode,
  flyTo, follow, bookmarks, minimap, measuring, drawing, keys, embedding) and **the time axis**, moved forward
  from 0.6.0 because where time lives in the data model is cheap now and a rewrite later. Owns none of 200's
  work and duplicates none of it.
- **[200 — Platform reach](./200-platform-reach/readme.md)** — IN PROGRESS, opened 2026-08-04. The world on a
  phone, and the frame off the main thread. A phone boots the engine and cannot open the world, because a pak
  built from SA assets is BC throughout and no mobile GPU has BC — a build-time content decision no runtime
  relaxation can undo. Five chains: device truth, universal textures, off the main thread, mobile runtime, and
  a concept-gated WebGL2 fallback; two of them wait on live concepts
  ([universal transcode](../postmortem/universal-texture-transcode.md),
  [WebGL2 backend](../concepts/webgl2-fallback-backend.md)). Landed so far: the world's GPU demand read from
  its manifest before anything streams, the build-time `--platforms` gate over BOTH halves (pak arrays ∪ model
  dictionaries), and the `--rgba8` defect that gate found — it converted the world and left every car BC.

### Upstream's block

Newest first:

- **[104 — `timecyc24h.dat` as a third timecyc source](./104-timecyc24h-source/readme.md)** — **IN PROGRESS
  since 2026-08-22** (planned 2026-08-21): the built tree carries three timecycs and the engine reads two
  names. The second recon settled what the first one framed as a format question — **there is no second
  format.** Two 24h plugins exist (`timecyc24h.asi` by Dante, `timecycle24.asi`), each hardcodes ONE file
  name (`timecyc24h.dat` / `timecyc_24h.dat`, the only such string in either binary), and the `.dat` that
  ships with the second one is the same 23 × 24 × 52 schema as Dante's. Swapping the files fails because the
  plugin never finds its name and silently keeps the stock table — not because anything fails to parse. So
  the parser needs nothing and the three loaders need ONE resolver with the order `timecyc_24h.dat` →
  `timecyc24h.dat` → `timecyc.dat`. What the recon found on the way: our generated `timecyc_24h.dat` shadows
  the mod under that order AND is 504 rows where the format is 552 (it drops both extracolour weathers);
  it carries the stock `RAINY_COUNTRYSIDE` 20h corruption Dante's file does not; Dante authors negative
  `FogSt` on 243 of the 504 rows we sample (min −1 700) that the driver floors at 0 — step 04 recovers SA's
  meaning first; and the parser's "byte-for-byte vs the reference tool" test compares `convertTo24h` against
  a fixture generated by `convertTo24h`.
- **[101 — Escalators in OpenSA](./101-escalators/readme.md)** — **PLANNED 2026-08-07**: the steps have
  never moved in our engine. `renderware` decodes the type-10 entry (plan 044) and there is a debug waypoint;
  `engine`, `cell-weld` and `engine-formats` have no escalator code at all, so the staircase draws and
  standing on it does nothing — a gap against the original, which implements them natively. Split out of
  plan 100, which carries the 2dfx types our engine already consumes and cannot carry this one because the
  behaviour does not exist. Step 00 is research first: recover SA's own step spacing, speed and carry rule
  (and find out whether the steps are objects or a texture scroll — if the latter, plan 099's UV lane may
  already do it) before any constant of ours is fitted. Corpus is 5 entries in 4 models, fully enumerable.
- **[100 — 2dfx survives to LOD range](./100-2dfx-at-lod-range/readme.md)** — **🔒 CLOSED 2026-08-08** — all
  five steps shipped that day (planned 2026-08-07) and the field check ran on the pak built after them; the
  2026-08-12 sweep added the banner and corrected the one verdict row that still read NOT CLOSED (the
  `insects` floor was field-judged the same day, in its hack file, with a positive control). Steps moved into
  [lod-common/007](../../tools/lod-common/docs/plans/007-2dfx-space-and-cell-carry.md),
  [opensa-lod-generator/006](../../tools/opensa-lod-generator/docs/plans/006-cell-bake-carries-effects.md) and
  [sa-lod-generator/007](../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md); 03 and 04 stayed
  central (`cell-weld`/`opensa-pack` and `apps/web` keep no plan chains). Chimney smoke, street lamps and
  street-name plates died at the HD boundary (`HD_RADIUS` 380), so a district past ~440 u drew to 1000 u dark,
  smokeless and unsigned. Both LOD generators now bake the three types that have a consumer (0 light,
  1 particle, 7 roadsign) and `cell-weld` reads what the cell bake produces — the half that makes the other
  half real. The flat `DRAW_DISTANCE = 300` is gone; every fx system takes its authored `cullDist` bar two
  recorded departures. Step 00 is the research: it began as a killed plan (postmortem) and was revived the
  same day by a reversed decision. The six types our engine does not consume (16 934 stock entries) stay out
  of the OpenSA line — escalators among them, because our engine has no escalator code at all, while real SA
  implements them natively and the SA clones keep carrying the entry. **Three things the chain measured that
  its plan had not**: a plate's world position lands outside its instance's own cell 131 times in 489 (so LOD
  roadsigns come from the world-keyed pre-pass, not the LOD model, or they double across cell keys); the bench
  cannot see emitter cost at all (proven by a positive control, not assumed); and 05 fixed nothing that was
  broken — its premise that the decimate path lost emitters was already false.
- **[099 — UV animations on script objects](./099-script-object-uv-anim/readme.md)** — **DONE
  2026-08-07** (planned 2026-08-05 from the 097/07 field bug round): the ferris wheel's blinking bulbs
  are a UVAnimDict step animation (`f13d`, a 13-frame film strip stepping every 0.225 s) that the
  world's kind-4 lane already played but the rigid/script-object path ignored. Baked the animation
  through (builder → `.osm` fixture, model-local list + per-submesh slot), added the rigid UV-anim lane
  (per-model uniform, identity slot 0, dynamic offsets — unbundled draws, so no bundle staleness; zero
  allocation and zero per-frame writes for models without animations), and the user's own rebuild +
  field run closed it: **the wheel blinks**. The edge-cases row is removed — the limitation is lifted.
  **🔒 CLOSED 2026-08-12** with the numbers it owed: observed cadence **0.225 s exactly** (130 strip steps
  across the 29.25 s loop, off the built fixture), advance **132.2 ns/call** + one 16-byte write, and a
  recorded sweep ([`2026-08-12-ingame-uv-anim-lane-guard.json`](../benchmarks/opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json)).
  The before/after frame delta is NOT obtainable — the pre-change engine cannot render the 2026-08-11 pak,
  both sides of the commit pair failing identically — so the chain closes on a stated bound instead: one
  integer compare per rigid submesh bind, nothing else, for a model that animates nothing.

- **[098 — All land vehicle types](./098-all-land-vehicles/readme.md)** — **PLANNED 2026-08-04**,
  supersedes `roadmap/0.5.0/plans/04-all-vehicle-types/` (deleted). Rewritten from a four-way recon
  (data pipeline / physics / animation / docs) + the `NO_COMMIT/all-veh` corpus (the VSA Editor's
  15-class special-ability catalogue; a control mod car). The recon overturned the old chain's two
  pillars: 081/07's class-preset seed shipped EMPTY by measurement, and bikes fail on NAMES and
  PLUMBING before physics — `wheel_front`/`wheel_rear` match no regex (zero wheels baked), the 13 `!`
  bike-handling rows and the 30 `^` anim-group rows are parsed away, the ride IFPs sit in the
  deliberately-unexpanded `anim/anim.img`, and the repo contains ZERO Rapier joints (trailer hitch is
  greenfield). Thirteen sub-plans (11 CLOSED 2026-08-07; 09/10/12/13 added from field rounds and a clip census;
  re-sequenced 2026-08-20), six field checkpoints (it rides → it looks ridden → it tows → it
  bounces → the rider DOES the wheelie → each car class boards as its handling row says): data foundations → features module (pop-up lights generalised into a token registry —
  hydraulics, hooks, moving `misc_*` parts become data) → two-wheel balance controller on the authored
  `!` rows → rider animation → first joints/towing → abilities → per-class gameplay → audit close-out.
  Air/water/rail findings parked in `roadmap/0.6.0/plans/05-air-water-rail/`.

- **[097 — CLEO basic](./097-cleo-basic/readme.md)** — **CLOSED: 01–08 DONE 2026-08-06** (all three field checkpoints — the wheel spins, the corpus ships through pmb + fetch pack with nothing hand-placed; 07 closed with the tracer, the F2 CLEO screen, tiers-as-data + CI joins, audit + benchmarks, and CLEO is ON BY DEFAULT — `?cleo=0` opts out; 08 authoring SDK executed as the project-local chain `cleo/sdk/docs/plans/` — hello-conformance proven on BOTH runtimes, real CLEO included; **its plan file was deleted from this folder 2026-08-12** as a duplicate of that shipped chain, so 097 now holds the ENGINE side only and has zero open boxes), supersedes the deferred
  `roadmap/0.5.0/plans/08-cleo-basic/` chain (deleted; it was the unstarted 083 rethink). Rewritten from a
  full recon: all seven target `.cs` scripts (`NO_COMMIT/cleo`) were disassembled — three mod classes
  (world objects / vehicle-part animation via native calls / ped-task orchestration), ~116 unique opcodes,
  and a native surface of only ~15 SA 1.0 addresses. CLEO becomes its own layer (`packages/cleo`:
  core decoder / VM / host contract / **native atlas** — memory and exe calls served as an
  object-capability facade over `VehicleHandle`, not byte emulation). Seven sub-plans with three field
  checkpoints (wheel spins → ladder/door/tracks → full build); also fixes mod-installer's silent `.cs`
  deletion on the bake path. Dedicated tooling sub-plan: `scm-disasm` / `cleo-census` / `cleo-run`.

- **[096 — Video mode](./096-video-mode/readme.md)** — **SHIPPED 2026-07-30/08-01, all eight phases**
  (road graph + seeded routes, autopilot, director + shot table, surveyed tripod stations, the region
  sequencer, the build-time mod-car ledger, the walk + flythrough scenes that complete D3's program, and the
  close-out: [audit](../audit/video-mode-096.md) + [benchmark](../benchmarks/opensa-engine/2026-08-01-headless-video-mode.json),
  a 32.7-minute unattended soak of 40 scenes with **0 throws and no drift**, and a per-frame cost of
  **0.0096 ms** — under 0.2 % of a 120 Hz frame. **Field-accepted 2026-08-01**: the user watched the walk and
  flythrough scenes and they look good, which is the one acceptance a headless run could never give).
  Planned the same day it was researched and graduated from
  `docs/ideas/video-mode/`; the user's decisions live in the readme's D-table, with three of them REVISED
  on 2026-07-31 — each revision written into its own row rather than over it. `?video=1` boots a bounded
  seeded self-directed showcase for trailer recording (scenes 1…100 of the seed, five cameras each): a random car (the build's OWN mod cars when it has any, via a new
  build-time `vehicle-installer` ledger) cruises a route generated from the game's own `NODES*.DAT`
  graph while cameras cut between occlusion-checked tripod stations and chase/front/rear/wing shots;
  walk and flythrough scenes; region cycle LS→LV→SF→Country→Desert; region-native weather, debugger
  time slots, black overlay between scenes, UI hidden. Eight phases, P0 = path graph + a closed-loop
  `PathFollowSource` autopilot on the shipped `InputState` path (the `?phys=` runner is the skeleton);
  the two field risks are autopilot cornering and cut flicker (the 080 multiray lesson). Deliberately
  NOT named "cinematic" — that is plan 080's word.

- **[095 — DFF geometry parity](./095-dff-geometry-parity/readme.md)** — SHIPPED 2026-07-30. Two converter
  bugs behind one field report ([forensics](../open-issues/fixed/mod-dff-winding-and-atomic-frame.md)): we
  built triangles from the Geometry Struct FACE ARRAY while RenderWare draws the BinMeshPLG index data (a
  mod's `roads32_law2` wound the two oppositely → the beach slab faced down and back-face culling deleted it,
  collision intact — the "blue strip"), and we applied the atomic's own frame transform, which
  `LoadAtomicFile` throws away for a simple map model (a mod's `land_42_sfw` rotated 90°, and 165 vanilla
  `aw_streettree1` had been sunk 3.1 m all along). Blast radius measured over all 13 003 archive DFFs: 5
  geometries change winding, 16 lose face-array faces the game never drew, 24 shift a few triangles between
  materials. Kept: `scan-geometry-parity.ts`, two new restriction entries, the stock-ADC (`bloodrb`/`rccam`)
  guard.

- **[094 — sa-map-viewer](./094-sa-map-viewer/readme.md)** — SHIPPED 2026-07-30 (phases 0–7; audit in
  [`audit/sa-map-viewer-094.md`](../audit/sa-map-viewer-094.md)). A standalone app rendering the map
  straight from a folder of ORIGINAL SA files (FSA picker or served dir): browser weld → the engine's
  own cell path, the debugger's `MapInspector` as a permanent panel, the map-viewer hand camera
  (pan/orbit/dolly) with fully param-specified scripted poses (no self-moving orbit — the blue-strip
  lesson), click-to-pick, model search with autocomplete that centres + activates the cell (the same
  search added to the in-game debugger via the `MapGame` contract), and the sea with a toggle. Its
  first field use bisected [`open-issues/fixed/mod-dff-winding-and-atomic-frame.md`](../open-issues/fixed/mod-dff-winding-and-atomic-frame.md),
  the issue it was born from, down to one placement.

- **[093 — The world ambient term](./093-world-ambient-term/readme.md)** — **CLOSED 2026-08-01**, field-confirmed
  for BOTH day (07-29) and night (08-01); nothing owed.
  SA's own building formula (recovered from SkyGfx's PS2 pipe + gta-reversed) adds
  `timecycle ambient × surfAmb` ON TOP of the day/night-blended prelight — an additive,
  normal-independent floor our `worldShade` never had. Without it every black-prelit vertex renders
  pure black, and the class is vanilla-wide (2 243 models, 125 of the worst 186 are stock SA — shadow
  was AUTHORED as black, trusting the renderer's floor). Engine half of map-optimizer plan 024;
  field-proven per-model with `model-repack.ts --prelit-floor` before a line of engine code changed.

- **[092 — Alpha classification: the cutouts that are not vegetation](./092-alpha-cutout-classification/readme.md)** —
  PLANNED 2026-07-29. The Watts Towers (`wattspark1_LAe2`) show their far side and the towers behind through
  the near one: their lattice textures carry **23.55 % mid-alpha** against `classifyAlpha`'s 2 % cutout
  bound, so they class `softBlend` → pipelineClass 2 → `world-blend-*`, which writes no depth. Identical to
  the trees-through-trees bug 074 fixed — except the fix upgrades softBlend → cutout for **vegetation defs
  only**, a rule that reads the slot instead of the asset. Census: 40 230 textures → 2 541 softBlend, of
  which 350 are true glass that must not move. **CLOSED, all four phases in one day.** The rule reads the
  histogram against the alpha TEST vanilla applies (`below ≥ 5 % ∧ above ≥ 5 % ∧ near ≤ 10 %`, the knee of
  the measured distribution) and moved **1 602** textures out of the blend pass; the pak ships 1 422 cutout
  / 661 soft-blend. The overlay class the texture cannot see is gated by `NO_ZBUFFER_WRITE`, **not**
  `DRAW_LAST` — the join found 1 359 DRAW_LAST defs on flipping txds and they are the TREES — and the
  reversed source later CONFIRMED that gate: SA answers a no-z-write model with alpha reference 0. Field:
  towers fixed, canopies and glass clean, sweep unchanged. Debt:
  [`hacks/alpha-mask-thresholds.md`](../hacks/alpha-mask-thresholds.md).
- **[091 — Frame-time attribution](./091-frame-time-attribution/readme.md)** — SHIPPED 2026-07-28, all three
  phases, no fix written. The `[slow]` line's `other` was a RESIDUAL holding two different things: untimed
  in-loop work, and everything the browser did BETWEEN frames — which **no in-loop timer can see**, and where
  a resolved spawn is paid. Phase 1 timed the four remaining in-loop groups (all ≤0.2 ms) and fixed two
  defects in the line itself: it mixed two intervals (a 25.1 ms block inside a 21.6 ms frame, residual −7.2)
  and it printed the 250 ms `dt` CLAMP, so the worst frame in the record read 250.0 when it was **576.1**.
  Phase 2 added a frame-span recorder (`packages/engine/src/debug/frame-spans.ts`) that between-frame work
  reports itself into. **Result: the spikes survived the `vehicle-model-builder` deletion, and the
  gameplay-relevant cost is per NEW car type — `.osm` parse worst 20.5 ms (`bus`) + GPU upload worst 18.2 ms
  (`tahoma`), ~25 ms in one frame; `unattributed` still holds 40–55 % of a spike and is GC-shaped.** Phase 3
  names the levers and waits on a field verdict.
- **[089 — Vehicle particles](./089-vehicle-particles/readme.md)** — CLOSED 2026-07-28, all five steps in
  one day (six field rounds): the dynamic one-shot particle lane + the engine's first DECAL lane, then
  tyre smoke, severity-darkened 12-real-second skid marks, impact smoke off the damage gate, and surface
  dust/sand by surfinfo's own `W_*` flags. Zero measurable sweep cost; every look number a documented
  eye-fit (`CFx` is stubs in gta-reversed). Audit:
  [`docs/audit/vehicle-effects-089.md`](../audit/vehicle-effects-089.md).
- **[088 — Ped locomotion feel](./088-ped-locomotion-feel/readme.md)** — SHIPPED 2026-07-24, both
  rounds: turn-rate heading + plant, crossfades with phase carry, walk/run/sprint tiers + cycle-speed
  sync, the jump/fall FSM (coyote/buffer/anticipation), impact-tiered landings, a real slope slide,
  and vehicle ingress/egress realism (root-motion slides, passenger door + shuffle, blockage-probed
  exit chain, overturned crawl-out, door choreography). Audit: `docs/audit/ped-locomotion-feel.md`.
- **[087 — The gostown field round](./087-gostown-field-round/readme.md)** — the first TC's field-bug
  batch after its first full boot (bridge at LOD range, missing island chunk + floating tree, black
  water stripes); same symptom→bytes method as 085.
- **[086 — One build, consistent names, pak-based fetch](./086-unified-build-naming-fetch/readme.md)** —
  `game-src/<id>` · `mods-src/<id>` · `build/<id>` naming unification (`original`→`original`,
  `build/original`→`build/original`), pak manifest identity, the fetch-pack finishing tool replacing
  `build-game.ts`, the fetch client booting the pak, TC trial runs (gostown/carcer/anderius).
- **[085 — Map-object appearance](./085-map-object-appearance/readme.md)** — the 2026-07-22 field round
  (after vehicles, before peds): rows A–G SHIPPED and field-confirmed — the night emissive mask went
  per-channel (the luma delta systematically killed saturated neon: the LV strip's red rope lights never
  glowed), missing textures render vanilla grey, additive neon adds light, night-only timed models run
  fullbright. **🔒 CLOSED 2026-08-12** on row H's field verdict — the additive-class narrowing (`classOf`:
  class 4 only for alpha materials) was verified in the pak bytes and then driven at the Old Venturas Strip
  entrance at night: no see-through, solid facade.

- **[084 — Vehicle appearance and dynamic-model lighting](./084-vehicle-appearance/readme.md)** — the 2026-07-20
  field round: wheel-side/scale conventions and the flat dynamic indirect term SHIPPED (with measurements);
  open = night level vs the map, reflections (floor vs prod-style presets — DECISION NEEDED) and AO for
  dynamics. The perf row is CLOSED (2026-07-21: it was mod vegetation, not vehicles). Peds share the
  row-B root.

- **083 — Basic CLEO support** — moved to 0.5.0 on 2026-08-01 unstarted, then **SUPERSEDED by
  [097](./097-cleo-basic/readme.md) on 2026-08-04** (the roadmap chain was rewritten against a full
  corpus recon and pulled back into active work; its folder is deleted). Promoted from ideas/0.4.0/04.
- **[082 — Vehicle license plates](./082-vehicle-plates/readme.md)** — per-instance city-correct plates on
  the array-based engine: plate atlas array + per-instance slot, converter-flagged plate submeshes,
  mask DSL + placement-seeded determinism, damage-riding. Promoted from ideas/0.4.0/01.
  **CLOSED 2026-07-28**: 01–04 shipped, the pak was reconverted and the field verdict is in — every car
  wears its plate. Phase 0 corrected two of this plan's own assumptions (the city mapping was recorded
  backwards, and a plate is two quads, not one), and the first real boot cost one fix: a WGSL uniformity
  error in `rigidTexel`, which no test can see. Closed on the look verdict — the distribution drive, the
  bench guard and a ram test are listed unmeasured in the plan's readme; **that unmeasured tail was deferred
  to 0.5.0 on 2026-08-01** (the plan itself stays here — it shipped in 0.4.0). **Finished off 2026-08-12**:
  the F2 debug-spawner plate input and the damage/detach lifetime tests landed, and the deferred FIELD
  measurements became a real row in [098/08](./098-all-land-vehicles/08-acceptance-close.md) — until then
  they pointed at a chain that carried no plate task at all.
- **[081 — Vehicle driving physics](./081-vehicle-physics/readme.md)** — feel overhaul on the own engine.
  **01–05 DONE 2026-07-26, field-accepted**: `handling.cfg` went from 5 fields consumed to 21, every one a
  translation of the original's own code (spring law, `cTransmission` gearbox, air drag, tyre grip and
  traction loss, the steering limiter, the rear-lock handbrake); six fitted constants died; the gate is
  answered — STAY on DRCVC, its three asymmetries documented. Audit:
  [`audit/vehicle-physics-081.md`](../audit/vehicle-physics-081.md). **08 (SA gravity) closed-rejected and
  09 (speed steering) SHIPPED 2026-07-27**; the same day 07's regression pack (5 cars × 11 scenes, gated by
  `scripts/phys-regression.ts`) and its step-cost measurement landed, and 06 §2's kerb assist was closed by
  the field as not needed. **CODE-COMPLETE 2026-07-27**: 06 §1 air control (the original's own turn forces,
  `?airCtl`) and §3 camber from the authored axle, then 07's five-class sweep — which found the tuning
  generalises and left the class-factor table EMPTY — and the close-out
  ([audit](../audit/vehicle-physics-081-closeout.md)). **What is left is ONE field round** (jumps, a
  solid-axle car through a corner, one drive per class); 10 (surface types) is shipped-and-shelved as an
  open issue. Promoted from ideas/0.4.0/07.
- **[080 — Cinematic camera](./080-cinematic-camera/readme.md)** — GTA V-feel follow camera: per-channel
  springs/lag, auto-center + look-ahead, collision whiskers, vehicle speed/FOV/drift framing, bob/shake,
  7 sub-plans + priority chain. **01–07 DONE 2026-07-25** — the on-foot baseline, collision and the
  vehicle camera: damp/spring math + `CameraDirector` (`ui/camera/`), the smoothed rig with render
  interpolation (position weight), composition (turn-follow, idle recenter, look-ahead), collision
  (sphere casts, snap-in/ease-out, min distance, floor guard), and driving — speed→distance/FOV curves plus
  drift framing off 081/01's physics slip channel, as a second TUNING TABLE rather than a second code path,
  plus the additive motion layer — bob, landing dip, impact shake, sprint FOV kick, bounded and behind a
  `reducedMotion` switch (06). The 02–04 **field round is accepted** — defaults frozen as shipped, and the
  `?cam=legacy` A/B is DELETED with it. FOUR field rounds ran on the vehicle camera and the motion layer and
  every report was fixed; the close-out (07) turned the transition matrix into a test, froze the tuning,
  pruned the tab and ran the exit exam. **ACCEPTED in the field 2026-07-25 — the chain is closed for 0.5.0.**
  **08 (C-key view presets incl. first person) is DEFERRED**; its feasibility research is
  [`docs/ideas/first-person-camera/`](../ideas/first-person-camera/readme.md).
- **[079 — One canonical build source, the dev-surface unification, and its docs](./079-canonical-build-source/readme.md)**
  — every dev surface (lab, bench harness, viewers) reads ONE canonical build (`./build/original`), served in
  place (NOT copied into `public/`), via a new `http-dir` loader + the loading-MODE-selects-the-world fix +
  `buildTime`. Depends on [opensa-pack 003](../../tools/opensa-pack/docs/plans/003-game-shaped-output.md).
  **🔒 CLOSED 2026-08-12** — phases 0–6 DONE 2026-07-21, close-out taken 2026-08-12 (lint clean, coverage
  floors held: 4 108 tests, 91.92 / 82.6 / 92.09 / 92 vs 86 / 77 / 88 / 86, `docs/development/` verified
  repointed). Its measurement ledger stays EMPTY on purpose and says why — the phase 2–5 numbers were never
  taken and the builds they would have described are gone.
- **[078 — Global bug fixing](./078-global-bug-fixing/readme.md)** — the umbrella ledger for the bugs the
  first FULL pmb map convert surfaced (2026-07-19, >1 h run): engine and tool fixes tracked in one place.
  **OPEN — awaiting the detailed bug report; runs before 079.**
- **[077 — Unit coverage back to 85–90 %](./077-unit-coverage/readme.md)** — the 074/13 teardown deleted heavily
  unit-tested WebGL code and sank coverage 88.9 → 72.3 %. Recovered to **88.18 %** with a **device-independent
  seam**: a recording `GPUDevice` stand-in that boots the whole engine headlessly, no engine source touched.
  **DONE 2026-07-18.**
- **[076 — Roadsign / billboard text](./076-roadsign-text/readme.md)** — 2dfx type-7 text plates (roadsignfont glyph
  atlas, world-space) that prod renders and the own engine skips → blank boards. Bake into the cutout pipeline.

- **[075 — Water body classes: SEA vs INLAND](./075-water-body-classes/readme.md)** — split water.dat by height so
  inland pools/reservoirs render calm (no swell/foam/spillover) while the ocean keeps its full dynamics.

- **[074 — OpenSA engine](./074-opensa-engine/readme.md)** — own WebGPU-only framework + native formats
  (concept: [00-concept](./074-opensa-engine/00-concept.md)): target **60 fps with the full WebGL effect set**. Chain:
  01 framework architecture · 02 native formats (`.oscell`/`.ostex`/`.ospak`, texture ARRAYS, alpha pipeline) ·
  03 converter tool (`opensa-pack`) · 04 engine lab + P0 gate · 05 streaming/memory · 06 world effects ledger ·
  07 baked channels (066 specs re-targeted) · 08 dynamics (early skinning probe) · 09 post-FX/MSAA+A2C ·
  10 integration & flip. Vertical-slice roadmap M0–M4, every milestone gated on numbers.

- **[073 — WebGPU migration (three.js) — FAILED](./073-webgpu-migration-threejs/readme.md)** — the WebGL→WebGPU
  renderer mode on three.js: the CPU side was fully solved (render 65 → ~4 ms: bundles + patched three 0.185.1 +
  plain-Mesh pipeline sharing + memory caps), but an irreducible GPU/present remainder in **three's WebGPU
  backend on Metal** kept an M3 Pro under the 40 fps bar — the blocker is on three.js's side (per-object
  pipelines, naga codegen traps, backend present overhead; full forensic log in sub-plan 08). **Conclusion: the
  path forward is our own framework — [074 OpenSA engine](./074-opensa-engine/readme.md).** The
  `?webgpu/bundle/...` flags and engine changes stay in-tree for debugging until the own-framework work decides
  their fate.

- **[062 — Rendering overhaul](./062-rendering-overhaul/readme.md)** — **CLOSED 2026-07-21 (user triage): the whole
  062–072 chain is superseded by the own engine (074) — every effect was re-implemented there; no tail in
  these plans is actionable any more.** The "modern lighting" fork (chain umbrella,
  promoted from `ideas/0.4.0/02-rendering`): real sun on the prelit world without double-counting, CSM building
  shadows with LOD proxies, PBR sky + 512×1 horizon LUT, unified fog (horizon cut), Gerstner water, world-shader
  light pool (projected headlights), glowing night emissives, quality tiers + default flip. Stages:
  [063 foundations/instrumentation](./063-render-foundations-instrumentation/readme.md) ·
  [064 hybrid lighting](./064-hybrid-world-lighting/readme.md) · [065 shadows](./065-cascaded-shadows/readme.md) ·
  [066 pmb modern-asset tool](./066-pmb-modern-tool/readme.md) · [067 sky](./067-pbr-sky-clouds/readme.md) ·
  [068 fog](./068-unified-fog/readme.md) · [069 water](./069-water/readme.md) · [070 local lights](./070-local-lights/readme.md) ·
  [071 night](./071-night-emissive-atmosphere/readme.md) · [072 tiers/flip](./072-quality-tiers-default-flip/readme.md).
- [061 — World-ready state](./061-world-ready-state/readme.md) — boot reveal + teleport freeze driven by streaming
  `settled()`.
- [060 — Streaming smoothness](./060-streaming-smoothness/readme.md) — warm-invisibly + atomic-appear cell pipeline.
- [059 — Map car generators](./059-map-car-generators/readme.md) — spawn the binary-IPL `CARS` section (SA's map-baked
  parked cars in gta3.img): parser + specific-model + random (popcycle/cargrp, B1 city approximation) all done
  (lazy LOD register, ground-snap on spawn), in-game verified; B2 per-zone fidelity + random colour pending.
- [058 — Modloader](./058-modloader/readme.md) — `modloader/` overlay (`AssetFileSystem` decorator): override vehicle
  dff/txd + merge their settings into vehicles.ide/handling.cfg/carcols.dat, no engine changes. **REMOVED
  2026-07-28** — mods install at build time now; see
  [postmortem/runtime-modloader-overlay.md](../postmortem/runtime-modloader-overlay.md).
- [057 — Nx monorepo migration](./057-nx-monorepo-migration/readme.md)
- [056 — Multi-game config](./056-multi-game-config/readme.md)
- [055 — Input sources / mobile controls](./055-input-sources-mobile-controls/readme.md) · [054 — Asset cache revoke](./054-asset-cache-revoke/readme.md) · [053 — Asset local loader](./053-asset-local-loader/readme.md)
- …`001`–`052` in this folder.

## Tools (each ships its own plans)

- **map-optimizer** — lossless DFF/TXD conditioning (normals, prelit, dedupe, mips, full build).
  [`map-optimizer/docs/plans/`](../../tools/map-optimizer/docs/plans/) (`001`–`015`).
- **vehicle-optimizer** — scale + reflection-strength transfer for vehicle DFFs.
  [`vehicle-optimizer/docs/plans/`](../../tools/vehicle-optimizer/docs/plans/) (`001`–`003`).
- **opensa-lod-generator** — chunked LOD bake (merge → QEM decimate → per-cell TXD → drop-in build).
  [`opensa-lod-generator/docs/plans/`](../../tools/opensa-lod-generator/docs/plans/) (`001`–`002`).
- **lod-trees-generator** — SA-style tree LOD impostors (crossed-billboard cards + baked alpha atlas) from HD
  trees, plus the map strip + place stages (text↔binary IPL LOD-index coupling), the SA asset-format checklist,
  and aspect-aware atlas + `--prelight` trunk transfer. (procobj is now its own tool.)
  [`lod-trees-generator/docs/plans/`](../../tools/lod-trees-generator/docs/plans/) (`001`–`005`, `007`–`013`;
  `013` — impostor parity, **DONE and field-accepted 2026-08-22**: the four causes measured, the bake made
  antialiased and dilated, the impostor row given its source's vegetation class, and ONE CAGE PER ALPHA CLASS
  — 4 full-alpha cards for OpenSA's cutout weld, 3 cards thinned per tree for real SA. Phase B was measured
  away rather than built, and its `sa` half's ASI with it
  ([postmortem](../postmortem/asi-perfect-vegetation-view-weighted-cards.md)).
- **sa-procobj-placement** — procobj scatter → **permanent static IPL rows at `lod = -1`**, range from the stock
  `procobj.ide` raised to 299. SA-only (OpenSA scatters at runtime), and no LODs since
  [014](../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md) — renamed from
  `lod-procobj-generator` the same day. Reuses `map-placement`. [`sa-procobj-placement/docs/plans/`](../../tools/sa-procobj-placement/docs/plans/)
  (`001` architecture · `002` build pipeline · `003` asset format).
- **mod-installer** — layer mod folders onto a base game (files overwrite, `gta3img/` merges into `gta3.img`, a
  PNG folder merges into a sibling loose `.txd`), alphabetical.
  [`mod-installer/docs/plans/`](../../tools/mod-installer/docs/plans/) (`001` design · `002` as-built · `003` txd).
- **vehicle-installer** — install vehicle mod folders: dff/txd → `gta3.img`; settings → `handling.cfg`/
  `vehicles.ide`/`carcols.dat` (car/car4, alpha-sorted, custom `col` palettes)/`carmods.dat`; `--strip` to keep
  only the installed cars. [`vehicle-installer/docs/plans/`](../../tools/vehicle-installer/docs/plans/) (`001`
  architecture · `002` install · `003` palette · `004` strip · … · `011` special features · **`012` unread
  file kinds · `013` audio + parked — planned, central plan 102**).
- **add-vehicles** — ADDED cars (new model ids) for the `sa` target, on vehicle-installer's Node API:
  resolver root, id allocator, name/sound/parking, ModelVariations traffic, derived tuning, tuned traffic,
  the pmb stage. [`add-vehicles/docs/plans/`](../../tools/add-vehicles/docs/plans/readme.md) (`001`–`007`,
  planned 2026-08-19; central plan 102).
- **vehicle-cutscene** — convert installed vehicle mods into their cutscene counterparts: the 23 `cs*` models
  in `models/cutscene.img` (flattened HAnim rig with the vanilla bone ids, four instantiated wheels, baked
  carcols paint, empty `txdp`-resolved TXD), so real-game cutscenes show the same custom cars as gameplay.
  [`vehicle-cutscene/docs/plans/`](../../tools/vehicle-cutscene/docs/plans/) (`001` architecture + research ·
  `002` implementation — CLOSED, accepted: both car field gates, bike, boat, the full 23-model fleet
  converting as pmb's `cutscene` stage (the pipeline-build acceptance moved to perfect-cutscene
  plan 001 step 7) · `003` plate bake — CLOSED, field-passed: readable plates where vanilla shows blanks ·
  `004` full scene field review — CLOSED, APPROVED: all 35 vehicle scenes swept via the override,
  23 fix rounds · `005` seat retarget — CLOSED, field-passed: a cutscene actor sits in the DONOR's
  seat rather than R\*'s, which was 0.281 m low on a taller car).
- **ped-installer** — install ped mod folders: dff/txd → `gta3.img`; a new ped's line → `peds.ide` (replace by
  model, append if new); `--strip` to keep only the installed peds + the player ped (`--player`, default
  `BMYPOL1`). [`ped-installer/docs/plans/`](../../tools/ped-installer/docs/plans/) (`001` architecture · `002`
  add/replace · `003` strip).
- **tool-kit** — shared building blocks (mesh smooth-normals + QEM simplify, editable IMG). No plans doc yet.
- **map-placement** — shared SA map-edit workflows (id allocation, IDE/gta.dat edits, swapped-HD retexture,
  procobj convert/strip), used by lod-trees-generator + sa-procobj-placement.
  [`map-placement/docs/plans/`](../../tools/map-placement/docs/plans/) (`001` architecture & API).
- **sa-lod** — shared simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL), extracted from
  opensa-lod-generator, used by it + sa-procobj-placement.
  [`sa-lod/docs/plans/`](../../tools/lod-common/docs/plans/) (`001` architecture & API · `005` the 2dfx
  keep-policy + `006` `transform2dfxEntry` — both SHIPPED 2026-08-07, arrived from roadmap 0.5.0 plan 07).
- **rw-codec** — shared pure RW chunk/DFF/DXT/geometry-struct/2dfx codec, extracted from map-optimizer
  (plan 057, step 2). [`rw-codec/docs/plans/`](../../tools/rw-codec/docs/plans/) (`001` typed 2dfx payload
  codecs — SHIPPED 2026-08-07, arrived from roadmap 0.5.0 plan 07).
- **timecyc-builder** — timecyc precompute. No plans doc yet.
- **cleo/scripts** — authored CLEO script sources on the SDK (runtime content, not a build tool — the
  `asi/perfect-map` root-category pattern). [`cleo/scripts/docs/plans/`](../../cleo/scripts/docs/plans/readme.md)
  (`001` rhino tracks — CLOSED 2026-08-07, both runtimes field-proven, shipping step waived ·
  `002` no_lights — PLANNED 2026-08-06).
- **asi/perfect-cutscene** — deferred depth-sorted alpha for CUTSCENE vehicles (the glass-over-actors
  fix; retires `docs/hacks/retired/cutscene-window-pane-suppression.md`), second consumer of `asi/sdk`.
  [`asi/perfect-cutscene/docs/plans/`](../../asi/perfect-cutscene/docs/plans/readme.md) (`001` deferred
  cutscene alpha — WRITTEN 2026-08-14, not started; ends with a full plan-004 fleet re-check + pmb
  packaging).
- **asi/perfect-vehicle** — the VEHICLE-side ceilings no adjuster has a setting for: the two `carmods.dat`
  arrays (30 `link` pairs game-wide, 16 parts per car) that `tools/add-vehicles` runs into; third consumer
  of `asi/sdk`. [`asi/perfect-vehicle/docs/plans/`](../../asi/perfect-vehicle/docs/plans/readme.md) (`001` RE
  · `002` relocation patches — PLANNED 2026-08-19, central plan 102).

## Other docs

- [`../open-issues/`](../open-issues/) — investigated problems kept for reference (e.g. locked-dff).
- [`../ideas/`](../ideas/) — parked design directions ("later, maybe").
- [`../architecture/`](../architecture/README.md) — the architecture docs (modules, boot/loading, streaming, pmb, tools).
