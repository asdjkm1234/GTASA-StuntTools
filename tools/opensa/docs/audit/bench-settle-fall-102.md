# Audit — plan 102: the bench settle fall (2026-08-09, one day, merged `ed6b90ba`)

The sweep could not measure itself. Two identical runs of an unchanged pak disagreed by 10.19 % on
`avgTriangles`, and nobody could say why. Plan 102 found the reason — the player was falling out of the world
during the capture — fixed it, and left an instrument that refuses a contaminated row. This is the close-out,
written adversarially: the parts that did NOT hold up are the point of it.

## What changed

- **The settle became a chain of gates** (`engine-perf-runs.ts`): 1 s teleport notice → the ring drains →
  ground is FOUND under the anchor → the player is warped onto **that ground** → wait until he is **at rest**
  (capped at 3 s) → warmup. The first two are the recipe phys and video runs already carried; the rest is new.
- **A warp reset derived in the controller** (`character-controller.system.ts`): a kinematic body lands
  exactly where it was asked to, so a body more than 5 m from where the controller left it was moved by
  something else — velocity, air FSM and `fallSpeed` go. No warp path has to remember to ask.
- **A permanent leg-start probe** in the bench report (`legStart`), red-flagging its own row and printing
  `[fall]`, plus the `[cam]` streak marker written while diagnosing.
- **One content fix**: `strip-noon`'s anchor stood inside the Flamingo and had never produced a valid row.

## What it bought, measured

| | before | after |
| --- | --- | --- |
| A/A `avgTriangles` spread, `lv-night` | 10.19 % | **0.14 %** |
| …`sf-fog-dawn` | 6.00 % | **0.36 %** |
| `[cam]` jump lines per run | 89 255 | **1** |
| scenes reporting `legStart.ok` | no instrument existed | **9 of 9** |

And the answer the re-take was owed: **d1 ≡ d3** under the noise floor, confirming the 2026-08-08 audit
("the selector shipped, the density lever did not exist") on an instrument that can now be trusted.

## What it cost

Six commits of code and docs, three headless sweeps by me and four display sweeps by the user, plus one
false-alarm regression that cost a round trip (below). The settle is 1–4.5 s longer per scene; a sweep of nine
scenes pays under a minute for it, outside every capture window.

## The parts that did not hold up

**1. Two of the three "red tests first" pinned less than they claimed.** T3 placed its floor exactly under
the capsule's feet, so "warp to the anchor" and "warp onto the ground" were the same point — the suite could
not see the defect the field then found on the very first sweep. Written up honestly at the time; the gap
itself survived until this audit.

**2. The audit's own replacement test was wrong twice before it was right.** Written to assert leg-start
state, it passed with the fix reverted — the rest gate rescues any floor within 4.5 s of fall. Rewritten to
assert the lowest point, it passed again — the player is already falling from the anchor while the gates wait,
so both versions bottom out on the same floor. Only the third form discriminates: **total descent per scene
transition**, 98.96 m reverted against ~45 m fixed. Each wrong version had a plausible story attached.

> **The rule this earns:** a test is not written until it has been run against the reverted change. Two of
> three attempts here passed for a reason that had nothing to do with the fix, and each one would have shipped
> as evidence.

**3. So the ground-warp buys less than the plan claimed.** It does NOT decide the leg-start state — the rest
gate does, and would alone. What it decides is how far the player is made to fall per scene transition, once
instead of twice. That still matters (residency is anchored to him, so every metre empties and refills the
district) but the plan text implied it was the thing making legs start clean. It is not.

**4. A ceiling nobody had noticed.** `GROUND_PROBE_DROP` is 60 m, and `ocean-horizon`'s anchor stands 43.75 m
above its floor. An anchor further up than the probe reaches finds no ground and the settle falls back to it
**silently**. Now documented at the constant and in the harness guide; still uncaught by any guard.

**5. A wrong diagnosis, built from two correct systems.** `strip-noon` was written up as "the world has a hole
here" on the strength of nearby cars reporting `no ground` (that is the spawn gate at the 150 m collision
ring, working) and the district emptying (that is residency culling around a player 890 m down, working). The
anchor was simply authored inside a building. Kept in full at
[`open-issues/fixed/strip-noon-anchor-inside-a-building.md`](../open-issues/fixed/strip-noon-anchor-inside-a-building.md).

**6. One regression report that was not one.** A display sweep came back with every scene's p95 2–3× worse;
the re-run matched the earlier numbers to the millisecond. The tell was `ocean-horizon` — no cars, identical
geometry, untouched by the change under test, and its p95 doubled anyway. **A scene that cannot have been
affected moving with the rest is the signature of a session-wide cause.** Now a line in the benchmarks
comparability checklist, and the reason the anomalous run is kept with every cost column marked unreadable.

## What the field found that the suite could not

Both defects that reached the field came from the same blind spot: **the suite chose its own world, and chose
one where the distinction under test did not exist.** A floor under the feet, an anchor on the ground. The
field's world is authored by hand for a camera, and six of nine anchors stand metres above their floor.

The suite did find the defect in the *fix* — `groundBelow` answering with the caster's own capsule, which made
the ground gate open on a world with no collision at all. That one is in
[`edge-cases/physics-runtime.md`](../edge-cases/physics-runtime.md); nothing catches a missing exclusion.

## Left open

- The city-scale **simulation residency** question (three streaming radii, two distance metrics, no
  authoritative readiness signal) stays a design track — its measured symptoms were this harness bug and are
  gone, and nothing currently forces a mechanism. The user's position is that residency SHOULD be anchored to
  the player; the open issue now says so.
- `WARP_DISTANCE` is a threshold, not a signal: a fall fast enough to cover 5 m in one step would read as a
  warp. Unreachable in a world with a floor, and a floorless one has already lost.
- 07/04's two perf budgets, still owed.
