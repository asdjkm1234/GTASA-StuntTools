# 088 — Ped locomotion feel (turning, acceleration tiers, jump, animation states)

**Status: SHIPPED + CLOSED 2026-07-24 (both rounds, SIX same-day field rounds, all accepted;
05 stays QUEUED).** Round 2 (07 landing tiers · 08 slope slide · 09a–d ingress/egress) survived
field rounds 2–6 (slide push, crawl-out lift, ground-anchored probes, stranded doors, and finally
the yaw-vs-body-orientation door mapping on wrecks); close-out re-run twice
(character.md/vehicles.md/edge-cases updated, audit at `docs/audit/ped-locomotion-feel.md`).
Round 1: four feature commits (`4fbe73b` heading+plant · `5ed9a0c` crossfade+hold · `6520641`
tiers+rate-sync · `c45adaf` jump FSM) + the field fix `160d428` + close-out `824ca1b`; 792 green.

**Goal: on-foot movement feels like a modern AAA third-person game** — the character turns through an
arc instead of snapping to a new direction, speed ramps through distinct walk/run/sprint tiers, the
jump has anticipation → airborne → landing (with the matching animations and a recovery beat), clip
changes crossfade instead of popping, and the feet stop sliding because the cycle speed matches the
ground speed. The user's complaints (2026-07-24): direction changes are instant, the jump has no feel
and no animation, there is no sense of acceleration.

## What the engine actually is now (studied 2026-07-24, all facts verified in code)

**Movement is already accelerated — the missing pieces are facing, tiers, and every animation state.**

- **Kinematic capsule + Rapier character controller** (`packages/game/src/physics/physics-world.ts`):
  `RigidBodyDesc.kinematicPositionBased()` Z-up capsule; controller with slide, autostep 0.4/0.1,
  snap-to-ground 0.4, slopes 50°/45° (`createCharacterController` :143, `createKinematicCapsule` :281).
  The controller integrates its own velocity and hands Rapier the per-step delta.
- **Horizontal speed is accelerated, not set** (`character-controller.system.ts:94-111`): `approach()`
  moves planar velocity toward the input target by `accel|deceleration × airControl × step` — ramp-up,
  turn momentum and air momentum already exist. Config (`game-runtime-config.ts:112`):
  `{ accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 3.5, runSpeed: 7, walkSpeed: 2 }`
  (`MovementConfig`, `config.interface.ts:236-250` — no turn rate, no sprint, no jump timing fields).
- **Facing is derived, instant, and lives in the host**: `posePlayer` (`engine-canvas-host.tsx:1023-1048`)
  sets `heading = atan2(-vx, vy)` of the CURRENT velocity whenever `speed > 0.3`, else holds. No turn
  rate anywhere; a strafe-reverse flips the model as fast as `approach()` swings the velocity through
  zero (~0.3 s of unreadable spin at accel 20). The renderer receives only a yaw (palette slot 0,
  `engine-player.ts:192-199`).
- **Jump is one line, no states** (`character-controller.system.ts:101`):
  `vz = grounded ? (jump ? movement.jumpSpeed : 0) : vz` then gravity. At `jumpSpeed 3.5` the apex is
  `3.5²/(2·9.81) ≈ 0.62 m`, air time ≈ 0.71 s. No launch anticipation, no landing state, no coyote
  time, no jump buffer; landing just zeroes `vz`. Air control exists (`airControl 0.3`).
