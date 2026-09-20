# perfect-map ASI — patch catalogue

The frozen list of `gta_sa.exe` **1.0 US (HOODLUM, 14 MB)** sites the ASI patches, and the exact change each
needs. Produced by plan [001](./plans/001-reverse-engineering.md); consumed by [004](./plans/004-limit-patches.md)
(the patches) via the TS generator (→ `generated/patches.hpp`). The reproduction oracle every row is validated
against is [`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro).

**Two-source rule** — every row needs BOTH: (a) the gta-reversed decompiled semantics AND (b) the original bytes
read from the real 1.0 US exe. **Both DONE** for #1–#4 (verified 2026-07-09 against the exe below, capstone
disasm); #5 is detection-only.

> **Machine mirror:** the addresses + original bytes here are also the typed
> [`gen/catalogue.ts`](../gen/catalogue.ts) — the single source of truth the generator turns into
> `src/generated/patches.hpp` (the C++ framework's fingerprint + byte-verify tables). This prose and that file
> MUST agree; the framework verifies these bytes against the exe at load (plan 003).

**Address provenance.** Addresses are annotated in
[gta-reversed-modern](https://github.com/gta-reversed/gta-reversed-modern) `source/game_sa/` (1.0 US only) AND
confirmed against the exe. The MACHINE home of provenance is each catalogue entry's `provenance` field
(`gen/catalogue.ts`, typed by the SDK — file/function + the commit consulted at RE time; the asi/sdk 002
convention): this prose carries the narrative, the typed field is what a future RE session greps. **Caveat — HOODLUM relocation:** on the real 1.0 US HOODLUM exe the protector has
STOLEN/relocated some function bodies. `IncludeEntity`'s callable entry 0x404C90 is a trampoline
(`e9 9b ea 15 01` = `jmp 0x1563730`); its real body — including the int16 truncation — lives at **0x1563730**
(in the `.HOODLUM`/`_TEXT_HA` overlay). `RemoveIpl`, `LoadScene`, `LoadIplBoundingBox` are clean in place. This
is why the recommended strategy hooks the **callable entries** (stable) rather than surgically patching relocated
bodies.

## Exe fingerprint (verified — the 003 version gate)

The gate reads these **from the exe on DISK** (file size + anchor bytes at file offsets), NOT from memory — so a
loaded FLA/OLA that has patched the IPL code at runtime cannot make us mis-identify the version (learned the hard
way: Wine test 1 failed a memory anchor because the user's FLA patches `RemoveIpl`).

- size **14,383,616** bytes; SHA1 **`8c23ceffafa9fd88ea567be7926a33413b8e3c00`**;
  SHA256 `f01a00ce950fa40ca1ed59df0e789848c6edcf6405456274965885d0929343ac`.
- image base **0x400000**; sections include `.HOODLUM` (the protector overlay).
- anchor bytes (clean, in-place): 0x404B4A = `0f bf 7b 22`; 0x405C23 = `66 8b 43 2a`; 0x5B8938 = `89 04 8d e0 c0 bc 00`.
- **Reject** the 14,405,632-byte SHA1 `0df50d56…` build (a different/extra-protected variant — see plan 001 notes).

## Summary table

| #   | Logical fix                                                                            | gta-reversed ref                                                                                                     | address(es) — real exe                                                                                                                                                                    | original bytes                                                                                           | change                                                                                                                                                                                                                                                                     | FLA/OLA overlap                                   |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `IplDef` building range int16 → int32 — **✅ SHIPPED, works in-game**; dummy range (011) — **✅ SHIPPED 2026-08-19, field ladder passed (8 entries at 100 000, 5 at 50 000)** | `IplStore.cpp` `IncludeEntity` + `RemoveIpl`                                                                         | IncludeEntity **0x404C90**; RemoveIpl entry **0x404B20** + building reads **0x404B4A** / **0x404B5D** / **0x404BA8** (loop back-edge); dummy reads **0x404C0F** (+0x404C13, adjacent) / **0x404C4E** (loop back-edge) | see #1 detail                                                                                            | observe IncludeEntity → int32 sidecars; snapshot at RemoveIpl entry; redirect its 3 building-bound + 2 dummy-bound reads to the sidecars                                                                                                                                    | FLA jmp-hooks all 5 reads → we overlay; OLA stock |
| 2   | `RemoveIpl` reads the widened range                                                    | `IplStore.cpp` `RemoveIpl`                                                                                           | **0x404B20** (body clean)                                                                                                                                                                 | `0f bf 7b 22` / `0f bf 53 24` (`movsx …,word[ebx+0x22/0x24]`)                                            | hook the entry; read the int32 range from the sidecar                                                                                                                                                                                                                      | (same as #1)                                      |
| 3   | `gpLoadedBuildings` 4096/scene overflow                                                | `FileLoader.cpp` `LoadScene` INST case                                                                               | store **0x5B8938**, count **0x5B8940** (array **0xBCC0E0**, count **0xBCC0D8**)                                                                                                           | `89 04 8d e0 c0 bc 00` (`mov [ecx*4+0xBCC0E0],eax`)                                                      | relocate+enlarge the `CEntity*[4096]`; add the missing bound                                                                                                                                                                                                               | FLA `Inst entries per file`                       |
| 4   | `IplEntityIndexArrays` 40-slot cap                                                     | `IplStore.cpp` `LoadIplBoundingBox` / `GetNewIplEntityIndexArray`                                                    | **0x405C00** (array **0x8E3F08**, count **0x8E3F00**, cursor **0x8E3EFC**)                                                                                                                | `66 8b 43 2a` (`mov ax,word[ebx+0x2a]` = staticIdx)                                                      | relocate+enlarge the `CEntity**[40]`; raise the ceiling                                                                                                                                                                                                                    | FLA `[IPL] Entity index array`                    |
| 5   | `LinkLods` double-patch coexistence                                                    | `FileLoader.cpp` `LinkLods`                                                                                          | **0x5B51E0**                                                                                                                                                                              | detection only                                                                                           | skip if FLA/OLA own the same zone                                                                                                                                                                                                                                          | the conflict itself                               |
| 6   | 2dfx fx-system use-after-free (LOD emitter crash) — **✅ SHIPPED (009), Wine pending** | `Fx/FxSystem.cpp` `Stop`/`Play`/`Kill`; `Fx/FxManager.cpp` `Update`/`DestroyFxSystem`; `Fx/Fx.cpp` `DestroyEntityFx` | crash `FxSystem_c::Stop` **0x4AA390**; `Play` **0x4AA2F0**; `Kill` **0x4AA3F0**; `DestroyEntityFx` **0x4A1280**; reap `FxManager_c::Update` **0x4A9A80** / `DestroyFxSystem` **0x4A9810** | Stop `56 8b f1 8b 46 08`; Play `51 56 8b f1 80 7e 50 02` (both deref `[this+8]->[+0x1B]`, no null guard) | null-guard `m_SystemBP` (+8) on `Stop` + `Play` — early-return when the blueprint is null. No node-unlink needed: `DestroyEntityFx` already `RemoveItem`s + `delete`s the node every stream-out; the guard just neutralises the redundant `Kill→Stop` on the reaped system | none (fx zone; FLA/OLA don't touch it)            |

## Structure details

### #1/#2 — `IplDef` int16 pool-index range (THE root cause)

`IplDef` (`IplDef.h`, `VALIDATE_SIZE = 0x34`) stores each IPL's owned pool range as **int16**:

```
offset  field           type
0x00    bb (CRect)      16 bytes
0x10    name[18]
0x22    firstBuilding   int16   { SHRT_MAX }
0x24    lastBuilding    int16   { SHRT_MIN }
0x26    firstDummy      int16   { SHRT_MAX }
0x28    lastDummy       int16   { SHRT_MIN }
0x2A    staticIdx       int16   { -1 }        ← also the 0..39 index into IplEntityIndexArrays (#4)
0x2C    isInterior bool … flags
```

`CIplStore::IncludeEntity` (0x404C90) truncates the building-pool index into those fields:

```cpp
const auto buildingId = GetBuildingPool()->GetIndex(entity->AsBuilding());
ipldef->firstBuilding = std::min(ipldef->firstBuilding, (int16)buildingId);   // (int16) TRUNCATION
ipldef->lastBuilding  = std::max(ipldef->firstBuilding, (int16)buildingId);   // (+ the stock max-vs-firstBuilding bug)
// dummy branch: same for firstDummy/lastDummy
```

`CIplStore::RemoveIpl` (0x404B20) then deletes by that stored range:

```cpp
ProcessPool(*GetBuildingPool(), def->firstBuilding, def->lastBuilding);   // [min,max) delete where GetIplIndex()==slot
ProcessPool(*GetDummyPool(),    def->firstDummy,    def->lastDummy);
```

Once the building pool exceeds **32,767** entries the `(int16)` cast wraps negative, the stored range is garbage,
and RemoveIpl scans a wild/empty range → undeleted or wrongly-deleted entities (the ghost `barriers2`). Bisected
flip at exactly 2^15 — see [ghost-barriers.md](../../../docs/open-issues/fixed/ghost-barriers.md).

**Verified on the exe (2026-07-09).** `IncludeEntity`'s body (relocated by HOODLUM to 0x1563730) does the
truncation as `mov word ptr [ecx+0x22], dx` (`66 89 51 22`) — writing only the low 16 bits of the index — after
`movsx eax, word ptr [ecx+0x22]` (`0f bf 41 22`) for the min/max compare; identically for `+0x24` (lastBuilding),
`+0x26` (firstDummy), `+0x28` (lastDummy). `RemoveIpl` (clean, 0x404B20) reads them back with
`movsx …, word ptr [ebx+0x22]` (`0f bf 7b 22`) / `[ebx+0x24]` (`0f bf 53 24`); `imul …,0x34` confirms the
0x34 `IplDef` stride. The machine code matches the decompiled `(int16)` cast exactly.

**Fix strategy — two options; the binary reality is NOT "just widen the field":**

- **(A) Widen in place (source-level).** Change the five fields to `int32` and drop the casts. In a fixed-layout
  compiled binary this shifts every field past 0x22 and grows the pooled struct stride from 0x34 — so it requires
  relocating the `IplDef` pool AND repatching every hardcoded offset access across the engine. High blast radius;
  rejected unless #4's `staticIdx` forces it.
- **(B) Sidecar range table (recommended, pure hooks).** Leave `IplDef` at 0x34 untouched. Hook `IncludeEntity`
  and `RemoveIpl` (injector `function_hooker`) to store/read the building/dummy range in our own
  `int32[NUM_IPL_SLOTS]` sidecar keyed by `iplSlotIndex`, bypassing the int16 fields entirely. No struct growth,
  no offset repatching — matches the architecture's "prefer data over instruction-layout surgery." `staticIdx`
  (the 40-slot index, #4) stays int16 but is bounded by #4's relocation, not by 2^15.
  **Sidesteps the HOODLUM relocation:** both hooks target the stable **callable entries** (0x404C90, 0x404B20 —
  0x404C90 is already a `jmp`, trivial for a function-hook to redirect), so the relocated/scattered body at
  0x1563730 is never touched. This is the decisive advantage over strategy A's surgical body patching.

> **Completeness check (the plan's hardest task):** confirm the sidecar covers EVERY read of
> `firstBuilding/lastBuilding`. Done — an exe scan (word reads of `[reg+0x22]`/`[reg+0x24]` near `imul …,0x34`) AND
> a full gta-reversed grep both prove **`RemoveIpl` is the sole reader**. But the exe scan found the compiler
> emits **THREE** reads there: `firstBuilding` @0x404B4A, `lastBuilding` @0x404B5D (the pre-loop cmp), and
> `lastBuilding` **re-read every loop iteration @0x404BA8** (the `for(i=first; i<last; i++)` back-edge). Missing
> the loop re-read stopped deletion after one building — that was the last bug.

**✅ Shipped implementation (`src/patches/int16.hpp`) — strategy B, works in-game with FLA and OLA:**

- **Observe `IncludeEntity`** (hook 0x404C90 → body 0x1563730): accumulate the building pool-index range in an
  `int32[256]` sidecar keyed by IPL slot, **pure min/max**.
- **Hook `RemoveIpl` entry** (0x404B20): snapshot the slot's range into `gSnapFirst/gSnapLast` for the detours,
  then RESET the slot to empty. This is the lifecycle reset — the naive `firstBuilding==SHRT_MAX` fresh-detect was
  WRONG: the engine's unsigned min keeps `firstBuilding` at SHRT_MAX for slots whose buildings are ALL > 32767, so
  it fired every call and collapsed the range to one element.
- **Three detours** feed `gSnapFirst`/`gSnapLast` into RemoveIpl's building loop at 0x404B4A / 0x404B5D /
  **0x404BA8** (the loop re-read). `dummies` were left alone on the diagnosis that they "don't overflow in
  practice" — **FALSIFIED IN THE FIELD 2026-08-19, and 004b is now needed.** The ceiling is on the POOL
  INDEX, not on our row count: with OLA `Dummys` above 32 767 any dummy allocated past that index has an
  index `firstDummy/lastDummy` cannot hold, so `RemoveIpl` walks the wrong range and never frees it. Our
  map places 17 644 permanent dummies against stock's 59, the count grows per world entry, and the pool
  buys `floor(Dummys / 17644)` entries per boot — **field-confirmed in both directions 2026-08-19**: 50 000
  died on the 3rd LOAD GAME, 100 000 on the 6th. See
  [`docs/open-issues/fixed/sa-load-game-crash-dummy-pool.md`](../../../docs/open-issues/fixed/sa-load-game-crash-dummy-pool.md).
  **The dummy pass reads its bounds at three sites, mirroring the building pass site for site** — `0x404C0F`
  (`movswl 0x26(%ebx),%edi`, firstDummy), `0x404C13` (`movswl 0x28(%ebx),%ecx`, lastDummy) and `0x404C4E`
  (`movswl 0x28(%ebx),%eax`, the loop back-edge re-read, which is the one the building work nearly missed) — though the first two are ADJACENT, so ONE detour covers them. Being built in [plans/011](plans/011-ipldef-dummy-range.md)
  (catalogue entry `ipldef-dummy-range`: `0x404C0F` 8 bytes `0f bf 7b 26 0f bf 4b 28`, `0x404C4E` `0f bf 43 28`,
  continuations `0x404C17` `3b f9 7f 3f` and `0x404C53` `83 c5 38`). **Completeness (011 step 2, 2026-08-19): the
  exe scan and a gta-reversed grep agree** — IplDef's `+0x26/+0x28` are READ only at those three sites and
  WRITTEN only by `IncludeEntity`'s body (`0x15637CA/D6`) and two constructors/initialisers (`0x156C494–4BA`,
  `0x15632CF–DB`, the `0x7FFF/0x8000` constants). `CColAccel::get/setIplDef` copy the struct whole (`rep movsl`)
  and only under `isCacheLoading`, which nothing sets on PC (no `models/CINFO.BIN` on the install). **Both
  `RemoveIpl` loops are INCLUSIVE** (`jg` skip, `jle` back-edge) — 004 feeds the max id and works, 011 does the same.
  **Coexistence (011 step 3, 2026-08-19, live bytes):** FLA jmp-hooks the dummy sites exactly as it does the
  building ones — `0x404C0F` = `e9 94 12 ec 01` (→ `0x022C5EA8`; its 5-byte jmp spans BOTH adjacent reads,
  leaving `bf 4b 28`), `0x404C4E` = `e9 66 12 ec 01` (→ `0x022C5EB9`; spans the movsx AND `inc edi`, so its
  handler re-runs the inc too). Continuations `0x404C17` / `0x404C53` pristine. Same overlay rule as 004.
  Note FLA's hooks are LIVE in every field capture that leaked — whatever its handlers do, they do not free
  the over-int16 dummies.
- **Coexistence:** OLA leaves the read sites stock (detours apply cleanly). **FLA jmp-hooks all three read sites**
  (5-byte `e9` jmps → its own ~0x22C49xx handlers) but NOT the entries — so we verify the entries + the detour
  continuations (0x404B54/63/BAD) and FORCE the detours over FLA's jmps, overlaying FLA's incomplete int16 patch
  with our complete one. The detours are self-contained (hardcode the relocated stock instruction), so identical
  code works over stock (OLA/vanilla) and over FLA's jmp. **Confirmed in-game: ghost barriers gone in both.**

### #3 — `gpLoadedBuildings` (4096, unchecked) in `LoadScene`

```cpp
// IplStore.h
gNumLoadedBuildings = StaticRef<uint32>(0xBCC0D8);
gpLoadedBuildings   = StaticRef<std::array<CEntity*, 4096>>(0xBCC0E0);
// FileLoader.cpp  CFileLoader::LoadScene  0x5B8700, INST case:
gpLoadedBuildings[gNumLoadedBuildings++] = LoadObjectInstance(line);   // NO bound
```

`CEntity*[4096]` at 0xBCC0E0, `uint32` count at 0xBCC0D8. No check before the write; overflowing 4096 buildings
in one `LoadScene` pass smashes adjacent `.data`. **Fix:** relocate+enlarge the array to our own buffer and add
the missing bound. `SetupRelatedIpls` (0x404DE0) is handed `&gpLoadedBuildings[gNumLoadedBuildings]` as the
append cursor, and `LinkLods` reads the same base — so the base+cursor must stay consistent across #3/#5 (patch
as a set). This is genuinely an **array-relocation** fix, not a hook.

**Verified on the exe (2026-07-09).** The store is `mov [ecx*4 + 0xBCC0E0], eax` (`89 04 8d e0 c0 bc 00`) at
**0x5B8938**, count write-back `mov [0xBCC0D8], ecx` (`89 0d d8 c0 bc 00`) at **0x5B8940** — the `0xBCC0E0`
base is a raw 32-bit displacement in these instructions, so relocation = rewriting that displacement at every
`0xBCC0E0`/`0xBCC0D8` reference in LoadScene/LinkLods/SetupRelatedIpls (multiple sites confirmed). No bound
instruction precedes 0x5B8938 — the fix must inject one.

### #4 — `IplEntityIndexArrays` (40 slots)

```cpp
// IplStore.h
ppCurrIplInstance       = StaticRef<CEntity**>(0x8E3EFC);
NumIplEntityIndexArrays = StaticRef<int32>(0x8E3F00);
IplEntityIndexArrays    = StaticRef<std::array<CEntity**, 40>>(0x8E3F08);
// LoadIplBoundingBox 0x405C00 indexes it by def.staticIdx (guarded only by !=-1):
const auto pIPLLODEntities = def.staticIdx != -1 ? IplEntityIndexArrays[def.staticIdx] : nullptr;
```

`CEntity**[40]` at 0x8E3F08; count `int32` at 0x8E3F00; cursor at 0x8E3EFC. The 40 ceiling is enforced in
`GetNewIplEntityIndexArray`. **Fix:** relocate+enlarge the 40-slot array and raise the ceiling. Because the
subscript is `def.staticIdx` (int16 @0x2A), a very large slot count would also need `staticIdx` widened — but 40
→ a few hundred stays well within int16, so relocation alone suffices; no struct-widen required here.

> **Local cross-check (RE session 1):** ProperFixes.asi references the `0x8E3EE8–0x8E3F08` global cluster
> (0x8E3EE8 seen in its bytes, 0x14 below `ppCurrIplInstance`), consistent with PF relocating this exact array.

### #5 — `LinkLods` coexistence (detection only)

`LinkLods` (0x5B51E0) reads `gpLoadedBuildings` up to `gNumLoadedBuildings + numRelatedIPLs` and calls
`CColAccel::addIPLEntity/cacheIPLSection` with the array base+count. It is NOT patched by us — but if FLA/OLA has
already relocated `gpLoadedBuildings`/the IPL arrays, our #3/#4 relocation would double-patch the same zone (the
documented FLA×OLA `LinkLods` crash). So #3/#4 carry `conflictsWith` guards: detect the adjuster (module enumerate

- byte probe, per [003](./plans/003-patch-framework.md)) and defer if it owns the zone.

### #6 — 2dfx fx-system use-after-free (Phase 2 — full RE in [plan 008](./plans/008-2dfx-emitter-re.md))

Two-source verified (gta-reversed-modern `Fx/*` + `Entity/Entity.cpp` **and** 1.0-US exe disasm — every offset
cross-checked). Superseded the earlier mis-ID (`0x4AA390` was thought to be `CEntity::CreateEffects` reading a null
model-info; it is not).

```cpp
// Fx/FxSystem.cpp — the crash
// 0x4AA390
void FxSystem_c::Stop() {
    m_nPlayStatus  = FX_STOPPED;                 // [this+0x50] = 1
    m_fCurrentTime = 0;                          // [this+0x54] = 0
    for (auto* prim : GetPrims())                // span{ m_Prims (+0x78), m_SystemBP->m_nNumPrims }
        prim->Reset();                           // [prim vtable +0xC]
}   // m_SystemBP = [this+8] (FxSystemBP_c*); m_nNumPrims = [bp+0x1B] (u8)
// 0x4AA3F0  Kill()  = { Stop(); m_nKillStatus(+0x51)=FX_KILLED; }
// ctor 0x4AAF00 nulls m_SystemBP(+8), stores vtable 0x85AA94(+0x7C); dtor 0x4AA260 zeroes m_SystemBP.

// Fx/FxManager.cpp — the reap that orphans the entity node
// 0x4A9A80  Update(): walks m_FxSystems; if FxSystem_c::Update(0x4AAF70) reports finished → DestroyFxSystem.
// 0x4A9810  DestroyFxSystem(): recycles the system's particles to the 1000-slot pool, RemoveItem, Exit, delete.
//           NEITHER touches g_fx(0xA9AE00).m_FxEntities → the FxEntitySystem node is left dangling.

// Fx/Fx.cpp / Entity/Entity.cpp — the create/destroy pair
// g_fx = 0xA9AE00, g_fxMan = 0xA9AE80
// CEntity::CreateEffects 0x533790 → EFFECT_PARTICLE → Fx_c::CreateEntityFx 0x4A11E0
//     → g_fxMan.CreateFxSystem(…,ignoreBounds=1) 0x4A9BE0 → new FxEntitySystem{m_System,m_Entity} → AddItem → Play.
// CEntity::DestroyEffects 0x533BF0 → EFFECT_PARTICLE → Fx_c::DestroyEntityFx 0x4A1280
//     → node->m_System->Kill() @0x4A12A4  ← CRASH FRAME (return 0x4A12A9) when m_System was already reaped.
```

**Crash `0x004AA3A1`** = `mov cl,[eax+0x1B]` with `eax=m_SystemBP=null` — a dangling `FxSystem_c` (dtor-zeroed
blueprint). **Bug:** `FxManager_c::Update`/`DestroyFxSystem` reap finished/`PlayAndKill` systems without unlinking
`Fx_c::m_FxEntities`; stream-out then `Kill()`s the freed system. LOD clones that keep type-1 2dfx multiply
entity-fx nodes (and drain the **1000-slot `FxEmitterPrt_c` pool**, `FX_MANAGER_NUM_EMITTERS`, alloc'd in `Init`
0x4A98E0), so the race becomes reliable.

**✅ Fix SHIPPED in 009 (`src/patches/fx2dfx.hpp`, `PM_FIX_FX2DFX`):** null-guard `m_SystemBP` on `Stop` (0x4AA390)
and `Play` (0x4AA2F0) — 5-byte entry `jmp` → a guard stub (`mov eax,[ecx+8]; test; jnz→relocated-prologue; ret`).
**No node-unlink is needed:** `Fx_c::DestroyEntityFx` (0x4A1280) already `RemoveItem`s **and** `operator delete`s the
`FxEntitySystem` node on every stream-out regardless of the `Kill()`, so nothing leaks once the redundant
`Kill→Stop` on the reaped system is neutralised. Guarding `Stop` covers the `Kill` path (`Kill` = `Stop()` + a state
byte). This lets particle 2dfx ride LOD clones without the crash (plan 010), and is engine-safe on stock SA too.
Behavioural PF cross-check (which site PF patches) + Wine confirmation of this fix still pending the user's run.

**Original bytes (baseline for 003 byte-verify):** at `0x4AA390`: `56 8B F1 8B 46 08 C6 46 50 01 C7 46 54 00 00 00 00 8A 48 1B` (`push esi; mov esi,ecx; mov eax,[esi+8]; mov byte[esi+0x50],1; mov [esi+0x54],0; mov cl,[eax+0x1B]`).

## Exe fingerprint (⏳ TODO — needs the exe)

1.0 US HOODLUM `gta_sa.exe` identity for the version gate (003): image size, a checksum over `.text`, and anchor
bytes at 2–3 of the addresses above. To be filled from the user's exe.

## Open (rule b — needs the 1.0 US exe + radare2/Ghidra)

- Original bytes at each address above (the byte-verify baseline for 003).
- Fingerprint constants.
- Full PF patch-site set via disassembly (not byte-scan) — confirm our set is a superset-or-equal of PF's
  limit patches (the behavioural completeness oracle).
