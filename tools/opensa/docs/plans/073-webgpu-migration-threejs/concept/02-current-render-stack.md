# 02 — Current render stack (the port surface)

Everything below is what a WebGPU migration must reproduce. Inventoried from the `b84636f` tree (three `^0.177.0`).
This is the honest scope of "rewrite the rendering layer".

## Renderer (small, but the linchpin)

- `packages/game/src/core/renderer.ts` — a plain `new WebGLRenderer({ antialias, canvas })` + pixel-ratio + size.
- `packages/game/src/game.ts` — owns the render loop (`setAnimationLoop`): fixed-step systems → camera → plugin
  update → `pipeline.render()`; samples `renderer.info` per frame.
- `packages/game/src/plugins/render-pipeline.ts` — `BasicRenderPipeline`: either `renderer.render(scene, camera)`
  or runs registered passes (post-FX plugin installs the real pass).

Swapping `WebGLRenderer` → `WebGPURenderer` is one file. **Nothing renders correctly until the materials and
post-FX below are ported** — that's the actual work.

## Custom materials & shaders — the hard part

three's WebGPU path does **not** run GLSL. There is **no `onBeforeCompile`** and no `gl_FragColor`. Materials are
authored in **TSL** (Three Shading Language — a JS node graph that compiles to WGSL _and_ GLSL). Every custom
shader below is GLSL-string-based today and must be **re-authored as a TSL node material**:

| File                                     | ~lines | What it does                                                                                                                                                                                                 | Port difficulty                                                                             |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `renderware/src/three/world-material.ts` | 480    | **The main world material.** `MeshBasicMaterial` + `onBeforeCompile`: direct sun + CSM shadow sampling, night colours, window/beam glow, emissive, unified fog, day/night balance. Uniform-gated cache keys. | **Highest.** This is the engine's visual identity; must be pixel-faithful across day/night. |
| `plugins/sky.plugin.ts`                  | 839    | PBR sky + LUT, sun disc, the sun's near shadow map.                                                                                                                                                          | High.                                                                                       |
| `plugins/water.plugin.ts`                | 392    | Animated water surface.                                                                                                                                                                                      | Medium-high.                                                                                |
| `three/build-particles.ts`               | 298    | 2dfx particle systems.                                                                                                                                                                                       | Medium.                                                                                     |
| `three/corona.ts`                        | 129    | Light coronas (Points).                                                                                                                                                                                      | Medium.                                                                                     |
| `three/uv-anim.ts`                       | 103    | Scrolling-UV materials.                                                                                                                                                                                      | Low-medium.                                                                                 |
| `three/night-fill.ts`                    | 55     | Night vertex-colour fill.                                                                                                                                                                                    | Low.                                                                                        |

**5 `onBeforeCompile` sites** total. TSL can express all of it, but "express" = re-derive each shader as nodes and
re-verify the look. The `world-material` alone is a multi-week task to port faithfully.

## Shadows / CSM

- `plugins/csm.plugin.ts` + `plugins/sky.plugin.ts` + `shadows/csm-math.ts` (5 files touch shadows).
- Uses **three-native** `DirectionalLight.shadow` (three renders the shadow maps) with a static-caster caching
  schedule (plan 065). The **sampling** happens in `world-material` via custom `uCsm*` uniforms.
- WebGPU: three renders shadow maps too, but the **sampling code moves into the TSL world material**. The caching
  schedule (plugin logic) is renderer-agnostic and largely portable.

## Post-FX — a separate, full rewrite

- `plugins/postfx.plugin.ts` uses the **`postprocessing` library (6.39.1)** — `EffectComposer`, `EffectPass`,
  `GodRaysEffect`, `BloomEffect`, `SSAOEffect`, `SMAAEffect`, `ToneMappingEffect` (15 pass/effect sites).
- **`postprocessing` is WebGL-only. It does not run on WebGPU.** There is no compatibility shim.
- WebGPU replacement = three's **`three/webgpu` PostProcessing** (TSL-node passes). To be clear: **post-FX is NOT
  impossible on WebGPU** — only the _`postprocessing` library_ is dead. TSL fully covers screen-space passes.
  Status of equivalents:
  - **Tone mapping, bloom** — available as TSL nodes.
  - **God-rays, SSAO, SMAA** — **no first-party WebGPU drop-in**; each is a custom TSL implementation or a
    community port. This is a real chunk of work and a real risk.

### Shrink the post-FX surface by moving effects into the material / our format

A key refinement (own-format advantage): some effects done as **screen-space passes today can move into the
material via TSL or be baked into asset data**, removing whole passes:

- **SSAO → baked AO channel.** A per-vertex/texture AO baked into the model (exactly the parked tooling's `skyVis`
  channel) is read in the TSL material — **the screen-space SSAO pass disappears** (cheaper at runtime too).
- **Emissive/night glow → material emissive** (TSL, per-model) — already how we drive window glow.
- **Fog → already in-material** (unified fog in `world-material`).

What **cannot** move into a material — it's inherently screen-space (a material shades one surface point; it can't
read neighbouring pixels or the whole frame):

- **Bloom** — blurs a neighbourhood of the rendered image.
- **God-rays** — radial screen-space blur from the sun's screen position.
- **SMAA / AA** — edge detection on the final image (or replace with WebGPU **MSAA**).
- **Tone mapping** — best applied once as the final output step.

So the plan: **bake what can be baked (AO), shade what's per-surface in the TSL material (emissive, fog), and keep
only the genuinely fullscreen effects (bloom, god-rays, AA, tonemap) as TSL passes.** This is smaller than a
1:1 `postprocessing` re-port.

## Other GPU consumers

- `plugins/vehicle-reflection/vehicle-reflection.plugin.ts` — cube-camera reflections (portable pattern).
- `mods/wind.mod.ts` — vertex wind (shader-side; TSL port).
- Debug overrides in `game.ts` (`MeshNormalMaterial`, wireframe) — trivial.

## Summary of the port surface

- **1** renderer file (trivial swap, blocks everything).
- **7** custom-shader files → TSL (~2 300 lines of shader logic re-authored; `world-material` dominates).
- **1** post-FX stack off `postprocessing` onto three-WebGPU nodes (+ god-rays/SSAO/SMAA reimplemented).
- **5** shadow files re-wired (sampling into TSL; caching logic ports).
- **7** plugins to audit for renderer assumptions.

None of it is impossible in TSL. All of it is real. See [04-migration-plan.md](04-migration-plan.md).
