# 098/03 — Bike & BMX physics (the two-wheel controller)

**Goal:** motorcycles, bicycles and quads ride believably: upright by controller, leaning into corners,
wheelie/stoppie on demand, bunny-hop on the BMX — driven by the authored `!` rows (01), executed by our
solver. mtruck/quad verified on the generic path. **Field checkpoint 1: an NRG-500 and a BMX ride
believably through Ganton.**

## Phase 0 — the spike (pulled to priority Order 0)

Teach `WHEEL_*` recognition the bike names, re-bake ONE bike, spawn it, ride it as a narrow car:

- `build-vehicle-model.ts:71-72` regexes gain `wheel_front`/`wheel_rear` (front = the word, not a letter
  code); `chassis` handling is shared. Bake `nrg500` + `bmx`.
- Spawn via the F2 spawner (already unfiltered, `vehicle-models.ts:46-53`), mount via the instant path
  (`seatInstantly`, `enter-vehicle.system.ts:503-519`) — the door machine is 07's problem.
- Questions the spike answers: does the bike COL give a sane convex hull; does a two-wheel raycast layout
  stand or fall over at rest (expected: falls — that failure is the requirement spec for the balance
  controller); does `isUpright` (`enter-vehicle.system.ts:986-990`) block re-entry after a fall; what the
  `[phys]` capture channels show with `wheelSpan` no longer 0.

A negative surprise here (e.g. the raycast controller cannot carry a 2-wheel layout at all) reshapes this
whole plan before anything else is built on it.

## What exists (recon 2026-08-04)

- Physics is wheel-count agnostic (`createDynamicVehicle`, `physics-world.ts:606-693`); wheels come from
  model dummies baked into the `.osm`; `front` derives from the dummy NAME (`build-vehicle-model.ts:692`).
- Bike models author `wheel_front`/`wheel_rear` + `forks_front`/`forks_rear`/`handlebars` — none
  recognised today; steering visuals for a bike belong on the fork/handlebar frames, not wheel yaw.
- The `!` table (01) carries per-bike lean geometry: COM shifts, max/desired lean, wheelie/stoppie angles
  and stability multipliers. Main rows (`BIKE`, `MOPED`, `DIRTBIKE`, `BIKE_STANDARD`s, `QUADBIKE`, the
  BMX rows) already flow through the normal handling path.
- 081's field doctrine (memory `audit-081-grip-stance-findings`): the accepted feel is NOT SA-faithful;
  assists are lateral-only; the steering limiter must be fed the same adhesion as the tyre; when a
  complaint survives multiple physics swings, hunt a masking bug in the input chain.
- Shared tuning constants live in `physics-world.ts:16-259`; per-car scaling is applied on top of the
  authored row — a bike must NOT grow bike-only global constants without a `docs/hacks/` entry.

## Steps

- [ ] **Spike** (above) + record its verdicts here before designing further.
- [ ] **Frames & contract.** `wheel_front`/`wheel_rear`, `forks_*`, `handlebars` into the model build +
      `docs/contracts/vehicles.md` §3 (what a misnamed fork does: wheel still simulates, steering visual
      freezes — silent, so the contract row says it).
- [ ] **Balance controller.** Upright + lean-target control as our own solver layer over the chassis
      body: lean into commanded curvature up to `MaxLean`, COM shift from `LeanFwdCOM`/`LeanBakCOM`,
      gyro-like damping, low-speed balance assist fading in below a measured speed. Formula grounding
      from gta-reversed (`CBike::ProcessDrivingBehaviour` and friends) for what the `!` numbers MEAN;
      integration is ours. Casts stay inside the shared collision-cast budget (restriction).
- [ ] **Wheelie / stoppie.** Explicit player intent (accel + lean-back, brake + lean-forward), authored
      `WheelieAng`/`StoppieAng` as the angle envelope, stability multipliers damping about the envelope.
      Telemetry channel for pitch envelope + time-in-wheelie.
- [ ] **BMX & bicycles.** Pedal cadence ↔ speed from the authored row (no engine sound side yet), sprint
      pump as burst accel, bunny-hop as a charged jump impulse honouring the authored hop strength
      (gta-reversed `CBmx`); stamina hook recorded as extension, not built.
- [ ] **Quad + mtruck verification.** Spawn each (quad, dumper, monster*), measure on the standard
      scenes; fix what the measurements name (expected: monster wheelScale/travel extremes stress the
      sag rule from 081). No speculative work.
- [ ] **Scenes + gate.** New `?phys=` scenes: bike-straight, bike-slalom, wheelie-hold, bmx-hop;
      `PHYS_CARS` gains a bike; captures record the active `!` row (self-describing rule);
      `phys-regression.ts` bands extended — car bands must not move.

## Verification

Headless: the new scenes' captures within designed envelopes; car regression gate green. Field: ride
NRG-500 and BMX through Ganton — lean, U-turn at low speed, wheelie on demand, bunny-hop onto a kerb;
verdicts recorded per reporter's angle. Numbers (lean angles reached, wheelie hold times, fall events)
into `docs/benchmarks/vehicle-physics/` before analysis.

## Ledger

(spike verdicts; per-step capture numbers; field verdicts verbatim, paraphrased to English)
