# The suspension sag bridge (Rapier's settled length, solved by probe)

**What it is.** The constant relating Rapier's suspension force to how far a corner actually sinks —
`sag = load / (THIS × stiffness × mass)` — in `packages/game/src/physics/physics-world.ts`. Its neighbours
`SUSPENSION_COMPRESSION_RATIO`, `SUSPENSION_RELAXATION_RATIO` and `SUSPENSION_MAX_FORCE` are tuned numbers of
the same family.

**What it stands in for.** Solving Rapier's raycast-vehicle controller's own equilibrium. A force probe gives
**1.43** for the force law, but predicting SAG with 1.43 left every car sitting low: Rapier's settled length
is not purely the spring — its damping and relaxation terms are in there too.

**What it was judged on — and this is the honest part.** It is a MEASURED bridge, which is the only form
`CLAUDE.md` permits: solving the same relation from four settled cars (romero front and rear, infernus,
admiral — loads 3.4–8.7 kN, rates 12–25) gives **1.06 … 1.21**, and the shipped value is the middle of that.
Residual **±7 %**, i.e. under a centimetre of ride height on those cars. Measured with the ride-height probe,
not reasoned about.

It replaced something worse: a constant that assumed **every corner carries a quarter of the car**. That is
wrong for any car whose authored centre of mass is off-centre and spectacularly wrong for the romero hearse —
centre 0.8 m back, rear corners carrying 71 % of a 2.5 t body — which stood 7 cm low at the back and 5 cm
high at the front.

The sibling static-sag constant in the same file is fitted the same way: **2.0 against the analytic 1.72**,
because the load per wheel is not exactly a quarter of the weight. Fitted across a 4× rate range, residual
under 1 cm.

**What would retire it.** Solving the controller's equilibrium analytically instead of probing it — the gap
is real and named (damping + relaxation), so this is a derivation somebody can actually do, not a mystery.

**Blast radius.** Ride height on every car, and through it the stance law (081/03) that gates static sag
against the travel a car actually has. Getting it wrong sinks cars into the asphalt — that is the field
report that produced the constant in the first place.
