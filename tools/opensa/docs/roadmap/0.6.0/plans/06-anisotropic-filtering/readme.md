# 0.6.0 · 06 — Anisotropic texture filtering

**Status: IDEA (deferred by the user 2026-08-11).** Split out of
[`tools/map-optimizer/docs/plans/025`](../../../../../tools/map-optimizer/docs/plans/025-texel-smear-on-flat-surfaces.md)
so that plan can stay on the DATA defect it is actually about. This one is the other half: the same original
data reads **worse in OpenSA than in real SA**, and this is the term that decides how much worse.

## The problem, in the words the field used

Investigating the texel smear on `road_lawn*` / `sbseabed3_las20`, the user checked the models in
`sa-map-viewer` against the untouched original and reported: *"in SA we see them too, but not as harshly as
in OpenSA."*

So there are two independent quantities, and only one of them belongs to us:

- **R\*'s stretch** — authored UV mappings that draw a texel up to 284× longer than it is wide, and in places
  collapse one axis entirely. Original-game data, present in vanilla, untouched by our pipeline. That is
  plan 025's subject and no filtering setting can repair it.
- **Our added blur** — on top of that stretch we lose detail the texture still has. That is this plan.

## What is measured today

**Every sampler in the engine runs at anisotropy 1.** A grep for `maxAnisotropy` over `packages/engine/src`
returns nothing at all — the world sampler (`packages/engine/src/world/textures.ts`) is created with
`repeat` / `magFilter` / `minFilter` / `mipmapFilter: 'linear'` and no anisotropy field, and so is every
other one (clutter, ped, particle, post, probe).

Trilinear without anisotropy selects the mip level from the **larger** of the two UV derivatives. On a
grazing-angle surface — which is most of the ground in a game with a chase camera — those two differ by a
large factor, so the level chosen for the long axis also blurs the short one, **destroying detail that was
never in trouble**. That is the mechanism behind "harsher than SA".

The mip chains exist to filter with: map-optimizer's `--textures` pass writes a full chain into every
single-level TXD (its plan 010), and `opensa-pack` carries the levels into the world texture arrays
("95 % of the textures the mod packs ship carry a chain, up to 12 levels").

## What it will and will not buy

- **It sharpens, it does not smooth.** Anisotropic filtering takes several taps along the long axis of the
  sampling footprint from a finer mip. The result has MORE detail than today, not less. Worth stating because
  the intuition runs the other way.
- **It is adaptive by construction.** Where the footprint is round — a wall seen head-on — the hardware takes
  one sample, exactly as trilinear does, and the setting costs nothing there.
- **On a face with a stretched authored UV** it recovers the fine axis: the streak becomes a SHARP streak.
  The stretch itself stays, because it is in the mapping.
- **On a face whose UV collapses an axis** there is nothing to recover — the texture is constant along it.
  Expect a sharp single texel row instead of a blurred one. Better, not fixed.

## The work

1. Set `maxAnisotropy` on the world sampler, and decide per sampler whether the others want it (clutter is
   the obvious second — scattered grass cards are seen edge-on constantly; post/probe/particle almost
   certainly do not).
2. **Bench ritual before/after, at 4 and at 16**, numbers into `docs/benchmarks/` per its schema, naming the
   pak build the run read. The cost is per texture sample and scales with the share of screen at a grazing
   angle — which in this world is large, so it is not safe to assume it is free. This project's standing
   rule is that better must be DEMONSTRATED, and performance is part of a feature's specification.
3. Field A/B on the 025 spots (`road_lawn34` 1124.6, -951.4, 40.9 · `sbseabed3_las20` 2901.3, -2058.4, -51.4),
   same viewpoint per arm.
4. If the measured cost does not justify it, the lever does not get dropped — it goes to
   `docs/performance/deferred-optimizations/` with its price, which is what that folder is for.

## Open questions

- Does WebGPU expose it the way the code assumes? `GPUSamplerDescriptor.maxAnisotropy` is in the spec, but it
  is only honoured when min/mag/mipmap filters are all `'linear'` — true for the world sampler today, and a
  thing to assert rather than trust.
- Is a fixed value right, or should it ride the existing render-scale tier? The repo has exactly ONE
  perf knob today (`?scale`, and the ladder run proved a ~2 ms resolution-independent floor) — adding a
  second one needs an argument, not a default.
- Does it interact with the alpha/cutout pass? Foliage cutouts sampled with more taps can shift the coverage
  around the alpha reference, and OUR alpha class is baked per texture at pak time rather than decided at
  draw time — so re-read how the alpha pass is specified before touching the clutter sampler, and treat any
  change there as its own arm.

## Why it is deferred rather than done

It is a genuine improvement and it is cheap to write, but it is a LOOK change to the whole world plus a
frame-cost question, and 0.5.0's remaining work is the data defect it was found next to. Doing it now would
also confound the 025 field rounds: both change how the same spots look.
