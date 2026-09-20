# 011 — Biome/zone-aware density (desert, forest, mountain)

> **CLOSED 2026-08-11.** Re-scoped the same day and most of it closed as redundant; the last task — a field
> check of the slope gate — is STRUCK rather than done, because `procObjSlope` ships undefined and there is
> no shipped behaviour to judge. It returns the day a value is set. Moved here 2026-08-09 from the roadmap
> chain `07-lod-generators-extended/03`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.

## MEASURED FIRST 2026-08-11 — the biome axis is a second name for the surface

**This plan's premise is that the scatter has "no notion of WHERE". It has one: the surface IS the biome.**
`scripts/debug/procobj-biome-vs-surface.ts` buckets every rule-bearing collision face by area, region
(`map.zon` level) and district (`info.zon` label), over the whole map:

| Surface | m² | Where its area is | What its rules scatter |
| --- | --- | --- | --- |
| `p_sand_arid` | 1 359 414 | BONE 49.5 % · VE 26.8 % · ROBAD 15.0 % — **91 % desert** | `sand_josh1/2` (Joshua trees), combush |
| `p_woodland` | 293 268 | 100 % countryside — RED 34.5 % · WHET 21.1 % | 8 × `DEAD_TREE_*`, tallgrass, bushes |
| `p_foreststumps` | 876 232 | 100 % countryside — CREEK 38.6 % · BACKO 29.5 % | cedar ×3, fir, ash, pine, elm |
| `p_mountain` | 235 683 | 99.7 % countryside — RED 41.4 % · WHET 34.5 % | **6 × `p_rubble*`** — the rocks |
| `p_bushydry` | 213 801 | BACKO 43.5 % · FLINTC 42.3 % | dry bushes + cedars |

**12 of the 14 rule-bearing surfaces sit ≥ 90 % inside one region type, and the species on them are already
that region's species.** Decision 2's own example table — "desert → cacti ×3, forest → bushes ×2.5, mountain
→ rocks ×3" — asks for the arrangement `procobj.dat` already ships: the desert surface already carries the
Joshua trees, the mountain surface already carries the rubble. A biome multiplier would be scaling a set that
is already the right set, and [010](010-density-model.md)'s `bySurface` axis says everything biome could say,
at **higher** resolution (it separates `p_sand_arid` from `p_sand_dense`; "desert" cannot).

**The city half is moot too.** Los Santos holds **64 409 m²** of rule-bearing ground against countryside's
**6 504 722** — **1 %**. This plan's verification line "cities stay close to vanilla" is true by construction;
there is nothing there to scale.

### What survives, and it is one thing

- **Decision 3, the slope gate — KEEP.** `p_mountain` is **48.8 % steep** (|normal.z| < 0.85) against 0–20 %
  for every other surface, and it is the surface that carries all six `p_rubble*` rock species. So "scree on
  the slopes, less on flat ground" is real information that **no existing axis expresses** — surface cannot,
  because it is one surface either way. It is also nearly free: `scatterFace` already has the face normal.
- **One live biome case, recorded rather than built: `p_grassmid1`.** 1 856 986 m² (24.9 % of countryside's
  rule-bearing area) spread FLINTC 22.5 % · SF 17.1 % · RED 14.7 % — the one big surface that is genuinely
  diffuse, carrying the same `rockbrkq` / combush / `genVEG_bush19` from Flint County to San Fierro. If a
  region axis is ever wanted, this is the surface that would justify it, and it is the ONLY one.
- Everything else in this plan — decisions 1, 2, 4, the zone→biome map, the per-biome profile table, the
  city/plain qualifications — is **closed as redundant**, not deferred. Re-opening one needs a measurement
  that contradicts the table above.

**Read this together with [010](010-density-model.md) task 8**, decided the same day: the shipped density
profile is `base: 1` because the authored data already reproduces the reference's hand-authored skew. Both
findings are the same shape — *the plans assumed `procobj.dat` was a raw material to be corrected, and it is
a finished design being re-derived.*


Depends on [02](010-density-model.md) (the density model). Delivers the user's actual ask: density that KNOWS the terrain — more cacti in the desert, more bushes in forest, more rocks on mountain slopes.

