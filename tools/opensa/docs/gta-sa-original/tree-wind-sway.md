# How the original sways a tree (2026-08-21)

**What this is:** the recovered mechanism behind the IDE flags `IS_TREE` (`0x2000`) and `IS_PALM` (`0x4000`),
read out of [gta-reversed-modern](https://github.com/gta-reversed/gta-reversed-modern) (`CEntity`). Recorded
because lod-trees plan 013 step 02 puts those bits on GENERATED impostor rows, and "what does the original do
with this bit" had to be answered before we wrote it rather than after a field round.

## The mechanism

`CEntity::PreRender()` calls `ModifyMatrixForTreeInWind()` when the atomic model info **sways in wind** —
`ami->SwaysInWind()`, the `IS_TREE` bit — and the entity is not an exploded object:

```cpp
if (ami && ami->SwaysInWind() && (!GetIsTypeObject() || !AsObject()->objectFlags.bIsExploded))
    ModifyMatrixForTreeInWind();
```

`ModifyMatrixForTreeInWind` writes the `at` vector of the entity's **modelling matrix** and calls
`UpdateRwFrame()`:

- above `CWeather::Wind ≥ 0.5` it interpolates the 16-entry `CWeather::saTreeWindOffsets` table by the
  entity's `m_nRandomSeed` and the clock, scaled by `Wind * 0.015`;
- below it, a `sin` of `(this + time) & 0xFFF` at amplitude `0.005` (×1.6 once `Wind ≥ 0.2`);
- `IsSwayInWind2()` — the `IS_PALM` bit — **adds** `Wind * 0.03`, which is why a palm's sway is the longer one;
- the offset is then projected onto `CWeather::WindDir` and passed through `CWindModifiers::FindWindModifier`
  (per-position local wind, e.g. helicopter downwash).

## What it means for us — three things

1. **The sway is a MATRIX shear, not a vertex program.** The whole entity leans; nothing about the mesh is
   touched. So the bit costs the same on an 8-triangle impostor card as on a 5 000-triangle tree, and an HD
   and its LOD carrying the same bit lean *together* — which is the point of putting it on the LOD row.
2. **It is per ENTITY, seeded by `m_nRandomSeed`.** Two instances of the same model do not sway in lockstep;
   an HD and its own far-LOD are different entities and will not either. At the switch distance only one of
   the pair is drawn, so this is invisible — it would only matter if both were ever visible at once.
3. **Nothing about a LOD entity changes the path.** `PreRender` gates on the model info and the exploded
   flag; the draw distance and the `lod` link are not consulted.

OpenSA does not use this code — our own sway is a vertex term in the weld (`packages/cell-weld`'s
`SWAY_TUNING`), gated by the SAME two bits through `swayKindFor`, so one IDE row drives both targets.
