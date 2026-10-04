# @opensa/cleo-sdk — CLEO authoring SDK

Write CLEO scripts in TypeScript, compile to standard CLEO 4 `.cs` — one source, two runtimes:
real CLEO on the canonical SA 1.0 US exe, and our VM (`@opensa/cleo`). Every authored script is
thereby a conformance test of the VM against real CLEO.

- Design: [docs/architecture.md](docs/architecture.md)
- Execution chain: [docs/plans/readme.md](docs/plans/readme.md) (001–005)
- Goals check, decisions, scope cuts and the chain ledger: the same
  [docs/plans/readme.md](docs/plans/readme.md) — the SDK's paperwork lives beside the SDK
- The engine chain this grew out of: `docs/plans/097-cleo-basic/` at the repo root (CLEO integration
  only — no SDK tasks live there)

Why root `cleo/` and not `tools/`: the `asi/perfect-map` pattern — a self-contained project that
AUTHORS runtime content for the game rather than building the map. Build-time only: the runtime
never imports the SDK, and the SDK's only upstream is `@opensa/cleo` (opcode table, decoder,
disassembler — the format's ground truth).

## Layout

```
cleo/
  scripts/          # authored script SOURCES, one folder per script (see its README)
  sdk/
    src/            # cli.ts + build.ts (001); assembler (002), whitelist (003), DSL (004) land here
    dist/           # compiled artifacts <name>.cs / <name>.opensa-only.cs — git-ignored
    docs/           # architecture + the 001–005 plan chain
```

## Commands

- `npm run build:cleo-scripts` — compile every script under `cleo/scripts/` to `cleo/sdk/dist/`
  (build IR → whitelist gate → assemble → decode-verify; deterministic bytes).
- `npm run cleo:whitelist` — regenerate the dual-target whitelist (drift-tested in CI).

## Write a script

`cleo/scripts/<name>/script.ts`, exporting the definition as `script` (the repo prefers named exports):

```ts
import { defineScript } from '../../sdk/src/dsl/script';
import { int, str } from '../../sdk/src/ir';

export const script = defineScript({
  budgetPerTick: 50, // the story test asserts the measured cost against this
  name: 'hello-conformance', // artifact + folder name; scmName defaults to first 7 chars
  build(s) {
    s.loop(() => {
      s.wait(1000);
      s.op('PRINT_STRING_NOW', str('hello'), int(1000));
    });
  },
});
```

- Opcodes by Sanny name (`s.op`, `s.not` for negated conditions), typed operands from `../ir`
  (`int` picks the smallest width; `str`/`str8`/`str16`; `s.local('x')` allocates a slot,
  `s.global(i)` is always explicit).
- Structured flow lowers to the SCM convention and hides nothing: `s.if(conds, {then, else?, any?})`
  emits `00D6 IF` + `004D GOTO_IF_FALSE`; `s.while`/`s.loop` add the backwards `GOTO`. Read the
  emitted listing in the story test's snapshot — the listing IS the semantics.
- A backwards jump enclosing no `WAIT` warns (busy loop); suppress per site with
  `{ noWaitWarning: true }` when intended.
- The whitelist gate holds at build: dual-target scripts use only opcodes BOTH runtimes serve;
  `target: 'opensa-only'` lifts the real-CLEO half, `target: 'sa-only'` is its mirror (real-SA
  systems our engine does not have — the gate holds the reference install's CLEO 4.4 surface and
  lifts the VM half; cleo/scripts plan 003), and the artifact name carries either
  (`docs/contracts/mods.md` §4).
- End every script with an explicit terminator (`TERMINATE_THIS_CUSTOM_SCRIPT`) — trailing queued
  labels are a build error.
