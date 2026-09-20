# 024 — Broken authored vertex data: normals evidence gate, prelit black holes, fast single-model loop

**Status: PLANNED 2026-07-29.**
Follow-up to the 020–023 normals batch. Two field cases opened it, and they turned out to be TWO
DISTINCT defect families with one common root: **mods (and some vanilla models) ship authored
per-vertex data that is internally consistent enough to pass our guards but visually wrong, and the
engine — stricter than real SA — exposes it.** The user reports the optimizer fixes ~80% of the
map's shading; this plan is about the remaining ~20%.

Field cases:

- `lae2_roads17` (txd `lae2roads`, pos 2342.7, -1682.7, 12.2) — dark Gouraud wedges on the
  curb-corner fan, dark bands along tile edges; same class reported on buildings with inset windows.
- `sphinx01_lvs` (txd `sphinx01`, pos 2167.7, 1285.7, 25.9) — hard black polygonal patches over the
  face and body. Previously mis-parked by plan 022 as "normals verified smooth → dig pak-side";
  resolved below — it was never normals.

## Diagnosis (measured 2026-07-29, throwaway scripts)

### Family A — authored normals wrong for the visible side (`lae2_roads17`)

- Vanilla: 168 verts, **no normals** (flags 0x2f), 22 reversed-winding twin faces (two-sided road
  sheet), 8 degenerate-UV fan faces (known, parked).
- `0. Map Fixes Pack` replaces the DFF with a version **carrying authored normals** (flags 0x7f):
  69 up, 61 near-horizontal, 35 pointing DOWN; copies at one position spread up to 179.6°.
- The 020 gate verdict: `failing=0` (badUnit 0, badWinding 0, **unverifiable 47**) → **preserved**.
  The winding test cannot fail a mirror-side normal (its winding agrees), and shared top/bottom
  vertices have two-sided evidence that cancels → unverifiable → trusted by design.
- Smoking gun: of 53 top-visible faces (face normal z > 0.5), **22 reference a vertex normal with
  nz < 0.5, worst nz = −1.00**. The engine's `sun × N·L` dies at those verts; interpolation paints
  the wedges/bands.
- Control: same DFF with normals stripped through the same chain (weld → degenerate → dedupe →
  prune → smooth-normals) → created normals give **0 bad top faces, worst nz = 0.99**. Our rebuild
  is fine; the preserved authored data is the bug.

### Family B — authored day-prelit black holes (`sphinx01_lvs`)

- `16. Small Prelight Pack` replaces the vanilla sphinx (1 211 verts, day luma p50 34) with an
  11 588-vert HD remaster, **no normals shipped** (created by us — verified smooth in the 022 round;
  the "facets" were never normals).
- Its day prelit: **p5=0, p25=0, p50=73, max=87 — 4 465 of 11 588 verts are black (luma < 10), and
  6 033 whole triangles are all-black**, spread across the entire model. Night is brighter than day
  (p95 230) — Vegas spotlight design; vanilla shows the same night>day shape.
- Those all-black triangles ARE the hard black patches in the field screenshots: our world shader
  has **no ambient floor** (`lit = prelit × sunIndirect × ao + sun × N·L`), so black prelit + a
  face angled from the sun renders pure black with hard edges against healthy neighbours.
- Why real SA tolerates the same data: SA's fixed-function path adds a **timecycle ambient term on
  top of prelit** for lit geometry — garbage-black prelit is lifted to ambient level and reads as
  soft shadow. Our engine skips that term, so it exposes every prelit hole map-wide. The exact SA
  formula must be recovered from gta-reversed (Phase 3b) before we pick a fix — standing rule: the
  game's own formula before a fitted constant of ours.
- 019's statistical passes cannot catch this: level shifts are whole-model and the model's MEDIAN is
  healthy (73); the holes are per-vertex outliers. 38% black is far past any point-repair fraction.

