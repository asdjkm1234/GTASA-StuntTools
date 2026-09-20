# cars-server

A local page showing what the vehicle fleet **replaced**: the stock car beside the mod that took its slot,
its author, and what the mod brings. Internal tool — no build step, no auth, nothing persisted.

```sh
npm run cars                              # http://localhost:5178, game `original`, target `sa`
npm run cars:sa                           # a LAYERED vehicles folder: common + sa
npm run cars:opensa                       # … common + opensa
npm run cars -- --game gostown --port 5200 [--target sa|opensa]
```

The header carries the **target** as a badge. On a layered `mods-src/<game>/vehicles` (`common/` + `sa/` +
`opensa/`, [plan 010](../../tools/vehicle-installer/docs/plans/010-layered-vehicles.md)) it decides BOTH the
fleet and the pictures: a car's screenshot is read from ITS OWN layer's `screenshots/` (`common/` or
`<target>/`) — never the other layer's picture under the same slot, which is of the car it displaced; the
other target's folder is never read. On a
flat/structured tree the pictures come from `screenshots/` and the target does not apply — the header says
so. **A car with no screenshot is a warning at the top of the page** — slot, the filename to save
(`<car folder name>.png`, `.jpg`/`.jpeg`/`.webp` also read), its folder, a link to the card
([plan 002](./docs/plans/002-layered-screenshots.md)).

**Added cars hang off the slot they vary** ([plan 003](./docs/plans/003-added-cars-and-their-alternatives.md)):
`mods-src/<game>/add-vehicles` is resolved the same way the fleet is, and each car is drawn as a **smaller
card inside its base's card** — the base is the `(base)` suffix of its folder name, which is the relation
`tools/add-vehicles` itself installs on. One naming several bases appears under each, marked on the one it
inherits from; one whose base nobody replaced keeps the `Added vehicles` section to itself. Its **id comes
from the built tree's ledger** (`build/<game>/sa/data/vehicle-adds.txt`) and from nowhere else — a folder the
last build never saw reads `ID — not built yet` rather than a number nobody promised, and a ledger row whose
base disagrees with the folder is shown as such. **`npm run cars:opensa` shows none of them**: added cars are
an SA-only feature and that build installs none, so the header says so instead of listing 115 cars nobody
gets.

Every card carries the model id, `<slot> replaced to: <car>`, the author, the tags below, and two pictures —
**Original** (the stock car, from the bundled metadata) and **Replaced** (the field screenshot). The catalog
is rebuilt on every page load, so editing `mods-src` and hitting reload shows the new fleet.

## Where the three sources meet

| Source                                                                                              | Gives                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `data/original.json` (committed)                                                                    | 19 sections × 212 stock cars: the section, the SLOT and a `data:` picture |
| `mods-src/<game>/vehicles` via `resolveVehicleSources`                                              | the fleet the BUILD installs — `models/`, overridden per slot by `new/`   |
| `mods-src/<game>/vehicles/screenshots/` — or, layered, the car's own layer's `<layer>/screenshots/` | the replaced car in the field (`.png`, `.jpg`/`.jpeg`, `.webp`)           |

**Joined on the SLOT, never on the folder name.** All three line up 1:1 on the real tree, but five
screenshots do not match their folder's name character for character
(`at400 - Boeing 727-100 Liveries- carcer.png` lost a space) — a filename join loses exactly those five and
looks like missing pictures.

A `new/` candidate is shown, because the build installs it, and marked `from new/` — with **no** replaced
screenshot: the picture filed under that slot is of the car it displaced.

**Click the Replaced picture** to open it near-full-screen (a native `<dialog>`, so `Esc` closes it as well
as the `✕` and a click on the backdrop). The inset is deliberate: the page stays visible around the modal.

## Tags — read from the mod folder, in this order

| Tag                | Means                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| `Tuning`           | its carmods line names a part beyond the universal `nto_*` nitros                  |
| `New Tuning Parts` | the folder ships more than one `.dff` — the mod re-modelled the kit                |
| `N Paint Jobs`     | `<slot>1.txd`, `<slot>2.txd`, … beside `<slot>.txd`                                |
| `Car4 Supported`   | its carcols line carries 4 values per combo (the installer's own `carcolsSection`) |
| `New Colors`       | the settings file appends `R,G,B  # newN` palette lines                            |
| `Has Cleo Script`  | the folder has a `cleo/` subfolder                                                 |

No tags = a plain model swap. The settings file is read with the installer's own `decodeSettings` +
`parseVehicleSettings`, so a UTF-16 file (what most Windows-authored mods ship) reads correctly.

See [docs/plans/001-cars-server.md](./docs/plans/001-cars-server.md).
