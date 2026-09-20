# 097/07 — Extensibility, debug surface & close-out

Turns "seven scripts run" into "we support CLEO": coverage as data, the tracer in F2, explicit
unimplemented tiers, the add-an-opcode/add-an-atlas-row flow, and the chain's documentation + audit
close-out.

## Decisions

1. **Opcode coverage as data, in CI.** `cleo-census` (plan 02) joined against the handler + tier +
   atlas registries runs in CI over the SHIPPED `cleo/` scripts of every game build — a newly
   installed mod's unsupported opcodes/addresses surface at build time, sorted by real frequency
   (the next-handler priority list writes itself).
2. **The tracer IS the debugger.** `cleo.trace`: per thread, each dispatched opcode (Sanny name) +
   operands + host effects + waits — and atlas ops as SYMBOLS ("GetFrameFromName('misc_a') → part 7"),
   never raw addresses. Readable as a story.
3. **F2 CLEO screen, the `PhysicsPanel` pattern exactly** (recon: there is no registry — the flow is
   mechanical): a `Screen` literal + capability flag in `debug-capabilities.ts`, gate in
   `SCREEN_CAPABILITY`, accessor members on `DebugActions` (`debug-overlay.tsx`), implementations as
   thin host closures in `engine-debug-actions.ts`, deps wired in `engine-canvas-host.tsx`. Screen
   contents: enable/trace toggles, running-thread list (name, state, wait, instr/frame), per-thread
   trace view, coverage summary (implemented/unimplemented counts + the unserved-address list from
   plan 05), a step-one-thread affordance. Unsupported rows hidden, never dead (the doctrine).
4. **Unimplemented tiers, explicit per opcode AND per atlas row**: (a) no-op-continue (cosmetic),
   (b) conditional-default (defined result, usually false — class C's task opcodes live here so Car
   Left Door degrades to "detected, did nothing, said why"), (c) kill-thread (genuinely unrunnable).
   Unknown default = (a) + once-per-opcode warning feeding coverage.
5. **"Add an opcode" and "add an atlas row" are documented one-file flows** (module README): RE the
   semantics (Sanny DB + GTAMods wiki / gta-reversed) → host method if a new capability → register →
   declare tier → fixture test. This is the growth path the whole chain was shaped for.
