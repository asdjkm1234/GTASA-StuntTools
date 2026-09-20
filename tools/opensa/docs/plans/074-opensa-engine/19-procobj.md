# 19 — Procedural clutter (procobj) — B7·d

**Status: SHIPPED + FIELD-CONFIRMED (2026-07-15), CLOSED.** Decision (user pick): **host-generated + instanced**
(Option B) — the adapter's ONE memoized scatter drives both the engine's instanced render AND the colliders, so
they can never diverge (the field lesson). Built across four layers, `tsc` + eslint clean. No reconvert (clutter
is host-generated from the game FS, not baked in the pak).

**Field fix (2026-07-15) — the clutter had never actually rendered under the local loader.** The browser VFS
selection (`asset-local-loader/build-vfs.ts`) only ingests IPL-**placed** models plus peds/vehicles. Procobj
species are scattered from `procobj.dat` and never IPL-placed, so their DFF+TXD were dropped → `getClump` returned
`EMPTY_CLUMP` → `buildVehicleModel` produced 0 geometry → nothing drawn (and `getBreakable` failed too, breaking
plan 20). Fix: `procObjModelRefs` adds every `procobj.dat` model (+ IDE TXD) to the VFS, like peds/vehicles;
covered by a `build-vfs` test. NOT applicable to `sa-procobj-placement` (a Node CLI that reads full `gta3.img`
directly and iterates `procobj.dat` itself). After the fix: clutter renders, density sane, body count bounded.

## What shipped

- **Engine** — a new `clutter` WGSL module + pipeline (opaque + A2C cutout), per-instance world matrix from a
  storage buffer (`instance_index`), world-material lighting (vertex-colour prelit + sun/moon + 068 fog).
  `Engine.createClutterModel` / `setCellClutter(key)` / `removeCellClutter(key)`; drawn in the opaque phase.
  Geometry is the shared vehicle-model layout (texture array + `slots.x` layer — `meta` is a WGSL reserved
  word), so `buildVehicleModel` builds a clutter model with zero new extractor.
- **Adapter** (`GtaSaWorldAdapter`) — `cellClutter(cx, cy)`: renderer-agnostic instances (modelName/txdName +
  GTA matrices), cut by the SAME per-category density × `procObjLimit` cap as the colliders; the scatter is now
  MEMOIZED per cell so render + collision share one scatter (`invalidateColliderCache` clears it too).
- **Host** — `engine-clutter.ts` (model cache via `buildVehicleModel`, cutout = texture-has-alpha, GTA→engine
  matrix per instance) + a clutter-streaming loop in `engine-canvas-host` (same view/cells as collision, ≤2 new
  cells/frame). Colliders RE-ENABLED: `clutterColliders: true`, `procObjLimit: 150`.
- **Strict `procobj.dat` (user directive):** the scatter reads ONLY procobj.dat rules — surfaces/types absent
  from it produce no clutter (some clutter is already baked statically into the map; do not double it). This is
  `scatterProcObjects`'s existing behaviour, preserved.

## Field verification owed

- Countryside: grass + rocks render, sit ON the ground (the GTA→engine axis change is the risk), density looks
  vanilla, and the HUD's `bodies` count stays in the hundreds. Rocks/cacti collide (they have COL); grass is
  walk-through (no COL), like vanilla.
- v1 limits: no per-cell frustum cull (bounded by the collision draw distance); one sway speed; no wind on
  clutter yet.

<details><summary>Original field story + spec (2026-07-14)</summary>

A prod-parity gap found in the field on 2026-07-14: the three path scatters and
renders SA's procedural clutter (grass, bushes, rocks, cacti); the own engine draws **none of it**. The
countryside reads as bald.

## The field story that surfaced it (read this before touching clutter)

The engine host stood in the countryside at **12 fps, standing still, on an empty screen** — 1 cell loaded,
8 draw calls, GPU 2 ms. The CPU breakdown said everything:

```
frame 250 · gpu 2.5 · fixed 800 (5 steps: controller 1.4 + physics 798) · anim 0.00 · bodies 9803 colliders 12673
```

- **9 803 static bodies** in Rapier → **~17 ms per step**, and the fixed-step loop then ran its 5 catch-up
  steps, so one slow frame guaranteed the next (a textbook spiral: the recovery was slow and never reached
  120 again).
- They were the procedural clutter's colliders. **The engine host passed NONE of prod's clutter knobs**
  (`procObjLimit: 150`, the per-category density lottery), so the adapter defaulted to _unlimited_ and
  collided every blade of grass — while rendering none of it. We were paying 17 ms a step for **invisible
  walls**.
- Fix shipped: `clutterColliders: false` on the engine host (the adapter's own rule is "no invisible
  obstacles" — a renderer that does not draw clutter must not collide it). 120 fps, 73 bodies.

Two lessons worth keeping:

1. **A catch-up spiral hides its own cause.** The stall looked like it belonged to the animated objects — they
   were simply the thing on screen. `anim` measured **0.00 ms** the whole time. Per-block timers ended a
   three-round guessing game in one reload; they now live in `engine-canvas-host.tsx` behind a slow-frame
   threshold (quiet on a healthy frame) and should stay.
2. **Physics bodies are the expensive part of clutter, not triangles.** Vanilla pools `CProcObjectMan` at
   ~300 for exactly this reason.

## What prod does (the spec to mirror)

- `packages/renderware/src/map/procobj-scatter.ts` + `build-procobj.ts` — the scatter and the **lottery**.
- `apps/web/src/ui/canvas-host.tsx`: `procObjLimit: 150` per cell, `procObjDensityOf` per category from the
  graphics config. **One budget drives render AND collision**: over the cap, the highest-lottery placements
  are not drawn and therefore not collided. Models that ship a COL collide (rocks/cacti); grass has none and
  stays walk-through, like vanilla.

## What the engine needs

1. **Converter or host?** The clutter is _scattered_, not placed — it is generated from `procobj.dat` against
   surface polygons. Baking it into `.oscell` would freeze the density knobs into the pak; generating it in
   the host keeps the lottery live (prod's model) at the cost of per-cell CPU. Decide this first.
2. **Rendering:** it is thousands of tiny instances of a handful of models — the rigid-entity path is the
   wrong shape (one draw per instance). This wants an instanced pass, or the same welded-into-the-cell
   treatment the static world gets, keyed by the density knobs at CONVERT time.
3. **Collision:** re-enable `clutterColliders` on the engine host **together with the rendering**, and take
   prod's cap with it. Never let the two diverge again — that divergence is what cost 17 ms a step.

## Done means

The countryside has grass and rocks in `?engine=opensa`, the density knobs work, and the physics body count
stays in the hundreds, not the thousands.

</details>