- **Animation = 3 clips, hard switches, fixed rate** (`engine-player.ts`): `PLAYER_CLIPS =
  ['idle_stance', 'walk_civi', 'run_civi']`; the inline state machine picks by speed
  (`> 4` run, `> 0.3` walk — the 0.3 duplicated in the host's heading gate) and on change does
  `clipTime = 0` — "v1: hard switch — the crossfade is the plan-08 sampler follow-up". `clipTime += dt`
  with no rate scaling → feet slide at every speed the cycle wasn't authored for. Scripted (vehicle)
  clips override locomotion via `setScripted`; the `buildClipIndex` duration>0 gate keeps absent clips
  from sampling to the flat bind pose.
- **`IfpSampler` samples ONE clip** (`packages/engine/src/anim/ifp-sampler.ts:46-71`): per-bone quat
  slerp within the clip, then compose × parent × inverseBind straight into the palette. The last
  `sample()` arg is `outSlot`, not a weight — there is no two-clip path. A crossfade must blend the
  per-bone LOCAL quats (slerp between the two clips' sampled quats) before compose; blending final
  palette matrices would shear.
- **The clips this plan needs all EXIST in the original `ped.ifp`** (probed 2026-07-24 with `parseIfp`
  over `game-src/original/anim/ped.ifp`, 294 clips): `sprint_civi` (32 bone tracks, like
  walk/run/idle), `JUMP_launch`, `JUMP_launch_R`, `JUMP_glide`, `JUMP_land`, `FALL_fall`, `FALL_glide`,
  `FALL_land`, `FALL_collapse`, `FALL_skyDive` (26 tracks — the untracked fingers/spine extras hold
  bind rotation, which the sampler already does per-bone), plus the polish tier: `WALK_start`,
  `Run_stop`/`Run_stopR`, `Turn_L`/`Turn_R`, `turn_180`.
- **Fly mode fakes `grounded = 1`** specifically so no fall state triggers (`placeFlying`) — every new
  airborne state must stay out of fly mode's way. `setEnabled(false)` (seated in a car) zeroes velocity
  and skips the controller; the scripted-clip path keeps overriding locomotion unconditionally.

## Architecture decisions (made here, not re-litigated per phase)

1. **Stay kinematic.** Everything requested is expressible in the existing controller: heading is a new
   scalar state, jump states are a small FSM around the existing `vz` line, tiers are target-speed
   selection. No dynamic body, no Rapier changes.
2. **Physics states live in the game package; animation follows.** Coyote time, jump buffering, launch
   delay and landing lockout GATE VELOCITY, so they belong to `CharacterControllerSystem` (real-Rapier
   tested, deterministic fixed step). The controller publishes a locomotion state through a new ECS
   component (`Locomotion`: state enum + seconds-in-state + fall speed at impact); the host's
   `posePlayer` forwards it into `EnginePlayer.update`, and the clip choice becomes a pure function of
   that state + speed. The two state machines never diverge because only one of them decides.
3. **Heading becomes owned state with a turn rate, steered by INTENT.** The controller keeps a
   `heading` per player, turned toward the DESIRED move direction (the input target, not the velocity)
   at `turnRateDeg`/s — facing anticipates like modern games, velocity follows through `approach()`,
   and the two together produce the arc. `posePlayer`'s `atan2` remains only as the fallback for
   scripted `runPath` compatibility until the component lands.
4. **Every new clip degrades like the vehicle clips do.** Resolution reuses the `buildClipIndex`
   duration>0 gate: a TC shipping a `ped.ifp` without `JUMP_glide` gets today's v1 behaviour for that
   state (speed-picked locomotion clip, no crossfade), never a bind pose, never a freeze. The FSM runs
   regardless — only the visual falls back.
5. **All tuning lands in `MovementConfig` (+ the anim timing beside the clips)** and stays
   live-patchable for in-session A/B (the 081 rule: feel is field-judged; defaults freeze only on user
   verdict).

## Phases (each individually shippable, numbers recorded per phase)

### 01 — Heading model + turn rate (CLOSED 2026-07-24 — field-verified same day)

- `Locomotion` ECS component (state, stateTime, heading, fallSpeed) + controller-owned heading:
  shortest-arc approach toward the intent direction at `turnRateDeg`/s, **speed-scheduled** — near-idle
  turns fast (snappy repositioning, ~720°/s), sprint turns slow (~240°/s → wide arcs). Two config
  fields (`turnRateIdleDeg`, `turnRateFullDeg`), lerped by `speed/maxTier`.
- Reversal rule: intent >120° away while above walk speed keeps decelerating on the OLD heading until
  speed drops under the walk threshold, then turns — that reads as a plant, not a spin. (The `turn_180`
  clip upgrade is phase 05.)
- Host: `posePlayer` reads `Locomotion.heading` instead of `atan2`; the duplicated `0.3` thresholds
  unify into one shared const.
- Tests: pure heading-approach function (wrap-around, shortest arc, rate clamp — negative cases first);
  controller test: intent reversal decelerates before the heading flips.
- Verify in field: figure-eight run arcs visibly; strafe-reverse plants and turns. Record: chosen
  turn rates, deg/s at walk/run/sprint.

**Field verdict (2026-07-24, user):** looks good as shipped — defaults FROZEN at
`turnRateIdleDeg 720` / `turnRateFullDeg 240` / plant at 120°.

**Ledger (2026-07-24, code-complete):** shipped as `packages/game/src/character/locomotion.ts` (pure
math: `angleDelta` / `approachAngle` / `scheduledTurnRate` / `yawFromPlanar` + the shared
`IDLE_SPEED_THRESHOLD = 0.3` and `REVERSAL_ANGLE = 120°`), the `Locomotion` ECS component
(heading-only for now — state/stateTime/fallSpeed land with their phase-04 writers), and the
controller's `moveOnFoot` step. Defaults (field round pending): `turnRateIdleDeg 720`,
`turnRateFullDeg 240`, lerped by `speed / runSpeed`. Plant semantics as designed: intent >120° away
→ velocity target becomes REST at `deceleration` (25 → a 7 m/s run stops in ~0.28 s), heading holds
until speed ≤ 0.3, then the about-face runs at the near-idle rate (~180° in ~0.25 s + a ~5-step
pivot before re-acceleration). One deliberate behaviour change surfaced by the existing suite: a
scripted `runPath` waypoint 180° behind now pivots ~5 fixed steps before the walk starts (test
updated to walk 15 steps). While riding, `posePlayer` writes the car yaw back into
`Locomotion.heading`, so dismounting turns FROM the car's heading instead of a stale walk yaw; debug
fly mode keeps its instant heading (no plant, no rate). Tests: +17 new (10 pure-math, 7 controller
heading incl. plant/pivot/fly), full game+web suite 528 green; lint (cognitive-complexity forced the
`moveOnFoot` extraction) + tsc clean. The duplicated `0.3` idle threshold in `engine-player.ts` and
the host heading gate now both come from `IDLE_SPEED_THRESHOLD`.

### 02 — Crossfade + phase-synced blending (CLOSED 2026-07-24 — field round 1 accepted)

- `IfpSampler.sampleBlended(from, fromTime, to, toTime, alpha, out, outSlot)`: per-bone slerp of the
  two clips' LOCAL quats (and lerp of positions where tracks exist) before compose — one extra
  `sampleQuat` per bone, zero allocations, same palette contract.
- `engine-player.ts`: clip switches start a fade (default 0.2 s, per-transition overridable — landing
  wants ~0.12 s) instead of `clipTime = 0`. Walk↔run↔sprint fades carry NORMALIZED PHASE
  (`toTime = phase × toDuration`) so legs stay in step; idle/airborne transitions start at 0.
- Tests: sampler — blend at α=0/1 equals single-clip sample bit-exact, α=0.5 is a valid unit quat path
  (extend `ifp-sampler.test.ts`'s `zAngleDegrees` idiom); state machine — a mid-fade re-switch retargets
  without popping (fade-from becomes the current blended source clip at its current time).
- Verify: idle↔walk↔run pops gone in field. Record: fade times table, sampler cost per frame
  (µs, single vs blended — budget: invisible next to the 2 ms pass floor).

**Ledger (2026-07-24, code-complete):** the promised 074/08 follow-up paid. Sampler
(`ifp-sampler.ts`): shared per-bone `evaluateBone`/`writeBone`, `sampleBlended` (LOCAL quat slerp +
position lerp BEFORE compose; α≤0/α≥1 early-out to the bit-exact single path), plus a hold-pose pair
— every sample records its locals, `holdPose()` freezes them, `sampleFromHold` fades out of the
frozen pose. The hold is how an INTERRUPTED fade retargets pop-free (idle→walk→run inside one 0.2 s
window is the common case: at accel 20 the walk→run threshold arrives ~0.19 s after idle→walk); the
frozen-source fade is the standard cheap inertialization fallback. New pure `LocomotionMixer`
(`apps/web/src/ui/locomotion-mixer.ts`): fade bookkeeping, walk↔run normalized-phase carry
(`toTime = phase × toDuration`, zero-duration gaits never carry), `captureHold` fires exactly once
per interruption, and `restartFromHold` — a scripted-clip handback (car exit) now FADES into
locomotion instead of popping (a small scope add beyond the phase text; the climb-out pose blends
into stance over the same 0.2 s). Numbers: fade default **0.2 s linear** (landing override still
phase 04); sampler cost measured 32-bone/20-key clip × 20k iters: **single 6.0 µs, blended 8.2 µs
(1.37×)** — invisible next to the ~2 ms pass floor. Tests: +16 new (7 sampler blend/hold incl. two
bit-exact equality gates, 9 mixer incl. interruption + handback); engine+web+game suites 767 green;
lint + tsc clean. Alpha curve is linear v1 — smoothstep is a one-line tuning lever if the field
round wants softer ends.

### 03 — Speed tiers + cycle-speed sync (CLOSED 2026-07-24 — field round 1 accepted, accel 20→14)

- New `sprint` action (held; keyboard binding beside `run`) → `sprintSpeed` config; tier targets
  walk 2 / run 7 / sprint ~10 (field-tuned). `sprint_civi` joins `PLAYER_CLIPS`.
- Clip choice by speed with HYSTERESIS (switch up at threshold, down at threshold − ~0.5 m/s) so the
  boundary never flickers; thresholds derive from the tier speeds instead of the hardcoded 4.
- Playback-rate sync: each locomotion clip gets a reference ground speed (measured in the field harness
  by timing strides at fixed velocity — recorded, not guessed); `clipTime += dt × clamp(speed/ref,
  0.7, 1.4)`. Fades blend the RATE too.
- Tests: hysteresis (no oscillation for a speed sequence straddling the boundary), rate clamp.
- Verify in field at walk/run/sprint and mid-fade. Record: reference speeds per clip, hysteresis gap,
  clamp bounds, tier speeds after tuning.

**Ledger (2026-07-24, code-complete):** tiers walk 2 / run 7 / **sprint 10** (`sprintSpeed` in
`MovementConfig`), `sprint_civi` joined `PLAYER_CLIPS` (phase-carried with walk/run). **One design
decision beyond the phase text: RUN is now the DEFAULT gait** — SA jogs when nothing is held; Shift
= sprint, `walk` is an optional modifier binding (unbound in prod) and the analog partial
touch-stick deflection (`TouchInputSource` reports `walk` under the 0.85 run threshold). The old
walk-2-default + Shift-run scheme would have kept the game feeling slow with the tiers in place; the
legacy `run` action stays for the touch harness/e2e. Gait pick: new pure `GaitSelector`
(`apps/web/src/ui/gait-selector.ts`) with up-thresholds at the tier midpoints (idle 0.3 / 4.5 / 8.5
prod) and **hysteresis 0.5** down (idle boundary capped at half its threshold → 0.15). Cycle-speed
sync: `LocomotionMixer` scales each clip clock by `rateOf(clip, speed)`; refs = the tier speeds
(rate = 1 exactly at each tier's target), clamp **[0.7, 1.4]**; the alpha clock stays wall-time.
Degradation gate: `resolveGaitClip` — a TC without `sprint_civi` keeps the RUN cycle at sprint speed
(tested, the rule-3 invariant). `loadEnginePlayer` now takes the tier speeds (`GaitTiers`); the top
turn-rate tier moved runSpeed → sprintSpeed. Tests: +17 new (6 gait selector, 1 mixer rate, 4
resolveGaitClip, 3 touch walk/sprint, 2 keyboard, walk/sprint tier controller pair) and the fast-gait
suite exposed a test-world flaw (the 10 × 10 ground box let 26–39 u/s runs fall off the edge
mid-ramp → widened to 500 × 500). Full engine+web+game: **784 green**; lint + tsc clean. Reference
speeds are the tier speeds v1 — the field round may re-time them per clip (the stride-timing knob is
`referenceSpeeds` in `engine-player.ts`).

### 04 — Jump + fall state machine (CLOSED 2026-07-24 — field round 1: glide loop fixed, then accepted)

Controller FSM (fixed-step, in `CharacterControllerSystem`), states published via `Locomotion`:

- `LAUNCH`: jump pressed while grounded (or within COYOTE after walking off an edge, default 0.12 s).
  Plays `JUMP_launch`; `vz = jumpSpeed` applies after `launchDelay` (default ~0.1 s — the clip's crouch
  frames become real anticipation). Horizontal momentum carries (already true).
- `AIRBORNE`: `JUMP_glide` while rising/short falls. A fall NOT from a jump (airborne > coyote window
  without a press) enters here too, via `FALL_glide` when the clip exists.
- `LAND`: on `grounded`, `JUMP_land` with a control lockout (`landRecoveryMs`, default ~0.15 s at
  reduced accel — a beat, not a stun). Impact `|vz| > hardLandSpeed` → `FALL_collapse` + longer
  recovery (hard-land tier; threshold field-tuned, start ~12 m/s).
- JUMP BUFFER: a press within `bufferMs` (~0.15 s) before touchdown fires the jump on the landing
  frame — with launch delay and land recovery in play, buffering is what keeps chained jumps feeling
  responsive rather than mushy.
- Guards: fly mode never enters the FSM (its faked `grounded` already opts out); `setScripted` (vehicle
  enter/exit) overrides any state visually; absent clips degrade per decision 4 (FSM still runs — jump
  physics works on every TC).
- Tests (real Rapier, negative-first): no double jump mid-air; no jump during land lockout; coyote
  window honoured then expired; buffer fires exactly once; launch delay applies vz on the right step;
  hard-land threshold picks the collapse tier; fall-off-ledge enters AIRBORNE without a press.
- Verify in field: jump reads as crouch→launch→glide→land; ledge walks trigger the fall pose; landing
  from a rooftop staggers. Record: every timing constant after tuning, apex height/air time
  before vs after.

**Ledger (2026-07-24, code-complete):** the FSM lives in `CharacterControllerSystem.advanceAirState`
(GROUNDED → LAUNCH → AIRBORNE / FALL → LAND / HARD_LAND, states as `LOCOMOTION_*` consts +
`Locomotion.state/stateTime/fallSpeed` writers). Constants shipped (all in `MovementConfig`,
field-tunable): coyote **0.12 s**, jump buffer **0.15 s** (rising-edge armed — holding Space no
longer auto-hops; a hard landing is never bypassed by a buffer), launch delay **0.1 s** (the
`JUMP_launch` crouch is real anticipation — the impulse fires 6 fixed steps after the press), land
recovery **0.15 s** / hard-land recovery **0.5 s** at `airControl`-reduced steering, hard-land
threshold **12 m/s** impact, feather-touch floor `LAND_MIN_FALL_SPEED 1 m/s` (spawn settles and
slope jitter never flash a landing). `jumpSpeed` raised 3.5 → **4.5**: apex 0.62 m / 0.71 s air →
**1.03 m / 0.92 s** (the "weak hop" half of the complaint). Anim side: 5 new clips
(`JUMP_launch/glide/land`, `FALL_glide/collapse`) resolved like the gaits; `airClipFor` degradation
chains (FALL→glide, collapse→land, anything unresolved → the speed gait — jump PHYSICS works on
every TC); launch/land are one-shots (mixer parks their clock a hair before `duration` — at exactly
`duration` the sampler's wrap rewinds to frame 0); land fades in 0.12 s, launch→glide 0.1 s.
**Two real physics finds:** (1) the frame after the impulse Rapier can still report grounded (snap)
— the old `grounded → vz=0` line ATE single-fire jumps (the v1 held-key auto-rejump had masked it);
fixed by "a rising body keeps its velocity" + "a landing requires descent". (2) `fallSpeed` must be
written only on the air→ground transition — standing gravity ticks also pass the `vz<0` gate and
clobbered the impact. Tests: +8 FSM cases with real Rapier (double-jump refusal, buffer-expires-in-
collapse, coyote expiry, anticipation timing, coyote catch, buffered-fires-once-on-landing-frame,
soft/hard tiers; the teleport tests must `physics.step` once to COMMIT a kinematic teleport before
moving). Full engine+web+game: **792 green**; lint + tsc clean.

**Field round 1 (2026-07-24):** two verdicts, both fixed same day. (1) "The jump animation plays
twice — legs jerk mid-flight": `JUMP_glide` is ~0.4 s against a ~0.9 s flight and the sampler WRAPPED
it — the glides joined the one-shot set (hold the last frame; launch/land/collapse already did).
(2) "The run rips from a standstill": `accel` 20 → **14** (0→run ~0.5 s, 0→sprint ~0.7 s);
`deceleration` stays 25 so stopping keeps its snap.

### 05 — Transition polish (QUEUED — only if 01–04 leave visible gaps)

`WALK_start` (idle→walk kick), `Run_stop`/`Run_stopR` (run→idle plant, foot-phase-picked),
`turn_180` (the phase-01 plant upgraded to the authored pivot), `Turn_L`/`Turn_R` (stationary camera
turns). Each is one FSM edge + one clip through the same gate; none blocks the chain. Decide from the
phase-04 field round.

## Round 2 (user-requested 2026-07-24, planned same day)

The user's extension list, mapped to what `ped.ifp` actually ships (all clips verified present):
impact-tiered landings (`FALL_land` crouch, `FALL_collapse` + `getup`), overturned-car egress
(`CAR_crawloutRHS`, `CAR_rollout_*`), passenger-side entry + seat shuffle (`CAR_getin_RHS`,
`CAR_shuffle_RHS`), door realism (`CAR_open_*`, `CAR_align_*`, `CAR_doorlocked_*`), and a slope
slide (no authored SA clip — `FALL_glide` is the balance-pose stand-in, field-judged). The enter
system study (2026-07-24): doors DO animate but only `lf`; exit is always the driver door with no
blockage checks; the "floats in the air" boarding is the LINEAR `getinFrom → seatWorld` slide —
the clip's authored root motion (kept by `parseIfp` as frame-type-4 translation, dropped by
`pedClip`'s root anchoring) never drives the body.

### 07 — Landing tiers + the getup chain (CLOSED 2026-07-24 — field round: collapse clip swapped, accepted)

- Three impact tiers instead of two: `JUMP_land` (soft, ≥1 m/s) · **`FALL_land` — the impact
  CROUCH** the user asked for (> `hardLandSpeed` 12) · **`FALL_collapse` → `getup` chain** (a new
  `LOCOMOTION_COLLAPSE` state, > new `collapseSpeed` ~16 — fell far enough to go down and STAND
  BACK UP; recovery `collapseRecoverySeconds` ~1.8 covers both clips).
- The anim side needs `stateTime` (collapse plays until its clip ends, then getup) —
  `EnginePlayer.update` gains the argument; degradation: no `getup` → hold the collapse's last
  frame; no `FALL_land` → `JUMP_land` (the round-1 behaviour).
- Tests: tier pick per impact band; the collapse→getup handoff by stateTime; degradation chains.

**Ledger (2026-07-24, code-complete):** three tiers shipped — `JUMP_land` (1–12 m/s, 0.15 s) ·
`FALL_land` impact crouch (12–16 m/s = `hardLandSpeed`..`collapseSpeed`, 0.5 s) · `FALL_collapse` +
`getup` (>16 m/s, new `LOCOMOTION_COLLAPSE` state, `collapseRecoverySeconds` **1.8 s** covering both
clips; neither upper tier is buffer-bypassed). The anim handoff is `stateTime`-driven
(`EnginePlayer.update` gained the argument; `airClipFor` hands `fall_collapse` → `getup` only when
the collapse RESOLVED and has fully played — a TC without the collapse clip plays the crouch chain,
without `getup` it holds the collapse's last frame). In fall-speed terms the tiers are ≈ heights of
**>0.05 m / >7.3 m / >13 m**. Tests: +7 (3 tier/impact-band with real Rapier — mid-tier from z=10
≈13 m/s, collapse from z=17 ≈17.5 m/s; 5 airClipFor chain/degradation cases minus renames); full
suite **798 green**; lint (recovery pick extracted to `recoverySecondsOf`) + tsc clean.

**Field fix (2026-07-24, same day):** the severe tier read as TWO clips ("crouch, then he stood up,
then ALSO a fall"). A physics-sim replay proved the state/clip SEQUENCE was correct (fall_glide →
collapse 1.0 s → getup → idle) — the problem was the CONTENT: `FALL_collapse` is a standing-knockout
crumple (buckle → brief straighten → drop backwards), authored for fainting peds, and its
straighten-up middle is the phantom "second clip". Swapped the tier to **`fall_front`** (0.73 s —
one motion, straight down onto the face) + **`getup_front`** (the matching face-down riser), and
`collapseRecoverySeconds` 1.8 → **2.2** so the 2.1 s chain plays out instead of cutting the riser at
58 % and popping to idle. Clip durations recorded: land 0.23 · fall_land 0.47 · fall_front 0.73 ·
glide 0.5 · fall_glide 0.8 · getup(_front) 1.37 (ANP3 raw / 60).

### 08 — Slope slide (CLOSED 2026-07-24 — field round 2: real downhill push added, accepted)

- Ground NORMAL from the ground probe (extend the physics ray); grounded on a slope steeper than
  `slideSlopeDeg` (~42°, hysteresis a few degrees) → a SLIDE locomotion state: reduced control,
  `FALL_glide` balance pose (no authored slide clip exists in SA — field-judged stand-in).
- Tests: pure slope math; the state needs a ramp fixture — if the test physics world can't build
  an inclined collider cheaply, the state logic tests run on a faked normal and the ramp is field.

**CODE-COMPLETE 2026-07-24 — ledger:** `PhysicsWorld.groundNormalBelow` (castRayAndGetNormal, one
extra ray per fixed step while grounded — negligible) feeds a per-step slope angle into the FSM: a
new `LOCOMOTION_SLIDE` state enters past `slideSlopeDeg` **45°** (= the physics `MIN_SLOPE_SLIDE`,
so the pose appears exactly when Rapier starts sliding the capsule) and exits below **41°**
(4° hysteresis); control is `airControl`-reduced while braced, a jump can still kick off the slope,
and sliding off an edge falls through the normal coyote path. The pose is the `FALL_glide` balance
stand-in (no authored SA slide clip — field-judged; degrades to `JUMP_glide`). The ramp test builds
a REAL 48° trimesh incline through `createStaticColliders` (the ColliderShape trimesh path — no
rotated-box API needed) and drops the capsule onto it; flat ground pinned as never sliding. The
FSM transitions got extracted (`groundedTransition`/`slideTransition`) to hold the complexity cap.
All four packages **1283 green**; lint + tsc clean.

### 09 — Vehicle ingress/egress realism (CLOSED 2026-07-24 — field rounds 1–3 all fixed + accepted)

- **09a — Root motion for the scripted clips (the "floats in the air" fix).** Extract the ROOT
  translation track from the raw IFP (`parseIfp` keeps it; `pedClip` drops it), and drive
  `placePlayer` along `anchor + yaw · (root(t) − root(0))` for getin/getout instead of the linear
  lerp — the authored trajectory carries the doorway dip and the drop into the seat. Foundation
  for every other clip here (shuffle, crawlout).

  **CODE-COMPLETE 2026-07-24 — ledger:** probed the real tracks first — `CAR_getin_LHS` roots
  (0,0,0)→(0.95, 0.49, −0.35) over 1.0 s (a metre INTO the car, half forward, dropping into the
  seat), getout is its reverse over 1.13 s, RHS mirrors x, `CAR_shuffle_RHS` continues −x a further
  0.9 m (0.4 s), `CAR_crawloutRHS` is 2.17 s anchored at its END — the axes are exactly
  right/forward/up of the facing. Shipped: `rootMotion`/`sampleRootMotion` extractors
  (renderware, beside `pedClip`), `VehicleAnimator.scriptedMotion(name)` (EnginePlayer extracts +
  caches from the same IFP), and `warpAlongRootMotion` (pure, exported): the clip's root path
  carries the SHAPE while a linear correction distributes the clip-vs-world endpoint mismatch —
  starts exactly at the doorway, ends exactly at the seat, and the slide now runs the CLIP's
  duration (1.0/1.13 s) instead of the hardcoded 1.2 s that held the last pose while still
  sliding. A TC without the clip degrades to the legacy linear slide (stubbed in the system
  tests). Tests: +7 (4 extractor/sampler, 3 warp incl. the endpoint guarantee and the vertical
  dip a straight slide flattens); all four packages **1275 green**; lint + tsc clean.
- **09b — Passenger-side entry + the seat shuffle.** Nearest-door pick (`lf` vs `rf` by the
  player's side), the `rf` door swings (mirrored angle — `setDoorAngle`/`doorHinge` already take a
  side), `CAR_getin_RHS` into the passenger seat, then `CAR_shuffle_RHS` across to the driver
  seat, then the normal seated pose. Passenger seat local = the driver seat mirrored to +X.

  **CODE-COMPLETE 2026-07-24 — ledger:** a `DoorSide` runs through the whole sequence (approach →
  door swing → step-in → doorway → getin clip/motion → seat). A passenger-side approach now walks
  STRAIGHT to the rf door (the old path hiked around a bumper to the driver door — routing + its
  `END_MARGIN` deleted), climbs in with `CAR_getin_RHS` root motion into the mirrored (+X) seat,
  then a new `shuffle` phase warps across on `CAR_shuffle_RHS` (0.4 s; the passenger door pulls
  shut during the slide) into the driver seat. Exit stays the driver door until 09d. Degradation:
  absent RHS clips → the stand-in pose + linear slides, sequence still completes. Tests: the
  bumper-routing test replaced by the full rf-entry flow (approach x, rf swing, both clips, sit).
- **09c — Door-aware step-in.** The step-in waypoint routes around the OPEN door's swept arc
  (hinge + panel radius) so the player walks around the panel into the doorway, never through it.

  **CODE-COMPLETE 2026-07-24 — ledger:** two-leg step-in replaces the diagonal that cut through
  the open panel: leg 1 walks back along the 1.2 m standoff ring (the panel at 60° reaches only
  ~0.9 m out) to abeam the seat, leg 2 goes straight inboard into the doorway. Mirrored for the rf
  door. Test pins both waypoints on a seat-behind-hinge fixture.
- **09d — Exit-door chain + overturned egress.** Exit picks driver door → passenger door →
  windscreen → appear-on-the-car, each gated by a physics probe outward from that egress spot
  (wall/ground/vehicle within the standoff = blocked). Overturned (`!isUpright`) exits play
  `CAR_crawloutRHS` with 09a root motion instead of the door slide; the windscreen egress crawls
  out over the bonnet; the last resort places the player on the car's world-top with no clip.
  Entering stays upright-only (unchanged).

  **CODE-COMPLETE 2026-07-24 — ledger:** `PhysicsWorld.pathClear(from, to, excludeBody)` (a solid
  ray excluding sensors — the seated rider's capsule IS a sensor at the ray origin) probes each
  egress from the car's centre. Upright exit: driver doorway → passenger doorway (`CAR_getout_rhs`
  through the mirrored door) → windscreen crawl (`CAR_crawloutRHS` root motion to a ground spot
  1.2 m past the bonnet, `groundBelow`-anchored) → appear on the roof (hz + 1, no clip, control
  returns instantly). Overturned (`!isUpright`): doors never swing — straight to the crawl-out.
  One real find: `driveSeated` re-seated the rider AFTER `drive()` in the same step, clobbering a
  crawl-out's clip and the roof placement — it now early-returns when the exit consumed the step
  (`exitopen` still seats: the door is only opening). `finishExit` faces out of the USED door
  (mirrored on rf). Tests: +4 egress cases (blocked-driver→rf, both→windscreen, all→roof,
  overturned→crawl) on a configurable blockage stub; all four packages **1280 green**.

  **Field round 6 (2026-07-24):** the wrong-side reads survived fr5; the wreck report cracked it —
  "the DRIVER door opens INTO THE WALL, he exits through the CLOSED PASSENGER door". The egress
  spots are YAW-planar, but the door panels ride the body's FULL orientation: on a roof-down car
  the derived yaw flips by π and model x mirrors in world, so swinging the yaw-frame `rf` moved the
  panel on the OPPOSITE world flank from the crawl. New `doorOnWorldFlank` maps the crawl-out's
  WORLD side to the physical door through the body quaternion (ε-biased tie-break: a side-lying
  car's x-axis is vertical and the dot is ±1e−16 float noise). For the upright wrong-side case the
  probes now ALSO explicitly exclude the player's collider (belt-and-braces against browser-Rapier
  sensor-flag differences — the seated capsule sits exactly ON the driver-side ray), and the wreck
  log carries the picked flank + door. Sim proof kept the warp itself clean (real `CAR_getout_LHS`
  root travel replayed at two headings — endpoints pinned, path always doorward). **1293 green.**

  **Field round 5 (2026-07-24):** the wrong-side exit SURVIVED round 4 ("both free → driver door
  opens, exits passenger; passenger blocked → correct"). A clean-room Rapier test proved the sensor
  exclusion and the rays sound — the bug was the HEIGHT BASE: `position.z − hz` sits BELOW the road
  on real models (the bbox is roof-heavy, the origin near the axles), so the knee ray ran at asphalt
  level and false-blocked whichever side faced the road CROWN — which for a kerb-parked car is
  always the driver side; toward the kerb the camber falls away, so the passenger ray stayed clear.
  Probe heights now anchor to `groundBelow` under the car. Also per the field read: a WRECK swings
  the door of the CHOSEN flank (rf-always read as "the wrong door opened"; nose/tail crawls swing
  nothing), and the wreck egress log carries the picked local offset.

  **Field round 4 (2026-07-24):** "the driver door opens but he exits the passenger side, even
  into a wall". Root pair: (a) the exit probe's KNEE ray was anchored to the car-centre height and
  GRAZED cambered roads/kerbs ~2 m out — the driver side false-blocked and the exit silently went
  right; probes are now two HORIZONTAL rays at fixed heights above the car's ground contact
  (0.35 / 0.85 m). (b) The "open driver door" was the ENTRY door stranded mid-swing: only the
  active side ever animated — `animateDoor` now always eases the INACTIVE door shut too. The
  egress pick is logged (`enter-vehicle: egress …`) for future field reads. Plus the user's
  side-lying case: a non-upright WRECK (roof-down OR on a flank) now PROBES four planar exits
  (right → left → nose → tail) instead of assuming rf — one flank is against the ground on a
  side-lying car — with appear-on-top when boxed in. Tests: side-lying crawl picks the clear
  flank; **1293 green**.

  **Field round 3 (2026-07-24, screenshot):** the overturned crawl-out buried the player — the
  target z was the RAW ground while `placePlayer` places the CAPSULE CENTRE, so half the capsule
  landed inside the collision (fell through / froze). Fixed: crawl targets lift by
  `PLAYER_STAND_LIFT 1 m`; and per the user's ask, the rf door now swings open ON the crawl-out
  side while crawling. Tests: ground-anchored-crawl-ends-standing + the rf-door swing pinned.

Execution order: **07 → 09a → 09c → 09b → 09d → 08** (07 is self-contained; 09a is the foundation
the rest of 09 samples through; 08 is independent and lowest-risk last).

**Field round 2 (2026-07-24, screenshots of the LS river bank):** four verdicts, all fixed same day.
(1) **"No sliding on the slope"** — two roots: the bank is ~42° (under the 45° threshold →
`slideSlopeDeg` 45 → **40**), and Rapier's kinematic controller NEVER accelerates a slide (it only
redirects the per-step desired motion ≈ millimetres) — the push is OURS now: `applySlidePush` adds
gravity's along-slope component per step (capped at 12 u/s), and the near-cancelling decel-to-rest
went to a `SLIDE_CONTROL_FACTOR 0.05` (airControl 0.3 was eating the push to a 0.1 u/s crawl).
(2) **Jump-laddering up steep slopes** — killed threefold: no jump OUT of a slide (SA rule, presses
never bank), landing ON steep ground goes straight to SLIDE (no LAND beat, no buffered re-launch),
and the slide pushes down faster than air control climbs. (3) **Exit into a blocked driver side** —
the probe now reaches 0.6 m PAST the doorway spot (a wall just beyond it still blocks the standing
body) and fires at two heights (target + knee — guardrails passed under the single ray).
(4) **Door clipping at enter AND exit** — the step-in became a three-leg route (back along the
standoff ring past the panel's swept rear edge `DOOR_SWEPT_CLEARANCE 0.95`, inboard BEHIND the
panel, forward into the doorway), and after an exit the door now STAYS OPEN (SA behaviour) — closing
it swept the panel through the player standing in the doorway. Doors got per-side angle tracking on
the way. Tests: slide-accelerates-downhill + jump-refused-while-sliding on the 48° ramp, the 3-leg
path pinned, exit-leaves-door-open updated; all four packages **1284 green**.

**Round-2 follow-up (same day):** "the exit door must CLOSE" — it now shuts on the step-clear
trigger (the same footprint+0.6 m check that restores car collision): open while the player stands
in the doorway, swings shut the moment he walks away, never through him. The test stub's `readBody`
grew a configurable body position on the way (it pinned every car to the origin, which put the
"stepped clear" player inside the footprint). **1285 green**.

### 06 — Close-out: defaults freeze + docs (DONE 2026-07-24 — round 1; round 2 re-runs it)

Field-judged defaults frozen on user verdict; `docs/features/character.md` rewritten for the FSM (also
fixing the stale `CharacterAnimationSystem` wording — the machine is inline in `engine-player.ts`
today and moves into the pure module this plan extracts); `MovementConfig` fields documented;
measured-numbers ledger completed per phase (standing rule). New limitation rows (e.g. "IFP root
translation still unused — launch height is physics-only") go to `docs/edge-cases/`.

## Ground rules

1. **Determinism**: all FSM timing counts fixed steps, never wall clock; tests drive the real Rapier
   world exactly like `character-controller.system.test.ts` does today.
2. **Renderer untouched**: the only render-side change in the whole chain is `sampleBlended` writing
   the same palette. Position/heading keep flowing through the existing `update()` surface.
3. **Clip-absent degradation is a tested invariant**, not a hope: every phase that adds a clip adds the
   "clip missing → v1 behaviour" test beside it (the `buildClipIndex` pattern).
4. **No blind tuning**: every constant that ships has a field verdict and lands in the ledger with its
   before/after (the 084 method — modloader-overlay field tests transfer directly).
5. **Scripted clips keep absolute priority** (vehicle enter/exit contract from `a16930e` is
   load-bearing); the FSM must be provably inert while `scripted` is set.

## Cross-links

- **Plan 074/08** promised the crossfade ("plan-08 sampler follow-up" comments in `engine-player.ts` /
  `ifp-sampler.ts`) — phase 02 pays that debt.
- **Plan 080 (cinematic camera)** consumes heading + speed; the phase-01 heading model gives it a
  stable, rate-limited signal instead of raw `atan2` jitter.
- **Plan 084** — the field-test method (modloader overlay, symptom→bytes) and the dynamic-lighting
  work this ped path already shares.
- **`docs/features/character.md`** — the current-state doc this plan supersedes in part (phase 06).
- SA reference: the original game's own feel (walk/run/sprint tiers, launch/glide/land jump) is the
  baseline; the AAA upgrades on top are the turn-rate arcs, crossfades, cycle-speed sync, coyote/buffer
  timing and landing recovery.
