# 006 — Rebake: the vehicle half against an already-built game

**Status: ✅ Implemented 2026-07-28.** `--rebake <game>` re-installs and re-converts the mod cars of a game
that is ALREADY BUILT, in place, instead of running the whole pipeline to see one changed row.

## Why

A vehicle round changes a handling value, a model, or one detail of one car — and then costs a full build to
look at. Measured on the real gostown tree: **one car in 3.6 s**, **all 12 in 26 s**, against minutes for the
pipeline. The turnaround is the feature.

## What it does, per mod folder under `mods-src/<game>/vehicles`

1. **Settings → the BUILT `data/*`.** The same `applyVehicle` the install uses, with its archive step off
   (`{ img: false }`): the merges are replace-by-model, so running it twice changes nothing the first run did
   not already do. Verified by an idempotence test.
2. **`features.txt` → `data/vehicle-features.txt`, merged per model.** Rewriting the table from the rebaked
   subset would drop what every other car declared — rebaking ONE car must not silently disarm the rest.
3. **`.dff` + `.txd` → `<model>.osm`.** `openGameDir(target, [modFolder])` gives the converter a composite
   filesystem: the mod folder SHADOWS the built tree, so the car's own geometry and dictionary come from the
   mod while the shared `vehicle.txd` and the plate rasters come from the game it is being baked into. Then
   `buildVehicleOsm` (opensa-pack's own, not a copy) and `encodeOsm(sections)` — byte-identical to what a
   full pack writes.
4. **Replace the archive entry.** `rewriteModelArchives` with `near: <model>.osm`: `near` resolves while the
   original is still present, so the entry is replaced in whichever `models/*.img` holds it. No delete, no
   rebuild of archives that changed nothing.

Order matters: every car's DATA lands before any car is CONVERTED, because the conversion reads the merged
`vehicles.ide` (txd name, wheel scale) and `vehicle-features.txt` back out of the target.

## Adding a car the built game never had

It can, and nothing about it needs a pak rebuild. Verified in the code before it was built:

- the roster is the TEXT `data/vehicles.ide`, parsed lazily at boot by `gta-sa-world.adapter.ts`;
- a spawn resolves `<model>.osm` out of the archive **by name**;
- `pak/manifest.json` carries `cells`, `textures`, `water` — **no vehicle table**, and `modelById` is a plain
  `Map` with no id range check anywhere (`cargrp.dat` is by model name, and is not wired to traffic yet).

So an addition needs only what a mod already ships: **its own `vehicles.ide` row, with an id**. The tool
never allocates one. That is deliberate — the id must be identical in a rebake and in a full build, and the
only way to guarantee that is for it to live in the mod folder. An id POOL reserved up front was considered
and refused: it solves scarcity we do not have (no 400–611 ceiling here, nothing baked by id) and adds state
that must stay in sync between two paths.

Three checks instead, all before anything is written:

| Case | What happens |
| --- | --- |
| model unknown, mod declares an ide row with a FREE id | added: the row merges, the `.osm` is inserted into `models/gta3.img`, and a warning says it has no traffic or parked presence until a full build writes the placements |
| model unknown, no ide row | refused — a car needs an id, a txd and a type; nothing of its own is written |
| the declared id belongs to ANOTHER model | refused — `modelById` keeps whichever came last, so a car generator would silently spawn the wrong car where that generator stands |

## What it deliberately does not do

- **The raw `dff`/`txd` are NOT written into the archive.** In a converted tree a car is one `.osm` and the
  pack has already deleted the pair; putting it back adds entries the game does not read.
- **It does not place a new car.** Traffic groups and parked placements come from a full build; the report
  says so per added model rather than letting silence read as a failure.
- **It does not touch the real-SA target.** `build/<game>/sa` still lives under the exe's own 400–611 vehicle
  ceiling; a car added on a private id is opensa-only.
- **It is not a transaction.** If a conversion throws, that car's data rows are already merged. They are the
  rows the next full build would write anyway, and the report says which model failed.

## API and CLI

```ts
rebakeVehicles({ inPath, targetPath, only? }): RebakeReport   // @opensa/vehicle-installer/rebake
```

```sh
tsx tools/vehicle-installer/src/cli.ts --rebake gostown                 # every mod car
tsx tools/vehicle-installer/src/cli.ts --rebake gostown --only previon  # one car — the fast path
```

Defaults follow the canonical layout (plan 079): `--target build/<game>/opensa`, `--in
mods-src/<game>/vehicles`. Both are overridable for a tree that lives somewhere else.

## Verification

`src/rebake.test.ts`, against the real `fixtures/original` zr350 (a fixture is one manifest line, and a real car
falsifies what a synthetic one confirms): a target that is not a built game throws; a model no archive holds
is reported instead of half-installed; `--only` leaves every other entry byte-identical; a rebaked entry
parses back through `readVehicleOsm` with its pop-up pod detected from the mod's `features.txt`; and a second
run writes the same bytes. For additions: an unknown model with no ide row is refused with the data files
byte-identical afterwards, a declared id that belongs to another model is refused by name (562 is the
elegy's), and a new model on a free id lands in both the roster and the archive and reads back.

Field-checked the same day on `build/gostown/opensa`: `--only previon` in **3.6 s**, all 12 mod cars
(295.1 MB of `.osm`) in **26 s**, `data/handling.cfg` byte-identical (same md5) after both, and the rebaked
`previon.osm` reads back with its 145 submeshes and `misc_a` pod.
