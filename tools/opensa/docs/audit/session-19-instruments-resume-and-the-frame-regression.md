# Session 19 (2026-08-17): the tool round — sa/opensa one-model instruments, layered installers, pmb `--resume` — and the frame regression that closed it

**On `main`, 22 commits after `550e6a3a`, tree clean, suite 490 files / 4 452 green, tsc + eslint clean.** The
session opened on his order (bug first, then the OpenSA one-model instruments, then the installers' layers,
then the mod-installer DXT warning); the "bug" was a stale bottle, the tools all shipped, and the day ended on
his `bench=all` of the first build with the full high-poly fleet — a ×2.5–3.3 GPU-pass regression that four
in-game arms narrowed but did not close (open issue). Zero full pipeline runs spent on a hypothesis: the two
`original` opensa builds of the day were the rebuild he asked for (the first died at the LAST step and gave us
plan 006).

## What changed

| area | change | commit |
| --- | --- | --- |
| field method | the "new/ cabbie not installed" report was the BOTTLE: only `gta3.img` + `data/maps` had been delivered for the LOD retest; `vehicles*.img` were the 15 Aug build, the vehicle data files 10 Aug; `modloader.asi` is still active there | `916de68f` (`gta-sa-original/reference-install.md`, "The trap in delivering to it") |
| `tools/tool-kit` | `openImgFamily` / `imgFamilyMembers` (a spilled `vehicles.img`+`vehicles2.img` read as ONE archive); `layers.ts` moved in from mod-installer (`planLayers`, ONE planner for mods/vehicles/peds); `unregisterImgArchives` | `013a12a0`, `9774fa4c`, `2c1ed2d7` |
| `tools/vehicle-installer` | `--rebake --kind sa` (plan 008: the same `applyVehicle` as install over the archive FAMILY, each kind refuses the other's tree by `.osm` vs `.dff`; cabbie 4.2 s vs a 707 s build, archives byte-identical on the idempotence run); `tuning_new_parts.txt` read + `assertCarmodsModels` + `sharedVehicleFiles` warning (plan 009 — the boot crash `0x4C4576`); layered `common/sa/opensa` vehicles (plan 010, `resolveVehicleSources(inPath, target)`, `--kind` IS the target) | `1e6d02a5`, `43ec6e98`, `9774fa4c` |
| `tools/ped-installer` | layered peds folder (plan 005) | `9774fa4c` |
| `tools/mod-installer` | `txd-alignment.ts` — WARN per raster, naming the mod, on every `.txd` path (archive entry, Modloader bake, loose overlay, PNG texture folder) when a DXT side is not a multiple of 4; no byte change (plan 014) | `f7066c3e` |
| `tools/perfect-map-builder` | target passed to vehicles/cutscene/peds, layered vehicles/peds refused in a both-target run; **`--resume`** (plan 006: `resume.json` identity + done steps, `opensa-lod` its own step, `openResumeSession`, failed step's partial dir deleted; refuses on changed sources/config/HEAD) | `9774fa4c`, `cd86fc24` |
| `tools/opensa-pack` | `rewriteModelArchives` per FAMILY (the day's first build died at the archive rewrite: `.osm` inserted "near" its dff regardless of the split → `vehicles.img` past the 1.75 GiB cap at entry 152/406); per-chunk weld checkpoints (`checkpoint.ts`, `convertDistrict({checkpointDir, resume})`, `--checkpoints/--resume` standalone) — resumed pak byte-identical on real data | `2c1ed2d7`, `cd86fc24` |
| `packages/cell-weld` | `TexturePlanner.journalSince/restore` (incremental layer journal — ALSO the sidecar the ospak in-place card needs); `WaterHeightGrid.entries/restore` | `cd86fc24` |
| `scripts/debug` | `model-repack.ts` re-bakes the rect's cell LODs from the swapped HD (`opensa-lod-generator` adapter, overlay first, built `lod_*` excluded, rect-scoped `lods.txd`) + `--dff/--txd` + all source archives (a TC's world in `gostown6.img`; the built archives hold `.osm`) — the OpenSA one-model swap (opensa-lod-generator plan 007; gostown 1.9 s, original 88-model rect 17.4 s); `carmods-check.ts` | `07f20f03`, `43ec6e98` |
| `vehicle-cutscene`, `cars-server` | `--target` for a layered vehicles folder (cars-server default `sa`) | `9774fa4c` |
| docs moved | `docs/plans/102` → `tools-debug/bench-harness/docs/plans/001`, `docs/plans/103` → `tools/opensa-lod-generator/docs/plans/007` (his call: the central folder is engine plans only) | `64f52feb` |
| restrictions | `build-vs-runtime.md`: never re-pack a pack OUTPUT (SILENT); `architecture.md`: layered vehicles/peds under the both-target rule; `dxt-raster-dimensions.md`: caught at install time now | `07f20f03`, `9774fa4c`, `f7066c3e` |
| in-reserve | `ospak-in-place-cell-patch.md` (trigger named in `model-repack.ts`'s header; plan 006's planner journal lowers its price) | `07f20f03`, `a9c8aa16` |
| gta-sa-original | `carmods-unknown-part-crash.md` (`LoadVehicleUpgrades` → `SetupVehicleUpgradeFlags` on a null model info, no id-range check), the bottle delivery trap | `43ec6e98`, `916de68f` |
| benchmarks | `tools/2026-08-17-vehicle-installer-rebake-sa.md`, `tools/2026-08-17-model-repack-lod-half.md`; `opensa-engine/2026-08-17-ingame-*` ×4 + index rows | see below |
| open issue | `opensa-gpu-pass-regression-2026-08-17.md` | `050ff5f4` |
| CLAUDE.md | the OpenSA lab + `--resume` in the standing rules: instruments before rebuilds; a dead run is resumed | `e95f47ec` |
| outreach (NO_COMMIT) | `outreach-0.4.0.md` — Discord / Reddit / where-else texts, his 3a as the template | — |

## What it cost / what it bought

- Builds: two full `original` opensa runs (the first died at the archive rewrite after 55 min → plan 006 the
  same day; the second, with the family fix, 2 804 s green: 1 124 cells, pak 1.21 GB, `vehicles.img` 1 781 MB
  + `vehicles2.img` 1 415 MB — the .osm fleet ≈ 0.95× its dff+txd, the growth prediction held).
- Instruments: a car into the sa tree in 4.2 s (was a 12-min stage); a world model + its cell LOD into a
  servable OpenSA lab pak in 2–17 s (was ~50 min); a dead pack re-entered at its last chunk (was stage 1).
- Tests: +5 vehicles-dir, +9 rebake-sa, +11 tuning-parts, +3 img-merge, +2 ped e2e, +4 openImgFamily, +9
  resume, +2 pipeline resume e2e, +2 checkpoint, +2 planner journal, +2 archive-edit, +5 txd-alignment; the
  layers tests moved to tool-kit. Suite 4 396 → 4 452.

## Verified in the field / by measurement

- The bottle boots; the `new/` cabbie is on the road (plan 007's `new/` layer confirmed in a REAL run for the
  first time, plan 008's path with it) — after the plan-009 fix; before it the first full `data/` delivery
  crashed at `0x4C4576`.
- Resume determinism: unbroken / checkpointed / resumed-after-chunk-0 → `world.ospak` md5 identical
  (`69c9614a…`), manifest identical.
- The frame: `bench=all` on the new build — no city scene holds 120; four arms (fleet pin, `procobj=0`,
  `draw=400`) exclude the fleet (~10–15 %), the runtime clutter and the far ring; the engine is unchanged since
  08-12; render targets are +22 % on his window (`target` 422 vs 345); the rest is near-field per-pixel cost
  on the new pak. Open issue with the ordered next steps.

## Open after this session

- The GPU-pass regression (issue above): next = the UNCAPPED headless sweep on this pak (surface-free), then
  `probe=0`, then a per-layer rect-repack bisect on `country-dusk`, then an alpha-class census of the cells.
- His field verdict on the OpenSA lab (`?src=/build/original/opensa-lab`, `burger01_law`).
- `original`'s vehicles/peds folders are NOT migrated to layers (nothing needs a per-target car/ped yet).
- Not built from plan 006's text: per-model-class checkpoints inside the pack (~9 min re-run); not yet
  exercised on a real killed `original` build.
- The `procobj=0` arm's draws/tris did not move at all — whether the knob applied on that path is unverified.
