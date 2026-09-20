# `asi/perfect-vegetation` — view-weighted impostor cards on the `sa` target

**Status: removed 2026-08-22, at the user's call, before its first patch site was ever read.** The scaffold
(step 0, `8faafc67`, 557 lines across 16 files) is gone from the tree; this file is the record. It did not
fail a measurement — **it lost its reason** while the plan that needed it was being built.

## What it was going to be

The `sa`-target half of
[lod-trees 013 step 04](../../tools/lod-trees-generator/docs/plans/013-impostor-parity.md). A tree impostor is
a cage of crossed cards; from any one camera angle the eye sees all of them stacked, which is why the LOD read
as a solid dark blob (cause 1 of that plan). OpenSA can fix that in its own engine with a `billboardSet`
material class; RenderWare has no such thing, so real SA was to get it from our own `.asi` — the user's
question on 2026-08-21, *"can we write our own ASI for it?"*, answered yes because a CLEO script has no reach
into an atomic's draw and an ASI does.

The mechanism, deliberately shader-free: the cards are N MATERIALS of ONE atomic, the plugin wraps that
atomic's RENDER CALLBACK (never its pipeline — the install runs the SkyGfx fork, which owns the pipeline), and
per draw writes each card's `RpMaterial` colour alpha from `|n_i · viewDir|^p` normalised over the set, so the
card facing the camera carries the coverage and the edge-on ones fade. Both the fork's `ps2BuildingVS`
(`matCol`) and the fixed function multiply material alpha in. Fourth consumer of `asi/sdk`.

## What killed it: step 06 reached parity without it

Measured on 2026-08-21 and recorded in
[`docs/benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md`](../benchmarks/tools/2026-08-21-lod-trees-impostor-bake.md):

- The over-density the plugin existed to remove was **mostly a different cause**. The pre-plan configuration
  measured ×1.59 of the HD's canopy mass; blend → cutout on the SAME cards is ×1.24 → ×0.97. The plan's
  `1 − 0.45⁴ ≈ 96 %` had assumed the four cards' opaque texels are independent, and they are not — they are
  four projections of one canopy.
- **OpenSA needs nothing further**: after step 02 it welds the cage CUTOUT, 4 cards at full alpha come out at
  ×0.97 / ×0.86 of the HD, and the angular swing already matches the tree's own (0.94..1.05 vs 0.92..1.06).
- **The `sa` half reached parity in the DATA instead**, which is where this repo prefers it: step 06 bakes a
  second cage for that target — 3 cards, each thinned by a factor solved per tree against its own HD
  (`core/card-alpha.ts`; roster min 0.47, median 0.83, max 1.00, 12 trees needed none). That is the same
  correction the plugin would have applied at draw time, paid once at bake time, with no exe patch, no
  coexistence risk with the fork, and 6 triangles per impostor instead of 16.

So the remaining gain was the ANGULAR one — a cage that shows one projection from every azimuth rather than a
correct average of four — and nobody has yet seen a field defect that asks for it.

**The general rule this case demonstrates** (`docs/architecture/`, the `asi/` family): an ASI exists only for
what cannot be expressed in the data we ship — a ceiling compiled into the exe (`perfect-map`'s int16
`IplDef`, `perfect-vehicle`'s `carmods.dat` arrays) or a decision the engine takes at draw time and no file
carries (`perfect-cutscene`'s deferred alpha pass). A patch shares the exe with OLA, FLA and the SkyGfx fork,
pins one accepted binary, and can only be judged in the bottle; a data change is verified offline and a mod
can override it. When both roads reach the same point, the data wins — and here it also arrived cheaper.

## What was actually built, and is now deleted

Step 0 only: the scaffold on `asi/sdk` (identity / config / plugin / apply / game seams, a pure
`src/patches/weights.hpp` holding `CardWeights`, the thin generator + 5 green gen tests, the Makefile). It
linked in both verify-only and APPLY form and shipped an 8 192 B `.asi` whose import table is `KERNEL32.dll`
only — but its catalogue was EMPTY, so an APPLY build logged "patching nothing" and exited. **No exe site was
ever read, so nothing reverse-engineered is lost with the folder.** `git show 8faafc67` restores all of it.

## When to revisit

The trigger is a FIELD one, and it has not fired: someone orbits a tree at LOD range and the cage still reads
as a stacked blob rather than as one canopy. Until then the data-side fix stands.

If it does fire, the honest order is (1) re-measure with `scripts/debug/impostor-density.ts --blend --ref 100`
(the `sa` target's own configuration) to confirm the complaint is angular and not density; (2) note that **for
OpenSA the answer is no longer an ASI at all** but the `billboardSet` material class in our own engine
(`packages/cell-weld` + the world shaders) — the engine has no impostor concept today, it draws the cage as
ordinary vegetation with baked sway, which is exactly what such a class would extend; and (3) only for real SA,
`git show 8faafc67` back into place and start at its step 1 (the RE).

One thing worth carrying into whatever replaces it: at SA's sorted-pass alpha reference of **100** a thinned
texel is DISCARDED, not faded. Any scheme that fades a card by weight has a cliff, not a ramp, and the
prepared fallback was a two-level rule (full / off). That is a fact about the target, not about this plugin.
