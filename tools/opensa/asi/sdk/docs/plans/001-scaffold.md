# 001 — Scaffold & workspace wiring

Part of the [asi/sdk chain](readme.md). No dependencies — the chain's first step. Delivers the
workspace project every later plan builds inside, the widened repo wiring, and the BASELINE the
whole chain's referee measures against.

## Context

The `cleo/sdk` scaffold (its plan 001) is the template, which itself copied `asi/perfect-map`'s
shape. Differences here: the SDK ships no CLI and no `dist/` (it is a header/library project — its
consumers build the artifacts), so there is no "build command that reports zero"; the standing
green command is the CONSUMER's build (`npm run build:asi -w @opensa/perfect-map-asi`), which must
stay green through every step of the chain.

## Decisions

1. **Names as decided:** project `asi/sdk`, package `@opensa/asi-sdk` (`private: true`, nx tag
   `type:tool`), no per-package tsconfig, no declared dependencies (repo convention: one root
   tsconfig, workspace-wide resolution).
2. **The baseline is recorded now**, before anything moves: build perfect-map from the untouched
   tree and record `dist/perfect-map.asi`'s size + sha256 (APPLY=1 and verify-only both), plus the
   import-table listing (`objdump -p`). 003/004 diff against these numbers.
3. **Same-change doc alignments** (decided at review): the roadmap's `asi/common` wording
   (`docs/roadmap/0.5.0/plans/06-city-life/1-preparation/01-asi-clean-streets.md`) becomes
   `asi/sdk`; `docs/links.md`'s gta-reversed row is aligned to `gta-reversed-modern` (the repo the
   catalogue actually cites).
4. **Tests co-located** for the TS half (the `packages/` convention, as cleo chose and for the
   same reason: plain TS, no cross-compile boundary in the SDK's own test surface).

## Tasks

- [x] `asi/sdk/package.json`, added to the root `workspaces` list.
- [x] `asi/sdk/README.md` — layout, the why-root-not-tools line, pointers to
      `docs/architecture.md` and this chain.
- [x] Widen `vitest.config.ts` glob `asi/perfect-map/**/*.test.ts` → `asi/**/*.test.ts`; widen
      `eslint.config.ts` node-globals glob the same way.
- [x] Roadmap + links wording (decision 3).
- [x] Record the baseline (decision 2) in this file's ledger.
- [x] Meta-checks: root tsc, full `eslint .`, vitest, `npm run arch` (`asi-sdk` must land in the
      TOOLS subgraph — `scripts/arch-graph.ts` already classifies the `asi/` prefix, verify the
      render; revert any unchanged-source mermaid assets the render jitters).

## Verification

Full lint + typecheck + test run green with the empty project in the tree; `npm run build:asi -w
@opensa/perfect-map-asi` builds byte-for-byte what the baseline records (nothing moved yet);
`git status` clean after a build.

## Measurements / notes

### Shipped (2026-08-06)

- **The baseline needed a determinism fix first:** two consecutive untouched builds differed in
  6 bytes (PE/COFF + export-table timestamps), which would have made every later referee a
  mask-and-compare. Added `-Wl,--no-insert-timestamp` to perfect-map's `LDFLAGS` (zeroes the
  timestamps; behaviour-neutral) — identical sources now build byte-identical DLLs, and the
  chain's referee is a plain hash compare. The flag carries into the SDK's Makefile fragment.
  **Corrected by 002:** this verdict was incomplete — the banner's `__DATE__ __TIME__` still made
  builds second-granular, and 001's two probe builds had landed in the SAME second (an A/B with no
  run-order control). The referee protocol gained a pinned `SOURCE_DATE_EPOCH`; 002's ledger
  carries the superseding baseline hashes.
- **Baseline (post-flag, the chain's referee input):**
  - `make APPLY=1`: 16 384 B, sha256 `9d81a4b9c976050cbc726118f0f5d1f711cf2c6000ee62bdbfb1a27f65670a75`
  - `make` (verify-only): 9 728 B, sha256 `17cc66f90e5bf91152ad49ad97ee34b119bc0a5a370d20f358cc3007028265fc`
  - Import table: KERNEL32.dll ONLY — `CloseHandle CreateFileA CreateToolhelp32Snapshot
    DisableThreadLibraryCalls FlushFileBuffers GetFileSize GetModuleFileNameA GetModuleHandleA
    Module32First Module32Next ReadFile SetFilePointer VirtualAlloc VirtualProtect VirtualQuery
    WriteFile lstrcatA` (17 functions).
  - Toolchain: i686-w64-mingw32-g++ (GCC) 16.1.0, homebrew.
- Suite with the project in the tree: **429 files / 3 733 tests green** (unchanged — the SDK has
  no tests yet); root `tsc --noEmit` clean; full `eslint .` clean.
- `npm run arch:render`: `asi_sdk` in the TOOLS class of `packages.svg`; `runtime-packages.svg`
  untouched (the runtime picture does not see the SDK); `boot-flow.svg` jittered with no source
  change — reverted per the standing trap.