**Density is NOT a per-target axis** (the user's call 2026-08-09, which reversed the 08-08 split this plan was written under): `sa` ships the same profile as `opensa`, so biome is a third axis on top of category×surface and nothing more. There is one profile, one biome table, and no per-target gate to inherit — the ceilings that motivated the split are lifted on the install we ship to (`docs/restrictions/sa-target.md`), and the one that is real (FLA's pools) is a number raised in the ini, measured 2026-08-10. Same rule as [02](010-density-model.md): the profile is a config value, never a flag an operator remembers.

## Context

02 gives per-category/per-surface density but no notion of WHERE. Two terrain signals exist at build time but aren't joined to scatter:

- **Surface type** (`surfinfo.dat` → `surfaceNames[face.material]`, e.g. `p_grass_dry`, `p_sand`, rocky surfaces) — already what scatter keys rules on. A partial biome proxy (desert sand vs grass), but a grass surface exists in both LA parks and countryside.
- **Zones** (`info.zon`/`map.zon` → `parseZones` → `MapZone{ name, label, x/y extent, level }`, incl. Bone County = desert) — the real biome map, but **not cross-referenced** by the scatter (no point-in-zone test today).
- **Slope**: no heightmap, but per-face normal `.z` is computed in scatter (`procobj-scatter.ts`) — an ad-hoc slope proxy usable for "rocks on steep faces".

## Decisions

1. **Join zones into scatter.** Add a point-in-zone lookup at build time so each placement knows its zone/biome — from **`parseZones` in `@opensa/renderware`** (`parsers/text/zon.parser`, already a dependency), with the AABB test owned by the tool. Copy the engine's `cityAt` SHAPE if it helps, but do not import `packages/game`: this is build-time code and the engine layer is not its dependency ([restrictions/architecture](../../../../docs/restrictions/architecture.md)). Classify zones into biomes: **desert** (Bone County), **forest/countryside** (Red County, Flint County vegetation), **city** (LA/SF/LV), **mountain** (Chiliad / high-slope areas). Biome becomes a third density axis on top of 02's category×surface.
2. **Biome × category density profiles.** A small config: e.g. desert → cacti ×3, bushes(dry shrubs) ×2, grass ×0.5; forest → bushes ×2.5, trees(procobj) ×1.5, flowers ×2; mountain → rocks ×3 (slope-gated), everything else ×0.5. Defaults are conservative and tuned in-game; the table is the deliverable.
3. **Slope-gated rocks.** Use the face normal `.z` as a slope proxy: rock categories get a density boost on steep faces (low `normal.z`) and thinning on flat ground — so mountains get scree, plains don't. Cheap, no heightmap needed.
4. **Surface stays the fine filter.** Biome sets the broad multiplier; surface still gates WHICH rules apply (cacti rules are already on sand surfaces). Biome density never places a species on a surface its `procobj.dat` rule forbids — it only scales within allowed surfaces. This keeps authored SA plausibility (no cacti on grass).
5. **Determinism + no runtime cost.** All build-time; the zone lookup is a static AABB test per candidate (cheap). Runtime scatter/preview unchanged.

## Tasks

- [~] ~~Build-time zone lookup: `info.zon` → AABB set → `biomeAt(x, y)`~~ **CLOSED as redundant 2026-08-11** —
      the measurement above. The lookup itself works and is in
      `scripts/debug/procobj-biome-vs-surface.ts`; what it proved is that nothing needs it.
- [~] ~~Extend `densityFor` to `densityFor(category, surface, biome)`~~ **CLOSED** — `bySurface` already
      carries more information than a biome key would.
- [x] **Slope proxy — BUILT 2026-08-11, neutral by default.** `ProcObjSlopeConfig` in
      `packages/renderware/src/map/procobj-scatter.ts`: per category, a multiplier on how many candidates a
      STEEP or a FLAT face generates, `PROC_OBJ_STEEP_THRESHOLD = 0.85` (~32°, the value the map's own faces
      separate at). **It lives in the scatter, and that is forced rather than chosen**: slope is a per-FACE
      signal, and both selection paths resolve a cutoff per BATCH — a batch pools one model×surface with
      every normal it happens to have, so a cutoff cannot express slope and generation can. Which is also why
      **both targets get it from one place**: `sa` through `convertProcObj`, `opensa` through the adapter,
      both landing in `scatterProcObjects`. Knobs: `--slope <steep>,<flat>` and `?procobjSlope=<steep>,<flat>`.
      `validateSlopeConfig` refuses NaN, the trap that would otherwise empty the layer silently.
