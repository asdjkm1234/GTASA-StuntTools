# 090 — A car's cabin at night, and the reflection gate before it

**Died 2026-07-28, the day it was born.** Four commits over one afternoon, all reverted in one block
(`ae6548e`) on the field's verdict: it looks bad. The problems they were aimed at are still open —
[`open-issues/vehicle-cabin-lighting.md`](../open-issues/vehicle-cabin-lighting.md).

The code is recoverable: `3e37d10` (reflection gate), `b8a49d8` (the plan), `ce6cd1a` (090/01 night relax),
`a577a69` + `f05eb6d` (090/02, both shapes of the dash light).

## What it was trying to do

Two field reports, one after the other:

1. **The previon's dashboard reads wrong through the windscreen** — bright, "as if lit", only under certain
   sunlight and never in shade.
2. **A modelled interior is almost black at night** — from the interior camera, the seats are silhouettes.

## Attempt 1 — gate reflection and specular by sky occlusion (`3e37d10`)

**The reasoning.** `dump-vehicle-materials.ts` (kept — it is a good tool) showed the mod's dash trim coming
out material class **CHROME with an env coefficient of 0.5** while its sky occlusion is 0.63: the exporter
stamps an env map on every material it ships, so an interior mirrors the sky at the reflection path's HDR
gain. So: a surface may not mirror more sky than it can see.

**What shipped.** `amount` and the sun/moon specular scaled by the baked per-vertex occlusion, in both the
opaque and the blended vehicle paths.

**Why it died.** The user rebuilt and the dashboard still read wrong. The diagnosis is good DATA — those
material numbers are real — but it was never shown to be the CAUSE of the symptom, and the fix did not
answer it. It was reverted with the rest rather than kept on the strength of its reasoning.

## Attempt 2 — relax the sky term at night (`ce6cd1a`)

The occlusion measures SKY, and after dark light reaches a cabin off the street, sideways through the glass —
a direction the height-field bake never marches. So it relaxed toward open with the day/night factor (60 %).
Measured at midnight on the built previon: gauges/seats ×1.47, interior ×1.38, doors ×1.20, chassis ×1.12,
glass ×1.00.

**The field said this one HELPED** — the cabin read better. It died only because it went out in the same block.

## Attempt 3 — a lit cabin (`a577a69`), then one dash lamp (`f05eb6d`)

First shape: tag every vertex inside the cabin (greenhouse from the glass materials' bounds, floor from the
wheel hubs, "enclosed" from the occlusion) and give the lot a flat warm fill while the car's headlights are
on. The field came back with **hard polygonal patches across the seats**.

That artefact had two causes, both worth remembering:

- **The tag was read through `lampTag`, which is `@interpolate(flat)`** — so the fill switched a whole
  TRIANGLE at a time. Any per-vertex classification drawn through a flat varying will do this.
- **The membership test thresholds a NOISY bake.** 23 % of that car's seat vertices sit at sky 0.8–1.0 while
  the rest are at 0.2–0.5, scattered rather than in regions — thresholded, that noise IS the speckle. A
  neighbour fill halved it (1 261 → 572 speckled vertices) but did not make the idea right.

Second shape, on the user's call — one soft source under the steering wheel instead of a fill: the builder
baked each vertex's DISTANCE from a lamp hung in the cabin's own box on the driver's side (`ped_frontseat`
mirrored to −X), and the shader owned the falloff. Measured: gauges peak 0.74, dash and wheel 1.00, driver's
door 0.52 against the passenger's 0.09. Still rejected on looks.

## Why it really failed

**Not one in-engine capture was taken in the whole chain.** Every number above is offline — build-time data
read out of the pak — and every verdict came from the user's own screenshots after a rebuild. The repo's own
triage method says the opposite (`docs/debug/README.md`, step 5): for anything the test suite cannot see,
patch the shader to output its terms as colour and shoot the game headless. The bench harness exists, boots
the real game, and takes screenshots. It was never pointed at this.

Three rounds of look-work shipped on inference from data, and the data was never wrong — it just never
answered the question the eye was asking.

Secondary lessons, cheaper to re-read than to re-learn:

- A per-vertex flag + a flat varying = hard triangular patches. If a classification must be drawn, it needs a
  smooth varying and a value whose interpolation is meaningful at the boundary.
- Baking a SHAPE costs a re-pack per iteration. If a look parameter is going to be tuned, it belongs in the
  shader; only the anchor belongs in the bake. (The second shape got this right and it still was not enough.)
- A good diagnosis is not a licence to ship a fix that does not address the symptom.

## When to revisit

When the two open symptoms are attacked again — with an in-engine capture FIRST. The measured facts in this
document (the material classes, the occlusion bands, the seat-vertex noise, the `ped_frontseat` mirroring)
stay valid and should not be re-derived; the tool that produced them is `scripts/debug/dump-vehicle-materials.ts`.
