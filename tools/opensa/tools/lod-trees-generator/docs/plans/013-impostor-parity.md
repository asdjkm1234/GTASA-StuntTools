# 013 — Impostor parity: why every tree LOD looks nothing like its HD, and the fixes in order

**Status: DONE and FIELD-ACCEPTED 2026-08-22.** Steps 01/02/03/06 built and measured on the built trees ([benchmark](../../../../docs/benchmarks/tools/2026-08-22-lod-trees-013-on-the-built-trees.md)); 04 NOT BUILT (measured away by 06, and its `sa`-half ASI removed with a [postmortem](../../../../docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md)). **The verdict, on BOTH targets — the real game and OpenSA: "definitely better, the LOD→HD transition is much less noticeable, no defects seen"** (the user, 2026-08-22, after driving and flying both builds). Reach: `tools/lod-trees-generator` (the rule), `tools/rw-codec`
(the DXT5 endpoint fit), `tools/map-placement` (the impostor IDE row), and — phase B only, OpenSA target only —
`packages/cell-weld` + `packages/engine`.

**The report** (the user, 2026-08-21, sa-map-viewer with `?lod=1` at HD range, `sm_veg_tree7vbig` and
`sm_veg_tree5`): "every tree differs, not only these two" — the LOD is a solid dark mass where the HD is an airy
canopy with sky through it, the leaves carry white speckle, and the trunk shows as crossed planes. Plan 012
made the impostor colour-correct and it still looks wrong, because colour was never the whole of it.

## What was measured (2026-08-21, the 2026-08-17 build, both targets' archives)

Instruments: the built `lodtrees.txd` + `lodsm_veg_tree5.dff` out of `build/original/sa/models/gta3.img`, the
`.osm` pair out of `build/original/opensa/models/gta3.img`, the HD source in `mods-src/original/vegetation/`.

| Fact | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | --- | --- |
| HD | 4 065 tris, NO normals, prelit trunk 70 / branches 181 / leaves 145 (after the `--prelight` transfer) | 8 820 tris, NO normals, 64 / 152 / 144 |
| Impostor | 16 tris = 4 cards × 2 tris × 2 windings, prelit 148, night 21 | same, prelit 143, night 19 |
| Atlas | 512² DXT5, 4 tiles of 256² | same |
| Canopy fill per card (upper 60 % of the silhouette box) | **54–57 %** | **56–61 %** |
| Isolated opaque texels (≤ 1 opaque 4-neighbour) | **5.1–7.2 %** | 4.1–4.7 % |
| Atlas texels clipped (any channel ≥ 250) | 0.0 % | 0.3 % |
| Atlas mean RGB over opaque texels vs source leaf texture | 41/47/37 vs 39/44/30 | 64/75/62 vs 55/69/47 |
| Normals in the built `.osm` | HD and LOD both `(0,0,1)` on every vertex | same |
| IDE flags | HD `2105476` = `0x202084` (double-sided + **IS_TREE** + draw-last); LOD `2097284` = `0x200084` — no `IS_TREE` | same |

## The causes, in the order they matter

1. **Over-density by construction — the dominant one.** A card is the orthographic projection of the WHOLE
   canopy, so ONE card seen head-on has exactly the HD's coverage (~55 %). The impostor draws FOUR such cards
   crossed at 45°, and from any viewpoint all four contribute: `1 − 0.45⁴ ≈ 96 %` fill against the HD's 55 %.
   The sky and ground that show through nearly half of the HD canopy are replaced by leaf texels — that is the
   "solid dark blob", and no amount of colour work changes it. On top of it every card is emitted with BOTH
   windings while its IDE row already says `DISABLE_BACKFACE_CULLING` (both engines draw it cull-none), so each
   card is drawn twice; in a blend path with no depth write that doubles every partial-coverage edge texel.
2. **Point-sampled bake — the speckle.** `rasterizeTriangle` takes ONE bilinear sample of the source texture
   per atlas texel (a 1024² leaf texture on a 256 px card: a ~16×16-texel footprint collapsed to one point) and
   a binary 0.5 alpha test. Bright twig texels the HD's mips average away survive as single white dots, thin
   leaves pass or fail the test at random — the 5–7 % isolated texels above. Real SA shows the same atlas, so
   this is visible on both targets.
