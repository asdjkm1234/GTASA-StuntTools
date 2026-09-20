# 095 — DFF geometry parity: the winding RenderWare draws, and the frame SA discards

**Status: SHIPPED 2026-07-30 — both fixes in, field-verified in sa-map-viewer, all 3218 tests green.**

Fixes the two root causes in
[`docs/open-issues/fixed/mod-dff-winding-and-atomic-frame.md`](../../open-issues/fixed/mod-dff-winding-and-atomic-frame.md),
found by A/Bing the user's two `--no-optimizer` builds (`build/pure`, `build/pure+mods`) against the
merged SA tree `build/strip-ab/mods`. Read that doc first — every number quoted below is measured there.

Both bugs are ours: the assets are legal SA that the real game renders correctly, and both were invisible
to a data-level probe because **the bytes are equivalent and only the interpretation we derive from them
is wrong**. That is why the 07-29 round exonerated instance, IDE row, DFF, weld bucket, `.oscell` group
and textures one by one and still had nothing.

| # | Bug | Symptom | Fix |
| --- | --- | --- | --- |
| 1 | We build triangles from the Geometry Struct FACE ARRAY; RW draws the BinMeshPLG index data | `roads32_law2` invisible (back-face culled), collision + camera focus intact | take the winding from the drawn index data |
| 2 | We apply the atomic's own frame transform; `LoadAtomicFile` gives every atomic a fresh identity frame | `land_42_sfw` rotated 90°; vanilla `aw_streettree1` (165 inst) sunk 3.1 m | do not apply it for SIMPLE models |

## Restrictions check (`docs/restrictions/`, read 2026-07-30)

- **`assets-and-data.md` → "A per-asset decision cached by CONTENT may not depend on its caller"** — both
  fixes live in per-model parse/prepare code whose results are cached by model name
  (`preparedCache`, the clump cache). Bug 1's fix is content-only (the DFF's own two arrays), so it is
  safe. Bug 2's fix is NOT: "is this a simple model or an animated clump" is caller knowledge. It
  therefore belongs in the WELD (which already has the `def` and the `animated` set), not in
  `prepareClumpAtomics` — putting it in the cached layer would make one model's prepared geometry depend
  on which host asked for it first. Caught only if someone notices; treat as silent.
- **`assets-and-data.md` → "A rule must derive from what the asset CARRIES"** — satisfied: no model is
  named in either fix. Bug 2's gate is the IDE section/animation flag, which is what the asset carries.
- **`assets-and-data.md` → "Dig out the original game's real formula first"** — done, and it is the whole
  basis of both fixes: gta-reversed `FileLoader.cpp` (`LoadAtomicFile` → `SetRelatedModelInfoCB` →
  `RpAtomicSetFrame(atomic, RwFrameCreate())`), corroborated independently by the COL oracle. No fitted
  constant anywhere in this chain, so no `docs/hacks/` entry is owed.
- **`gpu-and-shaders.md` → a texture array that GROWS kills recorded bundles** — not touched; no texture
  work here.
- **NEW restrictions this plan must ADD (same change, per CLAUDE.md):** "the drawn topology is the
  BinMesh index data, not the face array" and "a simple map model's own frame transform is discarded" —
  both SILENT (they render, just wrong), which is exactly why they cost two sessions.

## Phase 0 — a permanent detector for both families

The two throwaway scans that found this become a kept script alongside `scan-model-defects.ts`. Both
families carry a measurement lesson that must survive in code:

- **Family C — winding:** compare the FACING HISTOGRAM of the two orders, never a per-triangle key
  match. The first version keyed triangles by their sorted index triple and reported 770/1546 "flipped"
  faces on *vanilla* `laenwblk2` — pure noise from key collisions (a model has many coincident triples).
  With histograms the whole merged map yields **4 models, all mod-introduced**.
- **Family D — atomic frame:** consider only the frames an ATOMIC hangs from. Counting all frames gave
  189 models; the `Omni*` 2dfx light frames that made up the difference are never rendered. Real count:
  **41**. Verdict per model comes from the COL oracle (a COL is authored in the space SA renders, so the
  version matching its bounds is the truth).

Kept as its own script rather than two more families of `scan-model-defects.ts`: that one ranks defects in
the authored DATA, this one ranks defects in our READ of it, and bolting both readers on would have doubled
a file that is already long. `scripts/debug/scan-geometry-parity.ts` + a row in `docs/debug/README.md`.

**Measured** (`build/strip-ab/mods`, 11 668 placed HD models, 11 474 parsed, 0 parse failures):

- Family C — **4 models**: `Roads32_LAw2` (drawn up 65/down 0 vs face array up 0/down 65 — the whole slab),
  `laebridgeb` (70/52 vs 52/70), `ap_radar1_01` geom 1 (993/1036 vs 1036/993), `Lae2_roads17` (2 faces).
