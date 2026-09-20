# 100 — 2dfx survives to LOD range

**Status: 🔒 CLOSED 2026-08-08** — all five steps shipped that day and the field check ran on the pak built
after them (`11:42 08-08-2026`): chimneys smoke to 600 u, nothing doubles at the transition, the per-system
departure table is live, and plates survive to LOD range by COUNT (the instrument that answers what a
screenshot cannot). Banner added 2026-08-12 by the plan sweep, which also found the last verdict row stale —
the `insects` floor WAS field-judged the same day, in the hack file. **Nothing open.**

**Chimney smoke, street lamps and street-name plates keep working when an area is only its LOD.** Decided
2026-08-07 by the user, after the research in [00](00-research-and-findings.md) killed the first attempt and
then reversed one of its conclusions.

Today every 2d-effect our engine consumes dies at the HD boundary. The three types **our engine** consumes —
**0 light, 1 particle, 7 roadsign** — are gathered from HD models only, so past ~440 u a district goes dark,
smokeless and unsigned while its baked LOD keeps drawing to 1000 u. The other six (3 ped attractor, 4 sun
glare, 6 enter/exit, 8 trigger point, 9 cover point, 10 escalator — 16 934 stock entries between them) have
no code in `packages/engine` at all and stay out of the OpenSA line.

**"No consumer" means ours, not the game's.** Real SA implements several of them natively and reads the entry
off whatever model it streams, so the policy's `clone` column keeps carrying them and
[step 05](../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) does not narrow it. Escalators are the clearest case: they work in SA, they
have never moved in our engine (the staircase mesh draws — it is ordinary geometry — but nothing animates the
steps), and giving a baked cell an entry our engine cannot read would not change that.

## The shape of it

**Both LOD generators bake the three types into their LOD output, and the OpenSA consumer starts reading
what the cell bake produces.** That second half is what makes the first half real: `opensa-lod-generator`
already writes a 2dfx section into every baked cell and [00](00-research-and-findings.md) found that nothing
reads it. Either the generators feed a consumer or they write bytes into a void — so the two land together.

