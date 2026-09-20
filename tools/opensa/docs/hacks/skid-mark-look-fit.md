# Skid-mark look fit

**Live.** Taken 2026-07-28 with plan 089/03 (skid marks on the decal lane).

## What it is

`packages/game/src/vehicle/vehicle-skid-marks.system.ts` and the skid shader in
`packages/engine/src/render/shaders.ts`:

```ts
const ALPHA_MIN = 0.25;   // mark darkness at the slide threshold…
const ALPHA_SPAN = 0.6;   // …ramping to 0.85 at a full slide (darker the harder)
const HALF_WIDTH = 0.12;  // the laid stripe is ~0.24 m wide
const MIN_SEGMENT = 0.3;  // metres of path per quad
const RAMP_SEGMENTS = 3;  // the grow-in from the transparent start
const TEX_METRES = 1;     // metres of path per texture repeat
const LIFT = 0.02;        // metres off the road (z-fight guard)
// shader:
const RUBBER = vec3f(0.04, 0.04, 0.05); // the dark rubber tint (particleskid is WHITE + alpha)
const TREAD_BOOST = 1.8;                // texture-alpha boost — see below
```

## What it stands in for

SA's own skid parameterisation — width, opacity and lifetime live in the same unrecoverable
`CFx`/`CSkidmarks` code paths as the wheel-smoke parameters (stubs in gta-reversed). What is NOT fitted:
the slide DETECTION (the shared `equivalentSlideSpeed` — honest physics reads, see the tyre-smoke fit doc),
the 5-real-second lifetime (the plan brief's own spec) and the transparent start (also spec).

`TREAD_BOOST` exists because `particleskid`'s alpha channel averages ~0.4 — authored against SA's own
compositing. Unboosted, a full-severity mark darkens this engine's road by ~0.3 and disappears into the
asphalt (measured on the brake-strip lap: the ribbons were laid correctly — verified by rendering them
red — and were still unreadable in black). The boost scales the whole alpha channel, keeping the tread
pattern's relative shape.

## What it was judged on

The headless brake-strip lap: two dark trails follow the braking path behind the car, the older tail
already fading (the wall-clock fade is visible within one screenshot), the fresh end darkest at the
wheels. The user's field verdict may move any of these numbers.

## What would retire it

Recovered `CSkidmarks` constants (deeper gta-reversed pass, or frame-by-frame measurement of the
original's marks). The per-surface mark TYPE routing (DEFAULT/SANDY/MUDDY — 089/05) replaces none of
this; it only picks the texture.

## Blast radius

Skid marks only. The ribbon geometry rules (seamless edges, min/max segment, teleport restart) are
correctness, not look — changing them changes artifacts, not taste.
