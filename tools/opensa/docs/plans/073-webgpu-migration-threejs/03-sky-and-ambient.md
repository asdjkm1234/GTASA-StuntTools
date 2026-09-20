# 073/03 — Sky & ambient under WebGPU

**Priority: P0.** All plugins are skipped under `?webgpu=1`: no sky dome, no sun disc, no ambient/hemisphere
lights, no time-of-day drive. The world renders on baked prelit only (dark), dynamics get no light at all
(plan 02 depends on this), and `worldTint`/`dnBalance` uniforms are never driven (syncWorldTsl copies statics).

## Context

- `sky.plugin.ts` (839 lines: dome GLSL, PBR sky + LUT, sun/moon, lights, shadow aiming) — the biggest port.
- Slice it: LIGHTS + uniform drive first (cheap, unblocks 02), dome visuals second.

## Tasks

- [x] **Slice A (unblocks everything):** a WebGPU-mode "sky-lite" system (not the GLSL plugin): create sun
      DirectionalLight + ambient/hemisphere, drive their intensity/colour + `worldTintUniform`/`dnBalanceUniform`
      /`worldSunUniforms` from the existing timecyc sampling (reuse the plugin's pure math, skip its GLSL).
      _Done 2026-07-11:_ `packages/game/src/plugins/sky-lite.system.ts` (a SYSTEM — systems run under webgpu)
      reuses `sunElevationAt` + the timecyc sample + `SKY_LIGHT_TUNING` (exported from sky.plugin so both modes
      share one set of numbers). `canvas-host` builds a `skyView` abstraction (nightFactor / sunDirection /
      sunShadow) choosing sky-lite vs the SkyPlugin, so the whole world-uniform drive block
      (uDn/uTint/uSunDir/uSunColor/shadow mirror) went live under webgpu with no per-uniform changes.
      Sun `castShadow` stays **false** until plan 05 (r185: a never-rendered castShadow map binds a non-depth
      fallback and drops lit draws); `uWorldShadowStrength` correctly resolves to 0 (null map). 5 unit tests.
- [~] **Slice B:** sky dome in TSL (gradient or LUT-based `backgroundNode`), sun disc + corona sprite, moon.
- [~] **Slice C:** the 512×32 horizon LUT generation without `ShaderMaterial` (compute the LUT on CPU or via a TSL
      RTT) — feeds plan 04's unified fog.
- [x] Wire the day/night clock drive (dnBalance ← clockNightFactor) in webgpu mode. _Was already driven
      unconditionally by the `coronas` system (a system, not a plugin) — the dead reads were nightFactor/sunDir/
      shadow, all fixed by `skyView` above._

## Done

Under `?webgpu=1`: lit world with correct day/night cycle, visible sky (at least gradient), sun/ambient lighting
dynamics; `uSunDir/uSunColor/uDn/uTint` live.
