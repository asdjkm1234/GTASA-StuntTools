# Collision + physics

`packages/renderware/src/parsers/binary/col.ts`, `packages/renderware/src/collision/`,
`packages/game/src/physics/`, `packages/game/src/streaming/collision-streaming.system.ts`.

## Implemented

- COL library parsing (versions 2/3; v1 skipped): bounds, spheres, boxes, faces with **surface
  material ids** (= surfinfo row index) + light byte, compressed vertices.
- DFF-embedded collision (`parseDffCollision`) for vehicles.
- `CollisionIndex`: every `.col` library in the archive flattened to name → model
  (WeakMap-cached per archive; parse failures skip the library).
- `bindColliders`/`buildCellColliders`: per-cell collider sets with world transforms (same IPL
  conjugate-quaternion convention as rendering); exterior + non-LOD only.
- Physics (Rapier): static trimesh/box/sphere creation per cell via
  `CollisionStreamingSystem` (radius `collisionDrawDistance`, diff-based load/unload, `reload()`
  for live invalidation); character capsule/box controller; vehicle chassis convex hull +
  raycast wheels; vehicle damage system.
- **Budgeted collider builds** (plan 200/3-02): a cell's bodies are created a slice at a time under a
  per-frame allowance (`beginStaticColliders` + `COLLIDER_BUDGET_MS`) instead of all at once, which measured
  5.6–28.1 ms per cell. A cell counts as loaded only when its build is whole — a half-built cell would let a
  car spawn where only half the ground exists — and an abandoned build removes exactly the bodies it made.
  The cost is streaming MARGIN rather than throughput; unmeasured so far
  ([the lever](../performance/applied/collider-build-budget.md)).
- **Clutter collision** (procobj): models that ship a COL collide; the collidable subset always
  equals the rendered subset (density knobs + `procObjLimit` lottery cap), live re-stream on
  knob changes (debounced cache invalidation).
- **Baked cell collision** (plan 200/3-01): a pak built with `opensa-pack --bake-collision` carries one
  `.oscol` per GAME-grid (256) cell, and the runtime reads it instead of binding COL —
  `PakCollisionSource` (engine, shares the pak worker) → `readBakedCell` (game) → the same `ModelColliders`
  the COL path produces, **breakable instance keys included**: `.oscol` v2 resolves the shatter gate at build
  time, so a baked cell opens no DFF and no COL. A cell the bake does not cover, a pak without the bake, a
  failed read and a container this reader cannot read all fall back to the COL path; the adapter refuses a
  bake keyed on a grid other than the one collision streams on.
- Collision debug wireframe overlay (map-viewer).

## Known gaps / candidates

- COL v1 unsupported (none shipped in our data).
- Face surface materials are used by procobj only — no per-surface friction/sounds yet
  (`surface.dat` adhesion + `surfaud.dat` audio are future phases).
- No moving/animated colliders (the IFP-animated map objects don't collide with their moving
  parts).
- The bake covers map collision only: the **procobj scatter still binds COL regions** per cell (it is
  seeded from the cell's own collision surfaces and its density is a live knob), which keeps the COL index
  alive on a baked run whenever clutter colliders are on
  ([the lever](../performance/deferred-optimizations/procobj-scatter-bake.md)).
- The baked breakable gate is resolved against the `object.dat` and DFFs **the pak was built from**. That is
  the same tree a field run reads, so it matches — but a mod installed after the pak was built would need a
  re-pack to change what smashes.

## Test coverage anchors

`col` parser tests, `collision-index/build-colliders/build-cell-colliders` tests,
`collision-streaming.system.test.ts` (incl. reload), `procobj-colliders.test.ts`, adapter
collider cache tests, `collision-source.test.ts` + `baked-collision.test.ts`, and the bake↔runtime
oracle in `tools/opensa-pack/src/pack-collision.test.ts` (regions → bake → container → runtime read
must equal what the COL parse would have built).
