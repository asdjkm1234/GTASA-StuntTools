# A 300-unit floor under the dynamic (vehicle) fx lane

## What it is

`DYNAMIC_LANE_DRAW_DISTANCE` in `apps/web/src/ui/engine-particles.ts`, passed as `fxDrawDistance`'s `floor`
by `buildDynamicLibrary` and by nothing else:

```ts
const DYNAMIC_LANE_DRAW_DISTANCE = 300;
```

Every `prt_*` system SA ships authors `cullDist` **50**, so when [plan 100/04](../plans/100-2dfx-at-lod-range/04-authored-cull-distance.md)
made the authored table win, the vehicle-effect lane's reach fell 300 → 50 u. This restores the 300 it had
before that step, for that lane only. The user's call, 2026-08-08.

It is a **lane** floor, not a row in `DRAW_DISTANCE_DEPARTURES`: it applies to whatever `DYNAMIC_SYSTEMS`
carries, a mod's additions included, and it is expressed once where the lane is baked rather than as a list of
four system names that would go stale the moment the list grows.

## What it stands in for

**A per-spawn cull SA has and we do not.** SA's `prt_*` systems are code-triggered, and the code that triggers
them is the PLAYER's: `CFx` spawns wheel dust, collision smoke and sand for the car the player drives and for
the impacts near them. A 50 u cull on an effect that is only ever born within a few metres of the camera costs
nothing and is invisible — it is a cheap distance guard, not an authored look.

Our lane spawns for **every vehicle in the world** (the tyre-smoke, surface-fx and impact systems run on the
whole traffic set), so the same 50 becomes a visible edge: another car's tyre smoke stops 50 m away while the
car itself is drawn to the LOD ring. Reading the number literally imports a guard whose premise we do not
share.

300 is not derived. It is the value the lane shipped with before 100/04 and the one the user asked for back;
the honest replacement is below.

## What it was judged on

The user's report from the field after 100/04 shipped: another car's tyre smoke now ends at 50 m. The number
is the one that was in place before, which is the only thing that makes it "as it was" rather than a new fit.
**Not yet re-checked in the field at 300** — the round that would settle it is a car followed at 60–150 m with
`?spawncar` traffic, which nothing has framed since the change.

## What would retire it

- **Reading SA's spawn side rather than its cull side.** If `CFx`'s triggers turn out to be gated on distance
  to the camera (rather than the systems' `cullDist` doing the work), that gate is the honest rule and the
  floor goes: an effect nobody spawns needs no cull distance.
- A per-vehicle LOD for effects — spawn less, or not at all, for a distant car — which would let the authored
  50 stand because there would be nothing far away to draw.
- A field verdict picking a different number, which would make this a judged constant rather than a restored
  one.

## Blast radius

- Only the six `DYNAMIC_SYSTEMS` entries (`prt_collisionsmoke`, `prt_smokeii_3_expand`, three `prt_wheeldirt`
  aliases, `prt_sand`). The 878 PLACED anchors are untouched — the floor is not applied by `buildUpload`, and
  a test pins that a `vent` stays at its authored 25.
- The cost is bounded by how many vehicles are simulated at once, not by the map: these particles exist only
  while something is sliding, landing or crashing. Raising the reach 6× does not spawn a single extra
  particle — it stops the vertex shader collapsing the quads of ones already spawned.
- `graphics.effects.drawDistanceScale` multiplies the floor like everything else (the floor is applied
  BEFORE the scale), so the knob can still pull the lane back to 50 at ×0.17 — the floor is not a clamp.
