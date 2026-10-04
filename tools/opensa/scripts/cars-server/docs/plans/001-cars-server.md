# 001 — cars-server: what the fleet replaced, in a browser

**Status: ✅ Implemented 2026-08-15.** `npm run cars` serves one local page listing every car the build
replaces: the stock model beside the mod that took its slot, with the author and what the mod brings.

## Why

The fleet is 212 folders whose names carry everything (`admiral - 1976 Mercedes-Benz 230 - k1real24`) and
whose CONTENTS carry the rest — paint jobs are extra txds, tuning is a carmods line, new colours are palette
lines in a settings file. Answering "what is on the admiral, and does it have paint jobs?" means opening a
folder and reading a data file. This puts the whole set on one page, side by side with the stock car.

Internal tool: local only, no auth, no build step, no persistence. It reads the working tree and renders.

## What it shows

One card per car, grouped by the section the metadata declares (19 of them, `Sports Cars` first):

- **the model id** — the mod's own `vehicles.ide` row, falling back to the stock `vehicles.ide`;
- **`<slot>` replaced to: `<car>`** and **Author: `<author>`** — the three fields of the folder name;
- **Original** — the stock car's picture, out of the bundled metadata;
- **Replaced** — the field screenshot from `mods-src/<game>/vehicles/screenshots/`;
- **Tags** — what the mod brings, derived from the folder (below). No tags = a plain model swap.

## The three sources, and the one key that joins them

| Source | What it gives | Committed? |
| --- | --- | --- |
| `data/original.json` | 19 sections × 212 items: `section`, `name` (the SLOT), `src`, `image` (a `data:` URI) | yes — it came from `NO_COMMIT/`, which is temporary |
| `mods-src/<game>/vehicles` (via `resolveVehicleSources`) | the installed fleet: folder name → slot, car, author + the files that decide the tags | no (mods-src is not in git) |
| `mods-src/<game>/vehicles/screenshots/<folder name>.png\|jpg` | the replaced car in the field | no |

**They are joined on the SLOT, never on the full name.** Measured on the real tree: all three sets are
exactly 212 and match 1:1 by slot — but **5 screenshots do not match their folder's name character for
character** (`at400 - Boeing 727-100 Liveries- carcer.png` lost a space). A filename join would have dropped
five cars and looked like missing screenshots.

A `new/` candidate HAS no metadata link and no screenshot of its own — but it is what the build installs, so
dropping it would leave the page showing an incumbent the build no longer ships. It appears marked
`from new/`, with the slot's stock picture and **no** replaced shot: the picture on file is of the car it
displaced.

## Tags — derived from the mod folder, nothing else

Read from the folder's own files, so the page says what THIS mod ships (not what the merged build ends up
with). Order is fixed so two cards read the same way:

| Tag | Derived from | On the real fleet |
| --- | --- | --- |
| `Tuning` | the carmods line names a part that is not one of the universal `nto_*` nitros | 12 cars |
| `New Tuning Parts` | the folder ships more than one `.dff` — the mod re-modelled the kit | 13 cars |
| `N Paint Jobs` | `<slot>1.txd`, `<slot>2.txd`, … beside `<slot>.txd` | 48 cars |
| `Car4 Supported` | the carcols line's combos carry 4 values, not 2 (`carcolsSection`, the installer's own rule) | 60 cars |
| `New Colors` | the settings file declares `R,G,B  # newN` palette lines | 8 cars |
| `Has Cleo Script` | the folder has a `cleo/` subfolder | 7 cars |

Checked against the two examples the request gave: `alpha` → `4 Paint Jobs` alone, `blade` → `Tuning, New
Tuning Parts, 4 Paint Jobs, Car4 Supported`.

The settings file is read with the installer's own `decodeSettings` + `parseVehicleSettings` (UTF-16 is what
most Windows-authored mods ship; read as UTF-8 the whole file parses to nothing), and the car4 rule is the
installer's `carcolsSection`. **Reused, never re-implemented** — a second reading of the same file is a
second opinion about what the build contains.

## Shape

```
scripts/cars-server/
  src/server.ts     express: the page, /original/<slot>, /shot/<slot>
  src/catalog.ts    the view model — the join above, plus the model id
  src/tags.ts       the table above
  views/index.hbs   handlebars, styles inline (one file, no build step)
  data/original.json
```

- **Images are served, not inlined.** 212 base64 originals in one document is ~1.7 MB of HTML; the routes
  decode the `data:` URI (and stream the screenshot off disk) so the page stays small and the browser
  lazy-loads what is on screen.
- **The replaced shot opens full size** on click — a native `<dialog>` (`Esc`, `✕` and a backdrop click all
  close it), inset from the edges so the page stays visible behind. The picture is dropped on close: these
  are full-resolution field screenshots, up to 3.8 MB each, and one held decoded behind the page is waste.
- **Dark, responsive, no framework**: **one card per row at every width** (the user's call — four columns
  put a car at ~150 px, too small to judge), the two panes stacking below 560 px so each picture takes the
  full screen width. Phone and tablet are the layouts that matter — this gets opened next to the game.
- Rendered per request, so editing `mods-src` and hitting reload shows the new fleet. Nothing is cached
  except the parsed metadata JSON.

## Steps

1. `data/original.json` in, `tags.ts` + `catalog.ts` with unit tests over a temp fleet.
2. `server.ts` + `views/index.hbs`, `npm run cars`.
3. Docs: this plan, `scripts/cars-server/readme.md`, a row in `docs/development/scripts.md` and the command
   in `docs/commands.md`.

## Verification — measured 2026-08-15

- `npm run cars` → **212 cars in 19 sections**, page 214 KB of HTML; `/original/admiral` 200 `image/jpeg`,
  `/shot/at400` 200 `image/png` — `at400` being one of the five whose filename does not match its folder,
  so the slot join is exercised by the check itself;
- tags on the real fleet: `alpha` → `4 Paint Jobs`, `blade` → `Tuning, New Tuning Parts, 4 Paint Jobs,
  Car4 Supported`, `bus` → `Has Cleo Script`, `boxville` → `New Colors`, `banshee` → `Car4 Supported` —
  the two shapes the request stated, reproduced;
- a real `new/admiral - 1994 Dodge Stealth RT 1.1 - mad_driver` dropped into the tree: the card becomes the
  candidate, marked `from new/`, keeps `ID 445` and the stock picture, and shows no replaced screenshot;
- **18 unit tests** over tags and the catalog join; suite 4358/4358, tsc + eslint clean;
- screenshotted at 1440 / 820 / 390 px — one card per row throughout, panes stacked on the phone; the modal
  driven open and closed by `✕`, `Esc` and a backdrop click at 1440 and 390 px.
