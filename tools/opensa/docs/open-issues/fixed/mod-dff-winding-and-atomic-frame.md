# Two DFF-geometry parity bugs: winding from the wrong array, and a frame SA discards

Two issues in one file because one field report ("a flat light-blue strip on the Santa Maria beach lane,
and `land_42_sfw` positioned wrong") turned out to be two independent converter bugs found by the same
investigation. Neither is a data bug: both models are legal SA that the real game renders correctly.

- **Issue 1 — a mod DFF renders INVISIBLE** (`roads32_law2`): we take the winding from the Geometry
  Struct face array; RenderWare draws the BinMeshPLG index data. See *Cause 1* below.
- **Issue 2 — a model sits in the WRONG PLACE** (`land_42_sfw`, and vanilla `aw_streettree1` /
  `grassplant` all along): we apply the atomic's own frame transform; SA throws it away for simple map
  models. See *Cause 2* below.

**Status: BOTH FIXED 2026-07-30 by [plan 095](../../plans/095-dff-geometry-parity/readme.md)** — the parser
now reads the drawn index data, and the weld applies a frame transform only where SA would. Field-verified in
sa-map-viewer: at the strip the vanilla frame is byte-identical before/after (RMSE 0) while the merged frame
changes by 0.0454 and its distance to vanilla drops 0.0689 → 0.0518; the road slab runs to the frame edge
again. Both rules are now in
[`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md), and
`scripts/debug/scan-geometry-parity.ts` detects either family on demand.

This file is kept whole because it is the forensic record: the 07-29 half lists every probe that came back
clean (do not re-run them), and the 07-30 half explains why they had to.

## 2026-07-30 (b) — the two root causes

Measured against the user's two `--no-optimizer` builds (`build/pure`, `build/pure+mods`) plus the
merged SA-format tree `build/strip-ab/mods`. `0. Map Fixes Pack` ships exactly two of the three models:
`gta3_img/roads32_law2.dff` and `gta3_img/land_42_sfw.DFF`. It does **not** ship `roads33_law2.dff`,
and it does not touch their IDE/IPL rows (its `law2.ide.merge` only re-flags `venice03Tr_laW2`; its
`LAw2.IPL.merge` only sinks two `tree_hipoly` rows to z = −1000).

### Cause 1 — `roads32_law2` invisible: we read the winding from the WRONG array

A DFF stores its topology twice: the Geometry Struct's face array (`[v1, v0, matId, v2]`) and the
BinMeshPLG index data. **RenderWare draws the BinMesh data; the face array is authoring input.** Our
parser does the opposite — `readTriangles` (`packages/renderware/src/parsers/binary/dff.ts:756`) builds
the triangles from the face array, and BinMeshPLG is only read to key material indices
(`dff.ts:109-135`). When the two disagree, we render the mod's mesh inside-out.

Measured, same 93 triangles / 146 verts / identical bbox / identical prelit + night sets in both trees:

| order | vanilla | Map Fixes Pack copy |
| --- | --- | --- |
| Struct face array (what WE build) | up 65 / down 0 | **up 0 / down 65** |
| BinMeshPLG draw order (what SA draws) | up 65 / down 0 | up 65 / down 0 |

The 65 up-facing triangles are the road slab. The mod re-export also changed the mesh from a tristrip
to a triangle list, added vertex normals (`+1752 B` = 146 × 12), dropped the vanilla pipeline-set chunk
`0x253F2FD` and added MatFX markers (`0x120` on the atomic, `0x105` in the geometry extension) — but
none of those matter; the winding does.

Why it goes invisible rather than dark: the model's IDE flags are `1`, so
`IdeFlag.DISABLE_BACKFACE_CULLING` (`0x200000`) is clear → the weld routes it single-sided
(`packages/cell-weld/src/weld.ts:971`) → `world-opaque-front` is `cullMode: 'back'`
(`packages/engine/src/render/pipelines.ts:167`, `:701`). Collision comes from the COL, which nobody
touched, so the slab stays walkable and the viewer still focuses its instance — exactly the reported
symptom. This is why every data-level probe of 07-29 came back clean: the bytes ARE equivalent, the
*orientation we derive from them* is not.

**Blast radius (whole merged map, 11 474 placed HD models parsed): 4 models, all mod-introduced**
(vanilla disagreement = 0 for every one of them):

| model | faces inverted | instances | at |
| --- | --- | --- | --- |
| `Roads32_LAw2` | 130 / 93 | 1 | 245, −1737, 4 |
| `ap_radar1_01` | 86 / 2740 | 4 | −1692, −620, 30 |
| `laebridgeb` | 36 / 252 | 1 | 1929, −1027, 29 |
| `Lae2_roads17` | 2 / 111 | 1 | 2343, −1683, 12 |

(`Lae2_roads17` is the plan-024 Family A model — its 2 faces are a separate, tiny instance of the same
bug.)

### Cause 2 — `land_42_sfw` in the wrong place: we apply a frame transform SA throws away

The mod's copy puts a **90° rotation about Z on the atomic's own frame** (frame 0, `rot = [0,−1,0,
1,0,0, 0,0,1]`, pos 0,0,0); vanilla's frame 0 is the identity. Its geometry is otherwise identical
(166 verts, 142 tris, same bbox, same prelit — plus the same added normals, and its winding is FINE).

We apply that transform: `weld.ts:984` calls `frameWorldTransform`, and `appendInstance` multiplies
every position and normal by it before the instance matrix. The real game does not — for a simple
(atomic) map model `CFileLoader::LoadAtomicFile` → `SetRelatedModelInfoCB` does
`RpAtomicSetFrame(atomic, RwFrameCreate())`, i.e. **every atomic gets a fresh identity frame**; only
`LoadClumpFile` (peds, vehicles, animated clumps) keeps the hierarchy (gta-reversed, `FileLoader.cpp`).
So the tile is authored against a game that ignores the rotation, and we spin it 90° — a near-square
terrain tile, so the bbox barely moves (which is why `model-bbox` and the pak bounds looked innocent)
while the relief lands wrong and the tile reads as displaced/floating.

**Blast radius:** 41 placed models have a non-identity ATOMIC frame (the 189-model first count was
noise — `Omni*` 2dfx light frames are never rendered). 8 differ from vanilla, and only `land_42_sfw`
is a mod-added pure rotation over a vanilla identity; the rest are frame-INDEX shuffles (f1↔f2, same
transform) or sub-metre pos deltas.

**The COL is the oracle, and it agrees with the reversed source.** A COL is authored in the same space
SA renders — no frame transform — so for each model the version (with frame / without) that matches the
collision bounds is what the game shows. Summed corner mismatch against the COL box, for every model
whose kept atomic IS its own geometry:

| model | instances | with frame | without frame | verdict |
| --- | --- | --- | --- | --- |
| `aw_streettree1` | 165 | 6.76 | **0.01** | drop |
| `grassplant` | 44 | 14.66 | **0.00** | drop |
| `hbgdSFS` | 1 | 43.52 | **0.00** | drop |
| `land_42_sfw` | 1 | 8.15 | **0.00** | drop |
| `aw_streettree2` | 3 | 9.59 | **0.01** | drop |
| `Gdyn_barrier17` | 26 | 10.86 | **0.82** | drop |
| `lhouse_barrier1` | 10 | 8.23 | **0.57** | drop |
| `lhouse_barrier3` | 7 | 5.06 | **0.58** | drop |

So this is not only a mod bug: **we have been sinking 165 vanilla `aw_streettree1` by 3.1 m** (its frame
is `POS(-0.2,-0.1,-3.1)`) and displacing 44 `grassplant` ever since the welder started applying frames.

### Found on the way — a THIRD parity gap, not fixed here: SA keeps ONE atomic

`SetRelatedModelInfoCB` calls `mi->SetAtomic(atomic)` for **every** atomic of the clump into the same
single slot (`_dam`-suffixed frames go to the damaged slot instead), so a simple map model ends up
with only the LAST atomic; the others are dropped. We weld them all. Measured over the merged map:
**41 multi-atomic placed models, 47 894 welded triangles over 82 instances that SA never draws** — the
`sprasfw` building's stray `xenonsign_SFw` (1772 tris), `desn2_stripsigs1`'s `des_cowtail` (17 163),
`des_bigbull`'s `des_bulltail` (4226). In 29/41 the last atomic's frame is named exactly like the
model, which is why the surviving picture looks right.

**Do not "fix" this by simply keeping the last atomic:** the set includes ANIMATED models (`nt_windmill`,
`derrick01`, `nt_noddonkbase`, `a51_radar_scan`) whose extra atomics are the moving parts. Those are
`anim` IDE entries — SA loads them with `LoadClumpFile`, which KEEPS the hierarchy — and our weld
already routes their parts to the live-entity path. Any fix must be gated on the IDE section, which is
why it is a separate follow-up rather than part of plan 095.

### The control that confirms both — `roads33_law2` (400.7, −1753.3, 6.5) renders FINE

The slab immediately east of `roads32_law2` along the same beach lane (roads32 spans x 151…339,
roads33 x 334…464) is visible in `build/pure+mods`, and its data carries **neither** defect: its DFF is
byte-identical between vanilla and the merged tree (18 432 B, sha1 `9c7eb621ff6a`), no mod ships it, its
face-array winding agrees with its BinMesh order, and its atomic frame is the identity. The scan
predicted "clean" before the field said "visible" — so the two families above account for exactly what
is broken and nothing more. Keep it as the A/B control for any fix: whatever changes must leave
roads33 pixel-identical.

## 2026-07-30 — what sa-map-viewer proved (plan 094 phase 6)

The A/B the tool was built for, run at last: vanilla `game-src/original` against a mod-merged SA-format
tree (`pmb --until mods` → `build/strip-ab/mods`, 59 mods), both at `?at=150,-1700&h=150`, one cell each.

- **The strip is `roads32_law2` (txd `law2_roadsb`, instance 245.2, −1736.7, 3.6) failing to draw.**
  Clicking it in the vanilla tree and pressing `Hide object` reproduces the merged picture EXACTLY — the
  same flat light-blue area, the same sharp polygon edge along the grass, the same props left floating
  over it. In the merged tree, hiding it changes the crop by **mean 0.013/255**: it was already
  contributing no pixels. So the blue is not a surface painted blue — it is the background where a road
  slab should be.
- **Every piece of data behind it is equivalent between the trees**: the IPL instance (id 6428, HD, same
  position) and IDE row (draw 150, flags 1, same txd); the DFF (146 verts / 93 tris / same bbox / same two
  textures — the Map Fixes Pack copy only adds normals); the node-side weld of cell 0,−7 (93 tris, bucket
  array 0 / opaque / single-sided, welded box equal to 2 decimals); the assembled `.oscell` group (#0,
  offset 0, count 2106, identical bounds; the road's 65 triangles identical, none degenerate); and the
  textures through `TexturePlanner` (opaque, same array/layer, mean pixel within 2/255).
- Two side findings from the same probes: a mod sinks `sm_bushvbig` to **z = −300**, which blows the
  merged cell's bounds out to `59.6, −115.5, −0.1, 290.9` (vanilla `59.6, 9.7, −0.1, 232.4`); and 11 props
  (palms, benches, a bush) are removed from that cell by mod IPLs.

Full tables + the instruments: [`plans/094-sa-map-viewer/readme.md`](../../plans/094-sa-map-viewer/readme.md)
phase 6.

## Field reports (user, after the 024/093 rebuild — build 10:53+vehicles)

- Santa Maria beach lane: a flat light-blue strip where road/ground should read, running along the
  beach-house row. Named refs: `pier01_law2` (2335,-1712), `bealantr03_law2` (232,-1692),
  `bealantr02_law2` (136,-1715) — those are the visible NEIGHBOURS (the bealantr are vanilla-shaped
  bush-only models, "Tr" = trees, NOT transitions).
- `land_42_sfw` (-2318,1280) "positioned wrong" — visually; its pak weld is byte-correct.

## Established facts (each one measured, scripts in the session log)

1. **Reproduces in the engine-lab viewer** (`:4300 ?pak=1&at=180,-1680,50&orbit=70`) against BOTH
   the main pak and a `model-repack.ts` rect lab. Small flat light-blue patch ≈ (125..180,
   -1725..-1685), sharp polygon edges, a lamppost STANDS on it; srgb ≈ (134,162,198) at noon.
2. **Street level is fine**: headless game shots at 290,-1690 (day + night) show road underfoot,
   grounded z 7.2. The user's screenshots are high-camera views.
3. **The pak data is clean** — exonerated one by one: instances complete vs vanilla (only stripped
   lod + props differ, by design); placements present; tri counts = source (roads03 114/114,
   bealand01 120/120, pier01 983/986); welded world positions exact (land_42 bbox matches
   instance+source to 0.1); pipeline classes opaque/cutout as expected; group bounds sane; texture
   arrays' layer hashes match the models' texture names; the layers' PIXELS average
   gray/green (desgreengrass 81/97/57, roads31/32 layers 114/113/105 and 152/158/156); no >255
   layer overflow (arrays cap at 256, layer field is 8-bit by design); `manifest.missingLayers` has
   4 entries, none blue; cells' texture refs all valid; `objects[]` empty in the cells.
4. **The optimizer chain is exonerated**: `model-repack --raw` (source bytes, no chain) reproduces.
   The 024 gate touched NOTHING in these cells (all area models ship no normals → `created`, the
   path every earlier build ran).
5. **Vanilla-resolve lab is clean** (`--raw --no-mods`): the strip shows the vanilla road. So a
   MOD-RESOLVED asset triggers it. BUT the single-file bisect (`--mod-only roads32_law2`) verdicts
   were INVALIDATED: the lab's orbit camera phase differs per run, so fixed-pixel probes compared
   different world spots — the patch is visible in ALL mod-resolve shots regardless.
6. **Water: rows 118/119/184 of the BUILT `water.dat` are MOD-ADDED** (absent in vanilla): quads at
   z=0 reaching x≤140 across y −1552..−1792 — 79 baked verts sit in the strip box. **BUT a lab
   without `water.bin` still shows the blue patch** → the visible blue is NOT the water pass (the
   mod rows remain suspicious data — z=0 under terrain, harmless in real SA).
7. Side find, separate issue: `21. Wind Project` `bealantr02` bushes carry **sway amplitude up to
   24 (metres!)** in the welded sway channel — absurd; worth its own look.

## Where to resume

- **Plan [094 — sa-map-viewer](../../plans/094-sa-map-viewer/readme.md) (PLANNED 2026-07-29) exists
  because of this issue**: a standalone viewer over ORIGINAL files with a fixed top-down camera —
  folder-swappable vanilla-vs-merged A/B with no repack and no orbit drift. Its Phase 6 is this
  bisect.
- **Kill the orbit for A/B**: fixed camera (orbit=0 / a static `at`+look param, or add one to the
  lab) so pixel diffs are valid; then re-run the file-level bisect (`model-repack --no-mods
  --mod-only …`, halving over the ~6 mod-shipped DFFs + txd events of cells 0,-7 / 0,-8 / -1,-7).
- Identify the surface authoritatively: the engine's placement PICK (debug), or render the lab with
  the debug unlit/normals view, or brute-force: delete placements one at a time from a lab cell
  (pak surgery) until the patch dies.
- Check whether the patch predates today's build (likely: the area was last eyeballed long ago; the
  gate/vehicles changes measurably did not touch these cells).
- Tooling gained this session (keep using): `model-repack.ts --raw / --no-mods / --mod-only / 
  LAB_NO_WATER=1`, the engine-lab orbit shots via `tools-debug/bench-harness/drive.js`, and the
  pak-side probes in the session transcript.
