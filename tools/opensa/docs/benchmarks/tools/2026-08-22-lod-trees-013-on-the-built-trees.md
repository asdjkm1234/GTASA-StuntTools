# 2026-08-22 — lod-trees 013 measured on the BUILT trees (both targets, step 05)

**Tool:** `lod-trees-generator` (plan 013 steps 01/02/03/06) + `cell-weld`, read off the trees built this
morning — `build/original/sa` (10:20) and `build/original/opensa` (09:57), repo at `efe28767`.
**Why this file:** every earlier number of this plan came from the bake-time probes. These come from the
shipped bytes, which is the only place the two halves of step 02 and the two cages of step 06 meet real data.
Build durations are their own file (`2026-08-22-pmb-both-targets-after-013.md`).

## What each target's impostor IS, in the archive

| | `sa` (`gta3.img`, `.dff`) | `opensa` (`gta3.img`, `.osm`) |
| --- | --- | --- |
| `lodsm_veg_tree5` | **6 tris**, 1 material, 12 verts, night colours | **8 tris** (24 indices), 16 verts |
| `lodash1_hi` | 6 tris | 8 tris |
| `lodpinetree04` | 6 tris | 8 tris |
| `lodsm_veg_tree7vbig` | 6 tris | 8 tris |

3 thinned cards for real SA, 4 full-alpha cards for OpenSA — the per-target rule of step 06, in the shipped
files. Before this plan both were 16 triangles (4 cards × 2 windings).

## The vegetation classification, on the built `lodtrees.ide` (184 rows)

| rule | rows |
| --- | ---: |
| carry `IS_TREE` / `IS_PALM`, inherited from the HD row (step 02, first half) | **67** |
| in the wind list under their own `lod…` name | **0** |
| in the wind list with a leading `lod` stripped (step 02, second half) | **181** |
| **classify as vegetation today** | **182 / 184** |
| would classify without the `lod`-strip retry | **67 / 184** |

The 0 in the second row is the whole argument for the second half: name matching contributed **nothing**
before the strip, because a generated impostor is never called what its source is called. The two rows that
match neither rule are `loddead_tree_13` and `loddead_tree_14` — dead trees, whose HD rows carry no
vegetation bit either, so a still LOD is what their own data asks for.

## What the OpenSA pak welded (562 LOD cells)

**The tree atlas (world array 14, 512², 252 layers) in the LOD layer: 49 820 triangles, every one of them
`pipelineClass 1` (CUTOUT), none in blend.** That is step 02's OpenSA half on the shipped pak — before it,
an impostor row carried no vegetation bit and `isVegetationDef` was false, so the cage welded soft-blend
(class 2) while its own HD welded cutout. 49 820 / 8 = **6 227 impostor instances** across the layer.

The layer as a whole, for scale:

| class | groups | triangles |
| --- | ---: | ---: |
| 0 opaque | 6 516 | 10 885 348 |
| 1 cutout | 1 856 | 834 863 |
| 2 blend | 777 | 727 288 |
| 3 beam | 170 | 51 284 |
| 4 additive | 77 | 23 269 |

**Sway reaches the LOD layer at HD parity**: cells carrying the `SWAY` vertex channel are **425 of 562 LOD**
against **435 of 562 HD**. The LOD layer stands still in 10 cells where the HD sways — the plan's "the HD
sways and the LOD stands still beside it" is otherwise gone.

## The rendered pair — a LOOK check, and not a parity number

`sa-map-viewer` at one pose, `lod=0` against `lod=1`, camera 122 u from two `sm_veg_tree*` (a 400×170 px box
around them, canopy = every non-sky pixel):

| | covered | mean RGB | luma |
| --- | ---: | --- | ---: |
| HD (`lod=0`) | 47.1 % | 45/52/42 | 49.8 |
| impostor (`lod=1`) | 37.9 % | 38/43/29 | 40.8 |
| ratio | **×0.805** | — | ×0.82 |

**Read that ×0.805 as an instrument artefact, not as the cage.** The viewer renders SA-format data through
OUR classes: the impostor row carries `IS_TREE`, so it welds CUTOUT — and the cards it is showing are the
**SA** set, thinned for SA's ref-100 sorted BLEND pass. A thinned card under a cutout test loses exactly the
texels the thinning added, so this instrument under-reads that cage by construction. The honest per-target
numbers stay the bake probes': OpenSA's 4 cards ×0.97/×0.86, real SA's 3 thinned cards ×1.00.

What the pair IS good for: the canopy reads as an **airy canopy with sky through it at the right silhouette**
— the "solid dark mass" the plan opened with is gone at that distance — and the LOD sits a touch darker and
browner than the HD (the blue channel is where it drops, 42 → 29).

## OpenSA in the engine, for the first time on this plan

`engine-lab` streaming the new pak, noon, `draw=1500`:

| pose | frame | GPU pass | cells visible | draws | residency |
| --- | ---: | ---: | ---: | ---: | ---: |
| `at=1050,276,20 orbit=140` (HD range) | 8.33 ms (120 fps) | 2.79 ms | 43/147 | 1 057 | 1 402.8 MB |
| `at=1172,276,25 orbit=260` (impostors in frame) | 8.12 ms (123 fps) | 3.60 ms | 48/148 | 938 | 1 412.7 MB |

**Not an A/B**: the previous `opensa` pak was rebuilt in place, so there is no before-frame to diff against —
the numbers are a floor for the next comparison, not a verdict on the plan's cost. What they do say is that
the layer is not expensive: the impostors in frame draw as cutout, the frame sits at 8 ms on this machine.

## The field verdict — ACCEPTED, both targets, the same day

The user delivered the `sa` build to the reference bottle, drove it and flew a helicopter over it, and looked
at the `opensa` build as well: **"definitely better on both; the LOD→HD transition is much less noticeable; no
defects seen."** Plan 013 closes on that. Nothing above replaces it — every number here says the data is what
the plan intended, and none of them could have said the switch stopped announcing itself.

(The two crashes of that session were a tuning-part frame lookup, `0x007F0BF7`, which stops when
`ModelVariations` is removed — a separate work item, not this plan's.)
