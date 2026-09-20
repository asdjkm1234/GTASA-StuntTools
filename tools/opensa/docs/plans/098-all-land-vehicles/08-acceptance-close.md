# 098/08 — Acceptance & close-out (the big-rework rule)

**Goal:** the chain ends the way the repo requires a big rework to end: per-class acceptance drives, the
regression gate extended and green, before/after benchmarks committed, an audit written, and every doc
the chain touched settled in the same state as the code.

## Steps

- [ ] **Acceptance programme.** One field session per class family with the user driving: bikes (NRG +
      BMX), quad/mtruck, an artic combination, a lowrider, plus the sedan control. Each verdict recorded
      from the reporter's exact angle; a complaint that survives a fix triggers the second-cause rule
      before re-tuning (the 081 lesson).
- [ ] **License plates — the measured half 082 deferred here** (that plan's "Left unmeasured", user's call
      2026-08-01; the handoff was named there but never landed as a row until 2026-08-12). Four readings, all
      on the acceptance drive rather than a pass of their own: the **city distribution** over LS→SF→LV
      (parked plates match their district) and the countryside mix; **slots used** on a full-map drive plus
      the per-spawn overhead (`PlateSlots.used` is the ledger number); the plan-03 **bench guard** — draws
      and GPU time on the vehicle scene unchanged by plates; and **ram a plated car** — deformed panel keeps
      its plate, second hit drops it with the part. The behaviour is structural and unit-guarded (082/04's
      close-out ledger), so this is a confirmation, not a risk: a missing plate on a `_dam` twin is
      acceptable (SA behaves likewise), a crash is a bug.
- [ ] **Regression gate.** `phys-regression.ts` bands cover the new scenes (bike straight/slalom/
      wheelie, trailer stability) against reference captures committed to
      `docs/benchmarks/vehicle-physics/`; the pre-098 car bands are unchanged — proof the fleet work
      did not move the accepted car feel.
- [ ] **Performance benchmark.** Before/after drive benchmark with a representative busy scene
      (bikes + an artic + ability cars live) — the `vehicles` slice (`live`, `meanMs`, `maxMs`) is the
      headline number; the balance controller and joints must fit the fixed-step budget 081/07
      established. Numbers into `docs/benchmarks/opensa-engine/` with the pak build named.
- [ ] **Audit.** `docs/audit/all-land-vehicles-098.md`: what changed (parsers, module, controller,
      joints), what it cost (frame numbers, code size), what it bought (the fleet census before/after —
      from "144 of 201 land rows drivable" to the closing number).
- [ ] **Docs settle.** `docs/features/vehicles.md` + `vehicle-special-abilities.md` states final;
      `docs/contracts/vehicles.md` vocabulary complete for everything shipped;
      `docs/architecture/` vehicle module doc + diagram re-rendered; hacks/restrictions/edge-cases rows
      match reality; `docs/commands.md` for any new CLI/URL params; the 0.6.0 out-of-scope note checked
      against what actually shipped.
- [ ] **Memory.** The session memory carries only what the repo does not: field-verdict nuances and any
      trap that cost a round.

## Verification

The audit and benchmark files EXIST and are linked from the plans index row — a chain without them is
unfinished by definition (CLAUDE.md standing rule).

## Ledger

(final census, benchmark links, audit link)
