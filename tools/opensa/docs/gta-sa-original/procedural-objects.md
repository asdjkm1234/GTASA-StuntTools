# Procedural objects — what `procobj.dat` actually means

**Recovered 2026-08-09** from [gta-reversed-modern](../links.md) (`source/game_sa/Plant/ProcObjectMan.cpp`,
`ProcSurfaceInfo.cpp`, `source/game_sa/PlantMgr.cpp`), because two of the file's columns were being read wrong
by our own pipeline and the misreading is silent — it produces a plausible-looking world that carries a
sixth of the authored clutter. This page carries what the DATA means; the design consequences are
[plan 07/02 decision 5](../../tools/sa-procobj-placement/docs/plans/010-density-model.md),
and the one-line rule is in [`restrictions/assets-and-data.md`](../restrictions/assets-and-data.md).

**The class is `ProcObjectMan_c` / `ProcSurfaceInfo_c`, not `CPlantMgr`.** `CPlantMgr` (`PlantMgr.cpp`) is the
GRASS system — it owns the loc-triangle cache that procobj rides on, but it never reads `procobj.dat`.
Anything looking for the scatter's formulas in `CPlantMgr` finds the wrong file.

## The two columns that were read wrong

### SPACING is a LENGTH in metres — the density is `area / spacing²`

`ProcSurfaceInfo_c::Init` (0x5A2EB0) stores `m_fSquaredSpacingRadius = 1.0f / (spacing * spacing)`, and
`AddObjects` (0x5A3850) spends it as

```cpp
auto density = normal.Magnitude() * 0.5f * m_fSquaredSpacingRadius;  // = triangleArea / spacing²
for (density; density > 0.f; density -= 1.f) { … }                   // floor + a fractional lottery
```

So one object per **`spacing × spacing` square metres**, not per `spacing` square metres. The grid path
(`useGrid`, unused by vanilla data) settles it independently: it steps `xCur += m_fSpacing` in world units,
so the column is a distance.

**`procobj.dat`'s own header comment is wrong about this** — it says *"the objects will be placed on average
of 1 object every n square metres"*, and the code squares the number before using it. The data reads as
authored only under the squared form: `P_WOODLAND DEAD_TREE_2` has spacing 163, i.e. one dead tree per
26 569 m² (a 163 m square); read as an area it would be one per 163 m², a dead forest 13 m on centre.
`P_WASTEGROUND p_rubble` has spacing 4 — one piece of rubble per 16 m², litter — and 4 m² would be a carpet.

### MINDIST is a distance to the CAMERA, and it is clamped to 80

Same two functions:

```cpp
minDist               = std::max(minDist, 80.0f);   // Init — the authored value can only go UP
m_fSquaredMinDistance = minDist * minDist;

// AddObjects, before anything is created:
if (DistanceBetweenPointsSquared(triangleCentroid, TheCamera.GetPosition()) < m_fSquaredMinDistance)
    return 0;
```

It is an **anti-pop-in radius around the player**: a triangle nearer than MINDIST creates nothing, so clutter
is never seen appearing in front of the camera. It is never a distance between two objects, and nothing in
the system measures the distance between two placements at all.

Two consequences for anyone reading the column:

- **The authored variation is dead.** Stock has 60 rows at 50, 19 at 60, 3 at 70, 13 at 80; the `max(…, 80)`
  collapses all four to 80. A mod that tunes MINDIST below 80 changes nothing in the stock engine.
- **The clamp is above the window the triangles live in.** Loc-triangles exist only within
  `PLANTS_MAX_DISTANCE = 100` m of the camera (`PlantMgr.h`), so creation happens in the 80–100 m ring and
  the objects then persist while their triangle stays inside 100 m.

## What prevents clumping instead: nothing

There is no exclusion rule anywhere in the path. The look is produced by three things, and they are why the
authored clutter reads as **groups in some places and singles in others**:

1. **The triangle is the group.** Objects are rolled per collision triangle, so a triangle of area A gets
   `A / spacing²` of them. A dense species (`p_rubble`, spacing 4) puts dozens on one ground triangle; a
   sparse one (`searock01`, spacing 81; `DEAD_TREE_*`, 163) fires its fractional lottery on maybe one
   triangle in fifty, which is what makes desert rock scatter read as chaotic singles.
