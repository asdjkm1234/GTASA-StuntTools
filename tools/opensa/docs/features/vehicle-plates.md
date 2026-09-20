# Vehicle license plates

**State: shipped, field-confirmed 2026-07-28** (plan [082](../plans/082-vehicle-plates/readme.md)).
Every spawned car wears a generated plate: text from a per-city mask, background by the city it SPAWNED in,
deterministic per placement, and the plate rides deform / door swing / part detach because it lives inside
the part geometry. The field verdict was the look one — plates are on the cars and read correctly; the
distribution drive, the bench guard and a ram test are listed unmeasured in the plan's readme.

**A pak rebuild is required** before any of this is visible — the plate tag is written at conversion time.
Cars from an older `.osm` carry no tag, take no plate, and render exactly as before.

## How a plate is put together

A plate is **two quads**, not one, and that shape comes from the DFF itself:

| Quad       | Source material | What it wears                                                          |
| ---------- | --------------- | ---------------------------------------------------------------------- |
| `carpback` | the whole plate | one of three STATIC city backgrounds (`plateback1..3` = SF / LV / LS)   |
| `carplate` | an inset strip  | a generated 64×16 text raster, unique per plate text                    |

The text raster is **opaque**, not alpha-keyed: the game's `RenderLicenseplateTextToRaster` `memcpy`s all
four channels of an 8×16 charset cell into a `rwRASTERFORMAT888` destination, and the charset's own light
ground IS the plate's blank field. That is how one glyph atlas serves all three backgrounds.

Glyph atlas (`platecharset`, 32×256): cells of 8×16, four columns, order `A–Z` then `0–9`, and the blank
cell at (column 0, row 9) — which is why the atlas is 256 tall for 144 px of ink. The grid is DERIVED from
the atlas size, so a mod may ship it at any resolution.

## Key files

| Concern                                  | File                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| Mask → text, text → raster (pure)        | `packages/game/src/vehicle/plate-raster.ts`             |
| Rasters out of `generic/vehicle.txd`     | `packages/game/src/adapters/plate-sources.ts`           |
| Atlas layer allocation (refcount + LRU)  | `packages/game/src/vehicle/plate-slots.ts`              |
| City + seed at spawn                     | `packages/game/src/vehicle/vehicle-plates.ts`           |
| Submesh tag at build time                | `packages/renderware/src/vehicle/build-vehicle-model.ts` |
| Atlas, per-instance row, shader          | `packages/engine/src/engine.ts`, `render/shaders.ts`     |
| The single spawn wiring point            | `apps/web/src/ui/engine-vehicles.ts`                     |

## Config

`vehicle.plates = { la, sf, vegas }` — a mask per city: `L` → a letter, `D` → a digit, `*` → either,
anything else passes through. Empty falls back to the game's own `LLDD DLL`. Eight characters max (a plate
has eight cells). **Applies to NEW spawns**; cars already on the street keep their plates.

## Determinism

The plate comes from a hash of (model, position quantised to centimetres). Same parked car → same plate
across LOD respawns, reloads and sessions. The position is quantised because a ground-snapped spawn can
land a float's breadth from the stored coordinate, and an unquantised hash would re-roll the plate every
respawn. A placement may carry an explicit `plate` string, which wins over the hash.

The city is read at the CAR's position, not the player's — a San Fierro car streamed in while the player
stands in Los Santos wears SF plates. Countryside and desert have no design of their own and take a
deterministic one of the three off the same seed, so a country road shows a stable mix.

## Typing a plate by hand

**F2 → Vehicles → "Plate (blank = auto)"** (2026-08-12): whatever is typed there is upper-cased, cut to the
eight cells a plate has, and stored ON THE PLACEMENT — so a LOD respawn re-applies the same number instead
of falling back to the hash. Leave it blank for the generated plate. This is the debug surface of the
`plate` field any placement may carry (a mission car would use the same one).

## Known gaps

- **The field verdict is the LOOK one only** (2026-07-28: plates are on the cars and read correctly).
  Distribution across LS/SF/LV, the countryside mix, atlas slots on a full-map drive and a ram test are
  carried by [098/08](../plans/098-all-land-vehicles/08-acceptance-close.md). The damage/detach BEHAVIOUR
  is unit-guarded since 2026-08-12 (the plate survives a deform swap, a detach and debris expiry), so what
  the drive owes is confirmation, not discovery.
- 5 of the 143 plated models author a plate face on their `_vlo` LOD mesh; those are deliberately NOT
  tagged (past the LOD swap the quad is a fraction of a pixel), so they keep the stock placeholder at
  distance.
- 4 models carry only ONE of the two faces (`fbmp_c_st` has just a background; `wheel_gn5` is a wheel whose
  material happens to be named `carplate`). They get whatever their single face resolves to — harmless, but
  a pairing rule per part would be stricter.
- The atlas holds 256 distinct plates. Past that, a car takes the blank plate rather than stealing a layer
  off a car on screen. Not yet measured against a full-map drive.
