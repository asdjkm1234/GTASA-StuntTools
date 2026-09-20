# perfect-map ASI — plan chain (our own limit-adjuster / engine-patch ASI)

Build a tool that generates **our own `.asi` plugin** for real GTA:SA 1.0 — a Windows DLL that patches the engine's hard limits (chiefly the `IplDef` int16 ceiling behind the ghost-barriers bug) so perfect-map builds can add **any** number of objects without the current ≤30k text-row work-around.

This is the "standing goal" recorded across the ghost-barriers post-mortem and memory: _pin the exact patches that remove the ceiling and ship a 100% fix._ [`ProperFixes.asi`](../../../../NO_COMMIT/ProperFixes%202.2.1/Proper%20Fixes/ProperFixes.asi) proves the bugs are code-patchable but is obfuscated and license-locked — we learn from it behaviourally and write our OWN patches from the decompiled engine ground truth.

## Why this, why now

- The full perfect-map build no longer stays under any text-row cap. **The 30,000-row guard was deleted on 2026-08-09** — the `sa` target always runs OLA + FLA + this asi, so int16 is lifted where our data lands, and pmb now only COUNTS the cost (`reportTextIplCensus` on the built `sa/` tree; [docs/open-issues/fixed/ghost-barriers.md](../../../../docs/open-issues/fixed/ghost-barriers.md)). Nothing caps how much map/vegetation/procobj we ship except memory and frame time. **That makes patch #1 load-bearing rather than optional**: the build now produces maps that a plain install cannot run (39,219 permanent rows and climbing), and nothing in the pipeline checks the asi is present — see 006.
- Four unbounded SA structures were mapped during the ghost-barriers investigation (int16 `IplDef` pool indexes = THE root cause; `gpLoadedBuildings` 4096/scene; `IplEntityIndexArrays` 40 slots; FLA×OLA double-patch conflicts). We know exactly what to patch — we just need our own patcher.
- With `ProperFixes.asi` installed, even our worst 30,566-row monolith worked — behavioural proof the fix is real and sufficient.

## What we know about the target

`ProperFixes.asi`: PE32 (i386) Windows DLL, 185 KB, built with the community modding stack — symbols expose **injector** (`function_hooker@injector`, `PatchAll`) + **plugin-sdk** (`plugin::`, `BaseEventI`, `ArgPick`). Loads via an ASI loader (Ultimate ASI Loader / modloader). Requires Proper Shaders or SkyGfx — that coupling is THEIRS (shader pipeline), NOT relevant to the limit patches we want. Our ASI targets only the limit/pool structures and depends on nothing.

## Core constraints shaping the whole chain

1. **We build on macOS, the artifact runs on Win32.** Need a headless cross-compile toolchain (no Windows machine, no MSVC). The user already runs the game under **Wine** — that's our test/debug harness.
2. **Blind binary patching must be SAFE.** Every patch site is verified against the known original bytes of `gta_sa.exe` 1.0 US before it's written; a mismatch aborts loudly instead of corrupting the process. This mirrors our existing "verify original bytes before patching" discipline in the mod tools.
3. **Coexistence, not conflict.** FLA and OLA already patch some of these zones; our ASI must detect them and skip/aliasing-guard overlapping patches (the FLA×OLA `LinkLods` double-patch crash is a documented failure mode). We patch ONLY what no installed adjuster covers.
4. **Version-locked.** Only SA 1.0 US (HOODLUM). Detect the exe fingerprint; refuse to patch anything else rather than guess.
5. **Reversible & debuggable.** Log every applied/skipped patch to a file; a "dry-run verify" mode that checks all sites without patching.

> **The framework these five principles describe now lives in [`asi/sdk`](../../../sdk/README.md)**
> (extracted 2026-08-06 — the [asi/sdk chain](../../../sdk/docs/plans/readme.md)), and perfect-map is its first
> consumer. The principles are unchanged and are now the SDK's constraints; the plans below are the historical
> record of how they were built, with pre-migration file paths.

