# 019 — World-context prelight (replace the blind per-model passes)

**Status: ✅ Shipped (Phases 0–4: loader, verdicts + appliers, review report + compare viewer, seam feather
band, vertex-AO rebake). Follow-up: the softening pass (ratioTolerance, curated exclude list) after in-game
review.** Replace the two prelight passes that judge each model in isolation with a
**world-context** scheme: lift the whole map once, fingerprint every model, compare each placement against its
**neighbourhood**, and correct only what actually deviates — day level, night level, and broken/missing night
sets — while provably protecting legitimate night lighting (lit windows, signs, floodlights).

## Why (measured on game-src/original, 2026-07-02)

The current passes use global constants and miss the real offenders while a naive fix would break the legit ones:

| model                       | day mean/med      | vs hood median | night ratio vs hood | current verdict     | truth              |
| --------------------------- | ----------------- | -------------- | ------------------- | ------------------- | ------------------ |
| `clubgate01_lax` (too dark) | 46 / **27**       | **81**         | 0.78 vs 0.34        | "structured" → skip | must be lifted     |
| `project2lae2` (overbright) | 114, spread **0** | **74**         | 0.30 vs 0.30        | 114 ≪ 248 → skip    | flat broken export |
| `laepetrol1a` (lit canopy)  | 84                | 83 ✅          | 0.36 vs 0.38 ✅     | untouched           | correct — keep     |
| `gwforum1_lae` (stadium)    | 71                | 78 ✅          | 0.24 vs 0.26 ✅     | untouched           | correct — keep     |
| `liquorstore03_lae2` (lit)  | 106               | 69 ⚠️          | **0.41 vs 0.26** ⚠️ | untouched           | legit outlier!     |

