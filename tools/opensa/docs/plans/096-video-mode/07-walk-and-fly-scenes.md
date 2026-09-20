# 096/07 — Walk + flythrough scenes

**Priority P2. Ships alone: the program table's `fly×2` and `walk×1` entries stop being skipped —
completing D3. Depends on 03 (camera authority) and 05 (sequencer).**

## What exists

- **Scripted walking**: `CharacterControllerSystem.runPath(points)`
  (`character-controller.system.ts:148-152`) — world-space Z-up waypoints, ignores the keyboard until
  the last point, `ARRIVE_DISTANCE = 0.6`, `arrived` getter; used today only by the enter-vehicle
  approach. Two gaps: it is NOT exposed on any host API, and it walks at RUN speed only
  (`desiredMove`, `:268-271` hardcodes `movement.runSpeed`).
- **Fly camera precedent**: the video camera authority (03) takes `{eye, target, fov}` directly — a
  flythrough needs NO flyEye involvement; `flyEye` stays what it is (the interactive photo mode).
  Reminder: fly-anything has no camera collision — clearance is the module's job.
- Occlusion/clearance queries + budget: 04's `pathClear`/`sphereCast` discipline and the ≤ 3-casts/frame
  headroom.
- `samplePath` (`packages/game/src/perf/bench.ts:54`) — piecewise-linear keyframe flight, the bench
  camera's sampler: reuse for the fly spline base (with the module's own easing on top; `BenchScene`
  itself is NOT reused — no FOV/easing fields, the research note).

## Tasks

### A. Walk scene

1. **Thread `runPath` out**: host accessors `walkPath(points)` / `walkArrived()` / `walkStop()` over
   `controllerSystem` (`engine-canvas-host.tsx:689`), added to `VideoRunsHost`. One accessor trio, no
   system changes beyond:
2. **Walk tier**: an optional gait argument on `runPath` so a scripted route can move at WALK speed
   (today `desiredMove` hardcodes `movement.runSpeed`). Default stays run (the enter-vehicle caller is
   untouched); the video scene passes walk. Small, but it is a `packages/game` behaviour change — its
   own test (path followed at walk speed; existing approach behaviour unchanged).
3. **Walk route**: reuse the 01 builder with walk parameters (length = duration × ~1.7 m/s, turn cap
   irrelevant at foot speed) and a LATERAL offset of ~4 m from the carriageway polyline (sidewalk-ish;
   vehicle nodes are all the graph we have — an honest limitation, recorded in the feature doc).
   `groundBelow` snap per waypoint at staging; a waypoint with no ground within 3 m rejects the route
   (bridge rails, water).
4. **Walk shots**: the 03/04 machinery with pedestrian presets — tripod stations at 2–6 m offsets,
   low height bias, tighter FOV; chase = the shipped on-foot follow rig via authority yield (the same
   trick as the vehicle chase shot). Subject anchor uses the player position (already the camera focus
   on foot); framing math is shot-preset config, not new code.

### B. Flythrough scene

5. **Fly path builder** (`apps/web/src/ui/video/fly.ts`): seeded spline over the region — v1 shape:
   pick a route from 01's builder, lift it to a height band (15–40 m, seeded), smooth heavily, fly it
   at constant speed (duration-fitted); look target = a point travelling the ground route ahead of the
   eye (the "aerial establishing shot" read). Variants (orbit a landmark, crane up) are config presets
   over the same sampler — added only if the first field round asks.
6. **Clearance**: at staging, `sphereCast` (radius ~2 m) along consecutive spline samples; a blocked
   segment lifts the whole path by +10 m and re-checks (twice, then reject route). Amortised live guard:
   1 probe/s ahead of the eye; a hit eases altitude up (continuous response — never a discrete dodge;
   the multiray lesson applies to flight too). All within the cast budget: staging casts run behind the
   overlay, live guard is 1/s.
