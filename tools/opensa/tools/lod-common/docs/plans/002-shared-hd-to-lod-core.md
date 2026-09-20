# 002 — Shared HD→LOD core (lod-common)

**Status: ✅ Implemented (Phases 0–3); Phase 4 docs/tests done.** Make `lod-common` the single home for "turn a real HD object into a LOD", so both
`sa-lod-generator` and `opensa-lod-generator` produce LODs by the **same rules** and future simplification is added
in **one place** and lands in both.

## Motivation

- `opensa-lod-generator` builds cell LODs by **QEM-decimating** a merged cell mesh — this **degrades/breaks** the
  models (holes, spikes).
- `sa-lod-generator` builds per-object LODs by cloning the HD **verbatim** (raw DFF bytes + a ½-res TXD) — clean.
- The two share no geometry path today. We want one core so a fix/feature (e.g. later: real simplification)
  affects SA and OpenSA identically.

## Decisions (confirmed)

1. **Geometry philosophy: verbatim HD** (drop QEM). opensa cell LOD = the cell's real HD geometry merged, no
   simplification; sa stays verbatim per object. LOD win = draw-calls + texture memory + draw distance, not
   polycount (fine for OpenSA — no per-model streaming limits).
2. **Rename** `@opensa/sa-lod` → `@opensa/lod-common` (done, Phase 0).
3. **Core = "dumb copy" now, modifiers later.** The core exposes a modifier chain (empty today); future geometry
   simplification is added there once and both tools inherit it.

## Design

A single core in `lod-common` with **two modes** under one API, plus a shared merged-mesh builder:

```
type LodModifier = (mesh: MergedMesh) => MergedMesh   // extension point — empty today

hdToLod(input, modifiers):
  • single HD object AND no modifiers → verbatim raw-DFF copy (keeps coronas/materials/UV) + safe particle-strip   ← sa today
  • merge (opensa cell) OR any modifiers → build MergedMesh → apply modifiers → encode                              ← opensa always; sa when modifiers exist
```

- **`build-mesh.ts`** — one `MergedMesh` accumulator (clump + transform → mesh with prelit/night/normals),
  unifying opensa's `merge.ts` `MeshBuilder` and lod-procobj's `mesh-builder.ts` `buildModelMesh` (near-duplicates
  today). Transform is parameterised (opensa: conjugate-IPL-quaternion + cell origin; procobj: frame matrix).
- **sa-lod-generator**: routes its per-object clone through `hdToLod([])` → same verbatim raw copy as now (no
  behaviour change; keeps its coronas — see the fast-path).
- **opensa-lod-generator**: `bakeCell` drops `decimateMesh` (+ the `lodCellRatio`/`lodCellMinTris` knobs) and calls
  the core → verbatim merged cell. Cell atlas (`encodeLodTxd`), double-siding and `stripOldLods` unchanged.

"Same result" = same **rules** (prelit, night, particle-strip, winding, texture downscale), not byte-identical —
opensa still merges + cell-atlases.

## Out of scope (documented for later)

**Rich `MergedMesh` → a truly single lossless path (no raw-copy fast-path).** The mesh path currently drops data a
byte copy keeps, so sa needs the verbatim fast-path to avoid regressions. To remove the fast-path and route _both_
tools through one mesh path unconditionally, `MergedMesh` + `encode-dff` would need to also carry:

- **2dfx** (lights/**coronas**/particles/roadsigns) with positions transformed on merge — then the particle-strip
  becomes a plain modifier, AND opensa cells would gain distant **coronas** (night city lights) they lose today;
- **per-group material properties** (colour, flags, matfx env-map/reflection) — the builder buckets by texture name
  only today;
- **multi-UV layers**.

For map LODs materials/multi-UV are usually trivial, but not guaranteed — so this is deferred. Revisit when adding
the first real modifier (measure how many cloned models actually carry non-trivial materials/2dfx/multi-UV first).

## Phases

- **Phase 0 — Rename** `sa-lod` → `lod-common` (imports, package name, symlink, eslint `no-console` override,
  **vitest `include` glob** — it still pointed at `tools/sa-lod/**`, so lod-common's whole test suite was silently
  skipped). ✅
- **Phase 1 — Core**: `build-mesh.ts` (unified `MeshBuilder`, transform-agnostic) + `hd-to-lod.ts`
  (`LodModifier`/`applyModifiers` + two-mode `hdToLod`). opensa `merge.ts` and lod-procobj `mesh-builder.ts` migrated
  to the shared `MeshBuilder` (behaviour-preserving — each supplies its own exact transform). ✅
- **Phase 2 — sa-lod-generator** routes its clone through `hdToLod([])`. ✅ Byte-identical to before (fast-path =
  `stripParticleEffects`); a shared `buildClumpMesh` + `encode` are supplied (lazily) for the future mesh path.
  Verified on a real DFF: fast-path == old bytes (coronas kept, smoke stripped); mesh-path parses verbatim.
- **Phase 3 — opensa-lod-generator** verbatim: `bakeCell` = `rebuildMeshNormals(applyModifiers(mergeCell(…), []))`,
  `decimateMesh` + the `lodCellRatio`/`lodCellMinTris` knobs removed. ✅ Verified on the stock map — sampled cells'
  baked tris **== source tris** (no decimation). `decimateMesh` stays in lod-common (still used by lod-procobj).
- **Phase 4 — Docs + tests** ✅: `build-mesh`/`hd-to-lod` unit tests; opensa `merge`/procobj `mesh-builder` parity
  tests still green (behaviour preserved); this plan, the opensa readme/plan, and the decimation memory updated.
