# 008 — The far-view emitter budget (particles on real-SA LODs)

> **CLOSED 2026-08-11: there is no budget to spend, and the thinning it would have fed is a table of 1.0s.**
> Moved here 2026-08-09 from the roadmap chain `07-lod-generators-extended/sa-lod-generator/02`, which was
> dissolved into the tools it touches — see [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md).

## MEASURED 2026-08-11 — the worst case in the whole map is 46 emitters

**The plan predicted this outcome and it is the one that arrived.** `scripts/debug/fx-anchor-census.ts
--worst` walks every anchor in the built pak as a candidate viewpoint and counts how many are simultaneously
LIVE — each inside **its own shipped cull distance** (plan 100/04's table), which is what actually bounds the
layer. A count from one point is a strict **upper bound** on a frame: a camera sees a frustum, not a sphere.

| Question | Answer | Stand at |
| --- | --- | --- |
| Most emitters live at once, all 13 systems | **46** of 943 map-wide | `?spawn=2582.1,2081.4,10.8` |
| Most LONG-RANGE smoke live at once (the 1500 u systems — the far view this plan is about) | **28** of 77 | `?spawn=2726.2,2683.0,55.0` |

**Why that closes it, without a new frame number.** [Plan 100/04](../../../../docs/plans/100-2dfx-at-lod-range/04-authored-cull-distance.md)
already measured this system with a **positive control that collapsed every emitter quad in the map**:
3.880 ms against the A/B arms' 3.867 and 3.875 — the control came out *slower*, inside the noise. So
cost-per-emitter is not resolvable by our instrument at all. The remaining question was only "how many can
pile up", and the answer is 46 — of which the thinning this plan would feed
([lod-common/008](../../../lod-common/docs/plans/008-emitter-thinning.md)) could remove at most half.
**Halving 46 quads is not a frame-budget action on any engine**, and it would cost the thing the layer exists
for: a distant refinery showing smoke.

**What bounds it is the per-system cull table, not the emitter count.** 943 anchors exist, but 763 of them are
`insects`/`vent`/`vent2`/`cigarette_smoke`/`fire` at 25–100 u — they can never be far-view load. The four
long-range systems are only **77 anchors map-wide**, and they are the ones plan 100/04 deliberately widened to
1500 u so that a refinery reads at range. That widening is the whole feature, and it costs 28 quads at worst.

**The honest gap, stated rather than hidden:** every number here is our engine's. This plan's target is real
SA under Wine, whose `FxSystem_c` is a different implementation, and **no measurement of SA's own cost exists
or was taken**. What transfers is the COUNT — 46 emitters is 46 emitters in either engine — and the count is
what a thinning table would have acted on. If the real game ever shows an emitter cost, this reopens with a
number rather than with a mechanism.


Depends on
[lod-common/03](../../../lod-common/docs/plans/008-emitter-thinning.md) (thinning). Its sibling `01` (the policy adoption) was
deleted 2026-08-09: it shipped as
[sa-lod-generator/007](007-clone-2dfx-policy.md) via plan
100/05, which is now the record.

**The ASI gate this plan was parked behind is already open, and its scope is smaller than A3 assumed.**
[03-asi Phase 2](../../../../asi/perfect-map/docs/plans/readme.md) is done: 009 shipped the
emitter-lifecycle patch (the `FxSystem_c` use-after-free, confirmed in-game), and
[010](../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) already flipped the pipeline —
`sa-lod-generator` **keeps particles on the verbatim path by default** today, with `--strip-particles` as the
opt-out for a stock target with no asi (`cli.ts:42`, `finalize.ts:219`). What 010 left open is the far-view
overdraw budget, deferred on the user's call.

**And the decimate half shipped too, in [plan 100/05](007-clone-2dfx-policy.md).**
All three clone paths — decimated re-encode, verbatim byte copy, hole-fill — now resolve one keep-set
through `cloneKeepTypes` (`adapters/gta-sa/finalize.ts:85`, `:95`), so a decimated LOD carries its emitters
today. **What remains here is the BUDGET and the stock-target regression, nothing else** — the plan's own
scope line below is what it was before 100 landed, kept for the record.

## Context & boundary

03-asi/010 owns the **pipeline decision** (shipped), the **far-view rate budget** (deferred) and the
installer's asi-presence safety, and it covered the sa-lod strip flip — a single call site. This plan is the
**generator plumbing** for the representation 010 did not touch: the **decimate** path, where the 2dfx
section is rebuilt rather than copied and so needs the keep-set and the thinning wired explicitly.

Today: verbatim keeps particles by default; decimate re-attaches via `collectClumpEffects`, whose keep drops
them. So a decimated LOD still carries no emitter, and nothing has ever measured what the un-stripped
verbatim path costs at range.

Baked cells are **not** in scope — that generator's output never loads in real SA
([`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md) has the citation). If our own engine
ever wants emitters on cells, that is its
own plan with its own budget, and it is not blocked on anything here.

## Decisions

1. **Particles become `carry-rate-scaled`** in the policy for the asi target, on the verbatim and decimate
   paths; thinning factors come from lod-common/03, which shares its config with 010. The verbatim path's
   carry already ships — this makes it a policy entry rather than a `keepParticles` boolean, and extends it
   to decimate.
2. **The stock target still strips**, and `--strip-particles` stays the way to ask for it. Without the asi
   this is not a preference, it is the difference between a game that boots and one that does not.
3. **Per-species tuning is expected, not a fallback.** The 38 particle-bearing models differ: one plume per
   smokestack reads right at range; fountains may be worth dropping entirely there. The shipped table is a
   deliverable of lod-common/03, tuned by the field runs here.
4. **Correctness is three things, and two of them are easy to forget**: emitters present, positioned — AND
   budgeted. A distant refinery must show smoke, and the map-wide sum must stay inside the frame budget with
   every smokestack in view. Measure the second case deliberately; it will not occur by accident during a
   normal drive.
5. **Fallback honesty.** A build with emitters carried REQUIRES the asi; without it the leak returns. The
   installer's asi-presence check covers this content, loudly.

## Tasks

- [x] ~~Policy: type-1 → carry-rate-scaled on verbatim and decimate~~ and ~~decimate carries the emitters~~ —
      **BOTH SHIPPED as [plan 100/05](007-clone-2dfx-policy.md).**
      All three clone paths resolve one keep-set through `cloneKeepTypes`; `keepParticles` survives only as
      the `--strip-particles` override, on one line.
- [x] **Measure what the ALREADY-SHIPPED verbatim carry costs at range. DONE 2026-08-11 — the null result the
      task allowed for.** See the section at the top: the worst case in the whole map is 46 live emitters, and
      100/04's positive control already put cost-per-emitter under the noise floor.
      [lod-common/008](../../../lod-common/docs/plans/008-emitter-thinning.md) therefore ships a table of 1.0s
      and this plan closes.
- [x] **The deliberate worst case: DONE, and it is re-runnable rather than written down once.**
      `fx-anchor-census.ts --worst` recomputes it from the built pak, so a pipeline change that moves the
      anchors moves the viewpoint too — `?spawn=2582.1,2081.4,10.8` (46 live) and `?spawn=2726.2,2683.0,55.0`
      (28 of the 77 long-range smokes). Positive control for any frame A/B there: `?fx=0.001`.
- [~] ~~In-game (Wine, asi target), only if the measurement says thinning is needed~~ — **struck: the
      measurement says it is not.** The emitters already ride verbatim and decimate LODs by default; what this
      task would have verified is a thinning that is not being built.
- [~] ~~Stock-target regression: particles fully stripped, byte-identical to today~~ — **STRUCK 2026-08-11:
      stock is not a target.** The declared configuration is OLA + FLA + our own `perfect-map.asi`
      (`docs/restrictions/sa-target.md`), so there is no build this regression would protect. `--strip-particles`
      survives in the CLI as an opt-out, and **the honest state of it is worth more than a tick**: no build
      passes it, nothing exercises it, and it has no test. It is an unexercised flag, not a verified path —
      whoever ever needs it should expect to fix it first.

## Verification

- asi target: emitters ride verbatim AND decimate LODs; distant smoke visible; the game boots; the frame
  budget holds at the worst-case viewpoint.
- ~~stock target: byte-identical strip to today~~ — struck with its task: stock is not a target we build for,
  and `--strip-particles` is an unexercised opt-out (no caller, no test).
- Emitter count stays bounded map-wide — no smoke-storm.

## Measurements / notes

- **Anchors the built pak carries** (`fx-anchor-census.ts`, canonical pak): **943 across 13 systems** in 562
  hd cells — `insects` 336, `vent` 209, `vent2` 162, `cigarette_smoke` 87, `fire` 53, `smoke30lit` 49,
  `smoke30m` 19, `waterfall_end` 9, `water_fountain` 7, `smoke50lit` 6, `ws_factorysmoke` 3, `coke_puff` 2,
  `water_fnt_tme` 1. **Do not sum the levels** — a LOD bundle carries its cell's anchors too since 100/03.
- **Worst-case viewpoint** (`--worst`, each system inside its own shipped cull): **46 live at once** at
  `2582.1, 2081.4, 10.8`; the long-range smokes alone peak at **28 of 77** at `2726.2, 2683.0, 55.0`. Both are
  upper bounds — a frustum holds less than a sphere.
- **Far-view frame cost there, before/after: NOT TAKEN, deliberately.** 100/04's positive control (every
  emitter quad in the map collapsed) already read 3.880 ms against arms of 3.867/3.875, so the instrument
  cannot resolve this system's cost; a fourth arm at a denser point would measure the same nothing. The
  decision rests on the COUNT, which is the quantity a thinning table would have acted on.
- **Shipped per-species factors: 1.0, all of them** — see
  [lod-common/008](../../../lod-common/docs/plans/008-emitter-thinning.md).
