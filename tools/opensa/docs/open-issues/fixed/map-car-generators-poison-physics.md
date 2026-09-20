# Map car generators poison the physics world (Rapier `unreachable`, then "recursive use")

**Status: FIXED 2026-08-03 — root cause found and closed by a unit test, exactly as this doc's own "where to
pick it up" section asked for; FIELD-CONFIRMED the same day.** One line in
`PhysicsWorld.createDynamicVehicle`; the field bisection below turned out to have been chasing the symptom's
*frequency*, not its cause.

## The root cause, in one sentence

**A Rapier rigid body is born MASSLESS** — the descriptor's mass properties (and its colliders' own
contributions) are folded in only at the next `world.step` — and our step updates the raycast vehicle
controllers **before** stepping the world, so every car spawned *between* two steps had its first suspension
solved against a body of mass 0 and zero inertia, and came back all-NaN.

Measured on raw Rapier 0.19.3, before the fix:

| When the car is read                             | `mass()` | `principalInertia()` |
| ------------------------------------------------ | -------- | -------------------- |
| at birth (descriptor says 1500 / 2000,2000,3000)  | **0.0**  | **0, 0, 0**          |
| after one `world.step`                            | 1500.0   | 2000, 2000, 3000     |

Rapier documents this itself on `setAdditionalMassProperties`: *"That total mass-properties … will be updated
at the next physics step, or can be updated manually with `recomputeMassPropertiesFromColliders`."*

## The fix

```ts
this.addVehicleHull(body, shape, halfExtents);
body.recomputeMassPropertiesFromColliders(); // ← a car is born massless without this
const controller = this.world.createVehicleController(body);
```

`packages/game/src/physics/physics-world.ts`. Rapier's own documented remedy, applied at the last moment
before the car joins the step list.

## Why the field saw it as "the generators"

The trigger is **any car created between two steps**, which is every streamed car in a moving world — so both
populations were affected. What the generators changed was the *rate*: 962 placements streaming in and out
against 212 means far more spawns per minute, so the first poisoned car arrives sooner and the session dies
faster. `?cargen=0` "being clean" was a longer fuse, not a different fuse.

**This is the lesson worth keeping:** the bisection was sound and its table below is honest, but a bisection
over POPULATIONS can only ever name a population. The question "volume or content?" that this doc asked next
had no true answer — it was neither.

## Reproduced in the suite

`packages/game/src/physics/physics-world.car-generator-churn.test.ts` — a view drives a corridor of streamed
collision cells while placements spawn and despawn by the game's own radii (collision 150 m, car unload
500 m), through the same calls the host makes. It reproduced the field's exact signature in **42 ms**, for
both a 960-placement and a 212-placement population.

`physics-world.test.ts` carries the invariant itself: a car created after a step is born with its authored
mass. With the fix reverted all three tests fail; with it the physics suite is 92/92.

The narrowing, once the harness existed (each step a run of seconds, not a 10-minute field round):

| Experiment                                             | Result    |
| ------------------------------------------------------ | --------- |
| 20 cars created at once, then 20 steps                 | clean     |
| 2 cars, step, 2 more, step                             | **NaN**   |
| the same on a single static BOX ground                 | clean     |
| the same on a TRIMESH ground (what a real cell is)     | **NaN**   |
| car with no wheels (no suspension raycast)             | clean     |
| varying mass, turn mass, hull shape, suspension values | no effect |
| raw Rapier, our exact setup, chassis collider mass 0   | **NaN**   |
| the same with a non-zero collider mass                 | clean     |
| the same with `recomputeMassPropertiesFromColliders()` | clean     |

The zero-mass chassis collider is deliberate and stays: the body carries `handling.cfg`'s authored mass
(081/02) and the collider is shape only. It is what makes the missing recompute *fatal* rather than merely
wrong — with no collider mass to fall back on, the body's total is genuinely 0 until the step.

## Symptom, in the order it reached the console

1. `[fixed-step] threw (physics phase: updateVehicle N/N REJECTED) — … dropped a dead vehicle …
   position.x=NaN … angvel.z=NaN` — one vehicle in the step list reads back entirely as NaN.
2. `[fixed-step] threw (physics phase: world.step) — RuntimeError: unreachable` — Rapier panics inside its
   own solver, in a recursive tree walk (`0x60c2c` repeated 1–4 times in the wasm stack).
