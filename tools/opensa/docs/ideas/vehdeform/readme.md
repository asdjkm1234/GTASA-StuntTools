# VehDeform: dynamic impact deformation for vehicles

Bring GTA4-style continuous body deformation to OpenSA vehicles: dents proportional to impact force and
direction, accumulating over a damage session, coexisting with SA's classic ok/dam part swaps (which stay
for detachables — bumpers, doors, hood flight).

References (user-supplied): zzpuma VehDeform 1.0 (SA ASI, dynamic deformation from impact strength —
proof it reads right in SA's art style) and <https://github.com/Kiminaze/VehicleDeformation> (FiveM:
impact point + radius + falloff vertex displacement, per-vehicle deformation state). Both implement the
same core: **move vertices near the impact point along the impact direction with distance falloff,
clamped by a per-region stiffness**.

## Feasibility for us: HIGH — and easier than for the modders

The reference projects fight closed engines to reach vertex data. On the 074 engine WE own it:

- vehicles are dynamic entities with their OWN vertex buffers (plan 08) — per-instance deformed copies are
  a design choice, not a hack;
- physics owns real impact data (Rapier contact events: point, normal, impulse) — no guessing from
  velocity deltas;
- the deformation kernel is small: for verts within radius R of the impact point,
  `offset += impactDir × strength × (1 − d/R)² × stiffness(region)`, with a per-vertex accumulated-offset
  cap (metal doesn't crumple forever) and normal re-bend (cheap: rotate normals toward the dent).

Two implementation shapes, decided by a spike:

- **CPU kernel** (v1 default): deform a CPU copy on impact events (rare!), re-upload the vehicle's vertex
  buffer region — impacts are sparse, upload is a few hundred KB worst case; zero per-frame cost.
- **GPU compute kernel** (if CPU upload ever shows in traces): impact list in a small buffer, one compute
  dispatch bends the vertex buffer in place.

## Boundaries and interplay

- ok/dam part swaps REMAIN the mechanism for detach/shatter (doors, bumpers, glass) — deformation applies
  to the attached body panels; a heavily-dented panel can still swap to `dam` and detach.
- Collision shape does NOT deform in v1 (visual-only, like both references) — record as a known limit;
  optional v2: coarse convex refit for extreme deformation.
- Persistence: deformation state = per-vehicle offset buffer; survives streaming in/out (owned by the
  vehicle entity, ~8 KB per damaged vehicle), cleared on repair.
- Caps for gameplay sanity: never deform wheels/glass-clear zones/driver capsule region (mask baked from
  the dummy tree at vehicle-asset build time).

## Tasks

- [ ] Spike: one car, hardcoded impact → CPU kernel → buffer re-upload; verify the LOOK matches the
      references (falloff exponent + radius tuning table).
- [ ] Rapier contact → impact events (point/normal/impulse aggregation per collision burst, thresholds).
- [ ] Region stiffness/exclusion mask from the dummy tree (per-vehicle, baked offline in the asset build).
- [ ] Accumulation caps + normal re-bend + repair reset.
- [ ] Persistence across streaming; memory ledger (target ≤ 8 KB per damaged vehicle).
- [ ] Interplay pass with ok/dam swaps (dent → detach thresholds).
- [ ] (v2, measured) GPU compute path; (v2) coarse collision refit.
