# 06·3·03 — Ped simulation: sidewalk life

[← chain](../readme.md) · prev: [02 ped LODs](02-ped-lods.md) · needs: 1/02 (ped graph), 1/03 (#Peds), 2/01 (agent machinery), 2/03 (walk phases)

Ambient pedestrians on the ped graph — the same SoA agent machinery as traffic (2/01), different
graph, different LOD chain, gentler sim (slow speeds forgive coarse ticks). Scripted/mission peds stay
gameplay objects — this is ambience only. Retires the last graph hack:
`docs/hacks/pedestrian-route-on-a-vehicle-graph.md` (walk routes = road + 6.5 m offset) dies when video
mode's walk legs move onto the REAL sidewalk graph.

## Design

- **Graph**: the ped node set + links from 1/02 (SA ships a full sidewalk graph we currently skip);
  crossings linked to road nodes at light-controlled junctions get walk/don't-walk phases from the
  2/03 controller (peds are just another phase consumer).
- **Agents**: ped rows in the 2/01 SoA stores (kind = ped): follow links at per-agent walk speed
  (seeded personality), stop at crossings, cross on walk, seeded idles (stand/phone/look — one small
  state machine, one idle clip set from the stock anim pool). No combat, no reactions, no player
  interaction physics in v1 — ambience first, systems later (recorded as the deliberate scope line).
- **Population**: `#Peds` × zone × hour from 1/03 (the columns the parser used to throw away);
  model pick via pedgrp weights; alive-seed control identical in shape to traffic's.
- **Rings**: ring 0 peds are kinematic capsules (the player's collider machinery — peds must not be
  walk-through-able at touch range, but they are NOT dynamic bodies); ring 1 = rendered walkers, no
  collider; ring 2 = silhouettes. Ring-0 ped cap starts at 16 (3/01's palette cap) — measured, then
  moved.
- **Player interplay v1**: peds sidestep the player's predicted position (a repulsion term on the
  link-following, not physics); a car breaching a sidewalk scatters nearby peds to a flee state (run
  along links away from threat) — the ONE reaction v1 ships, because its absence is what makes crowds
  read as cardboard.

## Goals gate

1. *Authored data:* ped graph, #Peds densities, pedgrp mixes, `Decision/` files NOT consumed (v1
   scope: our behaviour is deliberately shallow; SA's decision-maker data is a later fidelity source —
   recorded, not forgotten).
2. *Original:* CPopulation's bubble + despawn soup; ours keeps identity across rings like traffic.
3. *Better:* crossings actually obey signals (SA peds jaywalk into traffic); densities hold to the
   authored popcycle character; demonstrated in the 5/01 acceptance scenes.
4. *Cost:* ped sim inside the shared 2 ms ring gate (peds are the cheap half — slow speeds, sparse
   junction logic); ring-0 capsule count capped and measured.
5. *Contract:* no new names; config under `config.peds.*` in commands doc.

## Verification

- Fixtures: crossing compliance, flee scatter, density ramp at hour change — golden files into the
  shared fixture set (the ASI twin will consume them).
- Field: Market at noon (dense, crossing-heavy) vs Bone County 4 am (near-empty) — both read correctly;
  a full light cycle at a crossing: peds wait, walk, clear; drive onto a sidewalk: scatter, no
  ragdoll-through.
- Boot census + soak (agent arrays flat).

## Tasks

- [ ] Ped agent kind on the shared stores + link following + crossings + idles.
- [ ] Density-driven seeding from 1/03; pedgrp model resolution (+ build-vfs refs check).
- [ ] Ring-0 capsule materialization + the two interplay behaviours.
- [ ] Video-mode walk legs onto the real ped graph; retire the hack (move + closing block, same change).
- [ ] Fixtures + field program; numbers below.
- [ ] Docs: features/ update; edge-cases/route-graph.md sidewalk facts; hacks retirement.

## Measured numbers

- Ped share of the sim tick at Market-noon density: —
- Ring-0 capsule cost (N capsules → fixed-step ms): —
- Field scene verdicts: —
