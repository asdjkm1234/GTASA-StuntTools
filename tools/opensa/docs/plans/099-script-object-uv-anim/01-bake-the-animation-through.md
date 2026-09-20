# 099/01 — Bake the animation through (builder → fixture → `.osm` → reader)

The data exists at every stage except the rigid builder's output. This step threads it through
without touching the engine: after it, a rebaked `ferriswheel_lights.osm` SAYS it animates, and the
runtime reader hands the engine everything it will need in 02.

## Decisions

1. **The model owns its animations** (unlike the world, where the pak manifest owns a global list and
   cells index into it): `VehicleModelData.uvAnimations: RWUvAnimation[]` carries only the entries the
   model's materials actually reference, and each submesh gets an optional `uvAnim: number` — an index
   into THAT list (not a global slot). A script object streams in and out on its own; a global
   registry would leak names across models for nothing.
2. **Binding resolves at BUILD time, by the world's own rule**: material
   `effects.uvAnim.names[0]` → `clump.uvAnimations` by name (mirror `resolveUvAnim`,
   `packages/cell-weld/src/weld.ts:904` — an unknown name or empty keyframes = no animation, static
   geometry, never an error). Channel mask beyond UV0 is out of scope (the world lane ignores it too).
3. **DESC fixture: optional field, old files unchanged.** `VehicleFixture` gains
   `uvAnimations?: { duration, keyframes, name }[]` and submesh rows gain `uvAnim?: number` — the
   "absent on old fixtures" pattern (`bounds`/`center` precedent, engine.ts:374). No version bump, no
   migration; an old `.osm` decodes to "none".

## Subtasks

- [x] `build-vehicle-model.ts`: resolve material → dict entry in `appendGeometry`'s material walk;
      thread the model-local animation list into `VehicleModelData` + the submesh records.
- [x] `VehicleFixture` (renderware vehicle types) + `tools/opensa-pack/src/model-osm.ts` (the fixture
      is serialized as-is — verify nothing strips unknown fields) + `readModelOsm`
      (`packages/game/src/adapters/vehicle-osm.ts`) + `toRigidModelInit` → `VehicleModelInit`.
- [x] Tests (builder): a synthetic clump whose material references a dict entry → submesh carries the
      slot and the model carries the keyframes; an unknown name → no slot; a clump with a dict but no
      referencing material → empty list (negative cases first, per the house test structure).
      **Plus the real asset**: `ferriswheel_lights.dff` is now a fixture (one `MOD_MANIFEST` line) —
      nothing in the stock vehicle/prop set animates its UVs, so the binding could only be proven on it.
- [x] Tests (round-trip): encode a fixture with animations → `readModelOsm` returns them; an old
      fixture without the field → none. `tools/opensa-pack/src/model-osm-uv-anim.test.ts`, over the real
      ferris ring (positive) and the real admiral (negative — no key written at all).
- [x] `scripts/debug/dump-osm.ts` prints the animation row + the submesh it drives, both DERIVED from
      the keyframes (distinct u-offsets, smallest positive time step), so a scrolling sign describes
      itself as honestly as a film strip.
- [x] **Rebake the ferris models through the normal pipeline** and read the row back with
      `dump-osm.ts ferriswheel_lights` — done 2026-08-07 (the user's own rebuild); output in the ledger.

## Verification

`dump-osm.ts ferriswheel_lights` shows `uvAnimations: f13d (13 steps × 0.225 s, loop 29.25 s)` and the
`Frames` submesh flagged with its slot; every OTHER model's dump is byte-identical to before the
change (the builder emits the field only when a material references a dict). Record the fixture size
delta in the ledger.

## Ledger

**Decision that differs from the plan text:** `VehicleModelData.uvAnimations` is OPTIONAL, not a required
array. The fixture writer emits the key only when the list is non-empty (the `popUpLights` pattern beside
it), which is what keeps every other model's `DESC` byte-identical — an always-present `[]` would have
rewritten the whole pak's descriptions to say nothing.

**Sizes, 2026-08-07** (built through `buildModelOsm`, the production path, off the committed fixtures):

| model                        | `.osm`      | `DESC`   | of which `uvAnimations` |
| ---------------------------- | ----------- | -------- | ----------------------- |
| `ferriswheel_lights` (mod)   | 3 981 140 B | 20 512 B | 19 312 B (94 % of DESC) |
| `admiral` (stock, no anims)  | 261 708 B   | 44 178 B | 0 B — no key written    |

The animation JSON is large RELATIVE TO ITS DESC (261 keyframes × 6 floats, spelled out) and negligible
against the file: 0.49 % of the ferris `.osm`. Worth knowing before something with many animated materials
ships — the keyframes are a STEP animation and would compress to a cadence + a step count — but nothing in
the current corpus is anywhere near paying for that.

**Verification run 2026-08-07:** `build-vehicle-model.test.ts` 60/60 green (5 new: 3 negative — unknown
name, empty keyframes, unreferenced dict; 2 positive — model-local slot numbering, two materials sharing
one slot; plus 2 real-asset cases pinning `f13d`'s 261 keyframes / 0.225 s cadence / 29.25 s loop).
`model-osm-uv-anim.test.ts` 2/2. Affected suites `packages/renderware/src/vehicle` +
`tools/opensa-pack/src` + `packages/game/src/adapters`: 36 files / 365 tests green. `tsc --noEmit` and
`eslint` clean.

**The stated verification, run 2026-08-07 against the user's rebuilt `build/original/opensa`:**

```
section DESC: 20538 bytes · section GEOM: 2911680 bytes
textureSource: world · 51840 vertices
uvAnimation: f13d (261 keyframes, 13 distinct u-offsets × 0.225 s, loop 29.25 s)
submesh part=zzzz array=22 indices=151200 translucent=true uvAnim=0 (f13d)
submesh part=zzzz array=33 indices=60480 translucent=false
```

Exactly the row the step asked for: one animation, one flagged submesh, the other static. The CONTROL
(`dump-osm.ts admiral`) prints no animation row at all — the key is absent, as designed. Note the built
ferris DESC is 20 538 B against the 20 512 B measured off `buildModelOsm` above: the built one is
world-sourced and carries the per-submesh `array` refs the standalone build does not.

**A defect the verification itself surfaced** (and it was in the tool, not the data — lesson 15): `dump-osm`
read `manifest.textures` as a LIST, but it is a record keyed `array-<n>`. Every world-sourced model's arrays
therefore printed `MISSING FROM MANIFEST` while the game rendered them fine. Fixed in the same change; the
ferris now reports `array 22: 1024×1024, 16 layers` and `array 33: 4×4, 2 layers` out of 163 world arrays.