2. **The sampler is corner-biased.** `offset1 = rand()`, `offset2 = offset1 * rand()`, and
   `pos = V1 + (V2-V1)·offset1 + (V3-V2)·offset2` — barycentric weights with a mean of 0.5 on V1 against 1/3
   for an area-uniform sample. Placements pull toward the triangle's first vertex rather than spreading over
   it. (Ours is area-uniform, `sqrt`-warped — a deliberate difference, not a bug, but it is a difference in
   the LOOK: see the plan.)
3. **Every rule on a surface fires on the same triangle.** `ProcessTriangleAdded` walks all
   `ProcSurfaceInfo_c` entries with that surface id, so `P_MOUNTAIN`'s six rubble species and three bushes
   are rolled against one triangle — a rock with bushes around it is the system working, not a coincidence.

`srand` is seeded per triangle (`(V1+V2+V3).ComponentwiseSum() + modelIndex`) and restored afterwards, so a
triangle's scatter is stable across visits.

### A rule is keyed by SURFACE + MODEL, and a third of the models use several surfaces

Measured on stock `procobj.dat` 2026-08-09: **95 rules over 56 distinct models, and 19 of those models carry
rules on more than one surface.** The widest are `sand_combush02` (7 surfaces), `sand_combush03` and
`sand_combush1` (5 and 4), the four `p_rubble*col` variants and `p_rubble`/`p_rubble2` (3 each, always
including `p_underwaterbarren`), the `veg_p*` trio on `p_grass_short`/`p_grass_dry`/`p_flowerbed`, and the
three `cedar*_po` on `p_bushydry`/`p_foreststumps`.

**So a model name is not an identity in this file** — the same species is authored with different spacing and
different scale ranges depending on what it grows on, and anything derived per species has to be derived per
`(surface, model)` pair. Ours does now; it did not until 2026-08-09, and the six `p_rubble*` were the ones it
got wrong (our `procObjCategory` reads the surface to separate underwater rubble from mountain rubble, and a
batch keyed by model alone took whichever surface the collision walk reached first). Recorded because nothing
in the file's own shape warns you: the rows just repeat the model name.

### Which species group and which stand alone — measured

The field report that started this (the user, 2026-08-08/09: *clutter mostly stands in groups, but not
always — forest bushes can be a clump or apart, desert rocks are mostly scattered*) is a direct consequence
of `area / spacing²`, and the split is **per SPECIES, not per biome**. Below: the share of a rule's expected
objects that land on a collision face expecting ≥2 of the SAME species (a clump of one kind), and on a face
expecting ≥2 of ANY species (a mixed clump). Stock geometry, `procobj-spacing-census.ts`, 2026-08-09.

| Rule | spacing | same | any | Reads as |
| --- | --- | --- | --- | --- |
| `p_sand_arid sand_combush02/03` | 10 | **59 %** | 91 % | desert bushes in clumps |
| `p_mountain p_rubble04col/05col` | 10 | **76 %** | 97 % | rubble in piles on slopes |
| `p_bushy` (surface total) | 8–23 | **70 %** | 97 % | the densest grouping in the game |
| `p_foreststumps genveg_tallgrass12` | 15 | 30 % | 83 % | forest grass: some clumps, mostly mixed company |
| `p_grassmid1 genveg_bush19` | 20 | 9 % | 45 % | bushes apart |
| `p_sand_arid sand_josh1/2` | 20 | **2 %** | 91 % | a lone Joshua tree — standing among clumped bushes |
| `p_sand_dense sm_scrub_rock3` | 19 | **1 %** | 86 % | desert rock: a single, in mixed company |
| `p_sand sjmcacti2`, `sm_des_pcklypr1` | 16 / 23 | **0 %** | 100 % | cacti never repeat on a face |
| `p_grassmid1 rockbrkq`, `p_underwaterbarren searock01..06` | 43 / 81 | **0 %** | 45–88 % | scattered singles |
| `p_woodland dead_tree_2..9` | 163 | **0 %** | 8 % | isolated dead trees, alone even from other species |

Two things the table says that the field report could not:

- **Same surface, opposite look.** On `p_sand_arid`, bushes are 59 % grouped and Joshua trees 2 % — the
  biome does not decide it, the species' own `spacing` does.
- **The mixed column is nearly always high** (85–97 % across desert and mountain): almost every object
  stands on a face that also carries something else. That is the "rock with bushes around it" reading, and
  it is what our per-species MINDIST cull leaves untouched while deleting every repeat of one kind.

