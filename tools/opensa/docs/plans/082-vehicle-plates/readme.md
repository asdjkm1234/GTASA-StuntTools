# 082 — Vehicle license plates (per-vehicle, city-correct, damage-riding)

**Status: CLOSED 2026-07-28** — 01–04 shipped, the pak was reconverted and the field verdict is in: the
game boots and every car wears its plate. One defect surfaced on that first real boot and was fixed
(a WGSL uniformity error in `rigidTexel`, see plan 03); it never reached the plate logic itself. What the
session did NOT measure is written down under [Left unmeasured](#left-unmeasured) — it is small, cosmetic
and reopenable, not silently dropped.

Supersedes the idea chain `docs/ideas/0.4.0/plans/01-plates/`
(2026-07-12) — rethought for the own WebGPU engine; the idea was written against the deleted
three-WebGL path (`MeshStandardMaterial.map` swap in `buildVehicle`, `DataTexture`) and its central
mechanism no longer exists.

**Goal:** every spawned vehicle wears a generated license plate — text from a mask DSL in config,
background by the city it SPAWNED in (`plateback1/2/3` = **SF/LV/LS**, measured — see phase 0),
deterministic per placement (same parked car → same plate across LOD respawns and reloads), and the
plate rides damage: deform swap, door swing, part detach. Vanilla SA does exactly this
(`CCustomCarPlateMgr`); stock assets ship the glyph atlas (`platecharset`) and the three backgrounds
in `models/generic/vehicle.txd`.

## What survives from the idea, and what had to be rethought

**Survives (pure/game-layer):** the mask DSL (`L`/`D`/`*`/literals, default `LLLD DDL`), seeded
deterministic text (placement-hash seed), city-at-spawn-position via `cityAt` (`zones/city.ts`),
out-of-city deterministic pick, config shape `vehicle.plates = { ls, sf, lv }`, the CPU compose
(background + glyph blit — pure RGBA work), and the core insight that **plate faces live INSIDE
part meshes**, so damage/detach/door support falls out of part architecture rather than new
attachment code.

**Rethought (the engine is different):**

1. **There are no per-vehicle materials to retexture.** A vehicle is a converted `.osm`
   (opensa-pack 003): `createVehicleModel(VehicleModelInit)` uploads texture ARRAYS shared by
   every instance of that model; submeshes reference `array` + per-vertex layer (`meta.x`)
   (`packages/engine/src/engine.ts:315-360`). Swapping a layer in the model's array would change
   ALL instances of that model at once. **Per-instance plates therefore need a different carrier.**
2. **The carrier: one shared PLATE ATLAS texture array + a per-instance slot index.** The engine
   already has per-instance rows next to the matrix buffer — paint (64 B/row) and lamps (16 B/row,
   with two spare components, `engine.ts` `LAMP_ROW_BYTES` comment). A plate slot index rides the
   same mechanism; plate-tagged geometry samples the plate atlas at that slot instead of the model
   array. Runtime-generated plates upload into free atlas slots (fixed capacity + LRU, the
   texture-LRU precedent from plan 21).
3. **Plate faces must be identifiable AFTER conversion.** The DFF marks them with material texture
   names `carplate`/`carpback`; opensa-pack's vehicle builder must split them into their OWN
   submeshes and tag them (the `MaterialClass`-in-`meta.w`-nibble precedent from 074/16) — at
   runtime names are gone.
4. **Plate sources come from the game VFS at boot** (parse `generic/vehicle.txd` once — RW parsers
   are permanent runtime code per opensa-pack 003), BUT the pack's `.txd` deletion rule may have
   deleted it. **Phase-0 check with a keep-rule fix if needed** (plan 02).
5. **Spawn choke points multiplied**: parked/`carGeneratorPlacements`, popcycle road cars, the 841
   bench road cars, the F2 debug spawner — all flow through the host's `spawnVehicle`
   (`engine-vehicles.ts:211-293`), which stays the single wiring point.

## Phase 0 — measured before a line of code (2026-07-28)

Every number below is measured, not assumed; the throwaways that produced them are named per item.
Two of them CORRECT this readme's original design text.

1. **The keep-rule check PASSES — no converter exception needed.**
   `build/original/opensa/models/generic/vehicle.txd` survives packing and still holds all six
   plate rasters (`platecharset`, `plateback1..3`, `carplate`, `carpback`). The built file is
   10 559 788 B against the stock 1 360 296 B — a mod replaced its contents wholesale, which is
   exactly why this was read out of `build/`, not `game-src/`.
2. **`plateback1/2/3` = SF / LV / LS** — the readme's original "LS/SF/LV" was wrong. Measured by
   reading the stock rasters as images (`plateback1` = SAN FIERRO, `2` = LAS VENTURAS, `3` = LOS
   SANTOS) and confirmed by the reversed source's `eCarPlateType { SF = 0, LV = 1, LA = 2 }`. The
   installed mod keeps the same semantics (`1` = CALIFORNIA, `2` = NEVADA, `3` = CALIFORNIA, a
   second design), so a city rule written against the INDEX stays correct under mods.
3. **`carplate` and `carpback` are two DIFFERENT quads, not one plate face.** Measured on
   `admiral`: `carpback` is the whole plate (0.3090 × 0.1738 model units), `carplate` a smaller
   text strip (0.2836 × 0.0793) inset into it and sitting 0.0057 proud, both mapped over the FULL
   0..1 UV rect. This kills plan 01's original "background + glyph blit into one raster" compose —
   one composed raster drawn on both quads would double-draw the design. The game's split is the
   correct one and the cheaper one: **`carpback` ← one of three STATIC backgrounds (a city index,
   no per-instance raster at all); `carplate` ← a generated text-only raster with alpha.**
4. **Plate faces ride the damage parts for free**, as the readme predicted — now confirmed:
   `admiral`'s rear plate sits on the chassis geometry, the front plate on BOTH `bump_front_ok`
   and `bump_front_dam`. No attachment code is owed.
5. **Census** (`.tmp-plate-census.ts` over the whole stock archive): 14 865 DFFs scanned, 0
   unparseable, **143 carry a plate material, 139 carry both**; 4 carry only one (`fbmp_c_st`,
   `wheel_gn5` and two bumper mod parts). Every plate face is a 2-triangle quad.
6. **The submesh SPLIT is already done by construction; only the FLAG is owed.** `appendGeometry`
   emits one submesh per material group, so a plate face is already its own submesh — verified in
   the built `admiral.osm`: 0 of 171 submeshes carry more than one texture layer, and the plate
   pairs sit alone (`carpback` → layer 12, 36 indices; `carplate` → layer 13, 6 indices; three
   pairs, on `bump_front_ok` and `numb`). What a converted model still cannot say is WHICH submesh
   is a plate: the material name is gone and the layer index is model-local. A reconvert is
   therefore still required, but for a DESC flag rather than a geometry regroup.

   This corrects a first reading of the same file that reported the plates merged into 510-vertex
   submeshes. That came from a **bug in `dump-osm-meta.ts`**, now fixed: it read the index buffer as
   `uint16` unconditionally, while `buildVehicleModel` writes `uint32` past 65 536 vertices. Reading
   a wide model narrow does not throw — it pairs up halves of real indices and invents submeshes
   straddling several layers. The built `admiral` is a mod car with **91 746 vertices**, so it was
   over the ceiling. Any past reading of a mod car through that script is suspect.

## Sub-plans

| #   | Plan                                                   | One-liner                                                                                                |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 01  | [Plate raster generation](01-plate-raster.md)          | Pure module: mask DSL + seeded text + charset→RGBA compose; sources from the VFS TXD.                    |
| 02  | [Converter: plate submeshes](02-converter-tagging.md)  | opensa-pack tags `carplate`/`carpback` into own flagged submeshes; keep-rule for the source TXD; census. |
| 03  | [Engine: plate atlas + slot](03-engine-plate-atlas.md) | Shared plate atlas array, per-instance slot row, WGSL sample override, slot LRU.                         |
| 04  | [Config, seeding, damage](04-config-seeding-damage.md) | `vehicle.plates` config + city/seed resolution at spawn + damage/detach verification.                    |

Order + rationale: [priority.md](priority.md).

## Ground rules

1. Pure modules first (raster gen, plate resolution) — unit-tested headless; engine/converter
   changes are thin and each carries a fake-device or fixture test (the 077 seam).
2. **A reconvert is required after plan 02** (submesh split changes `.osm` GEOM) — batch it with
   other pending converter work if possible; old paks/osm without the flag render exactly as today
   (plates simply stay stock — graceful degradation is a format rule).
3. Determinism: no `Math.random()`; seeds derive from placement (model + position hash).
4. Measurements ledger per plan (standing rule): atlas memory, slots used on a full-map drive,
   spawn-time overhead, census numbers.
5. Field verification uses the engine-lab vehicle look bench (`?vmodel`) for close-ups and a city
   drive for distribution; feel/look verdicts freeze defaults.

## Left unmeasured

**Deferred to 0.5.0 on 2026-08-01** by the user's call while closing out 0.4.0 — they belong to the next
vehicle round, [098 — all land vehicles](../098-all-land-vehicles/readme.md) (which superseded
`roadmap/0.5.0/plans/04-all-vehicle-types/`), not to a pass of their own. The plan itself stays closed and
shipped in 0.4.0. **The handoff is now a real row over there**, in
[098/08 — acceptance & close-out](../098-all-land-vehicles/08-acceptance-close.md) (added 2026-08-12: from
2026-08-01 to then this section pointed at a chain that carried no plate task at all, so "deferred" meant
"dropped" in practice).

Closed on a binary verdict (plates are there and look right), which is what this feature was gated on.
These stayed open and are worth a single pass whenever a vehicle round comes up again:

- The **city distribution** over a real LS→SF→LV drive and the countryside mix — the rule is unit-tested
  at the car, but never watched across the map.
- The **bench guard** of plan 03 (draws/GPU unchanged on the vehicle scene) and the atlas numbers plan 04
  owes: slots used on a full-map drive, spawn overhead.
- **Damage/detach in the field** — ram a plated car. Structural by construction (02 measured 87 of 143
  models carrying a plate on their `_dam` twin), so this is a confirmation, not a risk.
- ~~The **F2 debug-spawner plate input** and the damage/detach integration tests.~~ **Both DONE
  2026-08-12** — F2 → Vehicles has a "Plate (blank = auto)" field that rides the placement (so a LOD
  respawn re-applies it), and two tests pin the lifetime claim from both ends: the engine keeps the plate
  row through a damage swap and a detach, and the real damage system's full hit → deform → detach → debris
  expiry never releases the atlas layer. Detail in
  [04's close-out ledger](04-config-seeding-damage.md#close-out-ledger-2026-08-12). **What remains under
  this heading is field MEASUREMENT only** — three bullets above, now carried by 098/08.
