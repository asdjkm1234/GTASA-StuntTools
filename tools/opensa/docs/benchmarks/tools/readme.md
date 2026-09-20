# Tool-build measurements — the third family

**What lives here:** measured numbers of BUILD TOOLS — wall-clock of a full run, input/output sizes,
per-item tables. Neither of the other two families fits them: a tool run has no frame cost
(performance family) and no behaviour lap (vehicle-physics family), but the standing rule — every
measured number gets committed here, immediately — applies to it the same.

**Conditions are still the whole point.** Every file names its inputs (which game tree, which mod set,
which flags) and the machine; two runs are only comparable when those match.

## File naming

`YYYY-MM-DD-<tool>-<what>.md` — e.g. `2026-08-13-vehicle-cutscene-fleet.md`.

## Chronology

| Date | File | Tool | What |
| --- | --- | --- | --- |
| 2026-08-13 | [2026-08-13-vehicle-cutscene-fleet.md](2026-08-13-vehicle-cutscene-fleet.md) | vehicle-cutscene | The first full 23-model fleet build (plan 002 step 10): sizes, wall-clock, structural verification |
| 2026-08-15 | [2026-08-15-vehicle-installer-batched-img.md](2026-08-15-vehicle-installer-batched-img.md) | vehicle-installer | The batched gta3.img write: a stage that could not finish now takes 6.13 s — and emits a 4.27 GB archive no reader can open |
| 2026-08-15 | [2026-08-15-vehicle-cutscene-no-base-copy.md](2026-08-15-vehicle-cutscene-no-base-copy.md) | vehicle-cutscene | `--no-base-copy` (plan 006): 1.72 GiB of output down to 579 MiB and three files, byte-identical to the copy run |
| 2026-08-15 | [2026-08-15-mod-installer-layered-flat-path.md](2026-08-15-mod-installer-layered-flat-path.md) | mod-installer | The flat path across plan 011: byte-identical install before/after the layer walk — and why the session's wall-clock is not usable |
| 2026-08-15 | [2026-08-15-vehicle-installer-models-new.md](2026-08-15-vehicle-installer-models-new.md) | vehicle-installer | `models/` + `new/` (plan 007): the flat path byte-identical before/after, the structured tree going 0 → 212 cars (and the cutscene census 0/23 → 23/23), rebake per car |
| 2026-08-17 | [2026-08-17-model-repack-lod-half.md](2026-08-17-model-repack-lod-half.md) | model-repack | opensa-lod-generator plan 007: the OpenSA one-model swap gains its LOD half — gostown one cell 1.9 s (LOD rebake 1.2 s), lab LOD cut from the swapped HD (md5 proof), the all-archives source fix |
| 2026-08-17 | [2026-08-17-pmb-resume-killed-build.md](2026-08-17-pmb-resume-killed-build.md) | perfect-map-builder | `--resume` on the first REAL killed build (gostown, SIGTERM at weld chunk 6/21): refused over a consumed chain dir (fixed), then resumed at chunk 7 — 122 s vs 197 s unbroken, pak + water + all archives byte-identical |
| 2026-08-17 | [2026-08-17-vehicle-installer-rebake-sa.md](2026-08-17-vehicle-installer-rebake-sa.md) | vehicle-installer | `--rebake --kind sa` (plan 008): one car into the real-SA tree in 4.2 s (vs a 707 s build), 3.7 GB peak RSS, archives byte-identical on the idempotence run |
| 2026-08-18 | [2026-08-18-cutscene-converter-0.4.0.md](2026-08-18-cutscene-converter-0.4.0.md) | cutscene-converter | The first Windows runs (the user's machine): cold start ~5 s, conversion ~2 s — the cold start is 2.5× the work it starts, and the portable format owns it. Plus the released artifact's figures (exe 89 008 404 B, asar 199 198 B, plugin sha1) |
| 2026-08-19 | [2026-08-19-translucent-cluster-agglomeration.md](2026-08-19-translucent-cluster-agglomeration.md) | opensa-pack / renderware | The translucent-cluster agglomeration goes O(n^3) → O(n^2): the ferris ring's 1 440 bulbs 3 238 → 25 ms, the model bake 3 745 → 412 ms, grouping proved identical across all 4 605 tests |
| 2026-08-20 | [2026-08-20-mod-installer-uncompressed-replacements.md](2026-08-20-mod-installer-uncompressed-replacements.md) | mod-installer | Plan 015's price: 18 of 80 PNGs replace an uncompressed raster, 2 673 → 18 264 KB (`vehicle.txd` 11.3 → 22.2 MB), mod pixels byte-exact; full `sa` build 11 m 27 s with the stage table, delivery 102 files / 21.9 s |
| 2026-08-21 | [2026-08-21-lod-trees-impostor-bake.md](2026-08-21-lod-trees-impostor-bake.md) | lod-trees-generator | Plan 013 steps 01-03: the supersampled, mip-aware card bake — speckle 6.0 → 1.1 % and 3.6 → 0.4 % with the canopy MASS unchanged, DXT5 edge error 26 → 10, bake ×7.1 (stage ~2 → ~9–10 min); one winding per card, 16 → 8 triangles; and the density verdict — the cage was ×1.59 the HD's canopy mass and is ×0.97/×0.86 after, so 4 cards stay |
| 2026-08-25 | [2026-08-25-phone-map-only-astc-encode-wall.md](2026-08-25-phone-map-only-astc-encode-wall.md) | opensa-pack (on the PHONE) | The first tool timing taken on the device, and it moves where the cost is: a map-only convert of `los-santos-wide` welds 16 cells in **76.6 s** and then spends **~2 550 s** in the single-threaded ASTC encode — 97.1 % of the run. Android killed it at 6 m 25 s, so no battery setting reaches this; `TEXTURES=rgba8` removes the stage. Not comparable to the desktop rows above |
| 2026-08-22 | [2026-08-22-pmb-both-targets-after-013.md](2026-08-22-pmb-both-targets-after-013.md) | perfect-map-builder | Both targets rebuilt on lod-trees 013: `opensa` 3 420 s (its own stage 2 532 → 2 529.5 s, unchanged — the whole +616 s is `trees`), `sa` 1 298.6 s (+1.0 % on yesterday's same-steps run), and the new `gta.dat` order guard costs under half a second and reports 0 against 137 rows |
| 2026-08-22 | [2026-08-22-lod-trees-013-on-the-built-trees.md](2026-08-22-lod-trees-013-on-the-built-trees.md) | lod-trees-generator / cell-weld | Plan 013 read off the SHIPPED bytes: 6 tris per impostor on `sa` and 8 on `opensa`, 182 of 184 rows classify as vegetation (67 without the `lod`-strip retry, and 0 match by their own name), the pak welds 49 820 impostor triangles ALL cutout, sway reaches 425/562 LOD cells against 435/562 HD — plus why the viewer pair is a look check and not a parity number |
| 2026-08-28 | [2026-08-28-phone-mcp-round-trip.md](2026-08-28-phone-mcp-round-trip.md) | phone-console (MCP) | The first timing of the agent↔phone channel itself: the tunnel floor is **~230 ms** and does not move with payload size, so an agent pays per CALL; `phone_state` — the tool everything is told to call first — costs **1 378 ms** because the panel re-runs all sixteen preflight probes each time. Plus what plan 002's protocol change adds to every session: +1 506 B of handshake instructions and +2 071 B of tool metadata |
