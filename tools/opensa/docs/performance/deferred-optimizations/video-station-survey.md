# Surveying camera stations at RUNTIME instead of baking them into the pak

**Status:** in reserve — costs almost nothing today (205 casts across 25 scenes, ≤ 3 in any frame), and the
alternative would put a camera decision into the build, where a modded map could never move it.

**Impact: VERY LOW — measured, and the entry is honest that the win is headroom rather than milliseconds.**
The survey spends **205 casts across 25 scenes, never more than 3 in a frame**, reaches a verdict inside 14
frames, and has never appeared in a `[slow]` line; with the second consumer added, `stepMs` reads
0.0153–0.0180 against a drive-only 0.0172 — no measurable cost at all. Baking would take 3 casts/frame to 0
and remove ~0.2 s of survey latency. What that actually buys is the ability to run several tripods at once
without breaking the 5-casts-a-frame ground rule — a feature ceiling, not a frame.

**Effort: high, and it does not even remove the runtime pass.** A new pak product to emit, version and
invalidate in step with the map — and the dwell/framing tests are per-SHOT, so a baked table could only
pre-filter geometry while the window pass stays. Two consumers already share the cast budget, so both would
have to be moved onto it. **The cheap lever nobody has needed yet is simply raising the 3-cast allowance**;
the ground rule it lives under is `docs/restrictions/architecture.md`, and changing a budget is very low
effort compared with baking one.

## What we do today

A tripod shot's stand is chosen live (plan [096/04](../../plans/096-video-mode/04-stations-and-occlusion.md),
`apps/web/src/ui/video/stations.ts`). While the shot BEFORE it plays, the survey walks a seeded list of
candidates around the driven line — 8/11/14/18 m to either side, three height classes — and spends up to
three casts a frame on them: one `groundBelow` to snap the candidate to whatever is under it, then a
`pathClear` against each of five predicted car positions across the shot's window. The first candidate to
clear four of five and hold the car within reading distance wins.

Measured over 5 seeds × 5 scenes (096/04's ledger): **205 casts total**, never more than **3 in a frame**, a
verdict inside **14 frames**, 12 of 12 tripod slots filled.

## The lever

Bake the answer. `opensa-pack` already walks the whole map with collision available, and the road graph is a
build-time input too — so a build could emit, per road segment, a handful of pre-validated camera stands with
their sightline coverage, and the runtime would read a table instead of casting anything at all.

## What it would win

The cast budget, entirely: 3/frame → 0/frame during a survey, and the ~0.2 s of survey latency disappears
with it. In frame-time terms this is close to nothing today — `pathClear` is a single Rapier ray and the
survey only runs during one shot in four — so the honest win is **headroom**, not milliseconds: it is what
would let a scene run several tripods at once (a multi-camera scene, roadmap material) without touching the
080 five-casts-a-frame ground rule.

## What it would cost

- **A camera decision moves into the build.** `docs/restrictions/build-vs-runtime.md`'s whole subject: a
  baked stand cannot know that a mod added a wall, moved a building or replaced the road. The survey exists
  precisely because the world it films is the merged, modded one.
- **A new pak product** to version, invalidate and keep in step with the map — for a feature that is not
  shipped in the game.
- **The dwell and framing tests are per-SHOT, not per-place**: the window a station is judged over depends on
  the car's speed, where the scene happens to start, and how long the shot before it ran — none of which
  exist at build time. (Since 05b a tripod's own window is bounded by its watchdog rather than a chosen
  fragment length, which changes the arithmetic and not the argument.) A baked table could only pre-filter geometry, so the runtime would still need the window pass.

## The second consumer, added 2026-08-01 (096/09)

A PLANTED car-anchored shot (`flyby`) now asks the same question of the spots it can reach: three candidates,
one `pathClear` each, all spent on the single frame the shot starts. It shares this lever — a baked table of
pre-validated stands would serve it too — but it shares the objection more strongly, because its candidates
are derived from where the CAR is at that moment and a build cannot know that.

What it changed here is the arithmetic rather than the argument: two consumers now divide the same 3-cast
allowance, which is why the survey was made to take what is LEFT of the frame rather than its own share
(`docs/restrictions/architecture.md`, the cast-budget rule). Measured over 14 scenes: worst `castsMax` still
**3**, `stepMs` 0.0153-0.0180 against 096/08's drive-only 0.0172 — no measurable cost.

## What would have to be true to pull it

- A scene wanting **several simultaneous tripods**, or the survey running for every shot rather than one in
  four, pushing past the 3-cast budget.
- Or a THIRD cast consumer arriving: two already divide the allowance, and the next one has nowhere to take
  its casts from without one of them yielding further.
- Or a measured frame-time cost: today's survey has never appeared in a `[slow]` line, and neither has the
  plant check.
