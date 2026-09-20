# Contract — the dispatch map's own files

What the dispatch console (`apps/dispatch`) looks for beside a built game, and what happens when a name is
spelled wrong. Its neighbours in this folder are [mods.md](mods.md) and [vehicles.md](vehicles.md); this file
is the console's half, and it exists for the same reason they do — a name that carries behaviour and cannot
be grepped for is a name nobody can follow.

## 1. `tiles.pmtiles` — the flat 2D map's whole pyramid

**Where:** beside the built game the console streams, i.e. at the root `?src=` names —
`build/<game>/opensa/tiles.pmtiles` for a field run. `?tiles=<url>` overrides it with an archive anywhere.

**What it is:** one [PMTiles v3](../links.md) archive, read by HTTP range requests. Written by the console's
own baker (`?bake=tiles`, [201/6-02](../plans/201-dispatch-console/6-display-modes/readme.md)) and readable
by `pmtiles`, MapLibre and QGIS as it stands.

**What it must carry**, because the reader takes it from the file rather than assuming San Andreas:

| Metadata key | Meaning |
| --- | --- |
| `scheme.origin` | the world square's south-west corner, GTA ground coordinates |
| `scheme.span` | world units per side (the pyramid is square by construction) |
| `scheme.tileSize` | pixels per tile side, as baked |
| `scheme.minZoom` / `scheme.maxZoom` | the levels the archive actually carries |
| `world` | which build it was baked from |
| `built` | when |

**When it is spelled wrong, or absent:** the console keeps its projected grid and the status bar says
`grid — <reason>`. Nothing throws, nothing is logged as an error, and the map still works — so the reason on
screen is the only thing that distinguishes "there is no archive here" from "the tiles have not arrived
yet". An archive that parses but carries no `scheme` is refused by name (`the archive carries no world
square`) rather than drawn on a guessed square: a pyramid read on the wrong square is not a broken picture,
it is a picture that is silently in the wrong place.

**Directory compression is `none`.** Our writer produces it and our reader refuses anything else by name — a
gzip stream is a valid varint stream, so a reader with no inflater would return entries that decode, address
real offsets and serve the wrong bytes.

## 2. `<model>.osm` in the built game's archives — what a unit is drawn as

**Where:** the archives beside the pak, under the game dir `?src=` resolves —
`build/<game>/opensa/models/vehicles.img`, then `vehicles2.img`, `peds.img` and `gta3.img`, in that order.
The console reads them over HTTP **Range** requests: the directory first (32 bytes an entry), then one entry
when a unit claims it ([201/5-04](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md)).

**What names it:** the unit's own `model` field — a bare name (`copcarls`, `ambulan`), matched
case-insensitively, exactly as the game resolves a spawn. It is never a model id: an id is a slot, and a slot
means different things in two builds ([restrictions/assets-and-data](../restrictions/assets-and-data.md)).

**Where that name comes from is NOT the position feed.** PCAD publishes a position; what a unit drives is
board state, like its callsign and its status
([202 §4](../plans/202-pcad-dispatch/readme.md) owns the seam, including what its `vehicleId` field turns out
to mean). The map takes a name and asks no further.

**What must exist:** `<name>.osm` — the CONVERTED model. There is no DFF fallback anywhere in this surface
([build-vs-runtime](../restrictions/build-vs-runtime.md)): a build converted without `--vehicles` carries
`copcarls.dff` and no `.osm`, and the console will not parse it.

**When it is spelled wrong, absent, or the archives are not served at all:** the unit is drawn exactly as it
was before models existed — chevron, callsign chip and beacon — and the console says so **once per name** in
the log (`[units] 'copcarls' is drawn as a symbol: this build carries no model of that name`). The name is
not asked for again in that session. `?inventory=1` carries the same fact as numbers
(`symbology.unitsAsSymbolOnly`, `symbology.unitsUnresolvedModels`), and the readout shows `cars 7/9`.

A unit is never dropped from the map for want of a model. That is the whole rule: a hole where a unit should
be is indistinguishable from a unit that went off duty, and a dispatcher would act on it.

**A total conversion is the normal case, not the failure case.** `copcarls` is a stock San Andreas name; a
conversion that ships its own fleet has none of them, so the mock board's units fall back to symbols there by
construction. What a real board reports is the model its own build carries.