## The chain

| #   | Plan                                                                                                                                          | Delivers                                                                                                                                                                                                           | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| —   | [Reproduce the ghost-barriers bug](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md) (→ `tools-debug/sa-int16-repro`) | **prerequisite — SHIPPED.** The fast, deterministic, isolated repro dial + detection oracle; the pass/fail gate for 001/004/006. Now a standalone debug tool (`@opensa/sa-int16-repro`), not part of this project. | done    |
| 1   | [001 — Reverse-engineering & patch catalogue](001-reverse-engineering.md)                                                                     | RE of ProperFixes + decompiled engine → the exact list of addresses/patches WE will write                                                                                                                          | done    |
| 2   | [002 — Toolchain & project architecture](002-toolchain-architecture.md)                                                                       | macOS→Win32 cross-compile, ASI skeleton, hook/patch primitives, repo layout                                                                                                                                        | done    |
| 3   | [003 — Patch framework](003-patch-framework.md)                                                                                               | declarative patch table, exe fingerprinting, original-byte verification, adjuster coexistence                                                                                                                      | done    |
| 4   | [004 — Limit-lift patches](004-limit-patches.md)                                                                                              | **#1 IplDef int16→int32 DONE (in-game, FLA+OLA); ghost barriers gone.** #2/#3 array relocations = 004b (deferred)                                                                                                  | #1 done |
| 5   | [005 — Build, debug & test harness](005-build-debug-test.md)                                                                                  | Wine boot smoke, byte-level unit tests on macOS, logging, symbol maps, CI                                                                                                                                          | partial |
| 6   | [006 — Pipeline integration & budget lift](006-pipeline-integration.md)                                                                       | ship the asi from pmb output — the budget-lift half is moot (the gate was deleted 2026-08-09, not relaxed), so what is left is making the dependency TRUE BY CONSTRUCTION instead of by the operator remembering | idea    |
| 11  | [011 — `IplDef` dummy range int16 -> int32 ("004b")](011-ipldef-dummy-range.md)   | the dummy half of the int16 lift — `RemoveIpl` never frees a dummy past pool index 32 767, so repeated world entries exhaust `CPool<CDummy>` and the game dies at `0x00538103`. Two detours, one already-hooked observer. **DONE 2026-08-19** — field: 8 entries at `Dummys = 100000` and 5 at 50 000 where 3 used to die; the pool's high-water freezes after the first entry | done    |

Dependencies are linear: the repro dial (shipped in [`tools-debug/sa-int16-repro`](../../../../tools-debug/sa-int16-repro)) → 001 → … → 006. The repro is the pass/fail oracle everything else is measured against (you can't confirm a fix you can't trigger) — it is DONE, so this project starts at **001**. 004 is the payload; everything between the repro and 004 exists to make 004 correct, safe, and maintainable.

**011 is Phase 1 business finished late**: 004 shipped the BUILDING half of the `IplDef` int16 lift and
deferred the dummy half as "004b" on a live diagnosis that dummies never overflow. The field falsified
that on 2026-08-19 and there is no configuration that avoids it, so 004b became work — it extends 004's
own machinery and depends on nothing new.

## Phase 2 — 2dfx effect-emitter lifecycle (a second patch on the same framework)

Once the framework (002/003/005) and pipeline integration (006) exist, adding an engine fix is "reproduce it → RE it → catalogue row → patch entry → validate" — exactly the extension procedure 005 documents. Phase 2 does that for the **2dfx particle-emitter crash on LODs** ([lod-2dfx-particles.md](../../../../docs/open-issues/fixed/lod-2dfx-particles.md)): keeping type-1 particles on cloned LODs makes the engine reap a finished `FxSystem_c` (`FxManager_c::Update`→`DestroyFxSystem`) without unlinking the entity's `FxEntitySystem` node, so stream-out `Kill()`s the freed system → **use-after-free crash `0x004AA3A1`** in `FxSystem_c::Stop` (null blueprint). This phase **reproduced the crash first** (007, its own oracle), **RE'd** the real lifecycle (008 — overturning the initial "null model-info" mis-ID), **shipped the fix** in our asi (009 — null-`m_SystemBP` guard on `Stop`/`Play`, confirmed in-game), and now lets the pipeline **keep** particle effects on LODs by default (010).

