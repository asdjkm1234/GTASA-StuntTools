# "A vertex much brighter at night IS a lit window"

**What it is.** `smoothstep(0.05, 0.32, max(deltaRgb.r, deltaRgb.g, deltaRgb.b))` in the world vertex shader
(`packages/engine/src/render/shaders.ts`), where `deltaRgb = nightPrelit − dayPrelit`. Above the band a
vertex GLOWS; below it, it is merely tinted.

**What it stands in for.** SA ships no "this is a light source" flag on map geometry. The night prelit set is
the only signal there is, and the rule guesses emission from it. Two details are deliberate and were paid
for: the test is on the max CHANNEL, not on luma — neon night sets are saturated, and the LV strip's red rope
light reads DARKER than day in luma, so a luma test killed exactly the lights it was meant to find (085 row
A, field-confirmed).

**What it was judged on.** The look, across the LV strip and LS at night. The two thresholds are where the
strip's neon fired without the whole city glowing.

**What would retire it.** It is already half-retired: the converter can BAKE the mask (plan 074/07, the high
channels byte), and `emissive = mix(heuristic, baked, cellFlagBit)` — a cell that carries the baked mask
ignores the heuristic entirely. The hack survives for cells baked before that, and as the fallback path.
It retires fully when every shipped pak carries the flag and the `mix` collapses to `baked`.

**Blast radius.** Every map vertex at night. Widening the band lights signage that is merely bright; narrowing
it drops rope lights and small windows. Because the baked mask overrides it per cell, a change here can be
invisible on a fresh pak and very visible on an older one — which makes it easy to test against the wrong
build.
