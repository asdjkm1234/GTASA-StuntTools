# Postmortem: modern-cell tooling experiment (DEFERRED)

**Status: 🅿️ DEFERRED — goal not achieved (2026-07-11).** No measurable perf or quality gain. Not deleted —
preserved for a possible later return.

## Where the code lives

- **Git branch: `backup/tooling-experiment`** (commit `c8ff6e6`, parent `071895d "feat: v2 final"`).
- Recover with: `git checkout backup/tooling-experiment` (holds all 7 tooling commits `7c64d78..071895d`
  **plus** the final session's uncommitted work — batching/atlas reports, CPU-breakdown probes, view/lod-check tools).
- `new-rendering` was reset to the pre-tooling commit `b84636f`. **Do not delete the backup branch.**

## What it was

The `docs/plans/066-pmb-modern-tool` chain + `tools/opensa-lod-generator` plans **005–010**: a custom native
`.cell` format (meshopt-compressed, own binary), baked per-vertex channels (sun-shadow, sky-vis/AO, emissive),
and static batching / per-model texture atlasing — aiming to cut draw calls and improve far-LOD looks.

## Why it was deferred — the measurements

Benchmark = `ls-noon` (fixed camera flight over downtown LS), via in-engine `PerfMonitor`.

**Baseline (the wall):**

```
frame 71–74 ms → ~13–14 fps
cpuMs.render 65–69 ms  ← 92 % of frame (draw submission)
cpuMs.update  ~5 ms    cpuMs.plugins ~0.1 ms
gpuMs 31 ms            ← GPU idle ~half the frame
draws ~14.8 k          triangles ~3.2 M
```

→ **Hard CPU-bound on draw-call submission** (~4.4 µs/draw — a three.js/WebGL constant; native D3D9 is ~0.5 µs).

**Every asset-side lever, measured:**

| Lever                             | Result                                        | Note                                                       |
| --------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Cross-model texture merge         | −23 % draws (ceiling)                         | fights instancing; still CPU-bound                         |
| Per-model atlas (tiling honored)  | **−7 %**                                      | tiling kills it (SA walls/roads sample UV outside [0,1])   |
| Per-model atlas (ignoring tiling) | −78 % _(mirage)_                              | not achievable — tiling                                    |
| Baked static shadows              | **−4 %** draws                                | CSM statics already cached/staggered — not the draw source |
| Narrow HD ring (300→150)          | **worse**: 16.9 k draws, 3.6 M tris, 12.5 fps | merged cells lose per-object frustum culling               |
| Proxy-bake cells → atlas          | not built                                     | roads/terrain (km-long tiled) smear or need huge atlas     |

**Engine ground-truth (headless `resolveMap` + real geometry, single-anchor omni at `ls-noon`):**

- near HD ring (<300 u): 0.17 M tris / 1.1 k draws
- far LOD ring (300–1000 u): merged cells **render correctly (LOD swap works)** — 1.74 M tris / **6.5 k draws
  (~155 draws/cell** — one material group per distinct texture; the tiling wall again)
- stock per-instance LODs were **not stripped** in the test build → +2 k draws rendered on top of merged cells
- the browser's 14.8 k vs this ~9.6 k = procobj vegetation (not in the map grid; must stay) + flight coverage

**Real SA (RE of `gta_sa.exe`, RenderWare 3.6 D3D9):** the exe's own `nodeD3D9AtomicAllInOne` / `WorldSector` /
`bamesh` markers confirm SA also draws **one `DrawIndexedPrimitive` per material** → `draws = Σ material-groups`,
same as OpenSA. So an atlas would hit the **same ~7 %** ceiling there (tiling is an art property, not engine), and
a texture-array "mega-texture" needs `sampler2DArray` = D3D10+ → **not available in D3D9**. Real SA also isn't
draw-bound like us (native draws ~10× cheaper) — the wall is our browser stack.

## The lesson

The draw-call wall is a property of the **browser rendering stack**, not the art. No asset-side transform moves it
more than single-digit %. One process mistake worth remembering: an early "LOD swap is broken → 2× free" claim was
**wrong** — a `.model` vs `.modelName` field bug in a headless probe. The engine's LOD swap works. Always verify
the tool before the conclusion.

## ⚠️ OPEN TASK — restore LOD stripping (live bug, independent of the parked tooling)

During the investigation we confirmed a **real, current** defect in the LOD path: **stock SA per-instance LODs
and our improved merged cells load at the same time** in OpenSA. The far ring renders BOTH — the stock `LOD*`
per-object models (measured ~+2 k draws) _on top of_ the merged `lod_<cx>_<cy>` cells that were meant to replace
them. Pure waste (double geometry) and it muddies every LOD measurement.

Cause: the **strip-lods step was rolled back** with the tooling commits, so the shipped builds no longer remove
the stock `lod*` layer (and/or the engine no longer dedups it). To fix, restore ONE of:

- **generator side:** re-run/keep `opensa-lod-generator --strip-lods` (`stripOldLods`) so the drop-in build removes
  the stock `lod*` instances the merged cells replace; **or**
- **engine side:** when a cell has an opensa merged `lod_*` in its LOD bucket, drop the stock `LOD*` instances for
  that cell (dedup at `buildWorldGrid` / streaming time).

This is separate from the WebGPU work and should be picked up whenever the LOD/build path is next touched.

## What survives as useful

- The **diagnosis** → [073 WebGPU migration](../plans/073-webgpu-migration-threejs/readme.md) (the root-cause fix: WebGPU render bundles).
- The **baked channel idea** (AO/emissive per vertex) may feed the WebGPU material path — e.g. a baked-AO channel
  in the format could replace the screen-space SSAO pass (see `docs/plans/073-webgpu-migration-threejs/03-*`). If we return here, that's why.
