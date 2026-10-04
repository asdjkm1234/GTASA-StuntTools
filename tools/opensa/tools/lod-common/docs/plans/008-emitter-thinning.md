# 008 — Emitter thinning (the far-view rate budget)

> **CLOSED 2026-08-11 as NOT NEEDED — the table is 1.0s and there is no mechanism to build.** Moved here
> 2026-08-09 from the roadmap chain `07-lod-generators-extended/lod-common/03`, which was dissolved into the
> tools it touches — see [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md).

## The measurement this plan waited on came back empty

Its own opening asked for exactly this: *"take the cost of the shipped carry first, and let the number say
whether thinning is needed and how hard."* The number was taken on 2026-08-11 in
[sa-lod-generator/008](../../../sa-lod-generator/docs/plans/008-far-view-emitter-budget.md) and it says NO.

- **The worst viewpoint in the entire map holds 46 live emitters** of 943 anchors, and the long-range smokes
  — the ones this plan's own framing is about ("forty refineries from a hillside") — peak at **28 of 77**.
  Both are upper bounds; a frustum sees less than a sphere. Re-runnable: `fx-anchor-census.ts --worst`.
- **Cost per emitter is below the instrument's noise floor**, established by plan 100/04 with a positive
  control that collapsed every emitter quad in the map: 3.880 ms against arms of 3.867 and 3.875.
- So thinning could remove at most ~23 quads at the worst point in San Andreas, at the price of the effect
  the carry exists for. **The per-species table this plan was to deliver is therefore 1.0 for all 38
  particle-bearing models**, which is a table with no code behind it.

**What would reopen it:** a measurement on real SA (this chain's actual target, whose `FxSystem_c` is a
different implementation and has never been measured), or a pipeline change that raises the anchor count or
widens more systems to 1500 u. Both are re-checked by re-running `--worst`; the mechanism stays unbuilt until
one of them produces a number.


Depends on [01](005-2dfx-keep-policy.md) /
[02](006-2dfx-entry-transform.md) and on the budget model defined by
[03-asi/010](../../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md). Split out of the old A3
so the shared mechanism is not welded to the real-SA consumer that waits on an ASI fix.

**This is 010's deferred half, not a blocked plan.** 009's engine fix shipped and 010 already keeps particles
on the sa-lod verbatim path by default, so emitters ARE at range in real SA today — what was deferred, on the
user's call, is the overdraw budget over them. That makes this measurable now: take the cost of the shipped
carry first, and let the number say whether thinning is needed and how hard.

## Context

A particle 2dfx names an `effects.fxp` system and emits at its authored rate. That rate is authored for
walking past a refinery, not for looking at forty refineries from a hillside — carrying every emitter onto
every LOD is a smoke-storm and an overdraw bill. Something has to reduce emission at LOD range, and the
generator is the only place that can do it without new engine state.

## Decisions

1. **Thin emitters before scaling parameters.** Two mechanisms, and the cheap one goes first:
   - **thinning** — carry a configured fraction or cap of a model's type-1 entries onto the LOD (one plume
     per smokestack instead of six). No payload edit, purely which entries survive, so it composes with the
     keep-policy and needs no FX authoring.
   - **parameter scaling** — if the particle payload exposes a rate field
     ([rw-codec/01](../../../rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) decodes it), scale it down for the LOD copy.
     Only if thinning proves insufficient, and it is a payload edit with all the risk that carries.
2. **Deterministic thinning, and the choice is not "the first N".** Which plume survives must be a pure
   function of the entry set (a stable hash of the entry's position, say) — same input, same LOD, always. A
   positional rule also keeps the surviving emitters spread across the model instead of clustered at one
   end.
3. **Per-species config with defaults, not a global factor.** Refinery smoke, Vegas plant effects, fountains
   and fires read differently at range; a fountain is arguably worth dropping entirely there while a
   smokestack is the whole point of the silhouette. The deliverable is the table, and its defaults are
   conservative.
4. **One budget model, two consumers.** The factors live in one config consumed by both the pipeline flip
   (03-asi/010) and the encoders here. A second copy of the numbers is a second answer to the same question.
5. ~~**This plan ships no behaviour on its own.**~~ **False since plan 100 — thinning now changes LIVE output
   on BOTH targets.** It was written when no path carried type-1. Today `clone` carries particles by default
   (plan 010, `sa-lod-generator/src/cli.ts:42`) and `cell` is `carry` in the policy
   (`lod-common/src/two-dfx-policy.ts`, plan 100), so the first factor below moves what both generators
   emit. The golden compare on both generators will move with it, deliberately — it can no longer serve as
   the guard that says nothing changed.

## Tasks

- [~] ~~Thinning in lod-common: a fraction/cap of a clump's type-1 entries, deterministic positional
      selection, per-species config~~
- [~] ~~Unit tests for the cap, the determinism and the spread~~
- [~] ~~Share the budget config with 03-asi/010~~
- [~] ~~Payload rate-scaling through rw-codec/01's particle codec~~
- [x] **Record the per-species table and what each factor was judged on.** It is **1.0 for all 38
      particle-bearing models**, judged on a count rather than on a look: 46 live emitters at the worst point
      in San Andreas, cost per emitter under a positive control's noise floor. A table of 1.0s needs no code,
      and every task above is struck with it — **all five 2026-08-11, on the measurement at the top.**

## Verification

- Thinning is deterministic and correctly bounded (unit).
- **Both generators' golden output changes exactly where a factor says it should**, and nowhere else — with
  every factor at 1.0 the output is byte-identical to today. That regression arm replaces the old "dead code
  by design" guard, which the plan-100 carry retired.
- The budget config has exactly one definition, shared with 010 (grep).
- **Measure before tuning.** [Plan 100/04](../../../../docs/plans/100-2dfx-at-lod-range/04-authored-cull-distance.md)
  is the only far-view particle measurement anyone has taken, and it found the whole emitter system **below
  the noise floor** on both bench scenes — a positive control (every emitter culled) came out slower than
  both arms. Whatever motivates thinning has to show up over that, or the honest deliverable of this plan is
  a null result and a table of 1.0s.

## Measurements / notes

_(record after implementation)_

- per-species thinning factors + what each was judged on: …
- entries carried vs entries authored, per category: …