| #   | Plan                                                                             | Delivers                                                                                                                      | Status  |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| 7   | [007 — Reproduce the 2dfx emitter-leak crash](007-2dfx-reproduce.md)             | deterministic un-stripped-emitter repro of `0x004AA3A1` + oracle; the pass/fail gate for 008/009/010                          | done    |
| 8   | [008 — 2dfx emitter lifecycle: RE & root cause](008-2dfx-emitter-re.md)          | FxSystem_c use-after-free root cause (two-source); catalogue row #6 added                                                     | done    |
| 9   | [009 — 2dfx emitter-lifecycle patch](009-2dfx-emitter-patch.md)                  | **the fix in our asi — confirmed in-game: new-game crash gone WITH particle 2dfx on LODs**                                    | done    |
| 10  | [010 — Pipeline: keep 2dfx on LODs + far-view budget](010-pipeline-keep-2dfx.md) | keep particles on LODs by default (shipped); far-view overdraw budget deferred (user's call, low-rate `effects.fxp` recorded) | partial |

Phase 2 depends on Phase 1's 002/003/005/006 (framework + integration); 007 → 008 → 009 → 010 is linear, and **007 (reproduce) is the first Phase-2 task** — the RE and patch are measured against its oracle.

## References

- **Decompiled ground truth**: gta-reversed (github.com/gta-reversed/gta-reversed-modern) — `IplStore.cpp` (`IncludeEntity` 0x404C90, `LoadIplBoundingBox`), `FileLoader.cpp` (`LoadScene`, `LinkLods`). This is where every patch address comes from.
- **Hook/patch lib**: injector.hpp (github.com/thelink2012/injector, permissive — freely reusable, unlike ProperFixes) — the same lib PF and FLA use; or a ~200-line self-authored subset for full transparency (decided in 002).
- **ASI/plugin scaffolding**: plugin-sdk (github.com/DK22Pac/plugin-sdk) if we want its RW/CLEO glue — likely NOT needed; a bare `DllMain` ASI is enough for pure memory patches.
- **Cross-compile**: MinGW-w64 (`i686-w64-mingw32`) or Zig (`zig cc -target x86-windows-gnu`) — evaluated in 002.
- **Prior art on the exact bug**: Junior_Djjr / MixMods `CrashList.txt` ("Limits on .ipl files that contain objects in the inst section"); FLA's `[IPL] Entity index array` option.
- **In-repo**: `tools/perfect-map-builder/src/pipeline.ts` (`reportTextIplCensus`, on the `sa/` branch), `tools/map-placement/*` (binary streams), [ghost-barriers.md](../../../../docs/open-issues/fixed/ghost-barriers.md) (the full post-mortem this chain acts on).
- **Phase 2 (2dfx)**: gta-reversed `Fx/FxSystem.cpp` (`FxSystem_c::Stop` 0x4AA390 / `Play` 0x4AA2F0 / `Kill` 0x4AA3F0 — the crash + our fix), `Fx/FxManager.cpp` (`Update` 0x4A9A80 / `DestroyFxSystem` 0x4A9810 — the reap gap), `Fx/Fx.cpp` (`CreateEntityFx` 0x4A11E0 / `DestroyEntityFx` 0x4A1280), `Entity/Entity.cpp` (`CEntity::CreateEffects` 0x533790 / `DestroyEffects` 0x533BF0); [lod-2dfx-particles.md](../../../../docs/open-issues/fixed/lod-2dfx-particles.md) + `tools/sa-lod-generator/docs/plans/005-strip-clone-particle-fx.md` (the strip path, now opt-out `--strip-particles`); `@opensa/rw-codec/dff` `stripParticleEffects`/`build2dfxSection`.