- Family D — **15 models with a non-identity atomic frame**, of which the COL says DROP for the 8 whose kept
  atomic is their own geometry (`aw_streettree1` 6.76 → 0.01 · `grassplant` 14.66 → 0.00 · `hbgdSFS`
  43.52 → 0.00 · `land_42_sfw` 8.15 → 0.00 · `aw_streettree2` 9.59 → 0.01 · `Gdyn_barrier17` 10.86 → 0.82 ·
  `lhouse_barrier1` 8.23 → 0.57 · `lhouse_barrier3` 5.06 → 0.58), undecided for the xref cases where the
  kept atomic belongs to another object (`sprasfw` 291.19 both ways — see the third gap below).
- `roads33_law2`, the visible control slab next to `roads32_law2`, is absent from both families — the scan
  said "clean" before the field said "visible".

## Phase 1 — the winding comes from the drawn index data

`readTriangles` (`packages/renderware/src/parsers/binary/dff.ts:756`) reads the Geometry Struct face
array as `[v1, v0, matId, v2]`; `assignMaterialsFromBinMesh` (`dff.ts:109`) then walks BinMeshPLG only to
key material indices onto those triangles. RenderWare renders the BinMesh data, so when an exporter
writes the two with opposite winding we draw the mesh inside-out.

Change: build the triangle list FROM BinMeshPLG when the geometry has one (trilist triples, or a
tristrip unwound with alternating parity, degenerate joins dropped — the material index comes free, per
mesh), and keep the face array as the fallback for geometries without a BinMesh.

Safety net — this touches every DFF in the project (world, vehicles, peds), so a one-off sweep re-read
every archive DFF both ways and compared the triangle SET, the per-material counts and the winding.

**Measured** (all 13 003 DFFs of `build/strip-ab/mods/models/gta3.img`, 16 318 geometries):

| difference | geometries | what it is |
| --- | --- | --- |
| winding | **5** | the 4 Family-C models (`ap_radar1_01` twice) plus `des_savhangr` |
| triangle count | 16 | face-array faces the BinMesh does not draw, 1–8 per geometry (all DROPS) |
| material split | 24 | a handful of triangles the two arrays assign differently |
| everything else | 16 273 | identical |

**The ADC trap, found by this sweep.** The first run reported 31 winding changes and counts going UP by
10–40 % — all of it one car, `bloodrb`, whose every geometry grew (geom 18: 1050 → 1487). Cause: it carries
the **ADC plugin (`0x134`)**, a PS2 tristrip whose parity/restart decisions live in per-index bits we do not
decode, so the plain PC unwind invents triangles. Exactly **two DFFs in the game ship it — `bloodrb` and
`rccam`, both STOCK** (`game-src/original` has them too), so the guard costs nothing: an ADC strip falls back
to the face array. A second trap on the way: `findChild` scans with the shared stream cursor, so probing for
the plugin AFTER seeking to the BinMesh silently corrupted the read (733 models stopped parsing).

The old "recover material indices from BinMesh when the face array left them all zero" special case is gone —
the split's material comes with the drawn data now. `dff.test.ts`'s BinMesh block was rewritten around the
new contract (a winding case added); the map-optimizer's `sameTopology` had to become an unordered multiset
compare, because its round-trip asked "does the IR match the file's FACE ARRAY" and the answer is now no
even for an untouched file — with the positional compare every re-encode took the rebuild path and threw on
skinned models.

## Phase 2 — a simple model's own frame transform is discarded

`weldModel` (`packages/cell-weld/src/weld.ts:984`) calls `frameWorldTransform` and hands it to
`appendInstance`, which multiplies every position and normal by it. SA does that only for CLUMP models
(peds, vehicles, `anim` IDE entries — `LoadClumpFile` keeps the hierarchy); a simple `objs`/`tobj` model
goes through `LoadAtomicFile`, which replaces each atomic's frame with a fresh identity one.

Change: in the weld, do not apply the frame chain for a simple model's atomics; keep applying it where
the clump hierarchy is the point (the animated path already diverges there). The COL oracle table in the
open-issue doc is the expected-value list: `land_42_sfw` 8.15 → 0.00, `aw_streettree1` 6.76 → 0.01,
`grassplant` 14.66 → 0.00, `hbgdSFS` 43.52 → 0.00, three barriers 5–11 → 0.6–0.8.

**Measured.** The gate is `def.anim !== undefined` — the same dispatch SA makes, and it lives in the weld
because `prepareClumpAtomics` is cached by model name (the restriction above). Regression test in
`weld.test.ts`: `nt_noddonkbase` welded as a clump vs as a simple def keeps its vertex count and changes its
placement (spread 66.82 → 75.79) — the direction is not the point, since its frames pull parts together as
often as apart; being moved by data SA throws away is.

