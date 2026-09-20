# 062 — Rendering overhaul (the "modern lighting" fork)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

Full rework of OpenSA's rendering toward modern-game visuals while **preserving the San Andreas prelit vibe**. This is the "modern-lighting fork (T3)" that plan [038 — SA prelit world lighting](../038-sa-prelit-lighting/readme.md) explicitly left out of scope. 038's sa-prelit look stays as the shipping baseline and the A/B reference throughout — every stage lands behind a toggle and is judged against it.

## Where we start (038 aftermath — already shipped)

Not a greenfield: sun `DirectionalLight` + PCFSoft shadow map (dynamics-only casters, world receives via manual injection in `world-material.ts`), procedural gradient sky dome with fbm clouds/stars/moon (`sky.plugin.ts`), `FogExp2` tracking the sky horizon colour (`fog.plugin.ts`), animated fresnel water shader (`water.plugin.ts`), corona sprites for 2dfx lights (`corona.ts`), MVP headlights (glow + corona flares, flagged for redo in plan 033), timed objects/lit windows (`timed-object.system.ts`, `windowGlow`), and a pmndrs `postprocessing` composer (SSAO → god-rays → bloom → ACES → SMAA, `postfx.plugin.ts`). Per-frame wiring hub: `apps/web/src/ui/canvas-host.tsx`.

## The central design problem

SA's prelit vertex colours already CONTAIN Rockstar's baked sun, sky and building shadows. A modern renderer adds real direct sun + moving shadows — naively stacked on prelit, light is counted twice (washed-out days) and baked shadows fight real ones. The chain's core idea:

> **Re-interpret prelit as the INDIRECT (GI/ambient) term** and add a calibrated real direct-sun term × real shadow on top: `colour = albedo × (prelit × indirectScale + sunColour × NdotL × shadow × directScale)`. Start with a global timecyc-driven split (shader-only, no new data); upgrade later with per-vertex baked channels (sun visibility / AO) from a new perfect-map-builder step — we own the map build (normals + smoothed groups already computed) and are free to leave DFF/TXD behind for opensa-native assets.

## Principles

1. **Vibe first**: SA's palette, timecyc moods, dawn/dusk/night atmosphere must survive; night keeps prelit + night vertex colours, and they should GLOW (bloom-fed emissives), not be replaced.
2. **Fast AND beautiful**: every stage has a frame-time budget measured on the reference machine before/after (standing rule: numbers into the plan doc). No stage ships without its measurement.
3. **Staged, toggleable, reversible**: each plan lands behind `Config.graphics` toggles with the 038 look as fallback; the default flips only in the final plan.
4. **One source of truth per phenomenon**: e.g. ONE fog function shared by world/water/sky shaders (today water re-implements fog by hand), the sky horizon LUT feeding both fog and water.

## The chain

| #   | Plan                                                                                              | Delivers                                                                                                                                                               | Status                                    |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | [063 — Foundations: instrumentation & colour pipeline](../063-render-foundations-instrumentation/readme.md) | perf HUD + benchmark harness + baselines; linear/tonemap decision; A/B scaffolding                                                                                     | done                                      |
| 2   | [064 — Hybrid world lighting](../064-hybrid-world-lighting/readme.md)                                       | real sun light on the prelit world without double-counting (indirect/direct split)                                                                                     | done                                      |
| 3   | [065 — Cascaded shadows](../065-cascaded-shadows/readme.md)                                                 | buildings/cars/peds cast real shadows: CSM, static-caster caching, LOD shadow proxies                                                                                  | done (core)                               |
| 4   | [066 — Modern asset tool (pmb → native cells)](../066-pmb-modern-tool/readme.md)                     | 5-plan tool chain: native format (meshopt/KTX2), **static batching** (draw-call cut), **baked static shadows** (CSM→dynamic-only), AO/sun-vis/emissive channels, tiers | **next — sub-chain, expanded 2026-07-10** |
| 5   | [067 — PBR sky & clouds](../067-pbr-sky-clouds/readme.md)                                                   | physically-based sky, 512×1 horizon LUT, weather clouds (skybox → volumetric)                                                                                          | done                                      |
| 6   | [068 — Unified fog & aerial perspective](../068-unified-fog/readme.md)                                      | fog that cuts the horizon (no more ocean-through-haze), height fog, one shared fog chunk                                                                               | done                                      |
| 7   | [069 — Water](../069-water/readme.md)                                                                       | realistic water: waves, depth-based shores, reflections (planar/SSR), underwater                                                                                       | 🅿️ v1 parked → 0.5.0                      |
| 8   | [070 — Local lights: headlights & street lamps](../070-local-lights/readme.md)                              | real projected headlights + clustered lamp pool; coronas demoted to distant impostors                                                                                  | done                                      |
| 9   | [071 — Night & emissive atmosphere](../071-night-emissive-atmosphere/readme.md)                             | glowing night vertex/tobj/neon, moon light, dawn/dusk grading calibration                                                                                              | done                                      |
| 10  | [072 — Quality tiers & default flip](../072-quality-tiers-default-flip/readme.md)                           | low/med/high/ultra presets, budgets enforced, new pipeline becomes default, cleanup                                                                                    | 🅿️ parked (interim modern default live)   |

Dependencies: 063 → 064 → 065; 066 (now a 5-plan tool sub-chain) starts after 065 proved the runtime, **re-scopes 065's CSM to dynamic-only** (static shadows baked), upgrades 064/071 (baked channels), and is the main perf lever for 072 (batching + dropped static caster passes); 067 → 068 → 069 (LUT → fog → water); 070 needs 064 (a lit world to receive light); 071 needs 067 + 070; 072 closes.

