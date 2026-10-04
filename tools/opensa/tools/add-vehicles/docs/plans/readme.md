# add-vehicles — plan chain

**Original SA only.** The tool that installs ADDED cars — new model ids — from `mods-src/<game>/add-vehicles/`
into the built `sa` tree, on top of `vehicle-installer`'s Node API (an added car is a replacement car plus
an id plus what a stock slot otherwise gets for free). Umbrella, research and the shared layer:
[`tools/add-vehicles/docs/plans/102-add-vehicles/`](102-add-vehicles/readme.md) — read its "shared
layer" table before adding a module here; if a merge writes a file the install reads, it belongs in
`vehicle-installer`, not here.

| # | plan | what | status |
| --- | --- | --- | --- |
| 1 | [001 — Source root and resolver](001-source-and-resolver.md) | `add-vehicles/` as a second vehicles ROOT through `resolveVehicleSources`; the `(base)` suffix; the contract | **BUILT** 2026-08-19 |
| 2 | [002 — Ids, rows, IMG](002-ids-rows-img.md) | the free-id allocator over the built tree (19 001–19 999, deterministic), `<:id>`, `applyVehicle` with an id, the ledger, the id guards | **BUILT** 2026-08-19 |
| 3 | [003 — Name, sound, parking](003-name-sound-parking.md) | `.fxt` from the folder name (+ `text.txt`), `audio.txt` or the base's line, `parked.txt` | **BUILT** 2026-08-19 |
| 4 | [004 — Traffic](004-traffic-model-variations.md) | the car as a ModelVariations variation of its base; `model-variations-extra.txt` with `{{name}}` → id | **BUILT** 2026-08-19 |
| 5 | [005 — Tuning parts, derived](005-tuning-parts-derived.md) | re-modelled base parts → new prefixed names, cloned rows/shop/links, the carmods line; the ceilings guard | **BUILT** 2026-08-19 — refuses the full fleet at 31 link pairs |
| 6 | [006 — Tuned traffic](006-tuned-traffic.md) | `[<slot>] Global=<id>,paintjobN,…,<parts>; TuningFullBodykit=1; TuningChance=…` for every stock car that has them | **BUILT** 2026-08-19 |
| 7 | [007 — Pipeline and field](007-pipeline-and-field.md) | the pmb `add-vehicles` stage, cars-server, the 115-car field round, budgets priced | **BUILT** 2026-08-19 (stage + cars-server + budgets; the field round waits on the link ceiling) |
| 8+ | trains (FLA `gtasa_trainTypeCarriages.dat`) | LATER — the user's call; not planned yet | — |

Dependencies: `vehicle-installer` 012 and 013 first — **both BUILT 2026-08-19**; (they build the `.fxt`, ModelVariations, audio and
parked merges this chain imports). `asi/perfect-vehicle` 002 before 005 may exceed 30 `link` pairs / 16
parts per car.
