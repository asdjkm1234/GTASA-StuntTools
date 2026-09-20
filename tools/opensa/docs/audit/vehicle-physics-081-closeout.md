# Audit — vehicle physics 081, the close-out (06 air + camber, 07 classes), 2026-07-27

The third and last audit of the 081 chain. The first covered 01–05 (`vehicle-physics-081.md`), the second
the instruments day (`vehicle-physics-081-instruments.md`); this one covers what closed the chain: the two
remaining halves of plan 06 and the generalisation sweep of plan 07.

Raw numbers: [`../benchmarks/vehicle-physics/`](../benchmarks/vehicle-physics/) (class sweep + the air-control
A/B) and [`../benchmarks/index.md`](../benchmarks/index.md) (the vehicle slice). Reasoning per decision: the
sub-plan ledgers.

## What changed

| Item                       | What it is                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **06 §1 air control**      | The original's three in-air turn forces, ported through the authored `fTurnMass`: 1.75 rad/s² per unit of stick, SA's 1 rad/s "do not fight a tumble" gate, W/S pitch · A/D roll · A/D+lever yaw. Dial `?airCtl`. |
| **06 §3 camber**           | `modelFlags`' axle nibbles typed into the handling row and drawn: a SOLID axle takes the body's roll back out (`atan(Δlift/track)`, no constant), an independent one leans a fraction of it. |
| **capture `air` channel**  | The longest unbroken flight, where it was, and what the nose did during it — `airborneS` is a total and could not answer whether the driver ever flew. |
| **07 §1 class sweep**      | Five cars across the classes the calibration trio does not cover, four scenes each.               |
| **07 §4 close-out**        | The DRCVC quirks ledger written out as a table; 018 banner; the lap guide's schema.               |

Two authored fields joined the read set (`modelFlags`' two axle nibbles), taking `handling.cfg` from 21 read
fields to 23 of ~40. **One fitted constant was added** — the independent-axle camber gain, 0.44 rad/m — and
it is the only one in either item; the air law and the solid-axle rule are derivations.

## What it cost

- **Two new modules**, both pure and unit-tested: `vehicle/air-control.ts` (the SA block, its derivation, and
  its three documented deviations) and the camber half of `vehicle/vehicle-rig.ts`.
- **One physics-world write**: `spin()` adds to a body's angular velocity, because the original adds to
  `m_vecTurnSpeed` and dividing by a collider's inertia tensor instead would answer to a number no handling
  row can aim.
- **The vehicle slice: nothing measurable, and the attempt to measure it produced a more useful number.**
  Three bench runs of the same six scenes — before 06, after it, and after resolving the camber geometry once
  per car instead of per step — read **0.605 / 0.639 / 0.663 ms** at 80 live cars, while `sf-fog-dawn` went
  0.555 → 0.613 → **0.554** and `country-dusk` 0.176 → 0.186 → **0.166**. The spread is not the change: this
  metric repeats to about **±5 %**, so the camber arithmetic is below its own noise floor. The memoisation was
  kept because it is strictly less work, not because a run proved it. **A single vehicle-slice number is worth
  ±5 %** — worth knowing before the next tuning round reads two of them as a regression. Air control costs
  nothing for a car nobody drives.
- **No render cost**: the lean rides the wheel's existing part rotation.

## What it bought

- A jump is **controllable**: on the lap with real air, holding W brings the nose up +35.6° against +24.4°
  ballistic, and the car lands 1.3 s sooner.
- Wheels that **lean the way the car was authored** — 27 of the built `handling.cfg`'s 210 rows say how, 19
  of them with a solid rear axle.
- **The proof that the chain generalises**: the SA stance law, the drivetrain clamp, the brake bias and the
  dive all hold on classes they were never tuned against — five cars, three different acceleration limits,
  every one of them the car's own authored number, and **no class-factor table needed**.

## What it exposed (the honest half)

Both measured items ended by indicting an INSTRUMENT rather than the physics, which is the same shape as the
instruments day's `kerb-strike` finding:

- **`crest-jump` is a crest, not a jump.** Its longest unbroken flight is 0.2–0.5 s and two runs do not even
  pick the same one. Air control cannot be judged there; `u-turn` is the lap with real air.
- **`brake-strip` brakes at ~8.5 s, and low-power classes are still accelerating.** Its top-speed column is a
  top speed for a sports car and a "how far it got" for a bus.
- **`step-steer` and `u-turn` hit scenery** with anything wider or taller than the calibration trio — a bus
  turns 0.28° across its whole step-steer lap. No per-class cornering verdict came off them.

**Owed, and named**: a scene that flies on purpose, and clean ground for the laps that leave the road (07 §3
already owed the second one; the class sweep owes it again, plus a spot a bus fits on).

## What is left before 081 is DONE

Everything measurable is shipped and recorded. What remains is a **field verdict** — the chain's own gate:

1. Jumps, with the air control on and `?airCtl=0` beside it.
2. A solid-axle car (savanna, picador) and an independent one (infernus) through the same corner: the two
   must be distinguishable on screen, or the axle data is not reaching the render.
3. One drive per class ("does each feel like itself") — the sweep hands it the numbers to argue with.
