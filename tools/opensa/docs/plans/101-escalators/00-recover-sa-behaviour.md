# 00 — What SA actually does, and what we can already move

Part of [101 — Escalators in OpenSA](readme.md). **Research, no code.** Gates every other step.

## Why this comes first

The standing rule: dig out the original's real formula before fitting a constant of our own
(`docs/links.md` → gta-reversed). An escalator is all constants — step spacing, speed, where a step is
spawned and where it is recycled, how far a ped has to be to be captured — and every one of them invented by
us is a number a mod author will find wrong. This step recovers what can be recovered and says plainly what
cannot, so [02](02-moving-steps.md) and [03](03-carry-the-player.md) build on a record rather than on taste.

## Questions to answer

**From the original:**

1. How are the steps BUILT — a repeated step model instanced along the path, or a scrolling texture on the
   static mesh? (This decides everything downstream: the first needs per-step objects, the second needs
   nothing but a UV animation, which our engine already has from plan 099.)
2. Step spacing and speed, in the game's own units.
3. What happens at the ends: recycled to the bottom, faded, or clipped by the landing geometry?
4. How a ped is carried — a velocity added while standing, a parent transform, or collision friction against
   a moving surface?
5. What `direction` (0/1) actually selects, in the code rather than by inference.

**From our side:**

6. What can our engine already move? `OscellObject` has an `animated` kind (2) and plan 099 shipped a
   UV-animation lane for rigid/script objects — if SA's steps turn out to be a texture scroll, this chain may
   be one data row and no new lane at all.
7. Can our physics carry a body on a moving surface today? The character controller and the Rapier setup are
   the constraint; a moving platform is the general case, and an escalator is the cheapest instance of it.

**Record what is NOT recoverable.** SA's own draw-side functions are plugin-call stubs in gta-reversed for
several effects; if the escalator's are too, that goes in this file, so the next reader does not re-search
for them.

## Deliverable

A written answer to all seven, with the citations, plus a go/no-go on the shape: **texture scroll** (cheap,
possibly already possible) vs **moving step objects** (a new lane in the engine). The rest of the chain is
re-scoped against that answer before it is implemented — the step files as written assume the expensive shape,
which is the honest default until 00 says otherwise.

## Measurements / notes

_(record after the research)_
