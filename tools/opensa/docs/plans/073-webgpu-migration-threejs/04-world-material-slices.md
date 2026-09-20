# 073/04 — World-material TSL slices (parity with the GLSL shader)

**Priority: P1.** `world-material-tsl.ts` today = classic path + modern sun N·L. The GLSL original also has:
CSM shadow sampling, classic single-map shadow, unified LUT fog + horizon cut, night emissive glow, moon term,
local light pool, window-glow overlay, beam handling nuances.

## Context

- Source of truth: `packages/renderware/src/three/world-material.ts` (GLSL) — port term by term.
- The bake-vs-pass decision ([06-bake-vs-pass](concept/06-bake-vs-pass.md)) says: fog and
  emissive live IN the material; AO may come baked (plan 07).
- Uniform groups: everything shared per-frame goes to `renderGroup` (frozen-bundle rule — already the pattern).

## Tasks (each slice = author in TSL → verify vs WebGL screenshots day/dusk/night)

- [x] Unified fog: LUT azimuth colour + timecyc exp² + height factor + horizon cut (`worldFogUniforms`).
      _Partial 2026-07-11: the CLASSIC shape ships — the FogPlugin instance is installed under WebGPU as a
      `fog-lite` system (scene FogExp2 + horizon colour + background; node materials fog by default), matching
      the WebGL classic path. The LUT fog is gated in canvas-host (`uFogMix` flips only when `skyView.horizonLut()`
      exists) and waits for 073/03 slice C; then port the LUT term into the TSL colorNode._
- [x] Night emissive glow (`uEmissiveBoost`, luma-delta over night vertex colours) + window-glow overlay material.
      _Done 2026-07-11: glow term on nightBlend materials + `applyWorldWindowGlowTsl` (additive `texture ×
  uWindowGlow` on colorNode; `applyWorldWindowGlow` delegates via `setWorldWindowGlowTslApplier`). The TSL
      builder now also sets `material.map` — build-region's treatment gate reads it. CAVEAT: TSL materials are
      cache-SHARED — a WeakSet guards double-application; if a timed-overlay texture is ever shared with plain
      geometry the glow leaks (candidate for a 'timed' variant key)._
- [x] Moon N·L term (`worldMoonUniforms`). _Done 2026-07-11: wrapped N·L on `normalWorld`; sky-lite tracks the
      moon (fixed azimuth from `SKY_LIGHT_TUNING.moonAzimuth` × config elevation) and `skyView` feeds the drive
      (`sunSin`/`moonDirection` no longer read the dead plugin)._
- [~] CSM/shadow sampling — after plan 05 provides maps (depth-texture comparison sampling in TSL).
- [x] Local light pool (worldLocalLightUniforms — uniform arrays in TSL; pool of 12). _Done 2026-07-11:
      `uniformArray` wraps the engine's Vector4/Color arrays BY REFERENCE (UniformArrayNode re-uploads per
      render), TSL `Loop`/`If` port of `saLocalLight` — headlight/brake/street-lamp pools should light the
      world under WebGPU. **Field-verify at night in a car.**_
- [x] Beam materials (vertex-alpha floodlights) parity check. _Fixed 2026-07-11: beams read the `color`
      attribute as vec4 (it was typed vec3 — WGSL type mismatch with the buffer) and fold the per-vertex cone
      alpha into `opacityNode`; blended, no alpha-test, no depth-write — parity with the GLSL path._
- [~] Pixel-compare pass across a day sweep vs WebGL (the map-viewer compare workflow) — after the LUT fog +
      plan 05 shadows land (comparing now would just diff the known-missing terms).

## Done

`?webgpu=1` world is visually indistinguishable from WebGL classic+modern across a day cycle (fog, night glow,
shadows), verified with side-by-side captures.
