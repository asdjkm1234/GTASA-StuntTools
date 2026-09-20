# Camera

`apps/web/src/ui/camera/`, `packages/math/src/damping.ts`, `Config.camera`, plans 036 (the three-era rig)
and 080 (the own-engine cinematic chain).

## Implemented

**The director** (plan 080/01) — one pure step per rendered frame:

- `stepCamera(state, snapshot, config)` takes a `CameraSnapshot` (dt, focus, mode, raw look deltas, wheel
  notches, fly walk keys / drag pan) and returns the `CameraState` the engine draws. The host assembles the
  snapshot and owns nothing else: its pointer/wheel handlers only ACCUMULATE input, which is what lets the
  smoothing layers see whole frames.
- `CameraRigState` (yaw, pitch, distance, the detached fly eye) is a plain mutable record the host holds and
  the director steps in place — no per-frame allocation.
- Layer order is fixed: **look → zoom → mode rig (foot | vehicle | fly) → collision (plan 04) → additive
  motion (plan 06) → resolve**. Collision resolves BEFORE additive motion so a bob can never push the eye
  through a wall.
- **The bench bypass is an invariant**: `resolveCamera`'s priority is bench > **video** > fly eye > follow
  rig, so a running bench owns the frame whatever the rig did. Camera work cannot move ritual/soak numbers.
  Video mode's director (plan 096/03) sits directly below the bench — a scripted showcase run outranks the
  interactive modes while it plays, so an accidental K+M cannot steal a recording's frame, and it carries an
  OPTIONAL `fovYRad`: a shot that chooses no lens keeps the rig's live one. The rig keeps stepping underneath
  in both cases; its output is simply discarded, which is also why the collision, floor-guard and additive
  layers are skipped for those frames (they defend an orbit that is not being drawn).

**The smoothed rig** (plan 080/02) — the "cinematic" part, split into channels that damp at different rates
instead of one global smoothing knob:

- **Input dampening**: pointer deltas go into a pending pool and are released exponentially over
  `inputSmoothTime`. Nothing is dropped — a gesture's total rotation equals raw mouse travel, it is only
  spread over ~5 frames, which is the difference between "dampened" and "laggy".
- **Look point, not focus**: the rig orbits a smoothed point that trails the player (behaviour #3, the
  position "weight") — a planar spring on `positionLagTime`, a slower exponential on `verticalLagTime` for
  height (stairs and jump arcs must not jolt the horizon), and a smoothstep **dead zone** (`deadZone`) so
  idle jitter moves nothing. This is smooth because the drawn world is render-interpolated (below). Two floors
  keep it honest: the point never trails by more than `lagMaxDistance`, and a focus jump past
  `teleportSnapDistance` snaps (respawn, debugger warp).
- **Steered yaw**: when something other than the player aims the camera — vehicle entry today, auto-center
  in plan 03 — the yaw swings over `yawLagTime` instead of snapping, and any mouse movement takes it back.
