# 06·2·05 — ASI traffic: our city inside real San Andreas

[← chain](../readme.md) · prev (engine twin): [01–04](01-sim-core.md) · needs: 1/01 shipped, 2/01 spec+fixtures frozen

The suppressed streets (1/01) come back to life — driven by OUR simulation. Incremental by design
(the user's mandate: build it back up step by step): each stage is a shippable ini-gated feature, each
ports an engine-proven piece, and vanilla is one toggle away at every point.

## The staging (each stage = a Wine-validated release)

1. **v1 — far light rivers**: the C++ flow tick (ring 2 only) over SA's own in-memory graph
   (`ThePaths` — decision D2: whatever path files the modded install shipped, SA loaded them, we read
   SA's truth). Rendering via SA's corona API (`CCoronas`-family — to be catalogued). Visual floor:
   headlight streams beyond the (empty) vanilla bubble at night. No entities, no pools touched — the
   lowest-risk visible win, and it forces the sim port + graph reading to mature first.
2. **v2 — ring 0, cars that drive**: materialize real `CVehicle`s near the player from ring-1 agents
   through SA's own factories; drive them **v2a** via SA's autopilot primitives (bring-up: cars move,
   pools behave, promotion/demotion cycles clean), then **v2b** via our decision layer feeding vehicle
   controls per frame (the 2/02 decisions ported — SA keeps physics, we keep judgement; this is where
   SA-host drivers stop being idiots too). Ring-0 cap counted against the install's FLA ini pool
   values — counted, never bisected (sa-target restriction).
3. **v3 — vlo middle ring**: SA renders `_vlo` models at extended range for ring-1 agents (SA ships
   the meshes; the seam is its renderer's model+range path — RE target). If the RE cost balloons,
   v3 is skippable: v1+v2 already reads as a living city; record the decision either way.
4. **v4 — lights sync**: hook the `CTrafficLights` query/render functions so SA's own bulbs AND any
   remaining vanilla consumers (mission AI on scripted cars) see OUR controller phases (decision D6).
   Fallback if the hook set is too wide: our controllers ADOPT SA's global-timer phases near missions
   — one owner either way, choose by RE effort and record it.

## Parity with the engine (what "twin" means concretely)

- The C++ sim implements the 2/01 spec and passes the SAME golden fixtures (same graph slice keys
  `(area, nodeId)`, same seeds → same positions, tolerance stated per fixture).
- Divergences are HOST divergences by declaration (SA physics in ring 0, pool caps, its renderer) —
  listed in this file as they are found, each with why it is acceptable or what bounds it.

## Compatibility discipline (inherited, non-negotiable)

- Fresh RE catalogue rows for everything (CVehicle factories, autopilot fields, CCoronas, CTrafficLights,
  pool reads) — two-source rule, byte-verify + defer loudly, exact-exe guard, FLA/OLA coexistence.
- Mission safety: scripted entities keep their own paths untouched; our ring-0 cars are marked ours and
  never touch mission cleanup lists (RE: how scripts enumerate vehicles — our cars must be invisible to
  opcode sweeps or correctly owned; this is a catalogued design question, answered before v2 ships).
- Mods: known ambient-traffic CLEO/ASI mods double-populate by definition — detect the famous ones and
  warn in the log; ini `enabled=0` remains the universal answer.
- Every stage keeps the Wine ladder from 1/01 (dry-run → feature on → mission sample → coexistence →
  toggle-off).

## Goals gate

1. *Authored data:* same as the engine track (paths/popcycle/cargrp via SA's own loaded state).
2. *Original:* its population system is suppressed, not patched into a new shape — we replace the
   FEATURE, not its bytes; missions still get vanilla semantics where they touch traffic.
3. *Better:* streets beyond 100 m exist at all; drivers obey lights/crossings; demonstrated by
   side-by-side capture — engine vs SA, same seed, same junction, same phase (the twin proof).
4. *Cost:* SA frame budget respected — measure with the game's own frame counter under Wine per stage;
   v1 corona count capped by measurement.
5. *Contract:* the install keeps working with the ASI removed; sidecar read from `data/paths/` the
   same as the engine reads it.

## Tasks

- [ ] C++ flow tick + `ThePaths` reader + fixture parity harness (runs under the macOS host-compilable
      seam where possible, Wine for the rest).
- [ ] v1 coronas (RE: corona API) + night field check + frame cost.
- [ ] v2a factories/autopilot bring-up (RE: creation, ownership, cleanup, pools) → v2b our controls
      (RE: control fields); mission-invisibility answered and validated.
- [ ] v3 decision (RE sizing first) → build or record the skip.
- [ ] v4 lights sync (RE: CTrafficLights surface) or the adopt-fallback; record which and why.
- [ ] Per-stage: catalogue rows + patch docs + Wine ladder + numbers below.
- [ ] The twin proof capture (engine vs SA side-by-side) — the chain's flagship demo.

## Measured numbers

- v1: corona count / SA frame delta: —
- v2: ring-0 cap vs pool headroom; promotion cycle cost: —
- Fixture parity: max positional divergence per fixture: —
- Mission sample verdicts per stage: —
