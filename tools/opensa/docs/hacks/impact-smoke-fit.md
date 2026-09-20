# Impact-smoke fit

**Live.** Taken 2026-07-28 with plan 089/04 (impact smoke on the dynamic particle lane).

## What it is

`apps/web/src/ui/engine-vehicles.ts`, the `onStrongHit` sink:

```ts
const severity = Math.min(1, (force - STRONG_HIT) / (3 * STRONG_HIT)); // 1 at ~4× the damage gate
smokeEmitter.lifeScale = 0.4 + 0.3 * severity;   // 2–3.5 s of the authored 5 s
smokeEmitter.alphaScale = 0.25 + 0.25 * severity; // 25–50 % opacity
smokeEmitter.burst(3 + Math.round(5 * severity)); // 3–8 collisionsmoke puffs
```

## What it stands in for

SA's collision-effect parameterisation (`CFx` again — the same unrecoverable stubs as the wheel effects).
What is NOT fitted: the TRIGGER. The puff fires off the damage system's own strong-hit gate
(`STRONG_HIT` = 300 kN, calibrated in-browser when panel damage shipped: light≈207k, crash≈377k), so
"a hard crash puffs, a kerb tap does not" is inherited from a calibrated number, not re-chosen here.
The severity DENOMINATOR (full puff at ~4× the gate) and the three output ramps are the fit.

## What it was judged on

The headless kerb-mount lap (driving square into a pavement edge at ~25 km/h — the scene the physics
chain says stops every car dead): a visible puff at the nose on the hit. Field verdict may move the
ramps; the trigger stays the damage system's.

## What would retire it

Recovered `CFx` collision-effect parameters, or a measured count/lifetime from original-game captures.

## Blast radius

Impact smoke only. It shares the collisionsmoke emitter with the tyre smoke (bursts are instantaneous,
the emitter is repositioned per event), so retuning the tyre smoke's per-spawn look does not move this
fit — but replacing the SYSTEM (a different fxp effect for crashes) would obsolete the life/alpha ramps.
