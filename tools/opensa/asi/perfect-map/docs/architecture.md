# perfect-map ASI — architecture

The design for our own `.asi` engine-patch for real GTA:SA 1.0 US that lifts the hard limits behind the
[ghost-barriers bug](../../../docs/open-issues/fixed/ghost-barriers.md) (int16 `IplDef` pool-index truncation + three
more unbounded placement structures), so perfect-map builds can add unlimited objects instead of staying under
the ≤30k-text-row / ≤39-slot work-around. This document is the standing architecture; the numbered
[plans](./plans/readme.md) are the execution steps that fill it in. The reproduction oracle every step is
measured against ships separately as [`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro).

## Constraints (what shapes everything)

1. **Build on macOS, run on Win32.** Headless cross-compile to a 32-bit PE DLL — no Windows machine, no MSVC.
   The game already runs under **Wine**; that is the test/debug harness.
2. **Blind patching must be safe.** Every site is verified against known original bytes before a write; a
   mismatch skips that patch loudly instead of corrupting the process.
3. **Coexist, never conflict.** FLA/OLA already patch some zones (the FLA×OLA `LinkLods` double-patch is a
   documented crash). We patch ONLY what no installed adjuster covers.
4. **Version-locked.** SA 1.0 US (HOODLUM) only. Wrong fingerprint → patch nothing, log, return.
5. **Reversible & debuggable.** Every applied/skipped patch is logged to a file; a `dry-run` mode verifies all
   sites without writing.

## Two halves, one source of truth

The artifact is a native DLL, but the addresses come from RE (plan [001](./plans/001-reverse-engineering.md)) and
must never be hand-copied into C++. So the project is two cooperating halves:

```
gen/catalogue.ts ──▶ asi/sdk renderer ──▶ generated/patches.hpp ──▶ C++ compile ──▶ perfect-map.asi
 (typed, this project)  (validate+emit)     (addresses, original      (MinGW-w64,     (Win32 PE32)
                                             bytes, fingerprint)       -nostdlib)
```

- **TS half** (lives in the Nx/vitest world like every other tool): this project's typed `gen/catalogue.ts` is
  the machine source of truth — the prose [patch-catalogue.md](./patch-catalogue.md) is the human narrative and
  must agree with it, but nothing parses markdown. The renderer and validator are the SDK's
  (`asi/sdk/gen/`). Unit-tested on macOS, independent of the game: a malformed table is a hard error at
  generate time, not a garbage write at runtime.
- **C++ half**: the payloads plus a `DllMain` that hands this plugin to the **SDK framework**
  (`asi/sdk`, namespace `asi::`), which fingerprint-gates the exe from disk, byte-verifies every site,
  detects adjusters and logs. The framework is shared; what lives here is what makes this plugin *this*
  plugin.

## Directory layout

```
asi/perfect-map/
  docs/
    architecture.md          # this file
    patch-catalogue.md       # the frozen RE table (plan 001)
    plans/                   # the 001–010 execution chain (readme.md indexes it)
  src/
    dllmain.cpp              # entry → asi::OnAttach(pm::kPlugin)
    plugin.hpp               # this plugin's declaration: tag, log file, generated tables, apply fn
    identity.hpp             # the log filename + log tag, declared once (plugin.hpp + payload traces)
    config.hpp               # PAYLOAD switches (PM_FIX_*); the framework's own are asi/config.hpp
    apply.hpp                # the asi::ApplyFn — runs the enabled fixes
    patches/                 # one unit per engine fix (int16, fx2dfx)
    generated/               # patches.hpp — emitted by gen/, git-ignored, never hand-edited
  gen/                       # TS half: catalogue.ts (this plugin's rows) → generate.ts (SDK renderer)
  Makefile                   # thin: identity + payload flags, then include ../sdk/mk/asi-plugin.mk
  package.json               # npm scripts: gen, build:asi (gen + make), clean
  README.md
```

**The framework half now lives in [`asi/sdk`](../../sdk/README.md)** (`asi::` — log, mem, hook,
fingerprint, coexistence, patch_table, the codegen library, the Makefile rules). What stays here is what
makes this plugin *this* plugin: its catalogue, its payloads, its config knobs and a thin Makefile. See the
SDK's [architecture](../../sdk/docs/architecture.md) for the framework's own design.

## Runtime lifecycle (C++)

`DllMain(DLL_PROCESS_ATTACH)` — the whole story:

1. **Open the log** next to `gta_sa.exe` (`perfect-map-asi.log`), flush-on-write so a crash still shows the last
   attempted patch.
2. **Fingerprint** the exe — read **from DISK** (`GetModuleFileNameA` + `CreateFileA`): exact file size plus
   the anchor bytes at their FILE offsets, so an adjuster that has patched memory cannot spoof the version.
   Not 1.0 US → log which check failed, patch nothing, return.
3. **Detect adjusters** — enumerate loaded modules (FLA `fastman92limitAdjuster*`, OLA
   `III.VC.SA.LimitAdjuster`) and record the mask.
4. **Verify, then apply.** A verify-only build walks every generated site
   (`asi::ByteAnchor { name, address, bytes, length }`) and logs `pristine` / `differs — adjuster owns it`
   with zero writes. An APPLY build calls this plugin's `ApplyPatches`, and each fix byte-verifies the sites
   it NAMES (`asi::VerifySitesOrDefer`) before writing under a `VirtualProtect` RAII guard. A fix that cannot
   verify defers; one deferral never aborts the others (partial safety).
5. Return. That is the entire lifecycle — no per-frame hooks unless a specific fix demands one.

## The patch framework (003)

- **Declarative records**, generated — a hand-edited address is structurally impossible.
- **Prefer data-relocation over instruction hooks.** For the too-small static arrays (`gpLoadedBuildings` 4096,
  `IplEntityIndexArrays` 40), relocate to our own allocation + repoint accessors rather than detour code. Reserve
  function hooks (`asi/sdk/include/asi/hook.hpp`) for genuine logic changes — chiefly the `IplDef` int16 →
  int32 min/max widen in `CIplStore::IncludeEntity` (0x404C90), which since 011 (2026-08-19) covers BOTH
  pairs — buildings (+0x22/+0x24, three detours in `RemoveIpl`) and dummies (+0x26/+0x28, two detours) —
  from one observer and one snapshot hook, each half behind its own flag (`PM_FIX_INT16`, `PM_FIX_INT16_DUMMY`).
- **Observable before it is anything else.** The verify-only build logs the full plan with zero writes — the
  primary debugging aid for blind patching. (Re-apply protection is structural rather than a post-patch
  signature: a second attempt finds the site already changed and defers.)

## Toolchain

**The toolchain belongs to [`asi/sdk`](../../sdk/README.md)** (`mk/asi-plugin.mk`); this Makefile sets only
the output name and the payload flags. What it resolved, against what plan 002 originally sketched:

- **Cross-compiler: MinGW-w64 `i686-w64-mingw32-g++`** (SA is 32-bit / i386). The Zig fallback
  (`zig cc -target x86-windows-gnu`) was documented in 002 and never needed.
- **`-nostdlib`, NOT a static CRT.** 002 expected `-static -static-libgcc -static-libstdc++`; that still
  pulled `api-ms-win-crt-*` (UCRT), absent on the XP-era Windows SA runs on. The build links no CRT at all and
  supplies `memset`/`memcpy`/`memmove`/`strlen` itself (`asi/sdk/src/freestanding.cpp`), with the raw
  `_DllMain@12` entry. **Import table: KERNEL32 only** — 17 functions, verified per build.
- **Hooks: self-authored, no vendored dep.** injector.hpp was REJECTED (it pulls `<cstdio>`/gvm and breaks
  `-nostdlib`); `asi/sdk/include/asi/hook.hpp` is the ~120-line replacement (`WriteJmp`, `AllocExec`, three
  trampoline shapes). There is no `third_party/`.
- **Loads via** Ultimate ASI Loader / modloader, like every other `.asi`.

## Testing strategy

- **macOS unit tests (vitest)** cover the TS half: this plugin's tests pin the catalogue (real render, the
  provenance convention, the fingerprint values); the malformed-catalogue → hard-error cases belong to the
  SDK's renderer (`asi/sdk/gen/render.test.ts`). This is where correctness of the addresses/bytes is
  machine-checked before they ever reach the game.
- **Wine boot ladder** (plan 005): empty-but-loading ASI writes its banner → dry-run logs the full plan → real
  apply on a stock exe boots → FLA-present defers overlaps → wrong-version patches nothing.
- **The oracle**: [`tools-debug/sa-int16-repro`](../../../tools-debug/sa-int16-repro) `--rows N` brackets — patched
  build must show **no 2^15 flip at any N** (the acceptance test for plan 004).

## Decided

- **Artifact + log tag: `perfect-map.asi` / `[perfect-map]`.**
- **Toolchain: MinGW-w64** (`i686-w64-mingw32-g++`, brew), **plain Makefile** wrapped by `npm run build:asi`.
  Link with `-nostdlib -Wl,--entry,_DllMain@12 -lkernel32` to keep the import table KERNEL32-only (plan 002).
- **TS-generator ↔ C++ boundary** — the machine source of truth is a typed **`gen/catalogue.ts`** (not the prose
  `docs/patch-catalogue.md`); the generator emits **data only** (fingerprint + byte-verify anchors) into
  `generated/patches.hpp`. The per-patch `apply` logic is hand-written C++ in `src/patches/` (004) — a table
  can't express a sidecar hook or an array relocation (plan 003).
