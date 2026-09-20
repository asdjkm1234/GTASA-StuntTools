# The radar redraws a city outline that never changes

**Status:** priced, not taken. Measured 2026-08-22 for
[201/7-04](../../plans/201-dispatch-console/7-the-operator-map/readme.md); the count it comes out of is
[2026-08-22-dispatch-overlay-census](../../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json).

## What we do today

The radar (`apps/dispatch/src/map/minimap.ts`) repaints its whole dial whenever something on it moves: the
dark disc, the district outline, the view footprint, every unit and call, the ring and the north tick. One
repaint at the declared worst case — 150 units, 40 calls, a 160-box city — is **914 canvas calls**, and the
**district outline is 160 of them** (`rect` per box, one path).

The outline is the only part of that picture which cannot change: the boxes come from the pak's baked
`districts.json`, the world does not move, and the radar's scale is fixed to the world's extent. It is
redrawn ~20 times a second because the board ticks 20 times a second.

## The lever

Draw the outline once into an `OffscreenCanvas` the size of the dial, and `drawImage` it at the top of each
repaint. Every repaint then costs one blit plus the parts that actually move — roughly **914 → 760 calls**
on the census board, and the saving grows with the world: a total conversion with 400 zones pays 400 `rect`
calls a repaint today and one blit under the lever.

It also removes the only part of the radar whose cost scales with the WORLD rather than with the board,
which is the property that makes it worth writing down.

## Why it is not taken

- **The repaint is already conditional.** The dirty check means a still console draws nothing at all, so the
  saving applies only while the map is being moved or the board is ticking — the frames that are already the
  expensive ones for every other reason.
- **The number is a call count, not a millisecond.** Nothing here has been measured on a device, and the
  radar is a 132 px surface. Optimising a picture that may cost 0.05 ms would be tuning ahead of the
  measurement, which is what [directive 4](../../project-goals.md#4-better-must-be-demonstrated-not-assumed)
  forbids.
- **`OffscreenCanvas` is a second surface to keep in step** with DPR changes, resizes and (later) a second
  radar scale. That is real complexity for a saving nobody has felt.

## What would make it worth taking

- 2/03's device run attributing a visible share of the frame to the overlay canvas on a phone; or
- a world whose district table is large enough that the outline dominates the repaint (the scale at which it
  starts to matter is a few hundred boxes); or
- a second radar scale (district zoom), which would redraw the outline at two sizes and double the cost.