Two more field-confirmed members (2026-07-29, both from `22. Neon Objects` — a SECOND mod shipping
the class, so the scanner should expect dozens):

- `exclbr_hotl02_lvs` (txd `excalibur`, pos 2265.6, 1130.3, 47.4) — day side walls render pure
  black, night looks normal. Mod DFF: 4 242 verts, no normals; day prelit p5=0 p25=0, **1 678 black
  verts, 1 180 all-black triangles**; night set healthy (275 black, p50 39). The day/night symptom
  is the family signature: the healthy night set + neon hides the missing ambient floor; the day set
  has nothing to hide behind.
- `flamingo01_lvs` (txd `flamingo1`, pos 1934.0, 1177.4, 37.9) — very dark building. Mod DFF:
  11 060 verts, valid authored normals (walls → horizontal is correct); day p50=112 healthy but
  p5=0 — **836 black verts, 147 all-black triangles**, plus a genuinely dark authored lower quartile
  (p25=46). Milder, same class.
- Shared authoring fingerprint: all three Vegas cases cap day prelit at max **170** (vanilla peaks
  225–255) — these packs were painted for the night look and shipped garbage day sets.

## Decision: preserve-vs-recompute stays, but the gate gets teeth (not a blanket recompute)

Considered recomputing normals for ALL models regardless of authored data. Rejected as the default:

- Authored normals on hi-poly curved remasters encode smoothing a crease-45 rebuild cannot always
  reconstruct; blanket recompute discards information irreversibly.
- 020's probe stands: only ~103 vanilla world models carry authored normals, most valid — the
  mechanism is cheap either way; the risk is asymmetric.

BUT the decision is settled **empirically in Phase 4**: the scanner metric runs map-wide against
(a) hardened-gate output and (b) recompute-all output; the numbers decide. If recompute-all wins on
the metric and the eyeball round, we flip the default and the gate becomes a diagnostic counter.

## Phases

### Phase 0 — reusable fast loop: swap one model into the built game without a rebuild

`scripts/debug/model-repack.ts` (KEPT, row in `docs/debug/README.md`). The engine renders the static
world from `pak/world.ospak` welded cells — swapping a DFF/`.osm` in the built tree changes nothing;
the loop must repack cells.

- Resolve the model's source DFF the way the build does: last mod shipping it (numeric folder order,
  `gta3_img/` + loose overlays) else vanilla img. `.work` is not needed — one model re-runs the
  optimizer chain in-memory in milliseconds.
- Run the geometry chain with **configurable options**: authored kept / stripped / gate threshold,
  crease, per-pass toggles, prelit experiments — this is the "extend map-optimizer, but targeted per
  model" lever.
- Repack ONLY the pak cells containing instances of the model and patch `world.ospak` (fall back to
  a small `--rect` scratch pak served by the bench harness if in-place cell surgery turns out
  unreasonable — decide when the ospak container is read).
- Print the matching `teleport-spot.ts` invocation for each instance so the field check is one paste.

Verification: swap `lae2_roads17` with stripped-normals output, teleport, wedges gone.

**BUILT 2026-07-29 (`scripts/debug/model-repack.ts`, row in `docs/debug/README.md`). Measured:**

- `lae2_roads17 --strip-normals`: rect `9,-7` (1 cell), 111 distinct models resolved, **~10 s
  end-to-end**, lab pak 10.2 MB / 2 cell entries (hd+lod). Only sourceless models are the generated
  LODs (7 warned, as designed).
