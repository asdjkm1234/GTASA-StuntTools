# 092 — Alpha classification: the cutouts that are not vegetation

**Status: CLOSED 2026-07-29 — all four phases in one day.** Measured offline, implemented, packed,
field-confirmed on all three controls, and closed with the game's own formula recovered (which turned one
inferred design choice into a confirmed one). The class is baked, so every iteration that reaches the field
costs a re-pack — the rule was fitted offline first, and it took ONE build to reach the field.

## Symptom (field, 2026-07-29)

`wattspark1_LAe2` (txd `lae2tempshit`) at GTA (2309.4, −1433.0, 38.5) — the Watts Towers in LA-east. The
lattice cones read as a mess: the FAR side of a cone and the towers BEHIND paint over the near side. The
user's words: the background model comes out in front.

This is not a new class of bug. It is the same one the own-engine flip already fixed once, for trees only.

## The precedent

[074 readme](../074-opensa-engine/readme.md), 2026-07-12, item (3):

> **FOLIAGE → CUTOUT — trees-through-trees was blend-classed canopies writing no depth**: `classifyAlpha`'s
> 2 % mid-alpha bound mis-classes scanned foliage skirts; the welder now passes `preferCutout` for sway-kind
> (vegetation) defs, upgrading softBlend → cutout.

The follow-up a day later matters as much: upgrading a BROADLY semi-transparent canopy (α≈0.5 everywhere)
turns A2C into a uniform screen door, so upgraded textures are additionally SHARPENED (`SHARPEN_GAIN = 8`
around ref 128, `alpha.ts`) while natural cutouts are left alone. Any widening of the rule inherits that
trap.

The chain, in code:

| Step | Where |
| --- | --- |
| histogram → class (`opaque` / `cutout` / `softBlend`, cutout bound = mid ≤ 2 %) | `tools/opensa-pack/src/alpha.ts:11` |
| caller preference: `softBlend → cutout` **for vegetation only** | `alpha.ts:119`, `weld.ts:986` (`swayKind !== null`), `pack-map-objects.ts:99` (`isVegetation(def)`) |
| class → `.oscell` pipelineClass (`cutout` 1, `softBlend` 2) | `weld.ts:698` |
| pipelineClass 2 → `world-blend-*`, **`depthWriteEnabled: false`** | `packages/engine/src/render/pipelines.ts:690` |

So a soft-classed material writes no depth, and inside the blend bundle the triangles composite in
submission order. That IS the symptom.

## Measured before any code (2026-07-29)

**The object.** Its two lattice textures are DXT3 with a wide alpha gradient — nowhere near the cutout bound
(read out of the built archive, `build/original/sa/models/gta3.img`; identical in `game-src/original`):

| Texture | Format | mid-alpha | transparent | opaque | class |
| --- | --- | --- | --- | --- | --- |
| `wattsstax1_LAe` | dxt3 | **23.55 %** | 10.27 % | 66.17 % | softBlend |
| `wattsstax4_LAe` | dxt3 | **23.55 %** | 10.27 % | 66.17 % | softBlend |
| `wattsstax2/3_LAe`, `BLOCK2` | dxt1 | 0 % | 0 % | 100 % | opaque |

The cutout bound is 2 %; these sit 12× above it. They are materials 3 and 5 of the DFF (bbox z 2.4–19.9 and
2.3–31.3 — the cones themselves), so the whole visible tower is in the blend pass.

The def is not vegetation (`LAe2.ide` flags 0), so nothing upgrades it.

