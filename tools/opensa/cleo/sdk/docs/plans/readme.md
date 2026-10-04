# cleo/sdk — plan chain (CLEO authoring SDK)

Build `@opensa/cleo-sdk`: author CLEO scripts in TypeScript, compile to standard CLEO 4 `.cs` —
one source, two runtimes (real CLEO on SA 1.0 US, and our VM), which also makes every authored script
a conformance test of the VM against real CLEO (the impersonation doctrine, exercised from the other
side). The standing design is [`../architecture.md`](../architecture.md).

**This file is the whole plan.** It was split in two until 2026-08-12 — the goals check, the decisions
and the ledger sat in `docs/plans/097-cleo-basic/08-authoring-sdk.md` while the steps sat here, and the
central copy still carried six task boxes for work this chain had already shipped. That file is deleted
and its content lives below (the user's call: `docs/plans/097-cleo-basic/` keeps ENGINE work — the CLEO
integration — and everything about the SDK lives beside the SDK).
[097 — CLEO basic](../../../../docs/plans/097-cleo-basic/readme.md) is the engine chain this one grew out of.

**Why now (the user's call, 2026-08-05):** the corpus work proved the VM; the next consumers of
scripting are OURS — city-life is the named future customer (ped ambience, spawn logic). Authoring in
Sanny Builder means a Windows GUI tool, no types, no tests, no CI; authoring in TS against our own
vendored opcode DB gives all three and emits the very format mod authors already ship.

Scope cuts (same call): ped-task opcodes and the city-life scripts arrive with the class-C facet, not
here. The original NO-corpus-rewrites cut (rhino tracks stays the author's script, `no_lights.cs` stays
skipped) was **SUPERSEDED 2026-08-06** — authored replacements for both are the
[`cleo/scripts/docs/plans/`](../../../scripts/docs/plans/readme.md) chain.

## The goals check (docs/project-goals.md)

1. **Authored data read as meant:** the SCM/CLEO bytecode format and the vendored+pinned Sanny opcode
   DB (`packages/cleo/vendor/sa.json`) — we EMIT exactly the format mod authors write, so our scripts
   are ordinary CLEO mods, installable anywhere.
2. **What the original does / why not our answer:** authors compile Pascal-ish Sanny source on Windows.
   The FORMAT is the contract; the authoring tool is not. Ours is typed, headless-testable and CI-gated.
3. **Better, demonstrated:** every authored script round-trips through our own disassembler (snapshot),
   runs headless on the VM with a story test, and decodes 100 % via `scm-disasm` — all in CI. Sanny
   gives none of these.
4. **Per-frame cost:** the SDK itself is build-time — zero runtime cost. Every authored script states
   its per-frame instruction budget in its story test (the VM's 10 000/thread ceiling is the hard gate;
   rhino's measured ~2 000 is the calibration point).
5. **Mod-author contract unchanged:** emitted `.cs` are standard CLEO 4 scripts. By default the SDK
   refuses opcodes outside the DUAL-TARGET whitelist (decision 4), so an emitted script never silently
   requires OpenSA.

## Decisions

1. **Location & name:** root `cleo/` category folder (mirror of `asi/`), first project `cleo/sdk`,
   package `@opensa/cleo-sdk` (no collision with `@opensa/cleo`, the runtime VM package). Our authored
   script SOURCES live in `cleo/scripts/` next to it; compiled `.cs` artifacts are build outputs, never
   committed.
2. **Reuse, don't fork:** the SDK imports the opcode table, encoders' ground truth and the disassembler
   from `@opensa/cleo` (the vendored Sanny DB stays the ONE source of arities). The assembler is the
   decoder's mirror: opcode-by-name emission, typed operands, label/jump resolution (the corpus's
   negative-offset convention), LVAR allocation, the `0AA5-0AA8` native-call tail encoding, and the
   `__SBFTR` trailer so decode-to-EOF tooling sees an explicit code boundary.
3. **DSL shape:** a typed TS builder (threads, labels, `wait`, structured if/else lowering to
   `00D6`/`004D`, opcodes by Sanny name) — no new language, no parser; the TS type system IS the editor
   surface. Escape hatch: raw opcode emission for anything the sugar does not cover yet.
4. **Dual-target whitelist as data:** allowed = (opcodes real CLEO 4.x serves on SA 1.0 US) ∩ (our VM's
   handler registry). Emitting outside it is a build ERROR unless the script declares
   `target: 'opensa-only'` — the flag is embedded in the artifact name so a `.cs` that cannot run on
   real SA is never mistaken for one that can (contract rule: the name carries it).
5. **Conformance proof, not a corpus rewrite:** the first authored script is a minimal
   `hello-conformance` (SCRIPT_NAME + a periodic `0ACD PRINT_STRING_NOW` + clean termination) — enough
   to prove assemble → disasm round-trip → headless run → field boot. Verifying it under real CLEO on
   the Wine harness is a MANUAL step, recorded in the ledger when done.
6. **CI:** the SDK's own unit tests + per-script story tests join the normal test run; `.cs` artifacts
   rebuild deterministically (byte-identical for identical sources).

## Out of scope (recorded)

- Corpus rewrites — superseded, see above: they are `cleo/scripts/docs/plans/`.
- Ped-task opcodes and the city-life scripts themselves — they arrive with the class-C facet (city-life
  territory); this chain only guarantees they will have a typed, tested home.
- A Sanny-source parser (we author in TS; the DB is the shared truth).

## The chain

| #   | Plan                                                      | Delivers                                                                                                                     | Status  |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [001 — Scaffold & workspace wiring](001-scaffold.md)      | the `cleo/` root category, the `cleo/sdk` workspace project, `cleo/scripts/` home, build command, CI/lint/tsc green on empty | done    |
| 2   | [002 — Assembler core](002-assembler-core.md)             | the decoder's mirror: operand writer, labels/jumps, LVARs, native-call tails, trailer; corpus re-encode byte-identical       | done    |
| 3   | [003 — Dual-target whitelist](003-dual-target-whitelist.md) | generated allowed-set (real CLEO ∩ VM registry), the build gate, `opensa-only` flag + artifact-name contract               | done    |
| 4   | [004 — DSL builder](004-dsl-builder.md)                   | the typed authoring surface: threads, labels, wait, if/else lowering, opcodes by Sanny name, raw escape hatch                | done    |
| 5   | [005 — hello-conformance](005-hello-conformance.md)       | first authored script end-to-end: listing snapshot, headless story, field boot, manual real-CLEO verdict; docs sweep         | done    |

Dependencies are linear 001 → 005. 002 is the load-bearing step (the bytes); 003 and 004 both sit
on 002's IR; 005 is the proof that closes the chain and carries the docs/ledger sweep. The chain is
independent of the runtime — it touches no engine file, so it may interleave with any parallel work.

## What "done" means for the chain

A script authored in TS compiles to a `.cs` that (a) our disassembler renders to the expected
committed snapshot, (b) runs headless within its declared per-frame budget, (c) boots in the field
via the normal `cleo/` path, and (d) contains only dual-target opcodes unless explicitly flagged in
its artifact name. Re-running the build yields byte-identical artifacts. **All held, including the
manual real-CLEO run under Wine: PASSED, user-confirmed 2026-08-06 (005's ledger) — the chain is
CLOSED.**

## Chain ledger (2026-08-06)

Per-plan ledgers live in 001–005; these are the numbers that describe the chain as a whole.

- **Assembler proof:** all 7 corpus fixtures re-encode byte-identically (23 602 code bytes /
  2 689 instructions); the referee corrected a real decoder fact — fixed-string bytes past the first
  NUL are now preserved (`padding`), making the decoded union genuinely lossless.
- **Whitelist:** 90 dual-target of 105 VM-served opcodes (generated, drift-tested); all 15 non-dual are
  CLEO+ — the corpus mods genuinely require the plugin on real SA.
- **hello-conformance:** 88 B artifact, 10 instructions; headless story green (5 prints, clean
  termination, worst 7 instr/tick vs 50 declared, avg 0.10); deterministic (byte-identical rebuild,
  sha1 `a5c253f9…`).
- **Field verdict (2026-08-06, headless harness):** census `[cleo] 7 script(s)` (+1 over the six shipped
  mod scripts), `HELLO OPENSA` toast visible on screen in Ganton — screenshot taken. The artifact was
  hand-placed for the check and removed after (a conformance artifact, not a shipping mod).
- **Real CLEO under Wine: PASSED, user-confirmed 2026-08-06** — the artifact in the real install's
  `CLEO/` folder, the print visible in-game on the canonical 1.0 US exe. The dual-target claim is
  field-proven on both runtimes; the impersonation doctrine exercised from the authoring side, and it
  held.
