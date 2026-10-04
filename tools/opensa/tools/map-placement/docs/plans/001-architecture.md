# 001 — map-placement: architecture & API

**Status: ✅ As-built (shared library).** `@opensa/map-placement` is a `type:tool` **library** (no CLI) holding the
SA map-edit workflows shared by the LOD tools: object-id allocation, IDE / `gta.dat` editing, swapped-HD retexture,
and procobj scatter conversion / stripping. It was extracted from `lod-trees-generator` (+ the procobj modules
recovered from git history and generalised) — see `sa-procobj-placement`
[001 §extraction, phases 2 & 4](../../../sa-procobj-placement/docs/plans/001-architecture.md).

## Why it exists

`lod-trees-generator` (impostors) and `sa-procobj-placement` place map content the **same** way — allocate ids,
register IDE/`gta.dat`, edit IPLs, retxd swapped HD models, scatter procobj into static IPL. They diverged on
2026-08-10: lod-trees still places HD+LOD pairs, while procobj places **permanent rows with no LOD at all**
([014](../../../sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md)). Both emitters live here. That placement machinery lives here so both import it instead of duplicating
it. `tool-kit` stays format-agnostic; this package is the SA-specific **write** layer.

Layering: `@opensa/rw-codec` (bytes) → `@opensa/renderware` (read/parse) → **`map-placement`** (SA write
workflows) → the LOD tools (CLI). Sits beside `sa-lod` (mesh encode) under `tools/`.

## Public API (`exports`)

### `./ide` — id allocation + registration

- `allocateLodIds(models, used)` → `Map<model, id>` — the **lowest unused** ids in the stock space, ascending,
  gaps allowed, deterministic (models sorted). **Hard cap `id ≤ 18630`**: ids above it silently fail to load on
  stock SA (no limit adjuster) — the "HD swapped, no LOD shows" symptom. Do not widen the window.
- `lodAlias(name, index, prefix = 'lodt')` — the model name SA registers (IDE `objs` + `<model>.dff` IMG entry).
  Usually the LOD's own name; when it would overflow the IMG entry limit (≤ 19 chars), a short synthetic
  `<prefix><index>` (visuals unaffected — the DFF still names its real textures in the shared TXD).
- `buildLodIde(modelToId, txd, drawDistance)` → an IDE `objs` text (`id, model, txd, drawDistance, flags`, id-ordered,
  CRLF). Flags `0x200084` (alpha + draw-last + LOD-friendly).
- `patchGtaDat(dat, idePath)` — splice an `IDE` line into `gta.dat` (IDEs must load **before** the IPLs that
  instance the models).

### `./retxd` — swapped-HD retexture (coverage-gated)

- `retxdSwappedModels(gamePath, idePaths, dffPath, txdPath, models)` → `RetxdResult { ides, txds }` — when a
  swapped HD DFF references textures that live in the user's `--txd` (not the stock TXD its IDE names), pack the
  custom TXD **and** rewrite the model's IDE `txd` column to it.
- `selectTxd(refs, custom)` / `editIdeTxd(text, modelToTxd)` — the **coverage gate**: a model is repointed only to
  a custom TXD that actually contains its textures (the one covering the most, ≥ 1 hit). A model whose textures
  aren't in any `--txd` keeps its **stock** `txd` — repointing it would strip its textures in-game.
- `trimTxd(bytes, keep)` (`./txd-trim`) — before packing, each custom TXD is **trimmed to the union of texture
  names its repointed models reference**, dropping the unused `TEXTURE_NATIVE` chunks (kept ones copied **verbatim**
  — native format preserved, count fixed). A shared mod TXD often also holds textures for models we dropped
  (procobj / non-tree); only the repointed models read it, so trimming is lossless + safe. Falls back to the whole
  TXD on a locked/recovered/round-trip mismatch. (e.g. a 49 MB vegetation TXD → ~36 MB, 148 → 94 textures.)

### `./procobj-strip` — `procobj.dat` filter

- `stripProcObj(text, keep)` → `{ removed, text }` — drop every scatter rule whose object (column 2) fails `keep`;
  comments/headers/surface+spacing columns preserved.
- `UNDERWATER_PROCOBJ` — the never-touch set (seaweed/starfish/searock, surface `P_UNDERWATERBARREN`): **never
  stripped, never converted**, regardless of `keep`. Shared land debris (`p_rubble*`) is intentionally **not** here.

