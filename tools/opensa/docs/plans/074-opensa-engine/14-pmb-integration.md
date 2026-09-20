# 074·14 — perfect-map-builder integration + the final modded-map measurement

[← chain](readme.md) · prev: [13 cleanup](13-cleanup.md) · relates: the parked
[066-pmb-modern-tool](../066-pmb-modern-tool/) chain (its data thesis ships THROUGH this engine)

`opensa-pack` grew up as a standalone converter; its real home is a stage inside the perfect-map-builder
pipeline, where the full modded game (the actual product) is assembled. This plan embeds it and closes the
loop with the measurement the whole 074 chain exists for: **the user's full modded map, through pmb, on the
own engine, benchmarked**.

## Part A — embed the converter into the pmb pipeline

- `opensa-pack` becomes a pmb stage (the standing decisions land here):
  - **wind-adapted vegetation** supplied by the pipeline itself — the `--wind` overlay CLI dies
    (user decision, 074/06 row 10 note);
  - **stochastic list** curated in pmb data (+ the `stochastic-candidates.ts` area scan as a pipeline
    report; the skygfx texdb import stays an input option) — plan 12 stays default-off until its
    histogram-preserving pass regardless;
  - **receiver-mesh densification hook** — the prerequisite recorded in
    [roadmap/0.6.0/04-graphic-improvements/01](../../roadmap/0.6.0/plans/04-graphic-improvements/01-baked-directional-shadows.md);
    pmb owns mesh surgery, so the subdivision stage belongs here even if the shadows v2 lands later;
  - pmb's existing bakes (prelight/night sets) run BEFORE the converter so the pak carries final colours.
- **Full-map conversion engineering** (the measured blockers from the plan-10 ledger):
  - chunked welding (region-sized scratch with an overlap margin for the bake BVH — 16 GB held one city;
    the full map will not fit);
  - bake worker pool (bakes were 91 % of convert time and are per-cell parallel);
  - meshopt wire compression of cell payloads + brotli (geometry = 82 % of the pak; the top size lever),
    decode in the pak worker;
  - BC-encode of the processed α-subset (third priority, after the two above).
- Determinism + content hashes stay non-negotiable (pmb reruns must produce byte-identical paks for
  unchanged inputs — the incremental-build enabler).

## Part B — the final measurement (the chain's exit exam)

- Convert the FULL map from the user's modded profiles (`game-src/anderius`, `carcer`, `gostown` — the
  stress inputs pinned in plan 11) with everything on: HD vegetation, all pmb mods, all bakes.
- Ledger per profile: pak size (raw / wire-compressed), convert wall-time (chunked + pooled), verts/draws,
  and the bench matrix: `city` + `drive` + `orbit` + night runs, all against the plan-11 gates.
- The headline row the project has been building toward: **full modded SA, 2× retina M3, own engine —
  fps/CPU/GPU vs the three-WebGL prod line (65 ms CPU / ~31 ms GPU / 14 454 draws)**.
- Acceptance: 60 fps floor on every scene of every profile (the user's original bar — "60 fps with the
  full effect set and this data volume", recorded verbatim in the 00 concept).

## Tasks

- [x] pmb stage wrapper — 2026-07-19. `packGameDir(options)` is the library entry (`opensa-pack/src/pack.ts`)
      and `'pack'` is a pipeline stage; config in `BuilderConfig.pack`, no CLI flags on the pipeline path.
      The extraction produced a byte-identical pak. A full pmb run is still owed.
- [x] Chunked welding + bake worker pool — 2026-07-13, see ledger (A2). Full-map single-command convert
      unblocked: peak RSS 5.2 GB (vs 16 GB monolithic for ONE city), bakes 2.7× on a QUARTER of the cores
      (`--bake-workers` raises it when thermals allow).
- [x] meshopt wire stage (+ worker-side decode) — 2026-07-13, see ledger. Brotli deliberately NOT taken:
      `DecompressionStream` has no brotli, a WASM brotli decoder would outweigh its gain over
      meshopt+deflate, and static hosting can still serve `Content-Encoding: br` transparently.
- [ ] BC α-subset encode (after the size ledger says how much it still matters).
- [~] `--wind` CLI REMOVED (2026-07-19, with `--cell-size`, `--chunk-cells`, `--no-sunvis`). The DATA has
  not moved into pmb config yet — until it does, unadapted vegetation sways by height-above-base.
- [ ] **Output shape = "almost a copy of the game, in our format"** (user, 2026-07-18): opensa-pack
      behaves like every other tool in the chain — a game-ready set IN, a game-shaped set OUT. Converted
      assets become the pak; loose LIVE-TUNABLE data files (timecyc first — `data/timecyc_24h.dat` /
      `timecyc.dat`) ship as FILES next to it, not baked into the manifest. Motivation: the manifest-baked
      timecyc froze weather/fog at convert time and silently diverged from prod the moment the user
      iterated on the install's file (2026-07-18 field finding; the game host now reads the live VFS —
      plan 21 ledger). Includes: **update the LAB to consume this output like a game dir** (it currently
      has no game fs — that is the only reason `manifest.timecyc` exists), then DELETE the manifest
      timecyc field + `setup.timecyc` plumbing entirely.