- Offline byte-level verification (`.tmp-verify-lab-cell.ts`, decodes the welded cell through
  oswire→oscell and reads the target's placement vertices):
  - main pak, roads17 placement: 165 verts — n.up `<0: 27, 0–0.5: 69, ≥0.99: 69` (the broken mod
    normals ARE in the shipping cells — end-to-end confirmation of the Family A diagnosis);
  - lab pak: 209 verts (the expected +44 splits) — n.up `<0: 54, 0–0.5: 55, ≥0.99: 100`; every
    down/sideways normal now sits on a mirror-/curb-side split copy, the top surface is clean up.
- Implementation notes that shaped it: `openGameDir`'s `overlayDirs` shadow IMG members by basename
  (no archive rebuild needed); the built `gta3.img` still carries cols + binary IPL streams, so it
  serves as the convert input verbatim; `serve-static`'s index walks Dirents, so the lab mirror uses
  per-FILE symlinks (a symlinked directory would read as an opaque file). Field check owed (Phase 2
  does it together with the scanner's finds).

### Phase 1 — scanner: find the rest of both classes, top-N by criterion

`scripts/debug/scan-model-defects.ts` (KEPT, row in `docs/debug/README.md`). Runs over the merged
source set (same resolver as Phase 0), pluggable criteria, `--top N` (10/20/100 as asked):

- Family A criteria: (a) visible-face-vs-vertex-normal disagreement (faces referencing a vertex
  normal > threshold° off the face normal, per-side aware); (b) per-side evidence disagreement of
  authored normals; (c) badUnit/NaN.
- Family B criterion: (d) prelit black holes — share of verts with day luma < 10 and count of
  all-black triangles on models whose day p50 is healthy (structured models with baked-black
  patches, not by-design dark models; tobj stays excluded as always).
- Output per model: metrics, instance positions from the built IPLs, ready teleport commands.
- The criteria list is the extension point for future defect families.

Record the top-N table in this plan (names + counts + positions).

**BUILT 2026-07-29 (`scripts/debug/scan-model-defects.ts`, row in `docs/debug/README.md`). First
full scan (7 177 of 8 123 placed models had a DFF source; 946 sourceless = generated LODs; ~1 min):**

- **Family A: 65 models** with authored normals >60° off their faces (27 with ≥20 bad faces, 16
  with ≥10% share). By source: vanilla 24, `0. Map Fixes Pack` 22, `5. SA Xbox` 6, `22. Neon
  Objects` 3, `52. Abandoned Cars` 3, rest singles. Top: `standard01_lawn` 1215/2499 (Project
  Lumos), `crack_int1` 831/1673 (vanilla — one of 020's five known mass-failures, metric
  self-validates), `vgnlowmall2` 736/2771 (Neon Objects), `ottos_bits` 401/2502 (vanilla),
  `silicon04_sfs` 288/1638 ×5 (vanilla), `des_savhangr` 198/1251 (Map Fixes), `flamingo01_lvs`
  168/5448 (Neon Objects), `vgsedragon` 156/590 ×8 (vanilla), `bonaventura_lan` 148/2492 (Neon
  Objects), `lbeachapts1_lae2` 104/2864 (Xbox Features).
- **Family B: 2 243 models** carry ≥1 all-black day triangle on a healthy median; the tail:
  ≥10 tris → 1 389, ≥50 → 455, ≥100 → 186, ≥500 → 15. **Of the ≥100 tier, 125 are VANILLA and 61
  modded** — black day prelit is stock SA authoring practice (bake shadow to 0, let the renderer's
  ambient lift it), which settles the Phase 3b lean: the missing engine ambient term is the honest
  fix; per-model data repair cannot cover 2 243 models. Top offenders (all `16. Small Prelight
  Pack` / `22. Neon Objects`): `sphinx01_lvs` 6033 black tris, `gaz27_law` 4252,
  `santahousegrp_law2` 4049, `vgsnwrehse17` 3637, `venice01b_law2` 3236, `santahouse04_law2` 2763,
  `laehospital1` 2502, `lacmabase1_lan` 1709, `exclbr_hotl02_lvs` 1180; biggest vanilla:
  `hubgirders_sfse` 616, `airport_int2` 542.

### Phase 2 — field BEFORE round on ~10 offenders

Teleport round over the Phase 1 list (screenshots), confirming each family membership before any
fix. Cheap; establishes the A side of the A/B.

**Round 1 (2026-07-29, user field checks) — three verdicts, two metric corrections:**

- `lae2_roads17` lab build (strip-normals): **"looks perfect"** — Phase 0 loop + the Family A
  mechanism both field-confirmed end-to-end.
- `standard01_lawn` (the symmetric metric's #1): **looks FINE in the field** — falsified the naive
  ">60° off the face" criterion. Its grass/bush cards carry deliberate straight-UP normals on
  vertical faces (stock vegetation trick: light the card like the lawn under it). A normal rotated
  toward the sky only brightens; the defect class is a normal facing DARKER than its face. Scanner
  criterion rewritten asymmetric (`nzVertex < nzFace − dz`, default dz 0.5) **and area-weighted**
  (686 tiny grass faces ≠ 22 road slabs) — this is also the shape the Phase 3 gate test must take.
- `gaz27_law`: **Family B field-confirmed** (one whole wall pure black at day) — and the
  strip-normals lab build did NOT fix it (correct negative control: the defect is prelit, not
  normals). `--prelit-floor` experiment lever added to `model-repack.ts` for the ambient-theory
  field proof. **Floor-40 lab verdict (user, same day): "the wall looks right now" — the
  missing-ambient theory is FIELD-PROVEN on the data side.** Phase 3b step 1 (recover the exact SA
  formula) is now the gating item for the engine fix.

Family A top after the corrected metric (by flagged area): `flamingo01_lvs` 4814u² (Neon Objects),
`mall_01_sfs` 3513u² (vanilla), `crack_int1` 3276u² (vanilla), `standard01_lawn` 1714u² (known-good
control — expect a re-check to pass), `xoverlaymap09` 1558u² / 4 faces (Map Fixes),
`vgnlowmall2` 1393u² (Neon Objects), `sbce_grndpalcst05` 833u² (Map Fixes), `bonaventura_lan`
605u² (Neon Objects), `lae2_roads17` 572u² / worstDz 2.00, `lake_sfw` 423u² (vanilla).

### Phase 3 — Family A fix: harden `tool-kit/mesh/validate-normals.ts`

- Judge each vertex against **its side's** evidence: reuse the 022 twin arithmetic (dot sign selects
  the side) instead of letting two-sided evidence cancel into `unverifiable → trusted`.
- Add an **angle threshold**: authored normal deviating more than N° from its one-sided evidence ⇒
  failing (threshold picked from the Phase 1 scanner distribution — data, not taste; expect ~60°).
  For roads17 this yields ~96/165 failing > 5% repair cap → full recompute → the clean control result.
- Derived from the asset's own geometry — no per-model lists (CLAUDE.md rule).
- Tests: unit cases (mirror-side normal, sideways normal on flat sheet, curved-remaster normal within
  threshold stays preserved) + `lae2_roads17` real-asset fixture (one manifest line in
  `scripts/test-fixtures.ts`). tool-kit core is SHARED with opensa-lod-generator — re-run the LOD
  harness; the two tools ship in tandem.

**BUILT 2026-07-29. What shipped and what it measured:**

- `validateNormals` gained the **`badShading`** check: `max(nzFace of incident faces) − nzVertex >
  shadeDz` (default 0.5 ≈ 60°, `shadeDz: Infinity` disables) — the field-derived asymmetric metric,
  not the plan's original "per-side evidence angle" sketch (Phase 2 falsified symmetric tests twice;
  judging against the vertex's most sky-facing face needs no side bookkeeping at all). Check order
  badUnit → badWinding (evidence present) → badShading keeps every 020 test green unchanged.
- `lae2_roads17` gate verdict flips exactly as designed: 020 said `failing 0 → preserved`; 024 says
  `badShading 31, unverifiable 16 → failing 31 > cap 8 → full recompute`. A lab rebuild WITHOUT
  `--strip-normals` now produces byte-identical clean cells to the manual experiment (209 verts,
  100 straight up, dark copies only on their own mirror/curb splits — `verify-cell-normals.ts`).
- Real-asset guard: `fixtures/original/mods/lae2_roads17.dff` fixture +
  `smooth-normals.integration.test.ts` (source has >10 dark top faces; gate recomputes; rebuilt
  surface has 0). Fixing the fixture path exposed a latent bug: `test-fixtures.ts` read mod fixtures
  from the pre-079 flat `mods-src/mods/` — every mod fixture silently reported MISSING while stale
  copies masked it; now `mods-src/<game>/mods`, 83/83 fixtures write.
- Suites: tool-kit 49 ✓, full consumer sweep (map-optimizer + all four LOD generators + lod-common)
  444 tests / 81 files ✓ — no snapshot re-baselines needed.

### Phase 3b — Family B fix: recover SA's real formula first, then choose the layer

1. Recover from gta-reversed (`docs/links.md`) the exact fixed-function vertex-lighting formula SA
   applies to prelit world geometry — specifically whether/how timecycle ambient is added on top of
   prelit, and what scales it. Record it in the plan.

   **RECOVERED 2026-07-29.** Two sources, verbatim:
   - gta-reversed `CustomBuildingDNPipeline.cpp`: `prelit[i] = lerp(DayColors[i], NightColors[i],
     DNBalance)` — the day/night blend writes INTO the prelight array (the PC render callback
     0x5D6480 itself is not reversed, `plugin::Call`).
   - SkyGfx `shaders/vs/ps2BuildingVS.hlsl` (aap's PS2-accurate building pipe — the authority):
     ```hlsl
     OUT.Color = IN.DayColor*dayparam + IN.NightColor*nightparam;
     OUT.Color *= matCol / colorScale;        // colorScale = 255/128 when PS2-modulate is on
     OUT.Color.rgb += ambient * surfAmb;      // timecycle ambient × material surfProps.ambient
     ```
     with `buildingAmbient = CTimeCycle_GetAmbient{Red,Green,Blue}() * LightsMult`
     (`src/buildingPipe.cpp`).

   So: **SA's world lighting = (day/night-blended prelit × material colour) + timecycle ambient ×
   surfaceProps.ambient — an additive, normal-independent ambient floor.** A black-prelit vertex
   renders at ambient level; that is the term our `worldShade` (`lit = prelit×sunIndirect×ao +
   sun×N·L + …`) is missing, and why the engine exposes every prelit hole the original hides.
2. **DECIDED + BUILT 2026-07-29: engine level** (user decision — "we don't break the original map
   and follow the correct approach"). The engine half lives in
   [`docs/plans/093-world-ambient-term/`](../../../../docs/plans/093-world-ambient-term/readme.md);
   restriction recorded in `docs/restrictions/engine-lighting.md`. The options considered:
   - **Engine**: if SA genuinely adds an ambient floor, our world shader is missing a term of the
     original formula — adding it fixes every prelit hole map-wide at once (and softens Family B
     without touching data). This changes global calibration (`worldLight` knobs absorbed the gap),
     so it needs the bench ritual + a field sweep, and it is engine scope — if taken, it becomes its
     own small plan and this phase records the decision + link.
   - **map-optimizer**: per-vertex prelit hole repair (infill black outliers from spatially-adjacent
     healthy vertices of the same region) for the data-side cure; honest for holes, but 38% black on
     the sphinx is reconstruction, not repair — viable only if the engine path is rejected.
   - Both may land: engine term restores SA parity; data repair stays for models broken beyond it.
   - Current lean (from the four confirmed cases): **engine-first** — two independent mods ship the
     class, the excalibur alone has 1 180 all-black triangles (repair would be reconstruction), and
     the night-looks-fine symptom is exactly what a missing ambient term predicts.

### Phase 4 — settle preserve-vs-recompute-all with numbers

Run the Phase 1 Family A metric map-wide on (a) hardened-gate output, (b) recompute-all output.
Compare bad face counts + eyeball the disagreement set through the Phase 0 loop. Keep the winner as
default; record both numbers here.

**MEASURED 2026-07-29 — recompute-all REJECTED by its own numbers.** All 164 placed models carrying
authored normals, both paths through the full geometry chain, dark-face metric on the OUTPUT:

| path | dark faces | dark area | verts |
|---|---|---|---|
| hardened gate (024 default) | **673** | **2 330 u²** | 205 886 |
| recompute-all | 823 | 3 069 u² | 210 800 |

The blanket rebuild is WORSE map-wide (the smooth-group rebuild produces some legitimately
steep-slope dark faces the metric counts, and it discards valid authored intent) plus ~5 k split
verts of bloat. The gate loses on only 12 models, all micro-area (worst 80 u² total vs roads17's
572 u² pre-fix; `sw_trailer*` 51–68 faces at 5–7 u² are slivers). Preserve-with-teeth stays the
default; no flag flip.

### Phase 5 — close the crease-override wiring gap (found during diagnosis)

`perfect-map-builder` never passes `creaseOverrides` to `runOptimizer` (`pipeline.ts:131-146`), and
`data/crease-overrides.json` ships empty (the `sphinx01_lvs: 80` entry plan 023 claims was never
committed) — per-model crease is unreachable in pmb builds. Wire the default-JSON load into the pmb
call site. Populate entries only when the field asks.

**CLOSED 2026-07-29, one level deeper than planned:** the default load moved INTO `runOptimizer`
(`src/crease-overrides.ts`, `options.creaseOverrides ?? loadCreaseOverrides()`) so EVERY entry point
gets the curated JSON — pmb needed no change at all, and the CLI now only handles its explicit
`--crease` path. Loader unit-tested (range validation, comment keys, missing file). The JSON itself
stays comment-only until the field asks for an entry (sphinx remains parked — its facets were
Family B all along, see Corrections).

### Phase 6 — full rebuild + field AFTER round

`build:game:original:opensa`, re-teleport the Phase 2 list, record before/after per spot. Numbers in
this plan; anything perf-visible goes to `docs/benchmarks/` per its schema.

**RAN 2026-07-29 (the rebuild also carried 12 new vehicle mods — noted as the second variable; they
cannot touch world cells).** The gate's first full-map run:

| verdict | vanilla probe (020) | this build (024 gate, modded tree) |
|---|---|---|
| preserved | 83 | 98 |
| point-repaired | 15 meshes / 369 verts | 48 meshes / 1 194 verts |
| recomputed | 5 | **56** |
| created | — | 11 311 |

Field verdict (user): the 024 spots "all fine". Two NEW field reports from the tour turned out
to be an UNRELATED pre-existing class — flat light-blue ground patches at Santa Maria / SF-west —
investigated the same day to a stalemate (pak data exonerated piece by piece; a mod-resolved asset
triggers it; the 024 gate provably didn't touch those cells — all their models ship no normals):
**live investigation + resume levers in `docs/open-issues/fixed/mod-dff-winding-and-atomic-frame.md`**. `model-repack.ts`
gained the bisection levers built for it (`--raw`, `--no-mods`, `--mod-only`, `LAB_NO_WATER=1`).

## Corrections to earlier records (do in the same change as Phase 3b)

- Plan 022's parked note "sphinx facets → dig pak-side" is superseded: the facets are Family B
  (black authored day prelit), not normals and not pak — update the note with a pointer here.

## Non-goals

- The 8 degenerate-UV texel-smear faces on roads17's fan (authored SA data, byte-identical in
  vanilla, PARKED by the user 2026-07-15).
- 019's statistical prelight machinery (level/seam/night verdicts) — untouched; Family B is
  per-vertex holes, a different mechanism.
- Night-set behaviour of the sphinx (night p95 230 is Vegas spotlight design — protected by the
  glow-prop rule already).
