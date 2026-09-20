# Pop-up headlight travel time

**Live.** Taken 2026-07-28, commit `d4a1c68` (the pop-up feature), tightened by `c34162d` (the lamps wait
for the arc).

## What it is

`packages/game/src/vehicle/vehicle-rig.ts`:

```ts
const POPUP_SPEED = 1 / 0.7; // fractions of the arc per second — 0.7 s from parked to fully up
```

## What it stands in for

SA's own pop-up animation, which does not exist. The ZR-350's pod is a plain `misc_a` component the original
never moves — the car simply has its lamps parked in the nose forever. There is no timing to reproduce, no
curve to read out of the reversed source, and no data in `handling.cfg` or the IDE that mentions it.

Everything else about the feature IS derived from the model: which component is a pod, and how far it swings
(`atan2(-n.z, n.y)` of its parked lamp normals — zr350 40.4°, the 1986 Starion mod 52.6°). This one number
has nothing to derive from.

## What it was judged on

A real pop-up motor takes about a second; 0.7 s is inside that and reads as mechanical rather than as a snap.
Accepted in the field 2026-07-28 — the pods read as working perfectly — together with the follow-up that keeps the
lamps dark until the arc finishes.

The motion is also linear — no ease in or out — which is the same expedient at a smaller scale.

## What would retire it

Nothing in SA will supply this, so it retires only if a car's own data ever carries it: a `features.txt`
declaration a mod can set per model would be the natural home, the way `UP/DOWN_LIGHTS` already declares that
a pod exists at all.

## Blast radius

Every pop-up car, and now also WHEN its headlights light up (the lamps wait for travel = 1). Slowing it down
delays the light by the same amount; the pods and the beam cannot drift apart, which is deliberate.
