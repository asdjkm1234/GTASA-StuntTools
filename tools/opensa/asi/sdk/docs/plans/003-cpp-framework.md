# 003 — C++ framework extraction (`asi::`)

Part of the [asi/sdk chain](readme.md). Depends on 002. The load-bearing step: the C++ framework
moves into `asi/sdk/src/` under namespace `asi::`, the three inversions land, and perfect-map
becomes a consumer. **Referee: the rebuilt `.asi` against 001's baseline — byte-identical modulo
the PE header timestamp is the target; if the namespace/layout rename makes that unreachable, the
fallback is an identical verify-only site report + the unchanged KERNEL32-only import table + an
explained size delta, and this file's ledger names which was achieved.**

## Context

Coupling was measured at review (the architecture doc carries the classification): `mem.hpp`,
`hook.hpp`, `freestanding.cpp` and the Makefile move untouched; `log.hpp`, `coexistence.hpp`,
`dllmain.cpp` need one parameter (tag/filename); `patch_table.hpp`, `fingerprint.hpp`,
`config.hpp` need the inversions. The single-TU include model (one `dllmain.cpp` includes
everything; no separate SDK objects) is preserved — it is what keeps `-nostdlib` simple.

## Decisions

1. **Namespace `asi::`** for everything that moves (user verdict). Perfect-map payloads stay
   `pm::`/`pm::patches::`; generated constants stay `pm::gen` (002's namespace parameter).
2. **The plugin surface** (constraint 7 of the architecture): the SDK's attach lifecycle calls
   plugin-supplied pieces — the tag + log filename, the generated site table, the apply entry
   point. Concretely: `patch_table.hpp` loses `#include "apply.hpp"` and takes the plugin's apply
   function + table; `fingerprint.hpp` takes the fingerprint/exe constants as arguments instead of
   reading `pm::gen::` directly. The exact C++ mechanism (config header the plugin provides vs
   function parameters) is decided in-code, judged by: no SDK header names a plugin symbol.
3. **Config split:** framework knobs become `ASI_APPLY`/`ASI_DEBUG` (internal rename — the
   `make` / `make APPLY=1` / `make DEBUG=1` interface is unchanged); `PM_FIX_*`/`PM_*_LOG` stay in
   perfect-map's own config header.
4. **Makefile fragment:** `asi/sdk/mk/asi-plugin.mk` carries the toolchain, flags, link line and
   rules; perfect-map's Makefile shrinks to OUT name + payload defines + include. The fragment's
   `HDRS` globs BOTH the SDK headers and the plugin's `src/**/*.hpp` — fixing the latent
   staleness bug (perfect-map's `HDRS` missed `src/patches/*.hpp`).
5. **Hook-comment reword, not refactor:** `hook.hpp`'s comments name perfect-map sites; they
   become generic examples. Code untouched.

## Tasks

- [x] Move + rename per decisions 1–3; perfect-map's `src/` keeps `dllmain.cpp` (thin),
      `plugin.hpp` + `identity.hpp` (its declaration; `identity.hpp` arrived in 004), `apply.hpp`,
      `config.hpp` (payload half), `patches/`, `generated/`.
- [x] Makefile fragment (decision 4); perfect-map consumes it; `make`, `make APPLY=1`,
      `make DEBUG=1` and the per-fix `PM='-D…'` bisection all still work.
- [x] Referee run: build APPLY=1 + verify-only; compare against the baseline (import table, log
      strings, sizes).
- [x] `asi/perfect-map/docs/architecture.md` + `README.md` updated in the same change (the
      framework sections now point at the SDK); `asi/sdk/README.md` gains the consumer how-to.

## Verification

Both build modes green from perfect-map's thin Makefile; the referee's verdict recorded (target or
named fallback); no SDK header names a plugin symbol (grep); full suite + tsc + `eslint .` green.

## Measurements / notes

### Shipped (2026-08-06)

**Referee verdict: the FALLBACK, honestly.** Byte-identity was not reachable and was not expected
to be once the namespace moved: `asi::` renaming, the `Tagged()` split and the plugin indirection
all change codegen. What was proven instead, exactly as the plan's fallback specifies:

- **Import table IDENTICAL** — KERNEL32.dll only, the same 17 functions in the same order
  (`objdump -p`, diffed against 001's recorded list).
- **Log output preserved** — a sorted `strings` diff of the verify-only builds shows the ONLY
  structural change is that the `[perfect-map] ` prefix is now ONE deduplicated string written
  before each message instead of being inlined into all 17 of them; `Tagged()` writes tag+text, so
  the bytes reaching the log file are unchanged. Two DELIBERATE wording changes are recorded here
  so a future log diff has a key: `"(APPLY, plan 004)"` → `"(APPLY)"`, `"(verify-only, plan 003)"`
  → `"(verify-only)"`, and `"…safe to apply (004)"` → `"…safe to apply"` — plan-number references
  that no longer mean anything in a shared framework.
- **A real regression caught by that diff:** the first pass dropped the plugin tag from the four
  `KeyHex` summary lines (`sites pristine`, `sites total`, and the two DEBUG ones). Fixed with
  `Log::TaggedKeyHex` before the ledger was written.
- **Sizes** (pinned `SOURCE_DATE_EPOCH`, sha256 first 16): apply 17 920 B `3104cd5d45ab917c`
  (was 16 384); verify-only 10 752 B `fe18106d4f0e1991` (was 9 728); apply+debug 23 040 B
  `b74785bb6e3340b0`. Growth ≈ +1.5 KB / +1 KB, i.e. two 512 B PE pages either side: the extra
  per-line `Write` call at each log site and the plugin-table indirection cost more code than the
  deduplicated tag string saves. Both per-fix bisection builds (`PM_FIX_INT16=0` / `PM_FIX_FX2DFX=0`)
  link and produce distinct artifacts.

**Design change vs the plan, made when the compiler refused the first shape:** `plugin.hpp` first
handed the generated tables over with a `reinterpret_cast`, which is not a constant expression —
so `kTables` could not be `constexpr`. The better fix was upstream: the GENERATOR now emits the
tables as `asi::ByteAnchor`/`asi::FileAnchor` directly (`#include <asi/generated-tables.hpp>` in
the generated header) instead of declaring a parallel pair of structs. The cast, the layout
`static_assert`s and the drift risk all disappear — the plugin hands its tables over verbatim.
This is why 002's "header byte-identical" claim is superseded rather than upheld: the header is
better now, and the artifact-level A/B is the referee that matters.

**Layout:** SDK headers live at `asi/sdk/include/asi/*.hpp` (not `src/`), so a plugin's
`#include <asi/log.hpp>` is unambiguous with a single `-I<sdk>/include`; `src/` keeps only
`freestanding.cpp`. The Makefile fragment globs the SDK headers and appends the plugin's
`$(PLUGIN_HDRS)` — perfect-map's old `HDRS` missed `src/patches/*.hpp`, so a payload-only edit did
not trigger a rebuild, and its thin Makefile now lists both `src/*.hpp` and `src/patches/*.hpp`.
Note where the fix lives: the fragment cannot glob a plugin's tree for it, so **every plugin must
declare its own headers** — stated in the SDK README as the one silent-failure trap of the setup.

**A measurement trap worth keeping:** the first build-matrix run reported apply+debug as identical
to verify-only. The builds were fine — the HARNESS was wrong: **zsh does not word-split an
unquoted `$args`**, so `make -C … $args` passed `APPLY=1 DEBUG=1` as ONE argument and make set
`APPLY` to `"1 DEBUG=1"`, failing its `ifeq`. Caught by adding the compiled banner string
(`(APPLY)` vs `(verify-only)`) to the matrix output — a per-row verdict the size column alone
could not contradict. Use `${=args}` in zsh.

Suite 12 tests in `asi/`, full repo tsc + `eslint .` clean.
