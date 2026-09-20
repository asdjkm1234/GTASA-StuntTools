# 03 — Standing on one carries you

Part of [101 — Escalators in OpenSA](readme.md). Depends on [02](02-moving-steps.md). Lands in
`packages/engine` (physics side).

## Context

The half that makes an escalator an escalator rather than a decoration. Our player is a physics-driven
character; the steps are kinematic. Whether the engine can already carry a body on a moving surface is one of
[00](00-recover-sa-behaviour.md)'s questions, and the answer decides whether this step is small (a velocity
the controller already supports) or a new capability (moving-platform support, which an escalator is merely
the first user of).

## Decisions

1. **Recover SA's carry rule before writing one.** Added velocity, parented transform and surface friction
   look identical when it works and diverge the moment the player jumps, gets shot, or steps half-on. The
   original's answer is the specification.
2. **The capture volume comes from the path, not from a hand-placed box.** Everything about the escalator is
   derivable from `position/bottom/top/end` plus the model's own geometry — a rule that names a model or a
   coordinate breaks the moment a mod replaces it.
3. **Jumping off must work at every point of the ride**, including mid-incline. Whatever the carry mechanism
   is, it releases cleanly — a player glued to the steps is a worse bug than an escalator that does nothing.
4. **Peds are out of scope** until the player works; the same mechanism should extend to them, and that is
   the test of whether the mechanism is right, not a task here.

## Tasks

- [ ] Implement the recovered carry rule.
- [ ] Field checks: ride up, ride down (the opposed pair), step on mid-way, jump off mid-incline, stand still
      at the top landing and be released rather than pushed into the geometry.
- [ ] A regression the physics suite can hold: a body placed on the path moves with the declared direction and
      stops at the landing.

## Verification

- The player rides both directions on all four models, and can leave at any point.
- No jitter at the transition between landing and incline — the seam where a hand-rolled implementation
  usually shows.

## Measurements / notes

_(record after implementation)_
