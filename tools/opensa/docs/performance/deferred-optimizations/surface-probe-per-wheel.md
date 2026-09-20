# The per-wheel surface probe (four rays a step) instead of surface-tagged colliders

**Status:** in reserve — costs nothing today because it runs on ONE car, and the alternative is a pipeline
change nobody needs yet.

**Impact: VERY LOW today, low if traffic ever needs a surface — measured on both sides.** The whole vehicle
slice is **~8 µs per car per fixed step** (0.605 ms at 80 live cars), and today the probe runs for the DRIVEN
car only: four rays inside a 0.07 ms slice for eight cars, i.e. free. The number that would change the rating
is running it on every live car — roughly **0.6 → 1.2 ms per step at 80 cars** — and that only happens if
traffic ever leaves tarmac. Against a ≤ 0.5 ms budget for eight cars, there is nothing here to reclaim now.

**Effort: high.** Splitting cell collision by adhesion group is a converter and streaming change, and it
creates a SECOND place where surface truth lives — today there is exactly one (the COL material byte, carried
verbatim), and that is the property worth more than the milliseconds. **The half-measures named at the end
(probe traffic every N steps, or only when a contact point moves) are very low effort** and buy the same
headroom whenever traffic ever needs a surface.

## What we do today

A wheel's grip comes from what it stands on (plan
[081/10](../../plans/081-vehicle-physics/10-surface-types.md)), and Rapier's raycast vehicle never reports
what its own suspension ray hit. So `PhysicsWorld.readVehicleWheelAdhesion` re-casts a short ray per wheel —
5 cm above the contact point the controller DOES report, 35 cm of reach — resolves the hit triangle's
material through a per-collider `Uint8Array`, and scales that wheel's `frictionSlip` (and the steering
limiter's adhesion) by the surface's own cell of `surface.dat`.

It runs for the **driven car only**, and only for wheels in contact: an airborne wheel costs nothing.

## The lever

Encode the answer in the collider instead of asking for it: the cell builder emits **one trimesh per
adhesion group**, so the ray's COLLIDER identifies the surface with no per-triangle lookup — or, further,
tag colliders so no ray is needed at all where the vehicle controller's own contact could be trusted.

## What it would win

Measured, from the vehicle-slice instrument ([081/07 §3](../../plans/081-vehicle-physics/07-presets-regression.md),
run `docs/benchmarks/opensa-engine/2026-07-27-headless-vehicle-step-cost.json`): the whole vehicle slice is
**~8 µs per car per fixed step**, 0.605 ms at 80 live cars. Four rays are the same ORDER as a controller
update, so:

- driven car only (today): **~free** — one car's four rays inside a 0.07 ms slice for eight cars;
- every live car (if traffic ever needed its surface): roughly **doubles** the slice, 0.6 → ~1.2 ms/step at
  80 cars. That is the number that would make this lever worth pulling.

## What it would cost

A converter/streaming change (splitting cell collision by adhesion group), more colliders per cell, and a
second place where surface truth lives — the material bytes would then exist both on the shape and in the
collider layout. The current design keeps ONE source: the COL material byte, carried verbatim.

## What would have to be true to pull it

Traffic cars need their own surface (they follow the road graph today and stay on tarmac), or the vehicle
slice becomes a real share of the fixed step. Neither is true now: the budget is ≤ 0.5 ms for eight cars and
the measured cost is 0.07 ms.

Cheaper half-measures first: probe the driven car every step and traffic every N steps, or only when a
wheel's contact point moves more than a metre.
