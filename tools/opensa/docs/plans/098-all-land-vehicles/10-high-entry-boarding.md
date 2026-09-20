# 10 — High entry: climb ON before you get IN

**Goal:** a vehicle whose way in is above a ped's reach is boarded by climbing onto it first, instead
of leaving the player jumping at the hull. Field symptom: the Rhino's hatch is on top and getting in
is a fight. Field checkpoint: walk up to the tank, one continuous climb-then-enter, no jumping.

**Not a hardcode.** The user's framing was "maybe hardcode it for rhino, or work it out if the door
is on top" — the second reading is the one the standing rule allows: *"NEVER hardcode a value for a
specific car/model/asset"* (`CLAUDE.md`). The entry height is something every model states about
itself; a rhino-shaped special case would break the moment the mod moves slot, and would do nothing
for the next tall vehicle.

## What is measured (2026-08-07, the GTA 5 Rhino's own DFF)

| Thing | Where (model space) |
| --- | --- |
| `door_lf` hinge | (0.007, **2.280**, **+0.823**) |
| `ped_frontseat` | (0.259, 2.317, +0.013) |
| ground contact plane | z ≈ **−0.999** (wheel z −0.349, built radius 0.65) |
| chassis mesh | 3.77 × 8.29 × **1.54 m** |

So the hinge stands **1.82 m above the ground the tank rests on**, and the seat 1.01 m above it.
That is the number the rule keys on — not the model name. A stock four-door sits far below it (its
hinge is roughly at hip height); this is well over a ped's step-up.

Note the door is *modelled*, so the existing boarding chain already picks a side and swings it — the
gap is purely the approach: the ped is asked to reach something above their shoulder.

## Design

- **Derive an entry height per vehicle**: the boarding part's hinge (or `ped_frontseat` where a model
  has no door part — `NO_DOORS` vehicles in 098/07) measured against the vehicle's ground contact
  plane, which physics already knows. One fixture field, computed at build time.
- **Compare it against the PED's reach, not a constant.** The character controller already owns a
  step-up/climb capability for world geometry; the threshold that decides "climb first" has to be
  that same capability, so the two never disagree and no new tuning number appears. If the ped's
  reach is not currently expressed as a number, extracting it IS part of this plan.
- **Two-stage boarding when it is exceeded**: approach → climb onto the hull (the existing climb
  animation and a landing spot derived from the hull's top surface above the door) → then the normal
  enter chain from there. Everything after the climb is the code 098/07 already has; this plan adds
  the stage in front of it, it does not fork boarding.
- **Derive the landing spot from geometry too** — the hull top over the door, not an offset chosen by
  eye. A fitted offset is a `docs/hacks/` entry, in the same change, saying what it stands in for.
- **Exit is the same problem backwards** and must be planned with it: stepping out of a hatch 1.8 m
  up needs the climb-down, or the ped falls. 098/07's exit chain is the seam.
- **Recover SA's behaviour before inventing one**: SA has a tank and boards it somehow. Read
  `CTaskComplexEnterCar`/the ped entry tasks in gta-reversed (`docs/links.md`) and record what it
  actually does — including "nothing special", which is itself an answer worth writing down, since
  then the improvement is ours to justify against `docs/project-goals.md` (beating a 2004 compromise
  is allowed; it just has to be argued and demonstrated).

## Steps

- [ ] Recon: SA's own entry task for a high vehicle — **half answered 2026-08-20 by 13's census: the Rhino's
      handling row selects `tankcaranims` (col 34 = 24), a one-sided `tank.ifp` set with a 25-frame
      `TANK_align_LHS`; SA boards it by ANIMATION, not by a climb stage. Judge in the field whether that
      authored set closes the symptom before building the stage.** Then: the ped controller's existing climb/step-up
      capability and whether it is a number we can read. Both into the ledger.
- [ ] Fixture + builder: entry height per vehicle, additive `.osm` DESC field.
- [ ] Runtime: the climb stage in front of the existing enter chain, gated on entry height vs ped
      reach; the mirrored exit. Tested against the REAL rhino rig fixture and a stock car (which
      must take the unchanged path — the regression that matters).
- [ ] Field close-out: board and leave the tank; then board a stock car and confirm nothing changed.

## Verification

Headless: the gate fires for the rhino rig and provably does not for a stock car; the derived landing
spot lands on the hull. Field: the visual verdict above, both directions. Ledger records the measured
entry heights, the ped reach it was compared against, and any offset that had to be fitted.

## Ledger

(recon findings; measured numbers; field verdicts)
