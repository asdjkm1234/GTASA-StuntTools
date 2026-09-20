# 01 — The bottleneck (measured)

The whole reason this concept exists. All numbers are from the `ls-noon` benchmark scene (a fixed camera flight
over downtown Los Santos), captured with the in-engine `PerfMonitor` (which reads `renderer.info` + a GPU timer).

## The numbers

```
avgMs (frame)     : 71–74 ms   → ~13–14 fps
cpuMs.render      : 65–69 ms   ← 92 % of the frame
cpuMs.update      : ~5 ms      (streaming, culling, systems)
cpuMs.plugins     : ~0.1 ms
gpuMs.frame       : ~31 ms     ← GPU idle for ~half the frame
draw calls        : ~14.8 k
triangles         : ~3.2 M
```

Read that again: the frame is **71 ms**, of which **the CPU spends 65 ms inside `renderer.render()`** submitting
draw calls, while the **GPU finishes in 31 ms and then waits**. We are **hard CPU-bound on draw submission.**

`65 ms / 14 800 draws ≈ 4.4 µs per draw` — a textbook three.js/WebGL per-draw cost (render-list build + sort,
uniform uploads, state changes, `gl.drawElements`). For comparison, a native D3D9 draw (real GTA:SA) is
~0.5–1 µs — the same scene natively would cost ~10–15 ms of CPU, not 65 ms.

**Conclusion: the draw-call wall is a property of the browser rendering stack, not of the art.**

## Why asset-side fixes cannot move it (the whole parked experiment)

Every lever we measured during the 2026-07 tooling experiment, and why each failed to move the 65 ms:

| Lever we tried            | Measured result         | Why it doesn't help                                                                                                |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cross-model texture merge | −23 % draws (ceiling)   | Fights instancing (triangles↑), engine work, and 23 % of 65 ms is still 50 ms → still CPU-bound.                   |
| Per-model texture atlas   | **−7 %** draws          | Tiling: SA walls/roads sample UVs outside `[0,1]`, can't be atlased in place.                                      |
| Baked static shadows      | **−4 %** draws          | Shadows aren't the draw source; CSM statics are already cached/staggered.                                          |
| Narrow the HD ring        | **worse** (+14 % draws) | Merged LOD cells lose per-object frustum culling + carry ~155 texture-groups each.                                 |
| Proxy-bake cells to atlas | not built               | Kilometre-long tiled roads/terrain smear or need a huge atlas — degenerates on exactly the surfaces that dominate. |

The pattern: **draws come from distinct materials/textures across many objects, and SA's tiled art resists every
in-place merge.** You can shave 5–25 %, never the 3–4× we'd need. And even a perfect draw-count fix runs into the
same per-draw CPU cost — the API overhead is the constant.

## What actually is the frame, spatially

Headless analysis (engine `resolveMap` + `buildWorldGrid`, single-anchor omni around the `ls-noon` spawn):

- **Near HD ring** (< 300 u): tiny — ~0.17 M tris, ~1 k draws.
- **Far LOD ring** (300–1000 u): the bulk — merged LOD cells render correctly (the swap works), but at **~155
  draws/cell** because each cell keeps one material group per distinct texture. 42 visible cells → ~6.5 k draws.
- The rest of the browser's 14.8 k (vs the ~9.6 k this single-anchor model predicts) is **procobj vegetation**
  (not in the map grid — and per the project owner, non-negotiable / must stay) + the flight covering more ground
  than one anchor.

So the draws are real, distributed, and tied to material count. There is no single hot cell to fix.

## The only lever left

If you can't reduce the _number_ of draws (art resists) and you can't make each draw _cheaper_ in JS/WebGL
(that's the API), then you change the **API**: WebGPU submits recorded draw bundles with a fraction of the CPU
cost, and its **render bundles** let a static scene record its draw commands **once** and replay them each frame
at near-zero CPU. That is what [03-webgpu-mechanism.md](03-webgpu-mechanism.md) covers.
