# The dynamic-model indirect weight

**What it is.** `const DYNAMIC_INDIRECT = 0.35` — `packages/engine/src/render/shaders.ts`, applied to the
indirect (ambient) term of every dynamic model: vehicles, peds, props.

**What it stands in for.** Two factors a dynamic model has no data for. The map's indirect term is
`prelit × params.y × ao` — dimmed twice, by baked lighting and by baked occlusion. A car's was `params.y`
alone, dimmed not at all. Measured at full night that read **car 0.70 against map ~0.13** under the same
lamp. The constant stands in for the mean PRELIT (SA's map models average 88/255 luma) and, for vehicles,
the per-instance AO the builder computes.

**What it was judged on.** The 0.70-vs-0.13 measurement above (plan 084) plus the field verdict on the
result. The number itself is the ratio that closed the gap, not a derivation: 88/255 ≈ 0.345 is where it
comes from, but nothing checks that a car's real occlusion averages what a building's does.

**What would retire it.** Reading the two factors instead of standing in for them: a dynamic model already
carries per-vertex sky occlusion (`vehicle/sky-occlusion.ts`), so the AO half is available and unused here.
The prelit half needs a decision about what "the ambient a car sits in" means when the car has no baked
lighting at all.

**Blast radius.** Every dynamic model's night brightness, uniformly — cars, peds, props, clutter. Raising it
brightens vehicles against a map that will not follow; lowering it sinks them into the street. It is one of
the two numbers that decide whether a car reads as "in" the scene at night, the other being the sky-occlusion
floor.
