# 096/09 — A planted shot checks where it stands

**Status: BUILT 2026-08-01, field verdict owed.** The one gap 096 shipped with, closed with the machinery 04
already built.

## The gap

`flyby` is the only `static` preset: it plants an eye once, from the car's own geometry, and lets the car
drive past it. Nothing ever asked whether that spot was inside a wall.

The close-out said so plainly, and the field round did not retire it — the user watched the flythrough scenes
and they looked good, but **not being planted inside a wall in the scenes watched was never evidence that it
could not happen.** A tripod (`station`) has been surveyed for a clear line since 04; a `flyby` had not.

This is the asymmetry the phase removes. It is not a new mechanism: `StationSource.sightline` is the same
probe, already wired by `station-supply.ts`, already excluding the car's own body (the ray ends inside the car
it is aimed at).

## What was built

**A ladder of spots, best first** (`plantedEyeCandidates` in `shots.ts`). Every rung is the shot's OWN
authored offset re-signed or scaled, never a constant of its own, so it stays a multiple of the subject's
half-extents — a mod car of a different size gets a differently-sized ladder for free, and a shot whose
authored spot is clear never moves:

1. the authored spot;
2. the same spot mirrored across the car — a street is usually blocked from one side only;
3. the authored spot at twice the height — over whatever is in the way.

**The choice lives in `shotPlaying`** (`director.ts`), beside the tripod's, because the two now answer the
same question and share the same failure: a shot whose every candidate is blocked is GIVEN UP and the plan's
own fallback preset plays instead. Filming from inside a wall is worse than not filming.

**Without a probe the behaviour is exactly what it was** — the authored spot, unchecked. The director stays
usable with no physics world, which is what every one of its 40-odd unit tests runs on.

## The budget, which is the whole reason the ladder is three rungs

080's standing rule is **≤ 5 casts/frame for the whole game**, and the follow rig already spends 2. The
station module's own allowance is therefore 3 (`SURVEY_CASTS_PER_FRAME`), and a plant spends one cast per
rung, all on the single frame the shot starts.

Three rungs is what fits. A longer ladder would find a spot slightly more often and blow the frame it found
it on — the trade 080 settled once already.

That exposed a real defect in the module while this was being built: **`step()` spent its full 3 regardless
of what the frame had already spent.** A plant frame would have cost 3 + 3 + the rig's 2 = 8. It now takes
what is LEFT (`SURVEY_CASTS_PER_FRAME - frameCasts`), and the survey yields — it is the thing that can always
wait one more frame, which is what 04's own amortisation argument says. Pinned by a test.

## Verification

- **Unit — `director.test.ts`, four cases + one in `station-supply.test.ts`.** Negative: every candidate
  blocked gives the shot up (fallback plays, `fallbacks` rises, the whole ladder is charged); no probe plants
  unchecked. Positive: a clear authored spot is kept and costs one probe; a blocked authored spot steps to the
  mirrored one; the check runs ONCE per shot, not per frame — a planted eye never moves, so there is nothing
  to re-check. Budget: a survey asked on a frame that already spent 3 returns 0 casts.
- **Suite: 3 431 → 3 437 green** (five director cases, one budget case), tsc and eslint clean.
- **`blockedPlants` on the director state** counts rungs stepped over, so a headless run can say how often
  the world was actually in the way — 0 means the authored spots were all clear, which is the number this
  phase exists to stop assuming.
- **FIELD: owed.** The instrument can say the eye is not inside geometry; it cannot say the re-planted shot
  is a good shot. A mirrored `flyby` frames the car from the other side of the road, and whether that reads
  as the same shot is a human question — the same class as every other verdict this plan waited on.

## Numbers — headless, 2026-08-01

Two runs on `build/original/opensa`, `drive.js`, DPR 1: **seed 47 scenes 1-4** and **seed 911 scenes 1-10**.
14 captures, 77 024 directed frames. Row:
[`2026-08-01-headless-planted-occlusion.json`](../../benchmarks/opensa-engine/2026-08-01-headless-planted-occlusion.json).

| | seed 47, 1-4 | seed 911, 1-10 |
|---|---|---|
| `blockedPlants` | **0** | **0** |
| `flyby` plants that actually happened | 2 | 1 |
| worst `castsMax` in any frame | **3** | **3** |
| `stepMs` mean | 0.0180 | 0.0153 |

**What this says, and what it does not.**

- **The check is live and it is cheap.** A scene whose only planted shot is a `flyby` reports `castsMax` **1**
  — one probe, on the frame the shot starts, and none after: proof the plant is checked and proof it is not
  re-checked per frame. `castsMax` never exceeded **3** anywhere, so 080's ≤ 5 rule holds with the rig's 2.
- **Cost is unchanged.** `stepMs` mean 0.0153-0.0180 against 096/08's drive-only **0.0172** — the same range.
  Three casts once per planted shot cannot show up in a per-frame mean, and it does not. (Same coarsening
  caveat as 08: `performance.now()` is 0.1 ms headless, so only the mean over thousands of frames is a
  measurement.)
- **It has NOT been observed to re-plant.** Three `flyby` plants across 14 scenes all found their authored
  spot clear. That is an honest small sample, not a verdict: it says planting into geometry is not COMMON on
  these routes, and it cannot say it never happens — which is precisely the thing the old code assumed
  without evidence. The ladder itself is pinned by unit tests, not by this run.
- One scene ended `stuck` at 2.7 s before reaching its `flyby` (seed 911 scene 3) — a pre-existing autopilot
  outcome, unrelated to this phase, and the reason the plant count is 3 rather than 4.
