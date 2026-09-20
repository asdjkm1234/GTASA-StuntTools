# 06·4·02 — ASI trains (stretch)

[← chain](../readme.md) · prev (engine twin): [01 trains engine](01-trains-engine.md) · needs: 2/05 machinery

Scheduled trains inside real SA. Explicitly a STRETCH plan — the mission-train entanglement makes this
the riskiest ASI phase, and the chain does not gate on it. It ships last or it ships never; either
outcome is recorded.

## Why the risk is real

- Missions create and drive trains through script (Wrong Side of the Tracks, Snail Trail…); the
  vanilla ambient train generator and the mission path share CTrain machinery. Suppressing ambient
  trains without touching mission trains needs provenance RE that is finer than the car/ped case.
- The community record is a warning: train mods break missions notoriously. 100 % mission compat is
  the chain's first commitment — so this plan's bar is higher than its value.

## Staging (each rung can be the last)

1. **v0 — leave vanilla trains alone** (the 1/01 default, already true). Cost: our SA host has random
   trains while the engine has scheduled ones — a declared, acceptable host divergence.
2. **v1 — schedule the vanilla generator**: hook only the ambient generation seam (WHEN a train
   spawns), leaving CTrain driving itself — our timetable, SA's train logic. Mission trains untouched
   because we never touch creation-by-script. If the RE shows the generation seam is clean, this is
   the sweet spot: schedules + crossings lookahead in SA at minimal surface.
3. **v2 — full twin** (our consists, our speed segments, station dwell): only if v1 proves the
   provenance boundary airtight across the full train-mission sample.

## Goals gate

1. *Authored data:* `tracks*.dat` via SA's own loaded state; our sidecar timetable.
2. *Original:* CTrain kept as the execution host at every rung — this is the one place we deliberately
   ride the original's logic in ITS OWN game, because mission compat outranks execution ownership
   (the one-line justification directive 3 demands).
3. *Better:* deterministic timetables + crossings that close ahead (v1 already delivers both).
4. *Cost:* negligible (a spawn-time seam); measured anyway.
5. *Contract:* ini-gated (`trains` section); v0 fallback always available.

## Verification

- Full train-mission sample under Wine at every rung (both stock train missions + a freight-yard save).
- Crossing behaviour: barriers close ahead at our scheduled arrivals (the 2/03 lookahead consuming the
  same timetable).
- The twin capture: the 14:03 freight at the same crossing, engine vs SA, same clock.

## Tasks

- [ ] RE: ambient train generation vs script creation provenance (two-source; this decides v1 go/no-go).
- [ ] v1 seam + timetable feed + Wine ladder + mission sample.
- [ ] v2 go/no-go on v1's evidence; build or close this plan at v1 with the verdict recorded.

## Measured numbers

- Provenance RE verdict: —
- Mission sample results per rung: —
