# 010 — A vehicles folder may be layered `common/` + `sa/` + `opensa/`

**Status: ✅ Implemented 2026-08-17.** `mods-src/<game>/vehicles` gains the SAME layering mod-installer's
plan 011 gave `mods/`: `common/` + `sa/` + `opensa/`, each layer flat or `models/`+`new/` (plan 007), read
through ONE planner — `@opensa/tool-kit/layers` (`planLayers`, moved out of mod-installer so the three
installers cannot drift) — and ONE resolver, `resolveVehicleSources(inPath, target)`.

## Semantics

- `common` resolves first, then the target's layer; **the target layer's car takes the SLOT** from the
  `common` car (`sa/models/x replaces common/models/x` is logged, like every override). Inside a layer `new/`
  still beats `models/`.
- The target comes from whoever reads the folder: the pipeline's resolved target (`installVehicles`,
  `installCutscene`, `installPeds` all receive it), `vehicle-installer --target`, `--rebake --kind` (the kind
  IS the target — no second flag), `vehicle-cutscene --target`, `cars-server --target` (default `sa`).
- A layered tree read without a target is refused, not guessed; a car folder beside the layers (a misspelled
  layer) is refused; a layered vehicles or peds folder in a both-target pipeline run is refused at config time
  — the same `refuseLayeredBothTargets`, now per source folder.
- Flat and structured trees are untouched (`resolveVehicleSources(root)` as before; the target is ignored).
  `VehicleSource.layer` names the build layer when there is one; `VehicleSourcePlan.layersSkipped` names the
  other target's layer, logged.

## Not done, on purpose

`original`'s vehicles folder is NOT migrated — nothing today needs a per-target car; the shape exists so that
the day one does (a car whose model only OpenSA can carry, or a real-SA-only replacement) costs a folder move,
not a tool. `renumber-mods` does not apply (vehicles are not numbered).

## Verification

`tools/tool-kit/src/vehicles-dir.test.ts` (+5: no target, misspelled layer, common→target override with
`layersSkipped`, structured layers, flat unchanged), `tools/tool-kit/src/layers.test.ts` (moved),
`tools/ped-installer/src/install.e2e.test.ts` (+2). Suites: tool-kit, vehicle-installer, ped-installer,
vehicle-cutscene, mod-installer, perfect-map-builder, cars-server — 613/613, tsc + eslint clean.
