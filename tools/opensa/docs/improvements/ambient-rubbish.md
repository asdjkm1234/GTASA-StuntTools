# Blowing rubbish on the streets (a system SA dropped)

**Status: parked — not doing yet.** Noted 2026-08-11 from
[`gennariarmando/rubbish-sa`](https://github.com/gennariarmando/rubbish-sa), a small C++ mod that ports GTA
III's rubbish system into San Andreas and lets you shoot the debris.

## Why it is worth having

GTA III blew litter around its streets; San Andreas did not carry the system forward. It is a cheap, purely
ambient detail of exactly the kind that makes a city read as inhabited between the big systems — the same
register as the [City Life chain](../roadmap/0.5.0/plans/06-city-life/readme.md), and far below it in cost.
Restoring something the series HAD is also the easiest kind of improvement to justify against
[`project-goals.md`](../project-goals.md): nothing about SA's authored data has to be re-interpreted for it.

## Why the reference is useful twice

- **As a worked ASI example.** It adds an ambience system to the real game from the outside, in C++, which is
  the shape `asi/city-life` takes. Worth reading for how it hooks the frame and where it puts its state, ahead
  of our own plugin work.
- **As the feature itself.** The wind field it would ride already exists on our side as a concept
  ([roadmap 0.5.0 `02-weather-wind`](../roadmap/0.5.0/plans/02-weather-wind/readme.md)), so the two are natural
  neighbours: litter is the cheapest possible consumer of a wind vector, and a good first proof that the wind
  is real.

## What would have to be decided before it is a plan

- **Which host leads.** The engine (ours, where particles and wind are ours to write) or the ASI (real SA,
  where the mod already proves it is possible). City Life answers the same question in its own way, and this
  should follow whatever that chain settles on rather than inventing a second answer.
- **What drives it.** Wind, or a self-contained wander. Tying it to the weather system is the honest version
  and costs nothing extra if the wind lands first.
- **Its budget.** Ambient particle systems are fill-bound the way foliage is
  ([`performance/deferred-optimizations/foliage-fill.md`](../performance/deferred-optimizations/foliage-fill.md)
  is the cautionary measurement — alpha-tested layers cost per pixel and overdraw each other). A count cap and
  a distance band belong in the design, not in a later optimisation pass.

Not opened as an idea folder: there is no research to do yet beyond reading the mod.
