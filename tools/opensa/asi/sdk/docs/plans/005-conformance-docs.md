# 005 — Conformance & docs sweep (chain close)

Part of the [asi/sdk chain](readme.md). Depends on 004. The proof that closes the chain and
carries the docs/ledger sweep — the `hello-conformance` role, played here by the migration itself.

## Context

cleo's 005 set the shape: the cheapest sufficient artifact proven end-to-end, verdicts of
increasing cost, the manual step recorded honestly until taken. For this chain the artifact is
`dist/perfect-map.asi` built through the SDK, and the verdict ladder is: (a) the build matrix +
referee diffs (done in 003/004), (b) the Wine dry-run on the real install — the verify-only log
must show the same site verdicts as the pre-SDK plugin, (c) the in-game int16 oracle (ghost
barriers stay gone on the 33k repro) — (b) and (c) are user-manual, and this file says so honestly
until they are taken.

## Decisions

1. **No new verdict machinery** — the existing ladder (dry-run log, FLA/OLA coexistence, the
   repro oracle) is the whole proof; the chain adds no test theatre around a manual step.
2. **Docs sweep in this plan, not later** (the cleo 005 discipline), including the graduated-idea
   trail: the research doc was drafted in `docs/ideas/asi-sdk/` and folded into this chain's
   architecture + plans before the first commit, so git never carried an ideas row to remove — the
   graduation left no trail to sweep, which is worth saying rather than implying one was cleaned up.
   The architecture/tools doc gains the
   SDK, and every doc that described perfect-map's framework as its own now points at the SDK.

## Tasks

- [x] Full meta sweep: root tsc, full `eslint .`, complete vitest run, `npm run arch:render`
      (revert unchanged-source assets — the mermaid jitter trap).
- [x] Wine dry-run (user-run 2026-08-06): **PASSED** — see the ledger.
- [x] APPLY run on the real install (user-run 2026-08-06): both fixes **APPLIED**, no defers.
- [ ] Behavioural oracle in-game (33k repro looked at): **PENDING**.
- [x] Docs: `docs/architecture/tools.md` (the asi section now describes sdk + consumers),
      `asi/perfect-map` docs cross-check, roadmap city-life plan points at `asi/sdk` (001), chain
      readme statuses, the architecture doc's Decided section confirmed against what shipped.
      `docs/commands.md` needed no change: `build:asi` / `build:verify` / `build:debug` / `gen`
      and the `make APPLY=1|DEBUG=1|PM='-D…'` knobs are all unchanged by the migration.
- [x] Ledger below + the chain readme's "what done means" confirmed line by line.

## Verification

Every chain plan's ledger is filled; the suite/tsc/lint are green at the closing commit; the
duplication list in the city-life roadmap plan is demonstrably dead (a second plugin writes only:
catalogue, payloads, config knobs, thin Makefile); the manual verdicts are either recorded or
explicitly pending.

## Measurements / notes

### Shipped (2026-08-06) — with one verdict honestly outstanding

**What a second plugin now writes**, measured by listing what is left in the consumer after the
migration (this is the chain's headline claim, and the city-life roadmap plan's copy-verbatim list
is dead):

| Consumer file | What it is |
| --- | --- |
| `gen/catalogue.ts` (+ its test) | its rows: addresses, expected bytes, provenance |
| `gen/generate.ts` | 20 lines calling the SDK renderer with its namespace + output path |
| `src/patches/*.hpp` | what its fixes actually do |
| `src/apply.hpp` | the `asi::ApplyFn` that runs them |
| `src/plugin.hpp`, `src/identity.hpp` | one `constexpr asi::Plugin`: tag, log file, tables, apply |
| `src/dllmain.cpp` | 18 lines: hand the plugin to `asi::OnAttach` |
| `Makefile` | 10 lines: `PLUGIN_OUT`/`SRC`/`HDRS`, then include the SDK fragment |

Everything else — the fingerprint gate, byte-verify, coexistence, hooks, both loggers, the attach
lifecycle, the freestanding CRT builtins and the whole cross-compile line — is the SDK's.

