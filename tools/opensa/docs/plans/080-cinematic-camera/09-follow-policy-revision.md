# 080/09 — Follow-policy revision: movement never turns the camera

**Planned 2026-07-27 from the user's field brief** (after the 081 physics rounds, in the user's own words):
on foot, MOVING the character must not change the camera — left/right strafe leaves it static, walking away
is followed, walking at the camera dollies it back until it meets geometry; running opens the distance a
little, idling closes it a little. Everything smooth — the deliberate cuts (seat entry) stay, but one
unexplained camera JUMP was seen once and must be found, not guessed at. In cars the behaviour stays,
with a stronger pull-back under acceleration; the lagged turn-follow is liked as is.

This revises decided behaviour from 02/03/04/05, so it is a sub-plan, not a tuning note. The 2026-07-27
slip survey (`docs/benchmarks/vehicle-physics/readme.md` § camera slip survey) is the measured ground under
it — the drift channel is alive again, wiring verified, no code owed there.

## 1. Directional yaw authority (the core rule)

Today two writers rotate the on-foot yaw from MOVEMENT: turn-follow (arms on heading rate — a sharp turn
swings the camera behind the new direction) and idle recenter (look idle + moving → eases behind heading).
Both fire on lateral movement, which is exactly what the brief bans. The backing-up fix (auto-center
suspended while travelling toward the camera, `dot < 0`) already handles one quadrant of the problem.

**Replace the boolean suspension with a continuous directional authority** multiplying BOTH writers:

```
authority = smoothstep(authStart, authFull, dot(headingDir, cameraForwardPlanar))
```

- walking AWAY (dot ≈ 1) → full authority: idle recenter still eases behind a forward run (the GTA V feel);
- strafing (dot ≈ 0) → no authority: the camera holds, the character runs across the frame;
- walking AT the camera (dot < 0) → no authority: subsumes the backing-up fix, one rule instead of two.

First guesses `authStart 0.2`, `authFull 0.9` (config + Camera tab). Consequences, intended:

- **Turn-follow on foot effectively retires.** Its trigger (a fast heading change) is precisely the case
  the brief bans — after the turn the player is moving laterally, authority ≈ 0, no swing. The latch code
  stays (the authority just multiplies its output), which also retires the last arm/disarm hitch class on
  foot — the vehicle path already went continuous for that reason.
- The mouse stays the only instant yaw writer on foot. Vehicle mode is UNTOUCHED (continuous chase is the
  liked behaviour).
- Walking at the camera already dollies it back today (the orbit maintains distance translationally) and
  the 04 layer compresses against a wall behind — §4 verifies that path end-to-end instead of assuming it.

**Look-ahead stays as is** (the accepted 03 behaviour): it pans the LOOK POINT toward travel without
orbiting the eye. On a strafe that reads as "frames where you are going", not as rotation; if the field
round disagrees, `lookAheadScale` is already a live slider — judged there, not pre-decided here.

## 2. On-foot distance: run opens, idle closes

One new writer on the existing zoom channel (the damp is already there — no new smoothing):

- `footRunDistanceGain` (+0.6 m first guess) × smoothstep(`walkSpeed` 2, `runSpeed` 7, speed) — a run
  visibly gives the character room; full at run, so a sprint adds nothing further (the sprint FOV kick
  already owns that register).
- After `footIdleDelaySec` (5 s first guess) of NO movement AND no look input, the distance target eases in
  by `footIdleDistanceEase` (−0.4 m first guess) through a deliberately slow lambda (~0.5/s) — a resting
  camera settles closer, any input returns it through the normal zoom damp, never a snap. Needs its own
  stillness clock: `AutoCenterState.idleFor` counts HANDS only (movement does not reset it, by design), so
  the idle-distance timer is a separate accumulator over movement + look.

## 3. Vehicle: acceleration opens the distance

The liked speed→distance curve stays. On top: `vehicleAccelDistanceGain` (+1.0 m at 0.6 g first guess) ×
the LOW-PASSED longitudinal acceleration, positive only (braking already glides the camera in through the
speed curve; a two-sided kick would pump on gear noise — the same disease the FOV dead-band exists for).
The smoothed accel signal derives from the speed channel the snapshot already carries; no new physics tap.
Turn lag: untouched (explicitly LIKED — the user asked for exactly the current slight lag behind the car; it is `vehicleYawLagTime` 0.35 s).

## 4. The seen-once jump: instrument first, then fix what it names

