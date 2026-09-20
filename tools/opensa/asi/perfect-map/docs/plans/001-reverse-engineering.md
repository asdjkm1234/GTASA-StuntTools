# 001 — Reverse-engineering & patch catalogue

Part of the [perfect-map ASI chain](readme.md). Depends on [000](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md) (the repro + oracle — the RE's behavioural cross-check runs against it). No code — produces THE artifact everything downstream needs: a verified table of `gta_sa.exe` 1.0 addresses, their original bytes, and the exact byte/logic change each needs. Get this wrong and 004 corrupts the process; get it right and 004 is mechanical.

## Context

The ghost-barriers post-mortem already did the hard behavioural work — it named the four unbounded structures and proved the int16 `IplDef` truncation is the root cause (bisected flip at exactly 2^15). What's missing is the **patch-author's view**: the precise instruction addresses, the current encoded bytes, and the minimal edit at each. Two independent sources cross-checked so we never patch on a single guess:

1. **Decompiled engine** (gta-reversed) — the semantic ground truth: which function, which field, what type.
2. **ProperFixes.asi** — behavioural confirmation that a given site is THE one that matters (it's obfuscated with no cleartext addresses, so it's a cross-check and a "does patching only these actually fix it" oracle, never a copy source — license-locked).

## Decisions

1. **Learn, don't lift.** ProperFixes is studied only to (a) confirm which structures must be patched for a complete fix and (b) sanity-check our address list behaviourally (install it, confirm our worst build works → we're patching a superset/equal set). Its bytes/addresses are never reused.
2. **Two-source rule per patch**: every catalogue entry cites the gta-reversed function AND the confirmed original bytes read from a real 1.0 US `gta_sa.exe`. No entry ships on decompiler-only or PF-only evidence.
3. **Static RE tools on macOS**: the exe and the asi are analysable headless — objdump/radare2/Ghidra (radare2 + `r2` scripts are scriptable and free; Ghidra for the deeper `IplDef` struct recovery). PF's injector/plugin-sdk symbols (already dumped: `function_hooker@injector`, `PatchAll`) tell us its patch style (function hooks vs raw byte writes) which informs how many sites each logical fix touches.
4. **Scope = the four structures + coexistence**, nothing more. Anti-aliasing/shader/graphics parts of PF are explicitly out.

## The catalogue to produce (one row each, filled in during the plan)

| Logical fix                             | gta-reversed ref                                                    | exe address(es) | original bytes | change                                                | why                           | FLA/OLA overlap?                 |
| --------------------------------------- | ------------------------------------------------------------------- | --------------- | -------------- | ----------------------------------------------------- | ----------------------------- | -------------------------------- |
| `IplDef` pool indexes int16 → int32     | `IplStore.cpp` `IncludeEntity` 0x404C90 (+ struct def, `RemoveIpl`) | …               | …              | widen the min/max truncation + the struct field reads | THE root cause (2^15 ceiling) | check `[IPL] Entity index array` |
| `gpLoadedBuildings` 4096/scene overflow | `FileLoader.cpp` `LoadScene` (0xBCC0E0 array)                       | …               | …              | relocate/enlarge the static array or bound the write  | trashed statics past ~26k     | FLA `Inst entries per file`      |
| `IplEntityIndexArrays` 40-slot cap      | `IplStore.cpp` `LoadIplBoundingBox` (0x8E3F08)                      | …               | …              | enlarge the slot array / relocate neighbours          | boot crash at 40+ text IPLs   | FLA `[IPL] Entity index array`   |
| `LinkLods` double-patch guard           | `FileLoader.cpp` `LinkLods`                                         | …               | detection only | skip if FLA/OLA own it                                | —                             | the conflict itself              |

Note the `IplDef` field is not just the truncating `min/max` at `IncludeEntity` — it's the struct field WIDTH plus every read in `RemoveIpl`/bounding-box paths. RE must find the full read/write set of `firstBuilding/lastBuilding/firstDummy/lastDummy`, or a partial widen re-introduces the bug at a different site. This completeness check is the plan's hardest task.

