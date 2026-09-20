# Audit — plan 094: sa-map-viewer (2026-07-29 → 07-30, eight phases, two days)

The blue-strip hunt lost a whole day to its instruments: every A/B cost a repack, and the lab's orbit
camera drifted between runs, so a careful single-variable bisection compared different pixels and the
verdicts were thrown away. Plan 094 built the instrument the hunt actually needed — a viewer that reads a
FOLDER of original SA files and holds still. This is the close-out.

## What was built

- **A source folder → a rendered map, with no build in the loop.** `game-src/original` (or any SA-format
  tree) resolves through the game's own `InstallSource`, and only the world files are ingested up front —
  gta.dat + IDE + IPL, ~50 849 instances in ~0.9 s. Models and textures are pulled per cell.
- **The weld moved into the browser.** `packages/cell-weld` was extracted verbatim out of `opensa-pack`
  (a `type:tool` an app may not import) so the viewer runs the SAME welder the converter runs offline:
  what it draws is what the game would draw for those files. Reused by both, tested where it lives.
- **The debugger's own panel, imported not copied.** `MapInspector` + `debug-styles` come from `apps/web`;
  the viewer implements the `MapGame` interface and gets the cell grid, the whole-map toggle, LOD mode,
  click-to-pick and the selection block without writing UI.
- **A camera that never moves on its own.** `?at`/`?h`/`?pitch`/`?yaw` fully specify a pose; pan/orbit/dolly
  are `fly-rig`'s own steps. Same URL → same pixels.
- **Find a model by name** (phases 4–5): `ModelIndex` over the PLACED instances, a shared `ModelSearch`
  component, and two optional `MapGame` members — so the in-game debugger got the same field by
  implementing them over `GtaSaWorldAdapter`, not by copying a line.
- **The sea** (phase 7, user request): `flatWaterMesh` shared with the game host, gated by
  `Engine.waterEnabled` so an inspector can look under it.

## What it cost, and what it bought

| | |
| --- | --- |
| New app | `apps/sa-map-viewer` — 11 source files, ~1 100 lines, no new dependency |
| New shared code | `packages/cell-weld` (a MOVE, not a rewrite) · `renderware/map/model-search.ts` · `renderware/map/water-mesh.ts` (the game's own inline fallback, lifted) |
| Engine surface added | one field: `waterEnabled` |
| Tests | 51 in the app (30 pure + 21 against the recording fake `GPUDevice`), +13 `ModelIndex`, +6 `flatWaterMesh`, +4 `lookAtStep`, +3 water gate, +2 adapter — the repo stands at **3 216** (3 167 at the phase-3 close) |
| Whole map, welded IN THE BROWSER | **15.3 s** HD (562 cells, 8 264 544 tris, 57–62 fps) · **3.0 s** LOD · median cell 10 ms, worst 149 ms |
| One cell (the A/B loop) | **~60 ms** to weld, ~3 MB read — against a repack per A/B before |
| Search | **8–34 ms** keystroke→rows over 14 098 names, a plain scan (no index structure needed) |
| Sea | 616 triangles, no measurable frame cost |

The number that justifies the plan is the last-but-two: the loop it replaced was a **repack**, and the
loop it ships is **60 ms** — with the two sources side by side in one browser, and pixel-identical reruns.

## What it found the day it was first used

- **`?panel=0` rendered an EMPTY world.** Since phase 2 the panel's inspector OWNS the cell set, so every
  scripted capture — the tool's whole purpose — drew nothing. Phase 6's first A/B is what surfaced it;
  capture mode now seeds its own cells (`?cells=1|all`, `?lod=1`).
- **The blue strip is `roads32_law2` not drawing.** Hiding that one placement in the VANILLA tree
  reproduces the merged picture exactly; hiding it in the merged tree changes 0.013/255. Instance, IDE row,
  DFF geometry, weld bucket, `.oscell` group and resolved textures are all equivalent between the trees —
  the plan doc carries the table. Two side findings from the same probes: a mod sank `sm_bushvbig` to
  **z = −300** (which blows the cell's bounds out to −115.5…290.9), and 11 props were removed from the cell.

## The rules it taught, and where they live now

- A texture array that **grows** kills every render bundle recorded against it → re-create the resident
  cells from cached bytes, never re-weld (`restrictions/gpu-and-shaders.md`; nothing catches a violation).
- The **fog cut is a cull**: from a 4 km eye every cell is past it and the canvas comes back empty while
  the readout still says 562 cells (`edge-cases/engine-rendering.md`).
- **Wind is the noise floor, and the sea is the second one** — both must be off for a pixel A/B; the
  capture script now enforces both (`edge-cases/engine-rendering.md`).
- `performance.memory` is **useless** here (flat 386 MB before, during and after a whole-map load) — the
  residency numbers are the memory record.

## Where the numbers live

Per-phase measurements, decisions and deviations: [`plans/094-sa-map-viewer/readme.md`](../plans/094-sa-map-viewer/readme.md).
Launch + params: [`commands.md`](../commands.md), [`development/query-parameters.md`](../development/query-parameters.md).
How to drive it: [`debug/README.md`](../debug/README.md) (`map-viewer-shot.ts`).
