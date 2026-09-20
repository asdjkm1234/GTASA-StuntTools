# Ideas — 0.5.0

Future-work plans for the 0.5.0 cycle. Same convention as the sibling [0.6.0](../0.6.0/readme.md) cycle: each
feature is a chain of small, individually-implementable plans under [plans/](plans/), ending with
verification + measurements.

## Platform reach — IN PROGRESS as `docs/plans/200-platform-reach/` (2026-08-04)

The lead chain of the cycle, and no longer deferred work, so it no longer lives here. The world on a phone,
and the frame off the main thread: a phone boots the engine and **cannot open the world**, because a pak
built from SA assets is BC throughout and no mobile GPU has BC — content decided at build time, not a
runtime or browser problem.

**Landed:** the whole of chain 1 (device truth) — the world's GPU demand read from its manifest before
anything streams, a build-time `--platforms` gate over both halves (pak arrays ∪ model dictionaries), the
`--rgba8` defect that gate found, a simulated-mobile-adapter test, and the mobile benchmark schema. Plus the
build half of chain 3/01: `.oscol`, the bake, and `--bake-collision`.

**Next:** the runtime read of the baked collision (the half that removes the spike), then chain 2 once its
concept clears. Its phone-side steps are blocked on a device measurement nobody has taken, and the dispatch
console below is the instrument that takes it — the only surface that opens a real world on a mobile GPU
today. Until that row exists, everything on a phone stays unproven.

Full chain: [../../plans/200-platform-reach/readme.md](../../plans/200-platform-reach/readme.md).

## The dispatch console — IN PROGRESS as `docs/plans/201-dispatch-console/` (2026-08-06)

The engine's **second consumer**, declared, and the second lead of the cycle — so it does not live here as
future work either. `apps/dispatch` is a computer-aided-dispatch operator surface over the streamed world
(top-down 3D map, live units, a call queue, click-to-inspect answering with model and TXD names plus GTA
coordinates) that runs with no player, no ECS and no physics. It shipped in a single commit with one
write-up and nothing else: no plan, no roadmap row, no line in the project goals — while being the only
surface in the repo that runs on a phone.

The chain does three things at once: **declares the direction** (a CAD 3D map on the SA world — geo import,
a live feed and multi-operator are ruled out and deferred to [0.6.0](../0.6.0/readme.md)), **trims the engine
to what the map actually draws** — and only that, because cars and peds are drawn, vegetation sways and the
day turns, with one engine serving PC and mobile on a budget rather than a branch — and **takes the phone
measurement** the platform-reach chain above is waiting for.

Full chain: [../../plans/201-dispatch-console/readme.md](../../plans/201-dispatch-console/readme.md).

## Weather-driven wind (own engine)

Vegetation sway shipped in the own-engine chain (074/06 row 10) with a constant `windStrength`; the deferred
half is the weather rule — bad weather ⇒ stronger (and possibly faster) wind, cross-faded on weather change.
All the hooks already exist (baked per-vertex amplitudes, `Environment.windStrength`, timecyc-driven
environment drivers) — this is a drive-rule + field-tuning task.

Full plan: [plans/02-weather-wind/readme.md](plans/02-weather-wind/readme.md).

## Baked directional sun shadows — MOVED to 0.6.0 (2026-07-17)

The second-attempt plan now lives in the 0.6.0 "graphic improvements" draft bundle, together with the
street-lamp lighting v2 idea:
[../0.6.0/plans/04-graphic-improvements/01-baked-directional-shadows.md](../0.6.0/plans/04-graphic-improvements/01-baked-directional-shadows.md).

## All land vehicle types — PULLED BACK into active work (2026-08-04)

Rewritten against a fresh four-way recon (data pipeline, physics, animation, docs) plus the
`NO_COMMIT/all-veh` corpus (the VSA Editor ability catalogue + a control mod car) and moved to
[`docs/plans/098-all-land-vehicles/`](../../plans/098-all-land-vehicles/readme.md); the single-file chain
that lived here (`plans/04-all-vehicle-types/`) is superseded and deleted. Air & water stay out — the
recon's findings on them are recorded in
[../0.6.0/plans/05-air-water-rail/readme.md](../0.6.0/plans/05-air-water-rail/readme.md).

## Rain & weather phenomena (timecyc-driven)

The full 23-id SA weather catalogue mapped to effect classes: weather state machine with real FROM→TO
timecyc blends, instanced rain with a top-down occlusion map (dry under roofs), wet-world uniforms,
**WET GRIP** (the tyre half, moved from 081/10 — the surface path is already shipped, what is missing is the
rain to be wet from),
**after-rain PUDDLES** (surface name-list + world-noise mask + `skyColorFor`-reflection, drying from the
edges inward), fog/smog presets, sandstorm (tinted particle wash + wind), lightning/thunder — and the
deferred weather→wind rule executes here. Full plan:
[plans/05-weather-rain/readme.md](plans/05-weather-rain/readme.md).

## City Life (THE flagship chain)