## The gate: which surfaces and which entities scatter at all

- `surfinfo.dat`'s **`PROC_OBJ`** flag (`SurfaceInfos_c`, `bCreatesObjects`) decides whether a surface may
  create objects; `procobj.dat` rules on a surface without it are inert. **Checked on stock 2026-08-09: all
  17 surfaces carrying rules have `PROC_OBJ = 1`**, so matching by surface NAME (what our parser does) is
  equivalent on stock data — but a MOD that adds a rule for an unflagged surface gets nothing in SA and
  would get scatter from us.
- Entities are pre-filtered by `CPlantMgr::SetPlantFriendlyFlagInAtomicMI`, which sets `bAtomicFlag0x200`
  when any of the model's collision triangles has a plant- or object-creating surface. It is derived at load
  time, not authored.

### 17 of the 95 rules can never fire

Measured 2026-08-09 while pricing the readings: **3 of the 17 surfaces that carry rules have ZERO collision
area map-wide** — `p_grass_dry` (9 rules), `p_flowerbed` (6) and `p_wasteground` (2). Every one of their
rules is dead in the stock game, including `p_wasteground p_rubble` at spacing 4, which is the densest rule
in the file. The surfaces exist in `surfinfo.dat` (the parser test cross-checks that every rule lands on a
real `P_*` row) — no COL face is authored with their material id.

Controlled before it was believed: the same collider set resolves the other 14 surfaces, and
`procobj-stats.ts -450 1500` reads a desert cell as `dirt` / `rock_cliff` / `p_sandbeach` / `p_sand_arid` on
`des_*` and `s_bit_*` models, so the surfinfo-index → COL-material mapping is right and the zeros are the
data's, not the rig's.

## The runtime envelope (the original's, not ours)

Recorded because it explains why nobody ever sees the authored density all at once, and because it is a set
of 2004 ceilings a plan must NOT adopt ([project-goals](../project-goals.md) directive 2):

| Constant | Value | What it bounds |
| --- | --- | --- |
| `PLANTS_MAX_DISTANCE` | 100 m | how far from the camera a loc-triangle exists |
| `PROC_OBJECTS_MAX_DISTANCE` | 340 m | how far the col-entity cache reaches |
| `MAX_NUM_PROC_OBJECTS` | 40 | cached entities |
| `MAX_NUM_PLANT_TRIANGLES` | 256 | live loc-triangles |
| `ProcObjectMan_c::m_Objects` | 512 | procobj entities alive map-wide |
| `CObject::nNoTempObjects` | 150 | live procobj that are CObjects rather than CBuildings |
| `m_numAllocatedMatrices` | 200 | aligned (`ALIGN = 1`) placements, which need a static matrix |

So the authored density is a **local** density that the engine only ever realises inside a 100 m bubble. A
static bake of the same density is a different cost question — that is the plan's, not this page's.

## What the misreading cost us, measured

`npx tsx scripts/debug/procobj-spacing-census.ts` (2026-08-09, `game-src/original`, 95 rules, 7 019 collider
groups) prices both readings over the whole map:

| | our reading (`area / spacing`) | the game's (`area / spacing²`) |
| --- | --- | --- |
| Expected objects, all 95 rules | 1 947 713 | **103 007** |
| Expected objects, the 43 converted species | 1 571 748 | **90 906** |

and then the pipeline's own stages at vanilla density: **5 843 322** candidates → **1 948 374** past
`lottery < 1` (matching the expectation to 0.00 %, the census's self-check) → **20 265** after
`cullByMinDistance`. **MINDIST-as-spacing deletes 99.0 % of what the wrong density generated**, and the two
errors are in opposite directions, which is why the output looked sane.

The signature the plan predicted is there in our own artifact — nearest-neighbour distances, XY, metres:

| | same species | any species |
| --- | --- | --- |
| pre-cull | min 0.0 · p05 1.6 · med 4.2 | min 0.0 · p05 0.9 · med 2.6 |
| post-cull | **min 50.0** · p05 50.4 · med 58.2 | min 0.3 · p05 3.9 · med 10.9 |

**0 of 20 246 same-species pairs are closer than their MINDIST**, while cross-species pairs are free — the
cull is per species, so mixed clumps survive and repeats of one species never do. What ships is therefore
neither grouped nor chaotic but *evenly spaced, one of each kind* — the authored look inverted, and invisible
as a missing object.
