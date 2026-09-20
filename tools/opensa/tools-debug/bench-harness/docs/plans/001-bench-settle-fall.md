# 001 — The bench settle lies, and a fall poisons the sweep

_(Was `docs/plans/102-bench-settle-fall/` until 2026-08-17 — moved beside the harness it fixes; the central
folder is engine plans only.)_

**Status: DONE and MERGED 2026-08-09** (`ed6b90ba`, close-out audit `6202503e`). Closes the harness half of
[`docs/open-issues/bench-scene-transition-collision.md`](../../../../docs/open-issues/bench-scene-transition-collision.md)
— the falls and the A/A triangle drift. The city-scale simulation-residency question that doc also carries is
NOT this plan; it stays open as a design track (the user's draw-distance requirement stands, but no observed
defect currently forces it).

Restrictions checked 2026-08-08: the fix stays inside the web host harness + `packages/game` test seams and
uses the existing host-dep pattern (`groundBelow` already crosses into `engine-video-runs`); no entry in
`docs/restrictions/` binds.

## The bug, in one paragraph

`engine-perf-runs.ts` settles a bench scene by polling `stream.pendingCells === 0` — but the first polls
after a teleport still describe the ring around the PREVIOUS anchor, already drained, so settle exits in one
frame ("ring drained (1 frames)"). Nothing anywhere waits for collision: colliders build in an async promise
continuation (`collision-streaming.system.ts` → `loadCellColliders`), and under sweep load they lose the race
by 1–2 s. The player is a kinematic controller whose gravity is OUR integration
(`character-controller.system.ts:384`); ~0.7 s without ground puts him below the anchor's ground level, the
ground then materialises above his head, and he falls forever — no kill-Z, no terminal clamp. Teleport
preserves `Velocity.z` (the only zeroing is boot, `engine-canvas-host.tsx:561`), so every later scene inherits
terminal velocity and is under the mesh within 1–2 frames of its teleport: one lost race poisons the rest of
the sweep. A falling player then crosses `VehicleLodSystem`'s 3D distance metric for every car at once —
"in ganton-night ALL the cars went".

**Bench-only, confirmed:** `engine-phys-runs.ts:249` and `engine-video-runs.ts:943` both carry
`TELEPORT_NOTICE_SECONDS = 1` for exactly this race (video-runs also waits out the collision behind the ring,
`:1038`); the notice was never carried to perf-runs. The normal game teleports from grounded rest on an idle
frame budget, and cars defer their spawn until ground exists. The bug's fossil is dated: the ocean-horizon
anchor was moved "ON the sand" on 2026-07-10 (`78046648`) because an over-water anchor "drops the player into
the sea and the run never settles" — the class was seen a month ago and worked around in content instead of
the gate.

## Order of work (the user's sequence, verbatim in spirit)

1. **Red tests first** — each must FAIL on the current code before any fix lands (prove the test sees the
   bug), per the test-structure rules (negative describes first).
2. Fix until green.
3. **Prove the bug is gone in the field**, not just in the suite.
4. Re-take the benchmarks: old map (canonical minor-8 pak), `bench-d1`, `bench-d3`.
5. If nothing reproduces — merge the branch, close the bug and this plan.
6. Return to `docs/roadmap/0.5.0/plans/07-lod-generators-extended`.

## Step 1 — three failing tests

- **T1, the stale settle gate** (`engine-perf-runs` + fake host): stub `requestAnimationFrame` /
  `performance.now`; `getStream` replays the field sequence — first polls answer for the OLD ring
  (`pendingCells: 0`), then the driver retargets (`pendingCells: 81`), then a drain over N frames. Assert
  `beginSamples` does not fire while the new anchor's ring is pending. Today the leg starts on frame 1 → red.
  This test also guards the root of the A/A `avgTriangles` drift.
- **T2, warp resets motion state** (controller level, real Rapier, no timers): world with no colliders →
  ~120 fixed steps → `Velocity.z` has accumulated a fall → warp → assert `Velocity.z === 0` and the air FSM
  reset. Requires moving "a genuine warp resets motion" out of the host closure into a testable unit — the
  test targets where the decision is made, and today no such reset exists anywhere → red.