7. **No player involvement**: the player stays teleported at the route start on the ground, out of
   frame (the world streams around the PLAYER — `driver.update(playerEngine)` — so the fly path must
   stay inside streaming radius of the anchor: cap path extent to ~350 m from the player, the
   bench-scene rule; assert it at staging).
8. Tests: fly-path clearance logic on stubbed casts; walk-route ground rejection; program table now
   executes all three kinds. Negative first.

## Acceptance / verification

- Full 8-scene cycle headless: all three kinds run, 0 skips, 0 throws; fly scenes log 0 live clearance
  hits after staging (staging lift counts recorded).
- Field look: walk scene reads as a person walking a street (not gliding — gait/clip correctness is
  the existing locomotion's job, just verify it engaged at walk tier); flythrough reads as a drone
  establishing shot, no pop-in in frame (streaming radius respected), no terrain clips.
- Ledger: staging lift counts, walk-route rejection rate, fly-path lengths vs streaming cap.

## Risks / notes

- The walk scene's sidewalk offset will sometimes clip building steps — the ground-snap rejection
  handles verticality, not furniture; accept v1 jank, record instances, curated anchors are the known
  later fix (D5's closing note).
- Streaming follows the player, not the camera — the fly cap (task 7) is the load-bearing constraint;
  violating it produces exactly the empty-world-on-camera failure 094 taught us to make impossible, so
  the assertion is mandatory, not advisory.
- HD ring radius is 380 u (`streaming.ts:23-43`) — the 350 m cap keeps the fly eye inside it with
  margin; if a field round wants higher/wider flights, the answer is a different anchor point mid-path
  (teleport the player under the flight behind a cut), not a bigger cap.

---

## SHIPPED 2026-07-31

Both halves. The sequencer no longer skips anything: `sceneOfKind` dispatches `drive` / `walk` / `fly`, and
D3's program table executes end to end.

### What shipped differently

- **A fly scene is FIVE PASSES, not one flight.** This doc was written before the user's same-day D1/D4
  revision and still said "duration-fitted"; there is no fragment duration any more. Asked which way to take
  it, the user chose five distinct aerial passes of 10 s over ONE neighbourhood (`AERIAL_PRESETS`:
  `low-pass`, `high-crane`, `descend`, `side-track`, `climb-out`), dealt without replacement like a shot
  list. Five 10 s passes at a continuous 12 m/s would be 600 m of travel, which is why they are passes over
  the same bounded route rather than one journey — and that is also what keeps the streaming cap satisfiable.
- **The flythrough does NOT use the director.** The director frames a SUBJECT — anchors, lead room, an
  empty-frame guard — and a flight has none. Bolted on, every one of those instruments would be measuring a
  car that is not there, so `fly.ts` owns its own three-function stepper and the scene reports its own line.
- **The walk scene DOES use the director, whole.** `planShots` already took a preset table (05 built it that
  way), so the pedestrian table is a second table and not a second code path. `stationCandidates` and
  `createSurvey` gained optional `laterals` / `survey` parameters — absent, the drive scene is byte-identical.
- **The ground-snap rule from task A3 is not what it says.** `moveToward` steers on the PLANAR delta only, so
  a waypoint's Z is never read: the probe is not a snap the walk needs, it is the only test of whether the
  route is walkable. And it can only judge the stretch inside the STREAMED COLLISION — a 160 m route reaches
  past the 150 m ring, and probing the far end would reject every long route for the world not being loaded
  yet. 62 of 82 waypoints were judged in the field run; the rest are walked on the controller's own ground
  handling, exactly as a player walking there would be.
- **`sphereCast` needed a host accessor** (`sphereClear`) — it existed in `PhysicsWorld` but nothing in the
  video host reached it. Radius 2 m, as the task asked, and for its stated reason: a ray threads a gap
  between two balconies and calls a pass clear that a drone would clip.
- **A walk route must be built at the PED's speed.** See below — this was a real bug, and only the field run
  found it.
- **`?scene=N` (added earlier the same day) is what made this phase testable at all.** The program's fly and
  walk entries are at lap positions 6, 7 and 8; without a start index, checking them meant playing five drive
  scenes first — four minutes of car before the first frame of the thing under test.

### The bug the headless run found

The walk route was built with `pickRoute`'s driving default of `cruiseSpeed: 12` while the ped walked at 2.
The route's per-vertex speeds are what the station survey predicts the subject's position from, so a 15 s
tripod window was predicted to cover ~180 m of pavement instead of ~30 — and every candidate failed the dwell
test. The scene played, looked plausible in the log, and its tripod slot silently played a fallback.

| Walk scene, SF, seed 47 scene 8 | driving cruise (bug) | ped cruise (fixed) |
| --- | --- | --- |
| `stations.filled` | 0 | **2** |
| `stations.empty` / `fallbacks` | 1 / 1 | **0 / 0** |
| `rejected.dwell` | 8 | **0** |
| survey casts | 48 | **14** |
| survey latency (worst) | 16 frames | **2 frames** |
| scene length | 55.0 s | 42.0 s |
| `shots.safe` | 1.000 | 1.000 |

Recorded in `docs/edge-cases/route-graph.md` — nothing catches it in a test, because the survey is behaving
correctly on the numbers it was given.

### Measured (headless, `build/original/opensa`, seed 47, 2026-07-31)

**Fly scenes** — `&scene=6&scenes=2`, COUNTRYSIDE and LA:

| | scene 6 (COUNTRYSIDE) | scene 7 (LA) |
| --- | --- | --- |
| passes planned / flown | 5 / 5 | 5 / 5 |
| staging clearance casts | 35 | 35 |
| staging lifts (m, per pass) | 0,0,0,0,0 | 0,0,0,0,0 |
| **live guard probes / hits** | 45 / **0** | 45 / **0** |
| route gathered | 355.9 m | 362.3 m |
| scene length | 50.02 s | 50.02 s |
| settle | 250 ms | 249 ms |

The acceptance number is the guard's **0 hits over 90 probes**: the staging check cleared the flights
properly, and the live guard never had to climb. Both routes came in under the 350 m extent cap with the
trim doing its job (356 m and 362 m of route gathered, flown within the cap).

**Walk scene** — `&scene=8&scenes=1`, San Francisco: 160.3 m route, 82 waypoints, 62 probed, 0 route
rejections, `gait=walk@2m/s`, shots `station→high→chase→wing-l→crane`, 4 cuts, **`safe: 1.000` over 3 844
judged frames**, 0 pan clips, 42.0 s, 248 ms settle. One shot ended on a live sightline cut (`occluded: 1`) —
the tripod machinery working on a pedestrian.

**Drive scene, unchanged by the dispatch** — `&scene=1&scenes=1`, LA, `alpha(mod)`: 946 m route, 21.6 m
tightest corner, `safe: 0.989`, cross-track p95 0.16 m, 47.4 s.

**Tests**: 3 411 (from 3 379) — `fly.test.ts` 14, `walk.test.ts` 7, `WALK_SHOTS` 5, the gait tier 2, plus
`PROGRAM_LENGTH`/`parseSceneStart` from the same day's `?scene=` work. tsc + eslint clean.

### Owed to 08 — all settled

- ~~**Nobody has WATCHED either scene.**~~ **Watched 2026-08-01: the user's verdict is that both look good.**
  Every number above was an instrument; the walk's pavement offset, the aerial framing and whether five 10 s
  passes read as editing were human questions, and this is the answer. It does not retire `flyby`'s missing
  occlusion check — that is a gap in what is CHECKED, not in what was seen.
- ~~`engine-video-runs.ts` is ~1 100 lines with three scene kinds in it — should the three `runXScene`
  functions have their own files?~~ Looked at in 08 and deliberately left alone: the staging around them is
  genuinely shared, so splitting would trade one coherent module for three files plus a shared fourth.
  Revisit if a fourth scene kind lands.
- The walk scene has no `?at=` equivalent field check — `pinned` is threaded through and works, but no field
  round has used it on a walk. Still true, and now a small one: the kind itself has been seen.
