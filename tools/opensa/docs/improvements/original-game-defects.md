# Original-game defects and quirks we intend to fix

**The collecting place.** Anything wrong or odd about GTA San Andreas *itself* — a bug, a limitation, a
behaviour that reads as broken to a player — goes here the moment it is noticed, long before anyone decides
whether or how to fix it. The point is that nothing gets lost between "I saw that" and "we have a plan".

> ## ⛔ Before ANY work starts from this list
>
> **Show the user this video and wait for his direction:**
>
> **https://www.youtube.com/watch?v=R24KBNuOiR4**
>
> His call, 2026-08-11. Nothing here gets planned or built until he has seen it and said what it changes.

## What belongs here, and what does not

This file is a **backlog of defects in the ORIGINAL game**. It is deliberately upstream of every other
rubric — an entry here is an observation, not a commitment.

| | belongs here | belongs elsewhere |
| --- | --- | --- |
| A bug in stock SA nobody has scheduled | ✅ | |
| A bug in **our** build or engine | | [`docs/open-issues/`](../open-issues/) |
| A limitation we cannot lift | | [`docs/edge-cases/`](../edge-cases/) |
| An enhancement with no defect behind it | | the other files in this folder |
| Work we have decided to do | | [`docs/plans/`](../plans/) or [`docs/roadmap/`](../roadmap/) |

An entry graduates by becoming a plan; leave the row here with a pointer rather than deleting it, so the
list stays a record of what was noticed.

## The two rules that shape every fix on this list

Both come from [`docs/project-goals.md`](../project-goals.md), and they pull in opposite directions, which is
exactly why they are stated together:

1. **A defect in the original is not a spec.** We are required to improve on a 2004 compromise where we can —
   "that is what the original does" is the beginning of an argument, never the end of one. So a fix here is
   free to be better than the one the community shipped.
2. **The authored DATA still has to mean what its author meant.** A mod written against a quirk is a mod that
   must keep working. Fixing a *behaviour* is ours to do; silently re-interpreting a *data column* is not.

## Seed source 1 — SilentPatch's changelog

[SilentPatch](https://github.com/CookiePLMonster/SilentPatch) (CookiePLMonster) is the community's
accumulated list of what is broken in the 3D-era games, with the SA list at
[`CHANGELOG-SA.md`](https://github.com/CookiePLMonster/SilentPatch/blob/dev/CHANGELOG-SA.md). Read it as a
**defect inventory** — roughly 150 entries across 1.0 / 1.01 / Steam / RGL — not as a fix list to port.

**Two things about it that decide how we use it, and both are easy to get wrong:**

- **Our reference `sa` install already runs SilentPatch** (it is in the `_ESSENTIALS` set —
  [`reference-install-config.md`](../gta-sa-original/reference-install-config.md)). So on the `sa` target
  these defects are mostly ALREADY FIXED, by someone else's binary, and a field report from that target says
  nothing about whether the underlying defect exists. **In our own engine none of them are fixed**, because
  we implement behaviour from scratch — so this list is really the gap between the two hosts.
- **It is a binary patch of a 2004 exe.** Its solutions are shaped by what can be hooked, which is not our
  constraint. Take the *observation* ("X is wrong, here is when it shows"), then solve it our own way — and
  where its own fix reveals what the original code was really doing, that is source-of-truth material for the
  data→behaviour mapping (the standing rule about recovering the original's real formula).

The categories it covers, as a map of where to look rather than a copy of its contents: stability and
crashes; rendering and materials (lens flare, mirrors, coronas, resolution scaling); vehicles (damage
transfer between colliding cars, wheel detachment, garage/impound logic, tow and ladder attachments);
peds and animation (spawn randomisation, unused dialogue, minigame animation timing); physics and collision;
map and streaming (entity list sizes, flicker, interior car generators); audio; input and camera (mouse
sensitivity axes, an input-latency frame, in-car camera); save/load; HUD and text scaling.

## Seed source 2 — the video above

Not summarised on purpose: the gate at the top says it is watched first, with the user, and what it yields
gets written here afterwards in his words.

## The list

*(empty — entries land here as they are noticed. One row each: what is wrong, where it shows, and whether
anything is known about the cause.)*

| Defect | Where it shows | What is known | Status |
| --- | --- | --- | --- |
| — | — | — | — |
