# 001 — fetch-pack architecture

**SHIPPED 2026-07-23 (plan 086 phase 2).** Replaces `scripts/build-game.ts`, which parsed IDE/IPLs and
partitioned the RAW game (exterior/interior, per-model refs) — content the own engine no longer
consumes. fetch-pack knows nothing about the game: it walks the pmb `opensa/` target, slices, buckets,
zips.

## Contract

- **Input**: a pmb `--out` dir; the SELF-CONTAINED `<build>/opensa` GAME DIR ships whole (phase 8 — the
  engine pak rides inside at `pak/`, becoming `pak/<name>` VFS entries) — the `sa/` twin is the real-SA
  target and never travels.
- **Identity**: `game` + `appVersion` from `<game>/pak/manifest.json` (phase 1; older homes probed:
  the phase-7 `<build>/opensa-pack/` sibling, the legacy nested `<game>/opensa/`). Fallback (pre-086
  pak): build folder basename + root package.json version, with a ⚠ log.
- **Output**: `<build>/opensa-pack/<game>-<version>/` (the second, independent FETCH build; `--out
  ./static/games` stages a local test) — `manifest.json` (`{ chunks, game, version }`, the exact legacy
  shape `packages/loaders/manifest.ts` parses) + `<group>-<sha1·12>.zip` chunks.

## Grouping (the loader's fixed vocabulary)

| group    | content                                                       |
| -------- | ------------------------------------------------------------- |
| data     | `data/` + `text/` + loose root files (`stream.ini`, …)        |
| models   | `models/` (IMGs with `.osm`) + `pak/` (world.ospak, water)    |
| others   | `anim/`, audio, dlls — the rest                               |
| textures | EMPTY — pak textures live inside world.ospak; kept for shape  |

## Slicing

`chunkByHash` buckets ENTRIES — a 1 GB `world.ospak` would ride one bucket whole. Entries above the
50 MB target are sliced into `<path>#<index>` parts first; the fetch VFS reassembles by suffix
(plan 086 phase 3). Already-deflated payloads (`.ospak` slices, `.img`) zip at store level.

## Stability

Same cache math as the legacy chunker: stable hash-bucket assignment (`fnv1a(name) % N`), sorted
entries, fixed zip mtime — one changed file leaves every other chunk byte-identical, so its hash,
filename and the browser cache survive. Caveat: `N = ceil(groupBytes / 50 MB)` is derived from the
group's TOTAL size — a change that pushes the group across a 50 MB multiple changes `N` and reshuffles
every bucket in that group (all its chunk hashes bust at once).

## Measured (first real run, 2026-07-23, pre-086 pak)

`build/original` 3.6 GB → 407 files, 74 chunks (data 1 · models 67 · others 6) in ~2.5 min.
