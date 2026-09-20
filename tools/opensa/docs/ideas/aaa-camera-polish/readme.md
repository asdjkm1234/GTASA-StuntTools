# AAA camera polish v2 — the garnish pass, rebuilt on a fixed foundation

**Status: IDEA (2026-07-29).** The reworked successor of the deleted plan `080/10 — AAA polish`: its first
feature (corner peek) was BUILT TWICE on 2026-07-28 and field-rejected twice, the whole feature was rolled
back off `main` and the plan doc deleted — **shelved, not abandoned**. This doc carries everything those
two rounds taught, so the next attempt starts from the diagnosis instead of re-deriving it. The complete
code of both attempts (writers, tests, config, tab rows, ledger) is archived on branch
**`080-10-corner-peek`** (`ac97a67` heading route · `567d5a1` look-point route).

The one-line lesson that reshapes the whole idea: **the garnish failed because the FOUNDATION under it —
the driving camera's yaw chase — is muted exactly where driving garnish lives (mid-corner). The rework
therefore starts with the camera, not with the effects.** Priorities below run R1→R3 (foundation) before
E1→E5 (effects); nothing in E-land may start before R-land holds in the field.

---

## 1. What was tried, and how it failed (2026-07-28, both rounds)

| Round | Route | Verdict |
| --- | --- | --- |
| 1 | `peekYaw` added to the heading fed to the auto-center chase (like the drift lean) | INVISIBLE. A/B at scale 0↔0.3, lean off, FULL SPEED 8 — "no difference at all". Headless u-turn showed why: `yaw` froze for 10+ s mid-corner while steer share sat at 1.000. |
| 2 | `peekLookYaw` as a lateral LOOK-POINT shift, `tan(peek) × distance` along screen right (eye+target together, look-ahead style) | Mechanically alive (verified live: 0.056 rad / 0.44 m at 15.3 u/s full lock) but the FEEL failed: **"sticks and jumps in big corners, near-invisible in small ones."** |

An earlier "seems fine" on round 1 was retracted hours later — the standing rule since: **a soft first
impression is not a verdict; ask for the explicit A/B (scale 0 ↔ max, drift lean off) before recording
anything as approved.** And the sim that "validated" round 1 used a gentle 0.35 rad/s corner the chase
could keep up with — **camera work is validated against a HARD corner (the `?phys=u-turn` scene), never a
gentle one.**

## 2. The root cause (the finding that survives every future design)

Plan 080/09 §1 gave the rig a **directional yaw authority**: movement may rotate the camera only in
proportion to how cleanly it moves AWAY from it (`smoothstep(footYawAuthorityStart, footYawAuthorityFull,
away)`). That law was designed for the PED — it kills the about-face spin loop, because on-foot movement
input is CAMERA-relative, and recentring behind a backing-up player flips what "back" means.

**In a car, mid-corner, the velocity crosses the frame → away ≈ 0 → authority ≈ 0 → the chase is muted.**
Seen live in the u-turn: the turn-follow latch starts a swing, the authority cuts it (`step.released`
drops the in-flight target), and the camera hangs off-axis indefinitely — a self-sustaining deadlock
(camera sideways → motion across the frame → authority 0 → never resumes) until the mouse touches it.

Two consequences:

- **A writer that is only non-zero in corners cannot ride the heading channel** — it is muted precisely
  where the writer lives. (The drift lean survives because a slide keeps some away-component and its
  payoff also reads in the settle AFTER the slide.)
- The muted chase is a live UX bug in its own right, garnish aside: hands-off, a hard corner leaves the
  camera stuck off-axis for many seconds. Nobody reported it only because the mouse hides it.

**The key open hypothesis this creates: with the chase FIXED (R1), the original round-1 heading route may
simply work** — peek as a heading offset again, riding a chase that is now alive mid-corner, inheriting
every existing rule (swing, settle epsilon, manual override) with zero new machinery. Test that FIRST
before resurrecting the look-point route.

## 3. The "sticks and jumps" anatomy (why round 2 felt broken — designed away, not tuned away)

The look-point shift moved the frame instantly and correctly; the breakage was **two writers moving the
frame with different time constants, in different frames of reference**:

