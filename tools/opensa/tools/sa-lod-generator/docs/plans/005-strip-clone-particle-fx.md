# 005 — Strip particle 2dfx from cloned LODs

**Status: ✅ Implemented.** Remove particle 2d-effect emitters from the far-LOD clones so they don't re-emit (and
don't leak into memory) at distance.

## Problem

Phase 1 (`002-clone-lods`) and hole-fill (`003-fill-missing-lods`) copy the **HD DFF verbatim** into the LOD slot
(`finalize.ts` `img.set(lodModel.dff, hdDff)`, `fill-holes.ts` `assignFills`). The verbatim copy carries the
geometry's **2dfx effects**. For any model with a **particle emitter** (2dfx entry type 1 → an `effects.fxp`
system: factory smoke `smoke30m`/`smoke50lit`/`ws_factorysmoke`, `fire`, `water_fountain`, `vent`) the far LOD then
re-emits the effect. In the full perfect-map pipeline (mods + trees + procobj + sa-lod) this had two symptoms:

1. **Far-view overdraw / lag** — big translucent smoke sprites from every refinery/plant LOD rendering across the
   whole map at once (LODs have a large draw distance), on top of the trees/procobj streaming load.
2. **Crash when starting a NEW game** — `0x004AA3A1`, AV on `[null+0x1B]` via `CFileLoader::LoadObjectInstance`.
   The cloned-LOD **effect emitters do not unload from memory** the way plain geometry does; combined with the rest
   of the pipeline's payload this exhausted the streaming/model pool, so the first world-load instantiation got a
   null model-info and faulted. Removing the emitters from the clones eliminated the crash.

~88 map models carry 2dfx (211 with light coronas, 38 with particles); sa-lod cloned 11 particle + 77 corona models
(refinery chimneys, Vegas plants, fountains, fire).

## Fix (level 1 — particles only, coronas kept)

- New `stripParticleEffects(bytes)` in `@opensa/rw-codec/dff`: removes **only** particle entries (type 1) from every
  geometry's 2dfx section, keeping **coronas/lights (type 0)** — distant night lights are wanted — road signs,
  escalators, and all geometry byte-faithful (via `readRw`/`writeRw`; identity return when there are no particles).
  2dfx layout: `u32 count`, then entries of `position(3×f32) + type(u32) + dataSize(u32) + data`.
- `finalize.ts` and `fill-holes.ts` wrap every clone in `stripParticleEffects(...)`.
- Result: far LOD = stock behaviour (no emitter), HD keeps its smoke up close, geometry byte-identical.

`opensa-lod-generator` needs no change — its cell bake (`mergeCell`) rebuilds meshes from geometry only, so 2dfx is
already dropped from cell-LODs.

## Verified

Every smokestack LOD clone lost its particle emitter while keeping coronas and identical tri counts
(`refchimny01` smoke30lit → none, 3 lights kept, 892 tris unchanged; corona-only `controltower_sfse`/`baybridge2_sfse`
lights preserved); HD untouched. In-game: the new-game crash is gone.
