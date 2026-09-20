# 03 — How WebGPU removes the wall

The bottleneck is **CPU time spent submitting draws** (65 ms for ~14.8 k draws). WebGPU attacks this on two levels.

## Level 1 — cheaper per-draw (the API itself)

WebGPU is a modern, low-overhead API (like Vulkan/Metal/D3D12), designed around **pre-validated pipeline state
objects** and **explicit bind groups**. WebGL revalidates a lot of state per call in the driver; WebGPU front-loads
that into pipeline creation, so the per-draw submission is intrinsically cheaper. On its own this is a modest,
not transformative, win — maybe the per-draw cost drops from ~4.4 µs toward ~2 µs. Helpful, not the headline.

## Level 2 — record once, replay for free (render bundles) ← the headline

A **`GPURenderBundle`** is a pre-recorded, immutable sequence of draw commands (set-pipeline, set-bind-group,
set-vertex-buffer, draw). You record it **once**, then each frame you call **one** `executeBundles([...])` and the
GPU/driver replays the whole recorded command stream — **the CPU does almost no per-draw work**.

This is a near-perfect fit for OpenSA, because **the streamed world is static between streaming events**:

- The set of visible cells changes only when the player crosses a cell boundary (a few times per second at most).
- Between those events, the same ~14.8 k draws are re-issued **every frame, unchanged**.
- Today three.js rebuilds and re-submits that entire render list 60× per second on the CPU → the 65 ms.
- With render bundles, we record the static world's draws once per streaming change and **replay at ~0 CPU**.

If the static world's submission drops from ~60 ms to a few ms, the frame goes from ~71 ms → GPU-bound at ~31 ms
(≈32 fps) — and now cutting triangles / post-FX cost pushes it higher. **That is the 2–4× we're after.**

### three.js support (must verify in the spike)

three's `WebGPURenderer` exposes render bundles (historically via a `BundleGroup` / `renderer.renderBundle`-style
API; the exact surface in `0.177` must be confirmed in Phase 0). The open questions the spike must answer:

- Does three **auto-bundle** a static subtree, or must we explicitly declare "this group is static, bundle it"?
- How does invalidation work when a cell is added/removed (re-record just that bundle, or the whole scene)?
- Do instanced meshes + our per-cell material groups bundle cleanly?

If three's render-bundle support is immature or doesn't invalidate granularly, **Level 2 evaporates** and we'd be
left with only Level 1 (modest) — which would **not** justify the rewrite. This is the single most important thing
to de-risk before committing. Hence the spike.

## TSL — the shader language we'd write in

- **TSL** (Three Shading Language) is three's node-based material language. You compose materials from JS nodes
  (`positionWorld`, `texture()`, `mix()`, `uniform()`, custom functions via `Fn`), and three compiles the graph to
  **WGSL** for WebGPU (and can fall back to GLSL for WebGL).
- **Advantage:** one material definition, both backends — so we _could_ keep a WebGL fallback during migration.
- **Cost:** our shaders are currently hand-written GLSL strings patched into three's built-in material via
  `onBeforeCompile`. That mechanism **doesn't exist** in the node world. Each shader is re-expressed as a node
  graph and re-verified. The logic ports 1:1 conceptually; the effort is in the re-authoring + pixel matching.

## Browser & hardware reality (2026)

- WebGPU ships in Chrome/Edge (desktop + Android), Firefox, and Safari 18+ — broadly available on the platforms
  OpenSA targets. A WebGL2 fallback path (TSL can emit GLSL) is possible but doubles the test surface; the spike
  should decide whether we go **WebGPU-only** or **dual-backend**.
- WebGPU's own driver maturity varies; the perf win must be measured on real target hardware, not assumed.

## The mechanism in one line

> The world is static between streaming events, so record its draws once as a render bundle and replay them at
> ~0 CPU — moving the 65 ms of per-frame submission off the critical path, without changing a single texture.
