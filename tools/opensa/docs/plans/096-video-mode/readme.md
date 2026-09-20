# 096 — Video mode (self-directed showcase runs for trailer footage)

**Status: SHIPPED — all eight phases (2026-07-30/08-01), plus [09](09-planted-occlusion.md) BUILT 2026-08-01
(the planted-shot occlusion check, field verdict owed).** Close-out audit:
[`docs/audit/video-mode-096.md`](../../audit/video-mode-096.md); measurement record:
[`docs/benchmarks/opensa-engine/2026-08-01-headless-video-mode.json`](../../benchmarks/opensa-engine/2026-08-01-headless-video-mode.json).
**FIELD-ACCEPTED 2026-08-01**: the user watched the walk and flythrough scenes and the verdict was that they
look good. That closes the one acceptance line that mattered — every 07 number is an instrument, and the
pavement offset, the aerial framing and `flyby`'s unchecked eye were human questions no run could answer.
Nothing is owed.

Planned 2026-07-30 and graduated from `docs/ideas/video-mode/` the same day it was researched — the four-way
repo sweep (paths/driving, camera, streaming/host, player/vehicles) and every user decision moved into this
doc, per the lifecycle rule that a validated idea's research record MOVES into the plan.

**Goal: `?video=1` boots the game into a bounded, seeded, self-directed showcase** — scenes 1…100 of the
seed, then an end card (D2 as revised). A random car — mod cars first — spawns on a road, the player gets in
and cruises a route generated from the game's own `NODES*.DAT` graph while cameras cut between
occlusion-checked tripod stations and chase/front/rear/wing/overhead views; other scenes walk the player or
fly the camera. Every scene is five cameras on a fully streamed
world, UI hidden, black overlay between scenes. The user screen-records with OS tools and edits
the cuts out by hand.

**NOT named "cinematic"** — that word belongs to the shipped 080 follow-camera chain in every doc, test
and ledger. This feature is a *director* over that camera, plus an autopilot under the car.

## Decisions (user, 2026-07-30 — frozen for v1, D2 revised 2026-07-31)

A revision is written INTO the row it changes, with its date and what it replaced, rather than the row being
rewritten: a phase doc that quietly matches today's code cannot be read against the code it was built from.

| # | Decision |
| --- | --- |
| D1 | Entry `?video=1`; `&seed=N`. **Revised 2026-07-31: a scene's length is not an input at all.** A scene is FIVE cameras (`SHOTS_PER_SCENE`); a shot that rides the car runs a fixed 10 s clip, a planted one runs until the car has driven out of its view. The scene is as long as its five shots take, and nothing chooses that. (Was: `&from=10&to=25`, a drawn fragment length) |
| D2 | Region cycle LS → LV → SF → Country → Desert. **Revised 2026-07-31: a run is a BOUNDED SEQUENCE — scenes 1…100 of the seed, then it stops on an end card.** `&scenes=N` takes a shorter one; 100 is the ceiling, not just the default. (Was: endless until the tab closes) |
| D3 | Program per cycle: drive scenes in ALL 5 regions → camera flythrough in 2 → on-foot walk in 1 |
| D4 | A drive-past is fine but the camera must not linger on an empty frame after the subject passes. **Revised 2026-07-31 with D1**: the 5 s floor and the adaptive length are gone — a riding shot is exactly 10 s and a planted one ends when the car goes, which is what the guard now enforces on its own short clock |
| D5 | Routes favour long straights with gentle curves; length ≈ fragment duration × cruise speed; random from the node graph (curated routes maybe later) |
| D6 | Time of day snaps to the debugger's preset slots: 00:00 / 06:00 / 12:00 / 18:00 / 21:00 (`debug-overlay.tsx:50`) |
| D7 | Weather random WITHIN the current region's own timecyc set (LS scene → LA weathers only) |
| D8 | Driving style: calm cruise, speed capped by route curvature; no drift/stunts |
| D9 | `?seed=` determinises car, weather, hour, route and shot list; active seed printed `[video] seed=…` |
| D10 | Custom cars first via a build-time ledger (vehicle-installer) — approved. **Revised 2026-08-03: custom cars ONLY.** One drivable ledger slot and every scene of the run drives a mod car; no ledger slot in the roster and every scene takes a stock one. The ledger is a switch, not a share. (Was: preferred 4 times in 5, with stock classics still appearing) |
| D11 | Between scenes: plain black DOM overlay owned by the module (user cuts it in the editor) |
| D12 | UI hidden via the existing `'fly-camera'` event; no on-screen status during a scene (console `[video]` tag only) |
| D13 | Clock drift accepted (~16 game minutes over a 25 s fragment); no time freeze |
| D14 | Out of scope v1: interior/cabin camera, in-page recording, traffic, drift driving |
| D15 | Routes stay INSIDE one region (sidesteps `CityZoneSystem`'s 6 s weather rewrite on crossing, `engine-canvas-host.tsx:913`) |
| D16 | `vehicle-enter-null-body` recheck 2026-08-30: video mode IS the stress test; if the crash returns, the defensive `readBody` guard ships in the same change |

## What the engine study established (constraints — every phase obeys these)

1. **The attach pattern is fixed.** A module in its own file with a narrow host interface of thin
   accessors, self-gating on the URL (absent → immediate return), called once at the end of `boot()`
   (`engine-canvas-host.tsx:1633-1697`). `setupPerfRuns` / `setupPhysRuns` are the two shipped examples;
   the host-side footprint of an entire subsystem is one ~20-line block. Video mode adds a third block and
   NOTHING else to the host beyond the accessors it composes (most already exist for bench/phys).
2. **`packages/engine` is untouched.** The camera lives in `apps/web` (app layer); autopilot and route
   logic go in `packages/game` (engine-tagged, no renderware imports outside `adapters/`). Layer tags:
   `app → engine`, never the reverse (`eslint.config.ts:284`).
3. **Camera authority is a priority chain** in `resolveCamera` (`apps/web/src/ui/camera/engine-camera.ts:87-110`),
   currently `bench > flyEye > follow`, pinned by `engine-camera.test.ts`. Video inserts DIRECTLY BELOW
   bench: `bench > video > flyEye > follow` — bench numbers stay untouchable by construction (080 ground
   rule), and video, being a scripted run like bench, outranks the interactive modes while active. The
   precedent is `benchCamera` itself: an external module owning the frame via a plain `{eye, target}`
   (`engine-canvas-host.tsx:1182`, honoured at `camera-director.ts:99-101`).
4. **Scene start gate — copy the phys recipe, never invent a third** (`engine-phys-runs.ts:64-70`):
   `pendingCells === 0` LIES for ~1 s after a teleport (still reads the old ring) → wait
   `TELEPORT_NOTICE_SECONDS = 1`, then drain `pendingCells`, then ~2 s warmup for collision/clutter (no
   pending counter of their own). The unfixed cold-teleport spike (plan 091: ~20 frames of 110–170 ms)
   is waited out behind the black overlay. All timing on the frame clock (`until()`/`waitSeconds()`
   pattern), never `setTimeout`.
5. **Synthetic driving input is a solved path.** `ScriptedDriveSource implements InputState` is
   permanently installed in `CombinedInput` (`engine-canvas-host.tsx:487-488`) and reaches the Rapier
   raycast controller through the exact player path (`enter-vehicle.system.ts:774-856`). The autopilot is
   a closed-loop SIBLING, not a change to that path. Caveats: `CombinedInput` SUMS move vectors
   (`combine-input.ts:45-55`) — keyboard input during a scene adds to the autopilot's (accepted v1
   limitation: hands off the controls while recording); steering slews at `STEER_RATE = 1.2 rad/s`
   (`enter-vehicle.system.ts:185`) through a speed-dependent limit (`steering.ts`), so the controller
   must anticipate, never react.
