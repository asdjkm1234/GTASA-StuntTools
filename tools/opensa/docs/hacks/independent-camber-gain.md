# Independent-axle camber gain

**Live.** Taken 2026-07-26 with [plan 081/06 §3](../plans/081-vehicle-physics/06-air-kerbs-visual.md); written
up here 2026-07-28 when this folder opened.

## What it is

`packages/game/src/vehicle/vehicle-rig.ts`:

```ts
const INDEPENDENT_CAMBER_GAIN = 0.44; // rad per metre of travel RELATIVE to the axle partner
```

How far a wheel on an INDEPENDENT axle leans per metre it stands proud of the wheel across from it. The
solid-axle rule beside it needs no constant at all — it is `atan(Δlift / track)`, pure geometry.

## What it stands in for

The original's own rule for the `AXLE_*` model flags. It is not in the reversed source: nothing in
gta-reversed reads those flags for a lean, so there is no formula to lift. What the flags mean for the DRAWN
wheel is therefore ours until somebody finds otherwise.

## What it was judged on

Fitted to real suspensions rather than to a car, which is the part that keeps it honest: a road car's
independent geometry gains roughly a degree of negative camber per 40 mm of compression, and 0.44 rad/m is
that. It is applied to travel RELATIVE to the axle partner rather than to an absolute rest length, because
the rig is fed hub offsets whose rest value is a standing pose it does not know.

The price is stated in the code: a symmetric bump (both wheels compressing together) draws no camber where a
real wishbone would gain some. In a corner — what the field brief was about — the two agree.

Field verdict: accepted with the 081 chain.

## What would retire it

Finding the original's handling of `AXLE_*` (or of camber generally) in the reversed source, or any data in
`handling.cfg` / the model that expresses suspension geometry directly. Either would replace a fitted rate
with a read one.

## Blast radius

Drawn wheels only — it never reaches the physics. Every car with an independent axle, in every corner; the
solid-axle path is untouched.
