# One texture array per vehicle, at the size of its LARGEST texture

**Status:** APPLIED 2026-08-04 — pulled exactly as written below (per-(w,h) buckets AND per-bucket BC1/BC3,
both steps of the lever's own table), pulled by a CORRECTNESS forcing function rather than a frame report:
the gostown comet mod (32 textures, one of them 2048²) made the single-array shape hit **exactly 128 MB of
TEXS** (32 layers × 2048×2048 × 1 B BC3 = 134 217 728), which overran the VER2 `.img` u16 sector ceiling
and read back truncated — the car could not spawn at all (`restrictions/assets-and-data.md`, both entries). Implemented as
`VehicleTextures.packBuckets()` + the `bucketDictionary` step in `buildModelOsm` (vehicles, clutter, props,
anim objects; peds already bucketed, map objects stay on the world plan). The runtime needed NOTHING: the
submesh `array` field and the per-array rebind already existed, exactly as the "already supports it" section
below said. Falls back to the legacy single array (with a logged warning) only when a submesh straddles size
buckets or a lamps-on twin splits from its base — both throw in validation, neither seen on the assets
measured. Measured on the forcing car: **comet.osm 136.6 → 20.3 MB**; the no-data-loss gate now proves
per-vertex texture identity through the remap, and `admiral` ships multi-array in the round-trip tests.
The translucent bind-switch cost this doc flagged has NOT been re-measured — watch the bench sweep's draw
column if a fleet scene regresses.

## What we do today

A model's dictionary becomes ONE `.ostex` array, and an array is "every layer the same W×H and the same
format" (`packages/engine-formats/src/ostex.ts`). So two rules apply to a car's textures at once:

- **one size** — the array is `max(width) × max(height)` over the model's layers, and every smaller texture
  is resampled UP into it with a nearest-neighbour fetch (`packages/renderware/src/vehicle/textures.ts`);
- **one format** — BC3 as soon as a SINGLE layer needs alpha, so every opaque DXT1 layer (0.5 B/px) is
  re-encoded at 1 B/px (`tools/opensa-pack/src/model-ostex.ts` explains the choice and already names the
  split as "smaller still").

This is the simplicity we bought: one array, one bind group, one upload, one `meta.x` layer index per
vertex, and the same alpha pipeline as the world planner.

## What it costs today, measured

`build/gostown/opensa`, the 12 mod cars under `mods-src/gostown/vehicles`:

| Model | source `.txd` | shipped TEXS | array | layers | vs each texture at its own size |
| --- | --- | --- | --- | --- | --- |
| hermes | 4.0 MB | 28.0 MB | 1024×1024 | 28 | 5.0× |
| alpha | 2.6 MB | 28.0 MB | 1024×1024 | 28 | 8.0× |
| previon | 2.8 MB | 27.0 MB | 1024×1024 | 27 | 7.2× |
| supergt | 2.2 MB | 27.0 MB | 1024×1024 | 27 | 7.3× |
| elegy | 2.7 MB | 27.0 MB | 1024×1024 | 27 | 7.1× |
| banshee | 2.8 MB | 23.0 MB | 1024×1024 | 23 | 4.3× |
| stallion | 2.2 MB | 23.0 MB | 1024×1024 | 23 | 7.5× |
| stratum | 1.6 MB | 14.5 MB | 1024×512 | 29 | 4.8× |
| admiral | 1.2 MB | 9.8 MB | 512×512 | 39 | 4.0× |
| yosemite | 1.7 MB | 9.5 MB | 1024×512 | 19 | 3.3× |
| comet | 2.0 MB | 7.3 MB | 512×512 | 29 | 2.3× |
| petro | 0.6 MB | 5.0 MB | 512×512 | 20 | 5.6× |

`banshee.osm` is **27.6 MB**, of which GEOM is 3.4 MB (about the source DFF) and **TEXS is 24.1 MB**. The
arithmetic is exact: 23 layers × 1024 × 1024 × 1 B = 24 117 248. Its dictionary holds three 1024² textures
and nineteen smaller ones down to 16×16, and **2 of its 22 textures carry alpha** — so three textures set
the size for all twenty-three, and two set the format for all twenty-three. All 13 `.osm` in that archive
total **297 MB**.

For scale: the 212 STOCK SA vehicle dictionaries cost 8 MB in total under the same rule. This is a mod-asset
cost, and it grows with the author's texture budget.

## The lever

Bucket a model's textures by exact (width, height) and give each bucket its own array; optionally keep the
opaque buckets in BC1. Same accounting on both sides, over the same 12 cars:

| | Total |
| --- | --- |
| today — one array, max size, BC3 | 220 MB |
| one array per (w, h) bucket | **34 MB** |
| + BC1 for buckets with no alpha | **26 MB** ≈ the source dictionaries |

5–8 buckets per car (13 distinct sizes across the sample: 256² ×89, 512² ×87, 128² ×67, 16² ×13, 64² ×12,
1024² ×10, then 512×256, 128×64, 1024×512 …).

The runtime already supports it: the array index lives on the SUBMESH, and `drawVehicleModel` rebinds when
it changes (`packages/engine/src/engine.ts` — "a car keeps this at 0 for the whole model"). Plates are
unaffected: they are their own arrays on bindings 8/9 (082/03), not layers inside the model's array.

## Measured NEGATIVE result: a shared per-size dictionary buys nothing here

The obvious extension — global arrays per size, each model naming the layers it needs, the way MAP OBJECTS
already work (`textureSource: 'world'`, 400 MB shared vs 3 674 MB per-model) — was measured and does not
transfer to vehicles:

- **within one car: zero duplicate contents**, in all 12;
- across all 12 cars: 302 textures → 231 unique contents, but only **2.2 MB of 26.0 MB** (8 %), 24 shared
  contents;
- stock is no better in bytes: 212 dictionaries, 573 textures, 31 % duplicate contents — 3.6 MB → 2.8 MB.

Map textures repeat because thousands of models reuse the same walls and roads. A car's textures are drawn
for that car. So sharing would add lifetime and residency problems (a global array grows as types spawn and
cannot release one car's layers without repacking; a submesh whose array has not arrived is skipped, which
reads as a broken car rather than a late wall) for 8 % — **strictly worse than per-model buckets**.

Bucket by the exact PAIR, not by a square size class: 512×256, 1024×512, 128×64 and 256×128 all appear, and
folding them into a square class reintroduces the same 2× waste the lever exists to remove.

## What it would cost

- **CPU, per frame.** Up to 5–8 `setBindGroup` per car instance instead of 1. The opaque phase can order
  submeshes by array, so it pays the bucket count against 108–245 draws per car — noise. The TRANSLUCENT
  phase sorts back-to-front by distance (074/16) and therefore cannot group by array: worst case one bind
  switch per translucent submesh, and these cars carry 14–62 of them (hermes 62, supergt 51, yosemite 42,
  alpha 41, previon 39). That is the draw/bind axis the scale-ladder analysis found the frame floor lives
  on, so it must be measured rather than assumed. Mitigation: keep the alpha textures in ONE bucket so a
  car's glass binds once.
- **GPU, per frame: nothing negative.** The upscale is nearest-neighbour and adds no detail, so sampling
  after the split is texel-identical while moving ~8× fewer bytes through cache and bus. This path ships a
  single mip level, so filtering does not change either.
- **Code.** `VehicleTextureArray` becomes several arrays, layer numbering becomes per-array (`meta.x` holds
  the layer), and the builder must assign `submesh.array`. Plus a re-pack and the `.osm` fixtures.

## What it would win beyond bytes

Per-type spawn cost, which is the one 091 measured and left open: reading and parsing the `.osm` (worst
20.5 ms, `bus`) plus the GPU upload (worst 18.2 ms, `tahoma`) — both on the ORIGINAL build, whose cars are
1 MB-class. Nothing has been measured on a 27 MB gostown car. VRAM per spawned type drops ~24 MB → ~3.5 MB.

## What would have to be true to pull it

- A field drive that meets these car types and reports a hitch — the input 091 deliberately left unwritten.
  The lever's shape is the same one the texture-upload fix took (`UPLOAD_BUDGET_MS`), except this removes
  the work instead of spreading it.
- Or a build-size / VRAM ceiling: 297 MB of `.osm` in one archive is already the largest single item in that
  build.

## Cheaper things to try first

- **Cap the array size** (e.g. 512²) — no format change, no bucketing, no bind-switch cost; pays with real
  detail loss on the author's 1024² sheets. A blunt instrument, but it is one constant.
- **`txd-retune.ts --halve`** on the offending mods: the same saving, taken in the mod rather than in the
  engine, and already tooled (`docs/debug/README.md`).
