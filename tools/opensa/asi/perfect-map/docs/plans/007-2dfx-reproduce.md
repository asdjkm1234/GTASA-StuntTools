# 007 — Reproduce the 2dfx emitter-leak crash (deterministic repro harness)

Part of the [perfect-map ASI chain](readme.md), Phase 2 — **the very first task of Phase 2, before any RE or patching.** The 2dfx emitter fix ([008 RE](008-2dfx-emitter-re.md) → [009 patch](009-2dfx-emitter-patch.md) → [010 pipeline](010-pipeline-keep-2dfx.md)) needs a fast, deterministic reproduction of the leak/crash to use as its pass/fail oracle — the Phase-2 analogue of [000](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md). You cannot confirm a fix you can't reliably trigger.

## Context

The open issue ([lod-2dfx-particles.md](../../../../docs/open-issues/fixed/lod-2dfx-particles.md)) reproduced this once, via the full perfect-map pipeline with particle 2dfx left on cloned LODs: keeping type-1 emitters on the clones → **new-game crash at `0x004AA3A1`** (AV `[null+0x1B]`). Scale: 38 models carry particles, sa-lod cloned 11 of them (refinery smoke, Vegas plants, fountains, fire). We currently STRIP particles at build time so it never fires — the repro must deliberately UN-strip. _(The pre-RE `LoadObjectInstance`/null-model-info framing here was a mis-ID — [008](008-2dfx-emitter-re.md) proved the fault is `FxSystem_c::Stop` reading a freed blueprint; see the corrected characterization below.)_

Two forces to separate in the repro (the RE in 008 will need them apart):

- **The leak itself** — emitters accumulate because a destroy/unload path doesn't cover LOD-cloned emitters (or a bounded fx pool overruns).
- **The pressure** — the far-view overdraw (every distant LOD emitting at once) is what turns the slow leak into a hard crash. A good repro can dial this pressure to trigger the crash deterministically and fast, rather than waiting for a slow leak.

## Decisions

