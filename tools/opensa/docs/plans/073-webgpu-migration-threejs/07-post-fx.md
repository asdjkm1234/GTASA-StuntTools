# 073/07 — Post-FX under WebGPU

**Priority: P2.** The `postprocessing` lib is WebGL-only. Rebuild the chain on three's WebGPU `PostProcessing`
(TSL passes), applying the standing [bake-vs-pass decision](concept/06-bake-vs-pass.md):
SSAO → prefer BAKED AO (revives a slice of the parked 066 tooling), SMAA → likely MSAA, keep bloom/god-rays/tonemap
as passes.

## Tasks

- [~] Tone mapping (ACES/AGX/Neutral parity with current curves) via TSL output node.
- [~] Bloom (TSL bloom node) — match threshold/intensity; verify night emissive feeds it (plan 04 glow).
- [~] MSAA decision: enable MSAA on WebGPURenderer, compare vs SMAA need.
- [~] God-rays: custom TSL radial pass from the sun position (smallest acceptable version first).
- [~] AO: decide baked-vs-screen-space; if baked — scope the `skyVis` channel revival (066 tooling) as its own task.
- [~] Wire into `BasicRenderPipeline` as the webgpu pass (plugin gating rework: postfx plugin webgpu variant).

## Done

`?webgpu=1` visual chain: tonemapped, bloomed, AA'd; god-rays present; perf accounted (gpuMs per pass).
