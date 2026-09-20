# Budgeted static-collider builds

**Status: APPLIED 2026-08-04 (plan 200/3-02) — and NOT yet measured.** The lever is pulled; the before/after
that would justify it does not exist. Read the last section before quoting this as a win.

## What it does

A cell's static bodies used to be created in one call, in the promise continuation that received its
colliders. `PhysicsWorld.beginStaticColliders` makes that resumable, and `CollisionStreamingSystem` spends a
per-frame allowance (`COLLIDER_BUDGET_MS`, 1.5 ms) draining the builds in flight — splitting one spike into
slices, exactly as [the texture upload](texture-upload-budget.md) was split when a single array stalled a
frame at 15–85 ms.

## Why

Plan 091 measured a cell's Rapier body build at **5.6–28.1 ms**, on the main thread, in a continuation no
loop timer reaches. A cold district entry pays it for ~95 cells. With the COL parse moved to build time
(200/3-01) this is what is left of that spike.

## What it costs, and the part to watch

**Streaming margin.** The collision radius is sized so a cell's colliders are ready a cell before the player
reaches it. A build now eats into that margin: at 120 Hz the worst cell (28.1 ms of work at 1.5 ms/frame)
lands over ~19 frames ≈ 160 ms, comfortably inside it. **On a phone's frame rate it is proportionally
worse**, and the phone is this cycle's target — so the margin, not the average frame time, is what a
measurement of this must look at.

Two rules the implementation follows for the same reason:

- **A cell is not `loaded` until its build is whole.** Announcing a half-built cell would let a car spawn
  where only half the ground exists — the restriction in
  [architecture.md](../../restrictions/architecture.md) about creating a dynamic body where its static
  collision already exists.
- **An abandoned build removes exactly what it created.** The build owns its handles, so walking away
  mid-build (or a `reload()` from the clutter knobs) leaves no orphan bodies in the world.

The budget is **one allowance per frame divided across the builds in flight**, not one each: a teleport into
a fresh district has many cells arriving together, and per-build budgets would multiply the cost by the
number of them.

## What is owed

`COLLIDER_BUDGET_MS = 1.5` is borrowed from the texture drain because that is the one budget of this shape
the project has validated in the field. It is a **budget, not a measured property of anything**, and it has
never been checked against a real cold district entry. The measurement this needs:

- the `[slow]` census on a cold district entry, before and after, on the same tree;
- **the margin**, not the mean: does anything arrive at a cell before its collision does;
- the same on a phone once chain 2 makes a district loadable there.

Until that run exists the improvement is expected rather than demonstrated, which by this project's own
rules makes it an opinion.
