# 080/02 — Follow rig: lag, inertia, springs, input dampening (behaviours 1, 2, 3, 11)

**The heart of the chain — after this plan the camera already "feels GTA".** Everything here is
on-foot; the vehicle mode (05) reuses the same channels with different tuning.

**Standing constraint from [view presets](../../roadmap/0.6.0/plans/07-camera-view-presets/readme.md), moved to 0.6.0 — it still holds:** every value tuned here lives in `CameraConfig` and
reaches the rig through the one config argument — no magic numbers in the rig code. That is what lets a view
preset be a different config object rather than a second code path.

## Design: per-channel springs on a spherical rig

The rig is spherical around a raised look point (the 036 design, proven in prod): `yaw`, `pitch`,
`distance` about `focus + followHeight`. The cinematic feel comes from splitting the camera into
**channels that damp at different rates**, instead of one global smoothing knob:

| Channel                 | Primitive             | Why                                                                   |
| ----------------------- | --------------------- | --------------------------------------------------------------------- |
| Look input (yaw/pitch)  | `damp` on the DELTAS  | #11 — raw mouse feels "cheap"; damping deltas keeps 1:1 total travel. |
| Yaw toward target       | `smoothDampAngle`     | #1/#3 — the massy catch-up when auto-centering or mode logic steers.  |
| Look-point position     | `smoothDamp` per axis | #2/#3 — camera trails a sharp direction change, then settles.         |
| Look-point height       | `damp`, slower lambda | vertical softness — stairs/jumps don't jolt the horizon.              |
| Distance (zoom + modes) | `damp`                | wheel zoom and mode changes glide instead of stepping.                |

### 1. Input dampening (#11) — `camera-input.ts`

- Pointer deltas accumulate into a **smoothed look velocity**: each frame the applied delta is
  `damp(applied, pending, 1/inputSmoothTime, dt)`; the remainder stays pending. Total rotation over
  time equals total mouse travel — **no accumulated input is ever dropped**, only redistributed
  across ~2–4 frames. This is the difference between "dampened" and "laggy": the test asserts
  conservation (sum of applied == sum of injected) and a settle time under 80 ms.
- Sensitivity from config (01). A hard flick still crosses the screen in the same total angle;
  it just has no single-frame step in it.
- Every nonzero look frame stamps `idleFor = 0` (the timer plan 03 consumes); zoom likewise.

### 2. Position lag + spring (#2, #3)

- The rig tracks a **smoothed look point**, not the raw focus: per-axis `smoothDamp` toward
  `focus + followHeight`, with `positionLagTime` planar and the slower `verticalLagTime` on height.
  A sharp 90° strafe leaves the character visibly leading the frame for a beat, then the camera
  eases back in — that IS behaviour #3; no separate "spring system" is needed beyond `smoothDamp`
  (it is a critically damped spring).
- **Soft dead zone**: focus movement under `deadZone` metres from the current smoothed point does
  not pull at all (error is remapped through a smoothstep from the dead-zone edge). Idle breathing
  and physics micro-jitter leave the frame rock-still.
