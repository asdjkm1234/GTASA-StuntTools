# perfect-map ASI

Our own `.asi` engine-patch for real **GTA:SA 1.0 US** that lifts the hard limits behind the
[ghost-barriers bug](../../docs/open-issues/fixed/ghost-barriers.md) — the int16 `IplDef` pool-index truncation plus
the three other unbounded placement structures — so perfect-map builds can add **unlimited** objects instead of
staying under the ≤30k-text-row / ≤39-slot work-around. `ProperFixes.asi` proves the fix is code-patchable but is
obfuscated + license-locked; we reverse-engineer it behaviourally and write our own patches from the decompiled
engine ground truth. Cross-compiled from macOS (MinGW-w64) to a Win32 PE DLL, tested under Wine.

> This is the repo's **first native/C++ artifact**; everything else is TypeScript/Nx. It lives under `asi/`
> (not `tools/`) because it is a compiled DLL, not part of the map-build pipeline.
>
> **It is now a CONSUMER of [`asi/sdk`](../sdk/README.md)** — the shared framework (exe fingerprint gate,
> byte-verify, adjuster coexistence, hooks, logging, the codegen library, the build rules). This project
> holds only its own catalogue, payloads, config knobs and a thin Makefile.

## Layout

- **[docs/architecture.md](./docs/architecture.md)** — the standing architecture (start here).
- **[docs/patch-catalogue.md](./docs/patch-catalogue.md)** — the frozen RE table: addresses, original bytes, and
  the fix per structure (plan 001, DONE for the four structures).
- **[docs/plans/readme.md](./docs/plans/readme.md)** — the 001–010 execution chain (RE → toolchain → framework →
  patches → test → pipeline integration; Phase 2 adds the 2dfx emitter fix).
- `src/dllmain.cpp` — the ASI entry, handing `pm::kPlugin` (`src/plugin.hpp`) to the SDK framework.
- `src/patches/` — the payloads (int16, fx2dfx); `src/generated/` — the emitted catalogue header.
- `Makefile` — thin: identity + payload flags, then `include ../sdk/mk/asi-plugin.mk`.

## Build (macOS → Win32)

```sh
brew install mingw-w64          # i686-w64-mingw32-g++ (once)
npm run build:asi    -w @opensa/perfect-map-asi   # SHIPPING: applies both fixes → dist/perfect-map.asi
npm run build:verify -w @opensa/perfect-map-asi   # DRY RUN: patches nothing, logs every site's verdict
npm run build:debug  -w @opensa/perfect-map-asi   # APPLY + the verbose site dump + this plugin's traces
```

The `.asi` is a 32-bit PE DLL with a **KERNEL32-only** import table (no CRT / MinGW runtime deps), so it drops
into any Windows SA runs on. On load it writes `perfect-map-asi.log` next to `gta_sa.exe`.

**Read that log's first line before anything else** — `built <date> <time> (APPLY|verify-only)` is the only
thing that identifies which artifact the game actually loaded, and a verify-only build writes no bytes at all.
Mistaking one for the other is how a dry run gets recorded as a working fix.

## Reproduction oracle

The bug's deterministic repro — the pass/fail gate for every patch here — ships separately as
**[`tools-debug/sa-int16-repro`](../../tools-debug/sa-int16-repro)** (the row-count dial + Wine detection oracle). Do
not re-derive a repro; brackets from that tool are the acceptance test for the limit patches (plan 004).

## Status

RE catalogue (001), toolchain + loading ASI (002), patch framework (003), and **fix #1 (004, the int16 ceiling)
are DONE and confirmed in-game** — `make APPLY=1` → `perfect-map.asi` removes the ghost-barriers bug on the 33k
repro with **both FLA and OLA** loaded (the chain's standing goal met). **The dummy half ([011](./docs/plans/011-ipldef-dummy-range.md)) shipped 2026-08-19** — the LOAD GAME crash at `0x00538103` is gone, the dummy pool's high-water freezes after the first world entry. Next: fixes #2/#3 array relocations (004b),
the Wine test ladder (005), and pipeline integration (006). See
[004](./docs/plans/004-limit-patches.md) + [patch-catalogue.md](./docs/patch-catalogue.md) (#1).
