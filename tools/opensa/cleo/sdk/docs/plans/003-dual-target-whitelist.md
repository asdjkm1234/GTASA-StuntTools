# 003 — Dual-target whitelist (the gate)

Part of the [cleo/sdk chain](readme.md). Depends on [002](002-assembler-core.md) (the IR the gate
walks). Delivers the guarantee behind the SDK's central claim: an emitted `.cs` runs on BOTH
runtimes, or its name says it does not.

## Context

The root plan's decision 4: allowed = (opcodes real CLEO 4.x serves on SA 1.0 US) ∩ (our VM's
handler registry). The danger this plan removes is silent drift — a hand-maintained list would rot
the day either side moves. So both halves are machine-derived, and the gate can never disagree with
reality without a build going red.

## Decisions

1. **Our side is `HandlerRegistry.ids()`** — genuinely SERVED opcodes only. Declared tiers
   (`noop` / `conditional-false` / `kill-thread`) are degradation policy for foreign scripts, NOT
   support: an authored script may not lean on a tier, so tiered ids stay outside the whitelist.
2. **The real-CLEO side is derived from the vendored `sa.json`** — the Sanny library attributes
   commands to the base game vs extensions (CLEO et al.). The FIRST task of this plan is research:
   pin exactly what the DB encodes (attribute names, edge cases, opcodes CLEO 4 serves that the
   attribution misses or over-claims), and record the derivation rule + its known residual in this
   file's notes. If the DB's attribution proves insufficient, the fallback is an explicit generated
   list with its provenance stated — never a silent hand-list.
3. **The whitelist is GENERATED data** (`src/whitelist/whitelist.generated.ts`, a
   `npm run cleo:opcodes`-style script beside it): regenerated from the two sources, committed, and
   a CI test fails when regeneration would change it — same discipline as the opcode table.
4. **Gate placement:** walking the IR after DSL construction, before assembly. A violation is a
   build ERROR naming the opcode (id + Sanny name) and WHICH runtime lacks it — the error message
   is the fix's map.
5. **The escape hatch is per-script and visible:** `target: 'opensa-only'` in the script definition
   lifts the real-CLEO half of the gate (the VM half always holds — we never emit what we cannot
   run). The artifact is then named `<name>.opensa-only.cs`. A NAME now carries behaviour →
   **`docs/contracts/mods.md` is extended in the same change** (what the suffix means, what happens
   when it is absent on a script that needed it: real CLEO faults on an unknown opcode — the
   failure is theirs, loud, not ours, silent).

## Tasks

- [x] Research done — derivation rule + residual in Measurements below.
- [x] Generator (`scripts/generate-whitelist.ts`, `npm run cleo:whitelist`) + committed
      `src/whitelist/whitelist.generated.ts` + the drift test (derives live, compares sets).
      Derivation is a pure module (`src/whitelist/derive.ts`) shared by both.
- [x] The gate (`src/whitelist/gate.ts`): walks IR, aggregates EVERY violating opcode once with its
      Sanny name and the missing runtime; the VM half holds under every target, `opensa-only`
      lifts exactly the real-CLEO half. Unit-tested all three ways.
- [x] `artifactName()` beside the gate (`<name>.cs` / `<name>.opensa-only.cs`) — `build.ts` wires
      it when the pipeline compiles (plan 004).
- [x] `docs/contracts/mods.md` §4 — the suffix rule (and why renaming does not make a script
      portable: real CLEO faults loud at the first unknown opcode).
- [x] Ledger below.

## Verification

Regenerating the whitelist is a no-op diff in CI; the three gate behaviours are unit-tested; the
contract doc carries the suffix rule. The whitelist counts are recorded in Measurements.

## Measurements / notes

### Shipped (2026-08-06)

- **What the vendored DB encodes (research):** extension attribution only, NO CLEO-version
  attribution. Its `CLEO` extension (92 commands) mixes the classic CLEO 4 block
  `0x0A8C-0x0AEF` with CLEO 5 ids (`0x0DD5`, `0x2000-0x2003`, `0x290B`); the module extensions
  (audio/bitwise/clipboard/file/ini/…) mix 4.x-era ids with 5-only `0x2xxx` ranges; `CLEO+`,
  `NewOpcodes`, `SAMPFUNCS`, `Sphere` are third-party plugins.
- **Derivation rule (conservative):** real-CLEO-4 half = `default` extension (the game's own
  opcodes, 2 637) + `CLEO`-extension ids within the contiguous classic block `0x0A8C-0x0AEF`
  → 2 724 ids. **Residual:** module opcodes late CLEO 4.x DID serve (ini `0x0AF0+`, file
  `0x0B00+`, bitwise `0x0B10+`, audio) are excluded — false NEGATIVES possible, false positives
  not; a script passing the gate needs nothing beyond plain CLEO 4 on SA 1.0 US. Costs zero
  today: the VM serves none of them.
- **Counts:** VM-served 105 → dual-target **90**. The 15 VM-served non-dual opcodes are ALL
  `CLEO+` (struct/list/perlin/model-info etc. — the corpus mods genuinely require the CLEO+
  plugin on real SA). The dual 90 is the SDK's default authoring surface.
- Full suite: **427 files / 3 716 tests green**; tsc + eslint clean.
