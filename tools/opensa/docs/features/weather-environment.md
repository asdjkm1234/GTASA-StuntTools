# Weather + environment (sky, water, fog)

`packages/engine/src/render/sky-lut.ts` + `hosek-wilkie.ts` (sky/fog inside the engine's frame),
`packages/game/src/adapters/engine-environment-driver.ts` (timecyc → engine environment),
`packages/game/src/plugins/cloud-profile.ts`, `packages/game/src/weather/`,
`packages/renderware/src/parsers/text/timecyc*` + `water.parser.ts`,
`packages/renderware/src/map/ocean-frame.ts`, plans 014/024/028/029/031 and 074/06+21.

## Implemented

- **timecyc**: the table comes from the first of THREE names a world carries —
  `data/timecyc_24h.dat`, then `data/timecyc24h.dat` (the `timecyc24h.asi` plugin's name; same format), then
  the stock `data/timecyc.dat`, which is expanded from 8 keyframes on load. One order, one resolver
  (`TIMECYC_SOURCES`, plan 104), and `ensure24h` decides by row count rather than by a flag, so a 504- or
  552-row authored table passes through. Every reader prints the winner once at boot (`[timecyc] …`),
  because choosing between two present names fails nothing. Per-weather per-hour colours (sky top/bottom,
  ambient, sun, fog…), blended sampling (`sampleTimecycBlend`). Colours are 0–255 **sRGB** — uniforms decode
  with colour management (managed=true) or the night sky washes grey.
- **Weather manager**: per-city weather sets (`weatherForCity`), region-crossing keeps the
  current weather but follows the new region's set; smooth transitions
  (`weatherTransitionSeconds`); debug Weather screen (rain/storm excluded by design).
- **Sky**: a Hosek-Wilkie radiance LUT built on the CPU and shared by sky AND fog
  (`engine/src/render/sky-lut.ts` + `hosek-wilkie.ts`), sun disc + god-rays source, procedural cumulus
  baked to a 256² field, stars, moon; the night factor feeds every consumer. (Until 074/13 this was a
  three `sky.plugin.ts` gradient dome — the sky v2 arc replaced the model, not just the renderer.)
- **Water**: `water.dat` quads + the infinite ocean ring, classified SEA vs INLAND (plan 075), baked
  offline (`opensa-pack/water.ts` → `water.bin`): ~16 u tessellation on a world lattice + a per-vertex
  DEPTH field (true water−ground where the weld's sea-band height grid has data; shore-distance
  pseudo-depth for elevated lakes). Shorelines are unpaired quad edges verified by a two-sided coverage
  probe — a T-junction seam between same-level quads is NOT a shore (plan 087 row C: false seams striped
  every gostown lake with static shallow bands). Runtime: Gerstner displacement damped by the field,
  fresnel/sky reflection, sun glint, foam + swash on the depth bands; fog in the same shader so the far
  ocean dissolves into the horizon like terrain. **Without a bake** (a pak converted before 074/06 row 12,
  or a source FOLDER, which never has one) the flat build stands in: `flatWaterMesh`
  (`renderware/map/water-mesh.ts`) tessellates the quads plus the ocean frame with a constant "deep" field
  — no foam, no beach damping — and it is shared by the game host and sa-map-viewer, so both draw one sea.
  `Engine.waterEnabled` gates the DRAW (plan 094/07) without dropping the mesh: an inspector switches the
  sheet off to look under it, and a pixel A/B has to, because the waves ride the frame clock. The in-game
  Map Viewer got the "Show water" checkbox 2026-08-11, when its host implemented the `setShowWater` the
  inspector had been gating on since 094/07; leaving the viewer restores the sea.
- **Fog**: distance fog blended into the sky horizon colour from the same LUT, driven by timecyc
  (`engine-environment-driver.ts`). Since plan 074/21 fog is a strict SUBSET of the LOD ring — the cap
  follows `?draw=` so the cull edge can never be exposed — and clouds composite into the fog colour at
  the dissolve band. The WebGL-era Map-screen slider went with that renderer.

## Known gaps / candidates

- Rain/storm/sandstorm weathers intentionally not selectable (no precipitation effects yet).
- Underwater rendering state (timecyc has it; we don't switch).
- Water is visual-only (no swimming physics/buoyancy).

## Test coverage anchors

`timecyc` parser/convert/sample tests, `weather-zones` tests, `opensa-pack/water.test.ts` (tessellation,
depth field, T-junction seam vs dam-lip shoreline, SEA/INLAND classes), `renderware/map/water-mesh.test.ts`
(the flat build: triangles per polygon, GTA layout, SEA/INLAND from height, the frame around the extent),
and the `water` block in `engine.frame.test.ts` (the draw gate, on the fake device).