- `condition-prelit` (plan 012): global thresholds 24/248 + flat-black gate — both offenders slip through.
- `synthesize-night` (plan 013): only **adds** missing night sets (global ×0.7 — `washgaspump` day 148 would
  glow at 4× the hood's night median of 26); never repairs broken existing sets.
- `weld-seam-prelit` (plan 016) welds only coincident seam vertices — a tone step between two ground sheets
  stays visible as a band; it needs a feathering band, not a 1-vertex line.
- `liquorstore03_lae2` proves aggregate statistics alone can't reach 100 %: the last mile is per-material
  analysis + a human review pass.

## Decisions (user-confirmed)

1. **Aggressiveness: HARD first** — outliers are pulled fully to the neighbourhood median (contrast-preserving
   curve); soften (k·MAD clamp) later if the review shows over-correction.
2. **Vertex-AO rebake is in scope** (flat-prelit models get real baked shading via the tool-kit BVH).
3. **Workflow: semi-automatic** — the run emits a review report (stats + rendered before/after thumbnails per
   verdict) and a **compare viewer** (side-by-side model, BEFORE from `original`/any given dir vs AFTER
   from the optimized output). Curated allow/deny lists feed back into the config.

## Design

**Shared world loader (Phase 0).** The adapter will have three world pre-passes (gap-stitch, seam-weld,
prelit-context) — today each lifts the map itself. Extract one shared loader: exterior placements (text +
binary IPLs, interior-filtered), a spatial index, and a cached model parse/stat lookup; all pre-passes consume
it (one world lift per run).

**Prelit fingerprint + context (Phase 1, pre-pass `adapters/gta-sa/prelit-context.ts`).**

- Per model: day luma percentiles (p10/p50/mean/p90), spread, alpha-overload flag, night presence +
  percentiles, night/day ratio, and the same **per texture-group** (the material split is what separates a lit
  storefront group from its walls).
- Per placement: neighbourhood robust stats (median + MAD over models within R ≈ 80–120 u), day level and
  night ratio separately. A model's target = the median over **all its placements'** neighbourhoods (prelit is
  baked per model, not per instance — a model living in a dark alley and a bright street gets one verdict).
- Verdicts (hard mode): `lift-day` / `lower-day` (|p50 − hood| beyond tolerance), `flat` (spread ≈ 0 → level
  to hood + AO-rebake candidate), `repair-night` (existing set's median ratio off the hood ratio),
  `synthesize-night` (absent set → hood ratio target), `ok`.
- **Protection of legit lighting:** corrections move the **median** and preserve the bright tail (p90+ stays)
  — `laepetrol1a`/`gwforum1` are already statistically normal; per-group correction skips groups classified as
  emissive (bright at night in a dark model context — the `liquorstore` case lands in the review report, not
  in the auto-fix).

**Apply plugins (Phase 1).** `apply-prelit-level` (day curve per verdict) and `conform-night` (repair +
synthesize; replaces `synthesize-night`), both thin appliers of pre-pass verdicts — the same
pattern `weld-seam-prelit` already uses. `condition-prelit` and `synthesize-night` are **removed from the
pipeline** (their plans 012/013 are marked superseded); `recompute-normals` (plan 002, long superseded by
`smooth-normals`, wired nowhere) is **deleted**.

**Review (Phase 2).** The run report gains the verdict list; a generator renders CPU-preview thumbnails
(day + night, before + after — the lod-common rasterizer) into a self-contained HTML review page. Separately,
`apps/viewer` gets a **compare tab**: two game dirs (BEFORE = `original` or any path, e.g. a mod-installer
output; AFTER = the optimizer output), one model name, side-by-side interactive view.

**Seam feathering (Phase 3).** Extend the seam-weld pre-pass: after welding the seam line, blend each ground
sheet's prelit toward the welded seam values across a band (N ≈ 8–15 u) with distance falloff — the override
mechanism of `weld-seam-prelit` already carries arbitrary per-vertex targets, so only the pre-pass grows.

**Vertex-AO rebake (Phase 4).** For `flat` models: per-vertex hemisphere occlusion via the tool-kit BVH
(deterministic ray set), normalized to the neighbourhood level → the model gets real shading instead of a flat
fill. Night set derives from the new day set.

## Phases

- **Phase 0 — shared world loader.** Refactor gap-stitch/seam-weld onto it (behaviour-preserving; parity
  tests), expose to prelit-context.
- **Phase 1 — fingerprint + verdicts + appliers.** Remove old passes; regression fixtures = the six example
  models (two corrected, four untouched); measure: verdict counts per class, before/after luma tables.
- **Phase 2 — review report + compare viewer.**
- **Phase 3 — seam feathering band.** Measure on known harsh transitions.
- **Phase 4 — vertex-AO rebake for flat models.** Measure: how many `flat` models exist map-wide; thumbnails.

## Measurements

_(record after each phase — verdict counts, the six-model regression table, corrected-model totals, review
screenshots)_

### Phase 1 — world verdicts on `game-src/original` (2026-07-03)

Pre-pass (`buildPrelitContext`, defaults: radius 100, minHood 5, dayTolerance 0.4, ratioTolerance 0.12,
flatSpread 8) over every placed HD-tier model, whole map in **1.5 s**:

| stat            | count | share of fingerprinted |
| --------------- | ----- | ---------------------- |
| verdicts total  | 6164  | 84%                    |
| day lift        | 1506  | 21%                    |
| day lower       | 2570  | 35%                    |
| flat (AO queue) | 205   | 2.8%                   |
| night repair    | 5014  | 68%                    |
| night synth     | 93    | 1.3%                   |
| ok (untouched)  | 806   | 11%                    |
| no context      | 365   | 5%                     |

Six-model regression (verdicts vs the plan's motivation table):

| model                | verdict                                          | expected                                              |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `clubgate01_lax`     | level **+31** (guard 49→255), night repair ×0.52 | ✅ dark outlier lifted                                |
| `project2lae2`       | **flat** + level −61, night repair ×0.79         | ✅ flagged flat (AO rebake queue), overbright lowered |
| `laepetrol1a`        | night repair ×1.45 (guard 44→95)                 | ✅ day untouched; lit canopy lives above the guard    |
| `washgaspump`        | level −75 (guard 255→255), night synth 0.70      | ⚠️ self-lit day prelit ≈255 — guard protects only 255 |
| `gwforum1_lae`       | night repair ×0.48 (guard 19→39)                 | ✅ day untouched (stadium floodlights are day-legit)  |
| `liquorstore03_lae2` | level −68 (guard 158→186), night repair ×0.67    | ⚠️ per-material outlier — hard mode lowers the walls  |

Reading (hard mode, as decided — soften later):

- Both target models are corrected the intended way; the two "normal" models (`laepetrol1a`, `gwforum1_lae`)
  keep their day prelit untouched and only get night-ratio conformance, where the tail guard preserves the lit
  parts (petrol canopy p90 sits above `protectFrom` 44).
- 68% night-repair rate says `ratioTolerance 0.12` is tight against real map variance — first knob to revisit
  in the softening pass after the Phase 2 visual review.
- `washgaspump` / `liquorstore03_lae2` are exactly the review cases the semi-auto workflow is for: legit-lit
  models whose _day_ median is a true statistical outlier. The guard keeps their brightest verts, but hard mode
  still moves the body — Phase 2's before/after report decides whether these need a whitelist or a
  per-material split.

End-to-end smoke (full default pipeline, `--no-textures`, 8 GB heap): **11462 models processed, 0 failures**,
6164 touched by `apply-prelit-level`/`conform-night` (matches the verdict count exactly). Output-size growth
(232 → 347 MB) is the pre-existing smooth-normals vertex splits + gap-stitch skirts, plus the 93 synthesized
night sets — not a Phase 1 regression.

### Phase 2 — review report + compare viewer (2026-07-03)

Shipped: `review-cli.ts` (verdicts → self-contained HTML with day/night before→after CPU-raster thumbnails,
severity-ordered, "exclude" checkboxes → JSON for the new `PrelitContextOptions.exclude`), `compare-serve.ts`
(DFF/TXD bytes of one model from two game trees) + the viewer's **Compare** tab (`viewer.html?tab=compare`,
side-by-side synced orbit, night-colours view), and `exclude` threading through
`runOptimizer({ prelitOptions })` / `buildPrelitContext`.

- Report on `original`: 200 top-severity models rendered in **4.9 s**, 3.5 MB HTML, 0 render failures.
  Top of the severity list = `vegastwires*` / `railtunn*` (near-black overhead wires being lifted to the hood
  median) — exactly the models the exclude curation exists for.
- Compare server on `original` vs the smoke build: **15333 models** on both sides; spot-check
  `clubgate01_lax` day p50 27 → 58 (the verdict's +31).
- **Bug found & fixed by the Phase-2 verification itself:** night repairs never reached the output — the
  encode's attribute-overlay path only writes the geometry Struct, and `addNightColorsIfMissing` deliberately
  skipped existing night chunks, so a scaled set silently kept its source bytes (synthesis worked, repair was
  a no-op unless topology changed). Replaced with `syncNightColors` (update-existing-or-append). Re-verified
  in rebuilt bytes: `clubgate01_lax` night p50 44 → **23** (×0.52 exactly). Full rebuild: 11462 models,
  0 failures.

Next knobs for the softening pass (after visual review): `ratioTolerance` 0.12 (68 % repair rate is too eager)
and a curated exclude list seeded from the report's top section (wires, rail tunnels).

### Phase 3 — seam feather band on `game-src/original` (2026-07-03)

Shipped: `featherBand` in the seam-weld pre-pass (default **10 u**, `0` disables) — after welding the seam
line, every interior vertex within the band (and passing the same cos 45° normal guard, so walls stay off
their ground seam) gets **its own side's** correction delta (`welded − own seam value`) with linear falloff.
Emitted as absolute overrides through the unchanged `weld-seam-prelit` mechanism. The weld + feather now run
in **post-level space**: `run.ts` hands the day-level verdicts to `buildSeamOverrides`, which applies
`shiftPrelit` to a prelit copy before welding — the absolutes then agree with what `apply-prelit-level`
leaves behind instead of undoing it.

| metric                      | feather OFF | feather ON |
| --------------------------- | ----------- | ---------- |
| welded groups               | 92816       | 92816      |
| feathered interior vertices | 0           | **488551** |
| models touched              | 4402        | 4402       |
| pre-pass wall time          | 28.5 s      | 32.6 s     |

- Post-level space is also a better welder: skipped-for-spread groups drop **2155 → 1815** (and welds rise
  92476 → 92816 vs Phase 1) — level conformance pulls the two sides of a seam closer before the weld judges
  them, so seams that used to be "too different to average" become weldable.
- Widest feather footprint: `sw_apartments02` (+3063 band vertices over its seam line) — a large ground sheet,
  exactly the "tone step survives next to the weld line" case the band exists for.
- End-to-end smoke (full default pipeline, `--no-textures`): **11462 models, 0 failures**; the seams log line
  confirms 488551 feathered vertices flow through the pipeline.

### Phase 4 — vertex-AO rebake on `game-src/original` (2026-07-03)

Shipped: `plugins/bake-vertex-ao.ts` — for the **205 `flat`-flagged models** (day spread ≈ 0 = no baked
shading at all), per-vertex hemisphere occlusion against the model's own geometry (tool-kit BVH; 32
deterministic golden-spiral rays per vertex, max distance 25 u, strength 0.6), normalized so the **median
stays at the levelled hood value**. The same factor scales an existing night set; a synthesized one derives
from the shaded day via `conform-night` (ordered later). Pipeline order: `apply-prelit-level` →
**`bake-vertex-ao`** → `weld-seam-prelit` (seam line/band keeps the final word) → `conform-night`.

- Spot-check in shipped bytes (`project2lae2`, the plan's flat motivator): day p50 114 / spread **0** →
  p50 **53** (the hood target: 114 − 61) / spread **42** (p75 61, p95 70) — real corner/recess shading where
  there was a uniform fill; night p50 34 → 27 (the ×0.79 repair applied to the shaded set).
- End-to-end smoke: **11462 models, 0 failures**; AO raycasting on 205 models adds no visible wall-time to
  the run.

**Plan complete.** Remaining follow-up is curation, not code: run the review report, seed the exclude list
(wires / rail tunnels), and soften `ratioTolerance` if the in-game night check shows over-repair.

### Softening iteration — night repair is DARKEN-ONLY (2026-07-03, in-game finding)

First in-game check (Idlewood, 23:13) showed whole blocks of houses glowing blue-white at night. Diagnosis on
the real build (before→after night p50 over the 442 models placed in the area): **117 models had night lifted
by >10**, worst `snpedteew1vv_las` **0 → 255** — its night set exists but is intentionally black, and the
two-sided repair's `scale = hoodRatio·day / max(1, nightP50)` divides by 1 → **×42, clamped to 255**.

The class error: a night set _darker_ than the hood is design (houses with the lights off), not damage — only
_glowing above_ the hood is the bug class the user reported. Changes:

- `judgeNight` repairs only when `ratio − hoodRatio > ratioTolerance` → the scale is **< 1 by construction**
  (no explosion possible); too-dark night sets are never brightened.
- `ratioTolerance` default 0.12 → **0.25** (the planned softening; the 68 % repair rate is gone).
- New `maxSynthRatio` (default **0.35**): a synthesized night set never targets a streetlit hood's high ratio
  (`washgaspump` synth 0.70 → 0.35; vanilla night sets sit ~0.2–0.35).

Verdicts on `original`: night repairs **5014 → 1879**, ok 806 → 2065. The six-model table now matches the
user's truth exactly: `laepetrol1a` and `gwforum1_lae` get **no verdict at all**, `liquorstore03_lae2` keeps
only its day lower, `clubgate01_lax` keeps its darkening ×0.52, `project2lae2` keeps flat+lower. On the user's
`NO_COMMIT/mods`: night repairs 1350, and **all 15 Idlewood offenders are now night-UNTOUCHED**
(`carls_faux`, night-less, gets a capped 0.35 synth).

### Softening iteration 2 — day level is LIFT-ONLY for structured models (2026-07-03, in-game finding)

Second in-game check (Ganton, 09:27) showed sunlit streets dusk-dark at noon. Diagnosis (129 area models,
before→after day p50): the lowered class is **structured sunlit ground** — `lae2_roads*` at p50 104–131 with
spread 120–240 pulled down −40…−61 to the mixed hood median (walls in shade + fences drag it low), plus gang
tags `tag_01`/`tag_kilo` (flat white 255 sprites) crushed **255 → 67**. The day mirror of the night lesson:

- **Structured models are never lowered** — brighter-than-hood with real spread is baked sunlight. Lift-only
  (the `clubgate01_lax` case keeps working); the confirmed too-bright class (`project2lae2`) is flat and still
  levels both ways.
- **Saturated-white flats (p50 ≥ 250) never get the `flat` flag** — gang tags / emissive decals are fullbright
  by design; they also stay out of the AO queue.

Re-verified on `NO_COMMIT/mods`: area "lowered >20" count **14 → 0** (worst residual −15 = legit seam
weld/feather at shared borders), tags untouched.

### Softening iteration 3 — `tobj` models fully excluded (2026-07-03, in-game finding)

Skyscraper night windows went dim: they are **`tobj` (hour-gated) overlay models** whose prelit IS the
lighting design — bright by purpose, so the darken-only night repair saw "glows above the hood" and dimmed
them. `timedModels()` (IDE `tobj` sections, 179 models on the user's game) is now excluded from **all**
world-context passes: no prelit verdicts, no hood-stats contribution, and no seam-weld/gap-stitch either (the
overlays sit coplanar with their base building — welding/stitching them to the wall behind is never right).
Verified: 0 tobj models receive a verdict; verdicts on the user's game after all three softenings:
lift 1817, lower **0**, flat 170, night repair 856, synth 100, ok 4198.

### Iteration 4 — normals are never ADDED for real SA + night repair needs day evidence (2026-07-03)

The ground shard/fan artifacts SURVIVED the TRISTRIP fix (they were two bugs with one look). Census on the
user's game: **777 of 800 sampled world geometries are prelit + `rpGEOMETRYLIGHT` + WITHOUT normals** — SA
skips dynamic lighting for them and renders pure prelit. `smooth-normals` (plan 015) ADDED normals to all of
them → real SA switched ~97 % of the world into its per-vertex dynamic lighting path → giant
triangle-interpolated shading fans on the ground, day and night, map-wide. Fix: the plugin only REBUILDS
existing normals by default; creating normals where absent is the new `addNormals` pass (CLI `--add-normals`),
off by default and enabled by perfect-map-builder for OpenSA (its SSAO wants them — plan 015's original
purpose). Verified in output: 777 → 777 no-normals (nothing gained normals). Side effect: the build is
**+3.6 %** instead of +49 % (the vertex-split explosion was the normals pass), 6938 of 11492 models changed.

Second finding the same round: San Fierro street lamps / Chinatown lanterns went dark — glow-props have a
healthy day and a night set far above the hood ratio (that IS the lamp). **Night repair now requires
corroborating day evidence** (a day level verdict or the flat flag): a broken export is broken in both sets
(`project2lae2` flat ✓, `clubgate01_lax` lifted ✓), while a healthy-day model glowing at night is lighting
design. Verified: `lamppost1/3` byte-identical prelit through the full pipeline.

### Codec fix — TRISTRIP flag cleared on geometry rebuild (2026-07-03, in-game finding)

Night screenshot showed giant dark triangle shards fanning across the road (Sprunk shop). Not displaced
vertices (max triangle-edge growth in the area: **+0.1 u**) — a strict-SA format gotcha (see the
`sa-generated-asset-format` checklist): `rebuildGeometry` regenerates a **trilist** BinMeshPLG but inherited
the source geometry's flags, so stock strip-flagged models kept `rpGEOMETRYTRISTRIP` (0x01) — real SA trusts
the flag and reads our list indices as a strip → shard fans (our own engine/viewer tolerate the mismatch,
which is why gostown never showed it). **265 of 370** area models were affected. Fix: `flags &= ~0x01` in the
rebuild path. Re-scan after fix: **0** rebuilt strip-flagged geometries; full rebuild 11492 models,
0 failures.

### Iteration 5 — prelight ONLY-mode (2026-07-03, user decision)

After the in-game rounds the user judged the map-wide statistical corrections not visibly beneficial (and, by
design of the protective guards, unable to reach the remaining visible bugs — e.g. a Chinatown facade glowing
at night looks exactly like the protected street-lamp class). New `PrelitContextOptions.only` /
`--prelit-only <file.json>`: verdicts are computed **only** for the listed, human-confirmed models — their
statistical skip-guards (day tolerance/lift-only, night day-evidence, ratio tolerance, fullbright-flat) are
bypassed because the human is the evidence, while the within-model protections (tail guard, darken-only
night, synth cap) still hold. Every other model passes through byte-identical. Without the option the pass
runs statistically as before; the workflow is: spot a bad model in-game → identify it → add to the list.

### Iteration 6 — explicit manual corrections + `nightMax` (2026-07-03, the newvic1_sfw case)

Only-mode's forced auto-verdicts still failed the user's actual target, the SF Chinatown victorian
`newvic1_sfw`: its night set is **dark at the median (p50 19)** with the window glow living in the **p95
tail** (114, windows ≈ 255) — the median-ratio test judges it "dark at night, fine", and even a forced repair
is exactly what the tail guard protects. Two rounds in-game proved the mechanics:

- **Object entries in the only-list** — `{"model": "name", "nightScale": …, "dayShift": …}` — explicit manual
  corrections applied verbatim and UNGUARDED (protect bounds 256 keep the appliers' tail guard inert); a bare
  string stays the forced auto-verdict. `nightScale` on a night-less model synthesizes `day × scale`.
- `nightScale 0.4` dimmed the windows but **blackened the dark walls first** (19 → 8) — a uniform scale is the
  wrong tool for a tail-only glow.
- **`nightMax` (capNightSet, new `cap` night-verdict kind)**: every night vertex above the ceiling is scaled
  down to it (hue preserved), everything at/below is untouched — dims ONLY the glow. `nightMax` wins over
  `nightScale`. Verified in-game: walls back to stock, glow down; residual brightness at the right ceiling is
  the light texture itself (not prelit).
- Real-asset regression fixture: `fixtures/original/world/newvic1_sfw.dff` (`npm run test:fixtures`) +
  `prelit-context.integration.test.ts` pinning the "median hides the glow" profile and the cap behaviour.

Current user workflow: `--prelit-only broken-models.json` with `{"model": "newvic1_sfw", "nightMax": 20}`
-style entries, dialling the ceiling in-game.

### Iteration 7 — FORCE list restores the statistical pass (2026-07-03, user decision)

Only-mode (iteration 5) proved too all-or-nothing in practice: the user asked to return to the originally
offered hybrid — the **statistical pass corrects the whole map by default**, and the curated JSON
_additionally_ forces its models past the skip-guards. New `PrelitContextOptions.force` (same `OnlyEntry`
format: bare names = forced auto-verdicts, objects = explicit unguarded corrections incl. `nightMax`);
`--prelit-force` in the CLI; perfect-map-builder's `broken-prelight.json` now feeds `force` instead of `only`.
`--prelit-only` remains for full manual control; `only` wins when both are given.
