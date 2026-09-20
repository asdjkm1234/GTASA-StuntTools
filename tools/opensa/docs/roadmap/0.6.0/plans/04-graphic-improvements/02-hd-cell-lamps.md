# 02 — Light ALL lamps of the loaded HD cells (street-lamp surface lighting v2)

**STATUS: DRAFT** — part of the [04-graphic-improvements](readme.md) idea bundle (0.6.0). Recorded
2026-07-17 as the user's field conclusion; to be thought through properly later — nothing scheduled.

## Where this comes from

The v1 street-lamp surface lighting (2dfx anchors → the per-frame light pool, 100 u reach + nearest-24
cap, per-vertex world shading) was REMOVED on 2026-07-17 (user decision): the binary pool admission read
as "lamps igniting ahead of the driving car", and in dense streets the nearest-set rotation popped
mid-distance lamps on and off. Current shipping state: the pool carries host dynamics only (vehicle
head/brake lights); coronas and night-window emissives are untouched — lamps glow but do not light
surfaces. The removal record and the four prod mechanisms v1 lacked live in
[074/17](../../../../plans/074-opensa-engine/17-map-lighting.md).

## The field data point that opens this idea

Removing the 24-lamp static pool did NOT noticeably change fps on the user's real display (while a
headless standing-still A/B showed the pass dropping 2.9–3.8 → 1.4 ms — the two disagree; the real
night bottleneck is elsewhere and unprofiled). **The user's conclusion: the budget likely exists to
light ALL lamps of the loaded HD cells at once** — no reach, no cap, no admission → no ignition pops
BY CONSTRUCTION, which kills the entire artifact class the v1 scheme died of.

## Sketch (to be designed properly, not a commitment)

- Per-CELL static lamp lists shaded per vertex (the cell already owns its 2dfx anchors) instead of one
  global camera-centred pool — the work scales with loaded HD cells, not with camera distance churn.
- Keep the per-slot ~0.4 s temporal ramp for dusk (prod's street-light system) so the citywide ignition
  at nightfall stays smooth; the day/night gate remains the only on/off.
- Dynamics (headlights) stay in the existing per-pixel pool untouched.
- Alternative/complement: BAKE the lamp pools into night prelit (074/15 for LOD; possibly HD too per the
  hd-realtime concept) — zero runtime cost, no pops, but static.

## Hard requirements learned in 2026-07-17's rounds

1. **Verdicts on the REAL display only.** Headless A/Bs under-reported both a per-vertex cost (this
   removal) and a per-pixel one (the rolled-back SSR) — the night budget must be measured on the user's
   2× retina machine before and after.
2. Per-vertex shading on SA's metre-sparse meshes still gives blotchy pools on large polygons (the 074/17
   record) — decide per-vertex vs baked vs something else BEFORE building.
3. No admission heuristics of any kind without hysteresis + fade + ramp — binary switches are what got
   v1 deleted.
