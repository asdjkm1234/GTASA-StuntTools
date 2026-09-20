# SA-faithful feel: three grip scales and the 2g experiment (081 post-close-out, 2026-07-27)

**The goal.** One day after 081/01–05 closed out, the field reported two things: "hard to turn in at speed /
feels overweighted" and "the turismo is slammed". An audit against the reversed source found both real — and
the fixes that followed bet, in three escalating steps, that the answer was MORE fidelity to the original:
first SA's tyre budget under 1 g (two normalisations), then the original's whole world (vehicles under SA
gravity with SA's absolute spring law). The stance fix survived; the fidelity bet died in four field rounds
in one day. This file is the record of why.

## Where the code lives

- **Shipped and kept on `main`**: the standing-pose law (`suspensionSetup`'s `hubOffset` — the turismo fix,
  field-confirmed), the visible suspension travel channel (081/06 §3's travel half), the `sweeper` scene,
  and the audit's doc corrections. Commits `91b3b55` → `3e389bc`.
- **Dead, preserved on branch `081-08-sa-gravity`**: the 2g experiment — pin `4e7bb1c`, lever `0e8b108`,
  A/B `7e6c47a`, verdict `4c90e71`. The A/B capture matrices are in
  `docs/benchmarks/vehicle-physics/2026-07-27-sa-gravity-{baseline,after}-*.json` (5 cars × 11 scenes × 2,
  the after-set self-described with `gravityScale: 2.0387`).
- The full reasoning trail: `docs/audit/vehicle-physics-081.md` (addendum, rounds 1–3) and
  `docs/plans/081-vehicle-physics/08-sa-gravity.md` (the experiment's design, ledger and rejection).

## What was tried, what was measured, what the field said

The derivation itself was verified against gta-reversed source and is NOT in question: SA's grip is a
per-wheel Δv budget closing to **45 × TM m/s² at nominal load** (≈3 g absolute, 2.25 × TM in units of SA's
own 20 m/s² gravity), its spring law rests a car at `1 − 1/(4 × forceLevel)` of the span, and its world runs
at 2 g (`0.008` gu/frame²). Every configuration below implemented that arithmetic correctly, and the
captures confirmed the physics delivered what the math promised. All four were driven by the user the same
day:

| # | Configuration | Measured | Field verdict |
| - | ------------- | -------- | ------------- |
| 1 | baseline: `μ = TM`, 1 g (the pre-audit state + stance fix) | lateral ~0.5 g; u-turn plows (turismo turned 15.7°); 0-100 in 6.3 s (grip-strangled) | **liked** — but "hard to turn in at speed" |
| 2 | `μ = 4.59 × TM`, 1 g (SA's absolute budget) | grip-to-weight 2× SA's own ratio | "weightless, uncontrollable, fast" |
| 3 | `μ = 2.25 × TM`, 1 g (SA's dimensionless budget) | weight-feel restored; radii ~2× SA's | better — but turn-in at speed unchanged |
| 4 | **2 g experiment**: SA gravity on the chassis + SA absolute springs + `μ = 2.25 × TM` | stance exact to the newton; baseline's flips gone (infernus slalom 179°→5.4°); turismo u-turn 15.7°→**273°**; admiral sustains **1.89 g** at 137 km/h; 0-100 in 1.23 s (the authored numbers at work) | **"much worse — no feel, turning problem NOT gone, instant launches, flying, no weight"** |

Also measured on the way and worth keeping: the 1.15 sag-per-rate bridge reads ~1.38 at rate ≈60 (it was
fitted at 12–25 — closer to the analytic 1.43 at high rates); kerbs at 2 g speeds flip cars (infernus
kerb-strike 4.5° → 179° roll — the raycast kerb blindness, 06 §2, amplified); and time-based scenes measure
different SPEEDS across physics states (6 s of WOT = 96 km/h in config 1, 219 km/h in config 4), which
confounds every cross-config scene comparison.

## Why it died — the two findings that are the actual product

1. **The persistent complaint is a SHAPE, not a scale.** "Evasion at 100–130 km/h is nearly impossible"
   survived a 7× grip range, a 2× gravity change and a spring-law change — while config 4 measurably
   delivered 1.89 g of sustained lateral. Lateral capability `μ · g` is speed-independent; the radius a
   swerve demands grows with v². Any honest tyre therefore reads strong at 30 km/h and weak at 130 — and
   scaling it up until 130 feels strong makes 30 feel weightless (config 2, config 4). No constant can fix
   a shape.
2. **This project's accepted feel is not SA-faithful physics.** Config 1 — the least faithful of the four —
   is the one the field likes. The original's own numbers (3 g tyres, 2 g gravity, 1.6 g_SA launches) were
   field-rejected within minutes of arriving whole. Fidelity to the reversed source remains the right method
   for STRUCTURE (the stance law fixed the turismo on the first try, and the 081 chain's translations all
   survive); it is the wrong source of TARGET NUMBERS for feel. Feel targets come from field verdicts.

## Revisit conditions

- **The shape lever is untried**: speed-dependent grip (downforce-form, `min(1 + (v/V_D)², CAP)` as a
  VIRTUAL load factor in the grip cap only — rest weight, launches, springs untouched). It is the inverse of
  the complaint's shape and composes with the liked baseline. This is the staged next step, not a dead end.
- The 2g world itself could return **if the project's feel target ever becomes "authentic SA"** (a mod
  profile, a purist mode): the branch holds a complete, working, measured implementation — stance exact,
  flips reduced, authored numbers live. It failed THIS user's taste, not correctness.
- The kerb-flip amplification and the damage-threshold recalibration recorded in the 08 ledger only matter
  if 2 g returns; the kerb probe (06 §2) matters regardless and is unchanged in the queue.
