# 008 — 2dfx emitter lifecycle: reverse-engineering & root cause

Part of the [perfect-map ASI chain](readme.md), Phase 2. Depends on [007](007-2dfx-reproduce.md) (the repro + detection oracle the RE cross-checks against) and Phase 1's [001](001-reverse-engineering.md) (RE setup + patch-catalogue format) / [003](003-patch-framework.md) (where the new rows will plug in). No code — produces the verified catalogue rows for the 2dfx emitter fix, the way 001 did for the limit bugs.

## Context

The open issue ([lod-2dfx-particles.md](../../../../docs/open-issues/fixed/lod-2dfx-particles.md)) already has the data-side story: `sa-lod-generator` clones the HD DFF verbatim into the LOD slot, carrying its **2dfx section**; type-1 (particle) entries make the far LOD an `effects.fxp` emitter too. The pre-RE framing was "emitters don't unload → pool exhaustion → null model-info in `CFileLoader::LoadObjectInstance` → crash `0x004AA3A1`" — **this plan's RE overturned that** (see Measurements): the real fault is a `FxSystem_c` use-after-free in `FxSystem_c::Stop`, not a null model-info. Scale: 38 models carry particles, sa-lod cloned 11 of them. We STRIP the emitters at build time; ProperFixes reportedly fixes the lifecycle in-engine, so the emitters can exist without leaking.

What's unknown and this plan resolves: **why exactly they leak** (which engine lifecycle call is missing/failing for LOD-cloned emitters) and **which patch ProperFixes uses** — then two-source-cited catalogue rows for our own implementation.

## The hypothesis to confirm or replace

SA attaches 2dfx particle systems to an entity via `CEntity::CreateEffects` (registers `FxSystem`s with the global fx manager) and is supposed to tear them down via `CEntity::DestroyEffects` on unload. Candidate leak mechanisms to test during RE (RE decides which is real — do NOT assume):

1. **DestroyEffects never called for LOD entities** — LOD entities take a create/stream path that registers effects but a matching destroy is skipped on stream-out, so `FxSystem`s accumulate.
2. **A fixed effect pool overflows** — `FxSystem`/`FxSystemBP`/`C2dEffect` or the `effects.fxp` system-instance array is a bounded structure; too many concurrent emitters (every distant LOD emitting at once — the far-view overdraw is the same root) overrun it, corrupting the pool that model-info also lives near → the null on next load.
3. **Effects created for entities that never fully init** — the LOD instantiation reads a model-info that isn't ready (the null at `[null+0x1B]`), i.e. the effect-create path runs against an entity whose model-info slot was reclaimed under pool pressure.

