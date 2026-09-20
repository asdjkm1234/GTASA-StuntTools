# Audit — plan 097: CLEO basic (2026-08-02 → 2026-08-06, spike + 8 steps, 3 field checkpoints, 3 field bug rounds)

Compiled CLEO `.cs` mods run on our own SCM virtual machine: a decoder generated from the vendored
Sanny opcode DB, a cooperative VM behind an injected host interface, a symbolised native-address
atlas instead of byte emulation, packaging through the normal mod build, and a debug surface (tier
policy, tracer, F2 screen, CI coverage joins). Six shipped scripts run in the field from
`build/original/opensa`. This is the close-out audit the big-rework rule asks for; the measurement
record is
[`docs/benchmarks/opensa-engine/2026-08-06-headless-cleo-vm-cost.md`](../benchmarks/opensa-engine/2026-08-06-headless-cleo-vm-cost.md),
and the per-step ledgers live in [`docs/plans/097-cleo-basic/`](../plans/097-cleo-basic/readme.md).

## What changed

- **A new engine-agnostic package, `@opensa/cleo`** (~40 source/test files, 138 package tests):
  two-layer decoder over the vendored Sanny DB (pin + regeneration in `packages/cleo/vendor/`),
  Sanny-format disassembler committed as byte-exact listing fixtures, cooperative thread VM on game
  time (ANDOR, CLEO_CALL frames, timers, 10k instr/tick budget, per-thread throw isolation),
  handler registries by domain, and `AtlasMemory` — SA 1.0 US addresses as DATA resolved through
  opaque tokens against a narrow `NativeWorld`, every symbol cited from gta-reversed.
- **The engine host** (`apps/web/src/ui/engine-cleo*.ts`): script objects on the rigid-model path,
  model resolution osm-first, the script vehicle fleet with slot-minted pool handles, boot
  discovery of `cleo/*.cs`, `Config.cleo` + `?cleo=1`.
- **Packaging (06)**: CLEO mods ship through the normal build — installers carry `cleo/`, the
  corpus lives in `mods-src/original`, gta.dat IDE lines are automated; nothing is hand-placed.
- **The support surface (07)**: unimplemented tiers as data (per opcode AND per atlas row, each
  declared row naming its corpus consumer), `coverage()` on the runner, two CI joins that fail on
  an undeclared gap, the trace ring (instruction lines in the disasm contract format + condition
  answers + symbolised atlas effects), the F2 CLEO screen (runner/trace toggles, thread list with
  per-tick cost, coverage, per-thread trace, step-one-instruction), deterministic trace-snapshot
  fixtures per corpus script, and the module README with the add-an-opcode / add-an-atlas-row /
  debug-a-script flows.

## What it cost

- Steady state, whole corpus on the VM: **465 µs/tick** headless (rhino 295–364 µs of it — a
  full-script-per-frame walker by design). Boot: 0.23 ms for 7 scripts. `cleo.enabled: false`
  (still the default): one branch, ~1 ns. Tracer ON ≈ ×1.9 — a debug toggle, default off.
- The field default question (`Config.cleo.enabled` default-ON) is still the user's open call.

## What it bought

- Six real mod scripts run unmodified in the field — the Ferris wheel builds (21 objects) and
  spins, the wind farm builds its turbines, firela pins its ladder, vandoor slides doors, the
  class-C door script degrades declared-and-inert while the ENGINE serves its intent from the
  model's own door parts.
- A growth path instead of a compatibility wall: an unsupported opcode/address is DATA (a declared
  tier with a consumer), CI fails on undeclared gaps sorted by real frequency, and the F2 screen
  shows the same ledger in the field.

## What the close-out itself caught (the reason audits exist)

- **The 0AE2 walk never exhausted** — both hosts ignored `findNext`, so vandoor burned its full
  10 000-instr budget every tick a car sat within 200 m (~3 ms/tick standing tax in the field;
  the postmortem had recorded this exact defect shape for the mock only). Fixed in both hosts;
  corpus 3 771 → 465 µs/tick, and the trace-snapshot fixture caught the story change byte-exactly.
- **A blind reporting lane**: struct ops on native pointers called `onUnimplemented` directly,
  bypassing the coverage counter — the field's `0D4E unimplemented` warn had no row anywhere. The
  reads now route through the memory facade: nameable addresses resolve, the rest land in the
  atlas miss ledger as DECLARED rows (windfarm's model-info field, cardoor's task struct), visible
  in F2 and enforced by the corpus join.

## Debt taken, named

- `docs/hacks/cleo-frame-sibling-order.md` — frame-order adjacency stands in for dropped parent
  links (rhino's track chain rig block; user's call: 097/08 authors our own track script instead).
- Wind is 0 and `lodDistMultiplier` is 1 in the native world — stand-ins recorded in
  `engine-cleo-setup.ts` rather than fabricated constants.
- The wheel's UV-anim blink is [plan 099](../plans/099-script-object-uv-anim/readme.md); ped-task
  opcodes (class C) stay declared-inert until a task system exists (city-life territory).
