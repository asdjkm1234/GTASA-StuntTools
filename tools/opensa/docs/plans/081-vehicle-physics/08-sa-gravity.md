# 081/08 — Vehicles under SA gravity (the 2g experiment)

**Status: CLOSED — REJECTED, do not reopen.** Field-rejected 2026-07-27 the day it was built; the complete
run (pin, lever, A/B matrices, verdict) is preserved on branch `081-08-sa-gravity`, and the postmortem —
with the two findings that ARE this experiment's product — is
`docs/postmortem/081-vehicle-physics/sa-faithful-feel.md`. The findings: the "weak at speed" complaint is a
SHAPE (lateral cap μ·g is speed-independent while demanded radius grows with v²), not a scale; and this
project's feel target is the field's verdict, not the original's numbers. The successor carrying the goal:
`09-speed-steering.md`.** What the rejection isolated: the persistent "weak turn-in at speed" complaint is not grip MAGNITUDE (it survived a 7x grip range, two gravities and two spring laws) — it is the SHAPE of lateral capability being speed-independent while demanded radius grows with v². The lever with the complaint's inverse shape is speed-dependent load (downforce-class), tried next on the liked baseline. The full evidence trail is
`docs/audit/vehicle-physics-081.md` (addendum, rounds 1-3) and 05's ledger.

## Why this exists — the conflict no constant can solve

The original is a **20 m/s² world** (`CPhysical::ApplyGravity`, `0.008` gu/frame²; verified against source).
Every number in `handling.cfg` was authored against that: engine and brake figures are absolute
accelerations a 2 g world makes reasonable, the tyre budget (`45 × TM` m/s² ≈ 3 g absolute) is 1.5× its own
gravity, and the spring law (`0.016 × forceLevel` per frame) rests a car at `1 − 1/(4 × forceLevel)` of its
travel under 2 g weight.

Porting that data into our 9.81 world forces a choice that three field rounds mapped out end to end:

| Tyre scale under 1 g          | Field verdict (2026-07-27)                                     |
| ----------------------------- | -------------------------------------------------------------- |
| `μ = TM` (baseline, shipped)  | liked overall; "hard to turn in at speed", evasion needs slowing down |
| `μ = 4.59 × TM` (SA absolute) | "weightless, uncontrollable, fast" — grip-to-weight 2× SA's    |
| `μ = 2.25 × TM` (SA dimensionless) | weight-feel right; at-speed evasion still ~half SA's      |

At 1 g you cannot have BOTH SA's cornering radii and SA's weight-feel — the missing factor is the gravity
the data was written for. The experiment supplies it.

## The one lever, and what it makes true by construction

**`gravityScale ≈ 2.04` (20 / 9.81) on the vehicle CHASSIS bodies only** (Rapier per-body API; peds, props
and the world stay at 9.81). Wheel loads double, and:

- **Tyres**: the shipped baseline `μ = TM × axle` × doubled loads ≈ SA's dimensionless ratio; exact form
  `μ = 2.25 × TM` × 2 g loads = `45 × TM × share × m` — SA's absolute budget, radii AND weight-feel both.
  (Decide inside the experiment which of the two the tyre lands on; the per-step load cap `min(4 × share,
  2)` returns with it.)
- **Springs**: move to SA's OWN absolute rate — `0.016 × fl × 2500 × sbRaw / span` per wheel (bridge-divided
  by the 1.15 constant), span = `upper − lower`. Under 2 g weight that rate settles at
  `share/(fl × axleBias)` of the span — **the standing pose 081/03's fix computes becomes the natural
  equilibrium** and the explicit `hubOffset` raise reduces to a consistency check.
- **Steering limiter**: unchanged and finally consistent — the angle it grants demands the budget the tyres
  now deliver; the permanent front-axle slide (`fTractionLoss` penalty + plow) at speed disappears.
- **Brakes**: authored `fBrakeDeceleration` becomes deliverable (grip = μ × 2 g loads); braking distances
  approach the original's.
- **Air**: falls, crests and jumps shorten to SA's pace (the current 1 g float is 2× SA's hang time).

## Order of work

1. **Pin the assumption first**: an isolated physics-world test that `gravityScale` flows through the whole
   raycast controller (suspension force doubles, settle height, grip cap doubles). If it does not — stop,
   the experiment is dead at one test's cost.
2. **Baselines BEFORE the lever** (the instrument rule): full scene matrix on the shipped state — `sweeper`
   (the at-speed discriminator), u-turn, slalom, brake-strip, crest-jump, stance, handbrake-flick — cars:
   infernus / admiral / firetruk / comet / turismo. Captures must record `gravityScale` (self-describing
   rule; springs learned this the hard way).
3. The lever + the spring law + the load-cap return, one commit.
4. Re-check the 1 g-calibrated smalls: `SUSPENSION_MAX_FORCE` (per-kg cap), `PARKING_BRAKE` (holds 2× weight
   on a slope?), `BRAKE_UNITS_PER_DECEL_PER_KG` (fitted at 1 g), `LOCKED_SIDE_FRICTION` (handbrake-flick
   re-measure), damage/impact thresholds (`CONTACT_FORCE_THRESHOLD`, vehicle-damage scale — 2 g spikes).
5. A/B matrix vs step-2 baselines + field round. Accept or revert as ONE unit.

## Known risks (from the audit round that staged this)

- **Springs 2-3× stiffer** — the old "invisible suspension / launch-hop" territory; damping ratios derive
  from the rate automatically but were tuned in another range. Main surprise candidate.
- **Kerb/landing spikes double** — the comet kerb flip likely worsens; 06's kerb probe becomes MORE urgent
  under 2 g, not less. Damage thresholds may misfire on ordinary driving until re-checked.
- **The outcome risk**: the at-speed complaint survived a 7× grip swing once already. If the real gate is an
  unmeasured delivery defect in DRCVC, gravity will not fix it — which is exactly what the step-2 `sweeper`
  baseline exists to expose as a NUMBER before the lever moves anything.
- Jumps become short and hard (SA-faithful; subjectively judged), telemetry g-channels double against all
  1 g history (`gravityScale` in the capture is the guard), and the whole replay baseline set refreshes.

## Acceptance

- `sweeper`: sustained |gLat| ≈ 2× the step-2 baseline at the same speed; heading actually comes round.
- Stance: sag ≈ `share/(fl × axleBias)` of span per corner; pose unchanged from the shipped fix (±1 cm);
  `weightOnGround ≈ 1` on the fleet.
- brake-strip / crest-jump / handbrake-flick within their re-derived envelopes; no new flips in the matrix.
- **Field: the obstacle-avoidance-at-speed case, driven by the user — the complaint this chain has now
  carried through four rounds either dies here or the investigation moves to DRCVC's side-force delivery.**
