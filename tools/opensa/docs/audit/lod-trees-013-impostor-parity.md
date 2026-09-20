# lod-trees 013 — impostor parity: what it changed, what it cost, what it bought

**Closed 2026-08-22, field-accepted on both targets.** Plan
[`tools/lod-trees-generator/docs/plans/013-impostor-parity.md`](../../tools/lod-trees-generator/docs/plans/013-impostor-parity.md).
Written per the standing rule that a big rework gets an audit and a benchmark before it is called done; the
numbers are in `docs/benchmarks/tools/2026-08-21-…`, `…/2026-08-22-lod-trees-013-on-the-built-trees.md` and
`docs/benchmarks/opensa-engine/2026-08-22-lod-trees-013-sweep.md`.

## What the report was, and what it actually was

*"Every tree differs, not only these two — the LOD is a solid dark mass where the HD is an airy canopy."*
Four causes were named. Three were real and one was mostly a fourth:

| cause | verdict |
| --- | --- |
| 1. over-density by construction (4 crossed cards ≈ 96 % fill) | **mostly cause 3.** The arithmetic assumed the four cards' opaque texels are independent; they are four projections of ONE canopy. Measured ×1.59, not ×1.75+ |
| 2. point-sampled bake → speckle | real — fixed in 01 (supersample + mip-aware sampling + 6 rings of dilation) |
| 3. wrong alpha class, no wind | **the dominant one.** The impostor row carried no vegetation bit, so OpenSA welded it soft-blend while its own HD welded cutout |
| 4. DXT5 endpoints fitted over transparent black | real — fixed in 01, worst edge error 26 → 10 |

## What was built

- **01** — the bake stops aliasing: speckle 6.0 → 1.1 % and 3.6 → 0.4 %, canopy MASS and median luminance
  unchanged (the two metrics that survive antialiasing), DXT5 edge error 26 → 10.
- **02** — the impostor row inherits its source's `IS_TREE`/`IS_PALM`, **and** `cell-weld`'s `swayKindFor`
  retries the wind list with a leading `lod` stripped. On the built roster: **182 of 184 rows classify as
  vegetation, against 67 without the retry — and 0 match under their own name.** The two that classify as
  nothing are dead trees whose HD rows carry no bit either.
- **03** — density measured before it was decided; the gate for phase B did not fire.
- **06** — **one cage per alpha class**, the rule the field forced: OpenSA welds cutout and takes 4 full-alpha
  cards (×0.97 of the HD's canopy); real SA composites the cage in its sorted pass whatever the flags say, so
  the built tree carries 3 cards thinned by a factor **solved per tree** against its own HD (roster min 0.47,
  median 0.83, max 1.00, 12 trees needed none).
- **04 was NOT built** — measured away by 06, and the `asi/perfect-vegetation` scaffold that was to carry its
  `sa` half was deleted with a [postmortem](../postmortem/asi-perfect-vegetation-view-weighted-cards.md).

## What it cost

- **Build time**: the `trees` stage 83.4 s → 711.4 s (×8.5) — two cages per tree plus the per-tree alpha
  solve. Everything else is where it was; the `opensa` stage reads 2 532 → 2 529.5 s, i.e. unchanged.
- **Nothing at runtime.** The `sa` impostor went 16 → 6 triangles and lost a blended card; OpenSA stayed at 8.
  No atlas grew. The user's in-game sweep: mean frame −1.9 %, GPU pass −2.8 %, slow frames 35 → 24.
- **One deleted direction** (the ASI), recorded rather than dropped.

## What it bought

The field's own words after driving the `sa` build in the reference bottle and flying over it, and after
looking at the OpenSA build: **"definitely better on both — the LOD→HD transition is much less noticeable, and
I saw no defects."**

## What this chain is worth remembering for

1. **The dominant cause was not the one the plan opened with**, and the instrument that said so was built
   before the fix, not after. Cause 1's arithmetic was plausible, quotable and wrong.
2. **The field changed the RULE, not just a number.** Step 03 measured 4 cards as right and closed; the `sa`
   verdict *"about the same"* then proved the rule is per TARGET, because real SA's sorted pass never performs
   the cutout union OpenSA's weld does. A rule that is right on one host can be wrong on the other, and only
   the host says which.
3. **A solved constant beats a fitted one.** The card alpha is bisected per tree against its own HD at the
   size it has on screen; a single global factor would have missed most of the roster in one direction or the
   other, and it would have needed a `docs/hacks/` card. This needed none.
4. **Two instruments lied and were caught by controls** — a per-item bake cost measured on a fixture that did
   not share what the pipeline shares (9-tree sample said ~10 min, the stage took 32), and the `sa` stage's
   1 503 s that was an 8 GB heap I had set myself. Both are in
   `docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`.
5. **The measurement that closed cause 3 came from the shipped pak**, not from the bake: 49 820 impostor
   triangles across 562 LOD cells, every one in the cutout class, and the SWAY channel in 425 of 562 LOD cells
   against 435 of 562 HD.
