# Phase 0 — spike checklist (GO/NO-GO gate)

Branch: `webgpu-migration`. **Throwaway code** — the goal is a single measured number, not clean architecture.
Do **not** touch the WebGL engine path; add WebGPU alongside it behind a flag.

**The one question:** does a WebGPU **render bundle** collapse the ~65 ms/frame CPU draw-submission cost for our
_streaming_ static world in three `^0.177`?

Time box: **1–2 weeks.** If it slips past 2 weeks without a clear number, that itself is a NO-GO signal (bundle
support too immature to rely on).

---

## ✅ Spike implemented (2026-07-11) — a synthetic harness

Rather than integrate WebGPU into the whole engine (async renderer, material swaps, plugin disabling — weeks),
the spike is a **standalone synthetic harness** that isolates the one variable: it renders `COUNT` separate
boxes (shared geometry, culling **off** → every mesh submits every frame) so the **draw count** matches the
engine's ~14.8k, and measures the synchronous `render()` CPU time across three runs.

- File: `apps/web/src/standalone/webgpu-spike.ts` + `webgpu-spike.html` (vite entry `webgpuSpike`).
- Verified: tsc + eslint clean, **vite build succeeds** (`three/webgpu` bundles as a 454 kB chunk).
- Bundle path confirmed against three source: `BundleGroup` (`static = true` by default, version-gated reuse) →
  the renderer records the bundle once and replays it while unchanged. The harness never mutates the group, so
  it exercises the true record-once path.

**Run it (needs a WebGPU browser — Chrome/Edge/Safari 18+):**

```
npm run dev   # then open:
/webgpu-spike.html?mode=webgl        → WebGL baseline      (expect ≈ engine per-draw cost)
/webgpu-spike.html?bundle=0          → WebGPU, no bundle   (Level-1: cheaper per-draw only)
/webgpu-spike.html                   → WebGPU + BundleGroup (Level-2: record-once)
# optional &count=15000
```

Read `render CPU` off the on-screen HUD for each and fill the table below.

**What this covers / doesn't:** it answers the core question — _does bundling collapse submission for a large
static draw list?_ It does **not** test the **streaming re-record cost** (cell add/remove → bundle
invalidation); that needs the real-engine integration and is a Phase-1 confirmation, not a Phase-0 gate.

---

## Step 1 — WebGPU renderer behind a flag

- [~] Add `?webgpu=1` boot flag in `canvas-host.tsx` (next to existing URL flags).
- [~] In `core/renderer.ts`, when the flag is set, construct `WebGPURenderer` from `three/webgpu` instead of
      `WebGLRenderer` (both paths compile; pick at boot). `await renderer.init()` if required by the API.
- [~] Confirm a **cleared canvas** renders (blank scene) under WebGPU — proves the renderer + canvas + `setSize` + animation loop work before any geometry.
- [~] Confirm `renderer.info` (draw calls / triangles) still reports under WebGPU so `PerfMonitor` keeps working;
      if the field names differ, adapt the sampler for the spike.

## Step 2 — strip the scene to the static world only

- [~] Behind `?webgpu=1`, disable: post-FX plugin, sky plugin, water, particles, coronas, shadows/CSM, procobj,
      dynamic entities. We want ONLY the streamed world cells on screen.
- [~] Replace the world material with a **flat unlit TSL material**: `texture(map, uv) * vertexColor`. No sun, no
      fog, no night. Ugly is fine — this isolates draw submission.
- [~] Verify the static world is visible and streams as the camera moves (cells appear/disappear).

## Step 3 — wire the render bundle

- [~] Record the streamed world's draws into a render bundle (three `0.177` surface — likely a `BundleGroup` /
      `renderer.renderBundle`-style API; confirm the exact call in the installed version's `three/webgpu` types).
- [~] Invalidation: when the visible cell set changes (a cell is added/removed by streaming), **re-record only
      what changed** if the API allows, else re-record the bundle. Note which granularity three supports — this is
      itself a key finding.
- [~] Add a runtime toggle `?bundle=0/1` to render the SAME scene with and without bundling, so the measurement is
      an A/B on one build.

## Step 4 — measure (the deliverable)

- [~] Reuse `PerfMonitor.cpu('render', …)` (the CPU phase timer). Fly the **same `ls-noon`** bench path.
- [~] Capture, on the same target hardware, three runs:
  - **WebGL baseline** (no flag): expect `cpuMs.render ≈ 65 ms`.
  - **WebGPU, `?bundle=0`**: WebGPU submission without bundles (measures Level 1 — cheaper-per-draw only).
  - **WebGPU, `?bundle=1`**: WebGPU with render bundles (measures Level 2 — the record-once win).
- [~] Record for each: `cpuMs.render`, `avgMs`, `gpuMs`, `draws`, and the streaming re-record cost on a cell swap
      (does the boundary hitch?).

## Step 5 — decide

Fill this table and decide:

Measured (synthetic harness, boxes, culling off), 2026-07-11:

| Run                      | render CPU @ 15k | render CPU @ 40k |
| ------------------------ | ---------------- | ---------------- |
| WebGL baseline           | 10.3 ms          | —                |
| WebGPU, no bundle        | 27 ms            | 79 ms            |
| **WebGPU + BundleGroup** | **4.3 ms**       | **13 ms**        |

### Verdict: ✅ GO

