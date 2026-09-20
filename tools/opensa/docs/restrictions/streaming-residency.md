# Streaming residency: what a surface may decide from its VIEW

**The rule.** A streamer may narrow what it keeps resident to what the camera can see **only when nothing
behind the camera is simulated**. The map surfaces qualify; the game does not.

Recorded 2026-08-22, when [201/1-05](../plans/201-dispatch-console/1-the-map-profile/readme.md) gave
`StreamingDriver.update` an optional view and made the residency set the frustum's rather than a radius'.

## Why it is a restriction and not a preference

The dispatch console has no player, no physics and no ECS — a cell it cannot see contributes nothing but
bytes, so not fetching it is free. The game is the opposite: the cell behind the player carries the collision
its car is standing on, the traffic about to appear in the mirror, and the ground a dynamic body may only be
created over. That last one is already a restriction of its own
([architecture](architecture.md): *a dynamic body may only be CREATED where its static collision already
exists*), and a view-gated streamer breaks it by construction — turn the camera and the world behind it stops
being resident, so the next spawn lands in a hole.

So the gate is **passed in by the host, never inferred**. `apps/web` (the game shell) and
`apps/standalone` call `update(focus)` and keep the rings; `apps/dispatch` calls `update(focus, view)`. A
driver that decided this for itself — "there is a camera, so gate on it" — would be one refactor away from
gating the game.

## The three things that keep it safe where it IS used

- **The gate only ever REMOVES.** The LOD ring stays the outer reach: a frustum runs to the far plane, and a
  view that widened the set would stream the far side of the map the moment the operator tilted towards it.
- **Eviction stays radial.** A cell that left the screen because the operator turned is one they are about to
  turn back to. Unloading on a turn thrashes the fetch queue for a saving the ring already bounds.
- **What is near stays resident whichever way the view faces.** A turn is instant and a fetch is not, so
  everything inside the HD ring is exempt from the frustum test.

## What makes it silent

**A cell that is missing because nobody asked for it looks exactly like a cell that has not arrived yet.**
There is no error, no warning and no failed request — the world simply has a hole in it, and on a map that
reads as "the pak is still loading" rather than as a policy bug. Nothing in this repo's test suite can see
it either: the residency tests assert what a driver requests, and a driver asked to gate on a view it should
not have gates correctly.

Two halves of the design are what catch it in practice, and both are structural rather than tested:

- the host must **opt in** (the game cannot acquire the gate by accident — it would have to pass a view it
  does not compute);
- the gate is **all-or-nothing per pak**: a manifest whose cells do not all state `aabbY` cannot be
  frustum-tested at all, and the driver keeps the rings rather than guessing a height. A guessed height is
  the same silent hole one storey up — a tower streamed out from under a pitched camera.

## Where it is checked

`packages/engine/src/stream/residency.ts` (`verticalExtents` returns `null` for a pak that does not state
every height) and `StreamingDriver.update`'s optional `view` parameter. Tests:
`packages/engine/src/stream/residency.test.ts`, `streaming.test.ts` (*"ignores the view on a pak that states
no cell heights"*, *"does not evict a loaded cell for leaving the view"*).
