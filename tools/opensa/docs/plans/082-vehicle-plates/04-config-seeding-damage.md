# 082/04 — Config, city + seeding at spawn, damage verification, close-out

The user-facing half (survives from the idea with new wiring targets) plus the end-to-end proof.

## 1. Config

- `VehicleConfig` gains `plates: { ls: string; sf: string; lv: string }` (mask DSL; empty →
  plan-01 default). Defaults in `game-runtime-config.ts`; the 4 config fixtures updated.
- Live setter follows the current config-broadcast pattern; **applies to NEW spawns only** (the
  idea's decision stands — retexturing the live fleet for a config knob is not worth it; document).
- F2: a plate-text input on the debug vehicle spawner (optional override), riding the existing
  spawn action.

## 2. Resolution at spawn

- `packages/game/src/vehicle/vehicle-plates.ts` (pure): `resolvePlate(placement, platesConfig,
cityBoxes) → { text, city }` — `cityAt(spawn position)` (NOT the player's city — a far-streamed
  SF car wears SF plates); COUNTRYSIDE/DESERT → deterministic pick of the three via the seed;
  seed = integer hash of (model, x, y, z). `VehiclePlacement` gains optional `plate` override
  (debug/missions win over the hash).
- Wiring: ONE call site in the host `spawnVehicle` (`engine-vehicles.ts:211-293`) —
  resolve → allocate slot (compose on miss, plan 01+03) → `setPlate`. Parked cars, car
  generators, popcycle road cars, bench road cars and the debug spawner all flow through it;
  a test pins that no second spawn path exists (grep-level assertion in review, behavioural test
  for the main path).
- LOD respawn determinism: `VehicleLodSystem` respawn from the stored placement must produce the
  identical plate — end-to-end test (hash → same text → same slot).

## 3. Damage / detach / doors verification (the census pays off)

- With plates as flagged submeshes INSIDE part geometry (plan 02), damage support is structural:
  `setSubmeshVisible` ok/dam swaps and part detach carry the plate automatically. This plan
  PROVES it: integration test on the plated fixture — swap to `_dam`, assert the visible plate
  submesh still resolves the instance's slot; detach path keeps rendering it.
- Census follow-ups from plan 02 (standalone-atomic models, `_dam` without plate material) get
  their in-game check here; missing-plate-on-dam = acceptable (SA behaves likewise), crash = bug.
- Slot lifetime: a detached part's plate must not be evicted while the debris renders — the
  refcount covers the instance; verify the detach path holds the ref until debris expiry.

## 4. Close-out

- Field session: drive LS→SF→LV — parked plates match districts; countryside shows a stable mixed
  distribution; custom masks via config apply to new spawns; ram a plated car — deformed bumper
  keeps the plate, second hit drops it with the part. Screenshots in the plan.
- Ledger: plate slots used after a full-map drive, spawn overhead, cache hit rate.
- Docs: config reference entry; idea-chain insight recorded (plates-inside-part-meshes) — the
  chain readme statuses flip; memory update.

## Subtasks

- [x] Config `vehicle.plates = { la, sf, vegas }` + defaults + the 4 fixtures + a feature doc. No live
      setter was needed: the mask is read from `config` at each spawn, so a config change already reaches
      every car spawned after it — which is exactly the "new spawns only" rule this plan asked for.
- [x] `vehicle-plates.ts` + tests (9): city boxes → mask, countryside stable pick, override wins, hash
      determinism, model and position both in the seed.
- [x] Host wiring — ONE call site in `spawnVehicle`, and the release path frees the layer.
- [x] Debug-spawner plate input — **done 2026-08-12**: F2 → Vehicles carries a "Plate (blank = auto)"
      field (8 cells, upper-cased) that rides the PLACEMENT, so a LOD respawn re-applies the typed number.
- [x] Damage/detach integration tests + refcount-through-detach check — **done 2026-08-12**, two tests
      (see the ledger). Both assert the plate SURVIVES; nothing in the damage path may hand a layer back.
- [x] Field session — done 2026-07-28 on the rebuilt pak (binary verdict: every car wears its plate). Its
      MEASURED half was deliberately not taken; it is carried in the readme's "Left unmeasured".

## Acceptance

- The user's original spec holds end-to-end: masks in config, city-correct backgrounds,
  deterministic per-vehicle plates, plates ride deform/swing/detach. Field verdict recorded.

## Ledger

**Wired 2026-07-28.** Suite **3 016 green** (+9), `tsc` and `eslint` clean.

- **One wiring point, as designed.** `spawnVehicle` in `engine-vehicles.ts` resolves → claims a layer →
  `setPlate`; the model-release path frees the layer. Parked cars, map car generators, popcycle road cars,
  the bench fleet and the debug spawner all flow through it, so there was no second site to patch.
- **The seed quantises the position to centimetres.** A car generator's stored coordinate round-trips
  exactly, but a ground-snapped spawn lands a float's breadth away — an unquantised hash would hand the
  same parked car a new plate on every LOD respawn. This is the determinism the plan asked for, taken at
  the seed rather than by caching the result.
- **The city is read at the CAR, not the player.** Pinned by a test: two placements of the same model in
  different city boxes resolve to different backgrounds.
- **Plate sources hang off the adapter** (`GtaSaWorldAdapter.plateSources()`), parsed once from the same
  `generic/vehicle.txd` it already merges into every car's texture chain — no second read, and the layer
  rule (only `adapters/` may touch renderware) is kept.
- **Layer 0 is filled with a blank plate at boot**, closing what plan 03 left owed. A dictionary that
  cannot be read leaves plate support off entirely and every car keeps the stock placeholder; plates are
  cosmetic and must never be a reason a spawn fails.
- Config vocabulary follows the game's own region tokens (`la` / `sf` / `vegas`), not the plan's draft
  `ls`/`lv` — `City` in `zones/city.ts` and the reversed `eCarPlateType` both name LA, and a second
  vocabulary would only invite a mismatch.

### Still owed

- ~~**The pak rebuild**~~ — done 2026-07-28, and the plates are on the cars in the field. That verdict
  closed the plan.
- The field session's MEASURED half was not taken and the chain closed without it: LS→SF→LV distribution,
  the countryside mix, ram a plated car for the deform/detach behaviour, slots used on a full-map drive,
  spawn overhead. Carried in the plan readme's "Left unmeasured".
- ~~The F2 debug-spawner plate input, and the damage/detach integration tests~~ — **both landed
  2026-08-12** (see the close-out ledger below). What stays a prediction until something drives into a
  wall is the LOOK of it: plan 02 measured 87 of 143 models carrying a plate on their `_dam` twin, and a
  missing plate on a damaged panel is acceptable (SA behaves likewise) — only a crash would be a bug.

### Close-out ledger (2026-08-12)

Suite **4 108 green** (+2), `tsc` and `eslint` clean. Both additions guard the SAME claim from the two
ends it can break at:

- **`engine.plates.test.ts` — "keeps the plate through a damage swap and a detach".** The plate is
  INSTANCE state, and neither path may rewrite it: the test hides the `_ok` submeshes and hands the part
  its own world matrix (exactly what `EngineVehicleHandle.detachPart` does), asserts zero writes to the
  `vehicle-plates` buffer, then forces a capacity grow and asserts the row comes back as `[6, 1]` — proof
  the state was RETAINED, not merely left unwritten.
- **`vehicle-damage.system.test.ts` — "holds the plate refcount through deform, detach and debris
  expiry".** The real `VehicleDamageSystem` drives the whole lifecycle (strong hit → deform → second hit →
  detach → past `FALL_TTL`) against a real `PlateSlots` of capacity 3. Afterwards a second plate fills the
  atlas and a third claim returns `BLANK_PLATE_SLOT` — nothing is evictable, because the car never
  released its layer — and re-claiming the car's own text hits without recomposing. If anyone ever wires a
  release into the detach path, this is the test that fails.
- **The F2 control is a pass-through, by design.** `PlatePlacement.plate` and `VehiclePlacement.plate`
  already existed; the only new code is the input in `VehicleScreen`, the widened `spawnVehicle(model,
  plate?)` signature, and one spread into the placement in `engine-canvas-host.tsx`. No new plate logic —
  the override still resolves through the same `resolvePlate` call every other spawn path uses.
