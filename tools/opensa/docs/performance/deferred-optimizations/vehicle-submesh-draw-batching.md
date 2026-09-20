# One draw per visible vehicle submesh

**Status:** in reserve — the knob the engine names in its own comment
(`packages/engine/src/engine.ts`, the vehicle draw loop).

**Impact: medium, and INFERRED — the only entry whose win has never been put in milliseconds.** What is
measured is the axis: the scale ladder found the frame's floor is the draw/vertex side (a resolution-
independent **1.9–2.5 ms**), not the pixel side, and the in-game sweeps run 841 road cars at up to 1678
draws. So this attacks the real floor — but **today that floor is owned by world cells, not vehicles**, which
is what holds it at medium rather than high. It becomes high on a street dense with hi-poly mod cars (20–30
submeshes each) and stays near zero everywhere else. Measure `draws` with vehicles isolated before believing
any of it.

**Effort: high.** Per-submesh visibility is a shared invariant, not a local one — damage (`_ok`/`_dam`), the
`_vlo` LOD band and the `extraN` selection all express themselves by gating a draw call. Batching means all
three write GPU state instead, the translucent sort has to survive it, and any bind-group shape change
invalidates the recorded cell bundles. Plan chain, not a commit. **The two cheaper cuts at the bottom of this
entry are low effort** and go first.

## What we do today

Every live instance of every vehicle model issues **one draw per visible submesh**. That is what makes the
rest of the vehicle system simple: per-submesh visibility is the single primitive behind `_ok`/`_dam` damage,
the `_vlo` LOD band, and (since 2026-07-22) which `extraN` a car wears — all per instance, no scene graph.

## The lever

Batch: sort instances by submesh and draw them instanced, or build per-instance index ranges so a car is one
draw. The visibility flags would have to move into a per-instance buffer the shader reads instead of gating
the draw call.

## What it would win

Draw count on a street full of cars. Measured context: the in-game sweeps run **841 road cars** at draws
11–1678 total (index rows #14/#15), and the scale-ladder analysis found the frame's floor is the
draw/vertex side, not the pixel side — so this is the axis that actually moves those scenes. A hi-poly mod
car is ~20–30 submeshes; a dense street is where it would show.

## What it would cost

- The per-submesh visibility primitive is load-bearing in three systems at once (damage, LOD, extras). Moving
  it into a buffer means every one of them writes GPU state instead of flipping a flag, and the translucent
  submesh SORT (074/16 — a raked windscreen sorts by its nearest extent) has to survive the batching.
- Bundles: cell draw bundles are recorded, and anything that changes bind-group shape invalidates them.

## What would have to be true to pull it

- A measured draw-bound frame with cars as the dominant contributor — i.e. `draws` high AND the pass floor
  dominated by vehicles, not by world cells. Today the world's cells own that floor.
- Ideally after a cheaper cut below has been taken and was not enough.

## A cost added on this axis (2026-08-17)

The builder emits a TRANSLUCENT material group per spatial cluster (`renderware/vehicle/translucent-clusters.ts`
— connected pieces within 0.2 m merged, at most 8 per group), so a scattered group sorts honestly against the
glass ([open-issues/fixed/vehicle-glass-see-through.md](../../open-issues/fixed/vehicle-glass-see-through.md),
defect 3). Price on the comet: translucent submeshes 69 → 86, +17 draws per instance, blend phase only; opaque
groups are untouched. It applies to every `.osm` the builder writes (props too — the ferris ring's strip is
two clusters). The knob is the cap of 8: lowering it trades draws for sort exactness on the worst-scattered
groups only.

## Cheaper things to try first

- Cull vehicle submeshes by distance band earlier (the `_vlo` LOD already exists — check it is actually
  swapping at the intended range in the field).
- Skip drawing the interior submeshes of a car nobody is inside past N metres.

## The fleet's price, measured whole (2026-08-18)

Two A/B builds on the user's display lane (capped 120, `target 422`;
[`benchmarks/index.md` §2026-08-18](../../benchmarks/index.md)): the full 212-car high-poly fleet against the
STOCK cars on the same map is **+1.0..+2.6 ms of GPU pass on the city scenes** (lv-night 9.19 → 11.75,
ganton-night 9.19 → 10.83, ls-noon 5.52 → 6.86) and **~700 draws in view** on ls-noon (1265 → 1967) — while the
whole map's growth since 08-09 is +0.0..+0.5 ms. That is the budget this lever competes for; the `?benchcar=caddy`
pin (5.64 on ls-noon) is a fair proxy for it, so a batching change can be A/B'd against the pin without a rebuild.

