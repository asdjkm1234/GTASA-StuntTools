# 003 — Patch framework (safety, fingerprinting, coexistence)

Part of the [perfect-map ASI chain](readme.md). Depends on [002](002-toolchain-architecture.md) (a loading ASI). Delivers the SAFE, declarative machinery that 004's actual patches plug into — the difference between "a maintainable patcher" and "a pile of magic `WriteMemory` calls".

> **Historical record — the framework this plan built now lives in [`asi/sdk`](../../../sdk/README.md)**
> (namespace `asi::`, headers in `asi/sdk/include/asi/`, build rules in `asi/sdk/mk/asi-plugin.mk`),
> extracted 2026-08-06 by the [asi/sdk chain](../../../sdk/docs/plans/readme.md). Paths to
> `log/mem/hook/fingerprint/coexistence/patch_table.hpp` and `freestanding.cpp` below are where they
> were WHEN THIS SHIPPED; the text is left unedited on purpose. `asi/perfect-map` keeps only its
> catalogue, payloads, config knobs and a thin Makefile.

## Context

Blind binary patching of a running game is unforgiving: a wrong address silently corrupts the process, a version mismatch patches garbage, and FLA/OLA patching the same zone crashes (`LinkLods` double-patch, documented in ghost-barriers.md). This plan builds the guardrails ONCE so every patch in 004 is declared, verified, logged, and coexistence-checked by construction.

## Decisions

1. **Declarative patch table, generated from `001`'s catalogue.** Each patch is a record: `{ name, address, expectedOriginalBytes, apply(fn), requires?, conflictsWith? }`. A TS generator (the tool's non-C++ half, decided in 002) reads `patch-catalogue.md` → emits a C++ header of constants (addresses + original-byte arrays + fingerprint). ONE source of truth; a hand-edit to an address in C++ is impossible because C++ addresses are generated. Unit-testable on macOS (the TS side) independent of the game.
2. **Original-byte verification is mandatory, per patch.** Before applying, read `sizeof(expectedOriginalBytes)` at `address` and `memcmp`. Mismatch → SKIP that patch, log LOUD (`[perfect-map] ABORT patch 'ipldef-widen': bytes at 0x404C90 != expected`), never write. A single mismatch does not abort the others (partial safety), but the log makes it un-missable. This is the same discipline our TS mod tools use ("verify original bytes before patching").
3. **Exe fingerprint gate.** On attach, identify the module: base image size + a checksum + anchor bytes at known offsets (from `001`). Not 1.0 US HOODLUM → apply NOTHING, log the detected fingerprint, return cleanly. We refuse to guess across versions.
4. **Adjuster coexistence.** Detect loaded FLA (`fastman92limitAdjuster*`) and OLA (`$fastman92limitAdjuster`/`III.VC.SA.LimitAdjuster`) modules (enumerate loaded modules) AND probe whether a conflicting zone is already patched (its bytes differ from stock in the expected way). For each patch with `conflictsWith`, if the other adjuster owns it → SKIP + log "deferring IPL-slot patch to FLA". Our ASI patches only what nothing else covers → the FLA×OLA×us triple-patch crash is impossible by construction.
5. **Idempotent + observable.** Re-applying is a no-op (byte check fails after first apply → treated as already-ours via a second "post-patch bytes" signature). Every decision (applied / skipped-mismatch / skipped-conflict / skipped-version) is logged with address and reason. A `dry-run` build flag verifies all sites and logs the plan WITHOUT writing — the primary debugging aid.
6. **No hooks where a data-relocation suffices.** Prefer relocating a too-small static array to our own `VirtualAlloc`'d block + repointing accessors (from 001's strategy) over instruction detours when possible — fewer moving parts, easier to reason about. Function hooks (injector) reserved for logic changes (the int16 min/max widen).

## Tasks

- [x] TS generator → emit `src/generated/patches.hpp` (fingerprint constants + per-site original-byte anchors). **Boundary refined:** the machine source of truth is a typed **`gen/catalogue.ts`**, NOT the prose `docs/patch-catalogue.md` (parsing narrative markdown is brittle) — the two must agree. Vitest tests (7): well-formed → expected constants; malformed (bad sha1 / empty bytes / out-of-range addr / >255 byte / dup id) → hard error.
- [x] C++ `PatchTable` runner (`patch_table.hpp`): fingerprint-gate → detect adjusters → byte-verify every generated site → log the plan. `ScopedUnprotect` VirtualProtect RAII in `mem.hpp`. **apply()/conflict-defer land in 004** — 003 ships the runner in verify-only mode.
- [x] Fingerprint module (`fingerprint.hpp`): file-size + every generated anchor's bytes (base-relative, survives a rebased load). Lighter than a PE-checksum and reuses the byte-verify primitive. Wrong → patch nothing, log, return.
- [x] Adjuster detection (`coexistence.hpp`): `CreateToolhelp32Snapshot` module enumeration → FLA/OLA bitmask + log. The per-zone byte-probe is the same `VerifyBytes` the apply() will use in 004 (a site whose bytes already differ = an adjuster owns it).
- [x] Logger (`log.hpp`): flush-on-write to `perfect-map-asi.log` (survives a crash → last attempted patch visible). KERNEL32-only, no CRT. (Per-line timestamps/levels deferred — the flush-on-write property is the load-bearing one.)
- [~] `dry-run`: **003 is verify-only by construction** (no writes anywhere yet); a `PM_APPLY` compile flag flips it on in 004.
- [x] Wine test: **PASS on the live install** (`./1`, 2026-07-09) — `fingerprint OK`, FLA **and** OLA flagged, all 5 sites pristine, `safe to apply`. Disk fingerprint proven immune to the adjusters' memory patches. (Wrong-version path covered by the disk size/anchor gate + the rejected `0df50d56` variant.) See Wine test 2 below.