- [ ] **SCOPE: `opensa-pack` CONVERTS THE MAP, AND ONLY THE MAP — user decision 2026-07-18.**
      Vehicles and peds keep loading raw DFF/TXD at runtime. This SUPERSEDES the "one format for
      everything" direction taken earlier the same day (kept below as the record of what was weighed).

      **The reasoning, and it is a good one: MODDABILITY.** `opensa-pack` works in tandem with
      perfect-map-builder, and that tool chain owns the MAP — it never touches cars or peds. Keeping the
      same boundary in the pak means a new car can be added through **modloader** as the game itself does
      it: drop in a DFF/TXD, no reconversion, no pack rerun, no format migration. Funnelling vehicles
      through the converter would have made every added car a build step, which is precisely the
      extensibility the project exists to preserve.

      **What that settles:**
      - The runtime keeps its RenderWare parser + DXT decoder. That is now a DELIBERATE capability
        (mods are read at runtime), not debt to be paid off.
      - The BC-vs-RGBA8 split is by design too: the map is converted and ships compressed; dynamic
        content is decoded live. Two paths, two different jobs.
      - `buildVehicleModel` and `buildPedModel` stay RUNTIME builders — the browser twins the game and
        the viewers share. `vehicle-probe`/`ped-probe` remain what they always were: fixture bakers for
        the lab, not the start of a format.
      - The viewers keep reading raw source, so they can still answer "did the converter break this, or
        was the DFF already broken?" — for the map, where a converter actually exists.
      - Loose live-tunable data files (timecyc, above) are unaffected: still files next to the pak.

      **FOLLOW-UP TASK, scheduled AFTER the opensa-pack rework (user, 2026-07-18): delete
      `ped.json`/`ped.bin` entirely.** Peds — the PLAYER included — must load vanilla DFF + TXD + IFP at
      runtime, exactly like cars already do. Today they do not: `apps/web/src/ui/engine-player.ts` and
      `apps/engine-lab/src/ped.ts` both fetch `/ped/ped.json` + `.bin`, a build-time bake from
      `ped-probe` carrying exactly THREE clips (`IDLE_CLIP/WALK_CLIP/RUN_CLIP` by index). So a modded
      player model or any fourth animation is invisible to the game — the one place still violating the
      vanilla-assets rule. `buildPedModel` + `pedClip` (landed in 074/13 phase 4.1d) already make this
      possible from the browser. Scope: rewire both hosts onto the VFS, then delete `ped-probe.ts`,
      `public/ped/`, `apps/engine-lab/public/ped/` and the `PedFixtureJson` type. Open question to settle
      then: which model the player uses, since stock `player.dff` is a 6-vertex placeholder (CJ is
      assembled from clothing components).

- [ ] Full-profile conversions (original, anderius, carcer, gostown) + the final bench matrix.

## Measurement ledger

_(per profile: pak raw/wire MB, convert minutes, verts, bench matrix rows; the 60 fps verdict)_

**2026-07-13 — meshopt wire stage (A1 stage 2) landed.** Cells travel as an `.oswire` container
(header/tables verbatim, vertex payload = meshopt vertex stream @ stride 36, index payload = meshopt index
stream) with deflate-raw on top; entry `enc: 'oswire-deflate-raw'`; the pak worker inflates + meshopt-decodes
and hands the main thread the exact raw `.oscell` (old `deflate-raw` paks still readable). The meshopt index
codec canonicalizes per-triangle cyclic rotation (order + winding survive) — safe because the only
flat-interpolated attribute (texture layer) is per-material-uniform within a triangle; the wire test asserts
rotation-normalized equality.

| Metric (ls-bench rect, wind overlay, full bakes)      | deflate-only (12 Jul) | meshopt+deflate (13 Jul)                 |
| ----------------------------------------------------- | --------------------- | ---------------------------------------- |
| pak total                                             | 93.9 MB               | **68.9 MB** (−27 %)                      |
| cell geometry raw → wire                              | 147.5 → 60 MB (~2.4×) | 147.5 → **34.9 MB (4.23×)**              |
| worst-cell decode (9,-7,hd, 14 MB raw, Node ≈ worker) | inflate 24.9 ms       | inflate 12.7 + meshopt 6.0 = **18.7 ms** |
| convert wall                                          | 145.1 s               | 143.8 s (encode cost noise-level)        |