1. **Un-stripped-particle build as the repro.** A build flag disabling `stripParticleEffects` on the sa-lod clones (or a targeted variant that keeps type-1 on a chosen set of the 11 particle-bearing cloned models) → an asset set that crashes at `0x004AA3A1` on new game in stock 1.0. This is the guaranteed baseline oracle; stand it up first.
2. **An emitter-count dial to make it fast + deterministic.** Parameterize how many particle-bearing LOD clones keep their emitters (1 → all 11, and beyond by cloning emitters onto more models). More concurrent far emitters = faster pool exhaustion = a crisper, quicker crash. The dial lets 008/009 bisect (how many emitters until it crashes?) and gives 009's patch a graded pass/fail (patched → no crash at ANY count).
3. **Isolate from Phase-1's limit bugs.** Keep the repro build within the int16/slot/scene bounds ([000](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md)'s isolation guards) so the crash is attributable to the EFFECT subsystem, not a text-IPL/pool ceiling. `0x004AA3A1` (`FxSystem_c::Stop`, per [008](008-2dfx-emitter-re.md)) vs Phase-1's `0x404C90`/`LoadIplBoundingBox` addresses already distinguish them — assert the crash address to prove which bug fired.
4. **A detection oracle beyond the crash.** The crash is one signal; the LEAK is the deeper one. Instrument (via the Phase-1 [005](005-build-debug-test.md) logging ASI once available, or Wine memory watch) the **effect-system / fx-pool occupancy across a new-game load** — so we can see accumulation BEFORE the crash and, crucially, verify the fix later makes the count RETURN TO BASELINE (a bigger pool that merely delays the crash is NOT the fix). Until the logging ASI exists, the black-box oracle is the `0x004AA3A1` crash on new game.
5. **Reuse the existing pipeline + strip machinery.** The repro rides sa-lod-generator's existing clone path with the strip toggled — don't hand-build DFFs (that risks a different corruption). `build2dfxSection`/`stripParticleEffects` already handle the 2dfx bytes; the repro flag just changes the keep-set.
6. **Behavioural cross-check.** The same crashing build + real `ProperFixes.asi` → boots AND (with instrumentation) emitters unload — bounding the fix and confirming PF touches the effect lifecycle (the oracle 008's RE uses).

## Tasks

- [x] Repro switch (no separate tool — user's call): **`sa-lod-generator --keep-particles`** (`LodConfig.keepParticles`, default false). Keeps type-1 particle 2dfx on BOTH clone paths — verbatim (`finalize.ts` / `fill-holes.ts` skip `stripParticleEffects`) AND decimated (`cloneLodDff` adds `collectClumpEffects(…, new Set([1]))` back). Produces a drop-in SA build whose LOD clones carry the emitters. **In-game `0x004AA3A1` confirmation pending Wine.**
      (Note: a `./NO_COMMIT/mods` model crashed the QEM decimator — a separate pre-existing bug the user is investigating; unrelated to 2dfx.)
      Command: `NODE_OPTIONS=--max-old-space-size=8192 npx tsx tools/sa-lod-generator/src/cli.ts --game <bootable-SA> --out ./build/salod-repro --keep-particles`
- [ ] Emitter-count dial: parameterize the number of particle-bearing clones (and optionally over-clone emitters onto more models) to control time-to-crash; verify a low count is borderline and a high count crashes fast/deterministically.
- [ ] Isolation: keep the build within Phase-1's int16/slot/scene bounds; assert the crash is `0x004AA3A1` (effect pool), NOT a Phase-1 address — so the two bug classes never get confused.
- [ ] Detection oracle: define pass/fail — **buggy** = `0x004AA3A1` new-game crash (and, when instrumented, fx-pool occupancy climbing without unload); **clean** = boots + count returns to baseline as LODs unload over K cycles. Reuse the user's Wine setup; document steps.
- [ ] Behavioural cross-check: crashing build + real `ProperFixes.asi` → clean + emitters unload (bounds the fix; same oracle 008 uses).
- [ ] Package as a one-command repro: `<cmd> --emitters N` → a build ready for the Wine install + the documented procedure + the crash/leak detection. THE shared oracle for 008/009/010 — reference it, don't re-derive it.

## Verification

- The un-stripped build reproduces `0x004AA3A1` on new game deterministically on the user's install; the dial makes it faster/slower as expected.
- Isolation confirmed: the crash is the effect-pool address, not a Phase-1 limit address (the two bugs are provably distinct).
- Real ProperFixes.asi turns the crashing build clean (oracle validated end to end).
- The repro is fast (dial the emitter count, not a full slow leak) and deterministic (same `N` → same result).

## Measurements / notes

### Repro switch shipped (2026-07-09)

`sa-lod-generator --keep-particles` (`LodConfig.keepParticles`). No separate tool — the existing clone path with
the strip toggled, exactly as the user asked ("just add 2dfx to the LODs as before, generate for SA"). Threads
`config → BuildInput.keepParticles → cloneLodDff` + `FillInput.keepParticles`. Green: tsc + eslint + all
sa-lod/lod-common/rw-codec tests (164). PARTICLE_2DFX = type 1.

- **✅ CONFIRMED in-game (2026-07-09):** the `--keep-particles` build crashes at **`0x004AA3A1`** on new game —
  AV reading `0x0000001B`, EAX=0. Matches the post-mortem exactly, and the address is the effect-pool bug (NOT
  Phase-1's `0x404C90`/`LoadIplBoundingBox`) → isolation proven. This is the Phase-2 oracle.
- **Crash characterization — CORRECTED by [008](008-2dfx-emitter-re.md)'s RE (this earlier guess was wrong).** The
  faulting function is **`FxSystem_c::Stop` @ 0x4AA390**, NOT `CEntity::CreateEffects`, and `[this+8]` is the fx
  **blueprint** (`m_SystemBP`), NOT a model-info: `mov eax,[esi+8]` (blueprint, NULL), `0x4AA3A1: mov cl,[eax+0x1B]`
  reads `FxSystemBP_c::m_nNumPrims`, then loops `m_Prims` `[esi+0x78]` calling `prim->Reset()`. Null blueprint = a
  **use-after-free** of a `FxSystem_c` the fx manager already reaped (`FxManager_c::Update` 0x4A9A80 →
  `DestroyFxSystem` 0x4A9810) without unlinking the entity's `FxEntitySystem` node; the dangling `m_System` is then
  `Kill()`'d on stream-out (`Fx_c::DestroyEntityFx` 0x4A1280 → `Kill` 0x4AA3F0 → `Stop`). Full lifecycle, addresses,
  and fix shape are in [008](008-2dfx-emitter-re.md)'s notes — the `LoadObjectInstance`/null-model-info framing was a
  mis-ID.
- min emitter count to crash / time-to-crash vs count: … _(pending — the current flag keeps all 11; a subset dial
  is a later refinement if we need finer bisection)_
- crash address confirmed (`0x004AA3A1`) + isolation: …
- repro command + Wine procedure + leak/crash detection oracle: … _(black-box oracle = the new-game crash until
  the logging ASI from 005 exists)_
