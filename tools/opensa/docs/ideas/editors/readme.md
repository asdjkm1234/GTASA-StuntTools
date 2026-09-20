# Ideas — Editors

Interactive asset editors that turn our **batch curation loop** (field report → hand-edit a JSON data-file
→ full rebuild → eyeball) into a **direct one**: open a model, select polygons, fix it, see it, export.
Everything here is a front-end over machinery we already own — the DFF ⇄ IR round-trip, the map-optimizer
transforms, and the viewer/engine — not new asset tech.

## 01 — Model editor: select polygons → recompute normals / reconfigure prelight → export

### Motivation

We keep hitting a small class of per-model look bugs that our whole-map passes can't fully resolve and that
today cost a slow curation cycle:

- **Faceted shells** where smooth-normals should have welded but didn't (sphinx01_lvs — solved by a
  hand-tuned `crease-overrides.json` entry + a full rebuild to eyeball).
- **Prelight seams / wrong baked shading** on specific models (terrain `gp_land*` seams, `lae2_roads17`'s
  authored bright-center/dark-edge road prelit that the rigid path now applies).
- **Stray/garbage geometry** on a single model (the gostown `Gp_feuillu1` LOD cards — fixed offline with
  `scripts/debug/strip-polygons-from-dff.ts`, the proof-of-concept of the export path below).

Each of these is a **local, per-polygon** decision that a human makes best by looking at the model and
selecting the offending faces. The tool collapses "edit JSON → rebuild → look" into "look → select →
tweak → export".

### The export decision (settled)

**Destructive folder export.** Press **Export**, choose a folder, and the tool writes the updated model
(DFF, plus its TXD if edited) into that folder as loose files. No pipeline coupling, no sidecar format, no
build step — the user drops the exported model wherever it belongs (a game IMG, a Modloader mod, a
standalone asset).

Tradeoff accepted: the edit lives in the exported binary, not in a reproducible curation data-file, so it
is **lost on a re-extraction** and does not self-document in the build. That is fine for this tool's job —
fast, direct fixes. The reproducible-curation alternative (emit `crease-overrides.json` /
`broken-prelight.json` entries, or a replayable per-model edit sidecar the pmb applies at build time) stays
on the table as a **later** mode, not a blocker for v1. If a fix needs to be reproducible, the user can
still transcribe the tweak into the matching data-file after eyeballing it here.

### What already exists (reuse — ~80%)

The three verbs are already pure operations over the shared **MeshIR**
(`tools/map-optimizer/src/core/ir.ts`: `SubMesh` = `positions`, `triangles[{a,b,c,material}]`, `normals`,
`prelitColors`, `nightColors`, `uvs`, `extraUvs`, `materialCount`):

| Need | Existing building block |
| --- | --- |
| Parse a model | `parseDff` (`@opensa/renderware/parsers/binary/dff`) → `clumpToIr` (`tools/map-optimizer/src/adapters/gta-sa/read.ts`) → `MeshIR` |
| Recompute normals | `smooth-normals` plugin (`tools/map-optimizer/src/plugins/smooth-normals.ts`): `twinFaces`, dihedral test on twin-quad cross pairs, 26-neighbour ε-weld, `accumulateGroupNormals` (area × corner-angle), per-model **crease override** (`creaseFor` / `crease-overrides.json` / `--crease`) |
| Reconfigure prelight | `apply-prelit-level` (`shiftPrelit`, `tailGuard` — additive luma shift, darkening fades on the bright tail), `weld-seam-prelit` (copy/blend across seams), the shared-builder AO baker |
| Re-encode a model | `encodeDff(source, ir)` (`@opensa/map-optimizer/codec`): overlays attributes when topology is unchanged, else `rebuildGeometry` (Struct + trilist `BinMeshPLG` + night colours + bounds); the chunk codec fixes all sizes |
| Read/write archives | `@opensa/tool-kit/archive/img` (`openImg`, `editArchive`, `writeImgFile`, `createImg`); `@opensa/renderware/parsers/binary/txd` (`parseTxd`, `recoverLockedTextures`) |
| Render + pick | the viewer/lab (plans [022](../../plans/022-debug-viewers/readme.md), [079](../../plans/079-canonical-build-source/readme.md)) already renders DFF/pak models in the 074 engine with picking |
| SA-strict export | the codec already enforces the strict set (tristrip flag → trilist `BinMesh`, uint16 index ceiling, COL preservation, id ≤ 18630) — see `tools/lod-trees-generator/docs/plans/005-sa-asset-format.md` and `docs/open-issues/locked-dff.md` |

