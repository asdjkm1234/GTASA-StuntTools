# Session 25 (2026-08-18): two lanes read as one, and the price of the fleet

**On `main`, 8 commits after `2cbdf0a4` (session 24's audit), tree clean; tsc + eslint clean;
`tools/vehicle-installer` + the features parser suite 13 files / 112 green (the suites the next session touches);
`knip` unchanged from its pre-existing exit 1 (the new debug script is in the same unlisted-workspace-deps
class as every other `scripts/debug/*`).** No engine, tool or pak code changed this session — the code delta
is ONE debug script; everything else is measurement and record. His order: the GPU-pass regression, then two
A/B builds of his own design, then a plan for `features.txt` on the real game.

## What changed

| area | change | commit |
| --- | --- | --- |
| `docs/open-issues/` | **The GPU-pass "×2.5–3.3" is CLOSED on step 1 and moved to `fixed/`.** The UNCAPPED headless sweep on the fresh pak (same lane as the 08-12 record) reads `country-dusk` ×1.09, `ocean-horizon` ×1.04, city ×1.5–1.7 tracking triangles and draws. The issue had tabled the user's DISPLAY-lane rows (`target 422`) against Claude's HEADLESS rows (`target 345`) — and his own lane already read `country-dusk` 12.47 on 08-09, before any suspect change. Record + index row + the lesson in the readme's comparability list ("name the LANE of both sides before you name a suspect") | `d40cbbdc` |
| `docs/benchmarks/` | **Two A/B builds, his idea, run by him on his lane against arm A**: build 1 (mods 64–67 out, full fleet) — the four 08-16 mods cost 2–6 % of pass; build 2 (all mods, STOCK cars) — **the pass returns to the 08-09 level: the fleet is +1.0..2.6 ms on the city scenes and ~700 draws in view, the whole map's growth since 08-09 is +0.0..0.5 ms, `country-dusk` moves in no arm.** Side finding: the `cellVertex` residency counter INCLUDES vehicle geometry (ocean-horizon 349 → 57 with zero live cars) — the "×2–3 cellVertex on every scene" the issue read as world growth was the fleet's buffers | `19f98bf1`, `79ef25c0` |
| `docs/performance/deferred-optimizations/vehicle-submesh-draw-batching.md` | The lever now carries the fleet's measured price, the two facts above, and **a build-time route in four priced steps** (same-state weld of opaque submeshes −36 % fleet-wide by census; one texture array per car; fold never-moving parts into the chassis — CLEO-named `misc_*` stay; classify interior/enginebay for a runtime cull) plus what the build cannot buy (`_vlo` is on 192/200; the vertex cost wants an intermediate LOD). **Parked by the user**; reopen with step 1, pair arm A, control `ocean-horizon` | `4e66a590`, `ad7df71c`, `94f60910` |
| `scripts/debug/vehicle-submesh-census.ts` (+ README row) | The instrument for that route: shown-by-default opaque submeshes vs distinct runtime states over the built fleet, the translucent count, the `_vlo` census, per-part breakdown for one car. 200 cars: opaque 16 954 → 10 932; mean 96 k body tris vs 4 k LOD | `ad7df71c` |
| `tools/vehicle-installer/docs/plans/011-model-special-features.md` (+ README chain) | **PLANNED, not built:** a mod car's `features.txt` reaches the REAL game through fastman92's `data/model_special_features.dat` (`<model> <standard model>`, loader enabled in the reference install, file shipped empty). The 15-token vocabulary with stock carriers (his `FEATURES_MAPPER`) is committed as data, shared by both targets; a resolver picks the carrier covering all tokens; five loud warnings; a field checkpoint with the two questions only the bottle answers (does FLA remap a STOCK id; is the file read per boot) | `fd83b856` |
| `docs/plans/098-all-land-vehicles/` (02, 06, readme) | The vocabulary moves from `NO_COMMIT` to data; 02 builds the shared `VEHICLE_FEATURE_TOKENS` module FIRST; 06 gains `BAGBOXA/BAGBOXB/TUGSTAIR` and an ORACLE — every stock carrier must be detected from its own asset without a token | `fd83b856` |
| `docs/gta-sa-original/vehicle-special-features.md` (+ README row) | The fact about the original and the install: abilities are a branch on the model id; FLA's loader vs its per-class id list (we use the loader) | `fd83b856` |
| `docs/debug/README.md` | one stale link repointed (`ipl-row-removal-breaks-lod-links` → `fixed/`), found by this audit's link check | this |

## What it cost / what it bought

- **One headless sweep (15 min) closed a four-arm, one-day investigation** — no rebuild, no bisect, steps 2–4 of
  the issue never ran. The record already held the answer (an 08-09 row on his lane); the readme now says to
  look for one first.
- **Two full opensa builds (40 + 43 min, sequential, `--exclude sa[,vehicles]`, an APFS clone of `mods-src`
  for the mod-less variant) and two of his sweeps** priced the fleet whole. Both trees are still on disk
  (`build/ab1-no-recent-mods`, `build/ab2-stock-cars`, ~12 GB, plus `mods-src/original-ab-no-recent-mods`);
  deleting them is his call. Every number is in `docs/benchmarks/` with the pak it read.
- **A census (minutes, read-only) turned "batch the fleet's draws" from an inferred lever into four steps with
  a number each** — and was parked with its numbers, which is the cheapest possible parking.
- Suite unchanged (no code); the ONE pre-existing red (`model-osm-uv-anim` timeout under full-suite load) and
  the knip exit 1 are as sessions 23–24 left them.

## What the session settled

- On the user's display, the city scenes have not held 120 since at least 08-09; `country-dusk` costs 12 ms
  there and 4 ms headless on the same content — a property of that surface, not of the pak, and not this
  issue. If 120 on his display becomes the goal, the fleet's draws are the lever, and the build-time route
  goes first.
- A regression report names the lane of BOTH sides before it names a suspect (`docs/benchmarks/readme.md`).
- The special-ability vocabulary is data in the repo, one module for both targets: `sa` translates a token
  into FLA's file, OpenSA hands it to a detector whose oracle is the same table.

## Left for session 26 (his order)

1. **`features` part 1** — vehicle-installer plan 011 step 1 (the shared `VEHICLE_FEATURE_TOKENS` module +
   resolver, in `packages/renderware`'s `vehicle-features.parser.ts`, with tests) which is also 098/02's first
   step; then 011 steps 2–4 (the `sa` writer in `install.ts` + `rebake-sa.ts`, the warnings, the contract rows);
   the field checkpoint is his.
2. His items unchanged: re-upload the cutscene-converter zip, push (now 34 commits ahead), delete or keep the
   two A/B trees.
