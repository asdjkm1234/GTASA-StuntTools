# 064 — Hybrid world lighting (real sun on the prelit world)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [063](../063-render-foundations-instrumentation/readme.md) (frozen colour pipeline + benchmarks). THE foundation plan: solves "how to add real light to the current world while keeping the SA prelit vibe".

## Context

Plan 038 made the static world authentically unlit: `texture × mix(dayPrelit, nightPrelit, dnBalance) × timecycTint` in `world-material.ts` (MeshBasicMaterial + injections), normals present but unused for lighting (they feed SSAO). Sun/ambient/hemisphere only light dynamics. The problem with simply re-lighting the map with `MeshStandardMaterial` was already lived through pre-038: harsh days, double-darkening, garbage-normal sensitivity — because **prelit already contains Rockstar's baked sun + sky + building shadows**.

Assets are better now than pre-038: map-optimizer computes smooth-group normals (`smooth-normals.ts`), plan 037 sanitizes stored ones — normal quality is no longer the blocker it was.

## Decisions

1. **Indirect/direct split, shader-level first.** Extend the 038 world shader (keep `MeshBasicMaterial` + injection — full program control, no three lighting plumbing):

   ```glsl
   vec3 indirect = prelitBlend × uIndirectScale;               // prelit re-read as GI/ambient
   float ndl     = max(dot(normal, uSunDir), 0.0);
   vec3 direct   = uSunColor × ndl × shadow × uDirectScale;    // real sun, real shadow term
   color = texel.rgb × (indirect + direct);
   ```

   `uIndirectScale`/`uDirectScale` are timecyc/hour-driven curves (calibration knobs like 038's `worldLight` config). Intuition: at noon prelit keeps ~60–70% of its role (vibe preserved), the sun term adds directional life; at night `uDirectScale → 0` and the pipeline degrades to exactly 038's look.

2. **De-lighting is NOT in this plan.** A global split double-counts a little by construction (baked sun highlights stay in prelit). Accepted for stage 1; plan [066](../066-pmb-modern-tool/readme.md) later bakes per-vertex sun-visibility/AO channels in perfect-map-builder so `uDirectScale` can be modulated per-vertex (baked shadow areas get less real sun — kills the double-count where it's most visible).
3. **Normals**: use the geometry normals as-is (post-037/map-optimizer). Faceted or missing normals fall back to `ndl = uSunElevationFactor` (flat response) via a degenerate-normal guard — never black, never NaN.
4. **Dynamics keep their lit path** (MeshStandard + sun/ambient/hemisphere) — but SkyPlugin intensity constants get recalibrated once the map stops being unlit-only (they were tuned dynamics-only after 038).
5. **Behind `graphics.pipeline: 'modern'`** (from 001); `'classic'` renders the exact 038 path. Both compile as program variants of the same material (cache keys like `saWorld|night` today) — no scene rebuild on toggle.
6. **Calibration is the deliverable.** Code is ~days; matching the vibe across 8 weathers × 24 hours is the real work (038 learned this). Screenshot matrix tooling from 001's harness reused: same camera, hour sweep, side-by-side classic/modern.

## Tasks

- [x] Extend `world-material.ts`: **shipped** — `worldSunUniforms` (`uSunDir/uSunColor/uIndirectScale/uDirectScale/uSunFlat/uPipelineMix`), world-space NdotL in the vertex stage (per-vertex `vSunNdl` — prelit is per-vertex anyway, saves fragment ALU) with a NaN-free degenerate-normal guard (`inversesqrt(max(len,1e-8))` + `step` fallback to the flat elevation response). Night parity: night prelit + windowGlow untouched. **Design deviation (better than planned): uniform-gated, NOT program variants** — `uPipelineMix` blends `saClassic` (exact 038 math) and `saModern` per fragment; toggling `graphics.pipeline` changes one uniform, zero recompiles, cache keys unchanged.
- [x] Shadow factor: the existing manual PCF term multiplies **only the direct term** on the modern path (prelit-as-indirect keeps GI in shadowed areas — THE point); classic path keeps the whole-frame multiply bit-exact.
- [x] Uniform pump in canvas-host's `'coronas'` system beside tint/dnBalance: sun dir/elevation from `SkyPlugin.getSunDirection()`, sun colour from the timecyc `dir` sample (linear via `setRGB(..., SRGBColorSpace)`), overcast read back from the sky's shadow damping (`1 − sunShadow.intensity`). Curves = **`sunSplit()`** (`packages/renderware/src/three/sun-split.ts`) — pure, linear (weather-blend/hour continuous), unit-tested (night → `{0,1}` classic parity, noon-clear → `{sunDirect, sunIndirect}`, overcast kill, linearity).
- [x] Calibration knobs: `worldLight.sunDirect` (default 1) / `worldLight.sunIndirect` (default 0.7) in config + two new sliders in debug → Atmosphere (WORLD LIGHT block).
- [~] SkyPlugin recalibration pass for dynamics (ambient/hemisphere constants) so cars/peds match the newly-lit ground. _After first in-game look._
- [~] Screenshot matrix: hour × weather sweep for LS/SF/LV benches; **user sign-off** on the split curves; record final constants here.
- [x] Perf: **confirmed ≈ 0 delta** — `ls-noon` modern: avg 53.71 ms / GPU 39.52 ms vs classic baseline 53.47–52.47 / 39.46–39.61 (within run-to-run noise). The hybrid term is free.
- [x] Tests: shader-injection tests extended (sun uniforms shared, NdotL guard, `saTexel` captured before the prelit multiply, classic-defaults inert) + `sun-split` curve tests. All green (875 across renderware+game); lint/tsc clean.

### How to try it (user)

F2 → **Graphics** → check **Modern pipeline** — the world gets a real directional sun on top of prelit
(strongest at noon on sun-facing walls/roofs). Calibrate in **Atmosphere → SUN DIRECT / SUN INDIRECT KEEP**;
compare classic↔modern live (the toggle is instant — uniform only). Night should look IDENTICAL to classic.

## Verification

- Bench scenes: classic vs modern A/B at 08/12/17/21/00 h across sunny/overcast/rain/fog.
- The night look at `uDirectScale=0` is pixel-identical to classic (regression screenshot diff).
- No FPS regression beyond noise on all bench scenes.

## Measurements

- **First in-game look (2026-07-10, user): POSITIVE.** The difference is visible, the sun works, the picture reads
  livelier and brighter; tweaking the sun strength looks beautiful. Defaults (sunDirect 1 / sunIndirect 0.7) read well.
- **World-pass delta: ≈ 0** (ls-noon modern 53.71 ms avg / GPU 39.52 vs classic 53.47 / 39.46 — noise).
- **Night too dark (user):** wants a SKY-LIGHT ambient lift at night — deferred by the user (later); natural
  home is [071 — night & emissive](../071-night-emissive-atmosphere/readme.md) (moon term + skylight) — noted there via
  the chain. Interim knob: `worldLight.lodNightAmbScale`/`nightPrelitBrightness` sliders.
- **NEW FINDING — the hybrid sun is a live normals validator.** The unlit 038 world never READ normals, so
  defects were invisible; with NdotL lighting the user immediately spotted a couple of in-game normal bugs.
  These are ASSET bugs (map-optimizer/tools conditioning, plan 037 territory), not shader bugs — fix in tools,
  re-run the map build. Details TBD (user to point at the spots); recorded in memory.
- Final indirect/direct curves per weather class: _pending the calibration sweep (hour × weather)._
- Sign-off screenshot set: _pending._
