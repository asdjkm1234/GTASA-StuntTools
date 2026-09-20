# Parked cars do not come back: leave the area, return, the lot is empty

**Status: ✅ FIXED 2026-08-02, the day it was reported.** Three defects, one symptom. Found from the 091 field
drive; the driver's own sentence — *"I met parked cars exactly once in the whole route"* — is what turned a
clean-looking log into this.

## The symptom

Map car generators spawned a lot full of parked cars around `1580.08, -2125.62, 31.12` (LS). The driver left
and came back: **the lot was empty**, and stayed empty. Nothing in the console. Across a route from Ganton
through Downtown LS, the countryside, the desert and the whole of Las Venturas, that lot was the only place
cars were ever seen.

## The three defects

### 1. A car was created where the world under it did not exist yet

`streaming.collisionDrawDistance` is **150**; `vehicle.lodDistance` was the spawn trigger at **250**
(`apps/web/src/ui/game-runtime-config.ts`). Every car in that 100 m band was a dynamic rigid body created over
a hole. It free-fell.

### 2. Once it had fallen, it could never come back

`VehicleLodSystem` kept `entry.home` on the car's **live body** and measured both the unload distance and the
respawn trigger from it — while the respawn itself happens at `entry.placement`, the original spot. A car that
fell (or was shunted, ejected or driven off) carried its spot's respawn trigger away with it. Once `home`
passed `unloadDistance` it froze wherever the car had got to, and the spot's trigger was then measured from a
point hundreds of metres below the map. **The lot was unreachable for the rest of the session.**

### 3. Nothing could have told anyone

```ts
.catch(() => undefined)      // any failure, forever, in silence
```

No counter, no log, no backoff. And because `seatVehicleOnGround` throws *by design* to defer a spawn until
its collision cell arrives, the legitimate deferral and a permanently broken entry were the same observable
event: nothing at all.

`parked.json`'s 212 placements made it worse: they were **all spawned at boot**, most of them far outside the
collision radius, so a large part of the map's cars fell within the first seconds of the session — before the
player had been anywhere.

## The fix

- **`VehicleLodSystem.update`** spawns within `min(lodDistance, streaming.collisionDrawDistance)`. A car may
  only be created where its ground is. Cars in the band between the two radii do not exist yet; they appear
  when their ground does.
- **`VehicleLodSystem.stream`** resets `entry.home` to `entry.placement.position` on unload. The trigger is
  now measured from where the respawn will actually put the car. This is the fix that makes the loss
  temporary instead of permanent.
- **`engine-vehicles.spawnVehicle`** runs the ground probe for **every** placement, not only `groundSnap`
  ones. `groundSnap` now decides one thing — whether the car is also RE-SEATED on what the probe found — and
  the probe's throw defers the spawn for everybody. `parked.json`'s hand-authored spots keep their own
  position and pitch, as before.
- **`parked.json` is registered, not spawned.** 212 cars are no longer built at boot; they materialise by
  distance like every other placement, which is what `register()` was introduced for.
- **A spawn failure is reported.** `VehicleLodSystem` takes an optional `SpawnFailureReporter` and calls it on
  every rejection with the entry's consecutive-failure count; the host logs once per model past
  `STUCK_SPAWN_ATTEMPTS` (300 ≈ several seconds of frames), naming the model and its coordinates. A rejection
  that recovers stays quiet; an entry that will retry until the tab closes does not.

Regression tests in `packages/game/src/vehicle/vehicle-lod.system.test.ts` — both new behaviour tests were
confirmed to FAIL against the old code before the fix was kept:

- *respawns at its PLACEMENT after the car was displaced and unloaded*
- *does not spawn a car that is inside lodDistance but outside the collision radius*
- *counts consecutive spawn rejections and starts over after one succeeds*

## The bigger half, found in the same hour and also fixed

The world was nearly empty of cars for a reason that has nothing to do with this bug: **plan 059's map car
generators were wired to nothing.** `GtaSaWorldAdapter.mapCarGenerators()` was implemented and unit tested,
and its only caller in the repo was its own test — the runtime loop had gone out with the three.js host in
`a312f0d` (074/13, 2026-07-18) and the own-engine host never received it. That is what left the map with
`parked.json`'s 212 placements and 24 models, and why the 091 drive could not meet a new car type.

Restored the same day, after `cityBoxes` is built. Counted offline against the built archive: **1043
generators — 742 random, 301 specific across 83 distinct model ids.** The host prints
`[vehicles] map car generators registered: N` at boot. A field round is owed for what ~1255 lazily-registered
entries cost while driving. See [plan 059](../../plans/059-map-car-generators/readme.md).

## The lesson worth keeping

A count of zero is only evidence if the thing being counted had a chance to happen. The drive's log looked
clean, its census looked clean, and the verdict written from them was wrong — the world was empty and nothing
in the numbers said so.