The brief reports ONE unexplained camera jump. The rule this project keeps re-learning (blobMs, `other`):
a stall you cannot name is found by an instrument, not by staring at code. Two steps, in order:

1. **Watchdog**: a dev-only continuity check in the director — per-frame eye delta > ~1.5 m or yaw delta
   > ~20° while NOT in a legitimate discontinuity (teleport seed, mode switch, scripted seat sequence,
   `settling`) logs one `[cam] jump` line with the full step state (mode, collision shown/allowed, focus
   delta, dt, authority). Zero cost when quiet; the user reproduces at leisure.
2. **The prime suspect, fixable regardless**: the 04 pull-in is INSTANT by design and the probe casts
   against the whole Rapier world — including MOVING bodies. A traffic car or ped crossing the
   focus→eye line yanks the camera in for a frame and releases it: reads exactly as "a jump under strange
   circumstances". Design: the instant snap stays for STATIC geometry (a wall must never be shown), but a
   hit on a DYNAMIC body takes the eased path (`resolveCollision(..., eased)` — the machinery exists, the
   probe must also report WHAT it hit). GTA does not cut its camera for a passing car either.

If the watchdog names something else instead, that finding wins over this guess — the suspect fix ships
only when the watchdog (or the user's repro) confirms the class.

## Subtasks

- [x] Directional authority in `auto-center.ts` (§1) + config (`authStart`/`authFull`) + Camera-tab rows;
      the dot<0 suspension folds into it. Tests: strafe holds yaw; forward run still recenters; the
      toward-camera loop regression stays green; N-steps-vs-one frame-rate independence.
- [x] On-foot distance writers (§2: run gain + idle ease) + the stillness clock + config + tab rows.
      Tests: walk↔run continuity through the zoom damp; idle ease-in and instant-input return; caps.
- [x] Vehicle accel pull (§3): low-passed positive gLong × gain onto the distance target + config + tab.
      Tests: gear-noise robustness (a throttle blip must not pump), brake path unchanged.
- [x] The `[cam] jump` watchdog (§4.1) behind the existing perf-logs flag; every legitimate discontinuity
      flagged at its source so the log is quiet on a healthy session.
- [x] Dynamic-vs-static collision response (§4.2): probe reports body type; dynamic hits ease, static
      snap. Tests: scripted dynamic crosser eases; wall still snaps same-frame.
- [x] Field round: strafe/run/idle on foot, walk-at-camera into a wall, launches in a car, and a repro
      attempt on the jump with the watchdog live. Freeze the new numbers in this ledger.

## Ledger

### 2026-07-27 — code complete, AWAITING THE FIELD ROUND

**What landed** (2945 green, tsc + eslint clean; microbench
`docs/benchmarks/opensa-engine/2026-07-27-microbench-080-09-follow-policy.json`: foot 0.51/0.60 µs
mean/p95, vehicle 0.68/0.79 — ~60-100× under the 0.05 ms budget):

- **§1 authority**: `stepAutoCenter` takes `authority` (0..1). The idle-recenter RATE scales by it
  continuously; the latch and the continuous chase are gated (`LATCH_AUTHORITY` 0.95 for the latch, >0 for
  the chase) and report `released` when suppression cuts a steer short — the director then drops the
  in-flight `yawTarget`, so the camera freezes instead of finishing a swing the movement no longer
  justifies (a natural settle keeps the target — the fine end stays smooth). The director derives the
  authority from the SMOOTHED VELOCITY, not the heading — the deliberate deviation from this plan's
  own §1 text: the heading is rate-limited and lags a strafe, and the velocity dot is what the old
  `approaching` boolean already used, which the authority now subsumes. Look-ahead keeps the raw
  `!approaching` gate — its accepted behaviour is untouched by the yaw policy.
- **§2**: `footRunDistanceGain` × smoothstep(2, `footRunFullSpeed`, speed) opens the distance;
  a separate stillness clock (movement + look + zoom — unlike `autoCenter.idleFor`, which counts hands
  only) eases `footIdleDistanceEase` in at 0.5/s after `footIdleDelaySec` and returns it through
  `zoomLambda` on any input. Behaviour change noted: walking at the camera no longer RESETS the
  auto-center idle clock (it used to, via the suspension's `cancelAutoCenter`) — the mouse still does.
- **§3**: accel derived from the snapshot's signed speed (no new physics tap), low-passed at 2/s, positive
  only, capped at 1.5× the 6 m/s² reference; `vehicleAccelDistanceGain` × that joins the distance target.
  A one-frame +1 u/s blip moves the framing < 5 cm (pinned); braking and reverse never stretch.
- **§4.1**: `watchCameraJump` in the host (perf-logs flag): look-target jump > 1.5 m, or an idle-mouse yaw
  jump > 20°, outside teleport/mode-switch/settling/fly/bench → one `[cam] jump` line with the step state.
  Static collision snap-ins are deliberately NOT watched — they move the eye by design.
- **§4.2**: `PhysicsWorld.sphereCast` reports `dynamic` (anything not `isFixed` — a ped is kinematic, so
  "can move" is the test, not "is dynamic-typed"); `resolveCollision` snaps only for static hits, a moving
  body eases through `collisionReleaseTime` in BOTH directions and still converges on an occluder that
  stays (parked traffic ends up respected — pinned).
- `smoothstep` moved to `@opensa/math` (vehicle-camera's private copy replaced with the import).

**First-guess defaults (the field round tunes them)**: `footYawAuthorityStart/Full` 0.2/0.9 ·
`footRunDistanceGain` 0.6 m full at 7 u/s · `footIdleDelaySec` 5 s / `footIdleDistanceEase` 0.4 m ·
`vehicleAccelDistanceGain` 1 m at ~0.6 g. All on the Camera tab (7 new rows, count pinned at 46).

### 2026-07-27 — FIELD ROUND 1: everything reads right; the jump CAUGHT, named and fixed

User's verdict (paraphrased): **"everything else reads very well"** — and the seen-once jump turned out to reproduce
CONSTANTLY on vehicle entry: the camera centres on the car, approaches, then SLAMS the rest of the way in,
and driving from there is normal. The watchdog printed nothing — correctly, as it turned out: the jump
lives in the DISTANCE channel, and it is not a one-frame discontinuity but the end of a lagging glide.

**The mechanism** (found by reading `resolveCollision` against the report, no instrumentation needed): on
seat the desired distance glides 7 → ~4.4 through the zoom damp (λ=8) — the designed approach. But the
RENDERED distance is `collision.shown`, and the pull-in branch treated the falling desired as an arriving
occluder: during the seat sequence that path is EASED (λ≈1.7–2.5), so `shown` lagged the glide, and when
the 0.8 s settle window expired the eased flag dropped and the leftover difference completed as an instant
snap. Pre-09 code, pre-09 behaviour — the 05 entry retune (rest distance halved to one car length) made
the gap big enough to see, and the user's deliberate entry testing made it constant.

**The fix**: the collision layer only ever holds the eye CLOSER than desired (occlusion is its whole job);
a falling desired is the zoom channel's own, already-smoothed glide and is now followed directly
(`shown = min(shown, desired)` before the hit logic). A real occluder inside the falling desired still
snaps (static) or eases (dynamic/settling) exactly as before — every prior collision pin stays green, and
a new test drives the exact entry trace and asserts the window's end has nothing left to snap. 2946 green.

**Watchdog scope, recorded**: it watches the look target and idle-mouse yaw; distance-channel moves are
NOT watched, because designed occlusion snap-ins live there and would be noise. With this fix the distance
channel has no non-occlusion snap left by construction.

### 2026-07-27 — FIELD ROUND 2: entry re-checked, ACCEPTED. 09 is CLOSED, defaults FROZEN

"The jump is gone, the seat entry is smooth" (paraphrased). Every first-guess default ships as authored, not one number came back
for retuning: `footYawAuthorityStart/Full` **0.2 / 0.9** · `footRunDistanceGain` **0.6 m** full at
**7 u/s** · `footIdleDelaySec` **5 s** / `footIdleDistanceEase` **0.4 m** · `vehicleAccelDistanceGain`
**1 m** at ~0.6 g. The watchdog stays in (perf-logs only, quiet on a healthy session). Next per the
chain's own order: the 05 §6 look-behind key, then plan 10's candidates one field verdict at a time.

## Acceptance

- On foot: no camera yaw from any movement direction except easing behind a walk AWAY; run/idle distance
  reads as breathing, not as zoom; walking at the camera backs it to the wall and compresses, smoothly.
- In a car: launches stretch the framing, gear noise does not; the liked turn lag is untouched.
- The watchdog is silent through a normal session; the seen-once jump either reproduces and is named, or
  the dynamic-body ease removes the only credible cause.
- Every new number lives in `CameraConfig` + the Camera tab (plan 08's preset rule).
