# 009 — `procobj.dat`'s two columns, read the way the game reads them

**SHIPPED 2026-08-09.** Landed from what was then roadmap `07/02`, now
[010 — density model](010-density-model.md), whose first task this was. It is a **bug fix**, not a density
feature: both numeric columns of `procobj.dat` were being spent the way the file's own header comment
describes them, and the game spends neither that way. The per-category / per-surface density MODEL that 010
is otherwise about is unbuilt — this is the baseline it now sits on.

Depends on [008 — limit route review](008-limit-route-review-closed.md) for which ceilings the resulting
density is allowed to cross.

## What was wrong

Recovered from gta-reversed (`ProcObjectMan_c`, `ProcSurfaceInfo_c`); the mechanism page is
[`docs/gta-sa-original/procedural-objects.md`](../../../../docs/gta-sa-original/procedural-objects.md), and
the one-line rule for future designs is in
[`docs/restrictions/assets-and-data.md`](../../../../docs/restrictions/assets-and-data.md).

- **SPACING is a LENGTH in metres.** `m_fSquaredSpacingRadius = 1/(spacing*spacing)` and
  `density = triangleArea × that`, i.e. **`area / spacing²`**. We read `area / spacing`, generating **4–163×
  too many candidates** per rule. The file's header comment ("1 object every n square metres") is what misled
  us, and the code squares the number before using it.
- **MINDIST is a distance to the CAMERA**, clamped `max(minDist, 80)`, tested against the triangle centroid
  before anything is created — an anti-pop-in radius. It is never a distance between two objects, and nothing
  in the original measures the distance between two placements at all. Our `cullByMinDistance` spent it as a
  per-species exclusion radius and **deleted 99.0 %** of the placements.
- **The two errors ran in opposite directions**, which is why the totals looked sane for a fortnight: far too
  many candidates, then almost all of them culled. What did NOT look sane was the LOOK, and that is the only
  place the defect was visible — evenly spaced, one-of-each-species, where the game clumps per triangle.

## What changed

| Where | Change |
| --- | --- |
| `packages/renderware/src/map/procobj-scatter.ts` | `expected = area / (spacing × spacing) × PROC_OBJ_MAX_DENSITY`. **Shared with the RUNTIME cell scatter**, so `procObjLimit = 150` now rations a ~19× smaller candidate pool and binds far less often |
| `tools/map-placement/src/procobj/convert.ts` | `cullByMinDistance` deleted, with `minDistByModel` and `tooClose`. Its three unit tests went with it — they pinned what it did, not that it should exist |
| `tools/sa-procobj-placement/src/config.ts` | `procObjMax` 20 000 → **100 000**. At the corrected reading the old cap dropped 78 % of the layer, so any measurement taken against it would have been a measurement of the cap |
| `packages/renderware/src/parsers/text/procobj.parser.ts` | `minDistance` documented as consumed by NOTHING — it is parsed to keep the row round-trippable and for census tooling |
| `scripts/debug/procobj-spacing-census.ts`, `procobj-species-floor.ts` | re-pointed at the corrected pipeline; the census's self-check now asserts `area/spacing²`, and its nearest-neighbour block became the REGRESSION check |

## What the tests pin, and the one seam they do not

In `packages/renderware/src/map/procobj-scatter.test.ts`, and **each was run against the reverted change**
(three of them fail without it — a constant alone would not have been evidence):

- **SPACING is a LENGTH**: doubling it QUARTERS the count. A count assertion alone can be right for the wrong
  reason; the RATIO cannot.
- **A sparse species is absent from most faces** — `dead_tree_2`'s real spacing (163) expects 0.23 per
  2000 m² face, so the fractional lottery must give at most one and mostly none. Asserted in both directions,
  because a zero is only evidence if the instrument could have printed non-zero.
- **Nothing spaces placements by MINDIST** — same-species neighbours are free to stand metres apart.

**The uncovered seam, named rather than faked:** `convertProcObj`'s placement selection — "every candidate
under the cutoff is emitted, nothing thins by distance" — has no test, because the function reads a whole
game dir off disk and the only way to cover it here would be to re-implement it in the test file. The
regression check that exists instead is `scripts/debug/procobj-spacing-census.ts`, whose nearest-neighbour
block reports the signature the old cull left (`min 50.0 m`, 0 pairs below their MINDIST). It is a script, not
a test: it has to be run.

## Measurements

### The scatter, priced on `game-src/original` (43 converted species)

`npx tsx scripts/debug/procobj-spacing-census.ts --game original --models build/original/opensa/data/maps/lod_procobj.models`

| Stage, vanilla density | before | after |
| --- | --- | --- |
| candidates | 5 843 322 | **272 559** |
| `lottery < 1` → what the build emits | 1 948 374 → 20 265 after MINDIST | **91 067** |
| self-check vs the game's own formula | drift 0.00 % (against `area/spacing`) | drift **0.06 %** (against `area/spacing²`) |

The reverse predicted 90 906; the pipeline emits 91 067 (+0.18 %, the per-triangle fractional lottery). That
identity is what says the code runs the recovered formula rather than a model of it.

**Nearest neighbour, XY metres — the signature, inverted back:**

| | same species | any species |
| --- | --- | --- |
| shipped before (MINDIST as spacing) | min 50.0 · p05 50.4 · med 58.2 | min 0.3 · p05 3.9 · med 10.9 |
| **after** | **min 0.0 · p05 3.4 · med 8.9** | min 0.0 · p05 2.1 · med 5.5 |

