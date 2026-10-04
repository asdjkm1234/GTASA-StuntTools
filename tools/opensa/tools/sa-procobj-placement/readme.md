# @opensa/sa-procobj-placement

Bake **GTA-SA procobj scatter species** (bushes, rocks, scrub, joshua…) into **permanent static IPL instances**
— one row per object at `lod = -1`, with the species' range raised in the stock `procobj.ide`.

**This tool builds for the real game only.** OpenSA scatters the same clutter at runtime, where draw distance is a
setting and none of SA's ceilings exist, so a bake buys it nothing.

> **Renamed from `lod-procobj-generator` and stripped of LOD generation on 2026-08-10**
> ([plan 014](docs/plans/014-permanent-rows-no-lod-twins.md)). The HD+LOD twin per object is gone: a generated LOD
> recovered ~0.2 % of a hand-modelled bush's geometry for the price of a whole entity, and at the shipped density
> the twinned shape **could not fit SA's ceilings at all** — 13 inst-bearing areas needed against the 12 left.
> Range now comes from the IDE (299, ProperFixes' value) rather than from a LOD, because a streamed row is not
> even resident past ~190 m.

```sh
tsx tools/sa-procobj-placement/src/cli.ts --out <path> --game <path> [--in <dir>]
```

- `--in` — optional folder of HD procobj models (`<model>.dff` + `<model>.txd`), intersected with `procobj.dat` to
  pick the species. **Omit it to bake every `procobj.dat` species straight from the game's own `gta3.img`** (no
  model/texture swap). A path that does not exist, or a directory holding no `.dff`, means the same as omitting the
  flag: the library logs a line and bakes every species. That tolerance is for callers that pass the folder
  unconditionally (perfect-map-builder passes `<mods-src>/procobj` either way) — an `--in` typed EXPLICITLY on the
  CLI is still validated, so a typo is loud.
- `--out` — output drop-in directory
- `--game` — game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--draw` — draw distance written onto the baked species' rows in the stock `data/maps/generic/procobj.ide`
  (default `299`). **This is the layer's only range mechanism.** Stock declares all 107 procobj species at `59`,
  which is why SA's runtime clutter pops in almost underfoot. **Keep it below 300**: SA classifies a def at
  drawDistance ≥ 300 (FLA's "LOD distance") as a big building, and MASS text-IPL instances of big-building defs
  corrupt that path — script-gated IPLs (the barriers2 roadblocks) got ghost-loaded on any save, verified by
  in-game bisection 2026-07-06 (300 reproduces, 250 is clean). 299 is ProperFixes' value and the one their
  57 583-row layer is measured running.
- `--max` — cap on baked procobj objects (`0` disables)
- `--height` — optional min HD height (m) gate, drops short clutter and leaves it on the runtime scatter
  (default `0` = off)
- `--prelight [info.json]` — copy each model's **stock** prelight onto its swapped HD DFF (needs `--in`), so a
  pack's model isn't black/washed-out next to stock geometry. Applied **trunk-only** — opaque surfaces; foliage
  (alpha-cutout) keeps its own prelit, decided by the texture's own alpha. Optionally pass a JSON of per-model
  overrides — `--prelight ./info.json` with `{ "cedar1_po": { "skip": true }, … }` opts those models out. Bare
  `--prelight` applies to every model. Shared with `lod-trees-generator` via
  [`@opensa/sa-lod/prelight`](../lod-common/src/prelight.ts).
- `--modloader` — emit **two** independent **Modloader mods** (real game) under `<out>`, so **no stock IDE is
  rewritten**:
  - **`<out>/lod/`** — the placements: the permanent `plobj<i>.ipl` files, the raised `procobj.ide` and the
    stripped `procobj.dat` at their `data/` paths, and a `loader.txt` of `IPL` lines. (The folder is still named
    `lod/` for compatibility; it carries no LOD.)
  - **`<out>/hd/`** — the swapped (prelit) `--in` procobj HD models + the custom TXD in `gta3img/`, plus a `txdp`
    IDE that **parents** each swapped model's stock TXD to the custom one — so the custom textures resolve without
    rewriting the stock IDE (the same approach as `lod-trees-generator`). Omitted with no `--in`.

  Without `--modloader`, writes into `<out>` + patches `data/gta.dat`, with the `--in` HD swap inlined into
  `gta3.img`. See [`docs/plans/004-modloader-output.md`](./docs/plans/004-modloader-output.md).

## What it does

Reads each candidate species' geometry for one number — its **bbox height**, which feeds the `--height` gate —
then reuses the engine's own vanilla procobj scatter to place the species as **permanent static instances**, and
strips those species from `procobj.dat` so nothing scatters them twice. Nothing is decimated and no LOD is built:
[plan 014](./docs/plans/014-permanent-rows-no-lod-twins.md) removed the twin.

The placement is **one text row per object at `lod = -1`**, split across `plobj<i>.ipl` files of ≤ 9 600 rows.
Two ceilings shape that, and both are real on the target:

- **A text IPL carrying `inst` rows costs one of SA's 40 `IplEntityIndexArrays` slots.** 28 are stock, so the
  layer has ~12. `EntityIpl = unlimited` does NOT lift this — measured twice on 2026-08-10.
- **An area's rows pass through the `gpLoadedBuildings` boot buffer** (stock 4 096, lifted by OLA
  `EntitiesPerIpl = unlimited`). The largest anyone is measured RUNNING is 9 627 — ProperFixes, text rows with no
  streams. Read that number for the path it was measured on: the same cap applied to rows **plus** stream records
  crashed on the first area.

**Never emit the placement as binary IPL streams for range.** `CIplStore` only loads a stream's slot while the
player is inside its bounding box grown by 190 units, so a streamed row is not resident far enough to use a long
draw distance at all. A `lod_procobj.models` manifest lists the baked species for downstream generators, and the
never-touch [`UNDERWATER_PROCOBJ`](../map-placement/src/procobj-strip.ts) species (seaweed/starfish/searock) are
skipped.

The layer costs one permanent `CBuilding` per object, so the game needs a `Buildings` pool raise (OLA
`Buildings`) — see [`docs/gta-sa-original/reference-install.md`](../../docs/gta-sa-original/reference-install.md)
for the number this install needs. Only ONE limit adjuster may patch the IPL zones (FLA + OLA both active there
crash at load).

A shared `--in` TXD is **trimmed** to just the textures the swapped procobj models use (via
`@opensa/map-placement/retxd`), so a vegetation pack's tree/non-procobj textures don't bloat the output.

## Architecture

A thin orchestrator over one shared package. Plans: [`001` architecture](./docs/plans/001-architecture.md) ·
[`002` build pipeline](./docs/plans/002-build-pipeline.md) · [`003` SA asset format](./docs/plans/003-sa-asset-format.md) ·
[`014` permanent rows](./docs/plans/014-permanent-rows-no-lod-twins.md).

- **[`@opensa/map-placement`](../map-placement/)** — SA map-edit workflows (procobj scatter → permanent IPL rows,
  the IDE draw-distance raise, `gta.dat` edits, swapped-HD retexture), shared with `lod-trees-generator`.
- **[`@opensa/sa-lod`](../lod-common/)** — still used for the prelight transfer and the model-local mesh builder;
  its decimate/encode half belongs to `lod-trees-generator` and `opensa-lod-generator` now.
