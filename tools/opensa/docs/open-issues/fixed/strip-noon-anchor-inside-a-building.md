# The `strip-noon` bench anchor was authored INSIDE the Flamingo

**Status: ✅ FIXED 2026-08-09, verified by a run the same hour.** Opened and closed the same day; the wrong
first diagnosis is kept below because it is the instructive part.

## The symptom

`strip-noon`'s anchor was `[1934, 1177, 14]` — "South Strip at street level (the Flamingo/Pirate block)",
added 2026-07-29. Every run of that scene put the player through the floor:

| Run | `targetZ` | `dz` | `grounded` | `worstDrop` | `vehicles.live` |
| --- | --- | --- | --- | --- | --- |
| pre-102 (warmup-length fall) | — | −11.16 m | false | 2.7 m | 26 |
| A/A arm 1 (2026-08-09) | 14.00 | −897.25 m | false | 4.66 m | 1 |
| A/A arm 2 (2026-08-09) | 14.00 | −895.04 m | false | 4.66 m | 1 |
| **after the fix** | **18.09** | **−0.08 m** | **true** | **0** | **27** |

The two arms agreed to ~2 m out of 900, so it was never a race.

## The first diagnosis was wrong, and worth keeping

This was written up as *"the world has a hole here"* — the ground ray answers `13.00` and the capsule falls
straight past it, so the collision must be missing. Two pieces of evidence were read as support:
`groundBelow` returning a suspiciously round number, and three bench road cars nearby reporting
`vehicle spawn deferred: no ground`.

Both were misread, and the user's own reading of the run is what corrected them:

- **The deferred cars are the designed spawn gate, not a hole.** `euros` (145 m from the anchor), `admiral`
  (~125 m) and `peren` (143 m) all sit at the edge of `collisionDrawDistance` (150 m). A car may only be
  created where the world under it already exists, so "no ground yet" at the ring boundary is the system
  working. Their retry counter is just loud.
- **The cars vanishing mid-scene was a CONSEQUENCE of the fall, and correct behaviour.** Residency is
  anchored to the player: `VehicleLodSystem` measures a 3D distance from him and despawns past
  `unloadDistance` (500 m). A player 890 m down is 890 m from everything, so the district empties. Watching
  it happen — "cars appeared, vanished, appeared, then vanished for the run" — is exactly the fall's
  progression, including the respawn when the settle warped him back.

What the ray actually hits: `flamingo01_lvs` stands at `(1932.8, 1177.4, 39.9)`, so the anchor's XY is
**inside the casino**. The `13.00` is a surface belonging to the building, not a street, and a capsule
cannot rest on it. The world was never broken; the anchor was.

## The fix

`bench-scenes.ts`: anchor moved to `[1933, 1127, 18]` — the standable ground south of the building
(`npx tsx scripts/debug/teleport-spot.ts flamingo01_lvs`, whose ring reports z 17.6 all around it), which is
also ~50 m closer to the camera path this scene actually flies. Verified with `?bench=strip-noon` on
`build/original/opensa`: `legStart.ok` true, `dz −0.08 m`, grounded, worst frame drop 0, 27 cars live.

**Every `strip-noon` row taken before 2026-08-09 measured a falling player and is not comparable** — the
scene has been in the sweep since 2026-07-29 and never once produced a valid row.

A second, general guard landed with it: the settle's wait-for-rest is capped at 3 s
(`REST_TIMEOUT_MS`) rather than the 12 s world-ready budget, so a future bad anchor costs a bounded fall
instead of ~900 m and a despawned district.

## What this cost, and the rule it earned

A bad number in authored content was read as a defect in the world, and two symptoms of *correct* systems
(the car spawn gate, the residency cull) were briefly recruited as evidence for it. The instrument that
settled it was the leg-start probe: `targetZ` next to `dz` says whether the player is where the harness put
him, and where the harness thought that was — a row that describes its own configuration ends this class of
argument in one line instead of a session.
