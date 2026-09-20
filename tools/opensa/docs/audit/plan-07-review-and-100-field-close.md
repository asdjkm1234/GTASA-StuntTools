# Audit — plan 07's review, and plan 100's field close-out (2026-08-08)

One session, 8 commits, no feature shipped. What it produced instead: a **measured** baseline where plan 07
had a guessed one, three falsified premises removed from its steps, plan 100's owed field check taken, and one
new instrument built because the field could not answer with a screenshot.

Records: [`docs/roadmap/0.5.0/plans/07-lod-generators-extended/`](../roadmap/0.5.0/readme.md)
(the reviewed chain), [`docs/plans/100-2dfx-at-lod-range/`](../plans/100-2dfx-at-lod-range/readme.md) (the
verdicts), [`2026-08-08-ingame-post-100-rebuild.json`](../benchmarks/opensa-engine/2026-08-08-ingame-post-100-rebuild.json).

## What it cost

| | Lines |
| --- | --- |
| Product code (`.ts`/`.tsx`, excluding tests) | +265 / −33 |
| Tests | +74 / −0 |
| Docs | +398 / −136 |
| New debug script (`procobj-layer-census.ts`) | +181 |
| **Total** | **~+918 / −169**, 42 files |

Test count 3874 → **3883** (+9); suite, tsc and lint clean throughout. Wall clock was dominated by two things
that are not diff: one full map rebuild (~58 min) and one `pack`-only re-pack (~24 min).

## What it bought

### 1. The procobj baseline, measured — and the chain's conclusion inverted

Plan 07's density chain was costed against **24 552 "placed objects"**. That number is the generated binary
streams' RECORD count: HD, plus the unlinked LOD of every short species, plus 467 tree impostors sharing the
`plotr` areas. The layer places **15 286**. Two neighbouring figures were wrong the same way — the 6 954
"permanent rows" folded in the trees' overflow area (ours is 6 487, in 8 slots not 9), and "63 models" counted
LOD defs rather than the 43 species.

**All three errors pushed the same direction** — the layer looked cheaper per object than it is — which is the
signature of a wrong mental model, not of sloppiness.

What it changes: the target is **3.77×**, not 2.35×, and it costs 24 437 permanent rows, i.e. **38 096
map-wide — over the int16 ceiling by 5 329**. So "the int16 lift is not on the critical path" was backwards.
On stock the target misses on rows AND slots; on the reference install int16 is the only ceiling left, because
it is the only one no adjuster lifts. Two intermediate walls the chain never had: **slots bind at ~18 000
objects (1.18×, the whole headroom of a stock target)**, int16 at ~45 000.

`scripts/debug/procobj-layer-census.ts` re-derives every number and **checks itself** (linked HD == permanent
rows, unlinked HD == stream LOD records). Its first version was wrong — it counted by MODEL ID and swallowed
816 stock hand-placed instances of the same species. The self-check caught it, and the fixed version's total
landed exactly on the 24 552 the doc had misread, which is what IDENTIFIED the old number instead of merely
replacing it.

### 2. Three premises the code falsified

- **`01`'s central mechanism did not exist.** The plan blamed a biased draw (`lottery = random × density`,
  crowding out low-density species). The code draws `random() × PROC_OBJ_MAX_DENSITY` — uniform, no
  per-species term — and `ProcObjRule` has no density field at all: density is `spacing`, spent on the
  candidate count. The draw is unbiased, so the plan's cheapest proposed fix ("normalise by rule density")
  had nothing to divide by. A species can still reach zero, by rounding and by MINDIST-before-the-cut, and
  neither has been observed — the plan is now SIZE-IT-FIRST and may close as latent.
- **`lod-common/03` was no longer dormant.** It was written when nothing carried type-1; both targets carry it
  today, so thinning changes live output and the golden compare cannot be its "nothing changed" guard.
- **`sa-lod-generator/02`'s decimate half had shipped** in plan 100/05 — all three clone paths resolve one
  keep-set. Only the budget and the stock regression remain.

### 3. Plan 100's field check, and the knob it needed