3. **Wrong alpha class, and no wind.** The impostor row carries `0x200084` — `DEFAULT_FLAGS` in
   `map-placement/ide.ts`, copied from Proper-Fixes' LOD vegetation — and the HD row carries `IS_TREE`. In
   OpenSA `isVegetationDef` reads that bit: the HD canopy is welded CUTOUT (depth write, sharpened edge,
   `fsWorldCutout`) and the impostor SOFT BLEND (no depth write, sorted, `fsWorld`): a different pipeline and a
   different edge for the same leaves, and the blend path is what turns cause 1 from stacking into full
   compositing. The same bit is what makes the HD sway; the LOD stands still beside it.
4. **DXT5 fitted over black transparent texels.** The bake's raster starts at RGBA 0 and nothing dilates colour
   into the transparent texels before `encodeDxt('dxt5')`; `endpoints()` excludes transparent texels only in
   DXT1 punch-through mode, so every 4×4 block that touches an edge spans black↔leaf and its leaf texels
   quantise toward black. The engine's `processAlphaTexture` dilates AFTER decoding — too late. Contributes to
   both the darkness and the noise; it is in both targets' atlases.

**Ruled out, with the numbers above**: prelit clipping by plan 012's normalisation (0.0 % clipped; atlas mean
tracks the source leaf texture), atlas resolution (512 px per tree, 256 per card — not the 128 default), and
normals (both HD and impostor carry `(0,0,1)` in the built `.osm`, so the viewer lights them the same; in the
PAK the cell bake rebuilds smooth normals — plan 015 — and a flat card's rebuilt normal is its plane, which
phase B addresses by authoring the normal on purpose).

**Where it was seen vs where it matters**: the screenshots force the LOD at HD range, the worst case. The
acceptance criterion is parity AT THE SWITCH and beyond (HD `vegetation` rows draw to 150, the impostor to
1 500), judged from the driver's seat; the viewer pair `?lod=0` / `?lod=1` at the same `&at=…&h=…&pitch=…&yaw=…`
pose is the offline instrument — it is what produced the report and it is reproducible.

## Steps

| # | Step | Target | Lands in |
| --- | --- | --- | --- |
| 01 | supersampled, mip-aware bake; colour dilation before DXT5; DXT5 endpoints ignore transparent texels | both | `lod-trees-generator/core/raster.ts`, `render.ts`; `rw-codec/dxt-encode.ts` |
| 02 | the impostor row inherits the source's vegetation bits; one winding per card | both | `map-placement/ide.ts` (flags param is already there), `lod-trees-generator/core/cards.ts` |
| 03 | density: measure the stack, pick the card rule — MEASURED, 4 cards stay | both | `lod-trees-generator` config + a benchmark |
| 04 | view-weighted cards (a billboard-set material): one projection from every angle — NOT BUILT, superseded by 06 | OpenSA; the `sa` half was to be an ASI, now [postmortem](../../../../docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md) | — |
| 05 | field verdict, numbers, docs — CLOSED 2026-08-22, accepted on both targets | — | `docs/benchmarks/`, this file, tool readme |
| 06 | per-target card sets + the card alpha solved per tree — BUILT 2026-08-21 | both | `lod-trees-generator/core/{probe,card-alpha}.ts`, `perfect-map-builder` |

### 01 — the bake stops aliasing

- `rasterizeTriangle` samples an `S×S` sub-grid per texel (start `S = 4`; it is a bake-time cost only —
  record the bake time before/after, the `trees` stage is ~2 min today), accumulating PREMULTIPLIED colour and
  coverage; the texel's alpha is its coverage, its colour the covered mean. The source texture is sampled at
  the mip whose texel size matches the sub-sample footprint (reuse `buildMipChain` on the decoded source), so
  a twig highlight contributes its share and no more.
- After the tile is rendered, dilate colour into transparent texels (nearest covered colour, 8 px is plenty
  for a 4×4 block fit) BEFORE the DXT5 encode; `endpoints()` gets the same transparent-exclusion it has for
  punch-through, for every format with an alpha channel. Both encodings (gamma and linear) take the same path.
