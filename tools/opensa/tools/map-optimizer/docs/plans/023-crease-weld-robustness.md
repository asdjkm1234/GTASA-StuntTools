# 023 — Crease & weld robustness knobs

**Status: SHIPPED 2026-07-15 — B (neighbour-cell weld) built + tested; A built as a per-MODEL override (`--crease` + curated `data/crease-overrides.json`, first entry sphinx01_lvs=80). Per-MATERIAL granularity stays open if a mixed model ever demands it.**
Covers the remaining half of option 2 of the 0.4.0 normals-smoothing idea (graduated here, idea doc deleted).

## A. Per-material crease-angle override

The 45° crease is global. Authoring reality differs by surface kind: rounded kerbs / pipes / arches want a
higher threshold (stay smooth through sharper dihedrals), hard-edged buildings arguably lower. The plugin
already receives `SmoothNormalsOptions` — extend to `creaseAngleFor(materialTexture) → degrees` resolved per
smooth-group seed face, with the flat default unchanged.

Selection mechanism when needed: a small name-list table (texture-name → angle), the same curation loop the
stochastic list uses (run → eyeball → promote). **Do not build the table speculatively** — only add entries
the phase-0 fixtures (020) or field reports demand. No entries demanded → close A as not-needed.

**A SHIPPED per-MODEL (2026-07-15) — first demanded entry arrived the same day:** the field round found
`sphinx01_lvs` "looks angular" (low-poly organic statue: facet dihedrals exceed 45°, so shading bands appear
under per-vertex N·L; vanilla never shows this — it renders the statue prelit-only). Built as a per-model
override (simpler than per-material, sufficient for statues): plugin option `creaseFor(modelName)`,
`RunOptimizerOptions.creaseOverrides`, CLI `--crease <file.json>` defaulting to the curated
`data/crease-overrides.json` (`{"sphinx01_lvs": 80}`). Per-MATERIAL granularity stays open if a mixed model
ever demands it.

Note: a _group_ spans faces of several materials; the override applies at edge-crossing time (the edge's two
faces' thresholds — use the max), not per group.

## B. Weld across quantization-grid boundaries

`weld()` canonicalizes by `round(pos / epsilon)` — two vertices `epsilon`-close but straddling a grid cell
boundary get different canon ids, so their adjacency is lost and a phantom hard edge appears mid-surface.
Standard fix: probe the 27-neighborhood (or re-canonicalize with a half-cell offset second pass) when the
exact-cell lookup misses.

Reality check first: SA seam vertices are usually byte-identical (epsilon = 1 mm is generous), so measure
before fixing — add a counter for "near-miss pairs" (distance < epsilon, different cells) to the phase-0
fixture dump. Zero hits map-wide → close B as not-needed (record the number here).

**Measured (vanilla map, 2026-07-15 probe): 5 327 near-miss vertices in 478 models** (worst:
`ferris01tr_law2` 186, `cj_sweetie_tray_1` 96, Vegas fences/crash barriers, LA piers, `sfn_coast04`) —
each one a phantom hard edge mid-surface. Non-zero → B is DEMANDED; implemented same day (neighbour-cell
union in the tool-kit `weld()`). A (per-material crease) stays field-gated.

## Tasks

- [x] Phase-0 counters: near-miss weld pairs map-wide (numbers above); crease-override fixture list stays
      open for field reports.
- [ ] (if demanded) `creaseAngleFor` override + name-list table + tests.
- [x] Neighborhood-aware weld + tests (union of ε-close vertices across grid-cell boundaries in
      `tool-kit/mesh/smooth-normals.ts#weld`).
- [x] Re-run the opensa-lod-generator harness (shared tool-kit core — the two ship in tandem).
