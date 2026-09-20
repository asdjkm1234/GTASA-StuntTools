# 069 — Water

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [068](../068-unified-fog/readme.md) (shared fog chunk + horizon LUT). Replaces the current water shader with a modern one.

## Context

Today (`water.plugin.ts` over the `water.dat` mesh): animated ripple normals + slow swell, fresnel blend deep-tint→horizon, Blinn sun glint, timecyc colours/alpha, hand-rolled fog. Honest 2010-era water. Missing: real wave shapes, shore interaction (depth-based transparency/foam), reflections of the world (only sky fresnel today), refraction, and an underwater state.

## References to evaluate (user asked for concrete options)

| Option                                                            | What it gives                                          | Cost/notes                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| three.js `Water` addon (`webgl_shaders_ocean`)                    | planar mirror reflection + normal-map ripple           | one extra scene render for the mirror — expensive with our draw counts; reflection could render LOD cells only |
| three.js `Water2` addon                                           | reflection + refraction + flow maps                    | same planar cost ×2; flow maps irrelevant for sea                                                              |
| Gerstner waves (shader-only, e.g. GPU Gems ch. 1 formulation)     | real displaced wave shapes, choppiness, cheap          | vertex-shader only — needs a tessellated water grid near camera (projected grid or radial mesh)                |
| FFT ocean (jbouny/fft-ocean; Tessendorf "Simulating Ocean Water") | best open-ocean spectrum                               | heavy (FFT per frame); likely overkill for SA's coastal water                                                  |
| SSR via 0beqz/realism-effects                                     | screen-space world reflections, no second scene render | ghosting/edge artefacts; composes with our pmndrs composer; ultra tier                                         |

Recommended composition: **Gerstner (3–4 octaves) + depth-based shore + planar reflection at half-res rendering LOD-cells-only, SSR as ultra alternative** — believable SA coastal water without FFT machinery.

## Decisions

1. **Keep the `water.dat` zoning** (sea level, pools) as the source of truth; add a **near-camera tessellated ring** (projected/radial grid) for Gerstner displacement, decaying to the flat far plane that 006's fog cuts at the horizon.
2. **Depth-based shore**: needs a scene depth texture (the composer's depth already exists for SSAO) — water transparency ramps by water-floor depth (clear shallows → deep tint), plus a foam band at intersection. This single feature is the biggest realism jump per ms.
3. **Reflections staged**: stage 1 = sky-only reflection via the PBR sky + horizon LUT (free, already better than today since the sky is better); stage 2 = half-res planar mirror rendering far LOD cells + sky only (measured decision); SSR experiment last.
4. **Underwater**: camera-below-surface state — tinted fog (006 chunk with underwater params), waterline meniscus strip, muffled sky. Scope-boxed to "looks intentional", not a diving feature.
5. **timecyc stays the colourist**: water RGBA per hour/weather keeps driving tint/alpha so lakes at dusk keep their SA mood.
6. **Budget**: ≤ 1.5 ms base tier; planar reflection only if it fits in +1.5 ms half-res on reference.

## v1 SHIPPED but PARKED (2026-07-10) — rework moved to 0.5.0

**User verdict after several iterations: the water is mediocre overall.** The approach hit its ceiling: displacing only
the NORMAL (the `water.dat` quads are too coarse to displace vertices) means the surface is geometrically FLAT — a
moving glint but no travelling waves / silhouette / beach run-up (waves stand in place). The half-res depth-shore
also flickered around pier piles (fixed partly with an `fwidth` edge-reject) and cost a full-scene DepthPass (made
opt-in via `water.shore`). v1 stays in tree as a working baseline / `low`-tier surface; the real rework —
**camera-following Gerstner-displaced grid, foam from the wave Jacobian (no depth buffer), baked shoreline** — is
specced in **docs/roadmap/0.5.0/plans/01-water (docs/roadmap/0.5.0 — the water plan folder was renumbered away)**. Keep-verbatim parts:
`seaState()`, the sky-LUT reflection, GGX glint, underwater tint, timecyc colour, fog-chunk integration.

### What v1 shipped (kept as the fallback)

- **Shore depth (decision #2, "the biggest realism jump per ms") — landed, and cheaper than feared.** A pmndrs
  `DepthPass` runs BEFORE the main render with the **water layer disabled** (its own render layer, `layers.set`
  not `enable`, or it stays on layer 0 and the pass would capture the SURFACE's depth). So the water shader
  reads the depth of the SEA FLOOR: shallow → clear + a scrolling foam band, deep → the timecyc tint. Half-res.
- **Gerstner waves, analytically (decision #1, adapted).** The `water.dat` quads are far too coarse to displace,
  so the four wind-aligned wave trains are summed as a SLOPE (normal), not a displacement — the shape reads
  entirely through the lighting, at zero vertex cost. Steepness sharpens crests / flattens troughs (the
  Gerstner signature) and crest height drives whitecaps. Sea state per weather from the pure, unit-tested
  `seaState()` (`packages/game/src/water/wave-params.ts`): overcast raises a swell, rain/storm a real sea, and
  each weather gets a stable wind heading (never time-dependent — the sea must not spin as hours pass).
- **Reflection stage 1 (decision #3) — free.** The fresnel term now samples the **067 sky LUT by the reflected
  direction** (azimuth × elevation) instead of a single horizon colour, so the water reflects the actual sky
  above it, and matches it exactly at the horizon. The LUT was already bound for the fog.
- **Sun glint upgraded to GGX** against the real sun direction, with roughness tied to the sea state: a calm
  sea gives a tight highlight, a storm a long shattered sparkle path.
- **Underwater state (decision #4)**: the camera below the surface flips the normal and drowns the sky in the
  deep tint. Waterline meniscus strip not done (scope-boxed).
- Config grew `water.waves` / `water.foam` / `water.shoreDepth` + Graphics sliders; classic pipeline untouched
  (single horizon colour, no depth, no foam — `uFogMix`/`uDepth` gate everything).

**Not in v1:** planar/SSR reflection (stage 2 — decided by measurement), a tessellated near-camera ring with
real vertex displacement, the waterline strip.

## Tasks

- [~] Water grid: near-camera tessellated ring following the camera + far flat plane; seams verified (skirt/blend zone).
- [~] Gerstner vertex displacement (3–4 octaves, wind-aligned by weather) + normal reconstruction; storm/calm sets per weather class.
- [~] Shore depth: depth-texture sampling, transparency ramp + foam band (noise-scrolled); verify against beaches, Verona/Santa Maria bench.
- [~] Reflection stage 1 (sky+LUT), stage 2 planar (half-res, LOD-only scene list, mirror camera) behind `graphics.water.reflection: 'sky'|'planar'|'ssr'`.
- [~] Sun glint upgrade (GGX-ish spec against the real sun dir) + glint on wave crests only.
- [~] Underwater state (fog params swap + waterline strip).
- [~] Fog: consume the 006 chunk (delete remaining private fog); horizon cut verified over open sea.
- [~] Config/debug sliders (`graphics.water` grows), bench numbers per stage.

## Verification

- Beaches: shore transparency + foam read naturally at noon and dusk.
- Open sea horizon: pure fog cut (006 regression re-run over Gerstner geometry).
- Reflection A/B: sky-only vs planar screenshots; measured ms decides the default tier.

## Measurements

_(record after implementation)_

- base water ms / planar ms / SSR ms: …
- final wave/foam parameter sets per weather: …
