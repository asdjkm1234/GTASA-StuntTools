# cleo/sdk — architecture

The design for our CLEO authoring SDK: write CLEO scripts in TypeScript, compile them to **standard
CLEO 4 `.cs` bytecode**. One source, two runtimes — the same artifact runs under real CLEO on the
canonical SA 1.0 US exe and under our VM (`@opensa/cleo`), which makes every authored script a
conformance test of the VM against real CLEO, exercised from the authoring side. This document is
the standing architecture; the numbered [plans](./plans/readme.md) are the execution steps that
fill it in — that chain readme also carries the goals check, the decisions, the scope cuts and the
chain ledger (they lived in `docs/plans/097-cleo-basic/08-authoring-sdk.md` until 2026-08-12, when the
SDK's paperwork was moved beside the SDK). The engine chain this one grew out of is
[097 — CLEO basic](../../../docs/plans/097-cleo-basic/readme.md).

## Constraints (what shapes everything)

1. **Emit exactly the format mod authors ship.** A standard CLEO 4 `.cs` — decodable by our own
   decoder AND by real CLEO. No OpenSA-only container, no side-channel metadata; anything the
   runtime must know is in the bytes or in the artifact NAME.
2. **One opcode DB.** The vendored, pinned Sanny library (`packages/cleo/vendor/sa.json`) is the
   single source of names, arities and operand shapes — the SDK imports the generated table from
   `@opensa/cleo`, never forks it.
3. **Dual-target by default.** Allowed opcodes = (what real CLEO 4.x serves on SA 1.0 US) ∩ (our
   VM's handler registry). Emitting outside that set is a build ERROR unless the script declares
   `target: 'opensa-only'` — and then the flag is embedded in the artifact name, so a `.cs` that
   cannot run on real SA is never mistaken for one that can.
4. **Deterministic builds.** Identical sources → byte-identical artifacts. No timestamps, no
   randomness, no environment leakage. Re-running the build is a no-op diff.
5. **Build-time only.** The SDK never ships in the engine; zero runtime cost. Compiled `.cs` are
   build outputs, never committed.
6. **Every script proves itself.** Assemble → our disassembler renders the committed listing
   snapshot → the story test runs it headless on the VM within a DECLARED per-frame instruction
   budget (the VM's 10 000/thread ceiling is the hard gate; rhino's measured ~2 000 is the
   calibration point) → the field boots it through the normal `cleo/` discovery path.

## The mirror principle (one source of truth, two directions)

The assembler is the decoder's mirror. `@opensa/cleo` already owns the ground truth of the format —
`core/operands.ts` (type-byte operand layer), `core/decode.ts` (u16 opcode + arity + variadic tail +
`__SBFTR` trailer), `core/disasm.ts` (the human-review listing, a committed-fixture CONTRACT). The
SDK adds only the inverse direction and reuses everything else:

```
cleo/scripts/*/script.ts ──▶ @opensa/cleo-sdk ─────────────▶ cleo/sdk/dist/*.cs ──▶ four verdicts
 (TS DSL: threads, labels,     builder → IR →                 (standard CLEO 4       a) decode + disasm listing snapshot
  wait, if/else, opcodes        whitelist gate →               bytes, __SBFTR        b) cleo-run story on the VM (budget)
  by Sanny name)                assembler = decoder's mirror)  trailer)              c) field boot via the cleo/ path
                                                                                     d) real CLEO under Wine (manual)
```

The decoder is the REFEREE: nothing the assembler emits is trusted until `decodeScript()` reads it
back losslessly. The strongest form of that test is corpus re-encode — the decoded operand union is
lossless by design, so re-assembling a decoded corpus script must reproduce its bytes exactly.

## Encoding facts the assembler must honour

All recovered in plan 097/01 and enforced by the decoder (`decode.ts` / `operands.ts`):

- **Instruction:** little-endian u16 opcode; top bit `0x8000` = negated conditional.
- **Operand:** one data-type byte (`0x01`–`0x13`) + payload — int8/16/32, float32, fixed strings
  (8/16, NUL-padded), length-prefixed string, global/local var (u16 index), array refs
  (offset u16 + indexVar u16 + elemSize u8 + flags u8). Script text is byte-per-char.
- **Variadic tail:** terminated by the `0x00` type byte; native calls `0AA5`–`0AA8` read declared
  head operands, then args + output vars as the tail.
- **Jumps:** label resolution emits the corpus's negative-offset convention for custom scripts
  (a `.cs` jump target is the negated local byte offset).
- **Trailer:** `[u32 codeEnd]["__SBFTR\0"]` appended so decode-to-EOF tooling sees an explicit
  code boundary (the decoder preserves the footer as an opaque tail).
- **Width policy (ours, for determinism):** smallest int width that holds the value — matching
  Sanny's practice and pinned by the round-trip fixtures.
- **LVAR allocation:** deterministic, declaration-ordered, over the slot/timer layout the VM's
  `var-space.ts` defines — the VM is the ground truth for what a local slot means.

## The dual-target whitelist (generated, never hand-listed)

Both halves are machine-derived, so the gate can never drift from reality:

- **Our side:** the VM's `HandlerRegistry.ids()` — genuinely SERVED opcodes only. Declared tiers
  (`noop`/`conditional-false`/`kill-thread`) are degradation policy for foreign scripts, not
  support; an authored script may not lean on a tier.
- **Real-CLEO side:** derived from the vendored `sa.json`'s own attribution of commands to the
  base game vs CLEO extensions (plan 003 pins the exact derivation and records what the DB does
  and does not encode).

A violation names the opcode and WHICH runtime lacks it. `target: 'opensa-only'` lifts the gate for
a script that consciously needs OpenSA — the artifact is then named `<name>.opensa-only.cs`
(a NAME carrying behaviour → recorded in `docs/contracts/mods.md` in the same change, plan 003).

## Directory layout

```
cleo/                            # root category (mirror of asi/) — projects that AUTHOR runtime content
  scripts/                       # authored script SOURCES, one folder per script
    hello-conformance/
      script.ts                  # the DSL source (named export `script` = the definition)
      story.test.ts              # headless run on the VM: behaviour + declared budget
  sdk/
    docs/
      architecture.md            # this file
      plans/                     # the 001–005 execution chain (readme.md indexes it)
    src/
      ir.ts                      # the assembler's input: instructions by Sanny name, symbolic labels/lvars
      dsl/                       # typed builder: script(), thread flow, wait, if/else lowering, raw escape hatch
      assemble/                  # operand writer, label resolver, lvar allocator, trailer — the decoder's mirror
      whitelist/                 # generated dual-target set + the gate
      build.ts                   # CLI: compile cleo/scripts/* → dist/*.cs (deterministic)
    dist/                        # git-ignored artifacts: <name>.cs / <name>.opensa-only.cs
    package.json                 # @opensa/cleo-sdk (workspace project, type:tool)
    README.md
```

Why root `cleo/` and not `tools/`: the `asi/perfect-map` precedent — a self-contained project that
AUTHORS runtime content for the game rather than building the map. `@opensa/cleo-sdk` does not
collide with `@opensa/cleo` (the runtime VM package), and the runtime never imports the SDK.

## The build lifecycle

`npm run build:cleo-scripts` — the whole story:

1. **Discover** script folders under `cleo/scripts/` (each exports one script definition).
2. **Build IR** — the DSL runs as plain TS; the result is a flat instruction list with symbolic
   labels and lvars (opcodes by Sanny name, checked against the generated table).
3. **Gate** — every opcode id checked against the dual-target whitelist (or the script's declared
   `opensa-only` target). Violation = build error naming opcode + missing runtime.
4. **Assemble** — resolve labels to negative offsets, allocate lvars, emit operands (smallest-width
   ints), append the `__SBFTR` trailer.
5. **Verify** — `decodeScript()` reads the artifact back; the disasm listing is the review surface
   (committed snapshot per script).
6. **Write** `cleo/sdk/dist/<name>[.opensa-only].cs`. Byte-identical on re-run.

## Testing strategy

- **Corpus re-encode (the referee test):** decode a shipped corpus fixture → re-assemble from the
  decoded IR → byte-identical. Proves the mirror against real Sanny-compiled bytes, not against
  our own reading of the spec.
- **Operand property tests:** `readOperand(emit(x)) === x` across the full type-byte set.
- **Listing snapshots:** each authored script's disasm listing is a committed fixture — the diff
  IS the behaviour change, same discipline as `fixtures/custom/cleo-listings/`.
- **Story tests:** each script runs headless on the recording host (`cleo-run` machinery) —
  behaviour asserted from the host-call story, per-frame instruction cost asserted against the
  script's declared budget.
- **Determinism test:** build twice, compare bytes.
- **Field:** hand-place into `build/original/opensa/cleo/` → boot `?cleo=1` → census line +1, the
  script's effect visible. Real CLEO under Wine is a MANUAL verdict, recorded in the ledger when
  taken — until then the dual-target claim rests on the whitelist + the format tests.

## Decided

- **Names:** root category `cleo/`, project `cleo/sdk`, package `@opensa/cleo-sdk`, sources in
  `cleo/scripts/`, artifacts in `cleo/sdk/dist/` (git-ignored).
- **Artifact naming:** `<name>.cs` = dual-target; `<name>.opensa-only.cs` = needs OpenSA
  (contract-recorded when 003 ships it).
- **No Sanny-source parser, ever.** TS is the authoring language; the DB is the shared truth; raw
  opcode emission is the escape hatch for anything the sugar does not cover yet.
- **The VM stays the ground truth** for slot semantics (`var-space.ts`) and served opcodes
  (`registry.ids()`); the vendored DB stays the ground truth for names/arities; the decoder stays
  the referee for bytes. The SDK owns only the inverse direction and the authoring surface.
