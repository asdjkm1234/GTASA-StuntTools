# World glass as a material class

**Status: IDEA, unscheduled.** The question that started it (field, 2026-07-29, during plan 092's glass
control): *can we know that a surface is glass, so it can reflect like glass?* The answer to the first half
is **yes, and Rockstar authored it** — this doc records where that answer lives, what it does not cover, and
what would have to be built.

## Why it is worth doing

Vehicles already have this. `MaterialClass` (`packages/renderware/src/vehicle/types.ts`) classifies every
car material into matte / paint / chrome / **glass**, and glass reflects "sharp, no flakes" — a windscreen
does not shade like a door panel. The static world has no equivalent: every welded surface is one lit
material, so a shop window, a bus-shelter pane and a concrete wall all take the same shading and glass reads
as a flat dark hole.

The engine also already renders a reflection source for dynamics — the env probe (its cadence is a costed
lever in [`performance/deferred-optimizations/env-probe-cadence.md`](../../performance/deferred-optimizations/env-probe-cadence.md)),
so "what would glass reflect" has an answer that does not need new machinery.

## The signal: SA's own surface table says GLASS

`data/surfinfo.dat` carries a per-surface **GLASS column** ("is glass (will shatter when shot)"), and the
table names the surfaces outright: `GLASS`, `GLASS_WINDOWS_LARGE`, `GLASS_WINDOWS_SMALL`,
`UNBREAKABLE_GLASS`. **We already parse it**: `packages/renderware/src/parsers/text/surfinfo.parser.ts`
exposes `glass: boolean` (column 14) per surface, and it is the same table plan 081/10 reads for per-surface
grip and 089/05 reads for wheel effects.

Every COLLISION face carries `surface.material` — an index into that table
(`ColFace.material`, `packages/renderware/src/parsers/binary/col-types.ts`). So the game ships, per face, an
authored answer to "is this glass", and the rule would DERIVE from what the asset carries rather than from a
texture name — which is what [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md)
demands. A name rule (`/glass|window/`) is explicitly not the plan.

## The hard part: collision faces are not render triangles

A model's COL is coarser than its mesh — a window is one collision quad and a dozen render triangles, and
some models have collision the render geometry does not follow at all. So the class cannot simply be read
off; it has to be JOINED, at weld time (offline, no runtime cost):

- for each render material of a model, sample its triangles' centroids and normals;
- find the nearest COL face within a small distance whose normal agrees;
- if that face's surface has the GLASS flag, the material is glass.

**The open question is how well that join holds** — on what share of glass-bearing models does a render
material land on a glass-flagged COL face at all? That number is the go/no-go and it is measurable offline
today, with no engine work: the answer decides whether this is a rule or a rule-plus-fallback.

## What the 092 census already tells us about the population

World glass is **not everywhere**, which makes the join tractable and the payoff narrower than it sounds:

- Of the map's textures that stay soft-blend under the 092 mask rule, only **47 placed exterior models**
  carry one at all.
- The real exterior glass is small props: bus shelters (`bustopm` ×48, texture `cj_frame_glass` — 91 % of
  its texels below the alpha test, nothing above), bollard lights (×586, same texture), a car-showroom
  balustrade (`carshowbann_sfsx` ×84, `ws_glass_balustrade_better` — 74 % of texels ON the alpha test).
- **The classic glass textures are INTERIOR assets** (`a51_glass`, `keypad_glass`, `cof_wind1`,
  `glass_fence_64hv`), and the engine filters interiors out entirely
  ([`edge-cases/engine-rendering.md`](../../edge-cases/engine-rendering.md)).
- Most city "windows" are **painted onto opaque textures** and have no alpha at all — the LV airport
  terminal's `marinawindow1_256` is the case that misled this very investigation. Those cannot be glass by
  any alpha-derived rule, and a surface-flag rule would not reach them either unless their COL says glass.

So the honest scope: this buys real glass on props and shopfronts, not on every skyscraper facade.

## Signals deliberately NOT used as the primary test

- **The alpha class** (092): necessary at best. `cj_frame_glass` is soft-blend, but so are shadows and
  decals; and the biggest glass surfaces have no alpha.
- **The RW `reflection` plugin**: unreliable in the wild — plan 084 row 2 found the mods' exporter stamps it
  on every material it writes, which turned carpet and tyres reflective.
- **Texture names**: forbidden as a rule by the assets restriction; useful only to sanity-check a join.
- **`IdeFlag.NO_ZBUFFER_WRITE`**: marks the overlay class (092 uses it as the cutout gate) — decals and
  shadows share it with glass, so it cannot separate them.

## Restrictions this has to satisfy

- [`build-vs-runtime.md`](../../restrictions/build-vs-runtime.md) — the class would be BAKED into the cell,
  so it costs a re-pack to change. The rule of that page applies directly: bake only the CLASS (an anchor),
  keep every look parameter (reflection strength, fresnel curve, tint) in the shader where it can be
  iterated. Plan 090 learned this twice on vehicle cabins.
- [`gpu-and-shaders.md`](../../restrictions/gpu-and-shaders.md) — carrying the class needs a per-vertex
  channel. The world vertex is stride 36 with a `channelMask` for optional data (`OscellChannel`), so there
  is an extension mechanism; whether a new *varying* fits the 16-location budget is a question for the
  concept, and the rigid path's answer (pack into a spare nibble) is the precedent.
- [`assets-and-data.md`](../../restrictions/assets-and-data.md) — derive from the asset, never from a slot
  or a name. surfinfo IS the asset; that is the whole appeal.

## What a concept would have to answer

1. **The join rate.** On the models that carry a glass-flagged COL face, does the render material actually
   sit on it? Measure offline over the whole map before anything is built.
2. **Where the class rides.** A new `OscellChannel`, or a nibble in an existing packed channel — and does
   the world shader have a free inter-stage slot for it?
3. **What glass then does.** Env-probe reflection with fresnel is the obvious shading, but the probe's
   cadence is already a costed lever; a static cubemap or a screen-space trick may be enough for props.
   This is a look question, so it belongs in the shader and gets a field round, not a bake.
4. **Whether the same class unlocks the neighbours.** SA's table also flags WATER, SAND, ROUGHNESS and
   `CLIMBABLE`; a per-material surface class in the world is the same machinery that would let the map tell
   the physics and the effects what it is made of, rather than each system guessing.

## Prior art in this repo

- Vehicles: `MaterialClass` + the reflection switch (074/16 rounds 2–4, plan 084 row 2).
- Surfaces: per-surface grip (081/10) and wheel effects (089/05) already read this same table — the parser,
  the data and the precedent all exist; only the world-render side is missing.
