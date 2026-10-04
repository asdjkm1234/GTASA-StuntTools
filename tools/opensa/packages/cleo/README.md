# @opensa/cleo — CLEO/SCM script support

Runs compiled CLEO scripts (`.cs`) the way plan 097 shaped it: decode against the vendored Sanny
opcode DB, execute on a cooperative VM behind an injected host interface, and serve native memory
access through a symbolised atlas instead of emulating bytes. The engine side (real host facets,
boot discovery, the F2 debug screen) lives in `apps/web/src/ui/engine-cleo*.ts`; everything in this
package is engine-agnostic and runs headless.

## Map

| Piece          | Where                            | What it is                                                                                            |
| -------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Decoder        | `src/core/decode.ts`             | `.cs` bytes → instructions with an offset index; stops at the `__SBFTR` footer                        |
| Opcode DB      | `src/core/opcodes.generated.ts`  | generated from `vendor/sa.json` (`npm run cleo:opcodes`, pin in `vendor/README.md`)                   |
| Disassembler   | `src/core/disasm.ts`             | the Sanny-like listing — a CONTRACT (fixtures at `fixtures/custom/cleo-listings/`)                    |
| VM             | `src/vm/runner.ts` + `thread.ts` | cooperative scheduler on game time; every handler throw becomes a located thread fault                |
| Handlers       | `src/vm/handlers/*.ts`           | opcode implementations over the `CleoHost` facets                                                     |
| Host interface | `src/vm/host.interface.ts`       | everything the VM may ask of the world — the engine implements it, tests fake it                      |
| Native atlas   | `src/vm/native-atlas.ts`         | SA 1.0 US addresses as DATA + `AtlasMemory`, the read/write/call facade over a narrow `NativeWorld`   |
| Tiers          | `src/vm/tiers.ts`                | the degradation POLICY for gaps — per opcode and per atlas row, as data                               |
| Tracer         | `src/vm/trace.ts`                | the ring buffer behind `cleo.trace` / the F2 CLEO screen — instruction + symbolised host-effect lines |
| Recording host | `src/vm/recording-host.ts`       | the one mock: every facet call is a readable line; the atlas inside is REAL, only the world is canned |
| Corpus tests   | `src/vm/corpus*.test.ts`         | the shipped scripts on the real decoder+VM: behaviour, coverage join, trace snapshots                 |

Corpus fixtures come from the installed mods: `npm run test:fixtures` copies them to
`fixtures/original/cleo/` (skip-gated everywhere, so CI without game assets stays green).

## Add an opcode

One file per step, and the corpus join test walks you through it:

1. **RE the semantics** — the vendored Sanny DB gives name/params/condition; GTAMods wiki and
   gta-reversed (`docs/links.md`) give what it actually DOES. The original is the source of truth
   for what the data means, never for how to execute it.
2. **Host method, only if this is a genuinely new capability** — extend the right facet in
   `src/vm/host.interface.ts`, implement it in `apps/web/src/ui/engine-cleo.ts` (or `-setup.ts`)
   over a real engine seam, and record it in the recording host so it traces.
3. **Register the handler** — `src/vm/handlers/` (pick the file by subject; `registry.register` in
   its `register*` function).
4. **Or declare a tier instead** — an opcode you deliberately do NOT implement gets a row in
   `DECLARED_TIERS` (`src/vm/tiers.ts`): `noop` (cosmetic), `conditional-false` (the script's own
   not-installed guard runs), `kill-thread` (skipping would corrupt the script). The
   `corpus-coverage.test.ts` join FAILS on an opcode that is neither served nor declared, sorted by
   real frequency — the priority list writes itself.
5. **Fixture test** — a unit test beside the handler, plus regenerate the trace snapshots if the
   story legitimately moved: `npx tsx scripts/debug/cleo-trace-fixtures.ts` (review the diff — the
   diff IS the behaviour change).

## Add an atlas row

For a script that reads/writes/calls an SA address the atlas cannot name yet (it shows up as an
`atlas miss` in coverage, the F2 screen, and the corpus join):

1. **RE the address** — gta-reversed is the authority; every symbol in `native-atlas.ts` cites it.
   Never serve an address you cannot NAME.
2. **Extend `NativeWorld`** if the engine must answer something new — implement it over the live
   seams in `apps/web/src/ui/engine-cleo-setup.ts` and can it in the recording host.
3. **Serve it in `AtlasMemory`** — a `SA` constant + a branch in the right `read*`/`call` path, with
   a symbolised trace line (`this.op(...)`) so the tracer never prints a raw address.
4. **Or declare the gap** — a deliberately unserved row gets a `DECLARED_ATLAS_TIERS` entry keyed by
   `atlasMissKey` (`kind:detail`). Undeclared defaults mirror what the facade does: reads/calls
   answer 0 (tier b), writes are skipped (tier a); nothing in the atlas kills a thread.
5. **Tests** — `native-atlas.test.ts` for the row, corpus trace snapshots if a script now resolves
   further.

## Debug a script

- `npx tsx scripts/debug/scm-disasm.ts <file.cs>` — what it IS (the listing).
- `npx tsx scripts/debug/cleo-census.ts` — what it USES (opcode frequency vs our registry).
- `npx tsx scripts/debug/cleo-run.ts <file.cs> --cars 257:544` — what it DOES headless (host-call
  story on the recording host).
- In the field: `?cleo=1` → F2 → CLEO — runner/trace toggles, per-thread state and cost, coverage
  (unimplemented opcodes + unserved atlas rows with their tiers), the per-thread trace, and a
  step-one-instruction affordance. When headless and field disagree, diff the GATE ANSWERS (the
  trace prints every conditional's result) — not the code.
