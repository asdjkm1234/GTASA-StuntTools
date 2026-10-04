# 001 — Guard: world models arriving without normals

**Status: SHIPPED 2026-07-15.** Companion to the map-optimizer normals batch (its plans 020–023).

## Measured (rect 9,-7 — one Ganton cell, 2026-07-15)

| input                                       | authored | computed       | guard           |
| ------------------------------------------- | -------- | -------------- | --------------- |
| `game-src/original` (vanilla)           | 21       | **170 (89 %)** | ⚠ warning fires |
| `NO_COMMIT/optimized` (map-optimizer build) | 176      | 15 (7.9 %)     | silent          |

The conditioned map's residual 15 = models outside the optimizer's selection (its `resolve()` set is
narrower than the converter's `resolveMap` + script IPL) — under the 10 % threshold by design.

## Problem

The 074 engine lights the world with a per-vertex N·L sun term, so pak quality now **depends** on the input
map having sane normals. 12 004 of 12 964 vanilla world models ship none; for those the converter's clump
preparation falls back to `packages/renderware/mesh/prepare-clump.ts#computeVertexNormals` — a naive
index-based average with no position weld and no crease model — which produced the 2026-07-15 field bugs
(polygon-shaped light/dark patches, fixed by feeding a map-optimizer build instead). Nothing today tells the
operator they converted an unconditioned map; the failure is silent and looks like an engine lighting bug —
it cost a full plan-17 investigation round.

## Design

Cheap detection at weld time, no behaviour change:

- Count, per convert run: world models (and instances) whose source geometry had **no normals block**
  (i.e. took the `computeVertexNormals` fallback) — the flag must come from the parse, not from the computed
  array. Thread it through `prepareClumpAtomics` (or read `rw.normals == null` before preparation).
- Report line in the convert summary + `report.json`, e.g. `normals — 11 462 authored, 1 502 computed
(13 %)`.
- **Warning threshold**: computed fraction above ~10 % of world models prints a loud one-liner:
  `⚠ N models have no authored normals — run the map through map-optimizer first (its plans 020–023)`.
  A conditioned map has ~0 % (map-optimizer's addNormals creates them everywhere), vanilla has ~93 % — any
  threshold in between works; pick one and record the measured numbers for both map kinds here.

## Non-goals

- No hard failure — converting a vanilla map stays legal (quick experiments, non-lighting work).
- No in-converter normal synthesis: conditioning belongs to map-optimizer (single owner of the smooth-group
  core in tool-kit). If a runtime-quality fallback is ever wanted here, wire the tool-kit
  `rebuildSmoothNormals` in — do not grow a second implementation.
- Gamma/linear mip re-filtering for pass-through DXT was considered and explicitly deferred (user decision
  2026-07-15) — not part of this plan.

## Tasks

- [x] Normals provenance at parse level (`geometry.normals == null` on the cached clump — no prepare-clump
      threading needed; implemented as `convert.ts#countNormalsProvenance` over the rect's unique placed
      models, clump parses shared with the weld via the asset cache).
- [x] Counters + summary line (`normals authored=N computed=M`) + `report.json` field (`report.normals`).
- [x] Threshold warning (>10 % computed) with the map-optimizer pointer (`cli.ts#printReport`).
- [x] Measured vanilla vs optimized (table above).
