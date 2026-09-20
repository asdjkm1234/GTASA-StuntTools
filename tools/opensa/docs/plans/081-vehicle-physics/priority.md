# 081 — execution priority

A dependency chain with one deliberate decision point (the plan-05 gate). Each plan ends with a
field round; tuning debt never stacks more than one layer.

| Order | Plan                           | Why it sits here                                                                                                                                                                                                                      |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **01 Telemetry**               | The chain's founding rule: nothing tuned blind. Instruments + replays + the BEFORE baseline that every later A/B needs. Also delivers the slip signal 080/05 (vehicle camera) consumes — unblocks that chain's drift framing early.   |
| 2     | **02 handling truth**          | The root-cause plan: authored COM (flip fix's foundation), full unit mapping, per-car suspension, control-latency fix. Everything later reads its typed fields; tuning 03–05 against wrong mass properties would be wasted work.      |
| 3     | **03 Stability**               | Closes the two loudest complaints with 02's foundation (nose-down braking, honest flip resistance) and removes the angular-damping band-aid — 04/05 must tune against live body dynamics, not deadened ones.                          |
| 4     | **04 Drivetrain + brakes**     | Longitudinal identity (gears, drive type, brake bias, SA handbrake). Needs 02's units; benefits from 03's honest body motion (squat/dive read correctly). The handbrake rear-cut is also the first real input to the 05 gate's G2.    |
| 5     | **05 Tyres + steering + GATE** | Needs everything before it: the gate judges DRCVC's ceiling only after COM/suspension/stability/drivetrain are honest — otherwise the verdict blames the controller for our own unmapped data. The chain's one architecture decision. |
| 6     | **06 Air/kerbs/visual**        | Tunes against the FINAL tyre behaviour (post-gate); the kerb fix even changes shape depending on the gate verdict (probe vs shapecast). Highest perceived-quality-per-line, lowest risk — safe last.                                  |
| 7     | **07 Presets + physics CI**    | Generalisation + freeze: needs the final feel to set class factors and regression bands. Hands 0.5.0/04 its preset table.                                                                                                             |

## Checkpoint rhythm

- **After every plan 02–06**: user field round; verdict + frozen values into that plan's ledger
  before the next starts. In-session A/B via the F2 Physics tab's live constants (physics has no
  honest `?legacy` twin world).
- **Replays run at every plan boundary** from plan 01 on — regressions surface one plan after they
  are introduced at the latest.
- 02+03 may share one field round if scheduling favours it (03's forces are the visible half of
  02's foundation); no other merging — 04 (longitudinal), 05 (lateral+gate), 06 (polish) each need
  an isolated verdict.

## Fast path

The two loudest complaints die at **01 → 02 → 03** (flips + brake nose, measured and field-signed).
**04** adds per-car character and the SA handbrake; **05** settles the architecture question and
finishes cornering feel; **06 → 07** are polish and insurance. As with 080, the chain is shippable
after any field-accepted plan.

## Interplay with 080 (camera)

Not blocking either way, but the joint feel is multiplicative: 080/05 (vehicle camera lag/drift
framing) lands best AFTER 081/01 (slip signal exists) and is genuinely judged only once 081/04-05
make slides real. If both chains run interleaved, the natural weave is
081/01-03 → 080/01-04 → 081/04-05 → 080/05 → 081/06-07 → 080/06-07.
