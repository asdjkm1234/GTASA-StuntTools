# Simulation residency: nothing decides WHAT may be simulated, WHERE

**Status: HALF CLOSED 2026-08-09.** Read this header before quoting any measurement below it.

- **The measurement contamination and the falls are FIXED and merged** ([plan 102](../../tools-debug/bench-harness/docs/plans/001-bench-settle-fall.md),
  merge `ed6b90ba`, close-out audit `6202503e`). They were a HARNESS bug, not the design question this doc
  argues for. **Section A's A/A table below is the BEFORE, not a current reproduction** — the spread went
  10.19 % → 0.14 % (`lv-night`), worst-of-nine 0.36 %; `[cam]` jump lines 89 255 → 1. **The bench is a usable
  instrument today**, and a perf budget may be measured on it.
- **What stays open is the design question**: three streaming radii, two distance metrics (the world grid is
  2D, `VehicleLodSystem` is 3D), no authoritative answer to "may this body be simulated here, right now".
  **No observed defect currently forces a mechanism** — the requirements list and the eight killed hypotheses
  below are the starting point when one does.

An earlier fix was written on 2026-08-08, measured, and **reverted** — it worked and it was still the wrong
shape (see [The fix that was rejected](#the-fix-that-was-rejected)): the task this doc exists for is a
mechanism that is right at CITY scale, not a patch that makes today's nine bench scenes green.

The symptom that opened it: **cars fall through the world across a bench scene transition, and the player
falls at the end of a run** (reported by the user on both arms of the 07/04 density A/B). The investigation
below turned that into a different, larger statement:

> We stream the world's collision, we stream its cars, and we stream its cells — and the three use different
> radii, different distance metrics and different readiness signals, none of which is authoritative. Nothing
> in the engine can answer "may this body be simulated here, right now". Every current guard is a proxy for
> that question, and each proxy is false in a different situation.

---

## Why this is bad, and why it gets worse

Today the world is one player and a few dozen cars, so the holes are survivable and mostly invisible. The
target is a living city: **many cars, many pedestrians, many objects lying on the ground**. Every one of them
is a dynamic body that needs ground under it, and every one multiplies the same defect:

- a guard that says "close enough to the player" scales with the player, not with the world;
- a metric that mixes the vertical axis in makes ONE falling entity delete everyone else's neighbourhood;
- a readiness signal that answers for the wrong location is invisible until something falls out of the map.

The current numbers already contradict each other, and they were chosen when "a couple of cars" was the load:

| Knob                                | Value | Where                                       |
| ----------------------------------- | ----- | ------------------------------------------- |
| `streaming.cellSize`                | 256   | `game-runtime-config.ts:18`                 |
| `streaming.collisionDrawDistance`   | 150   | ground exists only inside this              |
| `streaming.hdDrawDistance`          | 300   | cell HD geometry                            |
| `streaming.lodDrawDistance`         | 1000  | cell LOD geometry                           |
| `vehicle.hdDistance`                | 80    | car drawn in full detail                    |
| `vehicle.lodDistance`               | 250   | car drawn as `_vlo`, culled beyond          |
| `vehicle.unloadDistance`            | 500   | car's body destroyed                        |

**A car is a rigid body out to 500 m and the ground exists to 150 m.** 350 m of that range is a body over
nothing. Creation is guarded (`spawnDistance = min(lodDistance, collisionDrawDistance)` = 150, added by
`9b4a9576`); continued existence is not.

### The direction the design has to move (user requirement, 2026-08-08)

**Car draw distance should RISE, so that the car LOD range nearly matches the cell LOD draw distance**
(`lodDrawDistance` 1000). A city whose buildings are drawn to 1 km and whose streets go empty at 250 m reads
as a dead city. That makes the gap far worse under any design that keeps "car = rigid body": it would become
1000 m of car against 150 m of ground. **So the answer cannot be "raise the collision radius to match".** It
has to be that a car far away is not a rigid body at all.

---

## Exact reproduction

Both halves reproduce headless on this machine (Apple-silicon Mac, darwin 25.5.0). **Everything below was run
against the canonical pak `build/original/opensa`, manifest `buildTime 13:19 08-08-2026` — verified against
the manifest on disk, not assumed.**

```bash
npm run serve:static          # :3001 — mounts /build
npm run dev                   # READ the port off the Vite line; 5173 is often taken (this session: 5174)
```

### A. The measurement contamination — FIXED 2026-08-09, kept as the BEFORE

**Do not read the table below as a current reproduction.** It is the baseline plan 102 was measured against;
the same recipe now returns a spread of 0.14–0.36 %. The recipe itself is still the right one for an A/A.

```bash
SRC="http://localhost:3001/build/original/opensa"
DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5174/?loader=http-dir&src=$SRC&bench=all" run1 1500000 9
```

Run it twice against the **same** pak and compare `avgTriangles` per scene. It is a lottery, not a drift —
different scenes miss in different runs (three runs of the identical pak):

| scene         | base (`2026-08-08-ingame-minor8-repack`) | run A   | run B   | spread     | `lateCreates` |
| ------------- | ---------------------------------------- | ------- | ------- | ---------- | ------------- |
| lv-night      | 1868362                                  | 2058803 | 1872382 | **10.19 %**| 0             |
| sf-fog-dawn   | 1471428                                  | 1559707 | 1558647 | **6.00 %** | 0             |
| ocean-horizon | 846534                                   | 819723  | 846539  | **3.27 %** | 0             |
| ls-noon       | 2312310                                  | 2312495 | 2312386 | 0.01 %     | 0             |
| country-dusk  | 1199823                                  | 1227340 | 1199667 | 2.31 %     | 0             |
| ls-rain-night | 1748274                                  | 1759282 | 1747582 | 0.67 %     | 0             |
| ganton-noon   | 1572288                                  | 1575599 | 1575309 | 0.21 %     | 0             |
| strip-noon    | 1982243                                  | 2009328 | 1983133 | 1.37 %     | 0             |

**`lateCreates` is 0 on every row, including the ones that are 10 % apart.** It counts creates inside the fog
cut, and an undrained ring's cells arrive BEYOND it. The existing honesty gate cannot see this class at all.

### B. The fall (reproduces; the harness has to be told to look)

Two harness properties hide it, and both must be worked around:

1. **`drive.js` breaks its wait loop on `sweep complete` and closes the browser immediately** — the moment the
   user observes (after the sweep) is outside the capture window.
2. **its console filter only prints `TAG` / `[slow]` / errors** — `[cam]` lines are dropped silently.

So run it with a TAG that never matches, which both keeps the page alive to the full budget and echoes the
camera lines:

```bash
TAG='[fall]' ALSO='[cam]' DPR=2 NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5174/?loader=http-dir&src=$SRC&bench=all" fallwatch 900000 999
```

Result on 2026-08-08: **89 255 `[cam]` lines** — about 12 minutes of continuous falling, beginning at log
line 23 (i.e. in the first scenes) — and the marker:

```
[fall] 100 jump frames in a row — nothing is holding the focus up · height -4596.6 · dropping 2.70/frame · mode foot
```

The `[fall]` marker is IN the tree (`engine-canvas-host.tsx`, `CAM_FALL_STREAK`); the `[cam]` watchdog is
whitelisted during a bench leg (`snapshot.bench !== null`), which is why the wall of lines only starts after
`takeSamples()` sets `benchCamera = null`. **It cannot see falls DURING a leg** — the camera is on the fly
path and is not looking at the player at all. A direct vertical probe is still missing.

### C. The world-state probe (the sharpest evidence; NOT in the tree)

This is the instrumentation that produced the numbers below. It was reverted with the fix; **re-apply it
before doing anything else** — it is three console lines per scene and it settles arguments in one run.

Add to `PerfRunsHost` (`engine-perf-runs.ts`) and implement in the host's `setupPerfRuns` call:

```ts
worldProbe(): { cells: number; collision: boolean; grounded: boolean; pending: number; z: number };
// host: cells/pending from `lastStream`, collision from `collision.settled()`,
//       grounded from `Locomotion.state[playerEid] === LOCOMOTION_GROUNDED`, z from `Transform.z[playerEid]`
```

then print it in `settleAt` after the teleport, after the ring drains, and at leg start, tracking the WORST
single-frame drop in Z (a fall arrives as one frame, not as a slope — a mean over the window reports a
healthy scene).

What it said:

```
ls-noon       teleported · anchor z 30.0 · z 30.0 · cells 0 pending 0 · collision NOT READY
lv-night      ring drained in  219 ms (1 frames) · worst drop 0.0 · z 15.0 · collision ready
lv-night      leg starts · z 10.7 · cells 11 pending 81 · collision ready
country-dusk  ring drained in   28 ms (1 frames)
ocean-horizon ring drained in   16 ms (1 frames)
strip-noon    ring drained in   36 ms (1 frames)
ganton-night  teleported · z 13.0 · collision ready
ganton-night  ring drained in 1553 ms · worst drop 5.4 at frame 2 · z -250.6 · collision ready
ganton-night  leg starts  · warmup worst drop 3.2 · z -531.3 · collision ready
```

**Four of nine scenes "settle" in ONE frame (16–219 ms), and `lv-night` starts its measured window with 11
cells loaded and 81 queued.** And `ganton-night` reports `collision ready` all the way to −531.

---

## What is established (by code, not by argument)

1. **The settle waits on one stale signal.** `engine-perf-runs.ts` waits for `stream.pendingCells === 0`,
   which answers for the ring the player just LEFT until the driver retargets. `engine-phys-runs.ts:246-250`
   and `engine-video-runs.ts:188` both carry `TELEPORT_NOTICE_SECONDS = 1` for exactly this, with the note
   that **5 of 7 laps failed without it**. It was never carried to the bench. `engine-perf-runs.ts` has not
   changed since 2026-07-27, so this is latent, not new — a race that used to win.
2. **`CollisionStreamingSystem.settled()` — "the physics half of world readiness (plan 061)" — had NO
   production caller anywhere in the repo.** Nothing ever waited for ground.
3. **`settled()` is stale too**, and worse, `loaded` ≠ "there is ground": it compares `this.loaded` against
   `this.current` computed by the LAST `update()`, and a cell with no collision content is still recorded as
   loaded (an empty array). Wiring it in without fixing both would not have helped.
4. **The world grid measures in 2D, the vehicle LOD in 3D.** `cellDistanceSq` (`grid.ts:7-16`) uses X/Y only;
   `VehicleLodSystem.update()` (`vehicle-lod.system.ts:102-105`) includes `dz`. **A falling player therefore
   inflates the distance to every car at once** — all of them cross `lodDistance` (culled) at −250 and
   `unloadDistance` (despawned) at −500, everywhere in the district, simultaneously. This is the mechanism
   behind the field report "in ganton-night ALL the cars went, HD cells and LOD alike" while ganton-noon (same
   district, player grounded at z 13.0, worst drop 0) shows LOD cars standing correctly on the ground.
5. **During a bench leg the player never moves** — `teleportPlayer(scene.anchor)`, then only the camera flies
   (`setBenchCamera`); `viewOf()` is the player. So the collision ring never moves and **no car can leave it**.
   The 150–500 m gap cannot open in a bench leg at all. It opens when the player DRIVES, behind him, which is
   where it was field-reported (the 091 drive, fixed for creation only by `9b4a9576`).
6. **A deferred spawn pays full price and repeats it.** In `engine-vehicles.ts` `acquireModel(model)` (the GPU
   model build) runs BEFORE `seatVehicleOnGround`, whose throw is the deferral. Headless shows the loop live:
   `[vehicles] 'peren' at 1323,-1454,13 has failed to spawn 300 times in a row: vehicle spawn deferred: no
   ground`. Same for `euros`, `admiral`.
7. **There is no per-frame budget on spawning.** `VehicleLodSystem.update()` starts a spawn for every entry
   inside `spawnDistance` in the same frame — `[bench] road cars registered: 1196`, and the frame attribution
   shows bursts of `vehicle-model ×23`.
8. **Streaming follows the PLAYER, not the camera** (`engine-canvas-host.tsx:1721`, and it says so). Any
   design that moves a camera independently of the simulation focus has to decide which one the world is for.

### The collision DATA is already fully resident — this is the lever

Measured 2026-08-08 by walking the archive:

```
col models in libraries   10 155
  faces                1 191 528
  vertices               810 219
  box/sphere primitives    36 124
index build time              50 ms
```

`buildCollisionIndex` (`packages/renderware/src/collision/collision-index.ts`) parses **every `.col` library
in the archive into one flat name → model map, cached per archive**. That is roughly **30 MB** (810 k
vertices × 12 B + 1.19 M faces) for the WHOLE map's collision geometry, built in 50 ms, and it is already
resident from the first cell load onward. The adapter also keeps a per-cell `colliderCache` of placed
colliders (`gta-sa-world.adapter.ts:455`).

**So "preload all collision" is already true for the data.** What streams is only the Rapier body
representation — and that is the part that cannot be made permanent: the runtime reports `colliders 4008`
for what `cellsWithin(150, 256)` makes ~4 cells, i.e. **~1000 colliders per cell, order 10⁶ for the map's
1137 cells**. *(Extrapolation, explicitly not a measurement — confirm it with one instrumented boot before
building on it.)*

The consequence is the most useful thing this investigation found: **a ground QUERY is available anywhere on
the map without any physics body.** What is missing is only a spatial index over PLACED collision; today the
only ground answer is `physics.groundBelow`, a Rapier ray, which exists only where bodies were already built.

---

## Hypotheses that were KILLED (do not re-run these)

Each cost a round; each was killed by a measurement, and three of them were killed by the user's own field
observation rather than by code reading.

| Hypothesis                                                                    | What killed it                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The triangle drift is the procobj density change                              | It reproduces on an UNCHANGED pak, three runs, different scenes missing each time                                |
| The drift is vehicles popping in mid-leg                                      | `vehicles.live` is identical across runs, scene for scene (24→24, 43→43, ocean-horizon 0→0)                      |
| The drift is different cells being resident                                   | `residency` identical to the megabyte (`cellVertex 193→193`, `116→116`)                                          |
| The player's fall drags the cell set away                                     | `cellDistanceSq` is 2D — a vertical fall cannot move the cell set                                                |
| Cars survived the 150–500 m gap because Rapier put them to sleep              | `physics-world.ts:643` `.setCanSleep(false)`, with a comment on why — and unchanged since 2026-06-25             |
| The 4331-unit `[cam]` jump was the player falling 4.3 km in one frame         | The probe shows a steady fall (worst frame 5.4, −263 over 182 frames) — 4331 was a camera TARGET jump            |
| One vehicle model is pathologically slow to build (`worst bloodra 1975.8` ms) | Headless on the same pak: `worst elegant 21.8 ms`, `dft30 1.1 ms`. NOT reproduced — still unexplained on the user's machine |
| Collision was simply not built yet at the teleport                            | `settled()` reports `ready` throughout ganton-night's fall; the signal is stale, not the collision missing        |

Also killed: a throwaway census that counted "placed collision" from text IPLs only (4 914 of 50 935
instances, misses all `lod*`). The runtime resolves the map through the adapter's defs, which include the
binary IPLs in `gta3.img`. **Any census of placements must go through the adapter, not `loadMapDefs`.** The
library-level numbers quoted above are unaffected.

---

## The fix that was rejected

Written, measured, and reverted on 2026-08-08. Kept here because it worked, and its shape is the trap.

It added a pure gate (`settleBlockedBy`: teleport notice → pending cells → collision built → player grounded)
and, while the world was not ready, **put the player back on the anchor every frame**.

Measured: settle went from 16–219 ms (one frame) to 1–5.9 s; worst drop from −263 to ≤ 0.6; 7 of 9 scenes
clean. **Two scenes still hit the 12 s deadline with `player not grounded`** (`strip-noon`, and `ganton-night`
with a worst drop of 14) — unexplained, and the two candidates are (a) `loaded` ≠ has-ground, (b) end-of-sweep
accumulated state, since both are the LAST two scenes and `ganton-noon` on the same district settled in
1009 ms with drop 0.

**Why it was rejected:** it holds ONE entity, in ONE mode, by putting it back. Every future entity class —
peds, props, traffic — would need its own "put it back". It treats a body that has no ground as something to
reposition, when the correct statement is that it should not be a simulated body at all.

---

## What a correct mechanism has to satisfy

1. **One authority for "may this be simulated here".** Not a distance proxy, not a per-system radius. Every
   dynamic body class asks the same question and gets the same answer.
2. **Entity-agnostic.** Adding pedestrians or ground props must require no new guard.
3. **O(1)-ish per body and cheap at city counts.** Thousands of entities, every frame, is the design load.
4. **Consistent metrics.** The world grid is 2D; anything that measures against it must be too. A falling
   entity must not be able to unload anyone else's neighbourhood.
5. **Simulation LOD, not just render LOD.** We already LOD how a car LOOKS (`VehicleBand: hd | vlo | culled`);
   there is no LOD of how it is SIMULATED. A far car should be a cheap kinematic agent standing on queried
   ground — it cannot fall, because nothing integrates it — promoted to a rigid body only where collision is
   resident, with hysteresis at the boundary.
6. **Car draw distance rises toward `lodDrawDistance`** (the user's requirement above). The mechanism must
   make that a rendering decision, not a physics one.
7. **Readiness signals must answer for NOW and for the RIGHT place**, and "the cell is loaded" must be
   distinguishable from "there is ground here".
8. **It must be measurable.** The failure today is silent — `lateCreates` 0, reports normal, cars gone behind
   you. Whatever replaces it needs a signal that goes red.

Two supporting assets already exist and should be used rather than rebuilt: the fully-resident collision index
(~30 MB, 50 ms) for ground queries anywhere, and the path-node road graph
(`packages/game/src/adapters/path-graph.ts`, `vehicle/path-follow.ts`) for far-tier motion.

**Unverified, needs the reversed source before it goes into a design:** the belief that SA has no far living
world at all (traffic generated on a radius around the player and deleted behind it). If true, there is no
original formula to recover here and the far tier is entirely our design — see `docs/links.md` → gta-reversed.

---

## Related

- Measurement rule this earned: **check `avgTriangles` before reading any `gpuMs.pass` delta** —
  [`benchmarks/readme.md`](../benchmarks/readme.md).
- The A/B that surfaced it: [`benchmarks/index.md`](../benchmarks/index.md) → the density sweep entry.
- Creation-side half-fix: `9b4a9576` (2026-08-02) — "a parked car fell out of the world, and its spot never
  came back".