`scripts/debug/strip-polygons-from-dff.ts` already does the full **decode → drop selected triangles →
re-encode → verify → write** loop headlessly. The tool is that loop with an interactive selection UI and a
live preview in front of it, plus normals/prelight edits instead of only deletion.

### What is new (~20%)

1. **Interactive selection in the viewer.** Pick and highlight a set of polygons. Granularities, coarse → fine:
   - **material / submesh** (the natural SA grouping — one click on a surface selects its material's tris);
   - **triangle set** (click / paint / box / lasso);
   - **by normal angle** (select all faces whose normal deviates > θ from a seed — the crease-authoring case);
   - **vertex region** (box) for prelight edits that should ignore material borders.
2. **Selection-aware transforms.** The plugins run whole-model today; give them a triangle/vertex mask.
   - Prelight shift and normal recompute mask cleanly.
   - **Weld/smooth across a selection boundary needs a rule**: does recomputing normals on a selection weld
     with the unselected neighbours (seamless) or treat the selection border as a hard edge? Expose both.
3. **Live preview.** Apply the edit to the in-memory IR and re-render **through the engine's rigid path** so
   the preview matches in-game shading exactly (prelit + night colours as the 2026-07-19 `read prelit … on
   the rigid path` change applies them). No rebuild.
4. **Prelight editor UI.** Per selection: additive shift, set-to-value, recompute AO (shared builder),
   copy/blend from neighbours; day **and** night sets, with the night set kept in sync (`syncNightColors`).
5. **Export panel.** Encode → verify (re-parse, assert the edit took, counts sane) → write DFF (+ edited
   TXD) into the chosen folder.

### Suggested build order (each phase ships something usable)

1. **Read-only single-DFF viewer** — open a `.dff` (loose or picked out of an IMG), render it, show the
   `dump-dff-materials` inspector data in a panel (per-material texture, tri/vert, day/night prelit, bbox).
   Click a surface → highlight its material. (This is the smallest end-to-end slice: load → render → pick.)
2. **Selection model** — material → triangle → vertex resolution; box/lasso; by-normal-angle; multi-select;
   a persistent highlight overlay.
3. **Normals recompute on selection** — a crease-angle slider driving the `smooth-normals` machinery over
   the masked faces, with the boundary rule from (2) above and **live preview**. Directly answers sphinx.
4. **Prelight reconfigure on selection** — shift / set / AO / copy-neighbour, day + night, live preview.
   Directly answers roads17 / terrain seams.
5. **Export** — `encodeDff` → verify round-trip → write DFF (+ TXD) to a chosen folder. Reuse the
   verification pattern from `strip-polygons-from-dff.ts` (re-parse and assert before writing).
6. **(Optional) IMG round-trip** — open a model straight out of a game IMG and, as an export option, write
   it back into a copy of that IMG (`editArchive` + `writeImgFile`) instead of a loose folder.

### Open questions

- **Home**: a new mode inside the existing lab/viewer (079) vs a standalone editor app. The viewer already
  has render + pick, so a mode is the cheaper start.
- **Default selection granularity** — material-click first (covers most cases), freeform paint later.
- **Boundary rule for normal recompute** across a selection edge (weld-with-neighbours vs hard-edge) — needs
  a clear default; probably weld-with-neighbours to match the whole-model pass, with a "freeze border" toggle.
- **Undo/redo & non-destructive stack** — edits should be reversible in-session before export.
- **Welded map models**: the tool edits **source DFFs** only; pak cells are welded and are not an edit
  target — an edited map model still needs a pmb rebuild to reach the streamed world. Self-textured by-name
  models (vehicles, props, sphinx-class) are single DFFs and the clean first target.
- **Locked assets**: load-time recovery already handles the four lock variants (`recoverLockedTextures` /
  `forEachClumpChild`); export writes **clean** headers, which incidentally is the `unlockDff` the byte-tools
  gap in `docs/open-issues/locked-dff.md` asks for — worth wiring the same path.

### Non-goals (v1)

Not a modeler: no vertex add/move/extrude, no re-topology, no UV editing, no material authoring. Not a pak
editor (source DFFs only). It selects existing polygons and recomputes their normals / prelight, and it
exports. Mesh authoring, if ever wanted, is a separate track.
