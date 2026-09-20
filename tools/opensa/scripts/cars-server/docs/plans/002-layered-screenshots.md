# 002 — a layered vehicles folder: each car's screenshot from its own layer, the target on the page, missing pictures as a warning

**Status: ✅ Implemented 2026-08-17.** Follows vehicle-installer
[plan 010](../../../../tools/vehicle-installer/docs/plans/010-layered-vehicles.md): a vehicles folder may be
`common/` + `sa/` + `opensa/`, and cars-server already took `--target` to pick the fleet — but it still read
ONE `screenshots/` at the tree's root, which a layered tree does not have (a `screenshots/` beside the layers
is a stray folder and the resolver refuses it). The pictures had been left behind by the layering.

## What changed

- **Screenshots follow the layers the cars do — and a car reads ITS OWN layer only.** `resolveVehicleSources`
  now returns `layers` — the build layers it APPLIED, in apply order, each with its folder as spelled on disk
  (a flat/structured tree is one layer rooted at `--in`). cars-server indexes `<layer>/screenshots/` per layer
  and a `sa/models/x` car looks in `sa/screenshots/` only: the picture under the same slot in
  `common/screenshots/` is of the `common` car it DISPLACED, and lending it would be the same lie plan 001
  refuses for a `new/` candidate (his call, 2026-08-17 — a first cut overlaid the folders by slot, and a
  target car with only the common picture would have worn the wrong car). The other target's folder is never
  opened. Flat/structured trees read `screenshots/` at the root as before.
- **The format is free per file** — a `.png` in `common/` and a `.jpg` in `sa/` — because the join is the
  slot inside the layer, never the filename (`.png`, `.jpg`/`.jpeg`, `.webp` were already accepted; the route
  serves whichever is on disk with its own content type).
- **Two calls, and the page says which one it is**: `npm run cars:sa` / `npm run cars:opensa` (`--target`
  as before; `npm run cars` stays `sa`). The header carries the target as a badge and, on a layered tree, the
  screenshot folders per layer; on a flat/structured tree it says the target does not apply.
  `catalog.strategy` + `catalog.screenshotDirs` carry that to the view.

- **A missing screenshot is a WARNING at the top of the page**, not a blank pane 150 cards down: an amber
  `<details open>` block under the header lists every installed car with no picture under its slot — the
  slot, the **filename to save** (`<car folder name>.png`; `.jpg`/`.jpeg`/`.webp` are read too), the folder it
  came from (`sa/models/…`), each linking to its card (`#car-<slot>`) — and names the `screenshots/` folder(s)
  it looked in. `new/` candidates are NOT listed: their picture is withheld on purpose (plan 001).
  `catalog.missingShots`. On the real `original` tree today it is empty (212/212).

## Verification

`scripts/cars-server/src/catalog.test.ts` (+4: the other target's folder is never read + listed as missing;
the common picture is NOT lent to the target car that took the slot; each car from its own layer, `.jpg` and
`.png` alike; a `new/` candidate is not "missing"; the missing entry names the file to save), `tools/tool-kit/src/vehicles-dir.test.ts` (`layers` asserted flat + layered).
Smoke: the real `mods-src/original/vehicles` (structured, 212 cars — header "not layered"), and a synthetic
layered tree (`common/models/admiral - A - x` + `sa/models/admiral - B - y`, png in common, jpg in sa) served
with `--target sa`: header `layered: common + sa`, `/shot/admiral` → `200 image/jpeg` from `sa/screenshots`;
with the sa jpg removed the page opens on the warning naming `admiral - B - y.png`.
Suites cars-server, tool-kit, vehicle-installer, ped-installer 270/270; tsc + eslint clean.
