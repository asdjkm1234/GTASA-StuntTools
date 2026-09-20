# The runtime `modloader/` overlay + the runtime DFF fallback

**Goal.** Let a user drop a Modloader-style pack into `modloader/` and have it take effect at BOOT, without
rebuilding: `withModloader(fs)` (plan 058, `packages/modloader`) decorated the VFS so a mod's `.dff`/`.txd`
shadowed the stock asset by bare name, its `*.settings.txt` merged into `vehicles.ide` / `handling.cfg` /
`carcols.dat`, and a loader file's `IDE`/`IPL` lines merged into `gta.dat`. The vehicle spawn path carried the
matching half: a **runtime DFF fallback** that parsed RW at spawn whenever a `<model>.dff` still answered.

**Where it lived.** `packages/modloader/` (deleted), `withModloader` in `apps/web/.../use-asset-boot.ts`, and in
`GtaSaWorldAdapter`: `loadOptimizedVehicle`'s `.dff`-first resolution order, `vehicleCommon`, the
`isModdedAsset` mixing-rule warning, and the off-thread `vehicle-model-builder` + `vehicle-model.worker`
(074/21) that existed only to keep that parse off the frame. Removed 2026-07-28; the build-time merge helpers
it also housed (`loader.ts`, `data-merge.ts`, `mergeGtaDat`) moved into `tools/mod-installer/src/`, their only
remaining caller.

## Why it was removed

**A car is no longer decidable at runtime.** Everything a vehicle carries beyond raw geometry is now resolved
while the game is BUILT and baked into its `.osm`:

- its `features.txt` declaration (`UP/DOWN_LIGHTS` — a pop-up pod whose lamps carry no marker), copied by
  `vehicle-installer` into `data/vehicle-features.txt` and read by the converter, never at runtime;
- its **license-plate** slots (082/02): after conversion the material NAME is gone and texture layers are
  model-local, so the plate tag in the `.osm` DESC is the only thing that can still say "this quad is a plate";
- its baked per-vertex sky occlusion, its wheel fitting, its submesh/door rig.

A car served from a runtime `.dff` therefore did not spawn *slower* — it spawned **wrong**, silently: no
pop-up pods, a stock placeholder plate, different lighting. The two paths had already stopped being two ways
to reach the same car.

**And the overlay could not close that gap.** The build inputs above are produced by the installers from the
mod folder, which is long gone by boot. Teaching the runtime to redo that work would mean shipping the
converter into the browser — the opposite of what plan opensa-pack/003 bought.

**What it cost meanwhile.** A whole second vehicle pipeline: the RW parse + TXD decode + weld at spawn
(~100–200 ms per car type), the worker built to hide it, the `.dff`-before-`.osm` resolution order every
reader had to understand, and the mixing rule (a retexture-only mod could not be honoured, so it warned and
was ignored — a mod that silently did nothing).

## What replaced it

Mods are installed **before** the pack: `mod-installer` bakes a Modloader-layout mod into the accumulated game
tree (same bucketing by bare name, same `gta.dat` patch, now written to disk), and `vehicle-installer` installs
a car's model + data rows, with `--rebake` re-converting one car against an already-built game in ~3.6 s. The
conventions are in [contracts/mods.md](../contracts/mods.md) and
[contracts/vehicles.md](../contracts/vehicles.md).

The runtime now has ONE vehicle path: `<model>.osm`, a section read. A car with no `.osm` raises
`No converted model for '<name>'` at spawn instead of falling back — opensa-pack's report names every car it
failed to convert, so the failure is visible where it can still be fixed.

## When to revisit

If in-browser modding is ever wanted again, the honest shape is **not** a runtime overlay but running the
converter where the mod is added — an in-browser or local install step producing a real `.osm`, so build-time
and runtime data stay the same data. Reviving `withModloader` would re-introduce a second, less capable
vehicle pipeline on day one.
