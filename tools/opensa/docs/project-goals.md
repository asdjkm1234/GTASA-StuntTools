# Project goals — what OpenSA is for

**Read this before writing an idea, a concept or a plan**, together with
[`docs/restrictions/`](./restrictions/README.md). The restrictions say what a design **may not do**; this file
says what it **must aim at**. A plan that satisfies every restriction and none of these goals is still the
wrong plan.

This is a directive document, not a mission statement. Each rule below is meant to change what gets written.

## What this is

**A from-scratch, high-performance game engine that is COMPATIBLE with RenderWare — not a reimplementation of
GTA San Andreas.**

Compatibility is how a world gets in: DFF/TXD models, COL collision, IMG archives, IPL/IDE placement, the
`data/` tables, and the mods and total conversions built on them. It is the input format. **It is not the
specification for what happens after the file is read.**

San Andreas shipped in 2004 against a 32 MB console budget and a fixed-function pipeline. Everything it did
was right for that machine. Almost none of it is right for this one.

## The directives

### 1. Honour the authored DATA; do not port the LOGIC

These are two halves of one rule, and dropping either one breaks the project.

**Honour the data, because that is where the game actually lives.** `timecyc.dat` is the authored mood of
every hour of every weather in every region. `handling.cfg` is what each car is supposed to be. `carcols`,
`popcycle`, `cargrp`, the IDE flags, the COL surface types — all of it is design work somebody did, and the
mods and total conversions we exist to run are written in exactly those tables. **Read them properly or the
world stops behaving as it was authored**, and the failure is not a crash: it is a night that is the wrong
colour and a car that is nobody's car. Getting a column's meaning wrong is a bug, whatever the frame time
says. (This is why `CLAUDE.md` insists on recovering the original's real formula before fitting a constant:
a fitted constant is a place where the author's number is not being read yet.)

**Do not port the logic.** Recovering how SA's code worked is research, not a design. A plan may not justify a
decision with *"that is what the original does"* — that sentence is the beginning of an argument, never the
end of one. Its execution, its data structures, its per-frame compromises and its bugs are one machine's
answer from 2004, not a specification.

Same table, both halves: read `handling.cfg`'s suspension row exactly as authored, then integrate it with our
own solver rather than SA's.

### 2. Legacy limits are not our limits

**We have our own engine and our own formats now.** The pak, the `.osm` vehicle sections, the generated
far-LOD cells, the streaming grid — none of them are RenderWare, and none of them inherit its ceilings. A
constraint that exists because of a 2004 file layout, a 32 MB memory budget or an `int16` field is a
constraint on *the original*, and repeating it here is a choice we would have to defend.

The original's formats are an **import path**, not a storage format. When a limit gets in the way, the answer
is to lift it (as `asi/perfect-map` did with the `IplDef` ceiling) or to leave it behind in our own format —
not to budget the world down until it fits.

### 3. Where we can beat it, we are REQUIRED to beat it

A known defect of the original that we could fix and did not is a defect we have chosen to ship. "Faithful to
the original" is not a defence for a popping LOD, a streaming hitch, a hard object-count ceiling or a texture
that flickers.

The bar is deliberate: **improving on the original is the default, and matching it is what needs the
argument.** If a plan keeps the original behaviour, it says why in one line — usually because a mod's data
depends on it (see [The line we do not cross](#the-line-we-do-not-cross)), or because the improvement costs
more than it is worth and that cost is written down in
[`docs/performance/`](./performance/README.md).

### 4. Better must be DEMONSTRATED, not assumed

This is the directive that keeps directive 3 from becoming gold-plating, and it is the one this project has
already paid to learn.

Plan 081 chased SA-faithful vehicle physics through several rounds, and **every step toward authenticity made
the car feel worse** — the accepted feel is a deliberate deviation, and it was found by driving, not by
reasoning. So: a deviation is justified by a measurement in [`docs/benchmarks/`](./benchmarks/index.md) or by
a field verdict from the driver's seat. An improvement nobody can point at is an opinion, and opinions do not
get to change a system.

The repo's existing rules are how this is enforced: measure first, record every number before analysing it,
and end each plan phase with its before/after.

### 5. Performance is a requirement, not an outcome

The frame budget is part of the specification of every feature. A feature that works and costs 30 ms is not
finished.

Concretely, what "high-performance" has to mean in a plan:

- a **frame budget** the feature must fit in, named before it is built;
- what it costs **when the world is busy**, not on an empty street;
- and if the cheap version was rejected for a better-looking one, the cheap version goes in
  [`docs/performance/deferred-optimizations/`](./performance/README.md) with its price attached, so the
  decision can be revisited at 30 fps instead of redesigned.

### 6. The target is a AAA-grade game, and that is a measurable claim

"AAA" is not a mood. It is the absence of the things that make a world feel like a tech demo:

- **no hitches** — a frame the player can feel is a bug with a number attached, and the number is findable
  (`scripts/debug/slow-frame-census.ts` reads them straight out of a drive);
- **no popping** — geometry, LODs, textures and cars arrive before they are looked at, not while;
- **a world that is alive** — populated, lit, weathered and in motion, because an empty correct map and a full
  one look identical in a screenshot and nothing alike from a car;
- **it holds up in the field** — the last word belongs to someone driving, not to a bench.

### 7. The engine has two consumers, and the second one is not a game

`apps/dispatch` is a computer-aided-dispatch operator surface over the same streamed world: a top-down 3D
map, live units, a call queue, click-to-inspect. It runs with **no player, no ECS and no physics** — the
renderer, the streamer and one shared config→`Environment` driver, and nothing else. That makes it two
things at once: the project's proof that the engine layer stayed an engine, and the smallest complete
example of embedding it. It is also the only surface in this repo that runs on a phone.

**What that changes for a plan.** A feature that only works when a character, a physics world or a HUD
exists is a feature the second consumer cannot use. That is not automatically wrong — plenty of the game
belongs to the game — but it is a fact a plan states rather than discovers, and a feature that could have
been engine-layer and was written player-first is a boundary that quietly moved.

**What it does not change.** Same authored SA data, same contracts, same import path. This is not a
real-world mapping product (decided 2026-08-06): no geo import, no CRS layer. The console maps the world the
pak was built from, like everything else here.

**And what the second consumer does not license.** Two failure modes, both tempting:

- **Trading away a living world for a lighter one.** Cars and peds drawn, vegetation swaying, the day
  turning, the weather colouring the world — these are not overhead a "map view" gets to drop. Directive 6
  applies to the console exactly as it applies to the game; what may be trimmed is what a surface *provably
  never reads*, which is a measurement, not a category.
- **Splitting the platforms.** One engine runs on PC and on mobile. The difference between them is a
  **budget** — numbers the frame reads — never a branch it executes, and never a second renderer to
  maintain.

Worked chain: [plan 201](./plans/201-dispatch-console/readme.md).

## The line we do not cross

**Deviate in BEHAVIOUR; keep the CONTRACT.**

A mod author's files must keep working. The project's whole reason to exist is that you can point it at a
real installation, or at a total conversion somebody spent years on, and it runs. An "improvement" that makes
existing data stop loading is not an improvement — it is a different project.

So: we may change how a thing is executed, scheduled, lit, streamed or simulated. We may not change what a
file, a name or a data row is required to mean without recording it in `docs/contracts/`
([vehicles](./contracts/vehicles.md), [mods](./contracts/mods.md)) in the same change — and a name rule that
lives only in code is one no mod author can follow.

## How the original's source is actually used

There is an apparent contradiction between directive 1 and the standing rule in `CLAUDE.md`:

> **Dig out the original game's real formula before fitting a constant of our own.**

Both hold, because they are about different things:

| Question | Answer |
| --- | --- |
| *What does this data MEAN?* | Recover it from the original ([gta-reversed](./links.md)). Guessing here produces fitted constants, and a fitted constant is a debt (`docs/hacks/`). |
| *How should it be EXECUTED?* | Ours. The original's answer is one data point from a machine that no longer exists. |
| *Is this a LIMIT or a DESIGN?* | A limit (a field width, a memory budget, a format's shape) is theirs to keep. A design (a timecyc mood, a handling row, a zone's population) is the author's intent and ours to honour. |

Reading SA's source to learn that `suspension_force` is scaled by mass is doing the work properly. Copying its
integrator because it is what SA had is not.

## What this already looks like in the repo

These are not aspirations; they are the pattern to follow.

- **A hard limit removed outright.** SA's `IplDef` count is an `int16`; a big map corrupts. `asi/perfect-map`
  lifts the ceiling via sidecar hooks instead of budgeting the map down to fit it.
- **Content the original never had.** SA has no cell-level far LODs, so `tools/opensa-lod-generator` bakes
  them — the horizon exists because we generated it, not because we found it.
- **A cost the original paid every time.** Texture uploads used to stall a frame for 85 ms; a budget spread
  them to ~1.5 ms/frame ([the applied lever](./performance/applied/texture-upload-budget.md)).
- **A structure the original did not have.** SA draws one pass with a per-entity alpha reference; we classify
  cutout vs blend per texture, offline, once (plan 092).
- **A behaviour deliberately unlike SA's**, accepted from the driver's seat rather than from the source
  (plan 081's grip and stance).

## The check, when a plan is written

Six questions. A plan that cannot answer them is not ready:

1. **Which authored data does this read, and does it read it as the author meant it?**
2. **What does the original do here, and why is that not our answer?**
3. **What is better in our version, and what measurement or field verdict says so?**
4. **What does it cost per frame when the world is busy?**
5. **What contract does a mod author still get to rely on?**
6. **Does this need a player — and if it does, does it belong in the engine layer at all?**
