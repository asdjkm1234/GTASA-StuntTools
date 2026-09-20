# 097/03 — Script VM & thread scheduler (engine-agnostic core)

The execution core: a cooperative SCM thread engine with an opcode-handler registry. Knows nothing about
the engine — the extensibility keystone. Carried from the old chain essentially unchanged (it was
designed engine-agnostic), with three additions the corpus forced: a stdlib domain, a budget re-check
against rhino, and the isolation rule tied to the real frame loop.

## Decisions

1. **Engine-agnostic VM.** Operates on decoded instructions + an injected `CleoHost`. The VM implements
   control flow, vars, waits, dispatch; world opcodes are handlers calling `host.*`. Fully unit-testable
   with a mock host ("createObject called with model X at x,y,z").
2. **Handler registry.** `registerOpcode(id, handler)`; `handler(ctx, operands) → OpcodeResult`; `ctx` =
   thread ops (vars, condition flag, jump/gosub/return, wait) + host. Built-ins are the control-flow
   set: WAIT `0001`, GOTO `0002`, GOTO_IF_FALSE/TRUE `004D/004C`, ANDOR `00D6`, gosub/return
   `0050/0051`, CREATE_THREAD `004F`, NAME/END `03A4/004E`, TERMINATE_THIS_CUSTOM_SCRIPT `0A93`, and
   **CLEO_CALL/CLEO_RETURN `0AB1/0AB2`** (gosub-with-params — Wind Farm calls it 72×; args copy into a
   fresh local frame, returns copy back into the call site's output vars).
3. **Var model.** Per-thread locals 0–31 + timers 32/33 auto-advancing on game delta; shared global
   block; arrays; 32-bit slots reinterpreted int/float per operand type; ANDOR state machine; negated
   conditionals (`0x8000`).
4. **Stdlib domain — engine-independent CLEO+/NewOpcodes the corpus uses, implemented IN the VM
   package** (no host round-trip for things with no engine meaning): lists `0E72/0E74/0E77/0E78/0E79`,
   scratch memory `0AC8/0AC9` (plain ArrayBuffers behind tokens — NOT the native address space),
   string format `0AD3`, math (`02F6/02F7` sin/cos, `0208` random range, `0604` heading-from-vector,
   perlin `0EF1` — a deterministic implementation, judged in the field on Wind Farm's sway), struct
   params `0D37/0D38/0D4E` over stdlib buffers.
5. **Cooperative scheduler on GAME time.** `tick(deltaGameMs)`; waits pause with `gameState`; time
   comes IN as a delta — no `performance.now()` in the core (the camera-chain purity rule; replays and
   tests feed synthetic deltas).
6. **Budget, re-measured.** Per-frame per-thread instruction budget so a WAIT-less loop yields instead
   of hanging the tab. The old 0.2 ms/frame target must be validated against the corpus's worst case:
   rhino tracks runs ~2 000 instructions per frame BY DESIGN (per-wheel math, then WAIT 0) — the budget
   must let it finish while still bounding a runaway. Measure, then set; record both numbers.
7. **Failure isolation lives HERE.** The VM catches every handler throw, kills THAT thread with a
   located log, and returns cleanly — because the host wiring runs inside `runFixedSteps`, whose
   try/catch de-dupes into `reportedFixedStepErrors` and a leaked throw would poison the physics step
   (recon fact). Deterministic + observable: same script + same host responses → same execution;
   unknown opcode → `host.onUnimplemented(id)` (default log-once + tier policy, plan 07).

## Subtasks

- [x] `CleoHost` interface stub (facet shapes declared; plans 04/05 implement).
- [x] Thread type (IP, locals+timers, condition flag, gosub stack, wait) over plan 01's `offsetIndex`.
- [x] Built-in control-flow handlers + per-handler unit tests (jump lands, condition consumed, gosub
      nesting, ANDOR combining, CLEO_CALL frames/returns, wait yields, negation).
- [x] Var read/write + operand→value resolution + tests (int/float reinterpret, global/local/array).
- [x] Stdlib domain + tests (lists, scratch buffers, struct params, string format, math incl. a
      perlin fixture).
- [x] Registry + dispatch loop + instruction budget + unimplemented path + throw isolation.
- [x] `ScriptRunner`: thread lifecycle, `tick(deltaGameMs)`, dispose.
- [x] Headless integration: Ferris Wheel decoded (01) runs on a mock host and produces the exact
      expected host-call trace over N ticks (via `cleo-run`, plan 02); a no-WAIT loop hits the budget
      and yields; a throwing handler kills one thread and the other keeps running.

## Verification

- Ferris Wheel → exact host-call trace, fully headless (becomes a plan 07 snapshot fixture).
- Wind Farm runs headless to its model-request loop with only stdlib + mocked host facets.
- Budget guard proven; rhino's per-frame instruction count measured and recorded.
- SCM semantics on corpus fixtures: negated conditionals, ANDOR groups, gosub nesting, CLEO_CALL.

## Ledger

_(filled 2026-08-04 — `packages/cleo/src/vm/`; 79 package tests green)_

- **Budget: 10 000 instructions/thread/tick** (default, overridable). Measured against the corpus,
  silent host, 60 fps deltas: the worst REAL tick is windfarm's one-time build phase at 3 450
  instr/tick (32 turbines of CLEO_CALL work in one frame) — ~3x headroom under the budget; a
  synthetic WAIT-less loop hits the budget, yields cleanly and resumes next tick with no lost
  progress (tested). Steady state: ferris 257 instr / 0.051 ms per tick, windfarm 148 instr /
  0.030 ms — comfortably inside the old 0.2 ms/frame target. **Rhino headless-empty runs only ~5
  instr/tick** (its ~2 000/frame by-design load walks LIVE cars through plan 05's natives — the
  budget re-check against the real thing happens at the plan 05 field checkpoint).
- **Built-ins**: control flow (0000/0001/0002/004C/004D/004E/004F/0050/0051/00D6/03A4/0A93,
  CLEO_CALL 0AB1 + CLEO_RETURN 0AB2 with fresh zeroed frames, raw-bit arg copy, outputs copied
  back), the whitelist var/compare/arith grid (31 ids collapsed onto int/float x op combinators —
  TIMED ops scale by delta/20 ms, the SA `ms_fTimeStep` unit from gta-reversed CTimer), world
  handlers for every corpus opcode with engine meaning (thin calls onto `CleoHost` facets).
- **Stdlib**: lists (0E72/74/77/78/79), scratch buffers behind tokens >=0x40000001 (0AC8/0AC9),
  struct params 0D37/0D38/0D4E over those tokens (a NON-token pointer routes to `onUnimplemented`
  and leaves the target untouched — plan 05's memory facet takes those over), STRING_FORMAT %d/%s/
  %f/%x/%%, SIN/COS in degrees, injectable 0208 random, GTA heading 0604, deterministic classic
  Perlin 0EF1 (fixed permutation; judged in the field on Wind Farm's sway at plan 05).
- **Unimplemented policy** (tier-b default, plan 07 refines): `host.onUnimplemented` once per id;
  conditionals get FINAL condition=false with negation NOT applied — "the check did not pass".
- **Ferris headless is the whole class-A story**: request 14644-14647 -> poll -> base + wheel
  HD/LOD (CONNECT_LODS) + lights HD/LOD + 16 seats -> per frame the wheel angle advances (~4.8
  deg/s via 0079) while every seat rides the rim through SIN/COS setCoordinates (~16 calls/frame).
  Windfarm reaches its model-request loop and its 0A8D reads surface as unimplemented, zero faults;
  cardoor degrades cleanly (ped-task ops unimplemented, zero faults).
- **0E01's two trailing flag operands ride along unread** (corpus always passes 0 0) — recorded
  here so plan 04's CREATE_OBJECT facet does not silently re-discover them.
- Census join is live: `cleo-census` now reports vm/todo per opcode — 90 of the 115 corpus ids are
  VM-served; the 25 `todo` are exactly the plan 05 natives + the deferred class-C ped-task/ini set.
