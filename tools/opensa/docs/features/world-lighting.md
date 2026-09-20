# World lighting (SA prelit pipeline)

`packages/engine/src/render/shaders.ts` (the `world` pipeline — `worldShade`),
`packages/game/src/adapters/engine-environment-driver.ts` (the config/timecyc → `Environment` driver),
`tools/opensa-pack/src/weld.ts` + `ao.ts` + `sunvis.ts` (the offline bakes), plans 038 + 074/06/07/09.

## Implemented

- **Hybrid lighting** (the shipped 064 model, ported in 074/06): the SA prelit set is the INDIRECT
  term, and the sun adds a real DIRECT term on the raw albedo —
  `texel × (prelit × indirectScale × AO + sun·N·L + moon·N·L + local lights + glow)`. Vertex normals
  are therefore load-bearing, not decoration.
- **Day↔night prelit blend** (the SA DNBalance) is one `frame.params.x` driven by the wall-clock lit
  fade. Cells with no authored night set carry a converter-synthesized night (day × ambient), so one
  formula covers the whole world and the old two-tint-family split is gone.
- Day arc follows sun height (white noon → warm dim dawn/dusk); timecyc supplies the colours when the
  live game VFS has it.
- **Baked static shadowing** instead of a shadow map: `sunvis.ts` bakes an arc-averaged sun-visibility
  scalar per vertex (`normal.w`) — dark under bridges and in canyons, smooth by construction, but it
  does not track the moving sun. `ao.ts` bakes AO/skyVis into the low channels byte and modulates
  ONLY the indirect term. Both are gated per cell so old paks render unchanged.
- **Night emissives**: a vertex much brighter at night than by day IS a lit window; the converter bakes
  that mask (the shader keeps a heuristic fallback) and adds it as a glow term. The delta is per-CHANNEL
  max, not luma — saturated neon (the LV strip's red rope lights, night 255/49/49 over a grey day) reads
  darker than day in luma and never glowed under the old luma rule (fixed in the map-object round).
- Moonlight is a WRAPPED N·L normalized to prod's fixed 5° moon elevation, gated by the same sun-vis bake.
- PostFX (074/09): ACES tone mapping (always on by design since plan 038), bloom (prod dual-filter with
  the 071 night threshold), god rays. There is **no runtime SSAO** — the baked AO replaces it.
- Calibration knobs in `graphics.worldLight` + debug → Atmosphere sliders.
- Degenerate-normal repair (black-face fix) for stored and computed normals
  (`sanitizeDegenerateNormals`, `packages/renderware/src/mesh/prepare-clump.ts`).

## Known gaps / candidates

- Dynamic objects (player/vehicles) are lit by the sun/moon path — no prelit for them (by design).
- Static street lamps light nothing but themselves (plan 074/17 territory — see night-and-time.md).
- Per-object ambient calibration for dynamics (plan 038 leftover note).

## Test coverage anchors

`engine/src/render/shaders.test.ts` (WGSL snapshots), `mesh/prepare-clump.test.ts` (attributes, normals
repair), `adapters/engine-environment-driver.test.ts` (arcs, timecyc colours, the negative-cloud-colour NaN
regression), `opensa-pack` `ao.test.ts` / `sunvis.test.ts` / `weld.test.ts` (the bakes).
