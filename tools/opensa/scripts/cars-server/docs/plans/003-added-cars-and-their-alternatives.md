# 003 — the ADDED cars, and a car shown with the alternatives that hang off it

**Status: ✅ Implemented 2026-08-20**, his ask at the close of session 31: extend cars-server to know about
`tools/add-vehicles`, link the main car with the alternatives attached to it, and draw an alternative as a
**slightly smaller card** than the car it belongs to. Plan first, then the implementation — both below, the
plan as it was decided and the numbers it was verified with.

## What the page already does, and the one thing the request got wrong

The request written down at session 31's close said `mods-src/<game>/add-vehicles` "is invisible to it". **It
is not.** The added fleet has been on the page since [add-vehicles 102](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)
(`269a166e`): `catalog.ts` resolves the added root through `resolveVehicleSources`, lists it as its own
`Added vehicles` section, indexes `add-vehicles/screenshots/`, and already carries `bases` on the card model
— **rendered nowhere**. Measured today with `npm run cars`: **327 cards in 20 sections** (212 replacements +
115 added), and 115/115 added cars have a screenshot.

So this plan is not "show the added cars". It is **show the RELATION**: a stock slot's card and the cars that
vary it, drawn as what they are.

## The relation, measured on the real tree (2026-08-20)

- **115 added cars over 101 distinct bases, and every base has a card** in the replacement fleet — 0 orphans.
- **0 cars name more than one base**, though `parseVehicleBases` accepts a comma list and
  `resolveAddedVehicles` inherits sound and parts from `bases[0]`.
- Alternatives per base: **98 bases with 1**, one with **4** (`freiflat`), one with **5** (`freight`), one
  with **8** (`freibox`). **A base card has to hold eight nested cards**, and nothing caps the number.
- The built ledger (`build/original/sa/data/vehicle-adds.txt`) and the folders agree exactly: **115 `car`
  rows, none missing on either side, 0 base disagreements** — plus **57 `part` rows**, which are a
  replacement car's derived tuning parts and not cars at all.
- `add-vehicles/reserved/` holds 2 folders. The resolver never returns them, so they stay off the page.

## The decisions

1. **The relation is read from the FOLDER NAME**, not the ledger. The whole page is "what the tree will
   install", every other field on a card already comes from the folder, and a page built out of the last
   build would go stale the moment a car is dropped in. **The ledger is read for ONE thing — the id** — and
   the page says which tree it was read from. A folder with no ledger row shows `id — not built yet` rather
   than a number nobody promised; a row whose base disagrees with the folder shows the FOLDER's relation and
   flags the row as stale. Never pick silently between the two.
2. **What the id means.** An added car has one (19 001+, promised by the ledger — a parked spot and a
   ModelVariations entry land in the player's save, so it may not move); a replacement car does not, and its
   card keeps today's behaviour (the mod's own `vehicles.ide` row, falling back to stock). So the id is shown
   only where it means something, labelled as the id the BUILT tree promises.
3. **A car naming several bases appears under EACH of them**, once per base, with the base it INHERITS from
   (`bases[0]`) marked as such. Zero today; the rule exists so a future one is not silently dropped or
   silently duplicated without explanation.
4. **The added cards live under their base**, inside the base's own section (`Sports Cars`, not a bucket at
   the end). The `Added vehicles` section survives ONLY for cars whose base has no card — empty on this tree,
   so it disappears — and the header keeps counting every card on the page, nested ones included.
5. **`--target opensa` shows no added cars at all.** `resolveAddedVehicles` refuses every target but `sa`
   (ModelVariations, FLA's audio loader and Parked Maker are the real game's), so the opensa build never
   installs one — while the page today lists all 115 under both targets, which is a small lie it has been
   telling since 007 (verified: `resolveVehicleSources(add-vehicles, 'opensa')` returns 115). The header says
   why they are absent instead of just dropping them.
6. **The tuning an added car carries is OUT of scope for this pass** — its derived parts (the ledger's 57
   `part` rows) and its paintjobs are both readable, but they belong to the card's TAG set rather than to the
   relation this plan is about. Stated here so the next reader knows it was a decision and not an oversight.

