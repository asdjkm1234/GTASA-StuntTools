# 096/02 — Module skeleton + autopilot drive scene v0

**Priority P0. Ships alone: `?video=1&seed=N` plays ONE seeded drive scene in one region on the EXISTING
chase camera, in a loop — recordable footage with ugly cuts. This is the phase after which the feature
exists.**

## What exists (reuse, do not rebuild)

- The whole scene skeleton is the `?phys=` runner (`apps/web/src/ui/engine-phys-runs.ts:229-279`):
  leave car → teleport beside spot → 3-stage streaming settle (`:64-70`, `:246-253`) → `spawnWithRetry`
  → `seatInstantly()` → 2 s spring settle → play input timeline → capture. Copy its shape and its
  frame-clock helpers `until()`/`waitSeconds()` (`:315-330`).
- Host accessors already wired for bench/phys (`engine-canvas-host.tsx:1633-1697`): `teleportPlayer`
  (phys-style resets render interpolation), `getStream`, `setHour`, `setWeather` (instant), `getVehicles`,
  `spawnCar(model, position, heading)` (`:1683`), `beginSamples`/`takeSamples`, `toEngine`, `params`.
- `ScriptedDriveSource` (`packages/game/src/vehicle/scripted-drive.ts`) — the shape of an inert-when-idle
  `InputState` living permanently in `CombinedInput`, advanced from the fixed loop (`:1261`).
- Vehicle pose readers: `EnterVehicleSystem.getActive()`, car `position/heading`,
  `physics.vehicleSpeed`; per-fixed-step telemetry (`vehicle-telemetry.ts` / `phys-capture.ts`) with
  `t,speed,slipAngle,…,x,y,z` series — the autopilot's acceptance instrument.
- UI hide: `events.emit('fly-camera', { enabled, photo })` (`engine-canvas-host.tsx:628`).

## Tasks

### A. `PathFollowSource` — the autopilot (`packages/game/src/vehicle/path-follow.ts`)

1. `implements InputState`, neutral when idle, installed permanently in `CombinedInput` next to
   `scriptedDrive` and advanced from the same fixed-step site — the exact `ScriptedDriveSource` pattern.
   API: `follow(route: Route, opts)`, `stop()`, `state(): 'idle' | 'following' | 'arrived' | 'stuck'`.
2. Each fixed step it reads the car pose (position, heading, signed speed — injected as thin accessors at
   construction, no direct system coupling) and emits:
   - **Steer (`move.x`)** — pure pursuit on the smoothed route: lookahead point at
     `L = clamp(kL · v, Lmin, Lmax)` (start `kL = 0.9 s`, `Lmin = 6`, `Lmax = 25` m); curvature
     `κ = 2 · sin(α) / L` (α = bearing error to the lookahead point); map κ → `move.x` through the
     KNOWN steering model — `STEER_RATE = 1.2 rad/s` slew + speed-dependent `steerLimit()` — i.e. the
     controller compensates the slew by leading the target, never by gain (the anticipate-don't-react
     rule). Clamp; deadband ~0.02 to avoid dither on straights.
   - **Throttle/brake (`move.y`)** — PI toward the route's per-vertex target speed sampled at a
     braking-distance horizon (`v²/2a` with `a ≈ 3 m/s²`), so the car slows BEFORE the curve. Calm-cruise
     cap `vCruise = 12 m/s` v1 (D8). Negative `move.y` brakes (the shipped semantics).
   - **Cross-track correction** — small proportional term of lateral offset from the route added to the
     pursuit bearing (gain low; pursuit does the real work).
3. Guards: `arrived` when within `ARRIVE_M = 8` of the final vertex; **stuck** when `speed < 1 m/s` for
   3 s while throttle > 0.5 (curb snag, wall) → report; the scene ends early behind the overlay rather
   than grinding a wheel on camera. No handbrake/jump actions in v1.
4. Unit tests with a kinematic bicycle-model stub (pure math, deterministic): converges to a straight
   within 1 lane from a 5 m offset; slows for a 90° corner; flags stuck. Negative cases first.

### B. `setupVideoRuns` — the module skeleton (`apps/web/src/ui/engine-video-runs.ts`)

