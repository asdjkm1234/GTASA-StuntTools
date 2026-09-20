# Patching ONE cell of the shipping `world.ospak` in place

**Out of:** opensa-lod-generator plan 007 (`tools/opensa-lod-generator/docs/plans/007-one-model-lab-lod-half.md`), 2026-08-17 — the OpenSA one-model swap.

**Why deferred:** the container permits it (4096-aligned, individually compressed entries; the runtime reads
ranges; `validateOspakManifest` checks alignment + bounds only — an `img-patch`-style append + repoint would
validate), but a subset weld cannot reproduce the shipping pak's TEXTURE PLAN: `TexturePlanner`
(`packages/cell-weld/src/textures.ts`) assigns `(arrayRef, layer)` eagerly in first-use order over the whole
map and persists nothing, so a re-welded cell would bind the wrong layers of every array. Doing it honestly
means (1) the full pack writes a `name/contentHash → (arrayRef, layer)` sidecar beside `manifest.json`,
(2) the instrument welds the cell against that plan (unchanged textures keep their layer; a new texture
appends a layer to its bucket's array — the array entry re-encoded and re-appended, `meta.layers` bumped — or
opens a new `array-N`), (3) appends the cell + touched arrays, repoints the manifest, bumps `byteLength`,
(4) reload the page — a live session's resident cells hold bind groups on the old arrays
(`restrictions/gpu-and-shaders.md`). Also: `fetch-pack`'s chunk hashes are invalidated by a patched pak, so
the output is a `?src=` dir, never a deployable. Measured need today: none — the lab pak
(`model-repack.ts`, seconds) answers every one-model A/B; what it cannot answer is a verdict that depends on
the SHIPPING dictionary or on world-context prelight, and no field report has needed one.

**Note (2026-08-17):** pmb plan 006 (`--resume`) plans to persist the TexturePlanner snapshot per pack chunk
and keep it as `pak/texture-plan.json` — the exact artifact step (1) needs; when 006 ships, this card's price
drops to steps (2)–(4).

**TRIGGER:** a one-model field verdict that the lab pak cannot carry — a defect that reproduces only in the
shipping pak (its texture arrays, its prelight passes, its generated-LOD exclusions), or a swap that has to
reach `fetch-pack`.

**Where the trigger is checked in code:** `scripts/debug/model-repack.ts` header + `assembleLab` — the lab
never writes to `build/<game>/opensa/pak`, and the header names this card as the path for a swap that must.
