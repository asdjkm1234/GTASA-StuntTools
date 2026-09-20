# The per-category clutter draw distances (100 / 150 / 200 / 300)

**Where:** `apps/web/src/ui/game-runtime-config.ts` — `graphics.procobj[*].drawDistance`, shipped 2026-08-10
(`dd832c68`, backlog band P2). Consumed per instance in `vsClutter`
(`packages/engine/src/render/shaders.ts`) and per group in `Engine.drawClutter`.
**Stands in for:** a range DERIVED from what each clutter model actually is — its own geometry, the size it
occupies on screen — rather than from which of seven buckets its surface rule put it in.

## What the game actually does (recovered 2026-08-09, plan 009)

SA has no per-species visibility range at all. `CPlantMgr` keeps loc-triangles within
**`PLANTS_MAX_DISTANCE = 100`** metres of the camera and objects persist while their triangle stays inside
that radius (`docs/gta-sa-original/procedural-objects.md`). One number, every species, no variation — and the
one authored column that looks like a distance, MINDIST, is an anti-pop-in radius clamped to
`max(minDist, 80)` and is consumed by nothing in our pipeline.

So there is **no original formula to recover here**, which is why this file is about a judged choice rather
than a missing port. Beating a flat 100 is `project-goals` directive 3 applied directly: a 2004 create/destroy
system with an object pool is exactly the kind of ceiling that is not ours.

## What we do instead

Seven constants, one per semantic category, floored at SA's own 100:

| category | range | the reasoning |
| --- | --- | --- |
| trees, cacti | 300 | a silhouette on the horizon; 300 is also what the `sa` target shows (plan 014's permanent rows at 299), so the two targets stop disagreeing about one world |
| rocks | 200 | mixed by nature — `searock01` boulders down to `p_rubble` gravel |
| bushes | 150 | reads as massed cover, not as a silhouette |
| grass, flowers, underwater | 100 | ground texture; past ~100 it is sub-pixel noise that costs pure fill |

**Why this is a hack and not a rule:** the category is a property of the `procobj.dat` SURFACE rule, not of
the model. Nothing checks that the thing in the `cacti` bucket is actually tall, so a mod that scatters a
different model under a cactus rule inherits 300 units of visibility it may not deserve — and a genuinely
large model under a `grass` rule is cut at 100. It is the same shape as the standing rule against hardcoding
per-asset values: **the number does not derive from the asset.**

## What it was judged on

Two things, and the honest answer is that only one of them is a measurement.

- **Cost — measured, and it says the choice is free.** Monotone over 100 / 150 / per-category / 300 against a
  0.020 % A/A control, a 4× lever in layer terms (9 110 → 36 191 triangles) reading as +2.3 % of the scene,
  and `gpuMs.pass` spanning 1.7 % across the whole ladder — inside that column's own drift, with every hitch
  column flat ([bench row](../benchmarks/opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json)).
  So nothing about these values is a perf compromise; a different set would cost the same.
- **Look — "it looks right", and it says so.** The user's rule was: own distance per type, large objects 300,
  small 100, never below 100; the split above is the assistant's distribution under that rule, accepted by
  the user in the field on 2026-08-10 (his verdict: by the picture, yes, it all looks right). Three headless screenshot attempts
  failed to find a clutter vista, so no capture backs it — the verdict is a human's, on his own display.

## What would retire it

A range derived from the model's own bounds — height or projected radius from the built clutter mesh, mapped
through one curve with SA's 100 as the floor, so the number follows whatever is actually in the slot. The
geometry is already in hand at upload time (`ClutterModelInit.positions`), so the blocker is not data: it is
that a curve fitted to seven judged points is not obviously better than the seven points until someone judges
the result. **Retire it when a mod ships clutter whose size and bucket disagree** — that is the case these
constants get wrong and a derived rule gets right.

## Blast radius

- **The streaming ring follows the widest ENABLED category** (`clutterRingRadius`), so raising any category
  past 300 widens the ring for every category and costs scatter + upload on more cells — never fill, which the
  per-instance cull owns.
- **Clutter colliders do NOT follow this.** They stay on `streaming.collisionDrawDistance`, deliberately: a
  bush at 300 units is scenery, and Rapier static bodies at that radius are what once cost 17 ms/step. Raising
  a range does not add physics.
- **Lowering a category below its old effective reach removes clutter people have seen.** Before this shipped
  the values were dead config and the real reach was cell-shaped (up to ~360 units at a cell corner), so
  grass at 100 is a visible reduction at range as well as a saving.
- `?procobjRange=<units>` overrides all seven at once — any A/B or field report about clutter range must say
  whether it was set.