5. `VideoRunsHost` interface (narrow accessors, mirrors `PhysRunsHost`): params, events, stream, hour,
   weather, teleport, spawnCar, vehicles (`seatInstantly`/`leaveCar`/`despawn`), autopilot
   (`follow`/`stop`/`state`), samples, toEngine, settleTimeoutMs. Host wires it in ONE block after
   `setupPhysRuns` (`engine-canvas-host.tsx:~1697`).
6. Gate: `params.get('video')` absent → return. Parse `from`/`to` (default 10/25, real seconds) and
   `seed` (default: derive one, but ALWAYS print `[video] seed=…` — D9). Rows added to
   `docs/development/query-parameters.md` in this change.
7. **Black overlay** — a module-created DOM element over the canvas (opacity 1 ⇄ 0, ~300 ms fade; plain
   element, no React coupling). The module is its single owner in every mode including headless (the 094
   rule); it exists from the first frame of video mode, so the ownerless state cannot occur. Scene
   staging happens entirely behind it.
8. **UI hide**: emit `'fly-camera' { enabled: true }` on mode start, `false` on tab-visible teardown.
   Never call `setSoakStatus` — all progress is console `[video]` lines (D12).
9. **Scene v0 loop** (one region hardcoded to LS for this phase only — the sequencer replaces it in 05):
   pick a route (01's builder, seeded) → set hour/weather instantly → teleport player near route start →
   phys-recipe settle (1 s notice + drain + 2 s warmup) → spawn a car at route start, heading along the
   first segment, `spawnWithRetry` → `seatInstantly()` → 2 s spring settle → **fps stability gate**:
   `beginSamples()`, lift the overlay only after 30 consecutive frames < 25 ms (or settle timeout) →
   `follow(route)` → run `durationS = from + rng() · (to − from)` real seconds on the frame clock →
   overlay down → `stop()`, `leaveCar()`, despawn, next seed → repeat. Camera: the SHIPPED vehicle
   follow rig — zero camera work in this phase.
10. Telemetry capture per scene (the phys instrument): emit one `[video] {json}` line with the series;
    `scripts/debug` gets nothing new — `tools-debug/bench-harness/drive.js` with `TAG='[video]'` is the
    headless driver as-is.

## Acceptance / verification (the 081 method — telemetry first, then a field look at a HARD route)

- Headless run of 5 seeds on an LS route set chosen with `video-routes.ts` to include one real corner:
  - cross-track error p95 ≤ 1.5 m, max ≤ 3 m (one lane);
  - `|gLat|` p95 within the calm band (≤ 0.35 g — numbers recorded, band frozen after the first run);
  - 0 stuck flags on accepted routes; speed within ±20 % of target off-corner.
- Same seed twice → identical route, car, hour, weather, and telemetry within physics determinism noise
  (record the residual — it is the reproducibility floor `?seed=` can honestly promise).
- A field look: does it READ as calm competent driving? (The number bands are necessary, not sufficient.)
- Ledger numbers: error percentiles per seed, the stability-gate wait time, cold-teleport spike duration
  behind the overlay.

## Close-out (2026-07-30)

**Shipped**, both task groups, acceptance met on telemetry — the numbers are in the
[readme ledger](readme.md). What the plan could not say in advance:

- **The design decision the phase opened with went to the ACCESSOR, not to a yaw-rate loop.**
  `EnterVehicleSystem.steeringModel()` now reports the granted lock, the current wheel angle, the slew rate
  and the wheelbase (read off the car's own hub placements, so a bike, a bus and a modded slot each answer
  for themselves). Closing the loop on yaw rate instead would have meant an integrator against a slewed
  actuator — the one thing the 080/081 chain says not to build — and a second copy of `steerLimit`, which is
  a second chance to disagree with the tyres. The rule is now in
  [`restrictions/architecture.md`](../../restrictions/architecture.md).
- **The slew is compensated by PREDICTION, not by gain.** Pure pursuit runs twice per step: once on the
  current pose to learn what the wheel is being asked for, then again on the pose the car will hold after the
  wheels finish slewing there (`lead = |δ − steerAngle| / slewRate`, capped at 0.4 s). Self-scheduling — no
  lead when the command is already met, most when it is furthest away.
- **The press-and-wait exit had to go.** The scene tears down behind the overlay and then despawns its car,
  and the phys-style "press Enter, wait for the climb-out" hung on a route that ended on a freeway overpass —
  after which every later scene read a destroyed body (`Cannot read properties of null (reading 'linvel')`,
  the exact failure `EnterVehicleSystem.remove()` warns about). `leaveInstantly()` is the twin of
  `seatInstantly()` and the same argument one step later: a climb-out that is never on camera is not part of
  what a showcase owes. It still leaves through a clear door when there is one, and falls back to the roof —
  `startExit`'s own last resort — so it cannot be blocked.
- **A scene's car must not be LOD-registered.** `EngineVehicles.spawn` adds a permanent, respawnable
  placement; an endless session doing that leaves a car at the start of every route it ever drove, each ready
  to reappear when a later route passes. `spawnOnce()` hands back a despawn instead.
- **`until()` / `waitSeconds()` were extracted** to `apps/web/src/ui/frame-clock.ts` rather than copied — two
  runners now share one frame-clock, and `engine-phys-runs.ts` lost its private copies.
- **The fps gate measures its own frames.** The plan said `beginSamples()`; that is the bench's leg
  collector and `takeSamples()` clears `benchCamera`, so using it would step on a bench run. The module
  counts `requestAnimationFrame` deltas itself — 30 consecutive frames under 25 ms — and reports the wait as
  `settleMs` in every capture.
- **The weather pool is FILTERED, not listed.** A scene takes a seeded index from the timecyc names ending
  in `_LA` (D7), so a modded timecyc cannot be wrong in a second place. 05 generalises the suffix.
- **`stop()` keeps the run's record.** The first version cleared the route, so every capture reported
  `progress: 0` for a run that had just driven 400 m — a scene stops the autopilot and THEN reports it. Now
  pinned by a test.

- **The stuck test asks about PROGRESS, not speed.** The first version tripped on "slow under throttle", and
  the scene that started on the 18° hill rolled BACKWARDS at 1-2 m/s under full throttle for 13.35 s before
  it fired — thirteen seconds of a car failing to climb, on camera, which is exactly what the guard exists to
  prevent. It now watches the furthest route vertex reached (the cursor only ever walks forward), which
  covers rolling back, spinning on the spot and sitting against a wall with one signal: 5.03 s on the same
  scene. The measured failure is now a unit test.
- **The end reason was read one line too late.** `state()` after `stop()` is always `idle`, so every early
  end reported `idle` and a real `stuck` hid inside it for a whole headless run. Read before the stop, and
  an early end now also logs itself with the route percentage it reached.

Carried into 03/05:

- **The one-way-street blindness 01 warned about was not observed** in 21 headless scenes, and it also cannot
  be: nothing in the data or in the capture says which way a lane runs. It stays an open watch item for a
  human field look, not a number.
- **Keyboard sums with the autopilot** (`CombinedInput`) — untouched, accepted for v1, and now stated in the
  restriction; the feature doc (08) is where a user-facing "hands off the controls" note belongs.
- **No route the sequencer picked was hard.** The tightest corner it produced across three seeds was 40.1 m,
  while the builder is willing to hand out 19.2 m in LA (`video-routes.ts --worst`). A deliberate hard-route
  field round is still owed — 03 or 05 should add a way to pin a scene to a chosen start node.

## Risks / notes

- Keyboard sums with the autopilot (`combine-input.ts:45-55`) — accepted v1 limitation, documented in the
  feature doc: hands off the controls while recording.
- Teleport → spawn → enter is the `vehicle-enter-null-body` recipe (D16): if it fires, ship fix option 1
  (defensive `readBody` guard + registry prune + test) in the same change.
- `seatVehicleOnGround` throws when the collision cell has not streamed — `spawnWithRetry` exists for
  exactly this; keep the retry, do not "fix" the throw.
- The approach state machine self-cancels on stray input (`APPROACH_*` consts) — irrelevant while
  `seatInstantly` is used; do NOT switch to the walk-up entry in this phase (that is an 08 nicety if
  ever).
