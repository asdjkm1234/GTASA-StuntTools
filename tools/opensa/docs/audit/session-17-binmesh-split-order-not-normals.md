# Session 17 (2026-08-17): the "normals × repeat textures" smear was the rebuilt BinMesh's split order

**Branch `fix/map-optimizer-normals-skygfx`, unmerged.** What closed: vector 3 of
[`open-issues/fixed/sa-lod-visibility-budget.md`](../open-issues/fixed/sa-lod-visibility-budget.md) (rounds 11–14), the one
filed as "map-optimizer adds normals to prelit world geometry and the install's SkyGfx fork cannot draw them".
It was neither normals nor the fork's shader. What was left open on purpose: vectors 1 (mods — the hospital
group) and 2 (the burger joint), and the same defect class in `encodeLodDff`.

## What changed

| area | change | commit |
| --- | --- | --- |
| `tools/map-optimizer` | `rebuildGeometry` keeps the SOURCE BinMesh split order (materials the source did not draw appended ascending) instead of sorting materials ascending; unit test + real-fixture regression (`cehollyhil06`, 15 splits `0..7, 9..14, 8`) | `c754efdb`, this audit's commit |
| `scripts/lib`, `scripts/debug` | `img-patch` (append-and-repoint IMG swaps + ledger `restore`), `optimize-model` (one model, six named variants), `model-optimize.ts`, `model-lab.ts` (HD + clone LOD, `--dff/--txd`), `dump-binmesh.ts`; tests for the two libraries | `4f589655`, `89bc2688`, `3d14ce09`, `2e39c828` |
| `docs/gta-sa-original` | `skygfx-fork-building-pipe.md` — the install's fork read down to its compiled shaders: no building shader reads normals; the install's ini values; the stochastic path; the instancer | `f77e404a` |
| `docs/restrictions/assets-and-data.md` | "A BinMesh's split order is the DRAW order — a re-encoder keeps the source's, a merge writer puts blended splits last" (caught by test for `rebuildGeometry`, SILENT for merge writers) | `2e39c828` |
| `docs/ideas/stochastic-texturing-v2/` | what turning 074·12's dormant de-tiler on would take, now that the reference install runs the same math on 306 textures | `c9bfb0f5` |
| `docs/test-fixtures` (`scripts/test-fixtures.ts`) | `dff/binmesh-order/cehollyhil06.dff` | this audit's commit |
| `CLAUDE.md` | small map-build changes are swapped in place with the one-model instruments, not rebuilt | this audit's commit |

## What it cost, what it bought

- **Cost:** one field day of single-variable probes (7 restarts: `stochasticTexturing=0`, `buildingPipe=`,
  `buildingPipe=PC`, `--strip-normals-after`, `--crease 180`, `--list-only`, `--restrip`, then the fix), ~1 s
  per model swap instead of ~10 min per rebuild — the instruments paid for themselves on the second probe.
- **Bought:** the defect class named and fixed at its root for every rebuilt world model (the round-7 "white
  patches" on `lodcuntw65` are the same class); normals KEPT on the `sa` target (the rejected "turn
  `addNormals` off" is moot); the reference install's rendering path recorded so the next "SA cannot take
  this" verdict is read against what the plugin actually does.
- **Numbers:** stock `gta3.img` 16 275 geometries, 11 743 with night colours, 338 trilist, 0 trilist with night
  colours; `cehollyhil06` 1 320 → 1 322 vertices, 15 splits, material 8 = 226 blended triangles;
  `--restrip` probe encoder 2 093 strip indices → 3 009 list → 6 015 degenerate-strip indices.

## Verified

- `npx vitest run tools/map-optimizer scripts/lib` — green (map-optimizer 29 files / 157 tests incl. the new
  fixture test; scripts/lib 11 new tests). `tsc --noEmit` clean, eslint clean on every touched file.
- Field: `chain` variant of `cehollyhil06` (HD + clone LOD) — "no bug, it worked" (his eye, 2026-08-17).
- The `bisect-nomods` tree carries that patch; `img-patch.ts restore` per entry returns the shipped bytes.

## Not done (deliberately, recorded)

- `encodeLodDff` blended-last rule for merge writers (decimated clones, hole-fill LODs, cells, procobj) —
  `restrictions/assets-and-data.md` + the issue's round 14 name it; SILENT until built.
  **Built 2026-08-22 (`6b2e37ab`)**, unit-tested on `cehollyhil06` merged with a second model; a single clone
  was already in split order, so the rule bites on merges (opensa cells, hole-fill) rather than on sa clones.
- A whole-tree rebuild + field acceptance of the fix (holm, `lodcuntw65`, the burger joint) — the next step
  before the merge, after vectors 1–2.
- No benchmark row: nothing in the frame changed; the fix is bytes order.
