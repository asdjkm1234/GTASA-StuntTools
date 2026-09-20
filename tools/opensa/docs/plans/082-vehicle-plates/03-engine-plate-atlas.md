# 082/03 — Engine: plate atlas array + per-instance slot + WGSL override

The engine half: per-INSTANCE plates on models whose textures are shared per MODEL. One shared
atlas, one small per-instance index, one shader branch.

## Design

- **Plate atlas**: one engine-owned RGBA8 texture array holding only the generated TEXT rasters —
  slot size **64×16 = 4 096 B** (measured, plan 01; the guessed 128×64 is retired) × capacity N
  (first guess 256 slots ≈ 1 MB before mips — an order of magnitude cheaper than the original
  estimate; measure a full-map drive before settling). Created lazily on first plate upload; NOT
  part of any model's `textures`. Slot 0 = reserved "stock look" (see below).
- **The three city backgrounds are NOT in this atlas** and are not per-instance rasters at all:
  `carpback` wears one of three static textures picked by a city index, and phase 0 measured them
  at 512×256 in the built pak against 64×32 stock — so they live in their own small 3-layer array
  sized from the decoded rasters, never from a constant.
- **API**: `engine.uploadPlate(slot, rgba)` (queue.writeTexture into the slot + mip gen consistent
  with other runtime textures) and `VehicleInstance.setPlate(slot, backSlot)` — writes the
  per-instance row, the exact `setPaint`/`setLamps` mechanism (`engine.ts:306-309`, paint 64 B /
  lamp 16 B rows): a new 16-byte row (face slot, back slot, 2 spares) or the two spare components
  of the lamp row if review prefers zero new buffers (decide at implementation, record).
- **WGSL (vsRigid/fsRigid path)**: a submesh flagged `plate` (plan 02, reaching the shader via the
  existing submesh-level bind/draw split — plate submeshes already draw separately by
  construction) samples the plate atlas at the instance's slot instead of the model array layer;
  slot 0 means "sample the model array as today" so unassigned cars and old `.osm`s render stock.
  `face` uses the composed raster; `back` uses the city background slot (the three backgrounds are
  uploaded once at boot into fixed slots 1–3).
- **Slot allocator** (host side, `packages/game`): `(text, city) → slot` map + LRU over N;
  eviction only reclaims slots whose refcount (live instances wearing it) is zero — the plan-21
  claim-before-evict lesson applies verbatim. Parked-car respawn re-requests the same pair and
  hits the map — the determinism chain stays cheap.
- **Bind model**: the plate atlas joins the rigid path's on-demand bind groups as one more fixed
  binding (rebuilt bind-group layout for the vehicle pipelines — behind the veil, no steady-state
  compile). A submesh whose model array hasn't streamed in keeps its existing skip behaviour.

## Subtasks

- [x] Atlas + `uploadPlateText` + `uploadPlateBackgrounds`; the background array is re-created at the size
      the game's TXD ships (measured 64×32 stock vs 512×256 in the installed pack), and cached bind groups
      are dropped when it lands. The text slot is a CAP constant, per the standing rule.
- [x] Per-instance plate row + `setPlate` + capacity-grow restore (mirrors the paint row exactly, including
      "written on change, not per frame").
- [x] WGSL: plate-flagged submesh sample override via the material class + golden snapshot updated.
- [x] Fake-device tests (11): row writes and replication, upload into the chosen slot, out-of-range and
      wrong-size rejects, background re-creation at the asset's size, bind-group drop, grow restore.
- [x] Slot allocator + refcounted LRU + tests (10): evict-only-at-zero-refs, shared text, resident-until-
      needed, blank fallback when the atlas is full of worn plates.
- [x] Measure: atlas bytes + row bytes (below). GPU cost on the bench scene is owed with the rebuild —
      but the draw loop is unchanged, so the expected delta is zero by construction, not by hope.

## Acceptance

- A spawned car with `setPlate` shows the composed plate on face + city background on back;
  another instance of the SAME model shows a different plate simultaneously (the core requirement
  the three-era design got for free and this design must prove).
- Slot-0/old-osm path pixel-identical to today (bench draws unchanged).
- Memory + GPU deltas in the ledger, inside noise.