3. `Uncaught Error: recursive use of an object detected which would lead to unsafe aliasing in rust`, at
   `PhysicsWorld.getLinvel` ← `drivenMotion` ← `loop`.

Only (3) was uncaught, so before the instrumentation it was the only one visible — and it names an innocent
reader. **The mechanism linking them:** a Rust panic aborts the wasm frame without unwinding, so
wasm-bindgen's borrow guard on the rigid-body set is never released. From that moment every call into the
body set throws "recursive use", whoever makes it. The visible error is therefore always the wrong place to
look — one of the reasons this took a whole session.

## The field bisection (kept — it is what aimed the harness)

Teleport to `pirate` (Las Venturas), spawn any car, drive/turn for a while. Model-independent.
`docs/development/query-parameters.md` gained two knobs for it, which are HALVES of one experiment:

| Run                  | Cars present            | Result            |
| -------------------- | ----------------------- | ----------------- |
| default              | ~212 parked + ~962 gen. | crashes           |
| `?parked=0`          | ~962 generators         | **still crashes** |
| `?parked=0&cargen=0` | none                    | clean             |
| `?cargen=0`          | ~212 parked             | **clean**         |

**Trap this bisection walked into:** `?parked=0` alone reads as "a world without parked cars" and is not. The
field run still found cars at the pirate ship and still crashed; the boot census (`[vehicles] parked
placements registered: 0 (DISABLED by ?parked=0)` next to `map car generators registered: 962`) is what caught
it. Both census lines must be read before a run counts.

## What was RULED OUT (each by a run, not by argument) — all still true

- **NaN produced by our own code.** Every write into a body (`holdBody`, `push`, `pushAt`, `seedReverse`,
  `setLinvel`, `spin`, and `setVehicleControls`' inputs) is guarded by `assertFinite`. None ever fired — and
  now we know why: the NaN was produced by Rapier, out of a body we had never written a bad number into.
- **Bad collision geometry.** `addTrimesh` rejects non-finite vertices and out-of-range indices before Rapier
  sees them (Rapier validates neither, and builds a tree that panics later). Never fired.
- **A car's chassis body removed out from under a live controller.** `removeBodies` refuses to delete a
  registered live chassis and reports it. Never fired.
- **Re-entrancy into Rapier from a JS filter predicate** (`sphereCast`'s `alsoExclude`). The first error is a
  pure-wasm stack with no JS frame, so no callback is involved.
- **"The handle looks corrupt."** It does not. Rapier hands out handles as an opaque bit pattern (index
  packed with a generation, reinterpreted as a double), so a non-integer handle is NORMAL. The unit suite
  proved it (`5e-324` = bit pattern 1). An earlier version of the diagnostic read this as corruption and sent
  three rounds of investigation the wrong way. **Measured again while closing this:** handles are NOT
  recycled — remove a body, create another, and the new one carries a different bit pattern, so a stale
  handle does not resolve to a fresh body.

## Fixed on the way (real defects, unrelated to the root cause — all kept)

- **`removeVehicle` was not idempotent** — a second call skipped the array splice but still called
  `removeVehicleController`, freeing an already-freed wasm object. A double free does not throw; it corrupts
  Rapier's bookkeeping silently. Now guarded by the liveness map, and it reports a repeat.
- **A spawn that threw past `createDynamicVehicle` abandoned its chassis body and raycast controller** in the
  world with no reference left to either (`engine-vehicles.ts`). The catch now unwinds in `despawn`'s order.
- **The fixed step swallowed every throw** into `debugError` (HUD only, first one only). It now
  `console.error`s once per DISTINCT message — without this, the second and real error stayed invisible for a
  whole round.

## Instrumentation that stays

- `PhysicsWorld.stepPhase()` — which phase the step is in (`beforeVehicles` / `updateVehicle i/n` /
  `world.step` / `drainContactForceEvents`). A bare wasm `unreachable` leaves no other attribution.
- The dead-vehicle drop: an all-NaN chassis is removed from the step list and reported, so physics keeps
  advancing instead of throwing on the same corpse every frame forever.

## Related

- [`vehicle-enter-null-body.md`](../not-reproduced/vehicle-enter-null-body.md) — also a streaming/physics race around a
  freshly-spawned car. Worth re-testing against this fix before investigating it further.
- The rule this produced: [`restrictions/architecture.md`](../../restrictions/architecture.md) — a fresh
  Rapier body has no mass until the world steps. The measurement lives in
  [`edge-cases/physics-runtime.md`](../../edge-cases/physics-runtime.md).