The check was owed to a rebuild (the pack's LOD input is a `.work` intermediate the pipeline deletes). It ran
on the first post-chain pak and **passed on three of five rows**: a chimney plumes at 600 u; nothing doubles
at 300/400/440/600 u, including inside the hysteresis band where two resident levels would have shown as a
pair; and the smoke departure's look holds, with the white cooling-tower puffs seen at 300 u gone by 600 —
the per-system table is live, not a blanket raise.

Getting a camera onto a subject needed **`?look=x,y,z`** (aim at a GTA point, turn the ped with it). Look is
pointer-only and the harness has no mouse, so before it every probe stared SOUTH — unsatisfiable for the two
boards the check named, the map ending ~350 u past them.

### 4. The counter, because a screenshot could not answer

A 2.4 m plate at LOD range is **~8 px** in a 1440-wide capture. `.oscell` **minor 8** now records each cell's
roadsign glyph-quad count and the engine sums it over VISIBLE cells (`EngineStats.roadsignQuadsRecorded`, HUD
`signs N`). The reading: map-wide **334 of 1137 cells carry plates, 50 552 quads, zero hd/lod disagreements**;
in the field 2460 quads at 200 u and 1594 at 600 u.

Taking it needed new pak bytes but **not a new rebuild** — with `.work` kept, an 80-cell rect re-pack took a
minute against 1137 cells in an hour. The canonical pak was then re-packed properly (`pack` stage only) so
`signs N` means something on the shipping build.

## What it got wrong

1. **A capture manifest that named sights instead of instruments.** Two of its rows asked for what a human eye
   could see, and angular size — not build quality — decides that. Written into plan 07's rules.
2. **My first census counted by model id.** Scope a census by what PRODUCED the rows (the file), never by what
   they contain, and make it assert its own identities.
3. **My first "does the test bite" check was a no-op mutation.** Flipping `atan2(...) − π` to `+ π` is the same
   angle; the tests were right and the proof was worthless. Two real mutations (dropping the term, swapping
   the arguments) each fail two tests.
4. **A grep with `--include="*.ts"` hid `.tsx` and nearly cost a wrong conclusion** — that the harness's field
   knobs had been deleted. They had not. Doubt the rig first.
5. **Two field rounds were spent on blocked sight lines.** Aim is not sight: LS geometry took two clean 600 u
   bearings with a fence and a rooftop wall. Approach over open terrain and confirm from the shot.

## What the guards did

- **`oswire`'s header-size guard caught the format bump before any test did** — it refuses a minor newer than
  its offset formula, exactly as written. `KNOWN_MINOR` and the formula move together.
- **The compiler found every `Oscell` consumer** the new required field touched, including `sa-map-viewer`'s —
  the second consumer a previous safety argument had missed.
- **eslint's cognitive-complexity rule** rejected the first `?look` wiring; the branches belonged in a helper,
  and moving them there made the aim math testable beside the convention it inverts.

## Still open

- ~~The `insects`/`cigarette_smoke` floor hack has no look verdict — no shot framed an anchor.~~ **Taken
  2026-08-08**: specks at ~9 m, marginal at ~19 m, nothing at ~26 m and beyond, against a `?fx=0.02` culled
  control. The floor is inert above ~25 u (the sprite is 2 cm) and is kept because 15 u restores the pop.
  What made the shot possible was `scripts/debug/fx-anchor-census.ts` — the missing half of last session's
  two failed rounds was never the camera, it was not knowing where an emitter stood.
- ~~Plan 07's own decisions: whether `01` survives its sizing task, and whether `02`/`04` get rewritten per
  TARGET before any code.~~ **Both settled 2026-08-08** — `01` was sized (the defect is at the runtime cell
  cap, not the build-time ones) and re-ordered behind `02`; `02`/`04` were rewritten per target, then
  narrowed to TWO when the user ruled stock SA out of scope, which retired the 1.18× headroom figure this
  line quoted. Written up in
  [`plan-07-per-target-and-effect-distance.md`](plan-07-per-target-and-effect-distance.md).
