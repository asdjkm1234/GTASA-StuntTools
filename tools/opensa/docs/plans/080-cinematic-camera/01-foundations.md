# 080/01 — Foundations: damp math, CameraDirector skeleton, config, debug, A/B

**Everything else in the chain sits on this plan.** It ships no visible behaviour change by itself
(the director in "legacy" tuning reproduces the current stick camera bit-for-bit) — it ships the
seams: math, module layout, config, debug surface, and the A/B switch.

## 1. Smoothing math → `@opensa/math`

New helpers next to `lerp` in `packages/math/src/math-utils.ts` (or a sibling `damping.ts` if the
file grows past focus):

- `damp(current, target, lambda, dt)` — frame-rate-independent exponential approach:
  `lerp(current, target, 1 − exp(−lambda · dt))`. `lambda` is "per second"; the doc comment states
  the half-life relation (`t½ = ln2/λ`) so tuning reads as time, not magic.
- `dampAngle(current, target, lambda, dt)` — same, but the error is wrapped to (−π, π] first via
  `euclideanModulo` so yaw never unwinds the long way around.
- `smoothDamp(current, target, velocityRef, smoothTime, maxSpeed, dt)` — critically damped spring
  (the Unity/Game Programming Gems form). This is the "inertia" primitive: it eases IN as well as
  out, which plain `damp` does not (behaviour #2 needs both ends eased). Carries its velocity in a
  caller-owned ref object — the math package stays allocation-free and stateless.
- `smoothDampAngle(...)` — wrapped variant.

**Why both `damp` and `smoothDamp`:** `damp` is one number of state and is right for channels that
should start moving immediately but settle softly (pitch, FOV, distance). `smoothDamp` carries
velocity and is right for channels that must feel massy (yaw catch-up, position lag, look-ahead).
Choosing per channel is a tuning decision made in plans 02/05; both primitives exist from day one.

### Subtasks

- [x] Implement the four helpers with doc comments (units: radians, seconds, per-second lambdas).
- [x] Unit tests: convergence, overshoot-free for critical damping, angle wrap both directions
      across the ±π seam, `maxSpeed` clamp engages.
- [x] **Rate-independence tests** (ground rule 2): 60 × dt=1/60 vs 6 × dt=1/10 vs 1 × dt=1 land
      within 1e-3 for `damp`; for `smoothDamp` assert small-step/large-step agreement within the
      documented tolerance (the discrete form is only approximately rate-independent — the test
      pins HOW approximate, so a regression is visible).

## 2. `CameraDirector` skeleton — `apps/web/src/ui/camera/`

`engine-camera.ts` grows into a directory; the existing pure functions move unchanged
(`resolveCamera`, `flyStep`, `createChordWatcher` keep their tests green — pure file move):

```
apps/web/src/ui/camera/
  engine-camera.ts        // resolveCamera / flyStep / chord — as today (moved)
  camera-director.ts      // the state machine + layer order; owns CameraRigState
  camera-input.ts         // look-delta smoothing, idle timer, zoom intent   (plan 02)
  follow-rig.ts           // on-foot spherical rig springs                   (plans 02, 03)
  fly-rig.ts              // free-fly / map viewer: walk, pan, orbit, dolly  (this plan, smoothed in 02)
  vehicle-rig.ts          // vehicle chase behaviour                         (plan 05)
  camera-collision.ts     // whisker casts + pull-in/release                 (plan 04)
  camera-motion.ts        // additive bob/dip/shake/FOV-kick layer           (plan 06)
```

### The contract

```ts
type CameraSnapshot = {
  // assembled by the host, all plain data, engine Y-up
  dt: number;
  mode: 'foot' | 'vehicle' | 'fly'; // bench never reaches the director (resolveCamera priority)
  focus: Vec3; // player or seated car position (already the host's `focus`)
  focusHeading: number; // ped render heading or car heading, as engine yaw
  velocity: Vec3; // planar+vertical, engine space
  grounded: boolean;
  vehicle?: { speed: number; velocityDir: Vec3; heading: number }; // plan 05
  look: { x: number; y: number }; // this frame's raw pointer deltas (px)
  zoomSteps: number; // wheel notches this frame
};

type CameraRigState = {
  /* yaw, pitch, distance, their spring velocities, offsets, timers … */
};

// pure: (state, snapshot, config, probe) → { state, camera: CameraState & { fovYRad } }
```

- The **physics probe** is one injected function, `castToEye(fromGta, toGta) → number | null`
  (plan 04 defines it; until then the director receives `null` ⇒ no collision layer). Tests stub it.
- `CameraRigState` is a plain mutable record owned by the host ref, stepped by pure functions —
  the same shape the character controller uses. Zero allocation per frame (reuse scratch vectors).
- **Legacy parity mode**: with lag/spring lambdas set to `Infinity` (config default OFF for every
  new behaviour until its plan ships), the director must output exactly today's camera. A test pins
  this against the current `resolveCamera` math.

### Host wiring (`engine-canvas-host.tsx`)

- Replace the inline yaw/pitch/wheel mutation block (`:367-382`) with snapshot assembly feeding
  `director.update` — raw deltas go INTO the snapshot; sensitivity/smoothing move into the director
  (plan 02). The `forwardOf`/`resolveCamera` call site (`:849-870`) consumes the director's output.
- `resolveCamera` gains `fovYRad` (and keeps near/far/up ownership): the ONLY signature change to
  existing pure code. Its tests update; bench/photo paths pass the constant π/3 — pinned unchanged.
- **`?cam=legacy`** query flag: host skips the director entirely and runs the pre-080 inline path
  (kept as one small function, deleted at chain close-out in plan 07).

### Subtasks

- [x] Move `engine-camera.ts` → `camera/engine-camera.ts`; imports + tests follow (mechanical).
- [x] `camera-director.ts` with the layer-order spine (rig → mode → collision → motion), all layers
      pass-through stubs except the legacy-parity follow math.
- [x] `resolveCamera` takes `fovYRad`; test updates.
- [x] Host: snapshot assembly, director call.
- [~] `?cam=legacy` branch — DEFERRED to plan 02 (see the ledger): in this plan the director IS the legacy
      math, so the flag would switch between two identical paths.
- [x] Legacy-parity unit test (director output === old math for a scripted input sequence).
- [x] **Fly mode**: move `flyStep`/`panStep` + the host's inline orbit/dolly/top-down-snap block into
      `fly-rig.ts` behind `mode: 'fly'`; per-mode layer opt-outs (fly skips collision/auto-center/motion)
      expressed once in the director spine, not as scattered conditionals.
- [x] **Fly-parity + map-viewer regression tests**: the moved viewer path reproduces today's controls
      bit-for-bit; `cursorRay` picks through the director's `fovYRad`; the `NO_FOG_DISTANCE` override
      survives `environmentDriver.apply`; exactly one `requestPointerLock` in the host (all four are the
      074/22 phase 9 findings — see `22-debug-tools.md`).
      _Unit tests cover the moved control math and the fovYRad pick; the fog override and the single
      pointer-lock are host-code invariants this plan did not touch (`clearMapViewerFog` and the
      "Click to play" handler are unchanged) and were re-checked in the headless field round, not by a
      test — the host has no DOM test lane._

## 3. Config plumbing

Extend `CameraConfig` (`config.interface.ts:12-31`) — existing 036-era fields keep their names and
meanings; new fields land in this plan as TYPES with neutral defaults (behaviour off), each
sub-plan turns its own group on with tuned defaults:

- Rig: `sensitivity` (replaces the hard-coded 0.004), `pitchMin/pitchMax` (replace [−1.2, 0.9]).
- Lag/springs (02): `yawLagTime`, `positionLagTime`, `verticalLagTime`, `inputSmoothTime`, `deadZone`.
- Auto-center (03): `recenterDelaySec`, `recenterRate`, `lookAheadDistance`, `lookAheadTime`.
- Collision (04): `collisionRadius`, `collisionReleaseTime`.
- Vehicle (05): `vehicleDistanceCurve` (base + per-speed gain + max), `vehicleFovCurve`,
  `vehicleYawLagTime`, `driftLookBlend`.
- Motion (06): `bobAmplitude`, `bobFrequency`, `landingDipScale`, `shakeScale`, `sprintFovKick`,
  `reducedMotion` (the accessibility master switch).

The debug **Camera tab** exists but is gated off for the engine host (`debug-capabilities.ts`,
`cameraRig: false`). Flip it on and extend rows group-by-group as sub-plans land — live sliders are
how field rounds tune without rebuilds (the 036 pattern, which worked).

### Subtasks

- [x] `CameraConfig` extension + defaults in `game-runtime-config.ts` — the RIG group only
      (`sensitivity`, `pitchMin`, `pitchMax`, plus `followHeight` re-pointed at 0.9). The later groups
      (lag/springs, auto-center, collision, vehicle, motion) land WITH their own plans; see the ledger.
- [x] Host reads `sensitivity`/pitch clamps/`followHeight` from config instead of the hard-coded
      0.004 / [−1.2, 0.9] / EYE_HEIGHT constants (the first visible config win, zero feel change
      with defaults matching current values).
- [x] Debug capabilities: `cameraRig: true` for the engine host; Camera tab rows for the rig group.
- [x] Config test fixtures updated (the 4 fixtures carry the full `camera` block — 036 note).

## Acceptance

- Suite green; `engine-camera.test.ts` (moved) green; new math + parity tests green.
- With default config and no `?cam` flag: gameplay camera is **visually identical** to pre-080
  (parity test + a manual sanity walk).
- **F2 → Map viewer still works end to end** after the fly path moves: pan/orbit/dolly/top-down snap,
  cursor picking, no fog cut. Field-check it in the headless harness, not only by tests.
- Ritual bench row: fps/draws within noise of the reference (bench bypass proof).

## Ledger

### 2026-07-25 — plan 01 SHIPPED (seams only, zero feel change)

**What landed**

- `packages/math/src/damping.ts` — `damp`, `dampAngle`, `smoothDamp`, `smoothDampAngle`, `angleDelta`
  (+ `SmoothDampRef`), exported from `@opensa/math`. 17 tests: half-life convergence, `λ = Infinity` snaps,
  `λ ≤ 0` / `dt ≤ 0` / NaN-λ stand still, no overshoot under critical damping, `maxSpeed` clamp engages,
  both ±π seam directions, and the rate-independence gates — `damp` lands within **1e-3** across
  60×(1/60) vs 6×(1/10) vs 1×(1 s); `smoothDamp` agrees within **0.2 units on a 10-unit move** between a
  1/60 and a 1/10 step (the documented approximation — the discrete spring is only approximately
  rate-independent, and the test pins HOW approximate).
- `apps/web/src/ui/camera/` — `engine-camera.ts` (moved; gained `forwardFrom` + an exported `screenBasis`,
  `resolveCamera` now takes `fovYRad`), `fly-rig.ts` (`flyStep`/`panStep` moved in, plus `dollyStep` and
  `topDownEye` lifted OUT of the host's inline handlers), `camera-director.ts` (the spine).
- The host no longer owns yaw/pitch/distance/flyEye: its pointer/wheel handlers only ACCUMULATE
  (`pendingInput` = look px, pan NDC, wheel notches), and the loop drains them into one `CameraSnapshot`
  → `stepCamera`. `cursorRay` now unprojects through the FOV the frame was rendered with.
- Config: `sensitivity` 0.004, `pitchMin` −1.2, `pitchMax` 0.9, `followHeight` 1.2 → **0.9** (the value the
  host hard-coded as `EYE_HEIGHT`; the 1.2 default was three-era and unread). Debug Camera tab is ON for the
  engine host with those four rows; the label formatter grew a 4-decimal branch for fine steps (LOOK SPEED
  read "0.00" at two).
- Docs: new `docs/features/camera.md` (+ README row), `character.md` follow-camera bullet re-pointed.

**Measured**

| what                                    | number                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| full suite                              | 344 files / **2574 tests green** (was 2564 — 40 camera + 17 math − the moved/rewritten rows) |
| `stepCamera` cost (node, 200k calls)    | **0.078 µs mean · 0.089 µs p95** vs the plan's 0.1 ms budget      |
| headless `ls-noon` (087-ring pak, DPR=2) | 120 fps · 8.334 ms avg · p95 9.2 · draws 1181 · tris 2 287 719   |

The bench leg is **vsync-capped**, so it proves the bench path still runs and draws the same class of frame,
not the absence of a CPU cost — the bypass itself is structural (`resolveCamera` priority, pinned by
`camera-director.test.ts`). Recorded in
[`docs/benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json`](../../benchmarks/opensa-engine/2026-07-25-headless-080-camera-director.json).
No BEFORE row: producing one meant stashing the change under the user's live dev server for a capped leg.

**Headless field round** (`?loader=http-dir`, DPR=2/1, screenshots kept out of the repo):

- gameplay: boots, the player is framed at 0.9, a 180 px drag-down pitches the camera — the
  accumulate-and-drain path works end to end (120 fps, draws 902).
- photo camera: K+M detaches the eye, ARROW walk moves it, the wheel dollies it, K+M re-attaches with **no
  jump** (the eye re-seeds from the live camera).
- map viewer: F2 → Map → Map viewer snaps top-down over the district, **no fog cut**, left-drag pans,
  right-drag orbits, wheel dollies, the inspector panel stays live.
- debug Camera tab shows DISTANCE 7 · MIN/MAX ZOOM 4/10 · HEIGHT 0.90 · LOOK SPEED 0.0040 · PITCH MIN −1.20
  · PITCH MAX 0.90 · Wheel zoom.

**Decisions / deviations from the written plan** (each one is "the seam ships with the plan that first uses
it", so nothing dead lands early):

1. **`?cam=legacy` deferred to plan 02.** In this plan the director reproduces the pre-080 stick camera
   exactly (the parity test is the proof), so the flag would A/B two identical paths. Plan 02 adds the first
   real feel change and takes the flag with it — as a director-level switch that skips the smoothing layers,
   NOT a second inline host path, so there is one input path to keep correct.
2. **No `castToEye` probe parameter yet.** Plan 04 owns the collision layer and adds the parameter with the
   `PhysicsWorld` cast behind it; carrying an always-null argument through three plans buys nothing.
3. **Only the rig config group landed.** The lag/auto-center/collision/vehicle/motion fields arrive with
   their own plans and tuned defaults — a config field nothing reads is a promise, not a seam.
4. **The three-era rig sliders were replaced, not extended.** `followPolar`/`followLerp`/`followMin|MaxPolar`
   have had no reader since the three host was deleted; the Camera tab now shows the rows the director
   actually reads. The config fields stay (they are 036 API) until the chain closes.
5. **Photo camera gained wheel dolly.** The old host only dollied in the MAP VIEWER; with fly a first-class
   mode, any detached eye dollies. In photo mode the wheel previously moved `followDistance`, which nothing
   rendered — so this replaces a no-op, not a behaviour.

**Not done here / carried:** the per-mode layer opt-outs exist as the fly branch (fly runs no follow rig);
they become explicit spine flags when there are layers to opt out OF (plans 03/04/06). The map-viewer
regression invariants (`NO_FOG_DISTANCE`, single `requestPointerLock`) were re-checked in the field round —
the host has no DOM test lane to pin them.
