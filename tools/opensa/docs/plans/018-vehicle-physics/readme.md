# 018 — Real vehicle physics (GTA-style dynamic car)

> **This plan is the FOUNDATION, not the current state of driving.** It put a dynamic chassis on Rapier's
> raycast controller and made the car collide as its own COL — everything below still holds. What a car FEELS
> like was rebuilt on top of it by
> [081 — vehicle driving physics](../081-vehicle-physics/readme.md): `handling.cfg` read as truth (COM,
> springs, gears, brakes, tyres), the SA standing pose, the steering limiter, surface grip, air control and
> visible suspension. Read 081 first for anything about behaviour; read this one for how the body, the
> collider and the controller came to be.

## Why

The arcade-kinematic drive (plan 017) is the wrong base: the user needs the car to be a **dynamic
physical body** whose collision **is the model's COL** (later used for damage — hit the hood → the hood
is damaged), with **real gravity**, suspension, and world collision through that COL. No box proxies, no
ground-raycast hacks. This matches GTA SA: a rigid-body chassis + the COL collision + wheels on
suspension rays + engine/brake/steer.

## Approach (Rapier `DynamicRayCastVehicleController`)

GTA SA's model maps directly onto Rapier's raycast vehicle:

- **Chassis** = a **dynamic rigid body** (mass from handling.cfg). Gravity is automatic → the car falls
  and rests on its wheels; no hover, no settle, no snag.
- **Chassis collider = the car's COL.** Dynamic bodies need a convex shape to collide with the static
  world trimesh (two trimeshes don't generate contacts in Rapier — a raw COL trimesh would fall through
  buildings). So the chassis collider is the **convex hull of the COL vertices** (+ the COL's box/sphere
  primitives if present) — the same model geometry, just convex. The **full COL is kept** for the later
  damage system (map contact points → panels). Nothing invented; it's the model's collision.
- **Wheels** = 4 raycast wheels (`addWheel`) at the `wheel_*_dummy` positions, radius from the wheel
  model, suspension rest length/stiffness/damping from handling.cfg. The rays do suspension + keep the car
  on the ground (no road-snag — wheels ray-test down, the chassis collider only hits walls).
- **Controls** = `setWheelEngineForce` (throttle, rear/4WD per handling drive type), brake, `setWheelSteering`
  (front), from handling.cfg + WSAD. `controller.updateVehicle(dt)` each fixed step (it writes the chassis
  velocity); the physics step integrates it (collision with the world via the chassis collider).
- **Render** = each frame copy the chassis body transform → the car object; wheel transforms from the
  controller → the wheel rig (spin + steer come for free).

## Replaces

The arcade drive in `EnterVehicleSystem` (the `drive`/`moveCar`/`stopping`/kinematic-box/settle/
`createKinematicVehicle`/`groundHeight` machinery) is removed. handling.cfg scaling is reinterpreted as
real physics params (engine force, brake torque, suspension, mass, steering lock). Get-in/out stays but
the seated player now rides a **dynamic** chassis (sync the player to a seat point on the chassis each
frame; keep the player collider disabled while seated).

## Iterations

1. **Dynamic chassis + wheels + gravity.** Build each car as a dynamic body (convex-hull COL collider,
   mass) + 4 raycast wheels; register a `VehiclePhysicsSystem` that calls `updateVehicle(dt)` (no input
   yet) + syncs the car object + wheels to the body/controller. Verify: cars fall and **rest on their
   wheels** on the ground (no hover/sink), collide with buildings, and a parked car is a solid obstacle.
2. **Engine/brake/steer from handling.cfg.** WSAD → engine force / brake / steering (front wheels, drive
   type from handling). Tune so the per-car feel returns (mass + power differences emerge naturally).
3. **Get-in/out on the dynamic car.** Re-wire the seated player to ride the dynamic chassis (seat point,
   camera, player collider disabled while seated; brake/handbrake to hold the car while entering).
4. **Polish + damage hooks.** Read chassis contacts (which COL panel was hit) for the later damage system;
   handbrake, audio, etc.

## Decisions / open questions

- **Convex hull vs COL primitives:** start with `ColliderDesc.convexHull(colVertices)`; if a car has clean
  COL boxes/spheres, a compound of those is closer to GTA — can switch per-need. The **trimesh COL stays
  available** (in the loaded data) for damage.
- **Player riding a dynamic car:** sync the player render/transform to a chassis-local seat each frame
  (the body moves under physics); disable the player capsule's collision while seated.
- **Tuning:** real forces need balancing (engine force, suspension stiffness, friction) — expect in-browser
  iteration, like the arcade values.

## Out of scope (later)

Damage model itself (panel deformation), traffic/AI, passengers, advanced tyre friction model, flips/roll
recovery.

---

**Since-fixed (2026-06-17): chassis fallback no longer crashes on a no-COL vehicle.** Found via a modded
`cheetah.dff` with no usable embedded collision. `createDynamicVehicle`/`addVehicleHull` built the chassis
hull with `ColliderDesc.convexHull(vertices) ?? boxHull(vertices)`, assuming `convexHull` returns `null`
on failure — but for empty/degenerate input it returns a **non-null but invalid** desc, so the `??` guard
never fired and `createCollider` threw _"expected instance of OA"_ (Rapier rejects the bad desc). Now
`addConvexChassis` only attempts the hull with ≥4 points, wraps it in try/catch, and box-falls-back to the
car's `halfExtents` (threaded through `createDynamicVehicle`; default `[1.2, 2.5, 0.7]`). General
robustness for any vehicle missing a COL. Tests in `physics-world.test.ts`. The locked DFFs that trigger
this (cheetah/yosemite) are otherwise shelved — see
[open-issues/locked-dff.md](../../open-issues/fixed/locked-dff.md).
