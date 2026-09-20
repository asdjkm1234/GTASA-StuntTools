# VehFuncs conditions always true, characteristics skipped

**Live.** Taken 2026-08-17 with the VehFuncs variant tree (`packages/renderware/src/vehicle/variants.ts`,
runtime pick in `packages/game/src/adapters/engine-vehicle-handle.ts`).

## What it is

`pickVariants` walks a car's `f_extras` / `f_class` tree per spawn and honours the count suffixes and the
`[tag]` gates — but a node's `?condition` (`ycc?c1` = only in Los Santos, `roof?rain`, `?h6-18`, `?zGAN`,
`?p1`, `?d5`, `?m`) is treated as **always true**, and a class's `!characteristics` subtree (`_pj=1`,
`_cl=1,25`, `drv=190` — the paint job / colours / driver the class implies) is **not applied**. The
condition string is carried verbatim in the shipped tree (`VehicleVariantNode.condition`), so a runtime
that learns to evaluate it needs no rebake.

## What it stands in for

The plugin's own evaluation at spawn: city / zone from the spawn position, weather and hour from the clock,
population and driver type from the ped, mission control from the script. All of that exists in our runtime
in some form (position, `timecyc` clock, weather) but the picker runs in the vehicle handle's constructor with
none of it in hand, and wiring it is a design of its own (where the spawn's zone comes from, what a
"mission vehicle" is for us). Paint jobs and colours per class touch the paint-slot resolver, which today picks
independently.

## What it was judged on

The census (2026-08-17): 59 of 213 original mod cars carry `f_extras`, 32 carry `f_class`; the conditions
seen are city (`?c0`–`?c4`, on the cabbie's four taxi companies and the funky taxi's LS/SF/LV ad sets) and
`roof?rain` (8 rows). Choosing among them uniformly is wrong in the sense that a Yellow Cab can spawn in
Las Venturas — but the pre-existing state drew ALL four companies' roof ads at once on one car, so a random
one is strictly closer to the author's intent, and the field cannot tell a wrong-city livery apart from a
right one at a glance.

## What would retire it

Evaluating `condition` in `pickVariants` from a spawn context (zone/city of the spawn position, weather,
hour, mission flag) and applying `!characteristics` through the paint/colour resolver. The tree already
ships everything needed; the work is on the runtime side only.

## Blast radius

Which livery/ad/clutter a car of those 59 wears where; nothing about geometry, physics or the shipped bytes.
