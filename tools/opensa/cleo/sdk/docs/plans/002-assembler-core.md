# 002 — Assembler core (the decoder's mirror)

Part of the [cleo/sdk chain](readme.md). Depends on [001](001-scaffold.md) (a compiling project).
Delivers the load-bearing half of the SDK: IR → standard CLEO 4 bytes, proven against the corpus
byte-for-byte. Everything after this plan is surface; this plan is the format.

## Context

`@opensa/cleo` already owns the format's ground truth in the read direction: `core/operands.ts`
(the type-byte operand layer, a LOSSLESS union), `core/decode.ts` (u16 opcode + DB arity + variadic
tail + `__SBFTR` trailer), and the corpus fixtures of real Sanny-compiled bytes. The assembler is
the same knowledge run backwards — and because the decoded union is lossless, the strongest
possible test exists for free: re-assembling a decoded corpus script must reproduce its bytes
EXACTLY. That test — not our reading of any spec — is the referee for every encoding decision here.

## Decisions

1. **IR is the assembler's contract** (`src/ir.ts`): a flat instruction list — opcode by Sanny name
   OR raw id, negation flag, typed operands with symbolic labels and lvars. The DSL (004) produces
   it; the whitelist gate (003) walks it; the assembler consumes it. Arities checked against the
   generated table from `@opensa/cleo` at IR construction, not at emit time.
2. **Operand writer mirrors `operands.ts` one-to-one** — same type-byte set (`0x01`–`0x13`), same
   payload layouts, byte-per-char strings, NUL-padded fixed forms. Int width policy: smallest width
   that holds the value (int8 → int16 → int32) — deterministic, and matching Sanny's practice as
   the corpus re-encode test will prove or correct.
3. **Labels resolve to the corpus's negative-offset convention** for custom scripts. Two-pass
   assembly: lay out with worst-case widths is NOT acceptable if it breaks byte-identity — offsets
   are int32 in the corpus (pin this against the fixtures); the re-encode test decides.
4. **LVAR allocator over `var-space.ts` semantics** — deterministic, declaration-ordered, timer
   slots reserved exactly as the VM defines them. The VM is the ground truth for what a local slot
   means; the allocator must never hand out a slot the VM treats specially.
5. **Native-call tails (`0AA5`–`0AA8`)**: declared head operands, then args + output vars, then the
   `0x00` terminator — the decoder's variadic rule run backwards.
6. **Trailer always emitted:** `[u32 codeEnd]["__SBFTR\0"]`, no VAR/FLAG/SRC metadata (we are not
   Sanny; the decoder treats the footer as opaque and the trailer alone gives tooling the code
   boundary). The corpus re-encode test must therefore compare the CODE region byte-exactly and the
   footer by policy, not blindly.
7. **Determinism is a tested property**, not a hope: build twice, compare bytes, in CI.

## Tasks

- [x] `src/assemble/operands.ts` — the writer; round-trip tests `readOperand(emit(x)) = x` across
      the full type-byte set (reusing `@opensa/cleo`'s reader as the oracle). The type-byte
      constants are now EXPORTED from `@opensa/cleo/core/operands` (reuse, not a fork).
- [x] Instruction emission + two-pass label resolution + trailer, folded into one
      `src/assemble/assemble.ts` (`assembleCode` / `assembleScript`) — smaller than the planned
      three files; `src/assemble/writer.ts` is the little-endian mirror of `Cursor`. IR +
      construction-time validation (arity, negation-on-conditions, name/id resolution with
      ambiguous-name poisoning) in `src/ir.ts`.
- [x] `src/assemble/lvars.ts` — the allocator, pinned to the VM (`LOCAL_SLOTS`/`TIMER_A` now
      exported from `@opensa/cleo/vm/thread`; string8 = 2 slots, string16 = 4).
- [x] **The referee test** (`corpus-reencode.test.ts`, skip-gated): all 7 corpus fixtures decode →
      IR → assemble byte-identically over their code regions.
- [x] Determinism test (double build, byte compare).
- [x] Measurements below — including the encoding fact the referee corrected.

## Verification

Every corpus fixture round-trips decode → assemble byte-identically over its code region; operand
property tests green across all type bytes; determinism test green. No engine file touched.

## Measurements / notes

### Shipped (2026-08-06)

- **Referee: 7/7 corpus fixtures re-encode byte-identically** — 23 602 code bytes across 2 689
  instructions (73 495 file bytes incl. footers). Comparison is over the code region; footers are
  Sanny's VAR/FLAG/SRC metadata we do not emit.
- **The referee corrected a real encoding fact on its first run:** the decoded union was NOT fully
  lossless — fixed-string payload bytes past the first NUL were dropped by `text()`. The corpus
  carries exactly one such byte (rhino's `09 "BB_05"`: `42 42 5f 30 35 00 54 00` — a leftover
  `0x54` after the terminator). Fix in the DECODER, not the test: string operands now keep a
  `padding` field (present only when the tail is non-zero), and the writer reproduces it after
  validating it begins with NUL. `packages/cleo` suite unaffected (listings print `value` only).
- Width policy pinned: `int()` picks int8/int16/int32 by value range; label operands are always
  int32 (fixed 5-byte size makes layout single-shot exact); jumps emit the negated byte offset;
  a label at offset 0 is a located error (unencodable under the negative-offset convention).
- Determinism test green (double assemble, byte compare).
- Full suite: **426 files / 3 708 tests green** (+5 files / +44 tests vs 001); tsc + eslint clean.
- `@opensa/cleo` additions (all exports, no behaviour change beyond the padding fix): operand
  type-byte constants, `TRAILER_MAGIC`, `LOCAL_SLOTS`/`TIMER_A`.