The most important system of the cycle: a living city — traffic and pedestrians with persistent seeded
routes, real scheduled trains, traffic lights and rail barriers, all visible to the fog line — built on the
AAA simulation-LOD-ring pattern (full physics near → kinematic graph-followers → far "rivers of headlights"
as corona streams), with agent identity preserved across rings, **running in BOTH hosts: the OpenSA engine
and real SA through a new `asi/city-life` plugin** (100 % mission/mod compatibility). Reworked 2026-08-02
into five sub-chains: `1-preparation` (the ASI clears the vanilla streets FIRST; full path/population data
import; a sidecar for what the original files can't express; an editor FOR the original `nodes*.dat`),
`2-traffic` (sim core, a driver that is not an idiot, real light controllers, the new instanced far tiers,
the ASI traffic twin), `3-peds` (crowd rendering, generated silhouette LODs, sidewalk sim, ASI twin),
`4-trains`, `5-city` (density scaling + the acceptance program).

Full chain: [plans/06-city-life/readme.md](plans/06-city-life/readme.md).

> **⛔ Step 0 before ANY work on this chain: show the user
> <https://www.youtube.com/watch?v=1dwufRp71EY> and wait for his direction** (his call, 2026-08-11 — he will
> correct the entry afterwards, so the chain as written is provisional against what he takes from it). The
> gate is stated at the top of the chain readme and applies to every file under it.

## Basic CLEO support — PULLED BACK into active work (2026-08-04)

Rewritten against a full recon of the 7-mod target corpus and moved to
[`docs/plans/097-cleo-basic/`](../../plans/097-cleo-basic/readme.md); the chain that lived here
(`plans/08-cleo-basic/`, the unstarted 083 rethink) is superseded and deleted.

## LOD generators, extended — DISSOLVED into the tools, 2026-08-09

**This chain no longer has a folder here.** It began as two generator upgrades (2dfx on LODs, procobj
density), was reorganised on 2026-08-07 into one sub-folder per tool, and on 2026-08-09 those sub-folders
moved into the tools themselves — the plans had stopped spanning tools, and a plan that lives beside its code
cannot drift from it. **Every remaining task is unbuilt work in a tool's own numbered chain:**

| Tool | Plan | What is left |
| --- | --- | --- |
| `sa-procobj-placement` | [013 — density budgets, per target](../../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md) | **DONE 2026-08-11 — nothing left.** Both perf budgets were measured and NEITHER binds, so the plan found no cap to ship; the int16 throw became a stock-requirements REPORT (the target lifts int16 with our asi); the streaming guard was struck with the stream layout 014 deleted. Closed on the user's field run of the 18:04 rebuild: 91 419 objects, 43 species, 110 382 map-wide permanent rows |
| `sa-procobj-placement` | [010 — density model](../../../tools/sa-procobj-placement/docs/plans/010-density-model.md) | per-category / per-surface density and the two shipped profiles. Its first task shipped, so what is left is SHAPING density rather than raising it |
| `sa-procobj-placement` | [011 — biome density](../../../tools/sa-procobj-placement/docs/plans/011-biome-zone-density.md) | zone × scatter join + slope proxy. Gated on 010, and it inherits a new problem: a density multiplier changes GROUPING as a side effect |
| `sa-procobj-placement` | [012 — species floor](../../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md) | the runtime cell cap zeroing whole species. **Its 19.8 % sizing predates the column fix and must be re-taken** |
| `lod-common` → `sa-lod-generator` | [008 — emitter thinning](../../../tools/lod-common/docs/plans/008-emitter-thinning.md) → [008 — far-view budget](../../../tools/sa-lod-generator/docs/plans/008-far-view-emitter-budget.md) | **one measurement, then possibly nothing.** Both generators already carry emitters; plan 100/04 found the system below the noise floor with a positive control, so the honest deliverable may be a table of 1.0s |

**What shipped out of the chain**, each recorded in the tool it landed in:
[`rw-codec/001`](../../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) typed 2dfx payload
codecs · [`lod-common/005`](../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) +
[`006`](../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) the carry policy and the entry
transform · [`opensa-lod-generator/005`](../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md)
and [`sa-lod-generator/007`](../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) the two
adoptions · [`perfect-map-builder/003`](../../../tools/perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md)
the target split and its guards ·
[`sa-procobj-placement/008`](../../../tools/sa-procobj-placement/docs/plans/008-limit-route-review-closed.md)
the closed limit-route review and
[`009`](../../../tools/sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md)
the `procobj.dat` column fix. The rotation-bearing-2dfx step died and came back as
[plan 100](../../plans/100-2dfx-at-lod-range/readme.md); escalators turned out to have no engine code at all
([plan 101](../../plans/101-escalators/readme.md)).

**The finding that reframed the whole procobj half (2026-08-09).** `procobj.dat`'s two columns were being
read the way the file's header describes them rather than the way the game spends them: SPACING is a LENGTH
(`area / spacing²`) and MINDIST is a camera radius, not an inter-object distance. The layer was running at
**16.8 % of the authored density** with an inverted, evenly-spaced look. Fixed, rebuilt and
**field-accepted** — 15 286 → **91 092** objects, one bench scene moved (`country-dusk` +12.6 %, the only
rural one). So "more procobj" was never a stretch goal; it was a return to the data, and the aiming point
taken from ProperFixes (57 583 objects) is itself **0.63× vanilla**. The research record is
[`tools/sa-procobj-placement/docs/density-target.md`](../../../tools/sa-procobj-placement/docs/density-target.md)
— **read its banner first**: every multiplier in it is quoted against 15 286, which is the defect.

**Two framings this chain got wrong, kept because they are how the corrections were found.** "Both halves are
ASI-gated" was false — baked-cell work is OpenSA-only ([restrictions/sa-target.md](../../restrictions/sa-target.md)),
so no plugin is involved, and the particle half was not waiting either
([`asi/perfect-map`](../../../asi/perfect-map/docs/plans/readme.md) Phase 2 shipped). And "the binding ceiling
is IPL slots" held only for stock SA, which stopped being a target on 2026-08-08: on the install we ship to
`EntityIpl` and `EntitiesPerIpl` are `unlimited`, and **int16 is the only correctness ceiling left** — the one
no adjuster lifts, and ours to clear.