Not in scope, deliberately: **SA also keeps only ONE atomic per simple model** (47 894 welded triangles
over 82 instances that the game never draws). Fixing that needs an IDE-section gate because the same
multi-atomic set contains the animated props (`nt_windmill`, `derrick01`), so it is a follow-up — recorded
in the open-issue doc so it cannot be lost.

## Phase 3 — rebuild, field A/B, close the issues

Rebuild `build/pure+mods` (or the canonical build) and A/B in sa-map-viewer at `?at=150,-1700&h=150`:
`roads32_law2` draws, `land_42_sfw` sits right, and **`roads33_law2` must be pixel-identical** — it is
the control that carries neither defect. Plus a spot check on `aw_streettree1` (1057,−1608) and
`grassplant` (−1062,−1632), which move for the first time.

**Measured** (sa-map-viewer, `?at=…&h=…`, `panel=0 water=0`, RMSE over the full frame):

| capture | before → after | reading |
| --- | --- | --- |
| vanilla `game-src/original` at the strip | **0 (0)** | byte-identical: the fixes touch nothing vanilla here |
| merged `build/strip-ab/mods` at the strip | 0.0454 | the road slab is back — the blue hole is closed |
| merged vs vanilla at the strip | 0.0689 → **0.0518** | the mod tree moved 25 % closer to vanilla (the rest is the mods' own changes: textures, 11 removed props) |
| merged at `land_42_sfw` (−2318,1279, h 220) | 0.1447 | the torn terrain + fragmented house rows become one continuous field |
| merged at `aw_streettree1` (1057,−1608, h 90) | 0.1136 | the 165 street trees rise out of the ground |

The strip capture is the money shot: before, the beach lane's road ends mid-curve and everything south-east
of it is flat sky-blue; after, it runs to the frame edge. `roads33_law2` — the control — is unchanged in
both, as is the whole vanilla frame.

## Close-out — what this change left behind

**In-game confirmed by the user 2026-07-30** after a rebuild, on top of the offline A/B above.

Docs, one per rubric (the same fact never twice as detail):

| Where | What |
| --- | --- |
| [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md) | the two rules a new design must satisfy — the drawn topology is the BinMesh data; a simple map model's own frame transform is dead data. Both marked **silent** |
| [`hacks/adc-strip-fallback.md`](../../hacks/adc-strip-fallback.md) | the one place the first rule is knowingly NOT applied (2 stock ADC models), what it stands in for, what retires it |
| [`edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md) | the parity gap this plan did NOT close — SA keeps one atomic per simple model, we weld all 41 multi-atomic ones (47 894 triangles over 82 instances) |
| [`features/dff-parser.md`](../../features/dff-parser.md) | the parser's new contract; the stale "BinMesh fallback recovers material indices" line is gone. Its "frame transforms are ignored for map models" line was already there and had been **untrue in the welder** — now noted as such |
| [`features/map-pipeline.md`](../../features/map-pipeline.md) | same correction on the map side, with the `def.anim` gate spelled out |
| [`debug/README.md`](../../debug/README.md) | `scan-geometry-parity.ts` + both measurement traps |
| [`open-issues/fixed/…`](../../open-issues/fixed/mod-dff-winding-and-atomic-frame.md) | the forensic record, moved out of the live folder |

Test coverage, per thing this plan changed:

| Change | Guard | Fails without the fix? |
| --- | --- | --- |
| triangles from the drawn index data | `dff.test.ts` — synthetic split with a reversed winding + a material the face array disagrees with | yes |
| …on a real exporter's output | `geometry-parity.test.ts` — the Map Fixes Pack `roads32_law2` reads 65 faces UP, matching the stock copy (`npm run test:fixtures` manifest: mod + stock) | **yes — verified by reverting the parser** |
| ADC fallback | same file — stock `bloodrb`'s per-geometry counts must equal the Struct's own `numTriangles` | n/a (guards the guard: a future BinMesh change that drops it turns this red) |
| frame applied only for clump defs | `weld.test.ts` — `nt_noddonkbase` welded as a clump vs as a simple def: equal vertex count, different placement | yes |
| the optimizer's round-trip after the reorder | `map-optimizer/…/dff.test.ts` — a RE-INDEXED triangle still forces rebuild; a mere PERMUTATION now keeps the overlay | yes (both directions) |

Not covered by a test, deliberately: the 16 geometries that lose face-array faces the BinMesh does not draw
and the 24 whose material split shifts. Both are consequences of the same rule the tests above pin, and both
were enumerated by the one-off sweep rather than by an assertion — `scan-geometry-parity.ts` is how they get
re-checked after a data change.
