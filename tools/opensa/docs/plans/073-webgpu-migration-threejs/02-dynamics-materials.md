# 073/02 — Dynamics materials (player, vehicles, peds)

**Priority: P0.** Under `?webgpu=1` dynamics render as BLACK silhouettes: their lit materials
(`MeshStandardMaterial`/`MeshPhysicalMaterial` from `buildMaterial`) auto-convert, but every light lives in the
skipped plugins (sky's sun/ambient/hemisphere) → lit path × no lights = black.

## Context

- `build-clump.ts buildMaterial` (standard/physical + vehicle userData), `build-skinned-clump` (player),
  `night-fill.ts` (GLSL `onBeforeCompile` — dead under WebGPU), vehicle-reflection plugin (skipped).
- Dynamics are NOT bundled (they move) — no freeze interplay.

## Tasks

- [x] Decide the lighting model for dynamics under WebGPU: simplest correct = keep auto-converted standard
      materials and provide REAL lights (needs plan 03's sun/ambient at minimum) — verify that alone un-blacks them.
      _Done 2026-07-11: plan 03 slice A (sky-lite) landed and **field-confirmed** — dynamics lit under `?webgpu=1`._
- [x] Port night-fill to TSL (emissive hemisphere + rim on `emissiveNode`) — composes with the standard material
      via `MeshStandardNodeMaterial` swap in `buildMaterial` under a TSL flag (mirror the world-material builder
      registration pattern). _Done 2026-07-11: `night-fill-tsl.ts` — `buildDynamicMaterialTsl` (node-material twin
      of buildMaterial's class choice, registered via `setDynamicMaterialTslFactory`) + `applyNightFillTsl` (the
      034 math as one shared `emissiveNode` graph, via `setNightFillTslApplier`) + `syncNightFillTsl` in the
      tsl-sync system. **Field-check at night pending.**_
- [x] Vehicle reflection: defer the cube-probe (plugin) — set a neutral `envMapIntensity`; log a follow-up.
      _Deferred 2026-07-11: the plugin is skipped so no envMap is ever assigned (nothing to neutralise) and
      `installSaReflection`'s GLSL patch is inert on node materials — paint is matte. Reflective materials stay on
      `MeshPhysicalNodeMaterial` so the port lands on the right class. Follow-up noted in night-fill-tsl.ts._
- [~] Player skinning sanity under WebGPU (SkinnedMesh + bones — three supports it; verify animations) —
      **field-verify** (player walked in earlier webgpu runs; confirm animations after the material swap).
- [x] Headlights/brake glow (worldLocalLightUniforms consumers) — verify or stub without the GLSL pool.
      _Verified 2026-07-11: the producers (vehicle-headlight/street-light systems) run and only write pool
      uniforms — harmless. The CONSUMER is the world material's GLSL local-light pool → the TSL twin is plan 04's
      local-lights slice; headlight coronas (ShaderMaterial sprites) are plan 06._

## Done

Player and vehicles visibly lit day and night under `?webgpu=1`, animations intact.
