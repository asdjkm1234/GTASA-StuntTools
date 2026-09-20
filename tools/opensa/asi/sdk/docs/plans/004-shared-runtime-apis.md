# 004 — Shared runtime APIs (the duplicates die)

Part of the [asi/sdk chain](readme.md). Depends on 003. The only step that intentionally CHANGES
payload code, so its referee is verdict-level, not byte-level: the build-mode matrix compiles, the
verify-only site report is unchanged, and the behavioural confirmation rides 005's Wine/field
step.

## Context

Both payloads hand-rolled the same two things the framework didn't offer: a runtime append-logger
(the framework `Log` closes at the end of attach, before hooks fire — so `int16.hpp` grew
`DbgItoa`+`DbgAppend` and `fx2dfx.hpp` grew `PmFxDeadSystemLog`, near-duplicate
CreateFileA/itoa/WriteFile code), and a verify-my-sites-or-defer loop with the site bytes
HAND-COPIED out of the generated table — violating the no-hand-edited-address rule
(`asi/perfect-map/docs/architecture.md`'s own "declarative records" claim). This plan makes the
SDK offer both, and routes the hand-copied continuation anchors through the catalogue.

## Decisions

1. **`asi::AppendLog`** — reopen-append logger + decimal/hex formatters, usable from a live hook.
   Both payloads' private loggers are deleted in favour of it.
2. **`asi::VerifySitesOrDefer(log, sites, count, tag)`** — the shared loop; a payload states
   WHICH sites, never re-declares their bytes.
3. **Continuation anchors become catalogue sites.** The byte arrays payloads hand-declared
   (`kIncludeEntry`, `kRemoveIplEntry`, the `kCont*` continuation bytes, fx2dfx's equivalents)
   move into `gen/catalogue.ts` entries and flow through the generated header. The generated
   header GROWS — that is expected and outside 002's byte-identity claim (banked and closed).
4. **Behaviour-preserving by construction:** same checks, same order, same defer policy, same log
   *verdicts* (message wording may carry the shared tag format; the ledger records any wording
   drift so a log-diff in 005 has an honest key).

## Tasks

- [x] Decisions 1–2 in `asi/sdk/include/asi/` (`append-log.hpp`, `verify.hpp`); payload duplicates
      deleted.
- [x] Decision 3: catalogue entries + regenerated header; payloads name their sites and take the
      bytes from the table; grep proves no verification byte array remains in `src/patches/`.
- [x] Referee: the apply-path defer semantics are unchanged; APPLY=1 + DEBUG=1 + both `PM_FIX_*`
      bisection combos compile and link; sizes recorded.
- [x] Suite + tsc + `eslint .` green.

## Verification

No hand-declared address or expected-byte literal survives in payload code (grep with the ledger
listing the hits before/after); the verify-only report is unchanged; every build-mode combination
links with the KERNEL32-only import table intact.

## Measurements / notes

### Shipped (2026-08-06)

- **The duplicates are gone.** `asi::AppendLine/AppendLabelled/AppendCount/AppendInt` replace two
  near-identical hand-rolled append-loggers (int16's `DbgItoa`+`DbgAppend`, fx2dfx's
  `PmFxDeadSystemLog` — ~60 lines of CreateFileA/itoa/WriteFile between them, now ~4 lines of
  call). `asi::VerifySitesOrDefer` + `asi::FindSite` replace two copies of the verify loop.
- **No hand-copied verification bytes left** (`grep "constexpr uint8_t k"` in `src/patches/`:
  7 arrays before — `kIncludeEntry`, `kRemoveIplEntry`, `kCont404B54/63/AD`, `kFxStopEntry`,
  `kFxPlayEntry` — **0 after**). The three continuation anchors are now catalogue entries, so the
  generated site table grew **10 → 13**, and the dry-run report covers them too. Where a patch
  needs the actual bytes (the relocated prologue handed to `HookObserve1Cont` /
  `InstallNullBpGuard`) it reads them from the table via `FindSite`, so there is exactly one
  declaration of every byte.
- **Residual, recorded rather than silently widened:** three inline `tail[]` arrays remain in
  `int16.hpp` — the stock instructions the detour re-emits after the 5-byte jmp clobbers them
  (`mov ecx,[0xB74498]` at 0x404B4E, `cmp edi,edx`). They are EMITTED code, not verification
  baselines, and they sit at addresses the catalogue does not currently anchor. Moving them in
  would change what the patch defers on, which this chain forbids — it is a follow-up for whoever
  next touches the int16 patch, not a 004 task.
- **A diagnostic regression caught before the ledger:** the first `VerifySitesOrDefer` returned at
  the FIRST differing site, while the old int16 loop reported EVERY miss and dumped the bytes found
  instead. For a blind patcher that dump is the diagnosis (it is how "FLA owns 0x404B4A, OLA owns
  0x404B54" was learned in the first place). The shared version now checks all named sites and
  dumps `found[0..3]`/`found[4..7]` per miss — parity restored, and every future plugin inherits it.
- **The plugin surface gained an argument:** `ApplyFn` is now
  `void(Log&, const Plugin&, unsigned)` — a patch needs its own tables to verify by name. Its
  identity strings moved to `src/identity.hpp` (`kLogFile`, `kTag`), so the log filename is
  declared once and the payload traces reopen the same file.
- **Build matrix** (pinned `SOURCE_DATE_EPOCH`, sha256 first 16, banner-verified per row):
  apply 19 456 B `53397add32394e0d` · verify-only 11 264 B `a46a779952467e37` · apply+debug
  25 088 B `aa618e4500bb14d4` · int16-only 17 408 B `d08ee999d22e5f55` · fx2dfx-only 13 824 B
  `1cc0a9068e2d821c`. Import table unchanged (KERNEL32, the same 17 functions).
- Sizes grew again (apply 17 920 → 19 456 B) — the added coverage is real work: 3 more verified
  sites in the table, the per-miss found-bytes dump, and `FindSite`'s name comparison.
- Suite 12 tests in `asi/`; tsc + full `eslint .` clean.