## Execution order (prioritized 2026-07-10, promotion from ideas/)

Waves — inside a wave the items are parallelizable, waves are ordered. Rationale: 063 gates everything
(instrumentation + the frozen colour pipeline); 064+065 are the headline visual pair and the longest calibration
tail — start them first; the sky→fog→water branch is independent and slots in whenever; 066 waits for 065 by
design; night (071) composes on almost everything so it goes late; 072 closes.

1. **Wave 0 — [063](../063-render-foundations-instrumentation/readme.md)** (perf HUD, GPU timers, bench harness, colour
   decision, `graphics.pipeline` switch). Also unblocks external consumers: the asi chain's far-view budget
   (perfect-map plan 010) and 05-lod-generators B3 both measure against this HUD.
2. **Wave 1 — [064](../064-hybrid-world-lighting/readme.md) → [065](../065-cascaded-shadows/readme.md)** (the core: lit world, then
   CSM). Serial by design.
3. **Wave 1b (parallel with Wave 1) — [067](../067-pbr-sky-clouds/readme.md) → [068](../068-unified-fog/readme.md)** (sky + LUT, then
   the fog cut — fixes the reported ocean-through-haze artefact; 068 only needs 067's LUT, not 064/065).
4. **Wave 2 — [069](../069-water/readme.md) ∥ [070](../070-local-lights/readme.md)** (water needs 068; local lights need 064).
5. **Wave 3 — [066 tool chain](../066-pmb-modern-tool/readme.md) ∥ [071](../071-night-emissive-atmosphere/readme.md)** (066 after
   065 proved the runtime; 071 after 067+070 exist to compose against). 066 is now the perf backbone — batching +
   baked static shadows land before 072's tiers so the ladder is built on the post-batching numbers.
6. **Wave 4 — [072](../072-quality-tiers-default-flip/readme.md)** (tiers from measured numbers, default flip, cleanup).

## Code recon (2026-07-10) — the plans' assumptions verified against the tree

A full sweep of the render surface confirmed every load-bearing assumption; key anchors for implementers:

- **Layout**: engine + plugins in `packages/game` (`src/plugins/*.plugin.ts`, `Plugin`/`PluginContext` in
  `plugin.ts`, `BasicRenderPipeline` in `render-pipeline.ts`); world material + timecyc + cell build in
  `packages/renderware` (`src/three/world-material.ts`, `src/parsers/text/timecyc.ts`, `src/map/build-region.ts`);
  React glue + debug overlay in `apps/web/src/ui/` (`canvas-host.tsx` wires plugins in order Fog → Sky → Water →
  VehicleReflection → PostFx and pumps per-frame uniforms in its `'coronas'` system; graphics defaults literal
  lives there too, not in game-config).
- **Confirmed gaps the chain fills**: NO fps/draw-call instrumentation anywhere (`renderer.info` unused); timecyc
  `farClip`/`fogStart` (+`dirMult`, `cloudAlpha`, `shadow`, `waterFogAlpha`…) parsed but unused — fog distance is
  purely `config.fog.distance`; water re-implements exp fog in its own shader (`water.plugin.ts`); renderer keeps
  three defaults — ACES tone mapping exists ONLY as a postfx `EffectPass`; no WebGL2 capability guard exists.
- **Shadow today**: `sky.plugin.ts` `SHADOW_MAP=2048`, `SHADOW_SIZE=45` ortho, PCFSoft, texel-snapped,
  dynamics-only casters, `autoUpdate` freeze at night/overcast; world receives via a manual 4-tap PCF in
  `world-material.ts` (`worldShadowUniforms`), strength pumped per-frame in canvas-host.
- **Test conventions**: `sky/water/postfx/game/renderer` are vitest-EXCLUDED (e2e-only via Playwright); the unit
  pattern for shader work is `world-material.test.ts` (exact `customProgramCacheKey` strings + fake-shader
  `onBeforeCompile` GLSL assertions); timecyc curves have their own unit tests.
- **Dead code flag**: `ambient-light.plugin.ts` / `directional-light.plugin.ts` are unwired stubs (SkyPlugin owns
  the real lights) — candidates for the 072 cleanup pass.

## External references (evaluate, don't adopt blindly)

- **Sky/atmosphere**: three.js `Sky` addon (Preetham — cheapest); Hosek-Wilkie model (better sunsets); Bruneton precomputed atmospheric scattering (github.com/ebruneton/precomputed_atmospheric_scattering) and its three.js production port **@takram/three-atmosphere** (github.com/takram-design-engineering/three-geospatial, MIT).
- **Volumetric clouds**: **@takram/three-clouds** (same monorepo, raymarched, weather-controllable); canonical technique: Schneider, "Real-Time Volumetric Cloudscapes of Horizon: Zero Dawn" (Nubis). Cheap alternative: per-weather panorama/skybox sets (Poly Haven CC0 skies) or SA-style billboard layers.
- **Water**: three.js `Water` addon (webgl_shaders_ocean — planar mirror + normal ripple, proven), `Water2` (reflection+refraction), FFT ocean (jbouny/fft-ocean; Tessendorf, "Simulating Ocean Water"), Gerstner waves for shader-only swell; SSR via **0beqz/realism-effects** (MIT).
- **Shadows**: three.js CSM addon (`three/addons/csm/CSM.js`), PCSS example (`webgl_shadowmap_pcss`) for contact-soft look.
- **Post/AO**: pmndrs/postprocessing (already in), `SelectiveBloomEffect` for emissives; **N8python/n8ao** as a faster SSAO candidate.
- **Asset format**: zeux/meshoptimizer (+ three `MeshoptDecoder`), KTX2/Basis Universal (three `KTX2Loader`), glTF as the container or a lean custom binary.