## Tasks

- [x] Set up static RE on macOS: **capstone (venv) over the real 1.0 US `gta_sa.exe`** (`game-src/original`) — sufficient for disasm + byte extraction; radare2/Ghidra not needed for the four sites. gta-reversed addresses used to name functions.
- [~] Disassemble `ProperFixes.asi`: enumerate its injector hook targets / patched addresses → the "which sites are load-bearing" oracle. **Partial** — strings + byte-scan done (injector+plugin-sdk confirmed; PF references the `0x8E3EE8`–`0x8E3F08` cluster = it relocates `IplEntityIndexArrays`; graphics hook `0x5BF85B` out of scope). Full disasm (following injector call sites for `0x404C90`/`0xBCC0E0`) pending radare2.
- [x] For each of the four fixes: locate every read/write of the structure, decompiled context, minimal correct change, **AND the original bytes from the exe** (RE session 3) → [patch-catalogue.md](../patch-catalogue.md). Both source halves now cited.
- [x] `IplDef` struct layout + widen strategy that doesn't shift neighbouring fields. **DONE** — struct is 0x34 with int16 fields at 0x22/0x24/0x26/0x28/0x2A; in-place widen would grow the pooled stride (high blast radius), so the catalogue recommends a **sidecar int32 range table via IncludeEntity/RemoveIpl hooks** (#1/#2) + array relocation for #3/#4. staticIdx (40-slot index) stays int16, bounded by #4's relocation.
- [ ] Behavioural oracle run: **[repro](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md)'s buggy build + oracle**, install real ProperFixes.asi, confirm it goes clean; draft-verify our sites are responsible. **Blocked on Wine.**
- [x] Fingerprint spec: **size 14,383,616 + SHA1 `8c23ceff…` + clean anchor bytes** → [patch-catalogue.md](../patch-catalogue.md) fingerprint section.
- [x] Output: [`patch-catalogue.md`](../patch-catalogue.md) — the table + per-structure detail. **Semantic/strategy half frozen**; each row's original-bytes + fingerprint are the remaining two-source (b) items.

## Verification

- Every catalogue address, when read from a clean 1.0 US exe, matches the recorded original bytes exactly (re-checkable script).
- The set of addresses is a **superset-or-equal** of ProperFixes's limit-patch sites (we're not missing a load-bearing site).

## Measurements / notes

### RE session 1 (2026-07-09) — local ProperFixes.asi static scan

`ProperFixes.asi` = PE32 (i386) DLL, 189,568 B, GUI subsystem. Confirmed built on **injector**
(`injector::function_hooker<scoped_call, …>`, `PatchAll<…>`) + **plugin-sdk** (`plugin::BaseEventI`, `ArgPick`)
— matches the readme's dump. Its patch addresses live as MSVC-mangled template constants
(`$0<letters>@`, where each letter = `'A' + nibble`, hex, high-first; e.g. `FLPIFL` = 0x5BF85B) and as
in-code immediates.

Findings (a cross-check, NOT a copy source — license-locked):

- **`0x8E3EE8` is referenced in PF** — 0x20 bytes below our target `IplEntityIndexArrays` (0x8E3F08). Strong
  signal PF **relocates that array** (likely the true array base is 0x8E3EE8; 0x8E3F08 is a mid-array offset the
  post-mortem hit). → confirm the array's real base + element size in gta-reversed (RE session 2).
- `0x5BF85B` appears in the string-visible `function_hooker`/`PatchAll` template args (×28) with small ints
  `1001`/`1002` — a graphics/pipeline hook, NOT one of our four structures (out of scope).
- **No immediate references** to `0x404C90` (IncludeEntity), `0xBCC0E0` (gpLoadedBuildings) in PF's bytes.
  INCONCLUSIVE — injector `function_hooker` computes the hook target at runtime, so an absent immediate does
  not prove PF skips these sites. Needs proper disasm (radare2/Ghidra) following the injector call pattern, not
  a byte scan. **Blocker: no radare2/Ghidra installed, and no 1.0 US `gta_sa.exe` in-repo** (the two-source
  rule needs the exe for original bytes).