- **Zoom** damps toward a target the wheel (and later the mode/collision layers) writes, so it glides.
- Every one of those channels is a `CameraConfig` field live on the debug Camera tab, so a single channel can
  be zeroed there for an A/B. Zero them all and the rig reduces to the pre-080 rigid stick — the parity test
  pins that reduction. (The `?cam=legacy` flag that used to do it wholesale was deleted once the rig was
  accepted as the default; plan 07's close-out task, taken early.)

**Composition** (plan 080/03) — the camera doing its own work while the player's hands are busy, all of it
ON FOOT only for now (the vehicle versions are plan 05):

- **Turn-follow**: a heading change faster than `turnThreshold` swings the camera behind the new direction
  through the steered-yaw channel and stops once it is within `settleEpsilon`. A straight run never engages
  it — a framing the player chose survives the whole run. (Since 09 it also demands near-full directional
  authority, which on foot it almost never has — see the follow policy below.)
- **Idle recenter**: after `recenterDelaySec` of untouched look, a MOVING player is eased behind at
  `recenterRate` scaled by speed (a walk barely drifts home, a sprint commits) — and, since 09, scaled by
  the directional authority too. Standing still never recenters — a parked camera is left alone.
- **In a car too**: auto-center runs on foot AND while driving (the camera settles behind the car's rear).
  Only the look-ahead lean stays on foot — a car's lean is drift framing (plan 05).
- **Enter/exit glide**: while a scripted enter/exit plays (`EnterVehicleSystem.isSettling()` → the snapshot's
  `settling`), auto-center is suspended so the ped's approach/climb twitches do not drag the camera; instead
  one steered swing — aimed behind the car when the door opens, behind the dismount when the climb-out
  begins — glides across the whole animation. A mouse move cancels it.
- **Manual always wins**: any look input cancels both, restarts the idle clock, and holds turn-follow off
  for `manualGraceSec`. Pitch is never auto-touched.
- **Look-ahead**: the frame leans toward travel by up to `lookAheadDistance`, damped over `lookAheadTime`
  and scaled by speed. It moves eye and target together, so only the composition changes — the orbit
  geometry stays put.
- The behind-yaw convention: a GTA heading `h` points along `(−sin h, cos h)` and the camera looks along
  `(sin yaw, −cos yaw)`, so the camera sits behind at `yaw = h + π`. In practice: running the way the
  camera already looks needs no correction. The rig SEEDS at `yawBehind(spawn facing)` so a standing player
  is framed from behind at boot, not nose-to-nose; `steerYaw` (vehicle entry/exit) takes a facing and
  applies the same `yawBehind`.

**The vehicle camera** (plan 080/05) — **one rig, two tuning tables**. Driving does not fork the rig: it
substitutes its own numbers (`vehicleTuning` → yaw swing, recenter delay, vertical lag, collision release)
and adds two writers of its own. Nothing else in the director branches on the mode, which is what makes a
transition a blend rather than a switch — and it is the rule plan 08's view presets stand on.

- **Distance**: a seated car frames further out the bigger it is — its length (2·halfExtent.y) ×
  `vehicleDistanceScale` — and further still the FASTER it goes, by `vehicleDistanceGain` smoothstepped to
  `vehicleDistanceSpeed`. Through the same damp, so a fresh car glides out and hard braking visibly glides
  the camera back in. Collision caps it; leaving the car eases back to the on-foot zoom.
- **FOV**: the lens widens by up to `vehicleFovKick` between `vehicleFovMinSpeed` and `vehicleFovMaxSpeed`,
  damped by its own slower `vehicleFovLambda`. The dead-band is the point: a lens that reacts to throttle
  blips pumps. On foot the target is the base lens, so stepping out eases the widening away instead of
  cutting it. Cursor picking unprojects through the same live value.
- **Drift framing**: in a slide the camera looks partway ALONG the travel direction, so the player reads the
  trajectory. It is expressed as a HEADING (`driftHeading` leans the auto-center heading by
  `driftLookBlend × slip`), not as a second yaw writer — so the swing, the settle epsilon and the manual
  override all apply to it unchanged. Straight driving is untouched: slip under `driftSlipDeadZone` or speed
  under `driftMinSpeed` contributes nothing, and the band FADES in (a hard edge would flicker the framing —
  the lesson 04's rejected all-hit collision gate paid for).
- **The slip/speed channel is physics, not render**: it comes from `EngineVehicles.drivenMotion()`
  (081/01's shared `planarMotion` off the body). A focus delta would measure the render loop, and a slide
  leaves no trace in it at all.
- Enter/exit needs no special case: `aimCamera` already routes through the damped `steerYaw` (plan 02), the
  tables blend, and every channel keeps its state across the transition — the continuity test scripts
  seat → drive → exit and asserts no cut.
- **Look-behind** (05 §6): hold `controls.lookBehind` (**C**; unbound = off) while driving and the yaw
  target flips to the car's FRONT — the camera sits ahead, looking back over it — through
  `lookBehindLagTime` (0.15 s, its own one-swing lag override on the steered channel; a mirror check is a
  glance). Release swings back BEHIND through the same lag, fired explicitly on the falling edge (a
  standing car has no chase to bring the camera home). Re-asserted every frame, so the mouse cannot wrestle
  the hold; on foot and in fly the key does nothing. V stays reserved for plan 08's view presets.

**The follow policy** (plan 080/09, from the user's field brief — both field rounds accepted same-day):

- **Movement never turns the camera, except easing behind a walk AWAY.** One continuous rule — the
  directional yaw authority, `smoothstep(footYawAuthorityStart, footYawAuthorityFull, away)` over the
  normalized away-component of the smoothed focus velocity — scales the idle-recenter rate and gates the
  turn-follow latch (near-full authority required) and the vehicle chase (any). A strafe holds the frame; a
  steer the authority cuts short reports `released` and the director drops the in-flight target, so the
  camera freezes rather than finishing an unjustified swing. The old backing-up suspension (the about-face
  loop) is the authority's zero end; a reversing car gets the release for free.
- **The distance breathes.** On foot a run opens it (`footRunDistanceGain`, faded in walk→`footRunFullSpeed`)
  and REAL stillness (movement + look + zoom, its own clock — `autoCenter.idleFor` counts hands only) eases
  it in by `footIdleDistanceEase` after `footIdleDelaySec` at a deliberately slow creep, returning at the
  ordinary zoom pace on any input. In a car a LAUNCH stretches the framing: `vehicleAccelDistanceGain` × the
  low-passed positive acceleration (derived from the snapshot's own signed speed — no new physics tap;
  a one-frame gear blip moves the framing under 5 cm, pinned). Braking and reverse never stretch.
- **The `[cam] jump` watchdog** (host, perf-logs flag): a look-target jump > 1.5 m or an idle-mouse yaw
  jump > 20° outside the legitimate discontinuities (teleport, mode switch, scripted seat sequence, fly,
  bench, **a DECLARED video cut**) prints one line with the step state. Distance-channel moves are
  deliberately NOT watched — the designed occlusion snap-ins live there. Video mode is whitelisted only for
  the single frame it declares a cut on, never for the whole mode: between its cuts the director's pose is
  continuous by construction, so the watchdog stays a real tripwire over it.

**Motion feel** (plan 080/06, behaviours #7 and #8) — the additive layer, applied LAST, after collision and
the floor guard:

- **Bob** phased by DISTANCE travelled, not wall time: the frequency tracks stride for free and freezes when
  the player stops, with no threshold anywhere. Vertical at stride frequency, lateral at half (the
  figure-eight); the amplitude damps in and out with the gait, so walk↔run eases and the phase never
  restarts. On foot only — a car's suspension already provides the life.
- **Landing dip** — implemented and tested, but **shipped OFF** (`landingDipScale: 0`): an instant drop on
  the touchdown frame recovered over 0.32 s, the look point dipping half as far. The edge comes from 088's
  real `LOCOMOTION_LAND`/`HARD_LAND`/`COLLAPSE` states plus `Locomotion.fallSpeed`, not a guessed velocity
  sign. Three field attempts at increasing depth were never visible at a 7 m third-person orbit — the ped's
  own landing animation swamps a 20 cm frame drop. Expected to earn its place in plan 08's first-person
  preset, where the eye is the head.
- **Impact shake**: decaying two-octave value noise at 15 Hz from a deterministic per-hit seed (no
  `Math.random`, so a crash replays identically in a test). The trigger is
  `VehicleDamageSystem.peakImpact(body)` — the damage system already watches collisions and
  `physics.takeImpacts()` drains, so a second listener would race it. Every contact counts, not only the
  panel-damaging ones.
- **Sprint FOV kick**: a couple of degrees as a run tips into a sprint, contributed to the FOV TARGET so it
  eases through the same damp the vehicle kick uses.
- **Bounded, and no roll.** Each effect is capped and the SUM is capped at 0.25 m — inside the floor guard's
  0.3 m margin and well inside collision's 0.35 m sphere, so the layer needs no casts of its own. Eye and look
  point move TOGETHER (bar the dip): moving the eye alone swings the aim, which is the nauseating version.
  **`reducedMotion`** zeroes the whole layer — one Camera-tab toggle, and every effect also has its own
  scale.

**Collision** (plan 080/04, behaviour #9): the eye never sits behind a wall directly behind the player/car,
on foot AND in a car — the camera slides up the wall instead of passing through it. A single sphere cast
(radius `collisionRadius`, near-plane cover) sweeps from the look point along −forward (whiskers OFF by
default: the ±15° flanking casts fired on a pole/wall BESIDE you, not between you and the eye). It caps the
distance, snap IN / ease OUT over `collisionReleaseTime`; the chosen zoom / car distance restores after the
occlusion. Two 09 refinements: a hit on a body that can MOVE (`sphereCast` reports `dynamic` — dynamic OR
kinematic, so peds count) takes the eased path in BOTH directions, because a passer-by crossing the line is
not a wall about to be shown and the instant yank read as an unexplained jump; and a FALLING desired
distance is followed directly (`shown = min(shown, desired)`) — it is the zoom channel's own smoothed
glide, and treating it as an arriving occluder made the end of the seat-entry ease window complete the
lag as a slam (09 field round 1's constantly-reproducing entry jump). The floor is `collisionMinDistance` — the near-plane radius (0.5): a wall closer than that pulls
the eye right up to the surface, so it may clip INTO the ped for a frame, but it never slides BEHIND the wall
(which reads far worse) and it never stalls. A floor guard lifts the eye to `groundBelow(eye) + 0.3`,
running whenever the rig is attached (incl. a car enter/exit, so a low seat can't bury it). During a
scripted enter/exit the cap STAYS ON but eases in both directions: suspending it outright (the first cut)
stopped the camera sliding along surfaces and let it sink through the ground mid-climb — and once the eye is
under the floor the guard cannot rescue it, because its probe casts DOWNWARD. Easing keeps the geometry
clearance without the snap the 04 field round rejected, and the same eased response is held for 0.8 s AFTER
a sequence so stepping out of a car settles instead of jumping. Casts run against the one Rapier world,
excluding the subject — and, for a few metres after an exit, the car just left as well (`sphereCast`'s
second exclusion, since the framed subject's own collider must stay excluded too). **2 casts/frame** (one
sphere cast + the ground ray), against plan 07's budget of 5.

Known accepted trade-off (field verdict, stop point): a wall very close directly behind the player lets the
camera clip into the ped a little — the alternatives (a size-based floor, or freezing the eye in the world)
either fell BEHIND the wall or stalled, both worse. Revisit if a real pull-in policy is wanted.

**Modes**

- `foot` / `vehicle` — the follow rig: mouse look (yaw free, pitch clamped to `pitchMin`/`pitchMax`), wheel
  zoom inside `followZoomMin`/`followZoomMax` (gated by `followZoom`), eye target at `followHeight` above the
  focus. While seated the focus is the CAR, not the rider (the rider is teleported into the seat every frame
  and would judder).
- `fly` — the photo camera and the map viewer are the SAME detached eye (`fly-rig.ts`): ARROW walk +
  PageUp/PageDown lift at `FLY_SPEED`, left-drag pan in the screen plane scaled by altitude, right-drag
  orbit, wheel dolly (also altitude-scaled, floored at 2 u above ground), top-down snap on activation. Fly
  pitch reaches `TOP_DOWN_PITCH` (just short of straight down — a vertical forward has no screen basis),
  lower than gameplay may look. Fly opts OUT of collision, auto-center/look-ahead and additive motion by
  construction. Entering it with **K+M** also takes the UI chrome off the screen (perf readout, debugger,
  Click-to-play, Fullscreen) and restores it on exit — see
  [in-game-tools.md](../development/in-game-tools.md); the debugger driving the same camera does NOT hide
  anything, which is why the `fly-camera` event carries a `photo` flag rather than just `enabled`.

**Field of view** is a director OUTPUT (`CameraState.fovYRad`, default π/3) — the projection is rebuilt from
it every frame, and cursor picking in the map viewer unprojects through the SAME value the frame was
rendered with, so an animated FOV (plan 05) can never send clicks off-target. **A camera state may instead
carry `orthoHalfHeight`**, which draws that frame orthographically and leaves `fovYRad` unread (201/7-01) —
the dispatch console's plan view, and the only consumer: the game never sets it, and a director that did
would be asking for a projection with no apex to sit behind.

**Render interpolation** (plan 080/03): physics steps at a fixed 1/60 but the frame draws in the
variable-rate loop, so the raw physics pose is a stair-step. The host draws the ped, every car and the
camera focus at `lerp(prev, cur, alpha)` (slerp for orientation) between the last two fixed states —
`alpha = accumulator / FIXED_STEP`. This makes the drawn world continuous at any refresh, which is what lets
the camera's POSITION weight be smooth instead of beating against the fixed-step saw. Gameplay (ground ray,
heading, streaming, physics) still runs on the live pose. `VehiclePhysicsSystem` splits into `snapshot()`
(fixed) and `render(alpha)` (variable); the car's `renderPosition`/`renderOrientation` carry the drawn pose
that the camera and the lamps follow.

**Smoothing primitives** (`@opensa/math`, used from plan 02 on): `damp`/`dampAngle` (exponential approach,
`λ` reads as a half-life `t½ = ln2/λ`) and `smoothDamp`/`smoothDampAngle` (critically damped spring with a
caller-owned velocity, eases IN as well as out, `maxSpeed` cap). Both take dt — the camera runs in the
VARIABLE-rate section of the host loop, so frame-rate independence is tested, not assumed.

**Config + tuning** (`Config.camera`): framing (`followDistance`, `followHeight`, `followZoom` + zoom
bounds), look (`sensitivity`, `pitchMin`, `pitchMax`), the 02 feel channels (`inputSmoothTime`,
`positionLagTime`, `verticalLagTime`, `deadZone`, `lagMaxDistance`, `teleportSnapDistance`, `yawLagTime`,
`zoomLambda`), the 09 follow policy (`footYawAuthorityStart`/`Full`, `footRunDistanceGain`/`FullSpeed`,
`footIdleDelaySec`/`DistanceEase`, `vehicleAccelDistanceGain`) and `lookBehindLagTime` (config-only — a
tab row is one line away if a round asks). The key itself is `Config.controls.lookBehind`. All the tuned
values are live on the debug **Camera** screen (`cameraRig` capability, on for the engine host since
080/01) — field rounds tune with sliders, not rebuilds; every 09 default shipped exactly as first-guessed
(both rounds, 2026-07-27).

## Known gaps / candidates

- The dead zone leaves the frame settling ~8 cm behind a focus that stopped — the price of a rock-still
  idle frame, field-accepted with the 02–04 round.
- 05's full DRIVE field round (city corners at speed, handbrake drifts, highway, tunnel, repeated
  enter/exit) is still owed as a set — the 09 rounds covered entries, launches and general driving.
- No switchable view presets yet (a **V**-key ring per mode, first person included — C went to
  look-behind) — plan 08, deferred. The seam is already in place: every tuned value reaches the rig as one
  `CameraConfig`-shaped object, so a preset is a different object handed to the same `stepCamera`, never a
  second code path. The landing dip returns there.
- The AAA-polish step (corner peek, speed pose, fall stretch, directional impact kick, wind shake) was
  SHELVED 2026-07-28: the corner peek was built twice — through the auto-center heading (invisible: the 09
  directional authority mutes that chase exactly mid-corner, the only place a steer-driven writer is ever
  non-zero) and as a look-point shift — and the field rejected both ("sticks and jumps in big corners,
  near-invisible in small ones"). Rolled back off `main`; the reworked direction lives in
  [`docs/ideas/aaa-camera-polish/`](../ideas/aaa-camera-polish/readme.md) — camera rework FIRST (per-mode
  yaw authority, one composition channel, the hard-corner exam as a test), effects after. The archive of
  both attempts is branch `080-10-corner-peek`; the remaining four candidates were never built.
- No gamepad look — there is no gamepad input path at all.
- `followLerp` / `followPolar` / `followMinPolar` / `followMaxPolar` are 036-era fields the own-engine rig
  does not read; they stay in `CameraConfig` until the chain closes and replaces them.

## Test coverage anchors

`ui/camera/camera-input.test.ts` (gesture conservation, settle time, rate independence),
`ui/camera/auto-center.test.ts` (the behind-yaw convention, straight runs never engaging, the grace window,
stand-still exclusion, walk-vs-sprint recenter rates, and the 09 authority group — no arm without near-full
authority, the mid-swing release, the suppressed chase, the rate scaling),
`ui/camera/look-ahead.test.ts` (speed scaling, the cap, the fade home, rate independence),
`ui/camera/follow-rig.test.ts` (no overshoot, dead zone holds still, vertical slower than planar, the lag
floor at a 12 m/s sprint, teleport snap, 1/120-vs-1/20 agreement),
`ui/camera/camera-collision.test.ts` (snap-in/ease-out asymmetry, min distance, whisker min, floor guard,
GTA-space cast, the dynamic-hit ease vs the static snap, and the falling-desired glide with nothing left
for an eased window's end to snap) and `physics/physics-world.test.ts` (raycast/sphereCast hit distance,
exclusion, ball stop-short, the can-move flag),
`ui/camera/camera-director.test.ts` (the parity gate: with every smoothing channel zeroed the director
reproduces the pre-080 stick camera over a scripted look+zoom sequence; mode clamps, zoom notches, fly
walk/pan/dolly, top-down snap; the vehicle group — the lens widening only in a car and easing back on
foot, the distance opening with speed and gliding back, settling behind where the car TRAVELS in a slide,
and seat → drive → exit crossing with no cut; the 09 follow-policy group — a strafe and a run at the
camera hold the yaw for good, the run/idle distance breathing, the gear-blip robustness and the
launch-stretch-then-settle shape; and the look-behind group — the foot no-op, the mouse-wrestle, both
swing directions at rest and the fast-lag property),
`ui/camera/camera-transitions.test.ts` (the whole session as ONE snapshot sequence — walk → climb in →
drive → climb out → map viewer → back → respawn — asserting the eye never moves against its focus by more
than 1 u/frame except on three declared transitions),
`ui/camera/camera-motion.test.ts` (the bob freezing at rest and never in a car or the air, walk→run
continuity, the dip's depth/half-pitch/one-shot recovery, a shake replaying identically for its seed and a
stronger hit taking over, every cap holding when all of it fires at once, rate independence, and
`reducedMotion` zeroing the lot),
`ui/camera/vehicle-camera.test.ts` (the drift dead-band and its fade-in, the sign of a slide, the FOV and
distance curves incl. reverse, and that the vehicle table changes ONLY its four channels),
`ui/camera/engine-camera.test.ts` (bench priority, cursor ray, forward convention), `ui/camera/fly-rig.test.ts`,
`math/damping.test.ts` (convergence, no overshoot, ±π seam both directions, maxSpeed clamp, rate
independence at 1/60 vs 1/10 vs 1 s).