- [x] **Unit tests — DONE**, 11 cases in `procobj-scatter.test.ts`: no config is byte-identical; an unnamed
      category is untouched; a steep multiplier does not touch flat faces; a factor of 0 means "none here";
      the threshold moves what counts as steep; and the whole thing stays deterministic.
- [~] ~~Field check~~ — **STRUCK 2026-08-11: there is nothing shipped to verify.** `procObjSlope` ships
      **undefined** (= unchanged) in `ProcObjLodConfig`, so the slope gate is a knob awaiting a look
      judgement, not behaviour in any build — no field run can accept or reject it while nothing turns it on.
      **The check comes back the day a value is set**, and it comes back with the requirements the attempt
      below discovered, which is why that record is kept in full rather than deleted.

      *The attempt, 2026-08-11 — it failed, and the failure is worth more than the shot would have been.* The
      instrument cannot hold a viewpoint on a slope: **the spawned player SLIDES**. At the densest steep-rock cluster
      (cell `9,-2`, 73 rocks within 25 m of `2264.7, -418.7, 86.4`) he was placed at z 89 and every run ended
      at ~`2271, -396, 55` — 34 m downhill, and a different spot each time. Three different comparisons then
      returned **86.81 / 86.82 / 86.83 %** changed pixels with identical mean Δ, which is the tell: the diff
      was measuring the CAMERA, not the clutter. Two earlier spawns 35 m off the cluster fell through the
      world entirely (`grounded 0`, z −8222 and −9164) — 35 m from a cliff-face cluster is mid-air.
      **What a shot here needs:** flat ground with a slope in view, or the photo camera (a K+M chord the
      harness cannot send). **And note the pixel diff is weak here anyway by construction** — the gate changes
      the candidate COUNT, which re-rolls the seeded sequence, so every instance in the frame moves whatever
      the slope did.
- [~] ~~Per-biome placed/dropped counts~~ **CLOSED with the biome axis.** The per-CATEGORY breakdown already
      ships and is the readable one.

## Verification

- ~~Desert visibly denser in cacti/shrubs, countryside in bushes~~ — struck: the desert surface already
  carries only desert species, so this verification would pass before any code was written.
- Mountain slopes carry more scree than the flat ground beside them, and the flat ground carries less.
- No species appears on a surface its rule forbids (a slope gate scales, it never overrides surface gating).
- Deterministic; the normal is already computed, so build time is unchanged.

## Measurements / notes

**2026-08-11 — the recon that re-scoped the plan.** `scripts/debug/procobj-biome-vs-surface.ts`, whole-map
colliders over `game-src/original`, area-weighted:

- Rule-bearing collision area by region: **countryside 6 504 722 m² · Las Venturas 928 472 · San Fierro
  608 066 · Los Santos 64 409**. The clutter layer is a countryside feature by an order of magnitude.
- What each region is made of: Las Venturas is **52.3 % `p_sand_arid`**, San Fierro **76.6 %
  `p_underwaterbarren`**, Los Santos `p_grass_short` 33.3 % / `p_grassmid1` 27.3 %.
- Steep share (|normal.z| < 0.85) per surface: **`p_mountain` 48.8 %**, `p_underwaterbarren` 19.6 %,
  `p_foreststumps` 14.7 %, `p_grassmid1` 13.5 %, everything else under 13 % and the flat ones at 0.0 %.
**The slope gate, priced 2026-08-11** on `game-src/original` at density 1, via `--slope <steep>,<flat>` on the
rock categories (the layer-cost line's per-category row is the instrument):

| `--slope` | rock objects | rock candidates | layer total |
| --- | --- | --- | --- |
| off (shipped) | 9 417 | 28 190 | 91 379 |
| `2,0.5` | **10 749** (+14.1 %) | 31 842 | 92 341 (+1.05 %) |
| `3,0.35` | **13 787** (+46.4 %) | 41 042 | 95 386 (+4.4 %) |

**Steep ×2 with flat ×0.5 is not a wash, and that is the finding**: it nets +14 % rocks, so the rock
categories' candidate area is already **weighted toward steep ground** — which is `p_mountain` (48.8 % steep)
carrying all six `p_rubble*` species. A setting that reads as "the same rocks, moved onto the slopes" would
be nearer `1.5,0.35`. The area IPL slot count (10 of 40) does not move at any of these.

- slope threshold + rock boost factors: **threshold 0.85 shipped as the constant; the multipliers are
  UNSET** — neutral by default, waiting on a look he has not been able to judge yet (see the field-check task).