**Everything else was excluded first.** The stock far-LOD `LOD1wattspark1_LAe` is stripped from the built
IPL (392 rows vs the source's 409), and the welded HD cell at that point holds only `wattspark1_lae2`
(`dump-cell 2309.4 -1433`) — there is no second copy of the geometry. The class of the alpha is the whole
story.

**The map-wide census** (throwaway script over every TXD of `build/original/sa/models/gta3.img`,
40 230 textures decoded, 2026-07-29):

| Class | Count |
| --- | --- |
| opaque | 37 090 |
| cutout (already) | 599 |
| **softBlend** | **2 541** |

And the shape of those 2 541, which is what a rule has to separate (shares of texels; "opaque" = α ≥ 250,
"transparent" = α ≤ 5):

| Bucket | Count | What is in it |
| --- | --- | --- |
| transparent ≥ 5 % **and** opaque ≥ 30 % | **805** | the bug's class — `wattsstax*`, `chainlinkac1_128`, `kb_ivy2_256`, `Aascaff128`, `747_cage`, `railhi_64V` |
| transparent ≥ 5 %, opaque < 30 %, mid ≤ 50 % | 1 203 | mostly cutout-shaped too (`wire2`, `blackdirt`, `Cutlery`) but with NO fully-opaque texel — the sharpening trap lives here |
| transparent ≥ 5 %, opaque < 30 %, mid > 50 % | 183 | genuinely washed (`cs_rockdetail`, `railshadowdif`) |
| transparent < 5 % | 350 | true blends — `a51_glass`, `keypad_glass`, `cof_wind1`, `stanwind_nt`, `waterdirty256` — **must not move** |

`wattsstax*` lands in the first bucket (transparent 10.3 %, opaque 66.2 %). A rule reading the histogram can
reach it without naming anything.

**One hazard found while reading the planner.** `TexturePlanner.resolve` caches by texture CONTENT
(`textures.ts:190`) and plans on FIRST use — so `preferCutout` is decided by whichever caller happens to
arrive first. A texture shared between a vegetation model and a non-vegetation one is classified by build
order, silently. Making the class a pure function of the texels removes this outright; it is an argument for
the design below, not just a bug to note.

## Restrictions checked (per `CLAUDE.md`)

- [`assets-and-data.md`](../../restrictions/assets-and-data.md) — **a rule must derive from what the asset
  carries, never from the slot**. The current vegetation gate is exactly a slot rule (it reads the DEF, not
  the texture). This plan therefore does not add "and also towers" to a list; it moves the decision onto the
  texture's own alpha histogram. Violation is SILENT, which is why the bug survived a whole map.
- [`build-vs-runtime.md`](../../restrictions/build-vs-runtime.md) — **the look is baked**: the class decides
  both the offline texture processing (coverage-preserving mips + sharpening) and the welded pipelineClass.
  Every threshold iteration that reaches the field costs a re-pack, so phase 0 iterates on the CENSUS, not
  on builds, and only a settled rule is packed. That page also says an iterated look value belongs in the
  shader — here the value is not a look knob but a per-texture classification consumed by the mip pipeline,
  so it stays offline (user's call, 2026-07-29: keep it in `opensa-pack`, the build stage). No runtime cost
  is added.
- [`gpu-and-shaders.md`](../../restrictions/gpu-and-shaders.md) — cutout means alpha-to-coverage, which needs
  `sampleCount 4`; the world pass already runs MSAA 4. No new varying, no shader change at all.
- [`architecture.md`](../../restrictions/architecture.md) — everything in this plan is inside
  `tools/opensa-pack`; `packages/engine` is untouched.

## What this plan does NOT do

- **No runtime sorting or depth pre-pass for the blend bundle.** It would cost frame time on every blended
  surface to fix a class that should not be blended at all, and glass/water would still need the blend path.
  Recorded as the alternative, not taken.
- **No per-def flag list, no model names.** See the restriction above.
- **No change to `classOf` / the pipeline set.** The classes are right; the assignment is wrong.

## Phase 0 — fit the rule offline, pack nothing ✅ DONE 2026-07-29

Kept inspector: **`scripts/debug/alpha-class-census.ts`** (+ its row in `docs/debug/README.md`). Thresholds
are CLI flags on purpose — the rule is fitted on the census, never on a re-pack.

### The first candidate was wrong, and the eye review is what said so

The obvious signal — "a mask COMMITS its texels", `decided` = share fully transparent (α ≤ 5) + fully opaque
(α ≥ 250) — flips 2 023 of the 2 541 at `decided ≥ 0.5`, and it is wrong in both directions:

- **False positives**: a soft shadow or a glow card is mostly FULLY transparent around a soft blob, so it
  scores high. `des_fanshadow`, `blackshadow4`, `mast_shadow_t`, `cropdustprop4bit64` (a propeller disc),
  `jlneon`, `circirctex4_neon` all flipped. Hardening a soft shadow into a stamped shape is a worse bug than
  the one being fixed.
- **False negatives**: `Upt_Fence_Mesh` — a chain-link mesh, the textbook cutout — has **no fully
  transparent texel at all** (its holes sit at α ≈ 6–20), so it scored 0.29 and stayed blend. `wire2`, a
  wire cross, has no fully OPAQUE texel and stayed too.

The absolute bins ask the wrong question. What decides the look is the ALPHA TEST vanilla applies at ~128:
a texel is either kept or dropped, and only the texels NEAR the reference are the antialiased edge (which is
exactly what A2C exists to render).

### The rule

Read the histogram against the reference, not against 0 and 255 — `below` = α < 80, `above` = α > 176,
`near` = the 128 ± 48 band:

```
cutout  ⇔  classifyAlpha() === 'cutout'                  (unchanged, the union's first leg)
        ∨  (below ≥ 5 % ∧ above ≥ 5 % ∧ near ≤ 10 %)     (the new leg)
```

Why each constant exists:

- **`below ≥ 5 %` and `above ≥ 5 %` — the texture must populate BOTH sides of the test.** This is the clause
  that rejects true translucency without ever looking at gradients: `a51_glass` is 93.7 % below and 0 %
  above (a uniform film), `glass_fence_64hv` is 92.5 % above and 4.4 % below, `des_fanshadow` is 85.8 %
  below and 0 % above. None of them can be alpha-tested into anything but a blank or a solid.
- **`near ≤ 10 %` — the transition must be an EDGE, not a ramp.** A mask spends a thin border on the
  reference; a shadow ramp lives on it. Measured over the 2 201 two-sided softBlend textures, the `near`
  distribution falls 564 → 553 → 340 → 145 across the first four 2.5 % bins and then FLATTENS into a tail of
  50–100 per bin. The knee is at ~10 %; the constant is that knee, not a fit to any one texture. (For scale:
  `wattsstax1_LAe` 5.0 %, `Upt_Fence_Mesh` 5.1 %, `wire2` 0 %, `ws_grilleshade` 0 % — against
  `railshadowdif` 17.2 %, `mp_torenoshadA` 21.8 %, `blackshadow4` 23.5 %, `jlneon` 25.3 %, `keypad_glass`
  87.9 %.)
- **The union is required**: 57 textures that `classifyAlpha` already calls cutout do NOT satisfy the new
  leg (a mask with almost nothing on one side). The rule only ever ADDS.

### Numbers

| | Count |
| --- | --- |
| textures decoded (`build/original/sa/models/gta3.img`) | 40 230 |
| opaque / cutout / softBlend today | 37 090 / 599 / 2 541 |
| **softBlend → cutout under the rule** | **1 602** |
| stays blend | 939 |

`wattsstax1/4_LAe` — the reported bug — flip: below 19.8 %, near 5.0 %, above 75.3 %.

### The eye review (alpha channels dumped with `dump-texture.ts … alpha`)

Verified as MASKS and correctly flipped: the tower lattice, `ws_grilleshade` (a hard vertical grille despite
the "shade" in its name), `Upt_Fence_Mesh`, `wire2`, cutlery silhouettes, `spruce1` / `cedar1` branches,
`ws_telwiresnew1` telephone wires, `golden_palms` and `nevada92decal128` sign lettering.

Verified as TRUE BLENDS and correctly kept: `a51_glass` (uniform film), `railshadowdif` and `des_fanshadow`
(soft ramps), `keypad_glass`, `cs_rockdetail`, `CJ_W_GRAD` (a gradient), `ws_corr_plastic`.

**Residual false negative, accepted**: `Desrtmetal` — a diamond mesh whose low-res edges put it at
near = 13.0 %, just past the knee. It stays exactly as it is today, so this is a miss, not a regression.
Widening `near` to 15 % would take it and 193 others, including gradients — not worth it without a field
verdict.

### The finding that phase 1 has to answer

**Some of the flips are coplanar OVERLAYS, and a texture-only rule cannot see it.** `sl_dtwinlights1/2`
(night window sheets, near = 7.0 %) and hard-edged decals like `mp_torenoshadA` and `nevada92decal128` are
mask-shaped by texture and correctly identified as such — but the blend pipeline is also what lets an
overlay composite onto the surface it sits on: `pipelines.ts:686` gives blended classes `depthCompare:
'greater-equal'` and no depth write precisely so that "coplanar overlays (night windows, wall signs)
composite stably instead of shimmering". The cutout pipeline compares `greater` and WRITES — a truly
coplanar overlay would lose its own depth test.

So the class cannot be decided by the texture alone. What the ASSET carries that names this case is the
def's own declaration — `IdeFlag.DRAW_LAST` (0x4, 2 419 defs), `ADDITIVE` (0x8) and `NO_ZBUFFER_WRITE`
(0x40) are exactly SA saying "I am an overlay, composite me" — and that is a property of the def, not of the
slot, so it satisfies the assets restriction. Phase 1 decides where that gate belongs, which is not free:
the texture PROCESSING (sharpening, coverage-preserving mips) is per texture and cached by CONTENT, while
the overlay declaration is per def. The two cannot both be honoured by the current single-decision-per-
texture shape — that is the design question, and it is now stated with its evidence rather than guessed.

Scope note found while tracing it: a vehicle's translucency comes from its submesh material class
(`engine.ts:2515` picks `rigid-blend`), not from the texture's alpha class, so a flip on a livery decal
changes its offline PROCESSING only, never its depth behaviour.

### Phase 1's verification, unchanged

`npm run test:fixtures`-style REAL assets, not synthetic ones — a real TXD entry is one manifest line. Pin
at least: the tower lattice, a stock fence, a canopy that already upgrades via vegetation, a true glass, and
one overlay from the class above.

**Exit: met.** The flip list is defensible without opening the game, and the one thing that is NOT decidable
offline is named.

## Phase 1 — the rule in the pipeline ✅ DONE 2026-07-29 (no pack yet)

Four changes, each with the measurement that chose it.

**1. `isAlphaMask` (`alpha.ts`) — the rule, as a pure function of the texels.** No caller, no name, no def.
`effectiveAlphaClass(classified, preferCutout, mask)` now takes two independent upgrades of a softBlend
verdict, and `TexturePlanner.plan` passes the mask verdict. The census reports the SHIPPED function by
default (its threshold flags stay, for re-fitting offline): **1 602 flips**, the same list phase 0 reviewed.

**2. The vegetation preference SURVIVES, and that is a measurement, not a compromise.** It covers the one
case the histogram cannot reach: a mod canopy authored at alpha ≈ 0.5 EVERYWHERE spends its texels ON the
reference, so it is not mask-shaped — yet vanilla alpha-tests foliage regardless. Retiring it would revive
the 2026-07-13 `tree_hipoly07` report from the other side. Consequently **sharpening now keys on the caller
upgrade only** (`preferCutout && alphaClass !== classified`): a mask has a thin edge by definition, and
steepening it would throw away the antialiasing A2C is there to resolve.

**3. The planner's content cache keys the preference in.** 38 of the map's TXDs are referenced by BOTH
vegetation and non-vegetation defs (measured over the 14 258 defs: 87 vegetation TXDs, 2 424 other), and a
content-only key handed all of them whichever class arrived FIRST — silent and build-order-dependent. Pinned
by a test: the same texture resolved with and without the preference now comes back softBlend and cutout.

**4. The overlay gate is `NO_ZBUFFER_WRITE`, not `DRAW_LAST` — and the join says why.** Of the defs whose
txd carries a flipping texture, **1 359 carry DRAW_LAST — and they are the TREES** (`veg_palm04`,
`veg_tree3`: flags 2097284 = backface-culling-off + DRAW_LAST). SA marks anything alpha DRAW_LAST; it means
"draw me in the alpha pass", not "I am coplanar". Gating on it would have re-broken exactly the class 074
fixed. `NO_ZBUFFER_WRITE` (0x40) is the honest declaration — 250 defs map-wide, 94 on a flipping txd, and
they read like the list they are: `grnd_alpha*`, `graffiti_lan01`, `des_ntwn_lines*`, the `alphbrk*` sheets.
`classOf` keeps those in the compositing blend class, **for alpha materials only** — plan 039's precise
lesson, since bare-0x40 opaque terrain (`VegasSland40`) must keep occluding. The own engine had never read
this flag at all, so this also closes a latent gap: a decal whose texture already classed `cutout` has been
writing depth against SA's explicit instruction.

The night-window worry from phase 0 turned out to be answered by the data too: `lanitewin*` carry flags 12
(DRAW_LAST + **ADDITIVE**), and additive already wins in `classOf` — they never took the alpha-class route.

**What was deliberately NOT touched.** `model-ostex.ts` (the per-model dictionary path: vehicles, props,
clutter, anim objects) still classifies with `classifyAlpha` alone. Traced: those draws pick their pipeline
from the submesh material class (`build-vehicle-model.ts:736` → `rigid-blend`), the `.ostex` layer's
`alphaClass`/`cutoutRef` are written but read by nothing, and that path emits ONE mip level, so coverage
preservation has nothing to preserve. Changing it would move bytes and no pixels.

### Tests

- `alpha.test.ts` — the histogram cases, negative first: a uniform film (one-sided) and a ramp and a soft
  blob are NOT masks; a chain-link authored at alpha 10/200 IS one **and `classifyAlpha` calls it softBlend**
  (the `Upt_Fence_Mesh` false negative, in miniature); an antialiased edge up to a tenth of the sheet passes.
- `alpha-class.test.ts` (new) — the rule end to end on REAL texels: the Watts Towers' own dictionary
  (`lae2tempshit`) classes `wattsstax1/4_LAe` cutout with no caller preference and leaves `BLOCK2` opaque;
  `kmb_keypadx`'s glass film stays softBlend; the cache test above. Two fixture lines added to
  `scripts/test-fixtures.ts` (`dff/alpha-class/`).
- `weld.test.ts` — the welded pipelineClass on a real breakable: `bins2_LAe2` (a DXT3 mask) now welds as
  class 1 instead of 2, the same def with `NO_ZBUFFER_WRITE` welds back to 2, and an opaque model with the
  same flag stays 0.

Suite: `tools/opensa-pack` 186 tests green (24 files), `tsc` + `eslint` clean.

### Numbers, and what is still unmeasured

| | Before | After the rule |
| --- | --- | --- |
| textures classed cutout (of 40 230) | 599 | **2 201** |
| classed softBlend | 2 541 | 939 |

`report.json` deltas and pack wall-clock are phase 2's — they need the re-pack, and nothing in this phase
has reached a pak yet.

## Phase 2 — repack and the field round ✅ DONE 2026-07-29

**The user rebuilt (`build:game:original:opensa`, pak buildTime 10:53 29-07-2026) and gave all three
verdicts.**

| Check | Verdict |
| --- | --- |
| **The towers** — the reported symptom | **fixed**: "the tower problem is gone" |
| **Vegetation control** — the 2026-07-13 screen-door must not return | **clean**: first pass "did not notice anything", then explicitly re-checked at a named spot — "definitely all good" |
| **True-blend control** — glass must still composite | **clean**: "the glass is there and you can see through it fine" |

Shipped classes, read out of the pak's 43 RGBA8 arrays rather than predicted: **1 422 cutout / 661
soft-blend / 380 opaque**. These count a DIFFERENT population from phase 1's 599 → 2 201 and the two are not
subtractable: the census counts every texture of every TXD in the archive (the same sheet in ten
dictionaries is ten rows), while the pak holds deduped LAYERS — `report.json` records 260 036 dedup hits
against 2 444 processed. What carries over is the ratio: 68 % of the shipped alpha layers now write depth.

Perf: the 8-scene sweep is [`2026-07-29-headless-092-alpha-cutout-sweep.json`](../../benchmarks/opensa-engine/2026-07-29-headless-092-alpha-cutout-sweep.json)
— every scene at the 120 Hz cap (8.33–8.36 avg, p95 9.2–9.3, `lateCreates` 0), unchanged. **The
`gpuMs.pass` column is NOT an A/B** and is recorded as such: the 07-28 baseline read a pak from 07-24, and
the largest deltas land where the rule cannot reach (ocean-horizon 1.961 → 0.915 at 27 draws).

### Two things the field round cost, both kept

- **The glass control was picked wrong the first time.** The LV airport terminal was chosen because its
  DICTIONARY (`vgssairport02`) carries a stay-blend `glass_64` — but the model's own materials use
  `marinawindow1_256`, which has **no alpha channel at all**. A dictionary serves several models; only the
  MATERIALS say what a model draws. The replacement control is a bus shelter (`bustopm` ×48,
  `cj_frame_glass`, 91 % of texels below the alpha test — alpha-testing it would erase the pane).
  Both field spots are now `SA_TELEPORTS` entries with their numbers in the comment.
- **Hand-picking a viewing spot put the camera inside a building**, which produced
  `scripts/debug/teleport-spot.ts` — ring the target, ray-cast onto every neighbour's collision for the z
  you would land on, reject spots inside anything, name what crosses the view.

### What the round found that is not this plan's business

The exterior world has **47 placed models** carrying a stay-blend texture at all, and the classic glass
textures (`a51_glass`, `keypad_glass`, `cof_wind1`) are INTERIOR assets the engine filters out; most city
"windows" are painted onto opaque textures. That population survey became
[`ideas/world-glass-material/`](../../ideas/world-glass-material/readme.md) — SA's `surfinfo.dat` has a
GLASS column and every COL face names its surface, so glass is knowable from the asset.

## Phase 2 — the original plan

One `opensa` build (turnaround: a full pmb run is > 1 h; a targeted `opensa-pack` re-run is the cheaper
path if it can be scoped — measure and record which was used, per the standing rule that a field run reads
`build/<game>/opensa` and nothing else).

Field checks, all at night and by day:

1. **The towers**, GTA (2309.4, −1433.0) — the reported symptom, before/after from the same camera.
2. **The vegetation control** — a `tree_hipoly*` area: the 2026-07-13 stipple must NOT return.
3. **A true-blend control** — glass (`a51_glass` class) and water edges must look unchanged.

Perf is a real question in both directions and gets measured, not assumed: cutout writes depth (early-z may
HELP a fill-bound scene) but adds A2C work. The 6-scene ritual sweep, `gpuMs.pass` compared against the last
recorded row; everything into `docs/benchmarks/` before it is analysed.

## Phase 3 — close the loop ✅ DONE 2026-07-29

**The standing rule paid off last, not first: the game's real formula was recovered while writing this
phase**, and it changed what the docs say.

From the reversed source: SA has **no cutout/blend classes at all**. It runs ONE pass with blending always
enabled and an alpha-test REFERENCE that moves per entity per frame — `CRenderer::RenderEverythingBarRoads`
opens the pass at **140**, and `CVisibilityPlugins::RenderEntity` (`VisibilityPlugins.cpp:555-578`) then sets
**100** per ordinary entity, or **0** for a `bDontWriteZBuffer` model, an interior, or an entity that is
distance-fading.

Three things follow, all now written down:

1. **The `NO_ZBUFFER_WRITE` gate is vanilla behaviour, not a guess.** SA answers such a model with reference
   0 — no alpha test, pure compositing — which is exactly the blend class `classOf` keeps those defs in. The
   join in phase 1 inferred it from the flag's meaning; the source confirms it.
2. **Our reference 128 sits inside SA's own 100–140 band** — derived, not invented.
3. **What we do NOT model is now stated**: a cutout does not soften as it distance-fades (SA drops the
   reference to 0 for that), and one reference serves every masked texture where SA uses two.

Docs updated in this change:

- [`hacks/alpha-mask-thresholds.md`](../../hacks/alpha-mask-thresholds.md) (+ its README row) — the debt
  ledger for the rule: what SA really does, which of the three constants is FITTED (the 5 % side floors —
  swept and eye-judged; the 10 % edge bound is a measured knee, the 128 is derived), the residual (1 602
  flips, one known false negative), and what would retire it (carry SA's model — one pass, reference as a
  per-draw uniform — which means solving the fringe without A2C).
- [`edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md) — the class is decided once,
  offline, from the texels, and cannot follow the frame; plus what a per-texture rule cannot see.
- [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md) — two new SILENT rows: a cached
  per-asset verdict is a pure function of the bytes or the preference is in the KEY (the planner's
  order-dependence, 38 shared TXDs), and **a dictionary is not a material list** (the field control that
  turned out to have opaque windows).
- [`features/map-pipeline.md`](../../features/map-pipeline.md) — the alpha-class description (phase 1).
- [`debug/README.md`](../../debug/README.md) — the triage step now says to ask the materials, not the
  dictionary; plus the two tools this plan produced (`alpha-class-census.ts`, `teleport-spot.ts`).

## The open question, answered

Whether the end state is "cutout" for this class at all, or a third path (alpha-tested with depth write but
blended edges — SA's own dual-pass). **The field said cutout is enough**: all three controls came back clean
on the first packed build. The dual-pass idea stays available in the hack file's "what would retire it",
where it belongs — as the honest model we are approximating, not as unfinished work.
