# Physics runtime (Rapier vehicle controller) — edge cases

What Rapier's `DynamicRayCastVehicleController` does NOT model, discovered the hard way, plus where a vehicle
body may exist at all. The engine's vehicle feel is built on top of these boundaries (plan 081's clamps, plan
089's signals); anyone reading a wheel channel should check this list before trusting it.

## No parked car exists between 150 m and 250 m

A dynamic body needs static collision under it, and collision streams to a **shorter** radius than the vehicle
LOD ring: `streaming.collisionDrawDistance` is **150**, `vehicle.lodDistance` is **250**. So the LOD system
creates a car only within `min(150, 250)`, and the 100 m band between the two radii is empty of cars by
construction. Approaching a lot, its cars appear at 150 m rather than at the LOD distance.

This is the price of the alternative, which was measured in the field on 2026-08-02: cars spawned in that band
free-fell through the world, and because the unload distance was measured from the fallen body's own position,
the spot never repopulated — one lot in LS emptied for the rest of the session, silently
([the fix](../open-issues/fixed/parked-cars-do-not-respawn.md), and the rule in
[`restrictions/architecture.md`](../restrictions/architecture.md)).

**If the pop-in ever reads badly, the lever is the collision radius, not the spawn radius.** Raising
`lodDistance` alone puts the cars back over the hole.

## A rigid body is born MASSLESS — its mass properties arrive at the next `world.step`

Rapier folds a descriptor's mass properties, and its colliders' own contributions, into the body only when the
world steps. Read a fresh body before that and it answers `mass() = 0`, `principalInertia() = 0,0,0`,
whatever the descriptor said. Measured on 0.19.3, with a descriptor of 1500 kg / 2000,2000,3000:

| When the body is read | `mass()` | `principalInertia()` |
| --------------------- | -------- | -------------------- |
| at birth              | **0.0**  | **0, 0, 0**          |
| after one `world.step`| 1500.0   | 2000, 2000, 3000     |

Rapier says so itself on `setAdditionalMassProperties` — *"will be updated at the next physics step, or can be
updated manually with `recomputeMassPropertiesFromColliders`"* — and `createDynamicVehicle` now does exactly
that, because our step updates the raycast controllers BEFORE stepping the world. Solving a suspension against
a massless body returns NaN, and a NaN reaching Rapier's tree walk panics wasm and poisons the world for the
rest of the session ([the fix](../open-issues/fixed/map-car-generators-poison-physics.md)).

**A chassis collider deliberately carries mass 0** (the body holds `handling.cfg`'s authored mass, 081/02), so
there is nothing to fall back on: for a car the zero is total, not partial.

## Wheel rotation is COSMETIC — it follows the ground exactly

`controller.wheelRotation(i)` integrates the CONTACT velocity, not a simulated wheel: under a sustained
−1.1 g full-brake stop the rotation-derived "slide" measured **0.05 m/s** (2026-07-28, brake-strip lap,
per-step log). There is no lockup and no wheelspin in that channel, ever — a slip ratio derived from it
(`WheelFrame.slipRatio`) reads ~0 through the hardest stop the car can produce.

**The honest longitudinal signal is demand-over-cap**, recorded where `setVehicleControls` clamps the
demands: `PhysicsWorld.readVehicleWheelSlip` → per-wheel `brakeExcess` (handbrake = exactly 1) and
`spinExcess`. The tyre smoke, skid marks and surface effects (089) all read it; the telemetry's
rotation-derived ratio stays for what it can see (a rolling wheel's speed match).

## The friction-circle `sliding` flag misses under straight-line braking at speed

`setVehicleControls` judges "sliding" against the 081/09 speed-BOOSTED lateral circle (the one Rapier
actually enforces), while the brake impulse caps on the UNBOOSTED grip — so a full-brake wheel at speed
sits at ~a third of the judged circle and never flags. Detecting a braking skid via that flag silently
fails above ~4 m/s; use `brakeExcess` instead.

## Rapier applies its longitudinal grip limit only when a side impulse exists

Its friction-circle scaling runs `if wheel.side_impulse != 0.0` — a car accelerating or braking DEAD
AHEAD has no longitudinal grip limit at all inside Rapier. The engine clamps engine force and brake
impulse to `μ × load` itself (`setVehicleControls`, the 081/04 five-g-launch fix); any new force channel
must apply the same clamp or it will push arbitrary force into the road.

## `groundBelow` answers with the CASTER's own body unless it is excluded

`PhysicsWorld.groundBelow(at, maxDrop)` casts a downward ray from `at` with `solid: true`, so a point INSIDE
a body hits that body's own surface: probing "is there ground under the anchor?" while the player stands on
that anchor returns his capsule, at ~0.9 m below the probe point. The answer looks exactly like real ground —
a number, in range, every time. It cost the plan-102 settle gate a full cycle: the gate opened instantly on a
world with no collision at all, and only the leg-start probe (a player 11 m under his anchor) said otherwise.

Pass the body to skip: `groundBelow(at, maxDrop, RigidBody.handle[playerEid])`. The same applies to
`groundNormalBelow`. Nothing catches a missing exclusion — the reading is plausible, not absent.

## Clutter you can SEE has no collision until 150 m

Since 2026-08-10 the procedural clutter renders per category out to its own range — cacti and trees to **300**
— while its colliders still stream on `streaming.collisionDrawDistance` (**150**), deliberately. So a rock or
a cactus visible at 250 m is scenery: it gains a Rapier static body only when the player closes to 150.

This is not an oversight to fix by raising the collider ring. Clutter colliders are the cost that once put
9 803 static bodies in Rapier (17 ms/step, 12 fps standing still, plan 074/19), and the radius is squared —
150 → 300 is 4× the area. Render and collision still share ONE scatter and one budget, so the two can never
disagree about WHICH objects exist; they disagree only about how far out the bodies are built.

**What this can look like in the field:** a car driven fast at a distant boulder reaches it at roughly the
moment its collider appears. If a report ever describes clutter "turning solid late", this is the mechanism —
check `procobj.drawDistance` for the category against `collisionDrawDistance` before looking anywhere else.