- **T3, fall through late ground** (integration, real Rapier + `CollisionStreamingSystem`): fake adapter whose
  `loadCellColliders` returns a promise resolved BY THE TEST; teleport over the cell, 90 fixed steps with the
  promise held, then resolve, then more steps. Assert the player ends grounded at anchor height, not below the
  mesh. The field race becomes a pinned ordering — deterministic by construction. Today he never comes back →
  red.

**Written 2026-08-09, all RED on current code** (`npx vitest run apps/web/src/ui/engine-perf-runs.test.ts
packages/game/src/character/character-controller.system.test.ts` → 4 failed, 42 passed; lint + `tsc` clean):

| # | Test | Verbatim failure |
| --- | --- | --- |
| T1 | `setupPerfRuns settle` › does not begin a leg while the new anchor's ring is still pending | `AssertionError: expected 81 to be +0` |
| T2a | `CharacterControllerSystem warped body` › does not carry a fall's velocity across a warp into the air | `AssertionError: expected -19.620000000000022 to be greater than -1` |
| T2b | …› does not carry the land-tier impact speed across a warp (no phantom collapse on arrival) | `AssertionError: expected 6 not to be 6` (6 = `LOCOMOTION_COLLAPSE`) |
| T3 | …› does not begin a leg with the player under the mesh when collision arrives late | `AssertionError: expected -6.4068498611450195 to be close to 5, received difference is 11.40684986114502` |

T3's number is the bug in one line: at leg start the player is **11.4 m under his own anchor**, still falling,
with the ring reporting a drained queue the whole time — the harness had no way to notice.

Two things the tests decided that the plan had left open:

- **The motion reset must be DERIVED in the controller, not remembered by a caller.** T3's fake host wires
  `teleportPlayer` to `physics.teleport` because that is exactly what `engine-canvas-host.tsx:1910` wires;
  a fix that lives in the host closure would leave the test red and force the test to be edited to go green,
  which is no test at all. So `CharacterControllerSystem` compares the body position it is handed against
  the one it last produced: a jump no step could have made is a warp → zero `Velocity`, reset the air FSM.
  It then covers every warp path (debugger, bench, respawn, CLEO) without any of them opting in.
- **A warp onto GROUND already self-heals** (`moveOnFoot` zeroes `Velocity.z` on contact), so the two T2
  cases warp into the air — which is precisely the field case: a teleport into a cell whose colliders are
  still building. T2b then pins the second-order damage the inherited speed does: `fallSpeed` 19.8 makes the
  ped COLLAPSE on arrival, so even a landing that "worked" cost a 1.8 s stand-back-up inside the capture.

A third test was added as the positive control (green today and after): a settle that has a drained ring AND
ground under the anchor must start its leg promptly, not sit out the 12 s timeout — the other way to be wrong.

## Step 2 — the fix (small, instrument-shaped)

- Carry `TELEPORT_NOTICE_SECONDS` into `engine-perf-runs.settleAt` (the pattern already exists twice).
- Gate settle on ground truth, not on a proxy alone: `physics.groundBelow(anchor)` must answer before the
  warmup starts (host dep, same shape video-runs already uses).