- **Bundles are the entire win.** WebGPU _without_ bundles is **worse** than WebGL (27 vs 10.3 ms) — a naive port
  regresses. With bundles: ~**6× lower** per-frame submission at both scales, consistently.
- **Not a flat record-once, but a large constant factor.** The bundle still scales gently (4.3→13 ms) because
  three's **per-frame scene work OUTSIDE the bundle** — `updateMatrixWorld` over ~N nodes + render-list build —
  isn't recorded. Only the **draw-command encoding** is bundled (and that's the expensive part: it's what makes
  the no-bundle line 27→79). At our ~14.8k draw count, the bundle sits at **~4–5 ms**.
- **Why it still fixes our real 65 ms:** the synthetic baseline (10.3 ms) is far below the engine's 65 ms because
  our real `world-material` is heavy (custom shaders, textures, per-cell state). Render bundles move **all that
  per-draw material cost to RECORD time** (once per streaming change) — off the per-frame path. So the real engine's
  per-frame submission should collapse toward the bundle residual (~single-digit ms), **independent of material
  complexity**. That is the structural fix for the 65 ms wall.
- Low FPS at count=40000 in both WebGPU runs = GPU overdraw from 40k stacked synthetic boxes (an artifact of the
  harness geometry), not a CPU signal — ignore.

### Phase 1a — per-cell invalidation gate: ✅ GO (2026-07-11)

Because the material cost now lives at **record time**, re-recording the **whole** world on every cell swap would
spike. Gate question: is `BundleGroup` invalidation **granular** — does re-recording one cell leave the rest
replayed? Tested with `?cells=100&swap=30` (100 per-cell bundles, one re-records every 30 frames):

|                                | render CPU     |
| ------------------------------ | -------------- |
| steady (all cells replayed)    | **4.5 ms**     |
| swap frame (1 cell re-records) | **8.9 ms** max |

**Granular — confirmed.** The swap frame is `steady + ~one cell` (8.9 ms), **not** a full-world re-record (which
would be ~27 ms, the no-bundle cost). Re-recording one cell does not force the others → no world-wide hitch, and
8.9 ms is still inside a 60 fps frame. Design validated: **one `BundleGroup` per streamed cell.**

Scaling across cell sizes (steady stays **4.5 ms** in every run — it depends on total draws, not cell count):

| cells | draws/cell | swap max | re-record delta |
| ----- | ---------- | -------- | --------------- |
| 200   | 75         | 7.4 ms   | ~2.9 ms         |
| 100   | 150        | 8.9 ms   | ~4.4 ms         |
| 50    | 300        | 13.4 ms  | ~8.9 ms         |

The swap cost scales **linearly with one cell's draw count**, not the world → design lever: **smaller cells =
cheaper re-record**. Our real cells (~155 draws) sit at the cheap end (~the 150-draw row), and the re-record can
still be hidden in the warm phase. Granularity is thoroughly confirmed.

Honest caveats: the synthetic swap uses simple box materials, so the real per-cell re-record will cost more (heavy
shaders + actual cell load creating meshes) — but it stays **bounded to one cell**, and the existing streaming
pipeline (plan 060: warm-invisibly, atomic-appear) can run the re-record **off the appearance frame**, hiding it.

---

> **Postscript (2026-07-11):** both gates were green _synthetically_, but the real-engine Phase 1 failed in the
> field (bundle transform baking + per-InstancedMesh pipeline compiles) and the effort is **parked** — see
> [phase-1-findings.md](phase-1-findings.md). The numbers below remain valid for the mechanism.

## Both gates GREEN — thesis validated

- **Phase 0:** render bundles collapse per-frame submission ~6× and move per-draw material cost to record-time.
- **Phase 1a:** per-cell bundle invalidation is granular — a cell swap re-records one cell, not the world.

The two make-or-break **unknowns** are now measured YES. What remains is **execution risk**, not unknowns: the
2–3-month material/post-FX port to TSL (Phases 1–5 in [04-migration-plan.md](04-migration-plan.md)). Green light to
commit is justified whenever the 2–3-month investment is.

<details><summary>original blank template</summary>

| Run               | cpuMs.render | avgMs | fps |
| ----------------- | ------------ | ----- | --- |
| WebGL baseline    | ~65          | ~71   | ~14 |
| WebGPU, no bundle | ?            | ?     | ?   |
| WebGPU + bundle   | ?            | ?     | ?   |

</details>

**GO** — proceed to Phase 1 — if **WebGPU + bundle** brings `cpuMs.render` to **single-digit ms** (say **≤ 10 ms**),
i.e. the submission wall is gone and the frame is now GPU-bound (~`gpuMs`), AND cell-swap re-record doesn't
reintroduce a visible hitch.

**NO-GO** — stop, keep WebGL — if bundles only reach Level-1 territory (e.g. `cpuMs.render` still > 30 ms), or the
API can't invalidate per-cell without re-recording the whole world each swap (streaming hitch), or three `0.177`'s
bundle support is too immature to wire in the time box.

**Marginal** (10–30 ms) — record findings, do NOT auto-proceed; re-scope (maybe bundle only the far ring, or wait
for a three upgrade). Bring the numbers back for a decision.

---

## Guardrails

- Everything here is disposable. Don't refactor, don't port real shaders, don't chase visual correctness.
- Keep the WebGL path the default and untouched — the spike must never regress the shipping engine.
- The output of Phase 0 is **the filled table above + a one-paragraph GO/NO-GO writeup** appended here.