1. **Stick**: mid-corner the muted chase lets the camera lag far off-axis — the frame feels pinned while
   the world turns (the peek shift, a constant offset, cannot mask a growing chase error).
2. **Jump**: on corner exit the authority returns / the latch fires — the yaw channel swings the camera
   behind the car at ITS rate while the peek offset decays at the steer low-pass rate, and
3. the offset was expressed in the CAMERA's screen frame (`screenBasis(forward)`), so the swing ROTATES
   the remaining offset while both are in flight — the compound motion reads as a jump;
4. minor: the collision cast runs from the shifted look point, so a fast offset change can also step the
   collision distance.

Design rules for any future composition writer, all four born here:

- **One frame of reference**: express driving-composition offsets in the CAR's heading frame, not the
  camera's screen frame — a camera swing must not rotate an applied offset.
- **One time authority**: a composition offset gets its own spring (`lookAheadTime`-class, slower than the
  yaw channel) so it can never race the chase; while a steered swing (`yawTarget`) is in flight, the
  offset target HOLDS (single-mover rule) instead of decaying mid-swing.
- **The chase must be alive first**: composition garnish is a residual on top of a camera that is already
  roughly behind the car — it must never be the thing compensating for a dead chase.
- **Continuity is an acceptance metric, not a hope**: on the u-turn exam, the look point may not move
  against its focus by more than the 06 transition budget (~1 u/frame) at any point, corner exit included
  — the same invariant `camera-transitions.test.ts` already pins for mode changes.

## 4. The rework, prioritized (R = camera foundation, E = effects)

### R1 — Vehicle yaw authority: give the car its own law (THE prerequisite)

The about-face rationale does not apply to cars: **A/D steer the CAR, not the camera** — there is no
camera-relative flip to protect against, and reverse already has its own framing rules. Options, in
preference order:

1. Vehicle mode runs FULL authority whenever `|speed| > moveThreshold` (one branch in the authority
   computation; foot behaviour untouched).
2. A vehicle-specific authority band (config pair in the vehicle tuning table) if the field says full
   authority over-rotates in some case (e.g. sliding sideways into a parking spot).

Acceptance: hands-off u-turn — the yaw follows the car through the whole turn and settles behind it within
`vehicleRecenterDelaySec` + a swing; no frozen-yaw window at any point. The existing on-foot 09 pins
(strafe/toward hold the yaw for good) stay green untouched — this is per-mode, and the 09 field acceptance
must not be re-litigated on foot.

### R2 — One driving-composition channel (only if R1 alone is not enough)

