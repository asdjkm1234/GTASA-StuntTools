# 080 — Cinematic camera (GTA V-feel follow camera for the own engine)

**Status: 01–07 DONE and ACCEPTED (2026-07-25); 08 deferred by the user; REOPENED 2026-07-27 with 09
(follow-policy revision, from the user's field brief) and a 10th step (AAA polish) — 09 DONE and ACCEPTED
the same day (two field rounds; the entry-slam found and fixed; defaults frozen as authored); the 05 §6
look-behind key SHIPPED right after it (hold C while driving). The 10th step was SHELVED 2026-07-28: its
first feature (corner peek) was built twice — through the auto-center heading (invisible: the 09 authority
mutes that chase exactly mid-corner) and through the look point — and the field rejected both ("sticks and
jumps in big corners, near-invisible in small ones"); the whole feature was rolled back off `main` and the
plan doc replaced by the REWORKED idea
[`docs/ideas/aaa-camera-polish/`](../../ideas/aaa-camera-polish/readme.md), which carries the diagnosis and
reorders the work (fix the vehicle chase first, then the effects). The archive of both attempts lives on
branch `080-10-corner-peek`.**

> **CLOSED 2026-08-11 — this chain has nothing left open.** The last six boxes were the field rounds of steps
> the banner above already calls DONE and ACCEPTED, so they were stale rather than owed, and are struck.
> **Step 08 (switchable view presets, the C key) MOVED OUT whole** to
> [`roadmap/0.6.0/plans/07-camera-view-presets`](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md):
> it was verified unbuilt (no `CameraPreset`, `cycleView` or `cameraView` anywhere), it is deferred work
> rather than a debt against this chain, and it now sits beside the version that will do it. Every dependency
> it had — the vehicle rig, the opt-out-able collision layer, the transition blends — shipped here.

Planned 2026-07-19.: the damp/spring math and the
`CameraDirector` in `apps/web/src/ui/camera/` (01), the smoothed rig — input dampening, a trailing look
point with a dead zone, the steered-yaw channel, gliding zoom (02), the composition layer — turn-follow,
idle recenter, look-ahead (03), collision — a `PhysicsWorld` sphere/ray-cast API, snap-in/ease-out, a
min-distance floor and a ground floor guard (04), and the vehicle camera — speed→distance and speed→FOV
curves, drift framing off 081/01's physics slip channel, and the vehicle tuning table (05), and the additive
motion layer — bob, landing dip, impact shake, sprint FOV kick, all bounded and behind `reducedMotion` (06),
and the close-out — the transition matrix as a test, the tuning freeze, the tab prune and the exit exam (07).

**The 02+03+04 field round is DONE and ACCEPTED (2026-07-25)**: no value came back for retuning, so every
on-foot default is frozen as shipped, and the `?cam=legacy` A/B was deleted with the acceptance (07's
close-out task, taken early). **05's DRIVE field round is owed** — its defaults are first guesses, live on
the Camera tab — and the look-behind key ships after it (2026-07-27 revision: the 081 physics moved under
those defaults; the drift channel's input re-measured and the wiring verified, see 05's ledger — no code
owed, the round is now judgeable). **Four field rounds ran on 05+06** and every
report was fixed (bob frequency, the corner-swing latch, the backing-up spin, the shake burst, the exit
snap, entry sinking); the landing dip ships OFF because it never read at a third-person orbit. **07 was
ACCEPTED in the field on the same day** — the chain is closed for 0.5.0. **08 (view presets / first person) MOVED OUT to
[roadmap 0.6.0·07](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md) on 2026-08-11**, so this chain
is closed with nothing open; its feasibility research lives in
[`docs/ideas/first-person-camera/`](../../ideas/first-person-camera/readme.md).

**Goal: the camera feels "cinematic" the way GTA V's does — weighty, smooth, always composed — while
staying responsive enough that nobody blames it for a missed turn.** Today the engine host camera is a
rigid stick: `eye = target − forward · distance`, raw mouse deltas, zero smoothing, hard-coded rig
(`resolveCamera`, `apps/web/src/ui/engine-camera.ts:81-103`). Everything below replaces that follow rig;
the bench camera is explicitly untouched. The **free-fly camera is in scope as a first-class mode** —
see [Free-fly / map viewer](#free-fly--map-viewer-mode-in-scope) below.

## What "GTA V feel" decomposes into (the target behaviours)

| #   | Behaviour                                                                   | Sub-plan |
| --- | --------------------------------------------------------------------------- | -------- |
| 1   | Camera not hard-locked to the character — rotational lag, catches up softly | 02       |
| 2   | Eased acceleration/braking of all camera motion (inertia)                   | 01 + 02  |
| 3   | Spring behaviour — camera "weight" on sharp direction changes               | 02       |
| 4   | Look-ahead — frame shifts toward movement direction                         | 03       |
| 5   | Speed-based distance + FOV widening (mostly vehicles)                       | 05       |
| 6   | Auto-centering behind the player after input goes idle                      | 03       |
| 7   | Camera bob while walking/running/jumping                                    | 06       |
| 8   | Landing dip + impact kick/shake                                             | 06       |
| 9   | Collision camera — never clips through walls, smooth pull-in/release        | 04       |
| 10  | Vehicle turn lag + drift framing (camera looks along velocity in a slide)   | 05       |
| 11  | Cinematic dampening of raw mouse input                                      | 02       |

Additions beyond the request (they fall out of the same architecture and GTA V has them all):

- **Vertical follow softness** — the camera's height channel damps slower than the planar channels, so
  stairs, curbs and jump arcs do not jolt the frame (02).
- **Soft dead zone** — sub-threshold player drift does not move the camera at all (02).
- **Pitch-coupled framing** — looking down raises/tightens the rig slightly, looking up drops it toward
  the shoulder, keeping the character composed instead of filling the frame (07, polish).
- **Look-behind key** in vehicles — smooth 180° flip while held (05, polish).
- **Sprint FOV kick on foot** — subtle, a few degrees (06).
- **Motion-reduction accessibility toggle** — one config flag that zeroes bob/shake/FOV kicks (06).

**Switchable views are IN scope** (added 2026-07-25, user's request): a key (default C) cycles named view
presets per mode — far / normal / close / **first-person** on foot, and a bumper view in cars. It gets its
own sub-plan ([0.6.0·07](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md)) because first person has real dependencies (head-bone anchor, hiding
the player mesh, motion re-tuning), but its ARCHITECTURE constrains this whole chain from now on: every
tuned value stays in `CameraConfig` and reaches the rig as one config-shaped object, so a preset is a
different object handed to the same `stepCamera` — never a second code path. No sub-plan may hard-code a
number a preset would need to override.

Out of scope, recorded so nobody re-litigates: **gamepad** (no gamepad input path exists in
`packages/game/src/input/` at all — a separate plan when it comes), **idle cinematic auto-camera** and the
**R-key cinematic vehicle camera** (both are 0.6.0 idea material — stubs to be added when this chain closes).

## What the engine study established (constraints — every sub-plan obeys these)

1. **Two coordinate spaces.** Gameplay/physics are GTA Z-up; rendering is engine Y-up;
   `toEngine(gta) = (x, z, −y)` (`engine-canvas-host.tsx:1155`). Camera OUTPUT (`CameraState.eye/target`)
   is Y-up; camera COLLISION casts must run in Z-up against the Rapier world. The rig does its math in
   ONE space (engine Y-up, where yaw/pitch already live) and converts only at the physics boundary.
2. **FOV is free.** The projection matrix is rebuilt every frame from `camera.fovYRad`
   (`packages/engine/src/engine.ts:967-968`); no uniform or shader work for speed/FOV effects. It is
   currently hard-coded to π/3 in `resolveCamera` (`engine-camera.ts:90`) and must become an input.
3. **The camera updates in the VARIABLE-rate section** of the host loop, after fixed-step physics
   catch-up (`engine-canvas-host.tsx:787-929`, `FIXED_STEP = 1/60`, no interpolation between steps).
   Therefore every smoothing term must be frame-rate independent — exponential decay / critically
   damped springs parameterised by dt, never per-frame lerp constants.
4. **No smoothing utilities exist.** `@opensa/math` has `lerp/clamp/degToRad/radToDeg/euclideanModulo`
   only (`packages/math/src/math-utils.ts`). Damp/spring/angle-damp helpers are new code (plan 01).
5. **No camera raycast API exists.** `PhysicsWorld` exposes only downward casts (`groundBelow`,
   `physics-world.ts:361-367`); the Rapier primitive `world.castRay` is already used internally, so a
   general `raycast`/`sphereCast` is a thin addition (plan 04).
6. **Config exists but is ignored.** `CameraConfig` (`packages/game/src/interfaces/config.interface.ts:12-31`)
   carries the 036-era rig fields; the engine host reads only the zoom clamps and hard-codes the rest
   (EYE_HEIGHT 0.9, pitch clamp [−1.2, 0.9], sensitivity 0.004). The debug Camera tab is disabled for
   the engine host (`debug-capabilities.ts` — `cameraRig: false`).
7. **Vehicle state is all reachable, nothing consumes it yet**: signed forward speed
   (`physics.vehicleSpeed`), full velocity (`getLinvel`), pose (`readBody`), heading from quaternion
   (`enter-vehicle.system.ts:470`). Drift = angle between velocity and car forward, derivable per frame.
8. **Character signals**: `Velocity.grounded` 0/1 flag, vertical velocity, landing = the
   `grounded && vz < 0` edge (`character-controller.system.ts:100-110`); walk 2 / run 7 u/s. There is
   no landing EVENT — the camera derives edges itself (plan 06).
9. **Camera priority is bench > free-fly > follow** (`resolveCamera`, pinned by `engine-camera.test.ts`).
   The BENCH branch is the invariant: it bypasses EVERYTHING in this chain, so ritual/soak numbers
   cannot be moved by camera work, by construction. The free-fly branch (`flyEye`) is not bypassed —
   it becomes a director mode (see below).

## Free-fly / map viewer mode (in scope)

**Added 2026-07-20, after the 074/22 phase 9 map-viewer repair.** The map viewer and the photo camera
are the SAME free-fly camera (`flyEye`), and repairing the viewer grew it a real control set that now
lives in `engine-camera.ts` next to the follow math: `flyStep` (arrow walk + PageUp/PageDown lift),
`panStep` (left-drag pan in the screen plane, scaled by height above ground), right-drag orbit, wheel
dolly, `TOP_DOWN_PITCH` snap, and `cursorRay` picking. It is not a stub any more — it is a second real
camera, and it must go through the same director rather than staying a parallel inline path in the host.

Requirements this adds to the chain:

- **`mode: 'fly'`** joins `'foot' | 'vehicle'` in `CameraSnapshot`. The director owns the free-fly eye,
  yaw/pitch and distance-to-pivot; the host stops mutating them inline.
- **The fly rig reuses the same primitives** — the free-fly camera gets the damped input and eased
  start/stop of plan 01's `damp`/`smoothDamp` (today arrow-walk and drag are raw and step-quantised).
  A viewer that glides instead of snapping is the whole point of putting it here.
- **Layers it opts OUT of**, explicitly: collision (04 — a map viewer must fly through geometry),
  auto-center and look-ahead (03 — no focus to follow), additive motion (06 — no bob in a viewer).
  The director must make opting out per-mode a first-class thing, not a pile of `if (mode !== 'fly')`.
- **Picking stays cursor-based** and must keep working through the director: `cursorRay` unprojects
  through the camera's `fovYRad`, which plan 01 turns from the `CAMERA_FOV_Y` constant into an input.
  If the fly mode ever animates FOV, picking follows it or clicks land off-target.
- **Map-viewer specifics survive**: the fog override (`NO_FOG_DISTANCE`, re-applied after
  `environmentDriver.apply` — fog CULLS cells, it is what made the viewer look dead), the top-down
  snap on activation, and exactly ONE `requestPointerLock` in the whole host. All three are regressions
  waiting to happen the moment camera code moves; the fly-mode tests pin them.
- **The fly path is not smoothed at all** (the look point IS the target there), so no follow-rig round can
  cost the debug tooling.

Where it lands: `camera/fly-rig.ts` in plan 01's module layout, wired in plan 01 (parity first — the
moved fly path reproduces today's viewer bit-for-bit), smoothed in plan 02 alongside the follow rig's
input dampening, and re-checked in plan 07's transition audit (viewer ⇄ gameplay is a mode blend).

## Architecture (decided here, detailed in plan 01)

A **`CameraDirector`** — pure, deterministic, unit-testable — grows out of `engine-camera.ts` into
`apps/web/src/ui/camera/` (the existing pattern: pure math modules + tests, host stays browser glue).
The host calls `director.update(input, dt)` once per rendered frame with a plain snapshot (focus pose,
velocities, grounded flag, look deltas, mode) and receives a `CameraState`. Physics is injected as a
narrow probe interface so collision is stubbable in tests. Layers, applied in fixed order:

```
follow rig (yaw/pitch/distance springs)        ← plans 02, 03
  → mode layer (on-foot | vehicle)             ← plan 05
    → collision resolve (pull-in/release)      ← plan 04
      → additive motion (bob, dips, shakes)    ← plan 06
        → CameraState (eye, target, fovYRad)
```

Collision runs BEFORE additive motion so a bob can never push the eye through a wall; additive
offsets are amplitude-capped below the collision margin.

## Sub-plans

| #   | Plan                                                     | One-liner                                                                                                           |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 01  | [Foundations](01-foundations.md)                         | Damp/spring math in `@opensa/math`, CameraDirector skeleton, config plumbing, debug tab, A/B switch.                |
| 02  | [Follow rig](02-follow-rig.md)                           | The spherical rig with per-channel springs: rotational lag, inertia, input dampening, dead zone, vertical softness. |
| 03  | [Auto-center + look-ahead](03-auto-center-look-ahead.md) | Idle recentering behind heading, speed-scaled; lateral look-ahead offset.                                           |
| 04  | [Collision camera](04-collision.md)                      | PhysicsWorld ray/sphere-cast API + whisker rig, fast pull-in / slow release.                                        |
| 05  | [Vehicle camera](05-vehicle-camera.md)                   | Speed distance/FOV curves, turn lag, drift framing, enter/exit blends, look-behind.                                 |
| 06  | [Motion feel](06-motion-feel.md)                         | Bob, landing dip, impact shake, sprint FOV kick, motion-reduction toggle.                                           |
| 07  | [Transitions + polish](07-transitions-polish.md)         | Mode blending, pitch-coupled framing, field-tuning rounds, bench guard, close-out.                                  |
| 08  | ~~View presets~~ **MOVED**                               | Out to [`roadmap/0.6.0/plans/07-camera-view-presets`](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md) on 2026-08-11 — deferred work, verified unbuilt, and every dependency it had shipped in this chain. |
| 09  | [Follow-policy revision](09-follow-policy-revision.md)   | Movement never turns the camera (directional yaw authority), run/idle distance breathing, vehicle accel pull, the jump watchdog + dynamic-collision ease. |
| 10  | AAA polish (shelved)                                     | SHELVED 2026-07-28 — corner peek field-rejected twice; reworked into the idea [`docs/ideas/aaa-camera-polish/`](../../ideas/aaa-camera-polish/readme.md) (camera rework first, then effects); code archive on branch `080-10-corner-peek`. |

Execution order and the reasoning behind it: [priority.md](priority.md).

## Ground rules

1. **Pure core.** Every behaviour lives in a pure `step(state, input, dt) → state` function under
   `apps/web/src/ui/camera/`, unit-tested with fixed dt sequences. The host contributes only snapshot
   assembly and the physics probe. No `performance.now()` inside the core — time comes in as dt.
2. **Frame-rate independence is tested, not assumed.** For each spring/damp: one test asserts that
   N steps at dt and one step at N·dt land within tolerance (exponential-decay property).
3. **Bench/photo bypass is an invariant** — `resolveCamera` priority stays; a bench run must produce
   draws/fps identical to pre-080 rows (ritual sweep is the proof).
4. **A/B escape hatch**: `?cam=legacy` kept the pre-080 stick camera for the whole chain (the
   `?stoch=0` pattern) — field rounds compared feel one reload apart, and a bad round never blocked play.
   **DELETED 2026-07-25** at the user's call once 01–04 were accepted as the default (plan 07's close-out
   task, taken early). The A/B that remains is per-channel: zero a `CameraConfig` field on the debug Camera
   tab; zero them all and the rig still reduces to the stick camera, which the parity test pins.
5. **Config-driven tuning.** Every constant a field round might touch lives in `CameraConfig` (new
   fields, plan 01) and is surfaced in the debug Camera tab. No magic numbers buried in the rig.
6. **Measurements ledger per sub-plan** (standing rule): tuning values that survive a field round get
   recorded with the user's verdict; CPU cost of `director.update` and cast counts get measured, not
   estimated (budget: ≤ 0.1 ms p95, ≤ 5 rays/frame).
7. **Feel is field-judged.** The headless harness can pin determinism and regressions but cannot judge
   feel; each sub-plan ends with a user field round, and tuning defaults are frozen only on acceptance.
