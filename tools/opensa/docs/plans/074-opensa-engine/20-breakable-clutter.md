# 20 — Breakable procobj clutter (B7·d follow-on)

[← chain](readme.md) · builds on: [19 procobj](19-procobj.md) · pattern: B7·a smashable props ([08](08-dynamics.md))

**Status: SHIPPED + FIELD-CONFIRMED (2026-07-15), CLOSED.** Built per the design below across the three layers
(engine `breakClutterInstance` + degenerate-matrix, adapter tags clutter colliders breakable + emits per-instance
key hashes, host `smash` tries clutter after welded). tsc + eslint clean. No reconvert (clutter is
host-generated). Field-confirmed by driving into the Bone County cactus field (see "Field verification" below —
the real blocker was a missing-DFF VFS bug, now fixed).

Of the 56 procobj models, **6 are breakable in vanilla** (they carry a DFF Breakable shatter
mesh; one also has an object.dat smash effect): `sjmcacti2` (a cactus), `p_rubble04/04b/05/0bcol` (desert
rubble), `rockbrkq` (a breakable rock). Driving into one should shatter it. Neither the own engine NOR the
three path does this today — the clutter colliders are added UNTAGGED (`gta-sa-world.adapter` line ~506:
`toModelColliders` without `tagBreakable`), and the instanced render cannot remove a single instance. This is a
shared parity gap, not an engine regression; this plan closes it on the own-engine path.

## The shape (mirror B7·a, differ only where instancing forces it)

B7·a smashes a WELDED prop by degenerating its triangle RANGE in the cell index buffer. Clutter is INSTANCED —
one matrix per instance in a per-(cell, model) storage buffer — so the analogue is to **degenerate the instance
MATRIX** (collapse it to a zero-area point), leaving the draw's instance count untouched. Everything else reuses
the existing B7·a machinery.

- **Identity is already shared.** `breakableInstanceKey(model, gtaPosition)` + `breakableKeyHash` pair the
  physics collider, the render instance and (here) the engine. `procObjColliders` iterates the SAME memoized
  batches with the SAME `min(density, cap)` cutoff as the render (074/19), in lottery order — so collider `i`
  and render instance `i` of a model are the same placement, and the position-based key matches on both sides.

## Work

1. **Adapter** (`GtaSaWorldAdapter`):
   - Tag breakable clutter colliders: at the clutter-collider push, wrap with `tagBreakable(…, isBreakable)`
     where `isBreakable = getBreakable(fs, model) !== undefined || breakableModels.has(model)` — the SAME gate
     the static props use. This gives the colliders `instanceKeys` + recorded transforms, so the existing
     collision-streaming bookkeeping (`breakableKeyOf`, `breakableTransform`, `removeBreakable`) works for
     clutter unchanged.
   - `cellClutter(cx, cy)`: for breakable models, attach a per-instance `keyHashes: Uint32Array`
     (`breakableKeyHash(breakableInstanceKey(model, gtaPos))`, gtaPos = the matrix's translation), so the engine
     can map a hit to the instance to degenerate. Non-breakable models carry none.
2. **Engine**:
   - `CellClutter` gains optional `keyHashes`; `setCellClutter` registers `keyHash → { matrixBuffer, byteOffset }`
     for each breakable instance; `removeCellClutter` purges that cell's keys.
   - `breakClutterInstance(keyHash): boolean` — writes a DEGENERATE matrix (collapse to a zero-area point) at the
     instance's offset, drops the key, returns false if unknown (streamed out / already broken).
3. **Host** (`engine-breakables`): in `smash`, after the toughness gate, break via
   `engine.cells.breakPlacement(hash) || engine.breakClutterInstance(hash)` (welded OR clutter). The rest —
   `collision.removeBreakable`, `collision.breakableTransform`, `spawnEngineDebris` from the shatter mesh — is
   already generic. Clutter's `uprootLimit` is 0, so it shatters into debris (never topples).

## Done means

- Driving a car into a desert cactus / rubble / breakable rock shatters it (debris from its shatter mesh), the
  instance disappears, and its collider goes with it. Grass and the other 50 non-breakable models are
  unaffected. Body count stays bounded (074/19). No reconvert (clutter is host-generated).

## Notes

- v1 keeps the toughness/force gate from B7·a (contact force on the chassis — you cannot smash clutter on foot,
  like vanilla).
- The render/collision instance-order equivalence is load-bearing; it holds because both consume the adapter's
  ONE memoized scatter with the same cutoff (074/19). If that ever drifts, the position-based key still resolves
  correctly (it is not index-based).

## Field verification (2026-07-15) — SHIPPED + confirmed

Cacti/rocks smash on a car hit; welded props unaffected; body count bounded. The bring-up chase found ONE real
blocker, worth recording:

- **Root cause — procobj DFFs were missing from the browser VFS.** In `?engine=opensa` (local loader), the
  clutter simply did not render and nothing registered as breakable (`registered=0`). The clutter geometry is
  built LIVE from each model's DFF (`getClump` → `buildVehicleModel`), but the local loader's VFS selection
  (`asset-local-loader/build-vfs.ts`) only ingests **IPL-placed** models plus peds/vehicles — and procobj
  species are **scattered from `procobj.dat`, never IPL-placed**, so their DFF+TXD were dropped. `getClump`
  returned `EMPTY_CLUMP` → 0 geometry → nothing drawn; and `getBreakable` (which parses the same clump) returned
  undefined → `isClutterBreakable` false → colliders never tagged → `registered=0`. This means procobj clutter
  (074/19) had **never actually rendered** under the local loader either — it was silently empty.
  **Fix:** `procObjModelRefs` in `build-vfs.ts` — add every `procobj.dat` model (+ its IDE TXD) to the VFS
  selection, exactly like peds/vehicles. Covered by a `build-vfs` test.
- **Not a bug, but the reason it looked broken while testing:** the per-cell lottery cap (`procObjLimit=150`,
  shared across ALL clutter categories) culls sparse breakable species hard, and `rockbrkq` is only ~1 m — a car
  drives over it. The reliable field-test spot is the dense **cactus** field (`sjmcacti2`, ~5.3 m tall, box COL)
  in Bone County cell 0,9 (~150 of them at z 15.3) — teleport "Desert - Breakable cacti".
- **NOT applicable to `sa-procobj-placement`:** that tool is a Node build-time CLI that reads the full
  `gta3.img` directly and iterates `procobj.dat` species itself, so every procobj DFF is inherently available.
  The missing-DFF bug is specific to the browser VFS subset selection.