## Ledger

**Built 2026-07-28.** Suite **3 007 green** (+21), `tsc` and `eslint` clean.

### The decision the plan could not have foreseen

The plan offered "a new 16-byte row, or the two spare components of the lamp row". **The lamp row has one
spare, not two** — the engine comment saying `(headlights, brakes, spare, spare)` was stale; `intensity`
had taken one. So plates got their own row. But the harder constraint was in the SHADER:

> `RigidVsOut` already stands at **15 of WebGPU's 16 inter-stage locations** — the same ceiling that made
> plan 084 hide sky occlusion in `local.w`.

So a plate could not have a location of its own, and the fragment stage could not be handed the instance
index to look the row up itself. Two consequences, both deliberate:

1. **A plate face is a `MaterialClass`, not a flag.** The high nibble of `slots.w` was the only per-vertex
   channel with room (4 values used of 16), and it is already flat-interpolated to the fragment stage.
   `plateBack = 4`, `plateFace = 5`. Both shade MATTE for free — the reflection switch tests `paint`/
   `chrome` by value, so anything else falls through at amount 0.
2. **The vertex shader resolves the row and forwards ONE number.** It reads `rigidPlate[instance]` where
   the instance index still exists, picks the text slot or the city index by material class, and passes it
   in `lamps.w` — that location was already per-instance state and had a spare component.

Net: **zero draw-time cost**. The draw loop is untouched; no extra bind group, no dynamic offsets, no
per-plate pipeline switch.

### Sizes and memory

| Resource            | Size                                                    | Note                                                              |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Text atlas          | 64×16 × 256 layers = **1 MB**                            | CAP constant; its view is in every bind group, so it cannot grow  |
| Backgrounds (stock) | 64×32 × 3 = 24 KB                                        | re-created from the asset                                          |
| Backgrounds (pack)  | 512×256 × 3 = **1.5 MB**                                 | the installed mod's size — read from the TXD, never a constant     |
| Per-instance row    | partCount × capacity × 16 B (admiral: 47 × 8 = **6 KB**) | mirrors the paint/lamp rows exactly                                |

No mips on either array: a plate is 64×16 and SA samples its own with `rwFILTERNEAREST`, so there is no
chain to build and nothing lost by not having one.

### Slot allocator

`packages/game/src/vehicle/plate-slots.ts` — `(text → layer)` with a refcount and an LRU over the rest.
Identical text shares a layer, so a street of taxis costs one slot. A layer is evictable only at **zero**
refs (the claim-before-evict lesson), a released plate stays resident until its layer is actually needed
(a respawning parked car re-requests it for the price of a map lookup), and a full atlas of worn plates
returns the blank layer rather than stealing a plate off a car on screen. Recency is a monotonic counter,
not a clock — replays and tests must not depend on wall time.

### Owed to plan 04

- **Layer 0 must be filled with a blank plate at boot.** It is reserved and never handed out, and an
  unassigned car reads it — today that is an uninitialised (black) raster. Old `.osm` files are unaffected:
  with no `plate` flag their submeshes never take the plate material class and sample the model's own
  texture, exactly as now.
- The bench guard (draws/GPU unchanged on the vehicle scene) needs a pak rebuild, which the user owns.
  The rebuild landed 2026-07-28 but the guard was not run — the plan closed on the look verdict, and the
  row lives on in the plan readme's "Left unmeasured".

### Fixed on the first real boot (2026-07-28)

The `rigid` module would not compile on a real device: `rigidTexel`'s new `matClass` branch put the two
plate `textureSample` calls into non-uniform control flow, which WGSL forbids for implicit derivatives
(`'textureSample' must only be called from uniform control flow` → `CreateRenderPipeline("rigid-opaque")`
fails → no boot). The whole function is affected, not just the plate arms, because the early `return`s make
everything below them non-uniform as well. Fix: `dpdx(uv)`/`dpdy(uv)` are taken at the top of the function,
while the flow is still uniform, and all three paths sample with `textureSampleGrad` — same mip selection,
no branch restructuring. Verified headless on `build/gostown` (canvas boots, `draws 11`, no shader/pipeline
console error). Recorded in `docs/edge-cases/engine-rendering.md`.
