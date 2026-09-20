# The speed camera's framing cost (FOV kick + distance gain)

**Status:** in reserve — recorded 2026-08-02 from the 091 field drive. Nothing has been changed; the framing
is a deliberate feel choice and the frame budget is not blown.

**Impact: HIGH, but INFERRED — the largest frame-rate number here after foliage, and the only one never
A/B'd.** The two channels widen the vertical FOV 60° → 70° and pull back 5 units, which is **×1.47 of
screen-projected world area at top speed**. The 091 drive found those frames GPU-bound (pass mean 13.73 ms,
max 19.79) and the field reads **~50 fps flat out vs 70–80 braking** on the same street with no other cars;
×1.47 on the GPU-bound part of 14.3 ms lands at ~21 ms ≈ 48 fps, so the arithmetic and the field agree. **That
agreement is a consistency check, not an attribution** — nobody has run it with `vehicleFovKick 0` /
`vehicleDistanceGain 0`, and both are live sliders. Run that A/B before believing the rating.

**Effort: very low → medium — and this is the entry where effort says the least about what to do.** Capping
the kick, or the emergency lever (`vehicleFovKick 0` / `vehicleDistanceGain 0`, back to a static framing) are
config values with no code at all: **very low**, and both are live sliders in the debugger. Tying the kick to
the measured frame cost is a new adaptive policy in the camera: **medium**. But the real price here is not
work, it is the speed sense, and 081's lesson is that this user's accepted feel is not recovered by reasoning
— so every one of these needs a field verdict whatever it costs to type.

## The lever

While seated, two camera channels open up with speed (`apps/web/src/ui/camera/vehicle-camera.ts`):

| Channel | Config | Effect |
| --- | --- | --- |
| `vehicleFovTarget` | `vehicleFovKick` **0.175 rad**, full at `vehicleFovMaxSpeed` **28 u/s** | vertical FOV **60° → 70°** |
| `vehicleDistanceForSpeed` | `vehicleDistanceGain` **5**, full at `vehicleDistanceSpeed` **40 u/s** | camera pulls back **+5 units** |

The aspect ratio is fixed, so a 60° → 70° vertical FOV widens the horizontal by the same factor: linear extent
×1.21, **screen-projected world area ×1.47**. The pull-back adds a little more. At top speed the car camera is
asking the renderer for roughly **half again as much world** as it does at rest — every frame, in exactly the
situation (fast driving) where the streamer is also busiest.

## What it costs, measured

The 091 field drive
([`2026-08-02-drive-091-field-verdict.json`](../../benchmarks/opensa-engine/2026-08-02-drive-091-field-verdict.json))
found the slow frames to be **GPU-bound**: pass mean **13.73 ms**, max 19.79, against a CPU render block of
0.1–0.6 ms; draws up to 1999. The driver's own reading closes the loop — **Las Venturas, no other cars,
`comet`: ~50 fps at top speed, 70–80 fps under braking.** 70 fps is 14.3 ms; ×1.47 on the GPU-bound part lands
at ~21 ms, which is 48 fps. The arithmetic and the field agree, so the speed→fps relation is mostly this
framing, not the streaming.

**This has not been A/B'd with the channels off.** The agreement above is a consistency check, not a measured
attribution — anyone pulling the lever must run that A/B first (`vehicleFovKick 0` / `vehicleDistanceGain 0`
are both live sliders in the debugger, `debug-capabilities.ts`).

## The levers, if driving frames ever hurt

- **Cap the FOV kick.** 0.175 rad was tuned for feel, not for fill. Half of it keeps most of the speed sense
  for ~half the extra area.
- **Tie the kick to the render scale / measured frame cost.** A frame that is already at budget does not need
  a wider lens; this is the one lever that costs nothing when the machine is fast.
- **Shorten the draw distance while the kick is open.** The wider lens pulls in more FAR geometry, which is
  the cheapest to give up — the LOD ring already has the machinery.
- **Go back to a STATIC framing.** The floor of the ladder, and the one the user named: fix the vehicle
  camera's distance and FOV at their at-rest values (`vehicleFovKick = 0`, `vehicleDistanceGain = 0` — no code
  change, both are config) and the speed-dependent fill cost disappears entirely. The measured shape says that
  is worth roughly the 50 → 70 fps the field saw between flat-out and braking. **This is the emergency lever,
  not a tuning step**: it gives up the speed sense wholesale, so it is what to pull when a build has to ship at
  a frame budget it cannot otherwise meet, not what to try first.
- **Do nothing.** 50 fps at top speed on the dev host, with no felt hitch, is not a problem yet.

## What pulling any of them costs

The speed sense. Both channels exist because a car that does not widen and pull back feels slow at any
velocity — this is plan 05/09 tuning the user accepted in a field round, and 081's whole lesson is that this
user's accepted feel is not recovered by reasoning from first principles. **Do not touch these constants
without a field verdict**, whatever a benchmark says.

## What would have to be true to pull one

- A driving scene that misses the frame budget with `gpu` dominating **and** a measured A/B showing the
  channels are the cause (not foliage fill, not draw count).
- The user accepting the reduced speed sense in a side-by-side drive — the same acceptance bar the original
  tuning passed.
