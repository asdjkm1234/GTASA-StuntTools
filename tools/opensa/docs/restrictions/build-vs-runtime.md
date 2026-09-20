# Build-time vs runtime restrictions

**A decision taken while the game is BUILT cannot be re-taken while it runs.** The mod folder is gone by
boot, the RW parsers are gone from the vehicle path, and the material names are gone from a converted model.
Any plan that wants the runtime to "just read it" has to check this list first.

## A vehicle exists only as its converted `.osm`

`loadVehicleData` resolves `<model>.osm` and nothing else; a car with no converted model raises
`No converted model for '<name>'` at spawn. There is no DFF fallback — it was removed 2026-07-28 with the
runtime modloader ([postmortem](../postmortem/runtime-modloader-overlay.md)).

The reason is this whole page in miniature: everything a car carries beyond raw geometry is baked in —

- its `features.txt` declaration (`UP/DOWN_LIGHTS`: a pop-up pod whose lamps carry no SA marker),
- its **plate slots** — after conversion the material NAME is gone and texture layers are model-local, so the
  tag in the `.osm` DESC is the only thing that can still say "this quad is a plate",
- its per-vertex sky occlusion, its wheel fitting, its door/submesh rig.

A car served from a runtime `.dff` would not spawn slower; it would spawn **wrong**.

**Caught:** yes — the spawn throws, and a test pins it.

## Editing a mod's data means rebuilding that car

`data/vehicle-features.txt` is written by `vehicle-installer` and read by `opensa-pack` while baking. Nothing
reads it at runtime. The same goes for a `*.settings.txt` handling/carcols row once it is merged into the
built `data/*`.

Turnaround is `vehicle-installer --rebake <game> [--only <model>]` — one car ≈ 3.6 s, all of gostown ≈ 26 s —
not a full pmb run.

**Caught:** no. A stale `.osm` looks exactly like a correct one.

## Mods are installed, never overlaid

`mod-installer` / `vehicle-installer` / `ped-installer` merge a mod into the game dir before it is packed.
There is no boot-time overlay; the VFS reaches the game unwrapped. A plan proposing "let the user drop a
folder in and see it" is proposing to ship the converter to the browser — see the postmortem above for the
shape a revival would need.

**Caught:** yes, trivially — there is no code to overlay with.

## Nothing about a vehicle lives in the pak

The roster is TEXT (`data/vehicles.ide`, parsed at boot), a spawn resolves `<model>.osm` **by name**, and the
pak manifest holds cells / textures / water only — no vehicle table, and `modelById` has no id range check.

This is what makes `--rebake` able to ADD a car on the id its mod declares. It also means a plan may not
assume the pak knows the car roster.

**Caught:** n/a — this one enables rather than forbids.

## A NAME resolved from `data/` cannot be resolved at runtime by a surface that streams a pak

The world's place names take two files to produce: `data/info.zon` holds the boxes with a GXT **key** in the
last column (`GAN`, `LMEX`), and `text/american.gxt` holds the text those keys resolve to. Both are files of
the game dir.

**A surface that streams a `.ospak` over HTTP has no game dir**, so neither is reachable and no amount of
layering gets it there — the dispatch console spent its first months on a hardcoded table of twenty Los
Santos landmarks for exactly this reason, which is a demo of stock SA and wrong on every total conversion.
So the resolution happens at build time: `opensa-pack` reads both, resolves each box, and writes
`districts.json` beside the pak (`manifest.districts`), the way the water bake rides beside it.

The general rule this is one instance of: **if a value takes two `data/` files to compute, a pak-only
consumer cannot compute it — bake it or do without it.** The same shape will come back for `popcycle`, for
`carcols` names, and for anything else keyed through the GXT.

What it costs, stated rather than discovered: the table is a fetch at boot and a few tens of kB, it is
regenerated per build, and a pak built before the field existed carries none — so every consumer needs an
answer for *this world has no district names* rather than treating an absent table as a failure. A total
conversion shipping no `info.zon` is the same case, and it is a real one.

**Caught:** no. A surface that cannot resolve a name shows a fallback or a blank, and both look deliberate.

Detail: [`tools/opensa-pack/src/districts.ts`](../../tools/opensa-pack/src/districts.ts),
[201/5-03](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).

## A baked pyramid carries the SQUARE it was baked over — the runtime cannot recover it

A tile pyramid is a picture of a world at a fixed extent: which world units the archive's zoom-0 tile covers
was decided by whatever ran the bake, and no amount of reading tiles back tells you. A surface that assumes a
square — San Andreas' 6000, say — draws a plausible city in the wrong place on every total conversion, and on
a district-sized pak it draws the district's tiles across the whole state.