**Meta sweep:** full suite **430 files / 3 737 tests green** (was 429 / 3 733 pre-chain: **+1 file,
+4 tests** — the new file is the SDK's `gen/render.test.ts`; perfect-map's `gen/generate.test.ts`
survived as a file and was rewritten into catalogue tests. The count was first written here as
"431 / +2 files" — INFERRED from the diff instead of read off a run, and corrected on the closing
sweep. Read the number, never derive it); root `tsc --noEmit` clean;
full `eslint .` clean; `npm run arch:render` shows `asi_sdk` in the TOOLS subgraph with
`runtime-packages.svg` untouched (`boot-flow.svg` jittered with no source change — reverted).

**Artifact (the migration's product), pinned `SOURCE_DATE_EPOCH`:** apply 19 456 B sha256
`53397add32394e0d…`, verify-only 11 264 B `a46a779952467e37…`, import table KERNEL32-only, the
same 17 functions as the pre-SDK baseline. The five build modes (apply / verify-only / apply+debug
/ both per-fix bisections) all link.

### Wine dry-run — PASSED, user-run 2026-08-06

The verify-only build ran on the real modded install (FLA + OLA both present). The report is
exactly what the migration predicts, and the delta against the pre-SDK shape is only the three
anchors 004 added:

- **`sites total 0x0000000d` (13), `sites pristine 0x0000000a` (10)** — up from 10/7, and the
  three extra pristine sites are precisely the continuation anchors that moved from a hand-copied
  array in `int16.hpp` into the catalogue (`RemoveIpl.cont.404B54 / .404B63 / .404BAD`). They had
  NEVER been visible in a dry run before: pre-SDK they were checked only inside the apply path, so
  a verify-only build could not see them. The dry run gained real diagnostic reach.
- **The three differing sites are the expected ones** — `RemoveIpl.firstBuilding` (0x404B4A),
  `RemoveIpl.lastBuilding` (0x404B5D) and `RemoveIpl.lastBuilding.loop` (0x404BA8): the bound-read
  sites an adjuster jmp-hooks, exactly as the catalogue's own summary says ("FLA jmp-hooks the read
  sites → we overlay it; OLA leaves them stock"). Nothing unexpected differs.
- **The apply path is NOT blocked by that**, and this is the part a reader of the summary line
  could easily misread: the framework's dry run verifies EVERY catalogue site, while `ApplyInt16`
  gates on its own five — `IncludeEntity.entry`, `RemoveIpl.entry` and the three continuations —
  all of which report pristine here. That set is byte-for-byte the same five the pre-SDK code
  verified (compare `git show 7e3e378b:…/int16.hpp`'s `sites[]`), so the defer semantics are
  unchanged, not merely similar. `ApplyFx2dfx` gates on `FxSystem_c.Stop`/`.Play` — both pristine.
- Fingerprint gate passed on the canonical exe; both adjusters detected and named.

### APPLY run — both fixes applied on the real install, user-run 2026-08-06

```
[perfect-map] loaded — built Aug  6 2026 16:18:26 (APPLY)
[perfect-map] fingerprint OK — GTA:SA 1.0 US
[perfect-map] adjuster present: fastman92 (FLA)
[perfect-map] adjuster present: LimitAdjuster (OLA)
[perfect-map] int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32
[perfect-map] fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)
```

Both patches installed through the SDK framework with FLA and OLA present: the exe gate passed,
both adjusters were detected, every site the apply path gates on verified, and neither fix
deferred. The migration is therefore proven on the WRITE path, not only the read path — which is
the half a dry run structurally cannot reach.

**How this run was almost recorded wrong**, because it is the reason the banner carries a
timestamp AND a mode: the first log offered as the APPLY verdict was byte-identical to the dry-run
log — same `16:12:52 (verify-only)` banner. The game had loaded the OLD artifact; the new one had
not reached the install. A verify-only build patches nothing, so "the game runs fine" would have
been reported as "the fix works" on evidence that proves neither. **Read the banner's build time
and mode before reading anything else in an ASI log** — it is the only line that identifies which
file actually loaded.

**Still outstanding: the behavioural oracle** — the 33k repro (`tools-debug/sa-int16-repro`) looked
at in-game, confirming ghost barriers stay gone and particle 2dfx on LOD clones does not crash.
The log proves the bytes were WRITTEN; only the map proves they still do their job. Until that is
seen the chain is **code-complete, dry run and apply-path field-confirmed**, and this file says so
rather than rounding up.

### Post-chain review pass (same day)

Two independent audits were run over the finished chain — one on the docs, one on the code — and
both found things worth fixing. What they changed, so the review is part of the record rather than
a footnote:

**Two crash-class fragilities the extraction itself introduced**, both from moving data across a
package boundary and both now structural rather than conventional:

- *The trampoline continuation was a literal while the relocated LENGTH came from the catalogue.*
  `InstallNullBpGuard(Runtime(0x4aa390), Runtime(0x4aa396), …)` is only correct while
  `0x4aa396 - 0x4aa390` equals the site's `length`. Before the extraction the byte array sat six
  lines above the literal in the same file; afterwards the length lived in a `.ts` file edited by a
  different activity. Widening a catalogue byte window — the natural "make the verify stricter"
  edit — would have re-executed instructions on every call; shortening it would have returned into
  the middle of a half-overwritten instruction. Both the entry AND the continuation now derive from
  the site (`entry + site->length`).
- *`FindSite` results were dereferenced on names typed twice*, once in the verified array and once
  as a literal at the lookup. The verify guarantees the array's names exist; it says nothing about
  the literal. A half-completed rename would have null-dereferenced inside `DLL_PROCESS_ATTACH` —
  a crash before the main menu, in a plugin whose entire premise is "never write on a miss, always
  defer". The lookups now use the array elements, and a null check defers with a named line.

**A silent-corruption hole in the generator:** nothing rejected two sites sharing a NAME. Names are
`FindSite` keys, so a duplicate would hand a patch the wrong entry's bytes and address — and
verification could not see it, because the site it picked really is pristine. `validate()` now
rejects duplicate site names and duplicate fingerprint anchor names.

**Three tests added, each falsified before being trusted** (broken deliberately, watched fail,
restored): duplicate site names; the catalogue agreeing with the shared fingerprint wherever both
name the same site (the two tables now live in different packages and overlap on four names — a
one-nibble typo would otherwise reach the field); and every site name the payloads look up existing
in the catalogue. Suite 430 files / **3 741** tests.

**Build-mode honesty:** `make DEBUG=1` without `APPLY=1` produced a binary identical to a plain
verify-only build while advertising itself as a distinct mode — every debug switch is read inside
an APPLY build. It is now a hard `$(error)`. `PM_APPLY` was `#define`d unguarded, silently
overriding a command-line `-DPM_APPLY`; it is `#ifndef`-guarded like every other flag. The
bisection knob was renamed `PM` → `EXTRA_CXXFLAGS`, because a shared fragment must not reserve one
plugin's macro prefix.

**Docs that would have misled a reader**, all fixed: perfect-map's README called `build:asi`
(the SHIPPING build) "verify-only" — the precise confusion that cost this session an APPLY verdict
two hours earlier; its architecture doc's opening diagram still claimed the generator parses
markdown and the build static-links a CRT, both contradicted further down its own page; the three
perfect-map plans whose file paths the migration invalidated now carry a historical banner, and
this chain links back to them as promised; `docs/architecture/README.md`'s repo tree still showed
`asi/` with one member (and never had `cleo/`); `conflictsWith` read like coexistence behaviour and
is consumed by nothing. The SDK's "writing a plugin" section grew the steps it was missing
(workspace registration, `identity.hpp`, `.gitignore`, and the `PLUGIN_HDRS` trap where a forgotten
header means a payload edit does not rebuild).

**A restriction earned by this chain** was recorded where a future design will actually read it:
`docs/restrictions/sa-target.md` — an exe address or expected byte is declared once, in the
catalogue, never restated in a patch, and a trampoline's continuation is derived. It is the rule
perfect-map's own architecture doc had CLAIMED ("a hand-edited address is structurally
impossible") while seven hand-copied arrays sat in its payloads, three of them invisible to every
dry run.
