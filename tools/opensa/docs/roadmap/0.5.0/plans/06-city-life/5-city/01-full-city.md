# 06·5·01 — The full city: density, scenarios, and the acceptance program

[← chain](../readme.md) · needs: everything before it · the chain's exit criteria

The point of the whole chain (commitment 6): the ILLUSION of a complete city — streets filled, life
visible to the fog line, the GTA-V feeling that the world does not revolve around you. This plan turns
"feels alive" into scenarios, numbers and field verdicts, then tunes density until they pass.

## What "reads like GTA V" means here (measurable, per goals directive 6)

- **No dead frames**: from any rooftop or hill at noon, moving vehicles are visible on every major
  road in view; at night, headlight rivers trace the arteries to the fog cut.
- **No spawn theatre**: nothing pops into existence in view (dithered bands + off-frustum promotion
  hold); a followed car keeps existing (identity across rings — tail one for 2 km, it stays itself).
- **Character by place and hour**: downtown noon ≠ downtown 4 am ≠ desert noon — the popcycle curves
  are VISIBLE in the world (a census overlay proves densities track the authored tables).
- **The player is incidental**: traffic flows in districts the player has not visited this session
  (ring 2 runs city-wide within memory budgets — agents are data, not entities).
- **It survives being watched**: 10 minutes parked at a busy junction — lights cycle, queues build
  and drain, peds cross, no deadlock, no drift in frame time (soak discipline applied to a fixed spot).

## Density tuning (the knob work, done LAST)

- Alive-seed multipliers per ring against the authored densities — the popcycle character is the
  SHAPE; our multipliers scale it to modern expectations (SA's `#Cars` caps were a 2004 budget —
  legacy limits are not our limits, and the caps' MEANING (relative character) is what we honour).
- Tune on the gate scenes with the 2/04 GPU gate and 2/01 sim gate as hard walls; every accepted
  multiplier set recorded here with its scene numbers.
- The SA host gets its own (lower) multiplier set bounded by pools — same shape, host-scaled (2/05).

## The acceptance program (the chain's exit)

| Scene | What must hold |
| --- | --- |
| Rooftop LS noon, 360° pan | moving traffic on every visible artery; ped presence on every sidewalk block; ≤ gate frame times |
| The Strip, night drive | headlight rivers + lit junctions breathing red/green to the fog line; the money shot captured |
| Market junction, 10 min parked | the survives-being-watched list above, census overlay recording |
| Country highway dusk | sparse but never dead; a train crossing closes ahead of the freight once per timetable |
| Mulholland → Verdant Bluffs flight (`?bench` row) | full population inside ALL perf gates, the permanent regression row |
| The twin capture | engine vs real SA, same seed/clock/junction — the chain's proof artifact |

Every scene: numbers into `docs/benchmarks/` first, verdicts here, representative log lines kept.
The final verdict is the driver's seat's (goals directive 4) — the numbers qualify it, never replace it.

## Goals gate

1. *Authored data:* the popcycle/pedgrp/cargrp character, made visible at modern scale.
2. *Original:* a ~100 m bubble; ours is a city.
3. *Better:* this plan IS the demonstration.
4. *Cost:* the standing gates, now measured all-on simultaneously (sim 2 ms + far 1.5 ms GPU + peds
   1.0 ms GPU + trains 0.2 ms — the composed budget is the real test).
5. *Contract:* density multipliers are config (documented), never data-file edits.

## Tasks

- [ ] Census overlay (live counts per ring/kind vs authored targets) — the tuning instrument.
- [ ] City-wide ring-2 memory budget check (agents-as-data at full map scale; record bytes).
- [ ] Density tuning rounds on the gate scenes; multiplier sets + numbers recorded per round.
- [ ] The acceptance table, scene by scene; the twin capture.
- [ ] Post-chain audit (`docs/audit/`) + bench rows — a rework this big is unfinished without both
      (CLAUDE.md standing rule).

## Measured numbers

- Composed all-on frame budget at the gate scenes: —
- Ring-2 city-wide agent count / memory: —
- Accepted multiplier sets: —
- Acceptance verdicts: —