6. **Corpus regression**: every supported script snapshots its headless host-call trace as a fixture
   (Ferris + Wind Farm + firela + van door + rhino + Car Left Door's degraded trace); the corpus
   re-runs on handler/atlas changes (the physics-CI philosophy applied to scripts).
7. **Docs close-out in the same change set** (the standing rules): `docs/features/cleo.md` (+ README
   row), `docs/architecture/` module doc + mermaid diagram (`arch:render`), `docs/contracts/` already
   done in 06, `docs/commands.md` tool rows done in 02, memory cross-links updated. **Chain close =
   audit in `docs/audit/` + before/after benchmark in `docs/benchmarks/`** (big-rework rule): boot
   cost with N scripts, steady-state per-frame VM+host+atlas cost with the full corpus live, versus
   `cleo.enabled: false`.

## Subtasks

- [x] Census→registry join + CI step over shipped scripts. _(2026-08-05: `corpus-coverage.test.ts` —
      fixture-gated vitest join over the regenerated corpus; an unserved opcode with no declared
      tier fails the build sorted by frequency, and every declared row must have a real corpus
      consumer. The census CLI keeps its vm/todo column; the CI gate is the test.)_
- [x] Tracer (symbolised atlas ops) + trace ring buffer sized for the F2 view. _(2026-08-06:
      `vm/trace.ts` — a true circular ring (512 default), instruction lines in the disasm contract
      format with the CONDITION ANSWER appended post-dispatch (the windfarm "diff the gate answers"
      lesson as a feature), host effects indented under their instruction; `AtlasMemory` gained an
      `onOp` seam emitting symbols ("read CWeather::Wind -> 0.400", "GetFrameFromName(car#257,
      'misc_a') -> part 7"), never raw addresses. Off = one boolean per instruction; ~×1.9 per-tick
      when ON. Runner also gained per-thread `instructionsLastTick`, `now`, `allThreads` and
      `step()` — one instruction, wait overridden.)_
- [x] F2 screen (decision 3) + capability plumbing. _(2026-08-06: `cleo-panel.tsx` on the
      PhysicsPanel pattern exactly — `cleoScreen` capability, menu row, narrow `CleoPanelActions`
      slice, 250 ms poll only while open; runner/trace toggles, thread list (state · wait ·
      instr/tick, click to filter), coverage + atlas-miss rows with tiers and UNDECLARED flags,
      faults, per-thread trace tail, step-one-instruction. `CleoRunnerSystem` grew the UI-agnostic
      debug surface; readout assembly is `cleoReadout()` in engine-debug-actions (unit-tested).
      Field-verified: 6 threads live, trace reads as a story.)_
- [x] Tier registries (OPCODE half) + default-unknown path + warnings→coverage plumbing.
      _(2026-08-05: `vm/tiers.ts` — `DECLARED_TIERS` data + `tierOf` fallback (DB condition →
      tier b, else noop); runner consults it, implements kill-thread (located fault, tick goes
      on), counts per-opcode hits and exposes `coverage()` worst-first. Per-ATLAS-ROW tiers
      remain: `AtlasMemory.misses` already records per-address — the tier attribute joins when
      the F2 screen consumes both.)_
- [x] Class C tier assignment: Car Left Door runs, boarding opcodes answer tier-b, coverage names
      the missing ped-task facet (pointer to city-life). _(2026-08-05: the declared set = 12 class-C
      rows (ini reads + task checks conditional-false; task performers noop) + 3 cosmetic text
      rows; each row's comment names its consumer, the city-life pointer is in the file header.)_
- [x] Module README: architecture, add-an-opcode flow, add-an-atlas-row flow, debug-a-script flow.
      _(2026-08-06: `packages/cleo/README.md` — the map table + the three one-file flows; the
      corpus-join tests are written into the flow as the walkthrough.)_
- [x] Trace-snapshot fixtures for the corpus + regression test. _(2026-08-06: run configs shared
      between test and generator in `vm/corpus-traces.ts` (seeded mulberry32 — windfarm rolls 0208),
      fixtures at `fixtures/custom/cleo-traces/` (first 400 lines + total-count footer: vandoor alone
      would be 6 MB), regenerated by `scripts/debug/cleo-trace-fixtures.ts`. Proved itself the same
      day: the `findNext` fix moved vandoor's story 117 997 → 1 121 calls and the snapshot failed
      byte-exactly.)_
- [x] Per-ATLAS-ROW tiers (the remaining half of decision 4). _(2026-08-06: `DECLARED_ATLAS_TIERS`
      keyed by `atlasMissKey` (`kind:detail`; sub-image-base token arithmetic buckets as
      `non-native address` so mock and field keys match); undeclared defaults mirror what the
      facade DOES (read/call → 0 = tier b, write skipped = tier a). Two corpus-join tests: no
      undeclared miss, no dead declared row.)_
- [x] Docs + audit + benchmark close-out (decision 7). _(2026-08-06: audit
      [`docs/audit/cleo-basic-097.md`](../../audit/cleo-basic-097.md) · benchmark
      [`docs/benchmarks/opensa-engine/2026-08-06-headless-cleo-vm-cost.md`](../../benchmarks/opensa-engine/2026-08-06-headless-cleo-vm-cost.md)
      + index row · architecture doc `docs/architecture/cleo-scripts.md` + rendered diagram ·
      features/cleo.md state · commands.md + debug README rows.)_

## Ledger — phase B, close-out (2026-08-06)

`packages/cleo` 138 tests / apps-web ui 479+ tests, all green; tsc + eslint clean. The numbers
(full detail in the benchmark doc):

- **Boot**: decode+spawn 7 corpus scripts median 0.23 ms.
- **Steady state, whole corpus on the VM**: 465 µs/tick (~2 180 instr/tick) headless; tracer ON
  ≈ ×1.9 (debug toggle, default off); `enabled: false` = one branch (~1 ns).
- **Per script**: cardoor 2.3–2.5 µs · firela 3.9 · vandoor 29 · ferris 63 · windfarm ~100 ·
  rhino ~300 (peak 1 334 instr/tick vs the 10 000 budget).
- **Field** (canonical `build/original/opensa`, vite dev): census 6 scripts, F2 CLEO screen live —
  1 572 instr/tick, 21 script objects at the wheel, coverage `0E43 ×780` / `0AF0 ×20`
  conditional-false, declared atlas miss `read non-native address (size 4)`.

The close-out caught and fixed two defects the machinery was built to catch:

1. **`carInSphere` ignored `findNext` in BOTH hosts** — the exact defect the intake postmortem
   recorded for the mock (`no_lights.cs`) was also LIVE in the engine host: vandoor's 0AE2 walk
   never exhausted, so it burned the full 10 000-instr budget every tick a car sat within 200 m
   (~3 ms/tick standing field tax; headless corpus measured 3 771 µs/tick). Both hosts now run a
   real walk cursor (restart / resume / exhaust-to-null): corpus 465 µs/tick, vandoor ~100× down,
   and the trace snapshot pinned the new story.
2. **Struct ops bypassed the coverage counter** — 0D37/0D38/0D4E on a native pointer called
   `onUnimplemented` directly (the field's `0D4E unimplemented (wind farm)` warn had no row in any
   ledger). They now route through the memory facade: nameable addresses resolve (0D4E on
   `CPools::ms_pVehiclePool` serves), everything else is a REPORTED atlas miss answering a
   deterministic 0 — declared rows for windfarm's model-info field read (size 4) and cardoor's
   task-struct reads (size 2), enforced by the join.

## Ledger — phase A (2026-08-05)

`packages/cleo`: 14 files / 112 tests green (new: `tiers.test.ts` 5, `corpus-coverage.test.ts` 2 —
the join runs over the real regenerated fixtures). Runner API additions: `coverage()`,
`ScriptRunnerOptions.tiers` override (tests + a future runtime policy). Remaining for close-out:
tracer + F2 screen + module README + trace-snapshot fixtures + docs/audit/benchmark.

## Ledger — field bug round (2026-08-05, between phase A and B; fixes verified headless)

Four user reports against the post-06 build, all diagnosed against `build/original/opensa`:

1. **"No ferris wheel, collision only"** — CLEO was simply off (`?cleo=1` restored it; the corpus
   `Config.cleo.enabled` default-ON decision — 06 decision 6 — is still open).
2. **Black screen near the wheel** (`Destroyed texture [array-22] used in a submit`) — streaming evicted
   a world texture array while a live `worldArrays` rigid model (the CLEO wheel) still held a CACHED bind
   group over it, and the cache stayed stale even after a reload. Fix: `Engine.releaseWorldArray(ref)` —
   keeps an array a live instance draws with, else drops every cached world-array bind group and unloads
   (engine.ts; streaming.ts `releaseTextures` routes through it). Tests: engine.world-arrays.test.ts
   (keep-alive negative + release/reload positive). A 60 s headless walk to the wheel under eviction
   pressure (texture 819 MB vs target 88): zero validation errors, wheel textured.
3. **Coach/bus missing driver-side front wheel** — BOTH stratumx MCI mods ship one corrupt ORPHAN vertex
   in `wheel_lf` (coach: ~5.8e25 m, bus: ~1.4e4 m; unreferenced by any triangle, so invisible in SA).
   `wheelRadius` scanned raw positions, read it as the authored radius, and the diameter fit scaled the
   wheel to ~0. Fix: measure over triangle-referenced vertices only (build-vehicle-model.ts + test);
   coach + bus rebaked (`vehicle-installer --rebake original --only coach|bus`), driver-side wheel
   verified present on both, headless.
4. **Coach un-enterable (Enter dead)** — `ENTER_RANGE = 4 m` was measured from the vehicle CENTRE; an
   11 m coach spent 5.6 m of it on its own body. Fix: range now measures to the oriented FOOTPRINT
   rectangle (enter-vehicle.system.ts + test). Headless: Enter beside the bus → approach → `SEATED` in
   the HUD. The `0D4E unimplemented (Car Left Door)` warn near the coach is the declared class-C tier
   doing its job (raw CVehicle pointer reads) — cosmetic door script, NOT the enter blocker; our own
   walk-up animator swings the door.

Also this round: F2 debug spawn places a car at `2.5 m + halfExtents[1]` ahead instead of a fixed 5 m
(an 11 m coach used to wrap around the player — `EngineVehicles.modelHalfExtents`), and the bug-round
tool itself: `tools-debug/bench-harness/warnings.js` (see benchmarks.md) — headless warning/error
collector with KEYS/TAGS, which verified every fix above without a human at the screen.

**Round 2 (same day, after the user re-tested):**

5. **Coach still entered through the NON-EXISTENT driver door** — the mod's `Car Left Door.cs` (decoded)
   catches the player's enter-as-driver ped task (0E43 id 800), reads the task's stage + vehicle from raw
   task memory (0D4E) and re-tasks entry as passenger + seat shuffle for ini-listed models (431/437).
   That whole mechanism is class-C by design; the engine now reads the same intent from the MODEL: door
   side selection prefers a side whose door PART exists (`doorSides` — the coach authors only `door_rf`,
   the bus's real entry), for entry AND the egress chain, and `doorApproachPath` routes AROUND the bumper
   when the only door is on the far flank (the straight line stalled against the body). Verified headless:
   driver-side approach → walk around → rf door → shuffle → `SEATED`. Models with no front door parts at
   all keep the old near-side behaviour.
6. **Ferris wheel does not BLINK** (original does) — diagnosed, deferred: the blink is a UVAnimDict
   (`f13d`) on `ferriswheel_lights.dff`'s film-strip texture; the script only rotates. The rigid/script
   object path has no UV-anim lane — recorded in `docs/edge-cases/engine-rendering.md`, planned as
   **[plan 099](../099-script-object-uv-anim/readme.md)** (2026-08-05).
7. **Rhino tracks do not rotate** (road wheels behind them do) — the KNOWN class-B rig block (05 ledger:
   the vehicle-optimizer drops empty parent frames + parent links; `docs/hacks/cleo-frame-sibling-order.md`).
   User's call 2026-08-05: SKIP — 097/08 authors our own track script instead. That intent is now
   the [`cleo/scripts/docs/plans/`](../../../cleo/scripts/docs/plans/readme.md) chain (001 rhino
   tracks — by-name frame addressing, bypassing the sibling hack; commissioned 2026-08-06).
   **CLOSED on OpenSA 2026-08-07** (001 step 5, field-confirmed: tread rolls, wheels roll). The
   diagnosis above was only PART of it, and the sibling hack was never the blocker: the original's
   chain anchor is `misc_e`, a dummy the builder does not emit as a part, so the walk never started
   at all. Two further causes, both fixed and neither script-side — the engine published no live
   wheel roll into the script-visible part state (so the tread read a constant angle), and the
   wheel-fitting rule inflated the model's flat MARKER wheel 23.5x. See 001's step-5 ledger.

## Verification

- Coverage report: classes A+B 100 % implemented; class C flags exactly the ped-task set with
  frequencies. A Ferris trace reads step-by-step without a decompiler. An unknown opcode follows its
  tier and shows in coverage. The benchmark records the corpus's total per-frame cost against the
  plan 03 budget, and `enabled: false` measures zero.

Coverage at close: classes A+B 100 % served; class C = the declared 15-row opcode set + 2 declared
atlas rows, every row with a live corpus consumer, zero undeclared gaps (both joins green).