- Keep the 0.5 test only where SA needs a decision: the gamma atlas for the `sa` target is alpha-tested by
  the game at the entity's reference anyway; the linear sidecar carries coverage as authored and the OpenSA
  weld classes it (02). Whether the `sa` atlas should stay coverage or be re-thresholded is a FIELD question
  — both go into the bottle and the user looks.
- **Done when** the isolated-texel share drops below 1 % on the two reference trees and the atlas mean RGB
  stays within ±3 of today's (the bake got smoother, not darker or lighter).

#### 01 — BUILT 2026-08-21 (not yet field-verified; that is step 05)

Numbers, conditions and the full tables: [`docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`](../../../../docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md).
Instrument: `scripts/debug/impostor-atlas-census.ts` — bakes a named tree IN PROCESS in ~2 s (a full `trees`
stage is ~10 min), and it reproduced the plan's own baseline before anything was changed, which is the only
reason its "after" is worth reading.

| | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | ---: | ---: |
| speckle (α ≥ 128 with 4-neighbour mean < 64) | 6.0 % → **1.1 %** | 3.6 % → **0.4 %** |
| canopy MASS (mean α over the canopy box) | 33.5 % → 33.7 % | 36.8 % → 36.9 % |
| canopy fill (α ≥ 128) | 51.1 % → 40.9 % | 56.7 % → 47.0 % |
| median luminance / alpha-weighted RGB | 42 → 42 · 44/47/35 → 44/47/35 | 64 → **67** · 66/77/58 → 64/73/56 |
| bake, 4 cards at 512² | 285 ms → 2 135 ms | 401 ms → 2 533 ms |

**Three things the step learned that the plan had wrong, and they are the step:**

1. **Alpha may NOT come from the mip.** Sampling alpha at the footprint-matched level and putting it through
   the 0.5 test dissolves the canopy — 51 % → 20 % fill, with the survivors MORE speckled than the point
   sample (17.9 %). The mip supplies COLOUR; the cutout decision stays at the base level and the sub-samples
   vote on it `S²` times per texel. That is the whole of `sample()`'s split, and it is commented there.
2. **The mip chain is built over CUTOUT alpha (0/255), not raw alpha.** `downsample` weights colour by alpha,
   so a leaf's sub-threshold edge texels — dark, and never drawn — were pulling the mean down: −6 green on
   `tree7vbig`. Binarising the alpha the chain is built from is what put the colour back.
3. **The old metric stops working the moment alpha is continuous.** "Isolated opaque texel" RISES (6.0 →
   10.9 %) because antialiased neighbours fall below 128, and the atlas mean RGB FALLS because the bright
   tail it was measuring is the defect being removed. The measures that survive are canopy MASS (unchanged,
   so the canopy was redistributed and not thinned) and the median luminance (42 → 42, 64 → **67**: the bake
   is if anything lighter at the middle). Both are in the census script now.

Stage cost, measured on the `sa` build rather than extrapolated: `trees` **83.4 s → 268.4 s (×3.2)** for 184
impostors over 9 825 tree instances. The first extrapolation here said "~9–10 min" and the first build said
32 min — both wrong, and the gap was a defect of step 01's own: the chain was wrapped per TREE while the stage
hands one folder-wide texture map to all of them (fixed by memoising it on the texture; the atlas is unchanged
to the digit).

Settled by measurement: `superSample` defaults to **2**, not the 4 the plan opened with — 4 buys 1.1 → 0.5 %
and 0.4 → 0.1 % for ×25 the bake instead of ×7.1 (stage ~2 min → ~9–10 min at 2, ~35 min at 4). `--ss` is a
CLI flag, so step 05's field round can raise it without a code change. **Still open for the field**: on the
`sa` target the sorted pass alpha-tests at reference 100, so partial coverage at a canopy edge is DISCARDED
rather than faded — that is why `canopyFill` fell while the mass did not, and whether the gamma atlas wants
re-thresholding is the question step 05 puts in front of the user.