## Verification

- On a clean 1.0 US exe: every patch's byte-verify passes (proves 001's catalogue is byte-accurate end to end).
- With FLA present: overlapping patches log "deferred", non-overlapping ones still apply, game boots.
- Wrong version: zero writes, clean boot, clear log.

## Measurements / notes

### Framework shipped (2026-07-09)

- **Boundary decided:** typed `gen/catalogue.ts` (single source of truth) → `gen/generate.ts` →
  `src/generated/patches.hpp` (git-ignored, regenerated by `npm run gen`, wired into `build:asi`). C++ reads the
  tables; no address is ever hand-typed in C++. Malformed catalogue = generate-time throw (7 vitest cases).
- **C++ (header-only, KERNEL32-only, `-nostdlib`):** `log.hpp` (flush-on-write), `mem.hpp`
  (`Readable`/`VerifyBytes`/`ScopedUnprotect`), `fingerprint.hpp` (size + anchor gate), `coexistence.hpp`
  (Toolhelp adjuster enum), `patch_table.hpp` (`OnAttach` → gate → detect → verify-all → log).
- **Freestanding note:** `-nostdlib` + GCC still synthesizes `strlen`/`memset`/`memcpy`/`memmove` from loops, so
  `src/freestanding.cpp` provides them, built with `-fno-tree-loop-distribute-patterns` (else the impls become
  self-calls). Import table stays **KERNEL32.dll only** (8,192-byte `.asi`).
- **Fingerprint constant:** size 14,383,616 + 4 anchor byte-sequences at FILE offsets (IncludeEntity.entry,
  RemoveIpl read, LoadIplBoundingBox staticIdx, LoadScene store) — read from disk (see Wine test 1 below).
- **Adjuster detection:** module names matched case-insensitively — `fastman92` → FLA, `limitadjuster` → OLA.
  Reliability to confirm under Wine with the real modules loaded.

### Wine test 1 (2026-07-09) — found + fixed a fingerprint design bug

First on-device run logged: `fingerprint: anchor mismatch — UNSUPPORTED` at `RemoveIpl.firstBuilding`. Diagnosis:
the exe size + `IncludeEntity.entry` anchor matched (right exe, right base), only `RemoveIpl.firstBuilding` (a
mid-IPL-code byte) differed — because the user runs **FLA**, which patches that IPL code in MEMORY. The bug was
mine: I anchored the version fingerprint on bytes an adjuster legitimately patches, conflating "is this 1.0 US"
with "is this site pristine".

**Fix (shipped):**

- **Fingerprint now reads the exe on DISK** (file offsets, not runtime VAs) — `IsSupportedExe` opens the file,
  checks size + anchor bytes at file offsets. Immune to whatever FLA/OLA patched in memory. (`catalogue.ts`
  fingerprint anchors carry `fileOffset`; the generator emits a `FileAnchor` table.)
- **Site-verify reframed:** a patch site whose MEMORY bytes differ is not an error — it means an adjuster owns it,
  so we log "site differs — adjuster owns it (would DEFER)" and, in 004, skip it. Pristine sites are ours.
- **Bonus data for 004:** this run confirms the user's FLA patches `RemoveIpl` — so entry #1/#2's RemoveIpl hook
  must coexist with / defer to FLA there. Expect the RemoveIpl site to log "differs" on this install.

### Wine test 2 (2026-07-09) — PASS on the live modded install (`./1`)

Full success on the user's real install (FLA + OLA + ~30 ASIs: SilentPatch, ImprovedStreaming, ModelVariations,
CLEO, …). Log:

```
fingerprint OK — GTA:SA 1.0 US
adjuster present: fastman92 (FLA)
adjuster present: LimitAdjuster (OLA)
site pristine (would apply): IncludeEntity.entry / RemoveIpl.entry / LoadScene.store / LoadScene.count / LoadIplBoundingBox.staticIdx
all sites pristine — catalogue byte-accurate, safe to apply (004)
```

- exe confirmed byte-identical to the baseline (14,383,616 / `8c23ceff…`; all 4 disk anchors match).
- disk fingerprint immune to the FLA/OLA memory patches ✓; both adjusters detected ✓; all 5 sites pristine ✓.
- **004 coexistence finding (CORRECTED 2026-07-09).** Scanning the loaded `.asi`s: `$fastman92limitAdjuster.asi`
  references `0x404B4A`/`0x404B5D` (the firstBuilding/lastBuilding `movsx` reads) and `0x404C90` (IncludeEntity)
  — so FLA DOES touch the int16 instructions (hence the old memory-anchor mismatch there). **But the bug still
  reproduces on this FLA+OLA install** (user-confirmed) → FLA patches those reads for its OWN bookkeeping and does
  NOT widen the int16 STORAGE in `IplDef` (the `mov word[…],dx` writes still truncate; the 32,767 ceiling stays).
  Matches the post-mortem: "no limit adjuster exposes it."
  - **Therefore #1/#2 must ALWAYS apply — do NOT defer to FLA/OLA** (my earlier "defer" note was wrong; adjusters
    don't fix int16). Our sidecar reads/writes an int32 range and ignores the int16 fields entirely, so FLA's
    partial read-patches don't affect us — but both hook IncludeEntity, so 004 must handle hook **ordering**
    (FLA may install its hook after our DllMain; the site was pristine at our verify time).
  - **#3/#4** (array relocations) genuinely overlap FLA's "Inst entries per file" / "[IPL] Entity index array"
    options → those defer to FLA when present.
  - **Testing win:** the bug reproduces on the user's real `./1` install, so our #1/#2 fix can be validated there
    directly (no separate clean prefix needed for the int16 bracket).