6. **Driving state is a singleton** on `EnterVehicleSystem` — exactly ONE car can drive. Enough for v1;
   traffic is roadmap 0.5.0 material.
7. **Occlusion queries exist and are cheap**: `pathClear` (line-of-sight boolean,
   `physics-world.ts:901`), `sphereCast` (`:1293`), `raycast` (`:962`), all GTA Z-up. Budget ≤ 5
   casts/frame total (080 ground rule; today's rig spends 2).
8. **The discrete-gate trap is documented**: a hard boolean over rays "has no continuous middle, so it
   cannot ease" (`docs/postmortem/080-cinematic-camera/multiray-collision.md`). Station choice is exactly
   that shape → hysteresis + minimum dwell (D4's 5 s floor helped, until D4's 2026-07-31 revision removed
   it; the dwell now comes from a riding shot's fixed clip) + amortised surveys, and every cut
   DECLARED to the `[cam] jump` watchdog (`engine-canvas-host.tsx:1961`) and to
   `camera-transitions.test.ts`'s 1 u/frame continuity exam.
9. **Weather is instant when asked**: `WeatherTransition.begin(index, 0)` (how the bench sets it,
   `engine-canvas-host.tsx:1653`); the 6 s default fade (`game-runtime-config.ts:238`) is for in-scene
   artistic changes only (none in v1).
10. **Mod provenance does not survive the build** (verified against a built `carcols.dat`) — but
    `vehicle-installer`'s `install.ts:52` already collects the `Set<string>` of mod-installed slots and
    never writes it. The ledger phase emits it the way `vehicle-features.txt` is emitted.
11. **Two coordinate spaces**: gameplay/physics GTA Z-up, camera output engine Y-up,
    `toEngine(gta) = (x, z, −y)`. Director math runs in ONE space and converts at the physics boundary
    (the 080 rule).
12. **The ownerless mode must be impossible** (`docs/restrictions/architecture.md`, the 094 lesson): the
    module is the single owner of the overlay and the camera in every mode INCLUDING headless, and it
    logs what it staged (`[video] scene 3/5 lv drive seed=…`).

## Architecture

```
apps/web/src/ui/engine-video-runs.ts     setupVideoRuns(host: VideoRunsHost) — gate, sequencer loop,
                                         overlay, UI hide, settle, spawn/seat, scene teardown
apps/web/src/ui/video/                   director.ts (shot scheduler + cuts), shots.ts (shot presets +
                                         framing math), stations.ts (tripod survey/occlusion), fly.ts
                                         (flythrough path), rng.ts (seeded PRNG)
apps/web/src/video-presets.ts            region presets (weather pools, time slots, cycle order),
                                         program table (D3), tuning constants in one config object
packages/game/src/paths/route-graph.ts   pure graph ops over nodes+links (no renderware import) — DONE 01
packages/game/src/paths/route-builder.ts seeded walk + the drivable line (offset, smoothing, speeds) — 01
packages/game/src/paths/rng.ts           mulberry32 + weighted pick, the one random source — DONE 01
packages/game/src/adapters/path-graph.ts loads NODES*.DAT → RouteGraph (renderware allowed: adapters/) — 01
packages/game/src/vehicle/path-follow.ts PathFollowSource implements InputState (pure-pursuit autopilot)
packages/renderware/src/parsers/binary/paths.ts   + links adjacency (was discarded at parse) — DONE 01
tools/vehicle-installer/…                emits data/vehicle-mods.txt (the ledger)
scripts/debug/video-routes.ts            offline route-builder validation (kept, debug README row)
```

Host additions (one block at `engine-canvas-host.tsx:~1697` + accessors): `setVideoCamera` (mirrors
`setBenchCamera`), `runPath`/`arrived` threading from `controllerSystem` (phase 07), everything else
composed from accessors already wired for bench/phys (teleport, hour, weather, stream, vehicles, samples,
`toEngine`, `params`, `events`).

Doc obligations (same-change rule): rows in `docs/development/query-parameters.md` (`video`, `from`,
`to`, `seed` — and this param family is the doc's stated trigger to consider the typed reader),
`docs/contracts/vehicles.md` (ledger name + misspelling behaviour), `docs/features/video-mode.md` (+ README
row), `docs/debug/README.md` (new script), `docs/commands.md` if a CLI knob is added. Close-out owes the
audit + benchmark per the big-rework rule.

## Phases and priority

Priority meaning: **P0** — the feature exists and is field-checkable (a car drives a route on camera);
**P1** — the trailer look (director, variety, mod cars); **P2** — breadth and close-out. Order is the
dependency order; 06 is independent and can run any time before 05.

| Phase | Title | Priority | Depends on |
| --- | --- | --- | --- |
| [01](01-path-graph-and-routes.md) | Path graph + seeded route builder (offline-first) — **SHIPPED** | **P0** | — |
| [02](02-module-skeleton-and-autopilot.md) | Module skeleton + autopilot drive scene v0 (chase cam) — **SHIPPED** | **P0** | 01 |
| [03](03-camera-authority-and-shots.md) | Video camera authority + shot presets + framing — **SHIPPED** | **P1** | 02 |
| [04](04-stations-and-occlusion.md) | Tripod stations: survey, occlusion, cuts without flicker — **SHIPPED** | **P1** | 03 |
| [05](05-sequencer-regions-presets.md) | Sequencer: region cycle, weather/time presets, car pick — **SHIPPED** | **P1** | 02 (04 for full look) |
| [06](06-mod-car-ledger.md) | Build-time mod-car ledger (tool + pack + runtime read) — **SHIPPED** | **P1** | — (feeds 05) |
| [07](07-walk-and-fly-scenes.md) | Walk + flythrough scenes — **SHIPPED** | **P2** | 03, 05 |
| [08](08-polish-and-closeout.md) | Polish, empty-frame guard, docs, benchmark, audit — **SHIPPED** | **P2** | all |
| [09](09-planted-occlusion.md) | A planted shot checks where it stands — **BUILT, field owed** | **P2** | 03, 04 |

After 02 the feature is REAL (one region, chase camera, seeded route — recordable footage, ugly cuts).
After 05 it matches the user's brief minus walk/fly. After 08 it is done by the workflow rules.

## The two field risks (validated the 081 way — short rounds against a HARD case)

1. **Autopilot cornering** (02): validated on telemetry first (cross-track error, lateral-g band), then a
   field look at a route with a real corner — never a gentle one.
2. **Cut flicker** (04): the discrete station gate against facade recesses/columns; hysteresis + dwell +
   amortised survey, judged in the field on a colonnade street, with the `[cam] jump` watchdog as the
   objective tripwire.

## Measured-numbers ledger

Per the standing rule, every phase records its numbers here (and perf figures go to `docs/benchmarks/`
before analysis). Empty until phases run:

- 01: **DONE 2026-07-30.** Graph: 30 587 vehicle nodes over 73 area files, **0 unresolved links, 0 links
  without a reverse edge** (the table is fully mutual — travel direction is NOT expressible from it, see the
  phase doc's note for 02). Routes, 5 seeds × 40 tries per region, target 390 m (25 s × 12 m/s × 1.3),
  measured against `game-src/original` (no `build/original` on the machine; re-check on the built tree in 02):
  accepted **LA 52 · VEGAS 62 · SF 65 · COUNTRYSIDE 45 · DESERT 69** (plan floor: ≥ 20) — mean length
  397–403 m against the 390 m target, **max turn 20.1–32.1° (ceiling 35)**, tightest smoothed corner
  9.8–19.2 m, **0 driven points outside the region in every region**, straightness 71–88 % of junction turns
  under 5° and ≤ 2 % over 25°. Rejects are almost entirely `too-tight` (112–136 per region) against 2–6
  `dead-end` and 6–17 `region` — the accumulated-turn budget is the binding constraint, and it is the knob
  05 loosens if variety suffers. Two constraint bugs the offline run caught before any frame: curvature read
  off unevenly spaced points reported 2.0 m "hairpins" on a road whose sharpest junction was 32°, and the
  per-junction ceiling let five legal turns bend 125° inside ten metres. Both fixed (uniform 2 m resample +
  8 m curvature baseline; a 45°-per-25 m turn budget), which is what moved the tightest corner from 2.0 m to
  ~19 m and the slowest target speed from 2.2 m/s to 6.9 m/s.
- 02: **DONE 2026-07-30.** Routes re-validated on the BUILT tree (`build/original/opensa`,
  `scripts/debug/video-routes.ts`): identical to 01's `game-src/original` numbers to the digit — 30 587 nodes,
  0 unresolved links, 0 one-way links, LA 52 · VEGAS 62 · SF 65 · COUNTRYSIDE 45 · DESERT 69 accepted, LA's
  tightest accepted corner 19.2 m. So the built `data/paths` is the source tree's.
  **Headless field run** (`TAG='[video]' tools-debug/bench-harness/drive.js … '&video=1&seed=N'`, DPR 1,
  4 seeds, 29 LS drive scenes, 10-25 s each): corners driven **20.8-568 m** (tightest 20.8 m at a 20.6°
  junction — near the builder's 19.2 m LA floor); **cross-track error p95 ≤ 0.331 m, max ≤ 0.503 m** against
  the plan's 1.5 m / 3 m floors; **|gLat| p95 ≤ 0.293 g** against the 0.35 g calm band (single-frame maxima
  reach 1.32 g — kerbs and drain lips, not cornering); mean speed **10.2 m/s** against a 12 m/s cruise
  (−15 %, inside ±20 %, and the standing start is inside every window). **fps stability gate 242-251 ms** —
  i.e. the 30-frame minimum every time: the cold-teleport spike (plan 091) was always over before the gate
  started, so the overlay costs a quarter second, not the ~2 s the spike would have. **1 stuck flag in 29**
  (3.4 %): a scene that started on an 18° Los Santos hill the `admiral` could not climb — the guard, not the
  controller. Determinism: seed 47 re-run after the stuck rule changed reproduced all 8 routes, hours,
  weathers and cross-track percentiles **to 3 decimal places**. Autopilot unit tests: 10, on a kinematic
  bicycle carrying the real 1.2 rad/s slew.
- 03: **DONE 2026-07-30.** Authority `bench > video > flyEye > follow`; six presets (`chase` yields the frame,
  `nose`/`high`/`wing-l`/`wing-r` track, `flyby` plants). **Headless 5 seeds × 5 scenes (47 · 3 · 11 · 202 ·
  88), `build/original/opensa`, DPR 1: 36 951 directed frames, car inside the safe frame 99.09 %** (per-seed
  97.24-100 %) against the plan's 95 % floor; **0 `[cam] jump` lines in all five runs**; 59 cuts; pan-rate cap
  bit on 2.7 % of directed frames; shortest dealt shot 5.2 s against the 5 s floor; every scene ended
  `ran-out` (no stuck, no early guard cut of a shot that was still framing its car). Autopilot unchanged and
  still inside its band (cross-track p95 0.11-0.31 m); settle gate 248-252 ms, i.e. 02's number. **The one
  outlier is the `flyby`**: in seed 11 scene 3, where it is the only placed shot, its own safe share is
  75.8 %, because the pass sweeps the car out of frame over the last stretch. The first geometry (a 2.7 m
  standoff, taken from this doc's own example multiplier) was worse — 88.7 % and 266 clipped frames in one
  scene — and moving it to 5.4 m aside / 23 m ahead cut the peak angular rate roughly in half: the plan's
  "the guard cut, never a higher cap" held, the fix was the STANDOFF. Two measurement notes: the first run's
  11 `[cam] jump` lines were all paired with `[slow] frame 120-224` and each equalled the car's own travel
  over that frame — the watchdog does not normalise by `dt`, now in `docs/edge-cases/camera-rig.md`; and a
  cut is a discontinuity, so a pan-rate assertion that measures across one is measuring the cut.
- 04: **DONE 2026-07-30.** The `station` shot, an amortised survey behind it, and `?at=x,y` to pin a scene.
  **Headless 5 seeds × 5 scenes, `build/original/opensa`, DPR 1: 35 710 directed frames, safe frame
  99.18 %** (worst scene 93.5 %), **0 `[cam] jump` lines in every run**. **12 of 12 tripod slots played from a surveyed station (100 % against the plan's
  ≥ 60 % floor), 0 fallbacks**; 14 surveys, all filled, rejecting 10 candidates on sightline and 2 for having
  no ground — a real street does reject, which is what makes the fill rate mean something. **≤ 3 casts in
  EVERY frame** (205 total, the whole budget the module was given), verdict within 14 frames (0.23 s). Cut
  causes over the run: 55 scheduled, **1 occluded** (the live tripod check firing in the field, once), 0
  empty. Pan cap bit on 6.2 % of directed frames (03: 2.7 %) — tripods pan, and none of it cost a frame.
  **The prediction was the phase's real work, in three measured rounds**: predicting off the route's target
  speeds alone put a station **19.5 m** from the car (the autopilot cruises ~15 % under target, 096/02);
  scaling by the car's live speed took it to **13.5 m**; waiting for the car to be UP TO SPEED before
  predicting from it took it to **6.6 m max, median 1 m** (pinned run: 0.7 m). Every remaining large one is a
  window that still covers part of the launch. The other thing the field found: a scene OPENING on a tripod
  had nowhere to amortise its casts and played a fallback four times out of twelve — the survey now runs
  behind the black overlay, and fallbacks went to zero.
  **The pin, and what it found**: `&at=847,-1772` (the hardest accepted LA start `video-routes.ts --worst`
  prints, a 19.2 m corner) drove that street in all 4 scenes — safe frame 100 %, 3 stations filled, 0 jumps,
  ≤ 3 casts/frame, prediction error ≤ 6.3 m. The FIRST pin tried was downtown LS (`&at=1450,-1500`) and it
  produced **no route at all** — 40 rejected walks per scene, five scenes running: the builder's 45°-per-25 m
  turn budget cannot cross a right-angle grid whose blocks are shorter than the window. The runner logged the
  fallback each time, which is the only reason the run was not read as a downtown capture. Written up in
  `docs/edge-cases/route-graph.md`; loosening the budget is 05's variety knob.
- **Field round 1 (2026-07-31) — the first human look at the footage, and the one thing every headless number
  had been blind to.** The report was "the camera shivers at these angles", with a side-on `wing` frame and a
  `nose` frame. The instrument built for it: `?video=1&diag=1` writes one `[diag]` line per SCENE holding one
  row per rendered frame (drawn car, both headings, eye, aim, screen position, cut flag), and
  `scripts/debug/video-shiver.ts` reports each channel's high-frequency energy — the RMS second difference,
  which is small for smooth motion however fast, and large for a buzz. Seed 47, `build/original/opensa`,
  DPR 1, 120 fps headless, measured per shot BETWEEN cuts.
  **Where the energy was** (scene 1, per frame²): `wing-l` screen x **6.0 px** against `nose` 0.5 px and a
  planted `station` 0.6 px — while the DRAWN car moved smoothly in all three (0.006-0.009 m) and a planted
  eye did not move at all (0.0000 m). So neither the physics nor the frame interpolation was the noisy party:
  the eye was (0.023 m), and its jitter was **along the travel axis** (`fwd 0.034` against `lat 0.0016`).
  **The mechanism**: a `tracking` shot damped its eye in WORLD space against a car at a cruise, so the damper
  carried a permanent lag — the mount sat **1.1 m behind its authored offset** — and closed it by a step
  proportional to `dt`. Frame-clock jitter (3.1 ms RMS, 16-19 ms spread) modulated that step directly. It only
  reached the screen on the wing shots because there the lag axis is perpendicular to the view; on `nose` the
  eye rides 10 m ahead and the same jitter only changes the distance. That is why four headless rounds and two
  phase acceptances never saw it, and why the two field frames were the two they were.
  **The fix** (`director.ts`): a car-mounted shot damps its MOUNT — the damper is re-based against the
  subject, reading its state relative to where the car stood last frame and writing it back relative to where
  it stands now. A planted eye re-bases against the world and is untouched. **After, same seed, same scenes:**
  `wing-l` **6.0 → 0.61 px**, `wing-r` 4.8 → **0.0020 px**, `nose` 0.54 → **0.0011 px**; the eye's jitter now
  equals the car's to the third decimal (0.0127 vs 0.0137 m — a rigid mount, by definition), and the mount
  holds its authored offset (−0.21 m → +1.30 m, i.e. `0.4 × hy` exactly) instead of trailing it. A scene that
  took a **5.3 s stall** mid-shot went from 17.3 px to 0.0019 px: a hitch no longer throws the framing at all.
  Planted shots unchanged (`station` 0.57 → 0.44 px, eye jitter still 0.0000).
  **Also measured, and left alone:** the mount is built on the fixed-step gameplay heading while the car is
  DRAWN with the interpolated one — the disagreement is **mean 0.01-0.04°, max 0.16°**, an order below the
  fixed residual, so the pairing 096/02 chose stands and now has a number behind it.
  **Round 1b — the same report came back: "the shiver has not gone, maybe it got worse."** It had not gone,
  and the measurement above is why: it judged the pose against the car it was COMPUTED from, which measures
  the director's intent and is blind to WHICH FRAME the pose lands in. The director was stepped from the
  module's own rAF pass, so the host consumed it a frame later and the screen paired this frame's car with
  last frame's camera — the pairing carries the car's whole travel for that frame, and frame-clock jitter
  modulates it. Re-read off the SAME captures, both pairings, `wing-l` horizontal off-axis jitter:

  | build | pairing rendered | as rendered | intent |
  | --- | --- | --- | --- |
  | as shipped by 096/04 | frame-late | **0.332°** (≈ 7 px) | 0.311° |
  | + the mount fix | frame-late | **0.305°** | 0.032° |
  | + the director stepped IN the host loop | same-frame | **0.0050°** (≈ 0.1 px) | 0.0050° |

  So the mount fix was real and necessary — it is what takes the same-frame number from 0.311° to 0.032° —
  but on its own it moved what the viewer sees by 8 %. The fix that mattered to the eye is the wiring:
  `setVideoStep` installs the director's step and the host calls it inside its loop, between the car's render
  pose and the camera snapshot, so the shot is composed from the frame it is drawn in. Both together are
  **66× less shiver than the code the user first watched**. A side effect worth recording: with the module's
  extra rAF pass gone the frame clock itself steadied, dt jitter 3.1 → 2.2 ms RMS and its spread 16 → 5 ms.
  `video-shiver.ts` now prints both pairings side by side and the `frame-late` column is a regression
  tripwire. The lesson — a metric taken against the input rather than against what renders — is in
  `docs/restrictions/architecture.md` next to the rule itself, because it is what let a reported bug survive
  a measurement that called it fixed.
  **The second defect the same measurement found**, fixed in the same change: `anchorFor` mirrored the
  lead-room anchor on a hard threshold (`|screenMotion| < 2 m/s`), so the anchor stepped **0.24 of the frame's
  width** in one frame when the signal drifted over the line — and `nose` is the shot that sits on it, because
  its eye rides a few degrees off the car's axis and puts the crossing signal at ~0.11 × speed. Lead room is
  now PROPORTIONAL to the crossing speed (smoothstepped to ±1 at 2 m/s, which every wing and tripod shot
  saturates anyway), so the table's `anchor.x` states how MUCH room the shot wants and the motion decides
  which side it goes on. Two consequences worth knowing: a car that is not crossing the frame is now framed
  centred rather than on the authored side (there is no lead to give), and `nose` at a cruise gets ~66 % of
  its room instead of an arbitrary full-or-nothing. Swept over ±8 m/s the anchor now moves at most **0.0036
  per 0.04 m/s** against the old 0.24 step; both the mount and the anchor tripwires are `negative cases` in
  `shots.test.ts` / `director.test.ts` and both were confirmed to FAIL against the code they replaced.
  **Acceptance for the whole round**, the 03/04 exam re-run on the same 5 seeds × 5 scenes:
  **35 733 directed frames, safe frame 99.18 %** (per-seed 97.86-100 %), **0 `[cam] jump` lines**, 56 cuts,
  **0 empty-frame cuts**, 1 occluded, all 25 scenes ended `ran-out`. That is 04's number to the digit, with
  the pan cap bitting slightly less often (5.9 % against 6.2 %) — three framing changes and the exam did not
  move, which is exactly the point: these numbers were never able to see the defect and still cannot. They
  are here to prove nothing ELSE broke. **The verdict that closed the round was the user's own second look:
  "the camera has stopped shivering at every angle I saw."**
- 05: **DONE 2026-07-31.** The cycle, the presets and the car pick — `apps/web/src/ui/video/presets.ts` is the
  table, `engine-video-runs.ts` stays about staging. **Headless, seed 47, `build/original/opensa`, DPR 1, two
  full cycles (17 scenes, 10 of them drives):** every region visited **in D2's order, twice** (LA → VEGAS →
  SF → COUNTRYSIDE → DESERT), **12 680 directed frames at 100.00 % safe frame**, **0 `[cam] jump` lines**,
  20 cuts, pan cap on 1.56 % of frames, every scene ended `ran-out` — 0 stuck, 0 empty-frame cuts, 0 throws.
  **0 mid-scene weather changes** (D15's tripwire never fired: no route left its region). Ten drives, **ten
  different cars** off a 144-model road-car roster (`broadway`, `fbiranch`, `packer`, `patriot`, `copcarla`,
  `previon`, `benson`, `mule`, `tampa`, `picador`), each in one of its region's own weathers and one of the
  five hour slots. The `fly`/`walk` entries logged their skip and their regions DIFFERED between the two laps,
  which is the program being rebuilt per lap rather than one fixed eight.
  **Two things the phase doc did not say, decided here.** The sequencer's pure half lives in
  `ui/video/presets.ts` beside the director rather than at `apps/web/src/video-presets.ts` — the module layout
  03/04 settled on. And the mod-car preference draws its two branches from DISJOINT pools: the first cut let
  the stock branch fall back on the whole roster, which a unit test caught as a realised share of 0.90 against
  a configured 0.80. That is not a rounding difference — the share would drift with how many slots a game has
  modded, and a heavily modded install would stop showing stock classics at all, which is the half of D10 that
  is easy to lose. Disjoint pools make the realised share BE the configured one, which is also the only way
  the phase's own acceptance ("mod-car share ≈ the configured preference") means anything.
  **Not measurable yet:** the mod-car share itself (0 % — `data/vehicle-mods.txt` is 06's to write; the
  runtime reader ships here, tolerant, and an absent ledger is an empty set). The ledger's FORMAT stays 06's
  to confirm and to record in `docs/contracts/vehicles.md`.
  New tool: `scripts/debug/video-accept.ts` rolls the exam up off a harness log, so the next phase re-sits it
  against the same question rather than re-reading JSON by hand.
- **05a: D2 revised (user, 2026-07-31) — a run is a bounded SEQUENCE.** `?seed=47` now means scenes 1…100 of
  seed 47 and then a stop, on a black end card reading `sequence complete · seed 47 · N scenes`; `&scenes=N`
  takes a shorter one and 100 is the CEILING, so a longer sequence stays a decision. The chrome is not handed
  back — it would put the HUD into the last frame recorded.
  **The one judgement call inside the change: a skipped `fly`/`walk` entry still consumes a scene index.** A
  scene's identity is `(seed, index)`, and it has to survive 07: if skips were free, the day the walk and
  flythrough scenes land every later scene would re-seed, and every field note naming "scene 57 of seed 47"
  would point at a different scene. The cost is that a 100-scene run plays ~62 drives until 07 fills the rest.
  **What a seed does NOT fix, stated because the request was "strictly reproducible":** time, weather, route,
  car, paint and the SHOT LIST all derive from `sceneSeed(master, index)` and reproduce exactly — a re-run of
  seed 47 matched its manifest byte for byte. Frame-by-frame camera MOTION does not, and cannot: the director
  integrates real `dt`, so an early guard cut (empty frame, blocked tripod) depends on how the frames fell.
  Two runs of one seed are the same scenes, shot for shot, and may differ in where a shot was cut short.
- 06: **DONE 2026-07-31.** The mod-car ledger: `vehicle-installer` writes `data/vehicle-mods.txt`, the
  renderware text parsers read it back (`vehicle-mods.parser`, beside `vehicle-features.parser`), and the app
  layer feeds it to 05's car pick. **`--in mods-src/original/vehicles` → 12 slots**, exactly the corpus the
  research counted (`admiral alpha banshee comet elegy hermes petro previon stallion stratum supergt
  yosemite`); gostown, carcer and anderius carry 2 mod cars each. The `data/` route needed no change — the
  built tree copies the whole directory, which `vehicle-features.txt` already proves.
  **Field check on the BUILT game** (`--rebake original`, 12 cars, 295.1 MB of `.osm`, the sanctioned in-place
  route rather than hand-copying a file into a build): `build/original/opensa/data/vehicle-mods.txt` carries
  the 12, video mode logs `144 road cars, 12 mod slots` and marks its picks `(mod)` —
  `alpha → comet → petro → previon → banshee` over the first five scenes of seed 47.
  **The invariant, confirmed in the field rather than only in a test:** those five scenes kept the SAME scene
  seeds, hours, weathers and routes as the pre-ledger run (scene 1 is still `hour=0 SUNNY_LA route=392m
  corner=48.5m`) and changed only the car. That is 05's "the ledger must not change how far the seeded stream
  advances" holding on real data — a seed names the same scenes whatever mods are installed.
  **Realised mod share**, computed off the real roster and ledger through the same pure `pickCar` (100 scenes
  × 5 seeds — the pick is deterministic in `(seed, index)`, so this needs no boot): **0.77-0.84 against the
  configured 0.80** (σ ≈ 0.04 at n = 100), 27-32 distinct cars per 100 scenes.
  **The risk the phase named is pinned by a test**: `--rebake --only zr350` MERGES into the ledger. A rebake
  rewriting it from its own selection would tell video mode that every other mod car in the build is stock,
  and nothing else in the game would notice.
- **05b: D1/D4 revised (user, 2026-07-31) — a scene is FIVE CAMERAS, and it is as long as they are.**
  `&from`/`&to` are gone: nothing chooses a scene's length any more. A shot that rides the car runs a fixed
  10 s clip (it has no natural end — the car never leaves its frame — so where it ends is an editorial
  decision, not a measurement); a PLANTED shot runs until the car has driven out of its view, with a 15 s
  watchdog for the car that never arrives. Two new presets: `top` (overhead) and `crane` (higher and further
  back than `high`), taking the table to nine.
  **The five are DISTINCT.** The first cut kept the old "not twice in a row" rule and the very first field
  scene came back `chase→flyby→crane→wing-l→chase` — four cameras in five slots. With nine presets there is
  never a reason to spend a slot on a second helping of one.
  **`top` is overhead but deliberately NOT straight down** (~21° off vertical): `screenBasis` takes its roll
  from the view direction's HORIZONTAL component, which vanishes at a perfectly vertical view, so a preset
  sitting on that singularity would have no defined roll — and would shiver for exactly the reason field
  round 1 did. The constraint was already written in `engine-camera.ts`; this is the first preset it binds.
  **Route sizing is the consequence that needed measuring first**, before any of it was built: five shots at
  12 s of road each is ~936 m against the old 390. Measured on the built tree, 120 walks per region:
  **LA 19 · VEGAS 33 · SF 10 · COUNTRYSIDE 13 · DESERT 17 accepted** (at 390 m it was 35/40/40/33/42). At San
  Fierro's rate, 40 tries would have failed about 3 scenes in 100, so `ROUTE_TRIES` went 40 → 120, which puts
  it under 1 in 10 000; a walk is a graph traversal behind the black overlay and costs nothing on camera.
  **Headless, seed 47, five drive scenes** (the sixth index is a `fly` skip, and the run said so —
  `run complete: 5 scenes played of 6`): scenes ran **40.4 / 43.7 / 47.4 / 50.0 / 52.4 s**, every one ending
  `shots-done` rather than on a clock; routes 937-967 m; **22 064 directed frames, safe frame 98.21 %**,
  **0 `[cam] jump` lines**, 20 cuts of which **4 were the empty-frame guard ending a planted shot** — that
  cause used to be 0, and it is now the mechanism the user asked for rather than a failure. Scene length is
  an OUTCOME in the capture now, not an input.
  One bug this round's own test caught before the field did: the early `advance` return that ends a scene
  skipped counting the last shot's cut cause, so every scene would have under-reported one cut.
- 07: **DONE 2026-07-31** (numbers transcribed here 2026-08-01 — the row was left empty on the day, which is
  the ledger rule being missed, not a phase without measurements; the phase doc carried them all along).
  Walk and fly scenes, dispatched by `sceneOfKind`. **Headless, `build/original/opensa`, seed 47.**
  **Fly** (`&scene=6&scenes=2`, COUNTRYSIDE then LA): **5/5 passes flown** in both, 35 staging clearance casts
  each, **every lift 0 m**, and the acceptance number — the live guard's **0 hits over 90 probes**, i.e. the
  staging check cleared the flights properly and the guard never had to climb. Routes 355.9 m / 362.3 m under
  the 350 m extent cap with the trim doing its job; 50.02 s each; settle 250/249 ms.
  **Walk** (`&scene=8&scenes=1`, SF): 160.3 m route, 82 waypoints of which **62 probed**, 0 route rejections,
  `gait=walk@2m/s`, shots `station→high→chase→wing-l→crane`, 4 cuts, **safe 1.000 over 3 844 judged frames**,
  0 pan clips, 42.0 s, 248 ms settle — and one shot ended on a live sightline cut, the tripod machinery
  working on a pedestrian.
  **Drive, unchanged by the dispatch** (`&scene=1&scenes=1`, LA, `alpha(mod)`): 946 m route, 21.6 m tightest
  corner, safe 0.989, cross-track p95 0.16 m, 47.4 s.
  **The bug only the field run found**: a walk route was built at the DRIVING cruise (12 m/s) while the ped
  walks at 2, so the station survey predicted a ~15 s window over ~180 m instead of ~30 — all 8 candidates
  rejected on dwell, the tripod never filled, and a fallback played silently. The only signal is
  `stations.rejected.dwell` against `stations.filled` in a scene report; now a restriction and an edge case.
  Tests 3 379 → 3 411.
- 08: **DONE 2026-08-01.** The close-out: the benchmark, the audit, the soak, D4's frozen table, the variety
  audit, fault injection and D16's evidence.
  **The benchmark, and why it is not an on/off A/B** (`docs/benchmarks/opensa-engine/2026-08-01-headless-video-mode.json`):
  with video OFF nothing drives, nothing streams and the camera does not move, so the difference between the
  two runs would be the scene, not the module. What is measured instead is the module's ENTIRE per-frame
  footprint — the one `setVideoStep` call, which holds the director, the framing, the autopilot solve and the
  live probes. **Drive-only (4 scenes, 22 817 frames): mean 0.0172 ms. The whole soak (235 348 frames, all
  three kinds): mean 0.0096 ms**, worst-scene p95 0.1 ms. `performance.now()` is coarsened to 0.1 ms headless,
  so a single frame reads 0 or 0.1 and only the mean over thousands is a measurement — the honest sentence is
  *under 0.2 % of a 120 Hz frame*.
  **The soak — 40 scenes, 32.7 minutes unattended, 0 throws, 40/40 played.** 139 524 directed frames, safe
  98.98 %, **0 `[cam] jump` lines**, 117 cuts, 1 `stuck` in 30 (02 measured 3.4 %; this is 3.3 %). No drift of
  any kind over the run — by ten-scene block, settle **249 · 249 · 250 · 250 ms**, step mean **0.0117 · 0.0091
  · 0.0096 · 0.0084 ms**, safe **0.9874 · 0.9869 · 0.9973 · 0.9881**. The staging timeline is flat to the
  millisecond: all 40 settles inside **241-252 ms**.
  **Variety (task A2): no de-dup needed, and it was measured before deciding.** Over 39 neighbouring pairs,
  **0 shared car AND hour AND weather**; hour repeats 11/39, weather 2/39, car 2 of the 20 pairs where both
  scenes even have a car. 12 distinct cars over 25 drives. The exam's first cut of this counted a fly next to
  a walk as "the same car" (both have none) and reported 12 car repeats — a metric that can score a repeat the
  viewer cannot see is not measuring variety.
  **D4 frozen on a measurement, after the measurement turned out impossible.** `scheduled` covered two
  different facts: a riding shot's chosen 10 s clip running out, and a PLANTED shot sitting out its 15 s
  watchdog — a length nobody chose. The soak could only bound the second (≤ 10 of 30 planted shots). Splitting
  the cause (`watchdog`, and the four-times-inlined `isPlanted` predicate with it) turned the bound into a
  number: seed 47 scenes 1-12, **9 planted shots, 8 ended on the guard** (7 the car leaving frame, 1 the
  sightline) **and 1 on the watchdog**; all **41 riding shots** ended on their clip. So 15 s is behaving as the
  safety net it is documented as. Both constants now carry that verdict in `shots.ts`.
  **Fault injection (task A4)**: the run loop's one real decision — a failed scene costs one scene and is
  REPORTED — is now `video/sequence.ts` with 7 tests (one bad scene of four, every failure logged, all scenes
  failing still resolves, a non-Error throw, an empty range, strictly one at a time). The rest of that loop is
  host glue and stays in the field lane.
  **D16**: 0 `readBody` traces, 0 throws; the issue now records **≥ 180 staged scenes** across the chain on the
  teleport → spawn → seat recipe with no sighting. The 2026-08-30 recheck date stands.
  **Two defects 08 found in its own outputs.** The runner still tested `ended !== 'ran-out'` — the clock-driven
  end D1/D4 deleted on 2026-07-31 — so **every healthy scene had been logging itself as "ended early"** for two
  phases; nothing asserts on log prose, and it surfaced only from reading the benchmark log. And a scene report
  carried neither `hour` nor `weather`, so a capture could not say what world it was shot in (the
  self-describing-capture rule) — which is also why the variety audit could not be run until 08 added them.
  Tests **3 411 → 3 431**; tsc + eslint clean.
  **The field round that closed the chain (user, 2026-08-01): the walk and flythrough scenes were WATCHED,
  and the verdict was that they look good.** Two whole scene kinds had shipped on instruments alone — 07's
  own numbers say 5/5 passes flown and `safe 1.000` over 3 844 walk frames, and neither can tell you whether
  a pavement offset lands on a pavement or whether five 10 s passes read as editing. It did not retire
  `flyby`'s missing occlusion check: not being planted inside a wall in the scenes watched is not evidence
  that it cannot be. **That gap is what [09](09-planted-occlusion.md) closes** — a planted shot now walks a
  three-rung ladder of spots and takes the first with a clear line, the same probe the tripod has used since
  04, and gives the shot up rather than film a wall.
  **Two runs were thrown away and are named in the benchmark's `note`**: one truncated by a Vite reload (a
  source file saved mid-run — the harness ends the run with exit code 0 and no `run complete` line, so the log
  reads as short rather than broken), one that straddled a machine sleep. Both are now gotchas in
  `docs/development/benchmarks.md`.
  - **Field round 3 (2026-07-31) — the chrome was in every frame, and no headless number could say so.** The
    report was "video mode should hide the UI like K+M does". It was BUILT that way: `setUiHidden(true)` at
    the top of the run emits `'fly-camera'` exactly as the photo gesture does. But it runs inside `boot()`,
    and the shell reaches the bus only through `booted.then(...)` — `<Hud>` and the host's own listener both
    mount after boot RESOLVES, so the one emit went to an empty bus and nothing ever asked again. The perf
    readout obeyed because it reads a closure flag (`photoCamera`), not the event, which is exactly why the
    console-only checks looked right: `[video]`'s scene reports know nothing about the DOM, and the harness
    screenshots the end card, which is black.
    **The fix**: the last emitted state is held and exposed as `HudGame.getFlyCamera()`, read on mount and
    then kept in step by the subscription — the shape `getTime`/`getZone` already had, so the HUD's `flyCamera`
    seeds from it too. K+M is untouched (a keypress happens long after the subscription exists).
    **Verified** by a DOM probe with the overlay clear (seed 47, scene 1, drive, `build/original/opensa`):
    `{capture:false, clock:false, fullscreen:false, perfHud:false}`, against a control run of the same probe
    with no `?video=` reading `true` on all four — i.e. the probe would have caught the bug.
    Now a restriction (`docs/restrictions/architecture.md`): state the chrome must read is state, not an event.
    **Caught by nothing** — `apps/web/src/ui/**` is off the unit lane by design (DOM glue is the e2e lane's), so
    the probe is KEPT as `scripts/debug/video-chrome.ts`, control lane included: the point of the control is
    that an all-hidden reading and a probe with the wrong selectors look identical.

- **D10 revised (user, 2026-08-03) — mod cars ONLY, not merely first.** The field report was "my build has a
  `vehicle-mods.txt` and the reels still drive stock cars". Nothing was broken: 05 shipped D10's
  `MOD_CAR_PREFERENCE = 0.8`, so one scene in five drove a stock classic by design — and one scene in five is
  frequent enough that a viewer reads it as the ledger not being picked up at all. The constant is gone.
  `pickCar` now draws from the ledger∩roster pool whenever that pool is non-empty, and from the stock roster
  only when it is empty; there is no share left to tune, and the disjoint-pool reasoning 05 needed (a share
  that would drift with how many slots a game modded) has nothing left to protect.
  **The fallback that stays is the roster one**, and it is the case that made the count in the log wrong to
  begin with: a ledger row naming a slot this build carries no `.osm` for is not drivable, so the pool that
  decides is the INTERSECTION, never the ledger's own size. The boot line now prints that intersection and
  which pool is in force (`MOD CARS ONLY: 12 of 12 ledger slots drivable (…)` / `stock cars (no mod-car
  ledger)`), because "12 mod slots" beside a stock car is precisely the reading that cost this round.
  **One roll either way**, so the D9 invariant survives: a seed's scene list still cannot depend on which mods
  are installed. The seeded stream does shift by one draw against runs recorded before this change — seed 47
  is still seed 47, but it is no longer the same 100 scenes it was on 2026-08-01.

- **The address bar names the scene (user, 2026-08-03).** The report, paraphrased: the scenes keep clicking
  past and there is no telling which one is which — a live run could not say which scene was on screen. D12 puts every piece of chrome outside the
  frame on purpose, and the `[video]` line scrolls past, so the answer had to land somewhere the recording
  cannot see: the URL. Each scene `replaceState`s `seed` and `scene` before staging, `?video=1` becoming
  `?video=1&seed=1712…&scene=6` as the reel advances. Written at the START, so a scene that FAILS leaves the
  bar pointing at the one that failed rather than at the next one.
  **The seed goes with it or the mark is a lie**: a run given no `?seed=` derives one from the clock, so a URL
  carrying only `scene=6` reloads into a different scene 6. **`scenes` is rewritten too** — it is a COUNT, not
  an end, so carrying it over unchanged would turn a reload at scene 5 of a 1-8 run into 5-12; it is rewritten
  to `last - scene + 1`, and only when it was already in the URL (absent already means "to the ceiling").
  **REPLACE, never push** — 100 scenes would otherwise leave 100 history entries and the back button would
  walk the reel instead of leaving it.
  The build is `sceneUrl` in `presets.ts`, beside `parseSceneStart`: the read and the write of the same
  parameter belong in one file, and it keeps the whole of it in the unit lane (`apps/web/src/ui/**` is off
  that lane by design, so the DOM half is the one `replaceState` call the runner makes).
