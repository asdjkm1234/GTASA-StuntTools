# 005 — hello-conformance (the end-to-end proof)

Part of the [cleo/sdk chain](readme.md). Depends on [004](004-dsl-builder.md) (the full pipeline).
Delivers the first AUTHORED script and the four verdicts that close the chain — plus the docs and
ledger sweep that makes the SDK a finished feature rather than a working pile.

## Context

Root-plan decision 5: the conformance proof is a minimal script, not a corpus rewrite. One tiny
`.cs` that a human can hold in their head end-to-end is worth more as evidence than a big one:
every byte of it is explainable, so any divergence between runtimes is attributable. The script is
also the SDK's living documentation — the example every future script (city-life included) starts
from.

## Decisions

1. **The script:** `hello-conformance` — `SCRIPT_NAME`, a `wait`-paced loop printing a periodic
   `0ACD PRINT_STRING_NOW`, clean termination (`004E`) after a fixed number of iterations. Dual
   target (no `opensa-only` flag), tiny declared budget (tens of instructions per tick, far under
   rhino's ~2 000 calibration point).
2. **Four verdicts, in order of increasing cost:**
   a) assemble → decode → disasm LISTING SNAPSHOT committed;
   b) headless STORY TEST on the VM — the print appears on schedule, the thread terminates, the
      measured instructions/tick is within the declared budget;
   c) FIELD boot — hand-place the artifact into `build/original/opensa/cleo/`, boot `?cleo=1`,
      census line +1, the print visible on screen;
   d) REAL CLEO under Wine — MANUAL, the user's harness; recorded in the ledger WHEN taken, with
      the exact exe/CLEO version. Until then the dual-target claim rests on the whitelist + the
      corpus-proven format, and this file says so honestly.
3. **Hand-placing is acceptable HERE** (a conformance artifact, not a shipping mod); if an authored
   script ever ships with the game build, it goes through the installers and
   `docs/contracts/mods.md` like any other CLEO mod — explicitly out of this plan's scope.
4. **Docs sweep in the same change** (the CLAUDE.md maintenance rules, applied once at the chain's
   close): `docs/features/cleo.md` gains the SDK state row; `docs/commands.md` already carries the
   build command (001) — verify it still matches; the chain readme's ledger updated with this chain's
   outcome (it was `docs/plans/097-cleo-basic/08-authoring-sdk.md` until the 2026-08-12 move);
   `docs/architecture/cleo-scripts.md` gains the SDK as
   a producer arrow (+ re-render the diagram) — the module map pointer goes to
   `cleo/sdk/README.md`.

## Tasks

- [x] `cleo/scripts/hello-conformance/script.ts` + `story.test.ts` (5 prints on schedule, clean
      termination, budget assertion via `runner.instructionsLastTick`).
- [x] Listing snapshot committed (inline, verified by hand); deterministic build (test + CLI
      double-run). Cross-checked with the standalone `scm-disasm` debug tool.
- [x] Field boot (headless harness, this session) — verdict + numbers in Measurements.
- [x] Real-CLEO Wine run — **PASSED, user-confirmed 2026-08-06** (verdict in Measurements).
- [x] Docs sweep: `docs/features/cleo.md` SDK row, `docs/architecture/cleo-scripts.md` + diagram
      re-rendered, 097/08 ledger closed, chain readme statuses.
- [x] Ledger below.

## Verification

All four verdicts recorded (or the manual one explicitly deferred); the full suite green; the docs
sweep landed in the same change. The chain's "done" definition in [readme.md](readme.md) holds.

## Measurements / notes

### Shipped (2026-08-06)

- **Artifact:** `hello-conformance.cs`, 88 bytes (76 code + 12 trailer), 10 instructions; sha1
  `a5c253f990762e7dc03c37f54fdc6d809683ea60`; byte-identical on rebuild (CLI double-run + test).
- **Headless story:** 5 prints at 1 Hz, thread terminates, zero faults. Cost: worst
  **7 instructions/tick**, avg 0.10 — declared budget 50, VM ceiling 10 000 (rhino's measured
  ~2 085 for scale).
- **Field verdict (headless harness, ?loader=http-dir over the canonical build):** census
  `[cleo] 7 script(s)` with `hello-conformance.cs` listed (+1 over the six shipped mod scripts);
  the `HELLO OPENSA` toast VISIBLE on screen (screenshot; Ganton, 118 fps). Artifact hand-placed
  into `build/original/opensa/cleo/` for the check and removed after — it is a conformance
  artifact, not a shipping mod.
- **Real CLEO under Wine: PASSED (user-confirmed 2026-08-06).** The artifact placed into the real
  install's `CLEO/` folder; the `HELLO OPENSA` print visible in-game under real CLEO on the
  canonical SA 1.0 US exe (the accepted HOODLUM build, 14 383 616 B — the perfect-map fingerprint;
  the user's live modded install). CLEO library version not recorded — the install's CLEO 4-era
  setup; the script uses only base-game + classic CLEO 4 block opcodes, so any 4.x+ serves it.
  **The dual-target claim is now field-proven on BOTH runtimes** — the same 88 bytes ran on our VM
  (headless + field) and under real CLEO.
- Harness note for the next field probe: `?loader=http-dir` still needs the RUN-game menu click
  (only the folder/disclaimer steps are skipped); the print surface is the `#cleo-toast` DOM node
  — poll it, the DOM is a verdict.