**90 180 of 91 012** same-species pairs now stand closer than their MINDIST, against **0 of 20 246** before.
A `min` back at 50–80 m with zero pairs below is the old cull returning.

### The built layer, both sides measured off real trees

BEFORE is the user's 2026-08-07 build (kept at `NO_COMMIT/old_map`, dated by its own `plobj0.ipl`), AFTER is
`build/original/opensa` rebuilt 2026-08-09. `procobj-layer-census.ts <dir>`; both trees pass both identities.

| | before | after |
| --- | --- | --- |
| placed objects (HD) | 15 286 | **91 092** (×5.96) |
| permanent text LOD rows | 6 487 | **25 560** (×3.94) |
| binary stream records | 24 552 | 157 091 (91 092 HD + 65 532 unlinked LOD + 467 tree impostor) |
| objects per permanent row | 2.36 | **3.56** |
| stream files in gta3.img | 51 | 332 |
| text-IPL area files (`plobj*`) | 8 | 46 |
| species converted | 43 | 43 |

**The row cost is the number that did not scale, and it is the one a budget gets wrong by assuming.** 5.96×
the objects bought only 3.94× the rows: the species the corrected reading adds are the low-`spacing` ones,
which are short and ride the binary stream unlinked, so the linked share FELL from 42 % to 28 % and the layer
got CHEAPER per object. **Scale a row cost off a built layer, never off an object count times an old ratio.**

### On-disk size — measured, and NOT attributable to this change

| | before | after | Δ |
| --- | --- | --- | --- |
| `pak/world.ospak` | 1 271 484 416 B | 1 551 101 952 B | +266.7 MiB (+22.0 %) |
| `models/gta3.img` | 993 MiB | 1 014 MiB | +21 MiB (+2.1 %) |
| the whole build tree | 3 283 MiB | 3 583 MiB | +300 MiB (+9.1 %) |

The split is the informative part: the SA-format side, where the 91 092 HD placements live as binary IPL
records, grew 21 MiB — a placement record is tiny. The 266 MiB is in the baked pak, i.e. GEOMETRY, because
`opensa/` welds and bakes the clutter into its cells and an added object costs a mesh rather than a row.

**The delta is an upper bound, not an attribution.** The two paks differ in more than procobj: their own
`report.json` says particles 943 → 1 831 and roadsigns 481 → 962 (`a48ffa2f`, `493fe926` landed between the
builds). Isolating this change's share needs a rebuild that moves only the reading (~45 min); not run.

### Frame cost — one scene moved, and it is the rural one

User display lane, his run, nine scenes, 1219 road cars / 212 parked on both arms, all nine `legStart.ok`.
Rows: [`2026-08-09-ingame-user-display-procobj-recovered.json`](../../../../docs/benchmarks/opensa-engine/2026-08-09-ingame-user-display-procobj-recovered.json)
against the same-day [oldmap baseline](../../../../docs/benchmarks/opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json);
the analysis is in [`benchmarks/index.md`](../../../../docs/benchmarks/index.md).

| scene | avgMs | Δ | gpu.pass Δ | triangles Δ |
| --- | --- | --- | --- | --- |
| **country-dusk** | 16.366 → **18.434** | **+12.6 %** (61.1 → 54.2 fps) | +16.3 % | +16.4 % |
| strip-noon | 10.166 → 10.464 | +2.9 % | +2.3 % | +2.4 % |
| the other seven | — | +1.2 % … −3.0 % | ≤ +1.8 % | ≤ +1.7 % |

Eight of nine sit inside ±3 %. The one real move is `country-dusk`, the only RURAL scene in the set, which is
where a ground-clutter layer lives. **The cost is GPU geometry and the columns say so without inference:**
its frame grew +2.07 ms while its `gpu.pass` grew +2.03 ms, with draw calls +1.7 % — raster of the added
triangles, not CPU and not batching. Across all nine the ms delta tracks the triangle delta, which is the
relationship a density budget should be built on.

### Field verdict

**ACCEPTED by the user, 2026-08-09** — he ran the rebuilt map himself and reported the look good. That is
what closes the step: the census can prove the placements are no longer inverted, but only the field can say
the authored look came back.

## What this hands forward

- **07/04 inherits an int16 crossing.** 25 560 permanent rows + stock's 12 629 ≈ **38 189 map-wide**, against
  int16's 32 767. `checkTextIplBudgets` is `sa/`-only, so `--exclude sa` builds and every opensa field run are
  unaffected — but the next FULL build including `sa/` now throws, correctly, naming the number. That is
  07/02 decision 3's profile gate arriving by accident rather than by design.
- **`procObjMax = 100 000` is clearance, not a budget.** The real number is 07/04's `opensa` perf budget, and
  `country-dusk` is now the scene that measures it.
- **07/01's species floor is unblocked and its premise needs re-measuring** — raised density is exactly what
  makes the runtime cell cap bite, and that was the reason 01 was ordered behind 02.
- **The corner-biased sampler is now cheap to A/B.** The original pulls placements toward a triangle's first
  vertex (`offset1 = rand()`, `offset2 = offset1 × rand()`); ours is area-uniform. It is a difference in the
  LOOK, worth testing only now that the density is right.