Also landed: 6 rings of colour dilation per TILE (never across the finished atlas — a card may not bleed into
its neighbour), and `rw-codec`'s `endpoints()` now fits over visible texels for every format with an alpha
channel: worst green error on a canopy-edge block **26 → 10** (BC1's own ramp is the remaining 10).

### 02 — one class, one draw, wind

- `buildLodIde` already takes `flags`; the placement stage passes `DEFAULT_FLAGS | (sourceFlags &
  (IS_TREE | IS_PALM))` per impostor, derived from the HD row it replaces — nothing per model name. On the
  `sa` target the bit is harmless on a 16-triangle card (SA's sway is a vertex shader on the vegetation
  pipeline; check `CCustomBuildingDNPipeline` / the vegetation flag path in gta-reversed before assuming, and
  record what it does to a LOD there).
- `buildCardGeometry` emits ONE winding per card; the row's `DISABLE_BACKFACE_CULLING` does the rest in both
  engines (verify on the `sa` target with the one-model swap, `scripts/debug/img-patch.ts`, not a rebuild).
- `docs/contracts/` does not change (no new name); `docs/edge-cases/converter-pipeline.md`'s "16-triangle
  impostor" line becomes 8.
- **Done when** the viewer welds `lodsm_veg_tree5` CUTOUT (the weld stats say so) and it sways.

#### 02 — BUILT 2026-08-21 (the weld/field confirmation rides with the next build)

- **The row inherits the bits, and nothing is per model name.** `sourceObjectRows` (was `sourceObjectIds`)
  now returns the FLAGS of every gta.dat IDE row that defines a source tree beside its ids, OR'd when a model
  is defined more than once — a mod's duplicate row without the bits cannot strip what another row grants.
  `lodVegetationFlags(sourceFlags)` (`map-placement/ide.ts`) = `DEFAULT_FLAGS | (sourceFlags & (IS_TREE |
  IS_PALM))`, and `buildLodIde` takes a per-model flags map because each impostor replaces a different row.
  Measured on the integration game-dir: HD `0x202084` → LOD row `2105476` (was `2097284`), HD `0x204084` →
  `2113668`, HD `0x200048` (double-sided + additive) → unchanged. Both output shapes carry it (`--out` and
  `--modloader`).
- **One winding per card**: `sm_veg_tree5`'s LOD goes **16 → 8 triangles**, its DFF 2 844 → 2 684 B. The row
  already carries `DISABLE_BACKFACE_CULLING` and both engines read it — real SA on the model info, OpenSA at
  `weld.ts:1015` — so the mirrored copy was never a second face, only the same one drawn twice (and in a
  blend path with no depth write, composited twice).
- **The `sa` half of the flag was checked before it was written, not after**: SA's sway is
  `CEntity::ModifyMatrixForTreeInWind`, called from `PreRender` on `SwaysInWind()`, and it shears the
  entity's matrix `at` vector rather than the vertices — the plan's own note guessed "a vertex shader on the
  vegetation pipeline". Recovered from gta-reversed and recorded as
  [`docs/gta-sa-original/tree-wind-sway.md`](../../../../docs/gta-sa-original/tree-wind-sway.md): the bit
  costs the same on an 8-triangle card as on the tree, and `IS_PALM` adds its own wind term on top.
- **The build found the half this step MISSED, and it is the bigger half.** In the built `lodtrees.ide`:
  **67 rows gained `IS_TREE`, 10 `IS_PALM`, and 107 of 184 gained nothing** — because their stock HD row
  carries no vegetation bit either. On the `sa` target that is correct (SA reads only flags, so HD and LOD
  behave alike). **In OpenSA it is not**: `swayKindFor` falls back to a NAME list (`@opensa/game`'s
  `WIND_MODELS`), and **105 of those 107 sources are on it** — so the tree swayed and welded CUTOUT while its
  own impostor, named `lodash1_hi`, stood still in a soft-blend pass. Fixed in `packages/cell-weld`: a model
  whose own name misses the list is asked again with a leading `lod` stripped, which is the same rule as the
  flags inheritance — the LOD is whatever its source is. Covered by `isVegetationDef` tests, including that
  a stock building LOD (`lodger01_law`) does not become vegetation.
- **What is NOT verified yet, and honestly**: the "done when" of this step is a weld statistic and a field
  look, and both need a build that carries the new `lodtrees.ide` — no pmb run has happened since. The
  mechanism either side of the row is unit-tested (`lodVegetationFlags`, the emitted row per output shape,
  `swayKindFor`/`isVegetationDef` reading the same bits), so what remains is confirmation, not design. The
  cheap `sa` check the plan names (`img-patch.ts` with one re-baked impostor DFF) is worth spending in the
  same round as step 03's field pass rather than alone.

### 03 — density, measured before it is decided

- Instrument: a headless pair of renders per tree (HD vs LOD, the viewer's `?lod=` with a fixed pose) from 8
  azimuths at 2 distances (the switch, 2× the switch), metric = mean luminance over the canopy's screen box
  and its covered fraction. `tools-debug/bench-harness/` drives it; `docs/development/benchmarks.md`.
- Candidates, all tool-side: 4 cards (today), 2 cards (SA's own impostors are an X — confirm on a stock
  `lod*` vegetation DFF before writing it down), and 4 cards with per-card coverage divided by the expected
  visible stack. Each is one `--cards` / one rule; the numbers pick.
- **Done when** a table in `docs/benchmarks/` shows covered-fraction and luminance per candidate against the
  HD, and the chosen rule is the one nearest the HD on both — or none is within 10 %, which is phase B's go.

#### 03 — MEASURED 2026-08-21: 4 cards stay, and phase B is NOT gated in

Numbers: [`docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`](../../../../docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md) §
"Step 03". Instrument: `scripts/debug/impostor-density.ts`.

**Not the viewer pair this step opened with, and the swap is deliberate.** The HD mesh and the card cage are
rendered from the SAME poses by the same software rasteriser the bake uses, 16 azimuths at the size a tree
really has on screen (~64 px tall at the 150 u switch, ~32 px at twice it). It needs no build, it is
deterministic, and it isolates the geometry — the viewer pair would have measured the engine's shading at the
same time, and every run of it costs a ~50 min pak. The viewer pair is still what step 05 shoots for the
field verdict; this is what PICKS the rule.

| mass vs the HD's | `sm_veg_tree5` | `sm_veg_tree7vbig` |
| --- | ---: | ---: |
| 4 cards (today's rule) | **×0.97** | **×0.86** |
| 2 cards | ×0.77 | ×0.75 |
| per-azimuth spread, 4 cards | 0.94..1.05 (HD 0.92..1.06) | 0.97..1.03 (HD 0.97..1.03) |

- **4 cards is the rule.** It is inside 10 % on `tree5` and 14 % UNDER on `tree7vbig`; 2 cards is 23–25 %
  under on both. No coverage-divided variant was needed — nothing is over-covering to divide.
- **Phase B (04) is not justified by density.** The metric a view-weighted impostor exists to remove is the
  angular SWING, and the cage's is already the tree's own (0.94..1.05 against 0.92..1.06). The gate this step
  wrote — "none within 10 %, which is phase B's go" — did not fire.
- **Cause 1 was mostly cause 3.** The configuration the field reported on measured **×1.59** and **×1.47** the
  HD's canopy mass; of that 1.59, the CLASS is most (blend → cutout is ×1.24 → ×0.97 on the same cards). The
  plan's opening `1 − 0.45⁴ ≈ 96 %` assumed the four cards' opaque texels are independent — they are four
  projections of the same canopy, so their union is nothing like that.
- **The field corrected the scope of this step the same day.** On the `sa` build the user's verdict was
  "about the same", and the instrument in SA's own class says why: SA composites the crossed cards in its
  sorted pass whatever the flags say, so 4 cards are ×1.24 / ×1.15 the HD's canopy mass there (against
  ×0.97 / ×0.86 in OpenSA's cutout class), and what the build moved was ×1.59 → ×1.24. In the blend class
  **3 cards** measure ×1.07 / ×1.04. So the card rule is per TARGET: 4 where the class unions them, 3 (or a
  view-weighted 4) where it stacks them — and **the sa half of phase B has a measured justification now,
  which the OpenSA half does not.**
- **What the numbers now say to watch is the other direction**: `tree7vbig`'s LOD is 14 % THINNER than its HD,
  and on the `sa` target partial coverage below reference 100 is discarded rather than faded, which thins it
  further. That is the same field question step 01 left open, and it now has a second reason to be asked.

### 04 — phase B: one projection from every angle (OpenSA) — NOT BUILT

**Superseded by step 06 (2026-08-22).** Both halves lost their justification in measurement: OpenSA's cutout
weld already lands at ×0.97 of the HD with an angular swing equal to the tree's own, and the `sa` half got
the same parity out of the DATA — a second cage of 3 cards thinned per tree — instead of out of a draw-time
weight. The `asi/perfect-vegetation` scaffold that was to carry the `sa` half is REMOVED at the user's call
(2026-08-22); what it was, what killed it and the field trigger that would revive it are in
[`docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md`](../../../../docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md).
The design below is kept as written for whoever picks the angular question up again — for OpenSA it is the
material class, which is where the engine work would live.

The honest answer to cause 1 is a view-dependent impostor, and our engine can have one where RenderWare
cannot (`docs/project-goals.md` §2–3): the cards stay, each card's vertices carry its PLANE normal (authored by
the bake, not rebuilt by the cell bake — a weld rule for this material class), and a `billboardSet` material
scales each card's alpha by a normalised weight of `|n · viewDir|` so the cards facing the camera carry the
coverage and the edge-on ones fade — the sum over the set stays ≈ one projection. 16 vertices per tree; the
term is per-vertex. The `sa` target keeps 03's rule.

- **The `sa` target could have had it too — by ASI, never by CLEO** (his question, 2026-08-21): a CLEO
  script has no reach into an atomic's draw, but an ASI does. The shape — four cards as four MATERIALS of
  ONE atomic, a wrapped `RpAtomic` render callback writing each card's `RpMaterialColor` alpha from its
  `|n · view|` weight, wrapping the SkyGfx fork's callback rather than replacing its pipeline — was
  scaffolded as `asi/perfect-vegetation` and REMOVED on 2026-08-22 before a single exe site was read, once
  step 06 reached the same parity in the bake. Recovered in full in
  [`docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md`](../../../../docs/postmortem/asi-perfect-vegetation-view-weighted-cards.md).
- Gate: 03's numbers. Frame budget: no measurable change on the Ganton lap (`docs/benchmarks/` frame-cost
  family) — state the number.
- Docs in the same change: `docs/architecture/` (a new material class), `docs/features/` (vegetation LOD),
  `docs/restrictions/assets-and-data.md` if the authored-normal rule is silent when violated (it is — a
  rebuilt normal just makes the card lit like a wall again; say what catches it).

### 05 — close

Field verdict from the driver's seat at the switch distance on the `opensa` build (and the `sa` bottle for
01/02), the before/after pair in `docs/benchmarks/`, this file's ledger filled per step, the tool readme's
plan list extended, `docs/plans/README.md`'s chain row (it still reads `001`–`005`, `007`).