Two facts for whoever picks this up: the `cellVertex` residency counter INCLUDES the vehicle geometry
(ocean-horizon 349 → 57 with zero live cars — the registered road-car `.osm` buffers sit in it), so read the
fleet's memory off that counter's stock-vs-fleet delta, not off the world's; and the country scene does not move
with the fleet at all (`country-dusk` 12.0–12.5 in every arm on the display lane, 4 cars) — this lever buys back
the CITY scenes only. Records: [`2026-08-18-ingame-ab2-all-mods-stock-cars.json`](../../benchmarks/opensa-engine/2026-08-18-ingame-ab2-all-mods-stock-cars.json)
against [`2026-08-17-ingame-full-hipoly-fleet-sweep.json`](../../benchmarks/opensa-engine/2026-08-17-ingame-full-hipoly-fleet-sweep.json).

## What a BUILD-TIME cut reaches (census 2026-08-18, `scripts/debug/vehicle-submesh-census.ts`)

Over the 200 fleet `.osm` in `build/original/opensa`: opaque submeshes shown by default **16 954 → 10 932
(−36 %)** if the builder welded submeshes that share every runtime-visible state (part, kind, damage group,
extra, variant, texture array, uv-anim slot, lamp, plate, tyre) — the per-vertex material state (colour, layer,
paint, reflect) is already in the vertices, so the engine would not notice. Translucent submeshes (4 218 shown)
cannot merge: they sort per submesh. What keeps the number at −36 % rather than −80 %: **parts** (the feltzer's
body spans 38 parts, `interior` alone 29 opaque submeshes over 6 texture arrays) and **size-bucketed texture
arrays** (one draw per array per part). The next two build-time steps, each with a price: fold the parts the
runtime never moves (not a door member, wheel, pop-up or damage twin — but CLEO natives address `misc_*` frames
by name, so those stay) into the chassis; and pack a car's small textures into ONE array (atlas layers, UVs
remapped — tiling materials excluded) so a part becomes one draw. `_vlo` is not the gap: 192/200 ship one
(mean 96 k body tris vs 4 k LOD); the eight without are stock-shaped (`trash solair rcbaron bmx rctiger bf400
rccam farmtr1`).

## The build-time route, in order (2026-08-18 — parked by the user, nothing built)

The runtime batching above is the expensive end of this lever. The cheap end lives in the vehicle BUILDER
(`packages/renderware/src/vehicle/build-vehicle-model.ts` — where the `.osm` is born, not opensa-pack) and
costs the engine nothing; each step is priced by the census script and is A/B-able with
`vehicle-installer --rebake` + the user's `?bench=all` against arm A. Order, cheapest first:

1. **Weld same-state opaque submeshes.** A submesh today is part × material (× translucent cluster). The
   per-vertex material state — colour, texture layer, paint slot, reflection — is already in the vertices;
   per submesh the engine only binds (texture array, uv-anim slot) and gates (part, kind, damage group,
   extra, variant, lamp, plate, tyre). Submeshes equal on that key become one draw and the engine cannot tell.
   Census: **−36 % of the shown opaque draws fleet-wide** (16 954 → 10 932; feltzer 216 → 124). Risk ≈ 0 —
   opaque has no order requirement. Half a day; the format does not change (fewer submeshes, same fields).
2. **One texture array per car.** What remains after 1 is one draw per array per part (feltzer `interior`:
   29 submeshes over 6 arrays — arrays are size-bucketed). Packing a car's small textures into layers of its
   large bucket (atlas layers, UVs remapped) makes a part ONE draw (feltzer → ~38). Price: tiling materials
   (UVs outside 0..1) must be excluded from the atlas; memory per car must be measured before choosing between
   atlas layers and upsampling.
3. **Fold the parts the runtime never moves into the chassis** — anything that is not a door member, a wheel,
   the pop-up part or a damage twin. Fewer draws AND fewer part matrices per frame (feltzer: 38 body parts).
   Risk: CLEO natives address `misc_*` frames by name (`packages/cleo/src/vm/native-atlas.ts`) — those parts
   stay; a fold must be by the RIG's own animated-part list, not by a name guess.
4. **Classify at build, cull at runtime**: tag `interior` / `enginebay` submeshes so the engine can skip them
   past N metres (or when nobody is inside) — the tag is build-time, the rule is a runtime one-liner.

What the build cannot buy: `_vlo` is not the gap (192/200 ship one), and the fleet's VERTEX cost — mean 96 k
triangles per body, ~24 live cars in a city scene — is only reachable with an intermediate LOD. Unlike the map's
hand-modelled meshes (opensa-lod-generator: remesh ≈ 0.2 %), the mod fleet is smooth-shaded imports and would
decimate; that is a separate idea, not this lever.

**Status of this route: parked (the user, 2026-08-18) — reopen with step 1 when the city scenes' 120 on the
display lane becomes the goal; the pair to beat is arm A, the control is `ocean-horizon`.**
