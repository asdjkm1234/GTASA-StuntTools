# 073/05 — Shadows under WebGPU

**Priority: P1.** No shadows in webgpu mode today (plugins skipped; world material's shadow terms unported).
three's WebGPURenderer renders shadow maps itself (depth textures); our job is the plugins + TSL sampling.

## Context

- `sky.plugin` near map (dynamics-only, 45 m) + `csm.plugin` (2 static cascades, refresh schedule) + `csm-math`.
- The plugin LOGIC is renderer-agnostic; the world-material SAMPLING is plan 04's CSM slice.
- Interplay with bundles: static cascades render the STATIC layer — frozen bundled objects must still render into
  shadow passes (verify: bundle replay vs shadow pass render lists; shadow pass uses its own renderContext, and
  bundles are per-context — check whether shadow passes take the bundle path at all).
- The r185 depth-texture semantics: sampling = comparison samplers (`textureCompare` in TSL), no more
  `unpackRGBAToDepth`.

## Tasks

- [~] Enable sun.castShadow path under webgpu (sky-lite from plan 03 owns the light) + render the near map.
- [~] Run CsmPlugin under webgpu (it's GLSL-free; verify its shadow renders + the render-once guard).
- [~] TSL comparison sampling of the three maps in the world material (plan 04 slice) + dynamics receiveShadow.
- [~] Verify shadow passes × bundles (frozen objects must cast; check the shadow render path ignores bundles or
      handles them correctly).
- [~] Re-tune biases for depth-texture shadows (r182+ guidance: reduce bias).

## Done

Dynamic near shadows + static cascades visible under `?webgpu=1`, no acne/peter-panning regressions vs WebGL.