### `./permanent-areas` — placements → permanent text IPLs (plan 014)

- `buildPermanentAreas(placements, areaBase, maxRows?)` → `{ datLines, files, instBearingFiles }` — one row per
  placement at `lod = -1`, split spatially into `<areaBase><i>.ipl` files of ≤ `AREA_MAX_ROWS` (9 600, just under
  the 9 627 the field has ProperFixes running). **No binary streams**: a stream's IPL slot is only resident within
  190 units of the player, so a streamed row cannot carry draw distance.
- `instBearingFiles` is returned because it is the budget — one of SA's 40 `IplEntityIndexArrays` slots each, and
  a number in a comment is not a guard (plan 007's budget went stale in silence).

### `./streamed-areas` — HD+LOD pairs, streamed (lod-trees only since 014)

- `buildLinkedAreas(pairs, areaBase)` → text IPL of permanent LOD rows + `<area>_stream<k>.ipl` binary tiles whose
  `lod` field indexes those rows. `isLinked(pair)` is the default-true test. Linked and unlinked pairs go to
  SEPARATE areas: the link is decided per pair but a slot is spent per area, and splitting on position alone once
  had 28 % of the pairs spending 100 % of the slots.

### `./procobj` (`convert.ts` + `world.ts`) — scatter → permanent IPL rows

- `buildPermanentIpl(final, species, areaBase)` → the emitter above, fed by the scatter; `rows` is the object
  count now (one permanent row each), which is what the `CBuilding` pool pays.
- `PROC_OBJ_DRAW_DISTANCE = 299` + `setIdeDrawDistance` (in `./ide`) — the layer's RANGE mechanism: the baked
  species' rows in the stock `data/maps/generic/procobj.ide` are raised from SA's authored **59**. Only species
  actually placed are raised; the rest keep 59 for the runtime scatter.
- `removeStaleAreas` — the bake runs in place on a tree nobody wipes, so a run that emits fewer areas than the
  last deletes the surplus. Without it a census over the directory reads two scatters at once (measured: 95 584
  rows for a 91 092-row run).
- `convertProcObj(options)` → `null | { datLine, objects }` — convert `--dff ∩ procobj` species from runtime
  scatter into **static IPL instances**: reuse the engine's vanilla `scatterProcObjects`, keep everything under
  the density cutoff and slice to a global `procObjMax` cap, emit each as an HD `inst` + its LOD `inst`
  (text-internal `lod` link), and strip those species from `procobj.dat`. (A per-species MINDIST min-spacing cull
  sat between the two until 2026-08-09; the column is a camera radius, not an inter-object distance.)
  Generalised: `ProcObjSpecies = { hdId, height, lodId, lodModel }` (not impostor-specific); the IPL name is an
  option. Returns the `gta.dat` IPL line to register.
- `iplQuaternion(yaw)` — the yaw→quat helper.
- `buildMapDefinitions(gamePath, archive)` (`world.ts`) — assemble the `MapDefinitions` (object catalog from the
  gta.dat IDEs + every instance from the text IPLs and the binary IPL streams in `gta3.img`) that the engine's
  collision / procobj-scatter code expects — the **offline** counterpart of the runtime resolver.

## Invariants / gotchas (shared with the consumers)

- **id ≤ 18630** (`allocateLodIds`) — see above.
- **IDE before IPL** in `gta.dat` (`patchGtaDat`).
- **IPL LOD-index coupling** — the static IPL links each HD `inst` to its LOD `inst` by a text-internal `lod`
  index; never reorder/partially strip those rows. ([[ipl-lod-index-coupling]])
- **retxd coverage gate** — never repoint a model to a TXD that doesn't cover its textures.
- **`UNDERWATER_PROCOBJ`** — never touched.

## Tests

`ide.test.ts`, `retxd.test.ts`, `txd-trim.test.ts`, `procobj-strip.test.ts`, `procobj/convert.test.ts` — each module unit-tested
(id allocation cap/determinism, coverage-gated retxd, the never-touch strip, MINDIST cull + IPL emit). Consumers
(`lod-trees-generator`, `sa-procobj-placement`) cover the end-to-end wiring.

## Consumers

`lod-trees-generator` (impostor placement), `sa-procobj-placement` (simplified-copy placement). Both also use
`@opensa/sa-lod` (see its [001](../../../lod-common/docs/plans/001-architecture.md)) and `@opensa/tool-kit`.