### RE session 2 (2026-07-09) — gta-reversed decompiled ground truth

Semantic half of the catalogue is DONE (→ [patch-catalogue.md](../patch-catalogue.md)). Addresses from
gta-reversed-modern `source/game_sa/` (1.0 US HOODLUM only build → map directly):

- `IncludeEntity` **0x404C90**, `RemoveIpl` **0x404B20**, `SetupRelatedIpls` **0x404DE0**,
  `LoadIplBoundingBox` **0x405C00** (IplStore.cpp); `LoadScene` **0x5B8700**, `LinkLods` **0x5B51E0**
  (FileLoader.cpp).
- `IplDef` = 0x34 bytes; int16 fields `firstBuilding`@0x22 / `lastBuilding`@0x24 / `firstDummy`@0x26 /
  `lastDummy`@0x28 / `staticIdx`@0x2A. Root: `(int16)buildingId` cast in IncludeEntity.
- `gpLoadedBuildings` = `CEntity*[4096]` @0xBCC0E0, count `uint32`@0xBCC0D8 — no bound on the LoadScene INST write.
- `IplEntityIndexArrays` = `CEntity**[40]` @0x8E3F08, count `int32`@0x8E3F00, cursor `ppCurrIplInstance`@0x8E3EFC.
- **Fix shapes:** #1/#2 → sidecar int32 range via hooks (avoids growing the 0x34 pooled struct); #3 → relocate+
  enlarge the 4096 array + add the missing bound; #4 → relocate+enlarge the 40-slot array. #3/#5 share the
  gpLoadedBuildings base → patch as a set. #5 LinkLods = coexistence guard, not a patch.

### RE session 3 (2026-07-09) — byte extraction from the real exe (two-source rule closed for #1–#4)

Exe attempt 1 (14,405,632 B, SHA1 `0df50d56…`) was REJECTED (wrong/extra variant). Exe attempt 2 —
`game-src/original/gta_sa.exe`, **14,383,616 B, SHA1 `8c23ceffafa9fd88ea567be7926a33413b8e3c00`** — is the
canonical 1.0 US; accepted. Disasm via capstone (venv), PE image base 0x400000.

- **HOODLUM relocation found:** `IncludeEntity`'s callable entry 0x404C90 is a trampoline (`e9 9b ea 15 01` =
  `jmp 0x1563730`); the real body (int16 min/max) is at **0x1563730**. `RemoveIpl` (0x404B20), `LoadScene`
  (0x5B8700), `LoadIplBoundingBox` (0x405C00) are clean in place.
- **#1 truncation (body @0x1563730):** `66 89 51 22` `mov word[ecx+0x22],dx` (+0x24/0x26/0x28) after
  `0f bf 41 22` `movsx eax,word[ecx+0x22]` — writes low-16 only = the int16 cast, confirmed.
- **#2 RemoveIpl:** `0f bf 7b 22` / `0f bf 53 24` (movsx reads); `imul …,0x34` = IplDef stride.
- **#3 LoadScene:** store `89 04 8d e0 c0 bc 00` `mov[ecx*4+0xBCC0E0],eax` @0x5B8938, count `89 0d d8 c0 bc 00`
  @0x5B8940; no bound before the store.
- **#4 LoadIplBoundingBox:** `66 8b 43 2a` `mov ax,word[ebx+0x2a]` (staticIdx) @0x405C23.
- **Strategy consequence:** hooking the callable ENTRIES (0x404C90/0x404B20) sidesteps the relocated body →
  strengthens sidecar-hook strategy B for #1/#2. Full details in [patch-catalogue.md](../patch-catalogue.md).

### Still pending (needs Wine, not blocking the catalogue)

- Behavioural oracle run: buggy [repro](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md)
  build + real ProperFixes.asi → clean; confirm our four sites are the responsible set.
- Full PF patch-site set via disasm (radare2, following injector call sites) — superset-or-equal check.
