# 06·4·01 — Real trains (engine)

[← chain](../readme.md) · needs: 1/02 (tracks import), 1/04 (schedules), 2/03 (crossings) · next: [02 ASI trains](02-asi-trains.md)

The easiest "alive" win: fully deterministic, on rails, visible across a valley. Nothing exists today —
no parser (1/02 delivers it), no runtime, and the engine has no kinematic collider bigger than the
player's capsule.

## Design

- **Kinematics**: a train is `(routeId, s, speed)` on the arc-length track (1/02); car N sits at
  `s − N·carLength`, each bogie following the curve so long cars don't clip on bends. No physics
  drivetrain — the schedule is the physics.
- **Schedule** (sidecar, 1/04): per route — departures, station stops + dwell, speed segments;
  deterministic from the game clock. The 14:03 freight is ALWAYS at the same place at 14:07 — this is
  what lets crossings close AHEAD of trains (2/03 lookahead) and what players read as "real". Default
  timetable auto-derived when the sidecar is absent (the sidecar-optional rule); stations authored
  once in the editor (1/05).
- **Consists**: seeded per departure from the SA train model pool (engine + N cars); same seed, same
  consist. Train models are `vehicles.ide` type `train` — gate by type, never by name; register their
  refs with build-vfs (data-file-chosen models rule).
- **Collision**: NEW `PhysicsWorld.createKinematicCuboid/Compound` (only a capsule helper exists) —
  colliders materialize ONLY within the collision radius, driven by `setNextKinematicTranslation` from
  the track position; beyond it the train is renders + data (streaming follows the player; the far
  world has no collision to stand on anyway). The train wins every contact (kinematic vs dynamic —
  Rapier gives us that for free); "no moving colliders" in `docs/edge-cases/engine-rendering.md` gets
  its first exception and the edge-case entry updates in the same change.
- **Rendering**: ring 0/1 = real models through the rigid part path (wheels rotate by `ds` via part
  transforms — the anim-objects template); ring 2 = headlight corona + one lit-window strip quad per
  car at night (the postcard), body micro-quads by day — all through 2/04's far machinery.
- **Interactions v1**: crossings close (2/03), collision kills what it hits, agents yield via virtual
  red. Ridable/boardable is OUT (a later gameplay plan); recorded scope line.

## Goals gate

1. *Authored data:* `tracks*.dat` polylines, train model pool, station positions (authored via editor).
2. *Original:* CTrain's hardcoded generation logic is not ported; the rails and the MEANING of
   `train.dat`'s entries are recovered (gta-reversed) and honoured.
3. *Better:* schedules exist (SA trains are random-ish and mods break them notoriously); crossings
   close ahead of arrival every time; demonstrated by the end-to-end field scene below.
4. *Cost:* a handful of kinematic bodies + part transforms — budget: **≤ 0.2 ms CPU with 2 live
   trains**, far representation inside 2/04's GPU gate.
5. *Contract:* schedule schema is 1/04's; type-`train` gating noted in contracts/vehicles.md if any
   new name rule appears.

## Verification

- Unit: arc-length math, bogie curve following (no clip on the tightest stock bend), schedule
  position determinism (clock t → position, exact), consist seeding.
- Field: the first end-to-end demo — train approaches a crossing, barrier closes ahead, traffic
  queues (2/02 box rule holds), train passes, everything reopens; ride alongside edge-to-edge across
  the map (schedule holds under streaming); the night valley shot (ring-2 strip quads).
- Soak with trains running: flat.

## Tasks

- [ ] Kinematic compound helper in PhysicsWorld (+ tests).
- [ ] Train runtime (chain kinematics, bogies, wheel rotation) on the anim-objects template.
- [ ] Schedule runtime + default timetable derivation + station dwell states.
- [ ] Seeded consists + build-vfs refs.
- [ ] Crossing presence windows → 2/03 lookahead integration (the demo above).
- [ ] Far representation (coronas + window strips) via 2/04.
- [ ] Docs: edge-cases moving-collider update, features/ entry, architecture notes.

## Measured numbers

- CPU with 2 live trains (fixed-step ms): —
- Schedule drift over a full game day: — (must be zero)
- Crossing lookahead margin measured at max speed: —