#### 05 — the numbers, off the BUILT trees (2026-08-22)

Both targets were rebuilt this morning; everything below is read from the shipped bytes rather than from a
bake-time probe. Full file:
[`docs/benchmarks/tools/2026-08-22-lod-trees-013-on-the-built-trees.md`](../../../../docs/benchmarks/tools/2026-08-22-lod-trees-013-on-the-built-trees.md).

- **The per-target cages are in the archives**: every impostor is **6 triangles** in `sa`'s `gta3.img` and
  **8** in `opensa`'s (16 before this plan).
- **The classification is 182 of 184 impostor rows**, against 67 without step 02's `lod`-strip retry — and
  **0** rows match the wind list under their own name, which is why the retry had to exist at all. The two
  that classify as nothing are `loddead_tree_13` / `loddead_tree_14`, whose HD rows carry no bit either.
- **The pak welds the cage CUTOUT**: 49 820 triangles on the tree atlas across the 562 LOD cells, every one
  `pipelineClass 1`, none in blend — 6 227 impostor instances. Cause 3 is closed on the shipped data.
- **Sway reaches the LOD layer**: 425 of 562 LOD cells carry the SWAY channel against 435 of 562 HD.
- The `lod=0` / `lod=1` viewer pair is a LOOK check only, and the benchmark says why: it renders the SA cage
  through OUR cutout class, so it under-reads cards thinned for SA's ref-100 blend pass by construction.
