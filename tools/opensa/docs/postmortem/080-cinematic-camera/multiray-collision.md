# Postmortem (080 cinematic camera): the multi-ray collision fan — the WORST variant

**Status: ✗ REJECTED by field, 2026-07-25.** Built in commit `811bca9`, reverted the same day in `e1541ec`.
This was the single worst collision behaviour of the whole 080 chain — recorded prominently so it is never
re-run from scratch.

Plan 080/04 collision ships a **single sphere CAST** with a near-plane cap (commit `4316967`). Its known
weakness (field complaint): driving/walking past the city it reacts to every thin pole/sign/tree on the
subject→camera line and re-adjusts. The multi-ray fan was the attempt to fix that. It made things much worse.

## What it did

`resolveCollision` cast a 5-ray fan — CENTRE + 4 CORNERS offset by the subject's silhouette radius
(`subjectRadius`, ped framing radius / car half-extent) along the camera's `screenBasis` right/up — and
pulled the eye in ONLY when EVERY ray hit an obstacle closer than the desired distance (a wall spanning the
whole silhouette), capping at `min(hits)`. Any clear ray (a pole thinner than the subject) → no pull-in. The
intent: ignore poles/signs, still react to real walls.

## The field verdict (user)

Approaching a house *on foot*, **the camera immediately starts JUMPING instead of sliding** — worse than the
single cast it replaced.

## Why it jumps (root cause)

The "all rays hit" gate is **DISCONTINUOUS**. A single sphere cast reports a continuously shrinking distance
as you approach a wall, so the eye eases in smoothly — it *slides*. The fan instead flips the whole response
between two states — "ignore" (distance = desired) and "full pull-in" (distance = `min(hits)`) — the instant
the last/first corner ray catches or loses the wall. Real house facades are not clean infinite planes: they
have door/window recesses, columns, edges, a stoop. As the player walks toward one, the 4 corner rays (spread
~0.45 m off the eye line) catch and lose those features at different moments, so the all-hit gate toggles
rapidly and the distance snaps between full and none → visible jumping. The very feature meant to *reduce*
reactions turned a smooth ease into a binary flicker.

## The lesson (why this matters beyond this one attempt)

A hard "all N rays / none" boolean over a moving fan is the wrong shape for a feel channel — it has no
continuous middle, so it cannot ease. **Anything replacing the single cast has to stay a continuous function
of approach distance** (e.g. a weighted/soft coverage that varies smoothly, not a boolean gate), or it will
jump. A single continuous cast already has that property, which is why it feels better despite being "dumber".

## What we kept instead

The simple **single sphere cast + near-plane cap** (commit `4316967`, the state 080/04 ships):

- One sphere cast (radius `collisionRadius` 0.35) from the look point along −forward; whiskers OFF (they fired
  on objects BESIDE the subject).
- Asymmetric response — snap IN, `damp` OUT over `collisionReleaseTime`; CAPS the distance so the chosen zoom
  restores after the occlusion.
- Floor = `collisionMinDistance` (the near-plane radius 0.5): a wall closer than that pulls the eye up to the
  surface (may clip the ped a frame) but never slides BEHIND the wall and never stalls.

Accepted trade-offs: it reacts to thin poles on the sight line (the pole complaint is unsolved), and a very
close wall behind the player can clip the camera into the ped a touch. Both were judged better than the fan.

The other rejected model — a physical sphere COLLIDER (move-and-slide) — is in
[`collision-collider.md`](./collision-collider.md).

## When to revisit

- **The pole problem** needs a model that is a *continuous* function of how much of the subject is occluded —
  a soft coverage weight, not the boolean all-hit gate that jumped. Absent a design that keeps the ease, the
  single cast is the answer.
- **The into-the-ped clip on a genuine full pin** (a wall hard behind the subject, no room) could be answered
  by an **"On Top" fallback**: as the allowed distance collapses, ease the pitch up toward a top-down framing
  so the subject stays visible from above instead of the eye clipping into the model. Cheap (a pitch/height
  blend, no extra casts — and deliberately NO upward cast, so an indoor ceiling clips through, an accepted
  edge case). The risk is feel, not cost: it must BLEND with hysteresis (or it flips between behind-view and
  overhead in a tight alley) and ease back the moment open space returns. Only worth building if a field
  round finds real full pins frequent enough that the clip annoys.