- `maxSpeed` on the spring guarantees the look point can never fall further behind than a fixed
  distance at sprint speed — responsiveness floor: the player must never leave the frame. Teleports
  (respawn, debugger warp) snap the rig: any focus jump > 20 m resets springs to target (the
  streaming driver's teleport-grace idea, applied to the camera).

### 3. Rotational lag (#1)

On-foot yaw is **player-authored** — the camera never fights the mouse (036's hard lesson: pitch is
never auto-touched, manual look always wins). "Camera lags the character's turn" therefore means:
the character turns instantly with input (controller behaviour), and the RIG's yaw only moves when
(a) the player moves the mouse (through the input damper) or (b) auto-centering steers it (plan 03,
through `smoothDampAngle` — where the weight of #1 actually shows). This plan lands the
`smoothDampAngle` channel and its tuning; plan 03 feeds it a target.

### 4. Distance channel

Wheel zoom sets `distanceTarget` (clamped to `followZoomMin/Max` as today); the live distance
`damp`s toward it. Mode/collision layers later write the same target — one channel, many writers,
single smoothing point.

## Subtasks

- [x] `camera-input.ts`: pending/applied delta damper + conservation + idle stamps; unit tests
      (conservation, settle time, sensitivity scaling, idle timer).
- [x] `follow-rig.ts`: smoothed look point (per-axis spring, dead zone, vertical lambda, max-speed
      floor, teleport snap); yaw/pitch application; distance damp. Unit tests with scripted focus
      paths: step response has no overshoot, dead zone holds still, vertical slower than planar,
      20 m jump snaps.
- [x] Director wiring: input → rig → resolveCamera; `?cam=legacy` still bypasses.
- [x] Config defaults tuned to first-guess values (document them in the ledger with reasoning);
      Camera tab sliders for `inputSmoothTime`, `positionLagTime`, `verticalLagTime`, `deadZone`.
- [~] **Field round 1** (the chain's first feel checkpoint): walk/run/jump around Grove Street,
      strafe hard, flick the mouse. Verdict per behaviour #2/#3/#11; freeze defaults in the ledger.

## Acceptance

- All rig tests green incl. rate-independence on every channel.
- Field verdict: input feels smooth but not floaty; strafe shows visible-but-small trailing;
  stairs do not bounce the horizon. (Recorded as the user's words, paraphrased in English.)
- `director.update` measured < 0.05 ms p95 at this stage (HUD long-frame check while sprinting).

## Ledger

### 2026-07-25 — code complete, AWAITING THE FIELD ROUND

**What landed**

- `camera-input.ts` — the pending/applied damper. Raw deltas go into a pool; each frame releases
  `damp(0, pending, 1/inputSmoothTime, dt)`. Conservation is the point and is tested: a gesture's total
  rotation equals the raw path's exactly, only spread over ~5 frames. `smoothTime = 0` releases whole
  (the legacy path), and a zero-dt frame releases rather than swallowing the flick.
- `follow-rig.ts` — the smoothed LOOK POINT: planar spring (`smoothDamp` per axis, `positionLagTime`),
  vertical `damp` on the slower `verticalLagTime`, a smoothstep dead zone, the `lagMaxDistance` floor and
  the `teleportSnapDistance` snap. Seeds itself on the first frame (no fly-in from the origin) and resets
  whenever the free-fly eye owns the camera, so re-attaching never flies across the map.
- Director: `applyLook` runs through the damper, the steered-yaw channel (`smoothDampAngle`) swings a yaw
  the player did not ask for and hands the camera back within 1e-3 rad, the zoom now damps toward
  `distanceTarget` (the wheel writes the target — later layers write the same one).
- **The steered-yaw channel has a real writer today**: `aimCamera` (vehicle entry) used to SNAP the yaw
  behind the car; it now swings over `yawLagTime`, and any mouse movement cancels it mid-swing. Plan 03's
  auto-center writes the same channel.
- **`?cam=legacy`** (deferred from 01, now that there is something to compare): the flag reaches the rig
  as `CameraRigState.legacy` and turns every 080 channel off — input damper, springs, dead zone, zoom
  damp, yaw swing. The 01 parity test runs on exactly that state, so the legacy path stays pinned to the
  pre-080 math by the same test that pinned it before.
- Debug Camera tab: `INPUT SMOOTH`, `LAG PLANAR`, `LAG VERTICAL`, `DEAD ZONE`, `YAW SWING` sliders.

**First-guess defaults (the field round tunes these — reasoning, not measurements)**

| field                  | value  | why this number                                                                       |
| ---------------------- | ------ | ------------------------------------------------------------------------------------- |
| `inputSmoothTime`      | 0.03 s | ~2 frames at 60 Hz: takes the single-frame step out of a flick, 93 % applied by 80 ms. |
| `positionLagTime`      | 0.12 s | Visible trailing on a hard strafe without the frame feeling detached.                  |
| `verticalLagTime`      | 0.28 s | ~2.3× the planar channel — curbs and stairs stop reading as camera bounce.             |
| `deadZone`             | 0.08 m | Under a footstep's lateral sway; idle jitter moves nothing.                            |
| `lagMaxDistance`       | 1.2 m  | At the 7 u/s run speed the player can never drift out of frame.                        |
| `teleportSnapDistance` | 20 m   | Bigger than any legitimate one-frame move, smaller than a respawn/warp.                |
| `yawLagTime`           | 0.25 s | A car-entry swing that reads as deliberate, not as a fight with the player.            |
| `zoomLambda`           | 8 /s   | Half the zoom step in ~90 ms — a spun wheel glides, a single notch still feels direct. |

**Measured**

| what                                     | number                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| full suite                               | 346 files / **2600 tests green** (+26 over 080/01)                          |
| `stepCamera` with the channels live      | **0.185 µs mean · 0.208 µs p95** (01 was 0.078/0.089) — 240× under the plan's 0.05 ms stage budget |
| headless sanity run (walk + strafe + flick) | 120 fps, draws 967, no jitter; the running player sits visibly off-centre — behaviour #3 in the real game |

Recorded in [`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`](../../benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json).

**Known behaviour to judge in the field** (not a bug, a tuning call): the dead zone leaves the look point
settling ~0.08 m (its own width) behind a focus that stopped moving, creeping in from ~0.086 m. That is the
price of a rock-still idle frame. If the field round dislikes it, the fix is `deadZone: 0` or moving the
relief onto the spring rate instead of the goal — both one-line changes.

**Not done here:** the `idleFor` timer the plan mentions is deferred to 03, the only consumer (a stamp
nothing reads is not a seam). The FIELD ROUND itself is owed — feel is the user's verdict, and the defaults
above are frozen only once they accept them.

### 2026-07-25 — FIELD ROUND ACCEPTED

User's verdict on the round: accepted (paraphrased in English — the camera reads right, move on). No value
came back for retuning, so **every first-guess default in the table above is now frozen as shipped**,
including the dead-zone residual flagged as "to judge in the field" — the rock-still idle frame was worth
its ~0.08 m settle, and `deadZone: 0` stays unused.

The round's real output was the four fixes already committed during it (rig seeding at `yawBehind`, the
fixed-step/render-loop jitter → render interpolation, the enter/exit glide, the seated-rider judder), all
recorded above and in 03's ledger. With the round accepted, the `?cam=legacy` A/B had no job left and was
deleted — see 07's ledger.
