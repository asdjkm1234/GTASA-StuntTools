# asi/sdk — architecture

The common base for authoring `.asi` plugins, extracted from `asi/perfect-map`'s framework half.
`asi/` is a root category (outside `packages/` and `tools/`) because its projects AUTHOR runtime
content rather than building the map — the same sentence that earned `cleo/` its place, and the
`cleo/sdk` + `cleo/scripts` split is the shape this project mirrors (which itself copied
`asi/perfect-map`'s scaffold: the formalisation returns to its source).

Consumers: `asi/perfect-map` (first, the migration is the proof), `asi/city-life` (named second,
roadmap 0.5.0).

## Constraints (inherited from perfect-map, now SDK-owned)

1. **Build on macOS, run on Win32** — MinGW-w64 cross-compile, headless.
2. **Blind patching must be safe** — mandatory byte-verify before every write; a site whose bytes
   differ is not an error, it means an adjuster owns it → defer.
3. **Coexist, never conflict** — FLA/OLA detection via module enumeration.
4. **Version-locked** — the ONE accepted exe (14 383 616 B, SHA1 `8c23ceff…`, `.HOODLUM`), gated
   from DISK so a memory-patching adjuster cannot invalidate the identity check.
5. **Reversible & debuggable** — flush-on-write log, dry-run mode (verify-only build).
6. **`-nostdlib`, KERNEL32-only imports** — no CRT dependency; `freestanding.cpp` supplies
   `memset`/`memcpy`/`memmove`/`strlen`.

Two constraints the SDK adds:

7. **The framework may never include a payload.** Perfect-map's `patch_table.hpp` included
   `apply.hpp`; the SDK inverts that into a plugin-supplied surface.
8. **No hand-edited address.** Every address and expected byte flows through the plugin's typed
   catalogue and the generated header — including trampoline continuation anchors, which the old
   payloads hand-copied.

## The two halves

```
plugin's gen/catalogue.ts ──▶ sdk renderHeader()+validate() ──▶ plugin's src/generated/patches.hpp
                                                                        │
sdk include/asi/*.hpp + plugin src/patches/*.hpp ──▶ single-TU compile ──▶ dist/<plugin>.asi
```

**TS half (`asi/sdk/gen/`)** — the codegen library: the catalogue interfaces (`ByteAnchor`,
`FileAnchor`, `Fingerprint`, `CatalogueEntry` with its provenance line), `renderHeader()` (namespace
is a parameter — perfect-map passes `pm`; it validates as a hard-error gate before emitting anything —
module-private, not a second entry point), and the shared
`SA_FINGERPRINT` constant — the canonical exe identity every SA plugin reuses. The `CATALOGUE`
array (the addresses, bytes and strategies) stays per-plugin.

**C++ half (`asi/sdk/include/asi/`, namespace `asi::`; plus `src/freestanding.cpp`)** — `mem.hpp`,
`hook.hpp`, `freestanding.cpp` (moved verbatim); `log.hpp`, `coexistence.hpp` (parameterised by the
plugin tag/filename);
`fingerprint.hpp` (algorithm with the table injected, never reached into); `patch_table.hpp` (the
attach lifecycle: open log → exe gate → adjuster detect → verify/apply or dry-run); the runtime
append-logger and `VerifySitesOrDefer` (the two APIs both old payloads duplicated by hand); the
framework config knobs (`ASI_APPLY` / `ASI_DEBUG`). The Makefile template (cross-compile flags,
link line, the `make APPLY=1` / `DEBUG=1` interface) ships as an includable `mk/` fragment.

**The plugin surface** — what a consumer supplies: its tag and log filename, its generated site
table, its apply entry point, its payload config knobs (`PM_FIX_*` for perfect-map). Everything
else — lifecycle, gating, verification, deferral policy plumbing — is SDK. The single-TU include
model is preserved (one `dllmain.cpp` includes the SDK and the payloads; there is no separate
compilation or linking of SDK objects).

## Namespaces

`asi::` — the SDK (user verdict 2026-08-06). Plugins keep their own (`pm::` for perfect-map's
payloads and generated constants; the generated namespace is a generator parameter). Framework
macros are `ASI_*`; plugin macros stay plugin-prefixed.

## Testing strategy

- **TS half:** co-located vitest (`asi/**/*.test.ts` glob) — synthetic-fixture validation tests
  are the SDK's; "renders the real catalogue" stays each plugin's.
- **The migration referee:** perfect-map rebuilt through the SDK must be demonstrably the same
  plugin — generated header byte-identical; artifact byte-identical modulo the PE header
  timestamp, or (where renames make that unreachable) identical dry-run verdicts + the unchanged
  KERNEL32-only import table, with the fallback named in the ledger.
- **Behavioural oracle:** `tools-debug/sa-int16-repro` and the Wine ladder — external, partly
  manual, recorded per plan honestly.
- **No C++ unit lane** — unchanged from perfect-map (its plan 005's open question, not smuggled
  in here).

## The cleo mirror, honestly asymmetric

| cleo/sdk leg | asi/sdk equivalent |
| --- | --- |
| Vendored Sanny DB (pinned, drift-tested) | none — gta-reversed is a human's RE map, nothing reads it programmatically; the referee is the exe itself (catalogue bytes verified on disk at every attach). Replaced by a per-entry provenance line (file/function + commit consulted) |
| Decoder-as-referee (corpus re-encode) | the migration itself + byte-verify anchors + dry-run + the int16 oracle |
| Dual-target whitelist | none — an `.asi` has ONE target (the canonical exe); the gate is the fingerprint + per-site verify |
| hello-conformance | perfect-map, rebuilt through the SDK, proven unchanged |

## Directory layout

```
asi/
  sdk/                      this project (@opensa/asi-sdk, private, nx type:tool)
    docs/                   this file + plans/ (the 001–005 chain)
    gen/                    TS codegen library + its tests
    include/asi/            C++ framework headers (asi::), included as <asi/...>
    src/                    freestanding.cpp (the -nostdlib CRT builtins)
    mk/                     the includable Makefile fragment
  perfect-map/              first consumer: catalogue + payloads + thin Makefile + its own docs
```

## Decided

- **Name `asi/sdk`**, not the roadmap's `asi/common` (user verdict 2026-08-06 — consistency with
  `cleo/sdk`; the roadmap wording is updated by the scaffold plan).
