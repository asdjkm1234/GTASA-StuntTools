# 04 — Migration plan (phased, step-by-step)

> **🅿️ PARKED (2026-07-11).** Phases 0/1a passed synthetically; Phase 1 (real engine) failed in the field on
> upstream three limitations (bundle transform baking, per-InstancedMesh pipeline compiles). See
> [phase-1-findings.md](phase-1-findings.md) for the final verdict + resume conditions. The plan below remains the
> blueprint for when three matures.

Ground rule: **the spike gates everything.** Do not port a single production shader until Phase 0 proves render
bundles collapse the submission cost on real hardware. All work happens on a `webgpu` branch off `new-rendering`.

---

## Phase 0 — the spike (1–2 weeks) — GO/NO-GO GATE

**Goal:** answer the only question that matters — _do render bundles remove the CPU submission wall in three
`0.177`, for a streaming static world?_ — with the least possible code.

Steps:

1. Branch `webgpu-spike`. Add `three/webgpu` `WebGPURenderer` behind a `?webgpu=1` flag next to the existing
   `WebGLRenderer` (both constructible; pick at boot).
2. Render **only the static world** — no post-FX, no sky, one **flat unlit TSL material** (texture × vertex colour)
   for every cell. Disable everything else (particles, water, coronas, shadows).
3. Wire the streamed cells into a **render bundle** (or three's static-scene equivalent): record on cell-set
   change, replay each frame.
4. Reuse the existing `PerfMonitor.cpu('render', …)` timing. Fly the **same `ls-noon`** path. Measure
   `cpuMs.render` with bundles ON vs OFF.

**Decision:**

- `cpuMs.render` drops from ~65 ms to **single-digit ms** → **GO.** The thesis holds; proceed to Phase 1.
- Bundles don't invalidate granularly, or submission stays >30 ms → **NO-GO.** Stop here. Cost: ~2 weeks, and we
  keep the WebGL engine untouched. This is the cheap insurance that makes the whole concept safe to explore.

Also capture in the spike: WebGPU availability/fallback behaviour on target browsers, and whether instanced +
per-cell-material-group geometry bundles cleanly.

---

## Phase 1 — the world material in TSL (2–4 weeks)

Only after GO. Port the visual identity first, because it's the biggest risk.

1. Re-author `world-material.ts` as a TSL node material: base texture × vertex colour → direct sun term → CSM
   shadow sampling → night colour blend → window/beam glow → emissive → unified fog → day/night balance.
2. Keep the **uniform surface** identical (`uSun*`, `uCsm*`, `uFog*`, `uDnBalance`, …) so the plugins that drive
   them (sky, csm) don't change.
3. Verify **pixel-faithfulness** with the existing map-viewer compare workflow across a day/night sweep (dawn,
   noon, dusk, night) before moving on. This material is the engine's look — do not approximate it.
4. Re-wire CSM **sampling** into the TSL material; the CSM plugin's fit/cache/stagger logic ports unchanged.

Exit: the static world renders correctly, day and night, under WebGPU with bundles, at the Phase-0 frame cost.

---

## Phase 2 — sky, shadows, fog integration (1–2 weeks)

1. Port `sky.plugin.ts` (PBR sky + LUT + sun disc) to TSL.
2. Confirm the sun's near shadow map + the CSM cascades render and sample correctly under WebGPU.
3. Validate fog continuity between world and sky (the unified-fog seam is easy to break).

---

## Phase 3 — post-FX rebuild (2–4 weeks) — second-biggest risk

The `postprocessing` library is WebGL-only; rebuild the chain on three's WebGPU node post-processing.

1. **Tone mapping + bloom** — TSL nodes exist; port first, match the current curve (ACES/AGX/Neutral) + bloom
   threshold/intensity.
2. **SSAO** — prefer to **drop the screen-space pass entirely** in favour of a **baked AO channel** in the model
   (the parked tooling's `skyVis`), read in the TSL material. Fall back to a TSL SSAO pass only where baked AO
   isn't available (dynamic objects). Cheaper at runtime and removes a pass.
3. **God-rays** — same: custom TSL pass from the sun mesh. Budget risk here.
4. **SMAA / anti-aliasing** — evaluate WebGPU MSAA vs a TSL SMAA port; MSAA may make SMAA unnecessary.

Exit: post-FX visually matches the WebGL build (or a deliberate, signed-off delta).

---

## Phase 4 — the rest (2–3 weeks)

Port, one at a time, verifying each: `water.plugin.ts`, `build-particles.ts`, `corona.ts`, `uv-anim.ts`,
`night-fill.ts`, `wind.mod.ts`, vehicle-reflection. Re-check the debug overrides (normals/wireframe).

---

## Phase 5 — hardening & decision to ship (1–2 weeks)

1. Full `?bench=all` sweep vs the WebGL baseline: frame time, draw ms, GPU ms, memory — every scene.
2. Cross-browser pass (Chrome/Firefox/Safari 18+) + mid-range GPU.
3. Decide: **WebGPU-only** (drop WebGL, simplest) or **keep WebGL fallback** (double the surface, safer reach).
4. Streaming stress: confirm bundle re-record on cell swaps stays smooth (no hitch at the boundary — tie into the
   plan-060 streaming-smoothness invariants).

---

## Rough total

**Phase 0: 1–2 weeks (gate).** If GO, **Phases 1–5: ~8–15 weeks.** Call it **2–3 months** for a faithful,
shippable WebGPU renderer. The spike de-risks the entire bet for the price of two weeks.