- OpenSA in the engine for the first time on this plan: 8.1–8.3 ms frames (120+ fps), 938–1 057 draws. Not an
  A/B — the previous pak was rebuilt in place, so there is no before-frame.

#### 05 — the verdict, 2026-08-22: ACCEPTED on both targets

He delivered the `sa` build to the reference bottle, drove it, flew a helicopter over it, and looked at the
`opensa` build too. **"Definitely better on both — the LOD→HD transition is much less noticeable, and I saw no
defects."** That closes the plan: the report it opened with (*"the LOD is a solid dark mass where the HD is an
airy canopy"*) no longer describes what the field sees.

The one crash of that session (`0x007F0BF7`, twice, while flying) is NOT this plan's: it is a tuning-part
frame lookup, it stops when `ModelVariations` is removed, and it has its own work item.

**Deliberately not claimed**: nothing here says the impostor is indistinguishable from its HD, only that the
switch stopped announcing itself. The angular question phase B existed for was never re-opened by the field —
which is the condition the postmortem records for reviving it.

### 06 — one cage per class, and the alpha comes from the tree

**Why it exists**: the `sa` field verdict on the 01+02 build was "about the same", and the instrument in SA's
own class said why — SA composites the crossed cards in its sorted pass whatever the IDE flags say, so the
cutout union that puts OpenSA at ×0.97 never happens there. At SA's own reference (100, not the bake's 128)
four cards measure **×1.36 / ×1.30** the HD's canopy mass.

