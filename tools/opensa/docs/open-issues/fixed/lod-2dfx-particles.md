# 2dfx particle emitters on generated LODs — new-game crash + far-view overdraw

**Status: ✅ crash ROOT-FIXED in-engine; particles now kept on LODs by default (2026-07-09, confirmed in-game).**
The use-after-free is fixed by our own `perfect-map.asi` (perfect-map Phase 2 — RE in
[plan 008](../../../asi/perfect-map/docs/plans/008-2dfx-emitter-re.md), patch
[plan 009](../../../asi/perfect-map/docs/plans/009-2dfx-emitter-patch.md): a null-`m_SystemBP` guard on
`FxSystem_c::Stop`/`Play`). With that asi present, `sa-lod-generator` now **keeps** type-1 particle 2dfx on LOD
clones by default ([plan 010](../../../asi/perfect-map/docs/plans/010-pipeline-keep-2dfx.md) step 1) — distant factory
smoke/fire is visible at LOD range. `--strip-particles` restores the old strip for a **stock target with no asi**
(without the asi, kept particles crash exactly as below). Corona/light 2dfx (type 0) is kept as before.

**Remaining (deferred, user's call 2026-07-09): far-view overdraw budget.** Keeping verbatim HD emitters at LOD
range means every distant smokestack emits at once (map-wide) → far-view fill cost. The crash no longer gates this;
it's a perf/visual tuning task, accepted as-is for now. The recorded path is **low-rate `effects.fxp` `_lod`
blueprint variants + a name-remap in the clone path** (plan 010's Future-enhancement section) — data-only, no engine
change. The old "particle 2dfx never rides into a LOD" policy now applies only to the stock (`--strip-particles`)
target.

## Symptom

Running the full perfect-map pipeline (mods + trees + procobj + sa-lod) in **real SA**:

1. **Crash starting a NEW game** — `0x004AA3A1`, AV on `[null+0x1B]`. Since RE'd precisely (perfect-map
   [plan 008](../../../asi/perfect-map/docs/plans/008-2dfx-emitter-re.md)): the faulting fn is **`FxSystem_c::Stop`
   @0x4AA390** reading a **null fx blueprint** (`m_SystemBP`), a use-after-free of a fx system the manager reaped
   without unlinking the entity's `FxEntitySystem` node — NOT a null model-info in `LoadObjectInstance` (that was
   the initial mis-ID). Keeping type-1 2dfx on many LOD clones multiplies the dangling nodes + drains the 1000-slot
   emitter pool, making the race reliable.
2. **Far-view overdraw / lag** — big translucent smoke sprites from every refinery/plant LOD rendering
   across the whole map at once (LODs have large draw distances, so _all_ of them emit simultaneously).

## Root cause

`sa-lod-generator` clones the **HD DFF verbatim** into the LOD slot (Phase-1 clone + hole-fill). The
verbatim copy carries the geometry's **2dfx section**, so any model with a **particle emitter** (2dfx
entry type 1 → an `effects.fxp` system: factory smoke `smoke30m`/`smoke50lit`/`ws_factorysmoke`,
`fire`, `water_fountain`, `vent`) re-emits from the far LOD as well. Unlike plain geometry, the cloned
LODs' **effect emitters do not unload from memory** (see plan 008: the engine reaps a finished fx system
without unlinking the entity's `FxEntitySystem` node, so stream-out later `Kill()`s a freed system) → the
`FxSystem_c::Stop` null-blueprint crash. Many concurrent LOD emitters also drain the 1000-slot particle pool.
Stripping the emitters from the clones removed the crash (confirmed in-game).

Scale: map-wide, 211 models carry light coronas and 38 carry particles; sa-lod cloned 88 of them
(11 particle + 77 corona — refinery chimneys, Vegas plants, fountains, fire).

Investigation gotcha: 2dfx lives on **each geometry** (`clump.geometries[i].particles/.lights`), NOT on
the clump — scanning `clump.particles` is always undefined, which hid the whole problem at first.

## The fix (both targets)

- **sa (`sa-lod-generator`)** — `stripParticleEffects(bytes)` in `@opensa/rw-codec/dff` removes **only**
  type-1 (particle) entries from every geometry's 2dfx section, keeping type-0 coronas/lights, road
  signs, escalators and all geometry byte-faithful (identity return when no particles). Wrapped around
  every clone: `finalize.ts` (Phase-1 clone) and `fill-holes.ts` (hole-fill clone). Decimated clones
  rebuild their 2dfx from lights via `build2dfxSection` — same lights-only policy.
- **opensa (`opensa-lod-generator`)** — structurally immune: the cell bake (`mergeCell`) rebuilds
  meshes from geometry only, so 2dfx is dropped by construction. Plan-003 Phase 5 then re-adds **only
  type-0 light entries** (`LIGHT_2DFX = new Set([0])` in `merge.ts`, `collectCellLightEffects`) as a
  byte-verbatim transplant with repositioned coordinates — cells gain distant night city lights, never
  emitters.

Verified: every smokestack LOD clone lost its emitter with coronas and tri counts intact
(`refchimny01` smoke30lit → none, 3 lights kept, 892 tris unchanged); HD keeps its smoke up close;
the new-game crash is gone.

Details + verification tables: [`tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md`](../../../tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md).

## Proper Fixes (MixMods)

The Proper Fixes compilation (Junior_Djjr / MixMods) reportedly fixes this class of problem at the
code level — most likely inside **`ProperFixes.asi`** (the asi is obfuscated, so which exact patch
handles LOD-carried effect emitters is unverified). This matches its role in the
[ghost-barriers](ghost-barriers.md) investigation: PF patches engine-side what we instead fix at
build time. As there, our builds deliberately do **not** depend on it — the generators strip the
emitters from the data itself, so the output stays safe on stock SA 1.0 with no runtime dependency;
PF remains a user-side escape hatch for stacks that clone LODs without stripping.
