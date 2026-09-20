# 201/1-02 — The protected list

**Written before the first cut.** Everything in chain 1 after this step removes something, and the argument
for a removal is always the same shape: nobody measured it being read. That argument is correct about BYTES
and wrong about LIFE — a world can be measured down to a still, correct, dead picture, and no row in the
inventory would object. This list is what the trim may not take, so a later step has to argue against a
written rule rather than against nobody.

It is not a wish list. Each row names **what carries the item in code or data**, so "we kept it" is
checkable, and says whether losing it is **caught** by anything or is **silent** — the silent ones are the
whole reason the list exists.

## What may not be removed

| Protected | What carries it | Losing it looks like | Caught? | The cheaper version that IS allowed |
| --- | --- | --- | --- | --- |
| **Cars and peds drawn and animated** | `createVehicleModel` / `createVehicle`, `RigidEntity`, `IfpSampler` (`packages/engine/src/index.ts`); the pak's vehicle and ped dictionaries | units stay symbols forever; the pak profile drops the dictionaries because the console never asked for them | **silent** — [1/01](readme.md#01--the-inventory) measured a surface that draws no model, so its bytes table shows zero reads for exactly the entries [5/04](../5-symbology-and-picking-as-product/readme.md) will need | fewer models in the build, lower LOD, later streaming — never "the path is not there" |
| **Vegetation sway** | baked per-vertex amplitudes (074/06 row 10) + `Environment.windStrength` (`engine.ts`, frame slot 60) | `windStrength: 0` — a still world that renders identically in a screenshot | **silent** in every automated check; only a field verdict sees it | amplitude scaled down on a phone, sway on fewer species — never the amplitudes stripped from the bake, which cannot be put back at runtime |
| **The day/night cycle and timecyc** | `createEngineEnvironmentDriver` over the shared config→`Environment` path; the console's hour (`?hour=`, the slider, `applyHour` in `apps/dispatch/src/world/boot.ts`) | one baked hour, because the map "only ever shows daytime" | **caught** the moment anyone moves the hour, which chain 8 does by construction | fewer probe/relight updates per hour step ([env-probe cadence](../../../performance/deferred-optimizations/env-probe-cadence.md)) — never a fixed hour |
| **The weather mood and the lit world** | the timecyc mood the driver reads (`weather` param), the same lighting path the game uses | flat ambient, "it is a map, it does not need weather" | **silent** — it is a LOOK, and no test in this repo can see a look | a cheaper sky or fewer weather transitions — never an unlit world |
| **Vehicle reflections** | `Environment.reflectionStrength` + `EnvProbe` (a `null` probe skips it entirely — `engine.ts`) | probe off on mobile "because it is a map" | **silent** — the fallback path renders, just duller | [cadence](../../../performance/deferred-optimizations/env-probe-cadence.md), smaller probe, fewer probed materials — never off |
| **One engine across PC and mobile** | the single build; `docs/restrictions/architecture.md` already carries the rule | a mobile-only branch in the renderer that quietly diverges from what the desktop draws | **caught** — it is a restriction with a lint/boundary story behind it | a BUDGET difference (resolution, cadence, ring sizes) — never a second code path |

## What is NOT protected, and why that is a decision rather than an omission

- **Baked collision** — [1/01](readme.md#01--the-inventory) measured **zero** collision requests against a
  49 870-triangle bake, and the code agrees (`bootDispatch` never reads `setup.collision`). It is
  [1/03](readme.md#03--the-pak-profile)'s omission candidate, **conditional on
  [5/04](../5-symbology-and-picking-as-product/readme.md)**: the day units stop being kinematic, it comes
  back. A conditional candidate is not a protected item and not a settled cut.
- **Passes with no consumer on screen** — already free by construction; [1/04](readme.md#04--the-frame-profile)
  prices them rather than deleting them.

## How the later steps use this

Every step in this chain closes with a line naming what it touched from the list — **normally `nothing`**.
A step that does touch a protected item does not report a removal: it reports the **cheaper version** it
built instead, with the measurement that says the item is still there. That is the whole protocol; the list
has no exceptions clause, because an exceptions clause is how a list like this stops being read.

The chain's own [Verification](readme.md#verification) re-reads it at the end against a RUNNING console —
cars and peds drawn, a palm moving, the hour changing the light, weather colouring the world. Not a
screenshot pair: a field verdict, per
[directive 4](../../../project-goals.md#4-better-must-be-demonstrated-not-assumed). Four of the six rows
above are silent, so the field verdict is not ceremony — it is the only instrument that covers them.