| Target | Who bakes | Who consumes | State |
| --- | --- | --- | --- |
| real SA (`sa-lod-generator` clones) | per-object LOD clone carries the entry in its own DFF | **SA itself** reads 2dfx off whatever model streams | **closed by [05](../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md)** — all three clone paths resolve one keep-set. Nothing was actually losing emitters (the step's premise was wrong): the change is consolidation, and stock output moves for 6 models, in entry ORDER only |
| OpenSA (`opensa-lod-generator` cells) | the cell bake carries the entry in the merged cell DFF | `cell-weld` → the pak's LOD bundle | **closed by 01–03.** Lights and emitters come off the LOD model's own section; **plates come off the world-keyed pre-pass instead** — 131 of 489 sit in a different cell from the instance carrying them, and the two sources would double them ([03](03-lod-bundle-reads-2dfx.md) decision 3) |

## Steps

| # | Step | Lands in | State |
| --- | --- | --- | --- |
| 01 | the policy gains a per-type coordinate SPACE and the `cell` target carries 1 + 7 | `tools/lod-common` | **SHIPPED 2026-08-08** → [lod-common/007](../../../tools/lod-common/docs/plans/007-2dfx-space-and-cell-carry.md) |
| 02 | the cell bake emits lights, emitters and plates with the right transform per space | `tools/opensa-lod-generator` | **SHIPPED 2026-08-08** → [opensa-lod-generator/006](../../../tools/opensa-lod-generator/docs/plans/006-cell-bake-carries-effects.md) |
| [03](03-lod-bundle-reads-2dfx.md) | `cell-weld` reads the LOD level's 2dfx into the LOD bundle, deduped against HD | `packages/cell-weld` (+ `opensa-pack`) | **SHIPPED 2026-08-08** — field check owed to the chain's rebuild |
| [04](04-authored-cull-distance.md) | honour each fx system's authored `cullDist` instead of one hardcoded 300, and raise the smoke systems | `apps/web` | **SHIPPED 2026-08-08** (stays here — `apps/web` keeps no plan chain) |
| 05 | the SA clones carry the same set on BOTH paths (verbatim and decimate) | `tools/sa-lod-generator` | **SHIPPED 2026-08-08** → [sa-lod-generator/007](../../../tools/sa-lod-generator/docs/plans/007-clone-2dfx-policy.md) |

Order: 01 → 02 → 03 is the OpenSA line and must land in that order (03 is what makes 02 visible). **01 and 02
turned out to be inseparable** — `opensa-lod-generator` reads the policy directly, so the table flip and the
per-space transform are one change; they shipped together. 04 is independent and can go first — it is the step
that decides how far smoke is drawn at all. 05 is the real-SA line and depends only on 01.

**All five shipped 2026-08-08, and the FIELD CHECK ran the same day** on the first pak built after the chain
(buildTime `11:42 08-08-2026`). It needed that build: the pack's LOD input is a `.work` intermediate the
pipeline deletes as it consumes it, so no earlier tree could be asked whether a chimney smokes at 600 u.

| Owed | Verdict |
| --- | --- |
| a chimney smokes past the HD boundary ([03](03-lod-bundle-reads-2dfx.md)) | **PASS** — LV plant stacks plume at 300/400/440/**600 u** |
| nothing doubles at the transition ([03](03-lod-bundle-reads-2dfx.md)) | **PASS** — one plume per stack at every distance, including inside the hysteresis band |
| the smoke departure's look ([04](04-authored-cull-distance.md), [hack](../../hacks/smoke-drawn-to-world-edge.md)) | **PASS** — and the cooling-tower puffs visible at 300 u are gone by 600, so the per-system table is live, not a blanket raise |
| plates survive to LOD range ([03](03-lod-bundle-reads-2dfx.md)) | **PASS, by COUNT not by eye** — `.oscell` minor 8 + `EngineStats.roadsignQuadsRecorded`: map-wide 334 of 1137 cells carry plates and 50 552 quads with ZERO hd/lod disagreements, and the field reads 2460 quads at 200 u, 1594 at 600 u |
| `insects`/`cigarette_smoke` floor ([hack](../../hacks/tiny-fx-distance-floor.md)) | **CLOSED for `insects`, and this row was stale** — the chain's own rebuild capture framed none, but a dedicated A/B was taken the SAME DAY and lives in the hack file: Santa Maria pier `388.9, −2071.6, 8.4` (plus the LS alley anchor), `?fx=1` against a `?fx=0.02` positive control, insects detectable at ~9 m, marginal at ~19 m, gone by ~26 m. Verdict: the floor is **inert above ~25 u** and costs nothing measurable, because the authored sprite is 2 cm. `cigarette_smoke` was never framed on its own — same rule, same size class, no separate evidence |

The rebuild that carried this was granted by lifting plan 07's ban on rebuilding mid-chain: a rebuild is now
gated on what it CAPTURES, and the manifest lives in
[07's working rules](../../roadmap/0.5.0/readme.md#working-rules-while-this-plan-runs).
The one open row above is what that run could not capture, and it is not waiting on another one. The
plate row was closed by BUILDING THE INSTRUMENT the manifest should have named: a 2.4 m plate at LOD range
is ~8 px, so no screenshot at any build quality was ever going to answer it.

## The numbers this plan is budgeted against

From [00](00-research-and-findings.md) and the fx census, all measured 2026-08-07:

- **Streaming**: `HD_RADIUS` 380, `LOD_RADIUS` 1000, `HYSTERESIS` 60 — the band with no effects today is
  ~440 → 1000 u.
- **What is out there**: the pak welds **943 particle anchors**, **481 roadsigns**; the stock corpus carries
  2203 light entries in 327 models.
- **Authored cull distances** (`effects.fxp`, our engine currently ignores all of them for a flat 300):
  `ws_factorysmoke` **150**, `smoke30m`/`smoke30lit` 155, `smoke50lit` 255, `carwashspray` 70, `fire`/`flame`
  35, `water_fountain` 30, `vent`/`vent2`/`waterfall_end` 25, `insects`/`cigarette_smoke` 15.
- **Coordinate space per type** (this decides the transform, and getting it wrong throws a plate a kilometre):
  light and particle are **model-local**, roadsign is **WORLD**, 489 of 489.

## Two deliberate departures from the authored data

Both are the user's call, both landed in [04](04-authored-cull-distance.md) with a `docs/hacks/` file
([smoke](../../hacks/smoke-drawn-to-world-edge.md), [floor](../../hacks/tiny-fx-distance-floor.md)), because
they are places where we knowingly do not do what the game's own tables say:

1. **Smoke is drawn farther than SA drew it.** `ws_factorysmoke` is authored at 150 u; a chimney plume that
   vanishes at 150 while its factory is drawn to 1000 is the defect this plan exists to fix.
2. **`insects` and `cigarette_smoke` get a floor of 100 u, not their authored 15.** Read literally, the
   authored value would make them pop in almost at arm's length; 100 is the accepted compromise, and it is
   still 3× tighter than today's flat 300.
