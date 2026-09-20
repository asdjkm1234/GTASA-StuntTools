# 082/02 — Converter: plate submeshes + source-TXD keep rule + census

The offline half: after conversion, material names are gone — the `.osm` must carry the plate
information structurally. All work in `tools/opensa-pack` (`vehicle-osm.ts` / the vehicle builder).

**DONE 2026-07-28** — with section 1's split turning out to be a no-op (see the ledger). The change is one
tag in the SHARED builder, so a converted car and a modloader car get it from the same code.

## 1. Plate submesh split + flag

- During vehicle conversion, a material whose RW texture name is `carplate` or `carpback`
  (case-insensitive) emits its triangles into a SEPARATE submesh (the builder already emits
  vertices per material group since the 003 straddle fix — this is a grouping tweak, not a new
  pass), flagged in the submesh record: `plate: 'face' | 'back'` in DESC (extend the submesh
  serialization; absent = not a plate — old `.osm` readers unaffected, new reader of old files
  sees no flag → stock look).
- The flag must survive across ALL parts — body, `_ok`/`_dam` variants, doors, extras and vehicle
  LOD atomics (the idea's plan-004 edge cases) — the split runs wherever material groups are
  emitted, so this is by construction; the census (below) verifies it.
- The plate submesh KEEPS its stock texture layers too (the converted `carplate` texture stays in
  the model's array): a car whose plate was never assigned renders the stock placeholder — the
  graceful-degradation rule, and the reason the WGSL override (plan 03) is per-instance, not
  per-model.

## 2. `generic/vehicle.txd` keep rule (phase-0 check) — **CLOSED, no work owed**

opensa-pack 003's deletion rule removes a `.txd` when every model naming it converted. Checked
against the built pak on 2026-07-28: `build/original/opensa/models/generic/vehicle.txd` is present
(10 559 788 B) and still holds all six plate rasters. The dictionary is never "named" by a model, so
the deletion rule never reaches it — no keep rule, no exception. What plan 01 still owes is the
opposite guard: a test pinning that it survives a convert, so a future deletion-rule change cannot
silently take the plate sources with it.

## 3. Census (the idea's plan-004 sweep, now offline in the converter)

- A convert-time report (or a small standalone sweep over the stock vehicle set): per model —
  carries `carplate`? `carpback`? in `_dam` variants? in LOD atomics? any plate face in an atomic
  whose frame parent differs from the co-located damage part (the "standalone plate atomic" edge
  case — if hits exist, reparent at conversion into the part, and record the models).
- The census drives plan 04's verification scope and answers "which vehicles get plates" with a
  number instead of "most cars".

## Subtasks

- [x] DESC flag + reader support (`VehicleModelSubmesh` and the engine's `VehicleSubmesh` gain optional
      `plate: 'back' | 'face'`). No split was needed — see the ledger. Both `.osm` writer and reader pass
      submeshes wholesale, so the tag rides the format with no plumbing.
- [x] Fixture test: the real `admiral.dff` builds with both faces tagged, on the intact body AND on the
      `_dam` twin, every face a 2-triangle quad; and the tag survives the `.osm` round trip
      (`vehicle-osm.test.ts`).
- [x] `generic/vehicle.txd` fate check — it survives, and the guard already existed: `SHARED_TXDS` in
      `pack-vehicles.ts` holds `vehicle`, pinned by "never deletes a SHARED dictionary". A comment there
      now names plates as a second reason, so a future edit cannot drop it unknowingly.
- [x] Census sweep + ledger numbers. **The standalone-atomic edge case does not exist** (0 hits) — no
      reparent fix owed.
- [x] Reconvert — done by the user 2026-07-28; the field verdict on that pak is what closed the chain
      (every car wears its plate). Box struck 2026-08-12; it had outlived its own answer.

## Acceptance

- Converted plated fixture carries flagged plate submeshes on all variants; suite + no-data-loss
  green; census numbers in the ledger; `generic/vehicle.txd` guaranteed present in a converted dir.

## Ledger

Phase-0 pass, 2026-07-28 (`plate-census.ts` over the whole stock archive; `dump-osm-meta.ts` for the
built `.osm`):

- **14 865 DFFs scanned, 0 unparseable — 143 carry a plate material, 139 carry both.** The 4 with
  one only: `fbmp_c_st`, `wheel_gn5` (a wheel, 5 tris — inspect before assuming it is a plate),
  `rbmp_*` bumper mod parts.
- Every plate face is a **2-triangle, 4-vertex quad mapped over the full 0..1 UV rect** — both
  `carplate` and `carpback`, so a plate texture is never atlased into a larger sheet.
- `carpback` is the WHOLE plate, `carplate` a smaller text strip inset into it and 0.0057 units
  proud (admiral: 0.3090 × 0.1738 vs 0.2836 × 0.0793). They are layered geometry, not co-planar —
  no z-fighting risk from the split.
- Damage coverage confirmed on `admiral`: rear plate on the chassis geometry, front plate on BOTH
  `bump_front_ok` and `bump_front_dam`.
- **The split was already there; only the flag is owed.** `appendGeometry` emits one submesh per
  material group, so in `build/original/opensa` the plate faces already stand alone: 0 of
  `admiral.osm`'s 171 submeshes carry more than one texture layer, and the plate pairs read
  `carpback` = layer 12 (36 indices) / `carplate` = layer 13 (6 indices), three pairs on
  `bump_front_ok` and `numb`. Section 1's regroup is therefore a no-op — what remains is the DESC
  flag, because at runtime the material name is gone and the layer index is model-local.
- A first reading said the opposite (plates merged into 510-vertex submeshes). That was a **bug in
  `dump-osm-meta.ts`**, fixed in this pass: it read indices as `uint16` unconditionally while
  `buildVehicleModel` writes `uint32` past 65 536 vertices, so a wide model's indices were silently
  paired into nonsense. The built `admiral` is a mod car at **91 746 vertices**. Lesson for the
  ledger: a submesh straddling texture layers is not a finding, it is a decode error — `model-osm.ts`
  already THROWS on that condition at convert time, so the pak cannot contain one.
- **Damage / LOD / orphan sweep**: of the 143 plated models, **87 carry a plate face on a `_dam` twin**,
  **5 on a `_vlo` LOD mesh**, and **0 on a geometry no atomic references**. The last number retires the
  "standalone plate atomic" edge case this plan carried — there is nothing to reparent.
- **LOD meshes are deliberately NOT tagged** (user's call, and the builder's own precedent): a `_vlo` mesh
  only shows past the vehicle LOD swap, where the plate quad is a fraction of a pixel, so tagging it would
  buy a per-instance texture binding nobody can read. `materialClass` already de-features LOD the same way
  by forcing it MATTE. Those 5 models keep the stock placeholder at distance.
- **A lone plate face is not a plate.** The 4 one-face models are `fbmp_c_st` (a front bumper with only a
  `carpback`, on both its intact and `_dam` geometry) and `wheel_gn5` — a WHEEL whose 5-triangle material
  is merely named `carplate`. Plan 03/04 should require BOTH faces on the same part before assigning a
  plate to it; the admiral fixture test already pins that pairing.

### What the change was

One tag in the SHARED builder (`build-vehicle-model.ts`), read from the material's texture name exactly as
`lampTag` reads `vehiclelights*` — so a converted `.osm` car and a modloader DFF car get it from the same
line. Suite **2 986 green** (+5), `tsc` and `eslint` clean.

Also fixed on the way through: **`dump-osm-meta.ts` read every model's indices as `uint16`**, which
silently garbles any model past 65 536 vertices — the class of car this plan is about. It is what produced
the false "plates are merged" reading above.
