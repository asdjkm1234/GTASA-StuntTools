# 06·3·01 — Ped rendering: from one skinned character to a crowd

[← chain](../readme.md) · needs: nothing external · next: [02 ped LODs](02-ped-lods.md)

The engine can render exactly ONE skinned character today (`Engine.ped` is a single slot —
`setPedProbe` destroys the previous occupant; the only consumer is the player). Everything crowds need
— many skinned instances, shared animation, streaming ped models — is new engine work. This plan is
the peds track's foundation and is deliberately independent of the traffic plans.

## Current state (verified 2026-08-02)

- Data chain COMPLETE offline: every `peds.ide` model is converted to `.osm` by pack-peds (skin,
  bones, inverse binds, SKEL); IFP parsing + our keyframe-slerp sampler (`ifp-sampler.ts`) are live for
  the player (plan 088 locomotion).
- Renderer: `drawPed` = one non-instanced draw per submesh, one palette upload, one slot. No ped
  streaming ("`ped-load` has no runtime path at all" — plan 091).

## Design

- **Ped model streaming**: a ped-model cache keyed by name (the vehicle model cache pattern), lazy
  load via `AssetFileSystem`, boot census, LRU eviction with refcounts. Models arrive one at a time at
  the streaming radius — the 091 verdict says per-type cost at arrival rate is a non-issue; keep it
  that shape (never batch-load a zone's whole roster in one frame).
- **Multi-instance skinned pipeline** (replaces the single slot; the player becomes instance #0):
  - Ring 0 (near, full anim): per-instance bone palettes in one storage buffer, palette count capped
    (start: 16 near peds), individual clips/mixing — the player's locomotion machinery reused.
  - Ring 1 (the crowd tier): **palette sharing by phase bucket** — one shared walk/idle clip set per
    model class, animation phase quantized to N buckets (start: 16), ONE palette per (clip, bucket)
    per frame, instances reference a bucket index. Hundreds of walkers cost tens of palette uploads,
    and draws batch per model. This is the crowd trick that makes 3/03's densities affordable.
- Draw path: instanced draw per (model, LOD tier) group; CPU frustum cull per agent (points in sim).
  The ped shader is its own lean pipeline — the rigid path's 15/16 varying budget is not our problem
  to inherit.
- Peds get no AO/shadow work in this plan (recorded gap already); lighting parity with the player's
  current model is the bar.

## Goals gate

1. *Authored data:* ped meshes/skins/IFP clips as shipped; `peds.ide` roster as the model universe.
2. *Original:* SA drew maybe a dozen peds in a bubble with full skinning each; palette-bucket crowds
   are our execution.
3. *Better:* crowd counts SA never reached, no per-ped anim cost explosion — demonstrated by the bench
   gate below.
4. *Cost:* gate set NOW: **100 visible ring-1 walkers + 16 ring-0 peds ≤ +1.0 ms GPU at 2× retina and
   ≤ 0.5 ms CPU** (anim sampling + palette writes). Stated in `gpuMs.pass`/draws like everything else.
5. *Contract:* `.osm` ped sections unchanged; new engine API documented in architecture docs.

## Verification

- Unit: palette bucket math, cache eviction, instance grouping (negative-first as always).
- Lab scene: N-walker grid with model variety sweep (1 → 8 models × 10 → 200 instances), bench row
  per point — the scaling curve is the deliverable, recorded here.
- Field: player unchanged (regression — the locomotion feel must not move); a spawned test crowd walks
  a sidewalk without hitches; soak clean.

## Tasks

- [ ] Ped model cache + streaming + census + eviction.
- [ ] Instanced skinned pipeline + palette storage (ring-0 individual, ring-1 bucketed).
- [ ] Player migrated onto instance #0 (no feel change — field-checked).
- [ ] Lab scaling scene + bench rows.
- [ ] Docs: architecture (render path), features/character.md gap update.

## Measured numbers

- Scaling curve (models × instances → GPU/CPU ms): —
- Palette uploads/frame at 100 walkers: —
- Player regression verdict: —
