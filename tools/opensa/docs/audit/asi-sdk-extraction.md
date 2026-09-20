# Audit — `asi/sdk`: extracting the ASI framework out of perfect-map (2026-08-06)

The `asi/` root category became what `cleo/` already was: a shared **SDK** plus **consumers**.
`asi/perfect-map`'s framework half moved into `asi/sdk` under namespace `asi::`, and perfect-map
became its first consumer. Chain and per-step ledgers: [`asi/sdk/docs/plans/`](../../asi/sdk/docs/plans/readme.md)
(001–005); standing design: [`asi/sdk/docs/architecture.md`](../../asi/sdk/docs/architecture.md).

**Why it was worth doing rather than copying again:** the roadmap's `asi/city-life` plan already
listed what it would copy verbatim from perfect-map — the Makefile and link flags,
`freestanding.cpp`, `log/mem/hook/fingerprint/coexistence`, and the whole codegen with its tests.
That list is now dead. The stronger argument was that the duplication had already started INSIDE
perfect-map: both payloads had hand-rolled the same runtime append-logger and the same
verify-sites-or-defer loop, the second with the site bytes hand-copied out of the generated table —
breaking perfect-map's own "a hand-edited address is structurally impossible" rule.

## What it cost

| | Before (5cbdbdd) | After |
| --- | --- | --- |
| perfect-map source (`.hpp/.cpp/.ts/.mk`, excl. generated) | 1 499 lines / 16 files | 705 lines / 11 files |
| `asi/sdk` | — | 1 103 lines / 17 files |
| Total | 1 499 | 1 808 (+309) |

The +309 is the seam and the two APIs that did not exist before: `plugin.hpp` +
`generated-tables.hpp` (the framework/plugin boundary), `verify.hpp` and `append-log.hpp` (what the
payloads used to duplicate), `identity.hpp`, and the SDK's own `render.test.ts`. Nothing was
copied — every framework file moved once (`git log --follow` still traces them).

Of perfect-map's remaining 705 lines, **497 are its own subject matter** (the two payloads + the
catalogue) and **179 are the seam** (`plugin.hpp`, `identity.hpp`, `apply.hpp`, `config.hpp`,
`dllmain.cpp`, `gen/generate.ts`, `Makefile`). That 179 is the true price of a second plugin's
boilerplate.

Suite: 429 files / 3 733 tests → **430 / 3 737** (+1 file, +4 tests — the SDK's renderer tests;
perfect-map's test file survived and was rewritten into catalogue tests). tsc and full `eslint .`
clean throughout. Artifact: apply 19 456 B, verify-only 11 264 B, import table **KERNEL32 only, the
same 17 functions** as before the migration.

## What it bought

- **A second plugin writes four things** — its catalogue, its payloads, its config knobs and a thin
  Makefile — plus ~179 lines of seam. Everything else (exe fingerprint gate read from disk,
  byte-verify, FLA/OLA coexistence, hook shapes, both loggers, the attach lifecycle, the
  freestanding CRT builtins, the whole cross-compile line) is inherited.
- **Three structural inversions** that were latent defects, not stylistic: `patch_table.hpp` no
  longer includes a payload header (a framework file including `apply.hpp` was the old shape);
  `fingerprint.hpp` takes the generated table instead of reaching into `pm::gen::`; framework flags
  (`ASI_APPLY`/`ASI_DEBUG`) split from payload flags (`PM_FIX_*`).
- **The no-hand-edited-address rule is now true.** Seven hand-copied byte arrays in the payloads
  went to zero; the three RemoveIpl continuation anchors became catalogue entries, so the generated
  site table went **10 → 13** and a dry run now verifies them too — they had never been visible in
  a verify-only build before, because only the apply path checked them.
- **A build that can be A/B'd at all.** `-Wl,--no-insert-timestamp` plus a pinned
  `SOURCE_DATE_EPOCH` makes identical sources produce byte-identical DLLs; the referee for the
  whole chain was a plain hash compare.
- **A generator that emits the framework's own types** (`asi::ByteAnchor`/`FileAnchor`) rather than
  a parallel pair of structs — no cast, no layout `static_assert`s, no drift risk.

## The verdict, and what is not proven

Field-confirmed on the real modded install (FLA + OLA both loaded): the **dry run** reported 10 of
13 sites pristine, the three differing being exactly the adjuster-owned bound reads the design
overlays on purpose; the **APPLY run** installed both fixes with no defers (`int16 APPLIED` +
`fx2dfx APPLIED`). Byte-identity of the artifact was NOT achieved and was never expected once the
namespace moved — the honest fallback (identical import table, preserved log output, explained size
delta) is recorded in 003's ledger.

**Outstanding: the behavioural oracle** — the 33k repro looked at in-game (barriers still gone,
particle 2dfx on LODs still not crashing). The logs prove the bytes were written; only the map
proves they still do their job.

## No benchmark entry, deliberately

[`docs/benchmarks/`](../benchmarks/index.md) carries two families — what a frame costs, and what a
car does. An `.asi` is a build-time artifact that runs inside a different executable and has no
frame budget in this engine, so its sizes would mix schemas rather than join one. The artifact
sizes and hashes live in the chain's per-step ledgers, which is where a future A/B will look.

## What the post-chain review found

Two independent audits (docs, code) were run over the finished chain rather than trusting it. They
were worth their cost: the extraction had introduced **two crash-class fragilities** — a trampoline
continuation left as a literal while the relocated length moved to another package, and `FindSite`
results dereferenced on names typed twice — plus a **silent-corruption hole** in the generator
(nothing rejected two sites sharing a name, which is a lookup key). All three are now structural,
with three tests added and each falsified before being trusted. The docs pass found that
perfect-map's README called the SHIPPING build "verify-only" — the exact confusion that had cost
this session an APPLY verdict hours earlier. Detail: 005's ledger, "Post-chain review pass".

The lesson for the next migration: **a clean build, a green suite and a passing field run say
nothing about the invariants an extraction quietly moved across a package boundary.** Every one of
these findings was in code that compiled, tested and ran correctly.

## Three method lessons this rework paid for

1. **The measurement rig failed more often than the thing measured.** A build matrix reported
   apply+debug as identical to verify-only; the builds were fine — zsh does not word-split an
   unquoted `$args`, so `make` received one argument and set `APPLY` to `"1 DEBUG=1"`. It was caught
   only by adding a per-row verdict from a different channel than the size column (the compiled
   banner string). A determinism verdict in 001 was likewise wrong because both probe builds landed
   in the same second.
2. **When extracting shared code, diff what the old code REPORTED, not only what it did.** The
   shared verify loop was behaviour-correct and silently dropped the found-bytes dump and the
   report-every-miss behaviour — the diagnosis, not the logic.
3. **A number in a ledger is read off a run, never derived from the diff.** The suite count was
   first written as 431 (+2 files) by addition, and measured 430 (+1) on the closing sweep.