- A warp zeroes `Velocity` + air-FSM state — **derived in the controller** (see step 1's finding), so the
  debugger teleport, perf-runs' inline teleport at `engine-canvas-host.tsx:1910` and phys/video runs are all
  covered without a caller remembering to ask. Watch the two paths that teleport the body legitimately every
  step: the vehicle system's rider seating (the controller is `setEnabled(false)` there) and fly mode
  (`placeFlying` — the controller's own placement, so it records it as its own).
- Settle re-warps once the ground answers: the player falls while the gate waits, so the gate alone is not
  enough — T3 is green only when the leg starts with him standing ON the anchor.
- **The permanent probe** (requirement 8 of the open issue): the bench report records, per scene, leg-start
  `playerZ − anchorZ`, `grounded`, `pendingCells`, and the worst single-frame Z drop over the leg — and the
  report row goes RED when any is out of bounds. The falls were silent for a month because no instrument
  could print non-zero; this is the instrument. It also retroactively guards every future comparison against
  old bases.

**Done 2026-08-09** — all four tests green, `packages/game` + `apps/web` **1328 passed (106 files)**, lint and
`tsc` clean. Reverting the three source files (`git stash push`) puts the same four failures back, verbatim,
so the tests fail for the reason they were written.

What shipped, and where:

| Piece | Where |
| --- | --- |
| notice → ring → GROUND, then a re-warp onto the anchor, then warmup | `engine-perf-runs.ts` `settleAt` |
| the frame-clock helpers (`until`/`waitSeconds`) instead of the file's own rAF loop | `engine-perf-runs.ts` |
| `groundBelow` + `playerProbe` host deps | `PerfRunsHost`, wired in `engine-canvas-host.tsx` |
| perf-runs' inline teleport now takes the SHARED warp (it skipped the interpolation snap) | `engine-canvas-host.tsx` |
| `legStart` in the report row + a `[fall]` warning line when `ok` is false | `engine-perf-runs.ts` `flyLeg` |
| the derived warp reset (`WARP_DISTANCE` 5 m, `resetIfWarped`/`resetMotion`) | `character-controller.system.ts` |

**One defect the tests found in the fix itself, before the field ever saw it:** the first ground gate opened
instantly on a world with NO collision — `groundBelow` casts a solid ray from the anchor, the player is
standing on the anchor, so it answered with his own capsule ~0.9 m down. Plausible number, right range, every
time. The probe now excludes the player's body, and the trap is recorded in
[`edge-cases/physics-runtime.md`](../../../../docs/edge-cases/physics-runtime.md) — nothing catches a missing exclusion.

Docs updated in the same change: `docs/development/benchmarks.md` (the settle sequence + the `legStart`
column), `docs/features/character.md` (the warp reset), `docs/edge-cases/physics-runtime.md`.

## Step 3 — prove it in the field

- Fallwatch run on the canonical pak (`TAG='[fall]' ALSO='[cam]'`, full budget): expect zero `[fall]`
  markers and no `[cam]` wall (2026-08-08 baseline: 89 255 lines).
- A/A re-run: `avgTriangles` spread per scene within noise (2026-08-08 baseline: lv-night 10.19 %,
  sf-fog-dawn 6.00 %). The content columns must match before any cost column is read
  (`docs/benchmarks/readme.md` rule).
- Probe fields clean on all nine scenes.

**Done 2026-08-09.** Headless harness, M3 Pro, DPR=2, pak `build/original/opensa` (minor 8, buildTime
`13:19 08-08-2026`), 1196 road cars, three full `?bench=all` sweeps.

| Measure | 2026-08-08 baseline | After 102 |
| --- | --- | --- |
| `avgTriangles` A/A spread, `lv-night` | 10.19 % | **0.14 %** |
| …`sf-fog-dawn` | 6.00 % | **0.36 %** |
| …worst scene of nine | 10.19 % | **0.36 %** |
| `avgMs` A/A spread | — | ≤ 0.02 % |
| `[cam]` jump lines per run | 89 255 | **1** |
| console errors | — | 0 |
| scenes with `legStart.ok` | (no instrument existed) | **8 of 9** (`dz −0.08 m`, grounded, worst frame drop 0) |

Records: [`2026-08-09-headless-bench-aa-after-102.json`](../../../../docs/benchmarks/opensa-engine/2026-08-09-headless-bench-aa-after-102.json)
(the A/A pair) and [`2026-08-09-ingame-102-probe-arm-a.json`](../../../../docs/benchmarks/opensa-engine/2026-08-09-ingame-102-probe-arm-a.json)
(the diagnostic arm), plus the index entry.

**The field found two things the suite could not**, both from the probe's own numbers:

1. **A scene anchor is authored for the CAMERA, not for the player.** Six of the nine sit 3.65–26.29 m above
   the ground, so warping to `scene.anchor` restarted the fall for the whole 1.5 s warmup — `dz −11.16` is
   exactly 1.5 s of gravity, and it was on the row before the units gave it away. The settle now warps onto
   the ground it just found (`SETTLE_LIFT` 1 m) and then waits until the player is **at rest**; `dz` is
   reported against where the settle put him (`targetZ`), and it is context, not a verdict — a moving player
   is what invalidates a row, not where he stands.
2. **`strip-noon`'s anchor was authored INSIDE the Flamingo.** The ground ray answers `13.00` off the
   building and the capsule falls out of the world — every run of that scene since 2026-07-29. Diagnosed
   wrongly at first as a hole in the world; the user's reading of his own run corrected it, and both
   "supporting" symptoms turned out to be correct systems doing their job (the cars' `no ground` deferrals
   are the spawn gate at the 150 m collision ring; the district emptying is residency culling around a
   player 890 m down). Anchor moved to `[1933, 1127, 18]` off `teleport-spot.ts`, re-run clean: `dz −0.08`,
   grounded, 27 cars live. Full write-up, wrong diagnosis kept:
   [`open-issues/fixed/strip-noon-anchor-inside-a-building.md`](../../../../docs/open-issues/fixed/strip-noon-anchor-inside-a-building.md).

   Landing with it: the wait-for-rest is capped at **3 s** (`REST_TIMEOUT_MS`) instead of the 12 s
   world-ready budget. On a floorless anchor the full budget turned an 11 m fall into ~890 m, and since the
   world IS anchored to the player, that correctly despawned the whole district — the bad anchor's cost is
   now bounded. **All nine scenes are green.**

## Step 4 — the benchmarks the falls invalidated

Re-take and record into `docs/benchmarks/` (per its schema, pak stated per run):

- old map — canonical `build/original/opensa` (minor 8, buildTime 13:19 08-08-2026);
- `build/bench-d1` and `build/bench-d3` — the two density arms kept for exactly this moment (delete them
  after the sweep is recorded).

This redoes the 07/04 density A/B that the falls contaminated.

**Done 2026-08-09, by the user on his own display lane** (all three arms: 1219 road cars, 212 parked,
`legStart.ok` on all nine scenes, no anomalies reported). Records:
[oldmap](../../../../docs/benchmarks/opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json) ·
[d1/d3](../../../../docs/benchmarks/opensa-engine/2026-08-09-ingame-user-display-density-ab.json).

| scene | tri d1 | tri d3 | d1↔d3 | vs oldmap | ms d1 | ms d3 | d1↔d3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ls-noon | 2 453 074 | 2 452 564 | 0.02 % | +0.89 % | 9.586 | 9.528 | 0.61 % |
| sf-fog-dawn | 1 543 665 | 1 545 048 | 0.09 % | −0.19 % | 9.035 | 8.992 | 0.48 % |
| lv-night | 2 077 303 | 2 075 426 | 0.09 % | +0.47 % | 14.464 | 14.481 | 0.12 % |
| country-dusk | 1 256 872 | 1 260 040 | 0.25 % | +1.45 % | 16.557 | 16.597 | 0.24 % |
| ocean-horizon | 409 328 | 409 525 | 0.05 % | +0.76 % | 8.333 | 8.333 | — (frame cap) |
| ls-rain-night | 1 798 393 | 1 798 221 | 0.01 % | +0.96 % | 8.579 | 8.715 | 1.56 % |
| ganton-noon | 1 600 933 | 1 599 035 | 0.12 % | +0.59 % | 13.550 | 13.574 | 0.18 % |
| strip-noon | 1 926 089 | 1 926 057 | 0.00 % | +0.52 % | 10.202 | 10.190 | 0.12 % |
| ganton-night | 1 602 353 | 1 602 710 | 0.02 % | +0.77 % | 13.734 | 13.689 | 0.33 % |

**The density value changes nothing that any column can see.** `avgTriangles` differ by 0.00–0.25 %,
`avgDrawCalls` by 0–3 calls, `avgMs` by ≤ 1.6 % with the sign flipping between scenes. The instrument's own
A/A floor is 0.36 % on triangles, so this is not a small effect — it is **no measurable effect**, and it
confirms the 2026-08-08 audit ("the selector shipped, the density lever did not exist") on an instrument
that can now be trusted. That confirmation is the whole reason the re-take was owed.

Two things the table says that the verdict does not:

- **Both d-builds differ from the oldmap pak** — consistently, in the same direction, on both arms:
  +0.2…+1.5 % triangles and +5–7 % draw calls (ls-noon 1215/1218 vs 1138). So the d-builds carry something
  the old map does not; it just is not the density value.
- **`ocean-horizon`'s cost column is saturated** at the 120 fps frame cap (8.333 ms on all three arms), so
  that scene discriminates on content only. Read its triangles, never its milliseconds.

## Step 5 — close

If nothing reproduces: merge `102-bench-settle-fall` into main (the user merges/pushes — his call), re-scope
the open issue (harness half CLOSED with the fix commits; the simulation-residency design question keeps its
own doc or moves to `docs/ideas/`), fill this plan's measured numbers, add the plans-README row state.

Then back to `07-lod-generators-extended` — its next queued item is the `CPlantMgr` MINDIST reverse
(07/02 decision 5: nearest-neighbour census on the built tree first, then the pre-cull placement count).