If the heading route still under-delivers after R1 (e.g. the chase's lag eats the peek in transients), add
ONE owner for driving composition offsets: a springed look-point offset in the CAR's heading frame
(`smoothDamp`, `lookAheadTime`-class), fed by the sum of writers (peek now, speed-pose look-rise later),
budgeted by the shared `vehicleLookOffsetMax` clamp (0.35 rad — the lean spends first, the rest is the
budget), holding its target while a steered swing is in flight, collision cast from the shifted point.
This is round 2's machinery done right — the archive branch has the raw material.

### R3 — The composition exam becomes a test

Extend the transition-matrix suite with the hard-corner scenario: scripted u-turn-shaped snapshot sequence
(heading sweeping at ≥1 rad/s), assert the continuity budget frame-by-frame with every driving writer at
max. This is what the two field rounds lacked — the "sticks and jumps" was invisible to every existing
test and both sims.

### E1 — Corner peek v2 (first effect; validates the rework)

- Formula unchanged: `peekYaw = vehiclePeekScale × steerSmoothed × smoothstep(peekMin, peekFull, |speed|)`;
  first guesses 0.10 rad, 5→20 u/s; low-passed steer (λ≈5/s) so a slalom averages toward centre.
- Steer source (resurrect from the branch): `drivenSteer()` = applied front-wheel angle ÷ the car's OWN
  `steeringLock` (asset-derived, −1..1, positive = left, D → negative). It already carries SA's
  speed-sensitive limiter — granted share ≈1 up to ~15 u/s, 0.89 @ 20, 0.56 @ 25, 0.38 @ 30 — so the peek
  self-tames at highway speed with no extra curve.
- Route: heading offset through the R1-fixed chase (the primary hypothesis); the R2 channel only if the
  field says the chase's lag still eats it.
- Field protocol: explicit A/B (scale 0 ↔ 0.3, lean off, FULL SPEED 8), hard corner AND small corner,
  comfort verdict asked explicitly, hands-off (the peek rides hands-off channels).

### E2 — Speed pose (the camera gets low and long)

Unchanged from the old plan: polar target −`vehicleSpeedPitchDrop` (~0.06 rad) + look-point height
+`vehicleSpeedLookRise` (~0.25 m), both × the SAME smoothstep the FOV kick uses (6→28 u/s) — one speed
authority, three outputs. Independent of the chase (speed-gated, not corner-gated), so it could even land
before E1 if the peek stalls — but it shares the look-point budget with R2, so it lands after the rework
either way.

### E3 — Fall stretch (on foot)

Unchanged: past ~8 u/s of fall speed, FOV +~0.05 rad and distance +~0.5 m, easing in over ~0.5 s,
recovering through the existing damps into the HARD_LAND shake. The landing DIP stays dead (06 round 4 —
a 20 cm eye offset does not read at a 7 m orbit; this reads because it changes the LENS). No interaction
with the driving rework at all.

### E4 — Directional impact kick

Unchanged: seed the 06 shake's FIRST offset opposite the hit direction, then decay into the existing
noise; rides `shakeScale`, no new config. Source note from 089/04: the damage system's
`onStrongHit(force, point)` already carries the contact — likely cleaner than `impactForce()` (which is
magnitude-only).

### E5 — High-speed wind shake

Unchanged, and still last for a reason: above ~0.75 × the FOV curve's full speed, continuous noise ramping
to ~0.02 m (an order under the impact shake) on the existing generator. First candidate to die if it reads
as jitter.

## 5. Standing contracts every feature keeps (from the 080 chain — unchanged)

- ADDITIVE, config-scaled, individually deniable; invisible at scale 0; `reducedMotion` zeroes every one
  (the 06 contract). No roll, ever.
- The sum of additive offsets stays inside the 06 cap (`MOTION_CAP` 0.25 m) and the collision margin; the
  driving look writers stay inside the `vehicleLookOffsetMax` budget.
- No feature moves a bench number (the bench camera bypass is the standing invariant).
- One field verdict at a time, each feature freezes or dies in its own ledger — and per §1, the A/B is
  asked for explicitly before anything is recorded as approved.

## 6. Tooling that already exists (do not rebuild)

- **Headless camera diagnosis**: a temp throttled `console.log('[peek] …')` after `stepCamera` in the host
  + `TAG='[peek]' drive.js "…?loader=http-dir&src=$SRC&phys=u-turn&car=infernus"` — one scripted lap, no
  user round-trip (`npm run serve:static` :3001 + vite :5173). This found the frozen yaw in one run after
  two blind field rounds.
- Sign conventions, verified: heading+ = left (CCW); camera yaw+ = look left; `screenBasis` right at yaw π
  (looking −Z) = +X; applied steer positive = left (D → negative).
- The archive branch's test patterns: zero-scale parity to 12 decimals, the every-frame A↔D slalom bound,
  eye+target moving together, the shared-clamp budget pins.

## 7. Open questions (research before this graduates to a concept)

1. Does R1 (full vehicle authority) change anything the 09 field round actually approved for DRIVING?
   (The 09 approval was mostly entries/launches/general driving — re-read its ledger; a hands-off hard
   corner was likely never in the protocol, which is how the muted chase shipped unnoticed.)
2. With R1 in place, does the heading-route peek read at ~6°, or does chase lag still eat transient
   corners? (Decides whether R2 is built at all.)
3. Does the drift lean need to migrate into the R2 channel too, or stay on the heading? (It is
   field-proven where it is — default: do not touch it.)
4. `vehicleLookOffsetMax` as a budget was never field-felt (both rounds died earlier) — is 0.35 rad right
   once writers actually compose?
5. Is there a comfort ceiling on frame-shift-based writers at all at a 7–9 m orbit? (The "near-invisible
   in small corners" half of the verdict may mean angular effects need to be LARGER than plan guesses at
   this distance — or that this distance cannot carry them.)
