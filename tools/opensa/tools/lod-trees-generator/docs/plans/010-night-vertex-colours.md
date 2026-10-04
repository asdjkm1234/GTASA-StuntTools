# 010 — Night vertex colours on impostors

**Status: ✅ Implemented.** Bake a night vertex-colour set onto each tree impostor so it darkens after dark like
the HD, instead of staying at its baked-in day brightness.

## Problem

SA models carry a **night** vertex-colour set (`0x253F2F9` / `rpEXTRAVERTCOLOUR`, one RGBA per vertex) that is
much darker than the day prelit (measured: trees are grey ~110 by day, ~15–40 at night). With **no** night set, SA
reuses the bright **day** prelit after dark. The impostor pipeline rebuilds the card DFF over a template and
`stripExtraVertColour` scrubs the template's stale set — so the impostor shipped with **no night set** and was
**too bright at night** while the HD darkened (user-reported).

## Fix

The impostor atlas already **bakes the source tree's day prelit** (the card raster modulates the texture by the
day vertex colours — that's why day looks right). So the correct night value is a **ratio**, not the absolute night
colour: `night = 255 × nightAvg / dayAvg` per channel. At render time `atlas(day) × night = texture × nightColour`,
matching the HD.

- `io.ts loadTree` computes `computeNightTint(dff)` from the source geometries' `prelitColors` vs `nightColors`
  (per-channel average ratio, clamped 0–255) → `HdTree.nightTint`. Absent when the source has no night set (then
  the HD is day-lit at night too, so the impostor should be as well).
- `core/render.ts` carries it onto `Impostor.nightColor`.
- `adapters/gta-sa/dff-edit.ts` gains `setNightColour(dff, colour)` — writes a fresh `0x253F2F9` set (one RGBA per
  vertex, `u32(1)` prefix) onto every geometry, replacing any existing one. `encode-dff.ts` calls it **after**
  `stripExtraVertColour` (which clears the template's stale set), so nothing removes it.

Do **not** rely on the map-optimizer codec's `addNightColorsIfMissing` here — it skips when a (stale template) set
is present, and the later `stripExtraVertColour` would delete it anyway.

## Tests

- `dff-edit.test.ts` — `setNightColour` bakes one RGBA/vertex and replaces (not duplicates) an existing set.
- `io.test.ts` — `loadTree` derives `nightTint` as `255 × nightAvg/dayAvg` from a real HD-tree fixture
  (`fixtures/original/dff/night-colours/cedar1_hi.dff`, via `npm run test:fixtures`).

Verified on real assets: `ash1_hi` (day 143 / night 24 → tint 42), `dead_tree_14` (per-channel `[16,21,24]`). See
the `lod-generator-night-vertex-colours` memory. The sibling case (decimated copy, absolute night) is
sa-procobj-placement plan 006.
