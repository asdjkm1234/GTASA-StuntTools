# add-vehicles

Installs **ADDED** GTA-SA vehicles — cars on model ids the game never had — from
`mods-src/<game>/add-vehicles` into a BUILT `sa` tree. **Original SA only**: everything that makes an added
car work is a plugin of the real game (ModelVariations for traffic, FLA's vehicle audio loader for sound,
Parked Maker for parking, CLEO's FXT loader for the name), and our own engine has none of them.

An added car is a replacement car **plus an id** plus what a stock slot otherwise gets for free. So this
tool owns only what is specific to a new id; every merge that writes a file the install reads lives once, in
`@opensa/vehicle-installer`, and is called from here. The chain, the shared-layer table and the research are
[central plan 102](docs/plans/102-add-vehicles/readme.md); this tool's own steps are
[docs/plans](docs/plans/readme.md).

```bash
# What the root holds and what each car varies (plan 001 — the install itself is plan 002)
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa --in mods-src/original/add-vehicles --only 001veh
```

## The source

`mods-src/<game>/add-vehicles` is a second vehicles ROOT with the same grammar as the replacement fleet's —
flat, or `models/` overridden per slot by `new/`, or layered — read through the ONE resolver
(`@opensa/tool-kit/vehicles-dir`), so both fleets are planned by the same rules and the same refusals.
`screenshots/` and `reserved/` are reserved names and never scanned.

The folder name carries one field the replacement fleet's does not: a parenthesised **base**, the stock slot
the car is a variation of (`001veh - 1971 Chevrolet Vega - alfamodding (manana)`). It is what the car
inherits its sound from, whose tuning parts it re-models, and whose place in traffic it appears in. A base
no `vehicles.ide` row defines is refused, naming the folder — a mistyped base is otherwise a car that
silently never enters traffic. Contract: `docs/contracts/vehicles.md` §1b.

```bash
# Install every added car into a built tree (in place, like --rebake --kind sa)
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa
npx tsx tools/add-vehicles/src/cli.ts --game build/original/sa --only 001veh
```

## Where the models go

**`modloader/added-vehicles/`, loose — not into an IMG archive.** SA registers 8 archives and the built tree
already spends six of them; the fleet's 1.4 GB pushed the vehicles family to a third file and the build
stopped at `assertArchiveSlots` with 9 of 8. Modloader has no such ceiling and the install already runs it,
so the cars ride that road — the same one the user's earlier build shipped them by. A re-modelled tuning
part goes there too, under the name the install derived for it, never the stock one.

The cost, stated where anyone chasing it will stand (`src/loose-files.ts`): a loose TXD still takes a
streaming id at runtime while `checkImgIdBudgets` counts ARCHIVE entries, so the FLA TXD pool is
under-counted by whatever lands in that folder.

## The id

An added car's model id is allocated over the BUILT tree from **19 001–19 999** — the window above every map
allocator (they stop at 19 000) and inside FLA's DFF range. The author writes `<:id>` where the id goes in
the settings file; a literal id is refused, because it would be a guess at a window only the build can see.

**The id never moves.** `data/vehicle-adds.txt` records slot → id and is read FIRST by the next run, so a
folder renamed, added or dropped does not renumber the fleet: a parked spot and a ModelVariations entry land
in the player's SAVE, and an id that moved between builds is a save that spawns the wrong car. Deleting the
ledger is the only way to renumber, and the file says so.

## Tuned traffic

The same run gives every model with a paint job or a mod-shop part a ModelVariations section that lets it
spawn already tuned — stock cars included, since that is what stops a city of factory-fresh bodies from
looking like one. The rate and the exclusions live in an optional `add-vehicles.json` beside the cars:

```json
{ "tuningChance": 75, "tuningFullBodykit": 1, "changeOnlyParked": 0, "exclude": ["police"] }
```

Changing it and re-running rewrites the ini and nothing else — no rebuild.

## Status

Plans 001–006 are built: the source root and resolver, the ids and the four data rows, the archive, the
name, the inherited sound, the parked spot, traffic, the derived tuning parts and tuned traffic. The pmb
stage and the field round are 007.

**The full fleet needs one thing it does not have yet**: its 8 wing pairs put `carmods.dat` at 31 `link`
pairs against an array of 30, so a run over all 115 refuses and names `asi/perfect-vehicle` plan 002. Four
of the five part-shipping cars install together today.
