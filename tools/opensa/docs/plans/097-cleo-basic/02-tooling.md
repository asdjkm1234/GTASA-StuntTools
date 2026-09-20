# 097/02 — Debug tooling (the chain's own instruments)

The tools this chain is debugged WITH, built as first-class deliverables instead of throwaway
scratchpad scripts (the recon was done on a throwaway Python disassembler that will not survive the
session — this plan makes its capabilities permanent). Repo rule applies: each tool lives in
`scripts/debug/`, gets a row in `docs/debug/README.md` in the same change, and throwaway experiments
stay `.tmp-*` and die before commit.

## Decisions

1. **`scripts/debug/scm-disasm.ts`** — disassemble one `.cs` (or every `.cs` under a directory) to a
   Sanny-like listing on stdout or into files. Flags: `--census` (per-file + global opcode frequency
   table with extension names), `--strings` (extracted string operands — model names, frame names, GXT
   keys at a glance), `--json` (typed instruction stream for piping). This is plan 01's `disassemble()`
   behind a CLI — no duplicate decoder.
2. **`scripts/debug/cleo-census.ts`** — the coverage joint: decode a corpus, join against the handler
   registry + tier registry (once plans 03–05 exist) → used / implemented / unimplemented / frequency,
   sorted by frequency. Before the registries exist it degrades to the raw census (same output shape).
   This is the SAME code path plan 07 later runs in CI — built here, promoted there.
3. **`scripts/debug/cleo-run.ts`** — headless script runner: decode + VM + a mock host that RECORDS
   every host call (the [[engine-fake-gpu-device]] philosophy: assert decisions, not API calls).
   Prints the host-call trace per tick — "spawn windturb_base at …, rotate 3.2°, wait 0" reads as a
   story. Lands in the same change as plan 03 (needs the VM); grows an `--atlas` mode with plan 05
   (native calls resolve against a recorded atlas stub and appear in the trace).
4. **Tools re-derive the recon numbers as their smoke test.** The corpus census (~116 unique opcodes,
   instruction counts per script) is recorded in plan 01's ledger; a tool change that shifts those
   numbers is a decoder regression surfacing in a diff, not in the field.

## Subtasks

- [x] `scm-disasm.ts` (+ `docs/debug/README.md` row) — same change as plan 01's decoder.
- [x] `cleo-census.ts` (+ row) — degraded raw-census mode first.
- [x] `cleo-run.ts` (+ row) — landed with plan 03's VM; `--atlas` extension with plan 05.
- [x] `docs/commands.md` entries for the three tools.

## Verification

- `scm-disasm` output on the corpus matches plan 01's committed fixture listings byte-for-byte.
- `cleo-census` over the corpus reproduces the recon census.
- `cleo-run` on Ferris Wheel prints the spawn/rotate/wait story headless, no browser.

## Ledger

_(filled 2026-08-04; `cleo-run` + the census status join landed with plan 03)_

- **Tool inventory**: `scripts/debug/scm-disasm.ts` (listing / `--census` / `--strings` / `--json` /
  `--out`), `scripts/debug/cleo-census.ts` (raw census, `status` column stubbed `-` until the plan 03
  handler registry exists; `--json` for the plan 07 CI joint). Both are plan 01's decoder behind a
  CLI — zero duplicate decode logic.
- **Verification run**: `scm-disasm --out` over the fixtured corpus reproduces all 7 committed
  listings in `fixtures/custom/cleo-listings/` byte for byte (`cmp` clean); `cleo-census` reports the
  recon baseline exactly — 115 unique opcodes, per-script counts 91/239/44/102/2085/64/64. Top of
  the frequency table: 000B ADD_VAL_TO_FLOAT_LVAR 472 (rhino's track math), 004D GOTO_IF_FALSE 341,
  00D6 IF 314.
- `--strings` on windfarm surfaces the model names + the not-installed error text in one screen —
  the at-a-glance mode the recon lacked.
