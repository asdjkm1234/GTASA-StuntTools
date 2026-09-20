# 098/04 — Rider animation (reach the clips, resolve the groups, sit the rider)

**Goal:** the ride animation sets become reachable and resolvable per vehicle, and the player visibly
RIDES: seated per class, hands on bars, pedalling on a BMX, leaning with the physics, mounting without a
door. **Field checkpoint 2: it looks ridden.**

## What exists (recon 2026-08-04)

- The whole animation stack works today for cars: IFP parser (ANP3, `ifp.ts:41`), `IfpSampler` with
  crossfade/blend (`ifp-sampler.ts:83`), the seated path re-issuing `car_sit` every fixed step with the
  car's full quaternion (`enter-vehicle.system.ts:923-946`), root-motion replay for ingress
  (`engine-player.ts:242-259`), and a degradation gate — a clip missing from the IFP falls through to
  locomotion instead of sampling garbage (`engine-player.ts:113-145`; the comment records the
  standing-driver failure this prevents).
- **The ride clips are unreachable.** `anim/anim.img` holds 133 IFPs (`bikes`, `biked`, `bikeh`, `bikev`,
  `bikeleap`, `bmx`, `quad`, …) and BOTH loaders deliberately exclude it: local
  (`install-source-core.ts:51` excluded set) and fetch (`expand-img.ts:29` — "nothing resolves its
  contents by name"). `ped.ifp` carries only mount fragments (`BIKE_pickupL/R`, `BIKE_pullupL/R`,
  `BIKE_fall*`) plus `CAR_*`/`DRIVE_*`.
- **No group indirection.** `vehicles.ide` `anims` (BIKES/BIKED/BIKEH/BIKEV/BMX/QUAD…) is parsed by 01
  now but consumed by nothing; the `^` table (enter/exit pairing, door timings, kart/truck drive flags)
  likewise; clip names are hardcoded in `vehicle-clips.ts:7-27` and `engine-player.ts:69-84`.
- **No IK layer** — `IfpSampler` composes locals→worlds with no hook between local pose and palette
  write (`ifp-sampler.ts:160-173`). Handlebar-hands IK is therefore out; lean is done with clip blending
  and the existing orientation override.
- Bikes author `ped_frontseat` too, so seat placement already works (`vehicle-osm.ts:135-141`).
- One skinned ped probe engine-wide (`engine.ts:1671`) — player only; passengers stay out of scope.

## Steps

- [ ] **Make `anim.img` reachable.** Decide by measurement between (a) expanding it like a models img
      (both loaders) and (b) extracting the vehicle-group IFPs at pack time into name-addressable
      entries. Record the fetch-pack size/chunk delta before choosing (the pack-shape memory: measure
      the OUTPUT before choosing a shape). Loaders must agree (restriction: whatever the loaders
      disagree about, the game disagrees about). Mods overriding a ride IFP by bare name keep working
      (`img-merge` path).
- [ ] **Anim-group resolution layer.** One lookup, **keyed the way SA keys it** (13's finding): `handling` col 34
      `animGroup` → `^` row → (first, second) base group → per-slot clip with fall-through; `vehicles.ide`
      `anims` names only the IFP to stream. The `^` row supplies enter/exit pairing and the kart/truck/hover
      drive-clip flags. The two hardcoded
      arrays become the `car` group's entry. Degradation stays loud-but-safe: a missing group logs once
      and falls back to the car set (never a T-pose, never a standing driver).
- [ ] **Ride pose per class.** Seated clip from the group (`BIKES_Ride`, BMX equivalents, quad, truck
      drive for mtruck per `^` flag); steer/lean blend via `sampleBlended` driven by the 03 controller's
      lean angle; BMX pedal loop rate-synced to wheel speed (precedent: locomotion rate-sync clamp,
      `engine-player.ts:123-124`).
- [ ] **Mount/dismount.** Bike path in the enter system: no door phases — approach, `BIKE_pickupL/R` /
      `BIKE_pullupL/R` with root-motion replay, straddle. Exit mirrors. The car door machine stays
      untouched for cars; class branching keys off 01's threaded type.
- ~~Wheelie/stoppie/hop pose overlays~~ — **moved to [12](12-riding-animation.md)** (2026-08-20): the census
      showed no such clips exist; the riding body is its own plan.
- [ ] **Contracts + docs.** New name rules (group name resolution, IFP override behaviour) into
      `docs/contracts/`; `docs/features/vehicles.md` rider section.

## Verification

Headless: group resolution unit-tested over all 201 parsed defs (every land vehicle resolves to an
existing IFP or the logged fallback — count = 0 silent misses); fetch/local loader parity test on the
`anim` entries. Field: mount a bike (looks deliberate), ride (seated, leaning), BMX (pedals sync, stand
on sprint), dismount. The DOM/console is a verdict too (headless harness memory): the once-logs for
missing groups are part of the pass criteria.

## Ledger

(pack size delta for the chosen ingestion, resolution census, field verdicts)