- **Namespace `asi::`** (user verdict 2026-08-06).
- **Scope: full SDK, not the pure move the roadmap sanctioned** — justified by duplication already
  live INSIDE perfect-map (both payloads hand-rolled an append-logger and the
  verify-sites-or-defer loop with hand-copied site bytes, violating the no-hand-edited-address
  rule). Verdict: move + the interface inversions + the two shared APIs.
- **gta-reversed is NOT pinned or vendored** — a pin without a machine consumer enforces nothing,
  the exe-side verification is the real referee, and a decompilation of Rockstar's code is not an
  artifact to vendor. Replaced by the provenance convention above.
- **Design-for but do not build** city-life's known needs (per-frame tick hook, runtime `.ini`):
  the plugin surface must not preclude them; they arrive with that plugin.
- **Perfect-map's framework history stays in `asi/perfect-map/docs/plans/`** — moving shipped plan
  files would break deep links from `docs/open-issues/fixed/*` and the roadmap. The framework was
  designed and built there, by
  [002 — toolchain](../../perfect-map/docs/plans/002-toolchain-architecture.md) (the `-nostdlib`
  KERNEL32-only line, the rejected injector.hpp),
  [003 — patch framework](../../perfect-map/docs/plans/003-patch-framework.md) (the fingerprint
  gate, byte-verify, coexistence, the logger — and the Wine round that moved the gate from memory
  to disk) and [004 — limit patches](../../perfect-map/docs/plans/004-limit-patches.md) (the hook
  primitives). Each of those three carries a banner saying its file paths are pre-migration; read
  them for WHY the framework is shaped this way, and this chain for where it lives now.
- **No root-numbered plan** — the chain is project-local only (user's call, 2026-08-06), matching
  `asi/perfect-map` itself; `docs/plans/README.md` does not index `asi/` chains.
- **No behaviour change to perfect-map in this chain** — a framework "improvement" that changes a
  verdict is a failed migration.