So the square is METADATA in the archive (`scheme.origin`, `scheme.span`, `scheme.tileSize`,
[contracts/dispatch-map.md](../contracts/dispatch-map.md)), it comes from the pak's own extent at bake time,
and a reader that does not find it refuses rather than guesses. The same rule as every other build-time
decision in this file: what the build knew and the runtime cannot re-derive travels WITH the output.

**Caught:** yes, at open — an archive with no square is refused by name. **Silent** if a reader ever assumes
one instead: the map draws, every tile loads, and the city is in the wrong place.

## The look is baked, so tuning a look parameter costs a re-pack

If a value is going to be iterated on, it belongs in the **shader**; only the anchor belongs in the bake.
Plan 090 learned this twice: baking a cabin SHAPE cost a re-pack per iteration, and the second attempt (bake
the distance, let the shader own the falloff) got it right and was still rejected on looks.

**Caught:** no — it costs time, not correctness.

Detail: [`postmortem/090-vehicle-cabin-at-night.md`](../postmortem/090-vehicle-cabin-at-night.md),
[`contracts/vehicles.md`](../contracts/vehicles.md).

## Never re-pack a pack OUTPUT, and never read one as a source

`opensa-pack` replaces every converted `<model>.dff` in the archives with its `<model>.osm`. Point the packer
(or any weld, or a LOD bake) at `build/<game>/opensa` and almost no clump resolves: cells weld nearly empty and
the run reports a plausible-looking pak of a quarter of the world (464 cells / 87 MB against 1 123 / 1.0 GB —
`docs/plans/097-cleo-basic/06-packaging-pipeline.md`), with no error. Sources are `game-src/<game>/models/*.img`
(ALL of them — a TC ships its world in its own archive) plus the mods, or the pack INPUT kept with
`--keep-work`; `scripts/debug/model-repack.ts` regenerates what it needs from those.

**Caught:** no — SILENT. Sanity-check every pack against the known cell count / size; the lab instrument
reads sources by construction.

Detail: [`opensa-lod-generator` plan 007](../../tools/opensa-lod-generator/docs/plans/007-one-model-lab-lod-half.md).

## Whatever the loaders disagree about, the game disagrees about

The runtime resolves assets by BARE name (`fs.get('bmycg.osm')`) and the VFS is a flat map of exactly the
keys a loader delivered. The folder/http-dir loaders fill it by reading the IMG directory and ingesting each
entry; the fetch loader pushes chunk bytes in verbatim and has no archive step of its own. Anything an
offline packer leaves in a CONTAINER is therefore reachable in one mode and invisible in the other.

A new delivery path may not assume it can ship a container the runtime is expected to open. Either the packer
expands it (what `fetch-pack`'s `expand-img.ts` does, on the local loader's precedence) or the loader learns
to — and if the two ever disagree about which archive wins a duplicated name, one mode silently renders
different bytes than the other.

**The rule is about the KEY SPACE, not just about containers**, and that is the half it is easy to write too
narrow. Keys must be spelled the same way too: the local loader lowercases every loose path and the runtime
looks a data file up by the lowercased path `gta.dat` names, so a packer that preserves the on-disk spelling
hides every file a mod chose to capitalise. gostown ships `data/maps/Gostown6/Gp_City.IPL`, 32 of its 67
files carry an uppercase letter, and in fetch mode the map still RENDERED (that comes off the pak) while
`resolveMap` saw 384 placements instead of 3 970 — so the world looked right and the player fell through it.

**Caught:** YES, since 2026-08-03 — `tools/fetch-pack/src/loader-parity.test.ts` packs a TC-shaped fixture
(mixed-case map folder, an override archive, a model only the override carries) and asserts that no key the
LOCAL loader would serve is missing from the pack, and that no key is packed in a spelling the runtime will
never ask for. Containment, not equality: the pack ships a superset by design. The test was verified against
both defects by reintroducing them — each probe fails it.

Before that it was caught by NOTHING, and silently: the game boots and throws only when something asks for a
missing name, which is why the container half surfaced as "player model not found" rather than "fetch mode
carries no archive contents", and the case half surfaced as a world that rendered and could not be stood on.
`gostown` was the only fetch-served game and it was disabled, so both shipped unnoticed.

Detail: [`architecture/tools.md`](../architecture/tools.md#standalone-tools),
`tools/fetch-pack/src/expand-img.ts`, and plan [086](../plans/086-unified-build-naming-fetch/readme.md).