Decode is WORKER-side (blob latency, not frame time) and NET FASTER than the old path — deflate now inflates
the smaller meshopt streams. All 40 entries verified decodable in Node against the real pak (rawLength +
structure checks). **Full-LS measured: 497.5 → 311.2 MB (A1 ≤ ~400 MB gate CLOSED)**; `pak-sf` 52.3 → 40.9 MB.
Same day: bakes went OPT-IN (`--bakes`, see plan 03) — the bakeless full-LS iteration convert is **31.8 s**
(vs 939 s with bakes; bakes don't change pak size — their channels live in reserved vertex bytes).

**2026-07-13 — A2 landed: bake worker pool + chunked welding.**
Pool: `bake-pool.ts`/`bake-worker.ts` (worker_threads; the occluder BVH crosses as SharedArrayBuffers — never
copied per worker; cells go as transferred f64 flat arrays — an f32 hop would break bit-parity with the
serial path, which `bake-flat.test.ts` pins). Default = a QUARTER of `availableParallelism()` (user decision:
thermals; `--bake-workers N` overrides). **Serial vs pooled pak: SHA1-identical** (SF rect, full bakes).
Chunking: convertDistrict welds → bakes → encodes per 6×6-cell chunk (`--chunk-cells`), occluder ring =
2 cells (500 u ≥ the 400 u sun-vis ray reach — chunk BVHs shadow exactly like the district BVH; ray counters
matched the monolith to the digit). Chunked reruns are byte-identical (determinism contract).

| Full-LS `--bakes` convert | monolithic serial (12 Jul) | chunked + pooled (13 Jul, 3 workers) |
| ------------------------- | -------------------------- | ------------------------------------ |
| wall time                 | 939 s                      | **532 s** (bakes 832 → 307 s = 2.7×) |
| peak RSS                  | ~16 GB (held ONE city)     | **5.2 GB**                           |
| pak                       | 311.2 MB (meshopt)         | 332.8 MB (+7 %)                      |
| groups avg                | 17.7                       | 18.1 (+2 %)                          |

Chunking price v1 (accepted): ring cells re-plan textures → array-layer ORDER differs from the monolith →
slightly more groups/cell and a worse meshopt vertex-order ratio (+7 % pak). Known fix if it ever matters:
a global texture pre-pass before the chunk loop. Full-MAP projection: ~3.3× LS ≈ 28 min at quarter-cores,
~18 min with `--bake-workers 6` — the "one command on the M3" criterion is met; the weld itself is now the
next lever (ring re-welds ≈ 2× border cells).

**2026-07-13 — FIRST FULL-MAP CONVERT (A3 opens).** Rect −12,−12..11,11 (all of SA), bakeless (user's
fast-iteration mode), one command: **71.4 s wall, 1121 cell entries, 769.7 MB wire** (vs the ~1.6 GB
pre-meshopt projection), 106 texture arrays, 176 timed objects, 64 anim-static welds, 12 GB heap flag.
Served as `pak-map` (lab + standalone `?src=pak-map`; root symlink like pak-ls). Convert progress lines
(chunk n/N, %, ETA) landed the same round — `ConvertOptions.log`, CLI-wired.

**POST-FLIP QUALITY PASS (user directive 2026-07-13):** after the engine flip, do a thorough pass over
`map-optimizer` + `opensa-pack` in THIS order: (1) FIRST the normals / smoothing-groups problem (SA DFFs
carry split-vertex per-face normals; welding and per-vertex N·L expose faceting, and bake rays fire along
those same normals — bad normals poison everything downstream), (2) THEN the baked shadows. Related open
mystery (2026-07-13): a fully-baked pak-map VERIFIED to carry real sunVis data (Grove Street cell: 26 k
full-shadow verts, channel flags set, shader gate present, env strengths at defaults) shows NO visible
shadow difference in the field — root cause not found, investigation parked with bakes staying opt-in.
**CLOSED 2026-07-21 (user triage): the root-cause hunt is dropped — bakes stay opt-in; reopen only if
baked shadows return as a feature (ideas 0.6.0/04).**

**2026-07-13 — FULL-MAP `--bakes` CONVERT (A3 tail closed): 202.6 s wall** (the ~28 min projection was
~8× pessimistic — ocean chunks are near-free and the pool scales), rect −12,−12..11,11 + `--clouds`:
1121 cell entries, **pak 287.1 MB**, groups avg 15.0 max 73, 98 texture arrays; AO bake 124.4 s
(13.25 M verts / 12.04 M unique, 144.5 M rays vs 17.5 M tris), sun-vis 124.4 s (107 M rays; the two ran
in the same pooled pass). NOTE: the earlier bakeless log recorded "769.7 MB wire" for the same rect —
the 2.7× delta is suspicious (different measurement or a since-fixed encode path); re-verify if pak size
ever becomes a decision input. Field check of baked shadows/AO on the full map = user's next look.
