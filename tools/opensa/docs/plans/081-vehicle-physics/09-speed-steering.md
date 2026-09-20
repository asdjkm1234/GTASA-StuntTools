# 081/09 — Responsive steering at speed (the field-stated goal)

**Status: SHIPPED — merged to `main` on field acceptance (2026-07-27).** The user's stated goal after four
rejected fidelity rounds: *"make steering at speed responsive enough to swerve round obstacles and enter
corners properly."* What shipped: the lateral speed-grip assist (dials 12 m/s / cap 3, field-tuned), the
`SLIDE_SPEED` 50× unit-bug fix that had been masking every steering round, and the session dials
(`?gripVd`, `?gripCap`) with capture self-description. The longitudinal twin (`driveGrip`) was tried and
field-rejected the same day — longitudinal feel is fleet-wide-frozen at the baseline; assists are
lateral-only (round 3 below).

## The insight this plan is built on (why the four rounds before it failed)

**Steering angle does not turn a car — lateral force does.** At speed the front tyres are already SATURATED
at the angle the limiter grants (110 km/h: the granted ~8° demands ~47 m/s², the baseline tyre supplies ~7).
More angle (full lock, faster slew, a softer limiter) adds NOTHING past saturation — it deepens the slide
and `fTractionLoss` then cuts the front a further 15 %: the plow. That is why "restore the full lock"
(081/05) did not close the complaint, and why it survived a 7× grip-scale range and a 2× gravity change
unchanged: uniform grip scaling moves LOW-speed feel (which the field likes as is) in lockstep with
high-speed capability. The complaint's shape — strong at 30 km/h, helpless at 130 — needs a lever with the
OPPOSITE shape: capability that grows with speed.

## Design

**One mechanism: lateral grip that grows with speed** (downforce-form, VIRTUAL — a factor in the tyre's
friction coefficient, never a real force):

```
boost(v) = min(1 + (v / SPEED_GRIP_REFERENCE)², SPEED_GRIP_CAP)     // start: 20 m/s, 2.5
```

- Applied ONLY to the `frictionSlip` handed to Rapier (the lateral solver's cap). The engine clamp and the
  brake cap stay on the UNBOOSTED grip: launches, acceleration, braking and top speed are byte-identical to
  the field-liked baseline — the four rounds' verdicts on longitudinal feel are settled and respected.
- The slide detector runs against the boosted circle (or every wheel at speed reads "sliding" and the loss
  factor eats the boost).
- The steering limiter is UNTOUCHED: its granted angle already roughly matches the boosted budget, and the
  saturation analysis above says angle is not the bottleneck.
- Expected numbers at the starting dials: entry yaw at 110 km/h **13°/s → ~32°/s**; a 3 m swerve at
  110 km/h **~29 m of road → ~13 m**; ordinary corner entries (50–90 km/h) gain ×1.5–2; below 40 km/h the
  factor is ≤1.3 — town driving and weight-feel stay the baseline's.

**Tuning protocol — the dial belongs to the field.** `?gripVd=<m/s>&gripCap=<×>` override the two constants
per session; the F2 Physics tab shows the ACTIVE values (self-description). The user drives, adjusts, and
the accepted numbers get committed as the defaults. Feel targets come from field verdicts — the 08
postmortem's second finding, operationalised.

## Honesty ledger

This is a deliberate assist the original does not have, and it is documented as one (here, in
`features/vehicles.md`, and in the tyre-constant comment). The original "solves" the same shape with ~3 g
arcade tyres and 2 g gravity — both field-rejected wholesale in 08. Physics stays the honest frame; the
target numbers are the field's.

## Risks

1. **Roll at speed**: ×2.5 lateral is ×2.5 roll moment in fast manoeuvres — the slalom (which flips the
   infernus at baseline already) and the sweeper are the watch instruments; `SPEED_GRIP_CAP` is the one
   safety dial.
2. **Handbrake-flick at speed** changes slightly (a locked axle keeps `LOCKED_SIDE_FRICTION` of a BOOSTED
   side force) — re-measured on the flick scene, re-tuned only if the field notices.
3. **Snap via the countersteer exemption**: once the boosted tyre finally lets a car reach real slip at
   speed, the limiter's exemption hands FULL lock mid-slide (the baseline sweeper's spin mechanism). If the
   field reports "responsive but snaps", smoothing that exemption is the ONE queued follow-up — its own
   step, not part of this change.

## A/B instruments

The `2026-07-27-sa-gravity-baseline-*.json` matrices (5 cars × 11 scenes) ARE this plan's before-set: they
were captured on physics identical to today's `main`, and since this change leaves the longitudinal path
untouched, scene entry speeds match — the first clean cross-config comparison this chain gets. After-set on
the branch; `sweeper` entry window (6–8.5 s) yaw/gLat and the spin-vs-arc outcome are the headline;
`slalom`/`u-turn` roll peaks are the safety gate.

## Acceptance

- Sweeper entry (moderate steer, ~100 km/h): sustained yaw ≥ 2× baseline, and the car ARCS (slip bounded)
  instead of plowing straight or spinning.
- Slalom/u-turn roll peaks not materially worse than baseline at the shipped `SPEED_GRIP_CAP`.
- Launch / brake-strip / rest / crest summaries within noise of baseline (the untouched-longitudinal claim,
  verified rather than asserted).
- **Field: "obstacle evasion at 100-130 km/h" (paraphrased) — possible, controllable, and the low-speed feel unchanged.
  The user names the final dial values.**

## Ledger

_(A/B numbers, tuning rounds, field verdict)_

### 2026-07-27 — round 3: `driveGrip` tried and FIELD-REJECTED same hour (reverted, `aa1e0d4`)

The longitudinal twin (`DRIVE_GRIP_BOOST = 2` on the drive clamp, `c38dd6c`) was built to let a race row's
authored engine reach the road ("the comet launches like an admiral" — both were clamped to ~0.33 g by
near-identical rear-axle grip caps). The field rejected it immediately: *"it affected every car and their
speed in general"* — which is exactly what a GLOBAL clamp boost does, since most of the fleet's engine
requests sit above the old clamp somewhere in their band. The verdict draws a useful line: **longitudinal
feel is fleet-wide-frozen at the baseline; the accepted assists are lateral-only.** A future
"race cars launch harder" would have to DIFFERENTIATE, not lift globally — e.g. the original's own RWD
tyre-temperature mechanic (`m_fTireTemperature`, burnout heating), which scales per car by its own drive
type and behaviour rather than by a shared dial. Parked, not queued.

**Coverage note (close of session 2026-07-27) — CLOSED the same day.** The SHIPPED state (assist 12/3 + the
SLIDE_SPEED fix) had no committed capture matrix: the mid-session after-sets were obsoleted by the bug fix
landing between runs. It was folded into 07's regression pack and that pack is now recorded —
`docs/benchmarks/vehicle-physics/2026-07-27-headless-shipped-<car>.json`, 5 cars × 11 scenes on `e50d913`
with the dials at 12/3, gated by `scripts/phys-regression.ts` (081/07 ledger). One caveat that belongs to
THIS plan: on the sweeper, its headline instrument, the two fastest cars hit something about a second into
the corner, so their `turnedDeg` is not a cornering number — the arc numbers in this ledger come from the
cars that stayed on the road.
