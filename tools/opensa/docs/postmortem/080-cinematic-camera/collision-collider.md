# Postmortem (080 cinematic camera): a kinematic sphere COLLIDER for collision

**Status: ✗ REJECTED by reasoning, 2026-07-25.** Never coded. A physical camera collider is the wrong tool,
even though it seemed to fit the "slide along the wall, don't pull in" wish. Recorded so the idea is not
re-run from scratch.

Plan 080/04 collision ships a **single sphere CAST** with a near-plane cap (commit `4316967`), which PULLS
the eye in on a hit. Two field complaints drove the search for something better:

1. Driving through the city, the camera reacts to every pole/sign/tree on the subject→camera LINE.
2. When it hits a real wall it PULLS IN toward the subject, where a SLIDE (keep distance, move along the wall)
   would feel better.

## What was considered

Give the camera its own kinematic ball collider and move it with Rapier's `computeColliderMovement`
(character-controller step) each frame: it would react only to what the camera itself TOUCHES (a pole between
subject and camera, past the sphere, is ignored) and SLIDE along walls keeping distance. On paper it answers
both complaints, and "On Top" (lift overhead, no upward cast) was the intended fallback when boxed in.

## Why rejected — before any code

- **Sticking in tight spaces (the killer).** The game is full of narrow nooks packed with objects (alleys,
  yards, interiors). A character controller wedged between colliders can fail to find a slide direction and
  gets stuck / behaves erratically. This is exactly where the camera must stay reliable, and it is the classic
  reason spring-arm cameras in Unreal/Unity use a sphere CAST, not a physical body.
- **Corner jitter** — the solver twitches the sphere on geometry seams.
- **Tunnelling** on a fast car (the sphere can skip a thin wall between frames).
- **Statefulness** — a collider carries position state that must be reset on every teleport / respawn /
  vehicle entry, another failure surface.

A CAST has none of these: it is stateless, never wedges, and already computes the true sphere contact
(time-of-impact) — "real contact with a sphere" was never missing.

## What we kept

The simple single sphere cast + near-plane cap (commit `4316967`). The `slide` behaviour dies with the
collider (only a physical body gives it) — accepted. The other rejected model — a multi-ray fan that was
actually built and field-rejected (it JUMPED) — is in [`multiray-collision.md`](./multiray-collision.md),
which also carries the "On Top" revisit note.

## When to revisit

- True wall-SLIDE framing only a physical body gives, with the sticking/jitter/tunnelling mitigation above —
  a large investment (robust slide-direction search + On Top as a guaranteed escape + damping + teleport
  resets), only if a field round wants it badly enough. Absent that, the single cast is the answer.