**What it does**: the bake emits TWO cages per tree.

- The built tree carries the real-SA one: `blendCards` (3) cards, each thinned so the COMPOSITE covers what
  the HD covers. Three rather than four for two measured reasons — at reference 100 a thinned texel is
  DISCARDED rather than faded, so the scale has a floor (four cards need ×0.75 and ×0.65 collapses the canopy
  to ×0.59, while three need ×0.85 and keep a texel alive down to alpha 118), and three blended cards are a
  quarter fewer blended fragments per tree LOD.
- `opensa-dff/` carries the OpenSA one: `cards` (4) at full alpha, which its cutout weld unions to ×0.97.
  `perfect-map-builder` swaps it into the opensa `gta3.img` by entry name, beside the linear TXD that has
  ridden there since plan 012.

**The alpha is SOLVED, not fitted** (`core/card-alpha.ts`): per tree, the bake renders its own HD from
between two cards at the size the tree has on screen at the switch (64 px), then bisects the card alpha until
the composited cage covers the same. Measured: `sm_veg_tree5` 0.858, `sm_veg_tree7vbig` 0.856, `ash1_hi`
0.832, `pinetree04` 0.807 — each landing its own composite at **×1.00**, where a single global constant would
have left every tree a few percent off its own canopy. ~1.2–1.7 s per tree on top of the two bakes; no
`docs/hacks/` entry, because nothing was fitted.

**Runtime**: `sa` gets CHEAPER than before this plan — 6 triangles per impostor instead of 16 and three
blended cards instead of four; OpenSA is unchanged at 8 triangles. Neither atlas changes size (DXT5 at a
fixed resolution), so nothing is added to streaming.

## Out of scope, deliberately

- **The trunk's crossed planes at HD range.** Four trunks crossing is what a crossed-card impostor IS; at the
  switch distance it is sub-pixel. Phase B's fading hides it for free; nothing else is spent on it.
- **A mid LOD** (a decimated mesh between 4 065 triangles and 8). `docs/edge-cases/converter-pipeline.md`
  names the gap; it is a different plan with its own budget.
- **The `vegetation/` HD models' own look** (the mod's prelit, its textures) — plan 007's `--prelight` is the
  standing answer; this plan only makes the LOD match whatever the HD is.