"couldn't unload effect data from memory" (the user's framing) points at #1/#2 — a destroy/unload path that doesn't cover LOD-cloned emitters, or an unbounded accumulation. The far-view overdraw (all LOD emitters active simultaneously) is the _pressure_ that turns the leak into a crash, and is addressed data-side in [010](010-pipeline-keep-2dfx.md).

## Decisions

1. **Learn from PF behaviourally, write our own** — identical rule to Phase 1. PF is obfuscated + license-locked; we use it as the oracle that "this class is code-fixable and here are the sites it touches", never a byte source.
2. **Two-source rule** per catalogue row: gta-reversed function/field + confirmed original bytes from real 1.0 US `gta_sa.exe`.
3. **Behavioural oracle is decisive here** because the leak is subtle: install real ProperFixes.asi, take our UN-stripped LOD build (particles left in — reproduces the crash on stock), confirm PF makes it boot AND that distant emitters unload (watch the effect count / memory over a new-game load). That proves the fix is real and tells us which engine path PF touched.
4. **Distinguish "the fix" from "the mask".** If PF merely raises a pool (mask) vs actually restoring the destroy path (fix), we want the real fix — verify emitters actually UNLOAD (count returns to baseline when the LOD leaves range), not just "bigger pool delays the crash".

## Tasks

- [x] Use **[007](007-2dfx-reproduce.md)'s crashing repro build + detection oracle** as the RE fixture (particle-2dfx un-stripped → `0x004AA3A1` on new game). Reuse it — do not re-derive a repro here.
- [x] Decompiled RE: mapped `CEntity::CreateEffects` (0x533790)/`DestroyEffects` (0x533BF0), the fx manager (`Fx_c` g_fx@0xA9AE00, `FxManager_c` g_fxMan@0xA9AE80, `Update` 0x4A9A80 / `DestroyFxSystem` 0x4A9810), `FxSystem_c` (`Stop` 0x4AA390 / `Play` 0x4AA2F0 / `Kill` 0x4AA3F0 / ctor 0x4AAF00), and the entity stream-out path. **Divergence found: reap-without-unlink use-after-free** (Update/DestroyFxSystem free a finished system without dropping its `FxEntitySystem` node) + LOD shared-RwObject guard asymmetry. Two-source: gta-reversed + exe disasm, all offsets matched. See Measurements.
- [ ] Instrument under Wine: log effect-system count / relevant pool occupancy across a new-game load with the un-stripped build — confirm accumulation and pin the exact leaking structure/call. (winedbg recipe + logging from Phase 1's 005.) — _static RE already pins it; this is confirmatory, do when the 005 logging ASI exists._
- [ ] **Behavioural oracle (USER Wine run):** same crashing build + real ProperFixes.asi → boots AND emitter count returns to baseline as LODs unload; bytes-diff the fx zone vs stock to name PF's exact patch site. **This is the one remaining item — needs the user's install.**
- [x] Produce the catalogue rows: **row #6** appended to `patch-catalogue.md` (gta-reversed refs + addresses + original bytes at 0x4AA390 verified `56 8B F1 8B 46 08 …` + intended change + FLA/OLA overlap = none).
- [x] Decide the fix shape for [009](009-2dfx-emitter-patch.md): **root-fix the reap/unlink dangle + `m_SystemBP` null-guard on Stop/Play/DestroyFxSystem** (belt-and-suspenders) — lets us ship particles on LODs instead of stripping. See Measurements.

## Verification

- The leaking structure/call is named with decompiled + behavioural evidence agreeing (not a single guess).
- Every proposed catalogue address matches recorded original bytes on a clean 1.0 US exe (re-checkable, per Phase-1 discipline).
- The repro fixture reliably crashes at `0x004AA3A1` without the fix and boots with real PF (bounding the search).

## Measurements / notes

### RE done (2026-07-09) — the premise was wrong; here is the ground truth

Two-source (gta-reversed-modern `Fx/*.cpp` + `Entity/Entity.cpp` **and** confirmed 1.0-US `gta_sa.exe` disasm — every
offset cross-checked). **The crash is NOT in `CEntity::CreateEffects` and `[this+8]` is NOT a model-info.** The old
note (`0x4AA390 = CreateEffects`, `[+8]=modelInfo`, `[+0x1B]=2dfx count`) is superseded.

**Faulting function `0x4AA390` = `FxSystem_c::Stop()`** (thiscall, `this` = a `FxSystem_c*`):

- `[this+0x08]` = `m_SystemBP` (`FxSystemBP_c*` **blueprint**) — **NULL at crash** (EAX=0).
- `[bp+0x1B]` = `FxSystemBP_c::m_nNumPrims` (uint8) — the crashing `mov cl,[eax+0x1B]` reads a **primitive count**, not a 2dfx count.
- `[this+0x78]` = `m_Prims` (`FxPrim_c**`); loop body `mov edx,[ecx]; call [edx+0xC]` = `prim->Reset()` per primitive.
- `[this+0x50]=1` = `m_nPlayStatus = FX_STOPPED`; `[this+0x54]=0` = `m_fCurrentTime`.
- Ctor `0x4AAF00` nulls `m_SystemBP`(+8) + stores vtable `0x85AA94`(+0x7C); dtor `0x4AA260` zeroes `m_SystemBP`.
  A live/initialised system can never have `m_SystemBP` null → **null blueprint = use-after-free of a freed `FxSystem_c`.**

**Crash path (all addresses verified in-exe):**
`FxManager_c::Update` `0x4A9A80` each frame walks `m_FxSystems`, calls `FxSystem_c::Update` `0x4AAF70`, and when a
system reports finished → `FxManager_c::DestroyFxSystem` `0x4A9810` (recycles the system's particles to the pool,
`RemoveItem`, `Exit`, `delete` → dtor zeroes `m_SystemBP`). **`DestroyFxSystem`/`Update` never unlink the matching
`FxEntitySystem` node in `Fx_c::m_FxEntities`** (verified: neither references `g_fx` @0xA9AE00). So the node's
`m_System` is now dangling. Later, on stream-out: `CEntity::DestroyEffects` `0x533BF0` → `Fx_c::DestroyEntityFx`
`0x4A1280` → `it->m_System->Kill()` (**`0x4A12A4`, our crash frame** = return `0x4A12A9`) → `FxSystem_c::Kill`
`0x4AA3F0` (`{ Stop(); m_nKillStatus(+0x51)=FX_KILLED }`) → `Stop` `0x4AA390` → `mov cl,[null+0x1B]` → **AV `0x004AA3A1`.**

**Why LOD-cloned particle emitters trigger it (two independent asymmetries):**

- **(a) Reap-without-unlink (the real engine bug).** `FxManager_c::Update` reaps FINITE/`PlayAndKill` systems and
  frees them without telling `g_fx`, leaving a dangling `FxEntitySystem`. Looping fire/smoke that never finishes
  never gets reaped — which is why only _certain_ cloned emitters bite. Keeping type-1 2dfx on many far LOD clones
  multiplies entity-fx nodes → multiplies the odds a reaped-but-still-linked system is `Kill()`'d on stream-out.
- **(b) Guard asymmetry on the shared-RwObject/LOD path.** `CreateRwObject` `0x533D30` guards `!GetIsVisible()`
  before `CreateEffects`; `DeleteRwObject` `0x534030` / `DetachFromRwObject` `0x533FB0` guard `!GetRwObject()` before
  `DestroyEffects`. `AttachToRwObject` `0x533ED0` (header: _"used for objects that share a single RwObject, like
  LODs"_) runs `CreateEffects`, but if `m_pRwObject` was nulled by another teardown the `!GetRwObject()` early-return
  **skips `DestroyEffects` entirely** → the system + node leak and permanently hold slots.

**Bounded pool that overflows** = the **1000-slot `FxEmitterPrt_c` particle pool** (`FX_MANAGER_NUM_EMITTERS=1000`,
`g_fxMan` @0xA9AE80, alloc'd in `Init` `0x4A98E0`). NOT the `FxSystem_c` list (plain heap) nor the 1 MB blueprint
bump-pool. Also latent: `m_apMatrices[8]` ring in `FxRwMatrixCreate` `0x4A9440` has no bounds check.

**Why `stripParticleEffects` is the correct data-side cut (confirms current production default):** removing type-1
`EFFECT_PARTICLE` 2dfx from the cloned-LOD model-info stops `CEntity::CreateEffects` from ever calling
`CreateEntityFx` for the LOD → no node, no reap-dangle, no `Stop` crash, no pool drain. The strip is engine-safe.

### Fix shape for 009

The crash is generic (it bites stock SA too under the reap-dangle race); the LOD build merely amplifies it.

**Correction after tracing `DestroyEntityFx` `0x4A1280` fully:** there is **no lingering node leak to repair** — that
function `RemoveItem`s **and** `operator delete`s the `FxEntitySystem` node on _every_ stream-out, regardless of the
`Kill()`. The particles were already recycled to the pool by `DestroyFxSystem`. So the ONLY defect is the redundant
`Kill()→Stop()` dereferencing the already-reaped system in between. That collapses the fix to one tier:

- **Null-`m_SystemBP` guard on `Stop` `0x4AA390` + `Play` `0x4AA2F0`** (the two functions that deref `[this+8]->[+0x1B]`
  with no guard and are reachable on a dead system). A reaped system has `m_SystemBP == null` (dtor-zeroed) → nothing
  to Stop/Play → early-return. Guarding `Stop` also covers `Kill` `0x4AA3F0` (= `Stop()` + a state-byte write).
  This is a **real** fix, not a mask: no pool enlarged, emitters still unload via the node-delete; we only remove the
  dead-system touch. It lets us SHIP particles on LODs (plan 010). `DestroyFxSystem` `0x4A9810` derefs too but is only
  ever called on a still-live system (before its dtor), so it needs no guard.

**SHIPPED in [009](009-2dfx-emitter-patch.md)** (`src/patches/fx2dfx.hpp`, `PM_FIX_FX2DFX`, catalogue row #6).

### Filled checklist

- confirmed leak mechanism: **reap-without-unlink use-after-free** (mechanism (a)) + LOD guard-asymmetry (b) — NOT
  any of the original #1/#2/#3 (those assumed a null _model-info_, which was a mis-ID of `FxSystem_c::Stop`).
- leaking structure/call address(es): crash `FxSystem_c::Stop 0x4AA390` ← `Kill 0x4AA3F0` ← `Fx_c::DestroyEntityFx
0x4A1280`; reap gap `FxManager_c::Update 0x4A9A80` / `DestroyFxSystem 0x4A9810`; bounded pool = 1000 `FxEmitterPrt_c`
  @ `g_fxMan 0xA9AE80`.
- PF-touched zone(s) (oracle): **PENDING the user's behavioural cross-check** — un-stripped build + real
  `ProperFixes.asi` → boots + emitters unload; then bytes-diff the fx zone vs stock to name PF's exact site.
- fix shape chosen for 009: root-fix the reap/unlink dangle + `m_SystemBP` null-guard on Stop/Play/DestroyFxSystem
  (see above).
