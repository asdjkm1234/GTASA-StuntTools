# Two `PhysicsWorld` collider defects (+2 smaller)

**Status: ✅ ALL FOUR FIXED (2026-07-18), the same day they were found.** They surfaced while writing unit tests for
previously untested code during [plan 077](../../plans/077-unit-coverage/readme.md), were recorded here unpatched
first (a coverage pass that also changes behaviour cannot tell you which change broke something), and
were then fixed as a separate, self-contained commit. Kept as the record of what was wrong and why the
fixes are shaped the way they are.

## 1. `createFalling`'s box fallback was unreachable — an unhullable prop CRASHED ✅ FIXED

`packages/game/src/physics/physics-world.ts`.

The code read as "convex-hull the mesh, or fall back to a box":

```ts
const desc = ColliderDesc.convexHull(vertices) ?? ColliderDesc.cuboid(...);
```

**But `ColliderDesc.convexHull()` does not return null for degenerate input — it returns a non-null,
INVALID descriptor.** `??` therefore never fired, and `world.createCollider(desc)` threw instead. A
breakable prop whose mesh could not be hulled (degenerate/duplicate geometry, a flat 2-triangle sign)
took the frame down when it toppled rather than falling back to its bounding box.

The proof this is Rapier behaviour and not a theory: `addConvexChassis`, twelve lines below in the same
file, already guarded the same call for exactly this reason.

**Fix:** mirror `addConvexChassis` — a `length >= 12` pre-check (a hull needs 4 points) plus try/catch,
falling through to the placed cuboid. **Regression tests:** an empty mesh and a two-point mesh both now
land on the ground instead of throwing. Note what they assert — not merely that no exception escapes,
but that the fallback body **behaves**: it falls and comes to rest at ground height.

## 2. `setColliderEnabled` reported success and did nothing ✅ REMOVED

`setEnabled(false)` left `isEnabled()` reporting `false` while the collider kept blocking solidly
(verified by re-fetching the collider wrapper and by waking/teleporting the parent body, in case it was a
sleeping-island artefact).

**Resolution: deleted** (user decision). It had zero callers, and the path that actually works — the one
`enter-vehicle.system.ts` uses — is `setColliderSensor`. A method that reports success and does nothing is
worse than a missing one: it passes review and fails in the field. If collider disabling is ever wanted,
it should be re-added with a test that proves a body passes THROUGH, not that a flag reads back.

## 3. `roadsignGlyphIndex` reached the prototype ✅ FIXED

`COMMAND_GLYPHS` was an object literal, so `roadsignGlyphIndex('toString')` returned a `Function`,
violating the declared `null | number`. Unreachable from `roadsignGlyphQuads` (it only ever passes single
characters), but the signature was a lie.

**Fix: it is a `Map` now** — which kills the class of bug rather than guarding one instance of it.
(`Object.hasOwn` was the first attempt and needs an ES2022 lib the project does not target.) Regression
test covers `toString` / `constructor` / `hasOwnProperty` / `__proto__`.

## 4. `mat4Multiply` cannot alias `out` with `a` ✅ DOCUMENTED (deliberately not guarded)

`packages/engine/src/core/math.ts`. The loop writes `out` column by column while still reading every
column of `a`, so `mat4Multiply(m, m, b)` — "multiply in place", which is exactly what three's
`m.multiply(b)` does and therefore what this codebase's heritage invites — silently corrupts. Aliasing
`b` is safe: its column is copied to locals before any write.

**Deliberately NOT guarded.** The guard costs a 16-element copy on a per-frame hot path, for a case no
caller has. The constraint is documented on the function instead, where someone about to write the
aliasing call will read it. If it ever needs enforcing, a dev-build-only `out !== a` assertion is the
cheap middle ground.
