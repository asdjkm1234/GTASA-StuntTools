# 004 — DSL builder (the authoring surface)

Part of the [cleo/sdk chain](readme.md). Depends on [002](002-assembler-core.md) (the IR it
produces) and [003](003-dual-target-whitelist.md) (the gate it compiles through). Delivers the
typed TS surface a script author actually writes — no new language, no parser; the TS type system
IS the editor.

## Context

Root-plan decision 3: a typed TS builder — threads, labels, `wait`, structured control flow
lowering to the SCM conditional convention, opcodes by Sanny name — with raw opcode emission as the
escape hatch for anything the sugar does not cover yet. The sugar exists to make the COMMON shape
of a CLEO script (init, then a `wait`-paced loop with conditional blocks) readable and hard to get
wrong; it must never hide the bytecode model, because the disasm listing snapshot is the review
surface and the author has to be able to predict it.

## Decisions

1. **A script is a plain TS module** in `cleo/scripts/<name>/script.ts`, exporting `script` (named — the repo's lint rule), a
   definition: `{ name, target?, budgetPerTick, build(s) }` — `name` becomes `03A4 SCRIPT_NAME` and
   the artifact filename; `budgetPerTick` is the DECLARED per-frame instruction budget the story
   test asserts (the VM's 10 000/thread ceiling is the hard gate above it).
2. **Opcodes by Sanny name, typed from the generated table:** `s.op('PRINT_STRING_NOW', ...)` with
   arity checked at IR construction; name→id via `@opensa/cleo`'s table. Rich per-opcode TS
   signatures only where the sugar layer wraps an opcode — no attempt to hand-type a thousand
   opcodes up front.
3. **Structured flow lowers to the SCM convention:** `s.if(...conditions).then(...).else(...)` →
   `00D6 IF` (and-count/or-count encoding as the corpus uses it) + conditional jump lowering with
   generated labels; `s.while`/`s.loop` sugar over the same. Explicit `s.label()` / `s.jump()`
   stay available — the sugar is optional, the labels it generates are visible in the listing.
4. **`wait` is first-class** (`s.wait(ms)`) — the cooperative VM and real CLEO both live on it, and
   a loop without one is the classic authored-script bug; the builder WARNS on a backwards jump
   that encloses no `wait` (a heuristic, stated as such — it can be suppressed per site).
5. **Locals are named handles** (`s.lvar('x')`, typed int/float/string) allocated by 002's
   deterministic allocator; globals only through an explicit `s.gvar(index)` — an authored script
   touching the global space says so loudly.
6. **The escape hatch is raw:** `s.raw(opcodeId, operands)` bypasses name lookup and sugar but NOT
   the whitelist gate or arity check. Nothing bypasses the gate.

## Tasks

- [x] `src/dsl/script.ts` — `defineScript` (validated shape: kebab name, 7-char scmName, positive
      budget) + `ScriptBuilder`: `op`/`not` by Sanny name or raw id (the raw escape hatch is the
      same `op` with a numeric id — one path, nothing bypasses the gate), `label`/`wait`,
      `local()` named-slot handles (allocated on first use), explicit `global(i)`, `if/while/loop`
      lowering. `SCRIPT_NAME` auto-emitted first from `scmName`.
- [x] Lowering tests as INLINE listing snapshots (reviewable in the test file; the diff IS the
      semantics): if/else offsets verified by hand, while's backwards GOTO, the AND/OR group code
      (0 single, count-1 AND, 19+count OR — pinned against the VM's `startAndOr`).
- [x] The missing-`wait` warning (index-level heuristic over backwards label jumps) + per-site
      suppression + the paced-loop negative, one test each.
- [x] `build.ts` end-to-end (`compileScript`: IR → gate → assemble → decode-verify → listing) +
      `cli.ts` writes `dist/<artifact>` and prints warnings.
- [x] `cleo/sdk/README.md` — the authoring how-to.

## Verification

A sample script using every sugar construct compiles; its listing snapshot is committed and
readable; the same script via raw emission produces identical bytes (the sugar adds nothing the
listing cannot show). Determinism holds through the full pipeline.

## Measurements / notes

### Shipped (2026-08-06)

- The sugar-adds-nothing proof is a TEST: `s.loop(...)` and the same construct via explicit
  `label`/`op('GOTO')` produce byte-identical artifacts.
- if/else lowering (verified in the committed inline snapshot): `00D6 IF code` → conditions →
  `004D GOTO_IF_FALSE else|end` → then → `0002 GOTO end` → else → end. Group code matches the
  VM's `startAndOr` exactly; a non-condition opcode inside `if()` and a 0/9-condition group are
  located build errors.
- A script ending in a structured construct leaves its internal end label queued → the trailing
  -label error names it; the rule "end every script with an explicit terminator" is in the README.
- Full suite: **428 files / 3 730 tests green** (+14 DSL tests); tsc + eslint clean.