## The shape on screen

- A base card keeps its two panes (Original / Replaced) exactly as it is. Under them sits a strip of
  **alternative cards, a size down**: one picture each (its own screenshot — an added car has no "original",
  because the original is the card above it), the car name and author from the folder, the id, the tags.
- The visual statement is "these are variations of that one", never "these are peers", so the alternatives
  are inset and share the parent card's frame rather than starting a new one.
- **It must survive the phone layout** — one card per row at every width, panes stacked below 560 px (plan
  001's rule, the user's call). Eight nested cards on `freibox` is the case to lay out against, not one.
- An added car keeps its own `#car-<slot>` anchor wherever it is drawn, so the missing-shot warning's links
  still land on it.

## Steps

1. `catalog.ts` — attach each added car to its base's card (`alternatives`), keep the orphan section, gate on
   the target. Unit tests over a temp tree (negative cases first): a base with several alternatives, an added
   car whose base nobody replaced, `--target opensa`, a folder with no ledger row, a ledger row that
   disagrees.
2. `views/index.hbs` — the nested strip and its styles, screenshots served at the smaller size.
3. The ledger id and its staleness state on the card.
4. Docs: this plan's numbers filled in, `scripts/cars-server/readme.md`. The commands do not change, so
   `docs/commands.md` does not.

## What shipped

- `catalog.ts` — `addedFleet()`: every added car becomes a card hanging off the stock slot its folder name
  varies, `CatalogCar.alternatives` on the base, `base`/`inherits` on the alternative. The `Added vehicles`
  section is now the ORPHAN home and disappears when it is empty. `Catalog.addedNote` is the header's one
  line about the fleet: how many, where their ids came from, or why there are none.
- The id comes from the built tree's ledger through `readAddsRows`, `car` rows only (the other 57 are a
  replacement car's derived tuning parts). No row → `unpromisedId`, drawn as `ID — not built yet`. A row
  whose bases disagree with the folder is SHOWN as a stale-ledger line under the card, never picked over it.
- `server.ts` passes `builtPath` (`build/<game>/sa`); `index.hbs` gained the nested strip, its styles and the
  header note, and the card's `replaced to:` reads `added, varies:` for a card that has bases.

## Verification — measured 2026-08-20

- The real tree, `npm run cars`: **327 cards in 19 sections** (was 20 — the `Added vehicles` bucket is gone,
  0 orphans), **115 alternative cards under 101 base cards**, `freibox` carrying its **8**. Page **388 228 →
  392 707 bytes**: the added cars moved rather than multiplied.
- **115 ids read** from `build/original/sa/data/vehicle-adds.txt`, 0 `not built yet` — and the unbuilt path
  was exercised for real: rendered against a tree mid-rebuild, the same page showed all 115 as
  `ID — not built yet`, because the ledger at that moment held only the 11 part rows the run had written.
- `npm run cars:opensa`: **212 cards, 0 alternatives**, the note present and the added `screenshots/` folder
  no longer listed in the header.
- Screenshotted at **1440** and **390 px** on `freibox`: eight alternatives wrap to two rows on the desktop
  and stack one per row on the phone, each with its own picture and blue id chip.
- **Field-accepted 2026-08-20** — the user ran the page on the real fleet and took it as it is.
- `scripts/cars-server` **31 tests** (25 → 31: the opensa gate, the unpromised id, the orphan section, the
  hosting, the sort, the ledger id + stale row, and the two-base case); tsc + eslint clean.

## Not done, on purpose

The tuning an added car carries — its derived parts and paintjobs — is still off the page (decision 6). The
`part` rows are right there in the ledger the page now reads, so it is a tag away when it is wanted.


Neighbours: [`tools/add-vehicles/docs/plans/102-add-vehicles/readme.md`](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)
for what an added car is made of, and [`002-layered-screenshots.md`](002-layered-screenshots.md) for the
picture rule this must not break.
