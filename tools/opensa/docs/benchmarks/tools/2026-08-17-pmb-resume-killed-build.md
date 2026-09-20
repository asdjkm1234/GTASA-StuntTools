# 2026-08-17 — pmb `--resume` on a real killed build (gostown opensa)

**Tool:** `perfect-map-builder` (plan 006 `--resume`), `opensa-pack` per-chunk checkpoints.
**Inputs:** `game-src/gostown` (TC, `gostown6.img` 189 MB), `mods-src/gostown` (1 car, peds, `broken-prelight`,
`lod-always`, `lod-holes`), `--exclude sa`, AO on, sun-vis off. Machine: the dev Mac (Darwin 25.6, Node 24.15).
Code: `main` `6db01626` + the uncommitted fixes recorded below (working tree, same HEAD).

| Run | What | Wall-clock | Result |
| --- | --- | --- | --- |
| 1 | fresh, `SIGTERM` at pack weld chunk 6/21 (116/384 cells) | killed at ~T+130 s (chain 22 s + LOD bake + 8 s of weld) | `.work-opensa/`: `4-optimize`, `opensa-lod`, `pack-checkpoints/chunk-0..5.{json,bin}` (12 files), `resume.json` (`failed` absent — a signal, not a throw) |
| 2 | `--resume` (before the fix) | refused at once | `--resume: step 'split' is recorded as done but its dir is gone: …/1-split` — the chain deletes consumed dirs; only `4-optimize` survives |
| 2b | `--resume` (after the fix) | **122 s total, pack 99.8 s** | `resume: 6/21 chunks taken from checkpoints (116 cells)`; chunk 7/21 first to weld; model classes re-run (6 s); `build-timings.json` marks split/vehicles/peds/optimize `resumed: true` |
| ref | fresh, unbroken, separate `--out` | **197.3 s total** | the comparison tree |

**Byte identity, resumed (2b) vs unbroken (ref):**

| File | 2b | ref |
| --- | --- | --- |
| `pak/world.ospak` | `1009a277c5c2d0049b4face50779085a` | same |
| `pak/water.bin` | `35f82b7ba645136b971e05db98b77196` | same |
| `models/gostown6.img` / `gta3.img` / `gta_int.img` / `lods.img` | `ba4be38b…` / `a095e516…` / `ba503178…` / `e9aa1a28…` | same, all four |
| `pak/manifest.json` | differs in ONE field: `buildTime` `12:35` vs `12:39` | — |

**Also found by the exercise (fixed the same day, `pipeline.test.ts` +2):** the first gostown build since the
cutscene stage was added died on the raw `ENOENT …/models/cutscene.img` after the vehicles stage — a TC
ships no cutscene archive; the stage is now skipped with a line saying why.

**Reading:** the resume saved 197 − 122 = 75 s on a 200-s build (the whole chain + the LOD bake + 6 weld
chunks); on `original` the same shape saves the ~50 min before the pack. The model classes are 6 s here — the
per-class checkpoint (`docs/in-reserve/opensa-pack-model-class-checkpoints.md`) has nothing to save on this
tree.
