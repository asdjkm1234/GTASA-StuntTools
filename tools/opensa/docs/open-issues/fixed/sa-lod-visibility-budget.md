# Building LODs that never draw on the `sa` build — the data is perfect, so the budget is the suspect

**Status: ✅ FIXED — full `sa` rebuild field-accepted 2026-08-17 ("all perfect, everything in place": the rock, `lodcuntw65`, the burger joint, hospital + ground, `lod711block02`, the container cranes, the SFSE airport sign). Rebuilt tree: `txd-dimension-census.ts` 0 fatal of 39 720 textures (was 6), `multi-atomic-census.ts --tree` 0 of 20 clone LODs with more than one atomic (was 16).** Original close-out note follows.

**Superseded: 🟢 ALL THREE VECTORS FIXED IN CODE, 2026-08-17 — moves to `fixed/` once the full `sa` rebuild passes the field.** Vector 3 = BinMesh split order (round 14), vector 2 = a multi-atomic `anim` HD byte-copied into an `objs` LOD (round 15), vector 1 = DXT rasters not block-aligned killing whole dictionaries (round 16). Superseded status follows.

**Superseded status: 🟡 SPLIT INTO THREE, 2026-08-16 evening.** The single "LODs do not draw" issue this file was opened
on turned out to be **three unrelated defects**, separated by a staged pipeline bisect (rounds 7–10 at the
bottom). Read those first — everything above them is the falsified history, kept because each dead
hypothesis is a place a future round must not spend money again.

| # | vector | what is known | where it is |
| --- | --- | --- | --- |
| 1 | **mods** | `lodxhospital1` / `lodxhospground1` / `lod711block02` are clean the moment `mod-installer` is out of the pipeline | **round 16: FIXED in code, field-confirmed one-dictionary swaps 2026-08-17** — a DXT texture not a multiple of 4 kills its whole dictionary; mods shipped the sources; final closure after the full `sa` rebuild |
| 2 | **the burger joint** | `burger01_LAw`'s LOD is absent with the optimizer in, present without it; its clone is one of 11 with atomics ≠ 1 | **round 15: FIXED, field-confirmed 2026-08-17** (a verbatim clone of a multi-atomic `anim` HD — SA keeps ONE atomic of it) |
| 3 | **normals × repeat textures** | the optimizer adds normals to prelit world geometry; the smear appears **only on repeat-textured objects** and **only while the install's SkyGfx fork is loaded** | round 10, cause located, fix NOT decided |

**Superseded status: 🔴 STILL OPEN 2026-08-16 — the txdp fix did NOT work.** Self-contained dictionaries changed
nothing in the field (`lodxhospground1`, `lod711block02` still absent, the white patches unchanged), so the
parent was a real defect but not THIS one. What the bisect proved stands: the `salod*` dictionary is the
failing half, since the same clone geometry renders with a stock atlas. Round 5 fixes the last structural
difference between our generated dictionaries and the game's own content — see the bottom of this file.

**Superseded diagnosis (kept — it was wrong and the fix was still right):** the `txdp` parent dictionary:
`sa-lod-generator`'s clone TXDs kept only what was unique to them and pointed at one shared `salodpar`
parent, and **the real game does not deliver that parent's textures to the child's materials**. Every
parent-only name renders untextured — the white patches over the countryside — and **1 966 of 4 050 clone
LODs (49 %) depended on it**. Fixed by making every clone dictionary self-contained (`selfContainedTxd`,
default true); plan 006's parent half is retired and the bytes it saved are priced in
[`docs/performance/deferred-optimizations/salod-txdp-parent-dedup.md`](../../performance/deferred-optimizations/salod-txdp-parent-dedup.md).

**Original status: 🔴 open 2026-08-16, measured but NOT diagnosed.** Field report from the real game (helicopter over
LS): a number of building LODs simply do not appear, while the same models resolve and render in our own
`sa-map-viewer` off the SAME built tree. **Pre-existing** — `laehospital1`'s missing LOD was already in the
2026-08-11 report ([fixed/ipl-row-removal-breaks-lod-links.md](ipl-row-removal-breaks-lod-links.md))
as one of the two cases the stream-merge fix did NOT explain.

## The three reported cases

| LOD | txd | position | HD |
| --- | --- | --- | --- |
| `LODger01_LAw` | `salod0079` | 801.1, −1618.5, 19.8 | `ger01_law` |
| `LODxhospital1` | `salod0424` | 2050.1, −1401.2, 33.7 | `laehospital1` (a mod's model) |
| `LODIdlewood12` | `salod0433` | 2148.9, −1791.8, 19.1 | — |

## What was ruled out, by reading the built tree

Every one of these checks was run against `build/original/sa`, the tree the field run reads:

- **IPL rows** — identical to stock: same id, same position, `interior 0`, same draw distance. The only
  difference is float64 re-serialisation from the LOD-transform retarget.
- **IDE rows** — identical to stock except the `txd` column, which is the designed repoint to the generated
  per-LOD dictionary (`lod2lae1` → `salod0424`). Ids, draw distances and flags unchanged.
- **Assets** — every `.dff` present in `gta3.img`; every `salod*.txd` present, DXT1, sane sizes; **every
  texture the materials name is in the child dictionary** (no reliance on the `salodpar` txdp parent for
  these three).
- **LOD links** — `assertLodLinks` on the finished tree: 15 648 checked, 0 findings.
- **DFF structure** — the clone's chunk tree matches stock's shape (Clump → FrameList → GeometryList →
  Geometry → Atomic), one atomic, one geometry.

So nothing about these models is malformed. What changed is their COST.

## What our build does to the LOD set, measured

| | stock `game-src/original` | built `sa` | factor |
| --- | --- | --- | --- |
| `lod*` DFF payload | 4 140 files, **34.4 MiB** | 4 326 files, **189.4 MiB** | ×5.5 |
| LOD models over 100 KiB | 2 | **378** | ×189 |
| largest LOD model | 130 KiB | **1 960 KiB** | ×15 |
| LOD **instances** map-wide | 6 086 | **15 631** | ×2.6 |
| LOD instances within 1 500 u of the hospital | 1 807 | **4 527** | ×2.5 |
| … of `ger01_law` | 1 500 | **4 217** | ×2.8 |

Two of our own decisions produce that:

1. **Per-object clone LODs are the HD geometry** (`sa-lod-generator`, plan 002) — `LODxhospital1` is
   481 280 B, byte-for-byte the size of its HD, against stock's 12 288 B. `decimateBudget` rarely fires
   because SA's hand-modelled meshes have little tessellation to collapse.
2. **The tree impostor layer adds ~9 500 LOD entities.** Within 1 500 u of the hospital the top LOD models
   are all vegetation — `lodveg_palm04` ×582, `lodnew_bushsm` ×161, `lodsm_bevhiltree` ×158 … The top twelve
   alone are ~1 674 instances, i.e. the whole stock LOD population of that radius over again.

## The two ceilings that would produce exactly this

Neither is confirmed. Both are recorded so the next round starts from a hypothesis rather than a hunch.

- **`CRenderer::ms_aVisibleLodPtrs` — 1 000 entries in stock.** When the array fills, the LODs scanned after
  it are simply not drawn: no error, no missing asset, and the SAME building loses its LOD every time because
  the scan order is stable. The install's OLA ini sets `VisibleLodPtrs = unlimited`
  ([reference-install-config.md](../../gta-sa-original/reference-install-config.md)) — and this project has a
  MEASURED precedent that an OLA `unlimited` can be a no-op: `EntityIpl = unlimited` was set, and the game
  still died on the 40th inst-bearing IPL (2026-08-10, [sa-target.md](../../restrictions/sa-target.md)).
- **Streaming / LOD preload.** The install runs `ImprovedStreaming` with `PreLoadLODs = 1` and
  `StreamMemoryForced = 1024`; a 189 MiB LOD payload is 5.5× what that configuration was proven against.

## Both candidates are DEAD — field-tested 2026-08-16, same day

- **Approaching from different distances and headings changes nothing.** The HD swaps in when close; the LOD
  never appears at any range or angle. A visible-pointer overflow depends on how many LODs compete in the
  frustum, so this rules that family out.
- **`PreLoadLODs = 0` did not help.** The preload budget is not it either.

So it is neither of the two ceilings this file was opened on, and it is not the data. What is left is
something the `sa` LOD stage does to these models that SA rejects SILENTLY — a model whose TXD fails to load
is never marked loaded, and an unloaded model is never drawn, which is exactly this symptom.

**A byte-level look at our generated dictionaries against stock's, recorded but NOT yet accused:**

| field | ours (`salod*`) | stock (`lod2lae1`) |
| --- | --- | --- |
| raster format | `0x8300` — EXT_MIPMAP + **4444**, on DXT1 data | `0x0200` — **565** |
| mip levels | 6–7 | **1** |
| mask name | the texture's own name, duplicated | empty |
| shared txdp parent | `salodpar.txd`, **2.76 MB / 1 086 textures** | none |

## The experiments that would separate them, cheapest first

1. ~~Approach from different distances and headings~~ — **run, negative** (see above).
2. ~~`PreLoadLODs = 0`~~ — **run, negative** (see above).
3. **Built and waiting on the field, 2026-08-16:** a `--exclude trees` build (9m 40s) with the impostor layer
   gone — LOD instances 15 631 → 6 174 — and, in the SAME tree, three models reverted to their STOCK LOD by
   hand (`lodxhospital1`, `lodidlewood12`, `lodger01_law`: stock `.dff` written back over the clone in place,
   IDE `txd` column pointed back at `lod2lae1` / `lod_a_law`). One trip, three answers:
   - **only the three reverted LODs return** → the `sa` LOD stage's own output is the cause, and the next
     split is clone-DFF vs `salod*` TXD;
   - **all the missing LODs return** → the impostor layer was crowding them out after all;
   - **nothing returns** → the cause is upstream of the LOD stage entirely (mods or optimize), which would
     exonerate the whole clone/`salod` mechanism in one observation.

## Round 3 (2026-08-16): the impostors are innocent, and ONE revert rendered

Field verdict on the `--exclude trees` + three-reverts build:

- **`LODxhospital1`, reverted to its stock dff + stock atlas, is visible for the first time.** The single
  controlled change that has ever fixed one of these.
- `LODut01_LAwN` (`salod0558`, untouched) also appeared.
- `LODxhospground1` (`salod0424`) and `LOD711block02` (`salod0433`) are still missing — the first sits
  directly under the hospital LOD that now renders.
- **The impostor layer is not the cause**: with all ~9 500 tree LODs gone the missing set is "5–6 objects for
  the whole city, plus or minus the same ones" (his words). That also sets the SCALE — this is a handful of
  models, not a class.

So the `sa` LOD stage's own output breaks a small, specific set. What does NOT separate the broken from the
working, all measured on the built tree:

| candidate | broken | working | verdict |
| --- | --- | --- | --- |
| model size | `lodxhospground1` 98 KiB | `lodut01_lawn` 108 KiB | not it |
| atomics / geometries | 1 / 1 | 1 / 1 (only 10 clones map-wide have ≠1, none of them these) | not it |
| textures resolving | all resolve, 1 via the `salodpar` parent | all resolve, 3 via the parent | not it |
| DXT5 in the model's own textures | `lod711block02` 14 of 24 — but `lodxhospground1` **0** | 0 | not it ALONE |

**One fact worth keeping whatever the cause turns out to be:** stock SA ships **28 786 DXT1 + 2 095 DXT3
textures across 3 978 dictionaries and not a single DXT5**. Our clone dictionaries emit DXT5 for anything with
alpha — 399 of 995 carry at least one. That is outside the range the game's own content occupies, and
`encodeHalvedTxd` should be writing DXT3 for alpha regardless of how this issue resolves.

## Round 4: the split answered, and the white patches named the mechanism

The two-way patch came back decisive:

- **`lod711block02` — our clone dff + the STOCK atlas → APPEARED.** The geometry is fine.
- **`lodxhospground1` — the STOCK dff + our `salod0424` → still missing.** The dictionary is the failing half.

Then the field produced the symptom that names the mechanism: **white, z-fighting patches all over the
countryside**, e.g. `lodcuntw65` (`salod0214`) at −245.2, −1505.7 and `lodcehollyhil06` (`salod0582`) at
994.1, −840.8. Those models load — they are drawn — with their textures missing. Which textures?

| model | textures | only in the `salodpar` parent |
| --- | --- | --- |
| `lodcuntw65` | 7 | 1 — `grasstype4`, the material that reads as a white patch |
| `lodcehollyhil06` | 15 | 1 — `rocktbrn128blndlit` |
| `lodut01_lawn` (renders) | 21 | 3 |
| `lodxhospground1` (missing) | 4 | **4 of 4** |

**Every parent-only texture renders untextured, and a model whose textures are ALL parent-only has nothing to
draw with at all.** Census over the built tree: **1 966 of 4 050 clone LODs (49 %) depend on the parent.**

`txdp` is an SA-native mechanism and our own engine resolves the chain, which is exactly why every offline
check passed. The real game does not follow it here.

## The fix, built 2026-08-16

`selfContainedTxd` (default true): every `salodNNNN` carries every texture its models name; no `salodpar`, no
`salod-txdp.ide`. The partition survives behind the flag and its unit tests, priced as a performance lever.

## Superseded: the DFF/TXD split

The same build now carries a two-way bisect, patched in place (no rebuild), on the two still-missing models:

- **`lodxhospground1` — STOCK dff, our `salod0424` dictionary.** Its stock textures are not in that
  dictionary, so **white = the model loaded** (the dictionary is fine and the clone DFF was the fault);
  **still missing = the dictionary is what fails to load**.
- **`lod711block02` — our clone dff, the STOCK `lod2lae1` atlas.** Same reading, mirrored.

A model whose TXD never loads is never marked loaded, and an unloaded model is never drawn — which is why
"white or absent" is the question that splits the remaining half in one look.

## Where it stands after 2026-08-16 (nine hypotheses, none of them it)

**What is PROVEN, and it is not much:**

| | |
| --- | --- |
| clone LODs in the tree | ~6 places broken in the whole city, always the same ones |
| clone stage producing NOTHING (stock LODs, `minLodPixels` 100 000) | **clean — no bugs at all** (field, 2026-08-16) |
| our clone geometry + a STOCK dictionary that resolves 100 % of its names, exact case | **still broken** — so the generated dictionary is NOT the defect |
| the clone DFF of 3 of the 4 checked models | **byte-identical to its HD**, and that HD renders correctly |

So the swap of the LOD's model is the trigger, the dictionary is cleared, and the geometry is provably
loadable. ~6 of 4 050 clones fail; 99.85 % are fine.

### The nine, and how each died

| # | hypothesis | how it died |
| --- | --- | --- |
| 1 | `ms_aVisibleLodPtrs` overflow (1 000 entries) | the LOD never appears at any range or heading |
| 2 | `PreLoadLODs` / stream-memory budget | `PreLoadLODs = 0` changed nothing |
| 3 | the tree impostor layer crowding the LOD budget | `--exclude trees` (9 500 LOD entities gone) changed nothing |
| 4 | the `txdp` parent not resolving | self-contained dictionaries changed nothing — REVERTED, it cost 45.9 MiB against 10.4 MB |
| 5 | raster headers unlike stock's (4444 on DXT1, DXT5, mip bit, mask name) | matched stock exactly; nothing changed. Kept — it is alignment at zero cost |
| 6 | `deviceId 0` in the dictionary struct | stock writes 2 and we wrote 0, but the tree's other 422 zeroes are MOD TXDs that render. Kept, same reason |
| 7 | texture-name CASE (our dictionaries lowercased, the clone's materials do not) | fixed on both sides; nothing changed. His own objection was the right one: mixed-case textures are far more than 6 models |
| 8 | the FLA TXD id pool (5 171 archives against a 5 000 default) | the install's log reads `20000 - 25999 (6000)`, and setting `FILE_TYPE_TXD = 1000` crashed the game at once — the raise is real and applied |
| 9 | the LOD-transform retarget writing the HD's transform | of the four broken rows it changed exactly ONE (`lodcuntw65` lost a 33° yaw); the other three are identical to stock |

### Features that do NOT separate the broken six

Measured across all 4 050 clones: vertex/triangle count, decimated vs verbatim, material count, UV layers,
2dfx presence, night colours, geometry flags, archive size, flatness (`lodidlewood12` ranks 1 964 of 4 049 on
z/xy, `lodger01_law` 3 393). Nothing puts them in a minority.

### One contradiction, recorded because it may be the thread

- Round 4: `lodxhospground1` = **stock** dff + our dictionary → still missing.
- Round 6: `lodxhospground1` = our clone dff + **stock** dictionary → still missing.
- No-clone build: stock dff + stock dictionary → **fine**.

Neither half alone explains it, which should be impossible if one of them is the defect. The round-4 patch is
the less trustworthy of the two — it rewrote DFF bytes in place inside `gta3.img` (directory sizes patched by
hand), where round 6 only edited an IDE column. **Treat round 4's result as suspect before building anything
on it.**

### The plan that replaces guessing (the user's, 2026-08-16)

Three staged builds, each removing one stage from the pipeline, on the `lod-field-bisect` branch:

1. **`--exclude mods`** — if the objects come back, the defect involves the mods and is chased there.
2. **`--exclude mods,optimize`** — if not, the optimizer joins the suspects.
3. **clone-only LOD stage** (no decimation, no mesh re-encode) — if the first two change nothing, the defect
   is in what the LOD stage does to VANILLA objects, and this splits cloning from transforming.

Each stage is a field verdict, not an argument. Whatever the answer, it lands in this file.

### The pragmatic exit, if the hunt has to stop

`mods-src/<game>/lod-exclude.json` already exists for exactly this: models that must not enter the far LODs.
Listing the ~6 leaves them their stock LODs and costs nothing. The alternative is turning cloning off for the
`sa` target entirely — proven clean, at the price of the detail the feature buys and 5.5× the LOD payload.

---

# Round 7 (2026-08-16): the staged bisect, and what it cost to get three bootable trees

Branch `lod-field-bisect` (created as a marker; **it carries no commits of its own** — the whole bisect was
build-tree work, so there is nothing on it to merge and it can be deleted whenever). Three trees on disk:

| tree | pipeline | role |
| --- | --- | --- |
| `build/original/sa` | everything | the broken reference |
| `build/bisect-nomods/sa` | `--exclude mods` | mods out, optimizer + LOD stage in |
| `build/bisect-nomods-noopt/sa` | `--exclude mods,optimize` | also without `map-optimizer` |

## Four traps that ate most of the round — record them before the next bisect

1. **`--exclude mods` removes the entire RUNTIME, not just mod content.** FLA, OLA, CLEO and modloader are
   installed BY `mod-installer`, so a nomods tree cannot boot at all. Worked around by running it inside the
   user's bottle, which keeps its own plugins. **Any future `--exclude mods` build needs this said out loud.**
2. **Both bisect trees threw at 41 of 40 inst-bearing IPL slots** — because `compactStockInstIpls` also lives
   inside `mod-installer`. Fixed by running the compaction by hand on both trees (→ 39) and copying the ASIs
   in. The stage that enforces a stock ceiling must not be the stage a bisect removes.
3. **FLA crashed on model ID 14769** — `carupg_int_rays`, added by `5. SA Xbox Map Features`. This was a MIXED
   install: our stock `data/` next to the bottle's already-modded `gta_int.img`. A bisect tree is only honest
   when the archives and the tables come from the same place.
4. **`salod-txdp.ide` crashed the game** — the bottle kept an old `gta.dat` registering a file the new build
   no longer writes. That produced the `assertGtaDatFiles` guard now in the pipeline, so the class is closed.

## The field verdict: one issue was three

| tree | `lodxhospital1` / `lodxhospground1` / `lod711block02` | ground-LOD white patches (`lodcuntw65`) | `burger01_LAw` LOD |
| --- | --- | --- | --- |
| `build/original/sa` | **missing** | **present** | **missing** |
| `bisect-nomods` | **all fixed** | **present** | **missing** |
| `bisect-nomods-noopt` | fixed | **gone** | **present** |

Read straight off the table: the hospital group belongs to **mods**, the white patches and the burger joint
belong to **`map-optimizer`**. Nothing here is about the LOD clone stage, the `salod*` dictionaries, or any
budget — which retires everything in rounds 1–6 above as background.

# Round 8: the swaps prove the optimizer's OUTPUT is the defect, and it is not a LOD problem at all

In-place DFF swaps inside `gta3.img` (dir entry repointed, no rebuild), each one field-checked:

| swap | verdict |
| --- | --- |
| `lodcuntw65`: optimized → pre-optimizer version | **fixed**, and the neighbouring `lodcuntw66` fixed with it |
| a synthetic probe: stock geometry + trilist `BinMeshPLG` + tristrip flag cleared | model **vanished entirely** — the splice was structurally sound (flags 0, 660 indices = 220×3), so this measured nothing except that a hand-built mesh is easy to get wrong |
| `cehollyhil06` (**HD**, the rock at 994, −841): optimized → pre-optimizer version | **fixed** — "the smear is gone" |

**The user's correction is the load-bearing one:** LODs are CLONED FROM the HD, and the same artifact is on
the HD itself — he flew to the biggest instance of it and stood on it. So this was never a LOD-visibility
issue; the clone stage only propagates what the optimizer already did to the source model.

# Round 9: the exact per-model difference

`cehollyhil06`, decoded from the three trees (Geometry → Struct header):

| | flags | triangles | vertices | struct bytes |
| --- | --- | --- | --- | --- |
| stock `game-src/original` | `0x1006f` | 1003 | 1320 | 39 744 |
| `bisect-nomods-noopt` (clean) | `0x1006f` | 1003 | 1320 | 39 744 |
| optimized | `0x1007e` | 1003 | **1322** | **55 656** |

Flag delta: **TRISTRIP (`0x01`) cleared, NORMALS (`0x10`) set**. Triangle count untouched; two vertices split;
the +15 912 bytes are exactly the normals array (1322 × 12 B). Clump total 56 184 → 75 768.

## The single-variable probe

Re-ran `map-optimizer --no-add-normals` over `game-src/original` and patched only that model in:

- output is **1320 vertices, flags `0x6f`** (tristrip KEPT), 57 344 B, differing from stock in **378 bytes
  across 127 ranges** — i.e. the prelit pass and the always-on core, nothing structural.
- **Field: the HD rock is fixed.**

**Honest limit of that probe:** it does not separate the normals array from the strip→list re-encode, because
with normals off the mesh is not re-encoded at all. Both moved together.

## The census that says which of the two is the anomaly

Over `game-src/original` (19 193 geometries) and `build/original/sa` (24 672):

| | stock | our `sa` build |
| --- | --- | --- |
| tristrip | 18 194 (94.8 %) | — |
| trilist | **999 (5.2 %)** | — |
| carries normals | 5 758 (30 %) — 5 727 of them also LIGHT-flagged, and the examples are **dynamic** objects (`bottle`, `beer_girla`, `burg_ga`) | — |
| **prelit only** | 13 356 | 2 279 |
| **normals only** | 5 501 | 10 468 |
| **prelit AND normals** | **257 (1.3 %)** | **11 853 (48 %)** |

Trilist is not an anomaly (stock ships 999) and normals are not an anomaly (stock ships 5 758). **The
combination is**: stock world geometry is either baked with prelit and carries no normals, or is dynamic and
lit by normals. We put both on half the map.

## It was already written down in our own code

`tools/map-optimizer/src/plugins/smooth-normals.ts:38`, on `addWhereAbsent`:

> Default **false**: stock SA world geometry is prelit + LIGHT-flagged WITHOUT normals (777 of 800 sampled
> geometries) — adding normals flips real SA into its dynamic vertex lighting path and shades the whole map
> with giant triangle-interpolated fans. OpenSA builds opt in (`addNormals` pass) — its renderer wants
> normals for SSAO (plan 015).

"Giant triangle-interpolated fans" is the reported symptom, verbatim. The safe default was then overridden
globally by `tools/perfect-map-builder/src/config.ts:86` (`optimizerPasses: { addNormals: true }`), and since
the `sa` target and the OpenSA pak are cut from the SAME optimize stage, the SA tree inherited a property
that only OpenSA's renderer wants. **That is the whole mechanism of how it shipped.**

# Round 10: the install names the counterparty — SkyGfx's repeat-texture path

The field observation that reframes the fix (his, 2026-08-16 evening):

- **the defect appears on objects with REPEAT (tiled) textures** — not on arbitrary geometry;
- **removing `skygfx.asi` removes the problem entirely**;
- **the install's SkyGfx is not aap's** — it is the **JuniorDjjr fork**
  (<https://github.com/JuniorDjjr/skygfx>), which carries **special handling for repeat textures**.

That fork is already researched in this repo: [074·12 stochastic
texturing](../../plans/074-opensa-engine/12-stochastic-texturing.md) took its design from it — a curated
`models/texdb.txt` tags texture NAMES, and `src/buildingPipe.cpp` swaps the building **pixel shader** per
tagged texture (`simpleStochasticPS`, `xboxBuildingStochasticPS`). So the surface that misrenders is being
drawn by a REPLACED shader, and the interaction is between the normals we added and that shader's path.

Recorded on the install side in the same change:
[reference-install-config.md](../../gta-sa-original/reference-install-config.md) (which fork, and that its
plugin list's "only three matter" line is about LIMITS only) and
[reference-install.md](../../gta-sa-original/reference-install.md) ("the vanilla renderer" is not what the
target install runs).

## What this rules OUT as the fix

**Turning `addNormals` off for the `sa` target is rejected** (his call). It would trade a rendering defect for
a data loss — the `sa` tree stops carrying the only place curvature intent is expressed — and it answers
nothing about why the fork's shader cannot take them. The question to answer is **how to ship normals the
target install's shaders render correctly**, not how to stop shipping them.

## Built but NOT field-tested, and then reverted at his request

A surgical normals strip (chunk-level: clear the NORMALS flag, drop the morph-target normals array, leave
everything else byte-identical — `cehollyhil06` 77 824 → 61 960 B, 1322 vertices and the trilist form kept,
flags `0x6e`, prelit intact) was patched into `bisect-nomods` and then rolled back before the field check.
It would have answered one narrow question — *is the normals array alone enough, with the re-encode left in* —
and that question is still open. `build/bisect-nomods/sa` currently holds the **broken** optimized model
again, deliberately.

## Loose ends left in the bisect trees

- `lodcuntw65` in `build/bisect-nomods/sa` is still the failed trilist probe (a hole in the world). Its
  archive entry was shrunk to 11 sectors, so the clean 21-sector version cannot be written back in place —
  it needs a rebuild or an append-to-tail patch.
- Patched entries in that tree were appended past the end of `gta3.img` with the directory repointed; the
  file is valid but no longer offset-ordered.

## The three vectors, as he framed them

1. **mods** — the hospital group. Undiagnosed; the bisect only proved `mod-installer` is upstream of it.
2. **the burger joint** — `burger01_LAw`'s LOD, absent with the optimizer in. Note it is also one of the 11
   clones whose atomic count ≠ 1, the one structural oddity that survived round 3's census.
3. **normals × repeat textures × the SkyGfx fork** — cause located, fix undecided, and the decision must
   start from what the fork's building pipe does with normals on a tagged tiled texture.

# Round 11 (2026-08-17): the fork's shaders do not read normals — the variable is the RE-ENCODE, or the PS

Read out of the fork's source AND its shipped compiled shaders (full record:
[skygfx-fork-building-pipe.md](../../gta-sa-original/skygfx-fork-building-pipe.md)):

- The install runs `buildingPipe=PS2`. `ps2BuildingVS` has **no NORMAL input**; colour = day/night prelit blend
  × material + ambient × surfAmb. Every building PS, stochastic ones included, is `tex × vertex colour`. The
  Xbox VS reads the normal only for env-map UVs. There is **no code path in which "normals present" changes
  the fragment colour of a building-pipe atomic** — and stock SA never lights building-pipe geometry with the
  sun either (it is not `m_bLightObject`; the world is drawn after `DeActivateDirectional()`).
- `cehollyhil06` stock AND built carry the night-colour chunk with an empty atomic extension → building pipe in
  both trees, plugin or not.
- The stochastic PS is, by construction, a **barycentric blend of three hashed samples on a UV-space
  triangular lattice** — a "giant triangle-interpolated" pattern that depends on nothing in the geometry.
- The fork's `DNInstance_PS2` is the one place a re-encoded `BinMeshPLG` (our trilist rebuild, per-mesh
  `[minVert, numVertices)` colour instancing, per-mesh `vertexAlpha`) meets fork code instead of RW's default
  instancer — the only STRUCTURAL reason a re-encoded model could differ WITH the plugin and not without.

**So round 9's honest limit is now the whole question.** `--no-add-normals` never separated the normals array
from the strip→list re-encode (with normals off the mesh is not re-encoded at all), and nothing in the fork can
see the array. The candidates, in the order they cost:

| # | mechanism | single-variable probe | cost |
| --- | --- | --- | --- |
| a | the fork's stochastic PS is what the eye reads as the smear, and the optimizer changed nothing it depends on — i.e. the report conflated a plugin look with a build defect | `stochasticTexturing=0` in `skygfx1.ini`, same broken build | one restart |
| b | the fork's building PIPE (instancer) mishandles our re-encoded mesh | `buildingPipe=` (empty → pipe not hooked, rest of the plugin stays), same build | one restart |
| c | the re-encode / vertex split, not the normals array | `model-lab.ts cehollyhil06 --strip-normals-after` (NORMALS flag + array dropped, trilist + 1 322 verts KEPT) | seconds + one restart |
| d | the normals array itself (contradicts the shader read — kept only to be falsified) | (c) fixed → not d; (c) still broken → not the array | — |

Instruments (this session): `scripts/debug/model-optimize.ts` (one model, one variant, patched in place),
`scripts/debug/model-lab.ts` (the same PLUS its clone LOD cut from the result — clones are cut from the HD, so
an HD-only patch leaves the far view broken), `scripts/debug/img-patch.ts` (append-and-repoint swaps with a
ledger, `restore` per entry). `build/bisect-nomods/sa` is back to its broken shipped bytes after the round-trip
tests (ledger empty).

# Round 12 (2026-08-17, field): `buildingPipe=` empty FIXES it, `stochasticTexturing=0` does not

Two single-variable ini probes on the same broken build, one restart each:

| probe | verdict |
| --- | --- |
| `stochasticTexturing=0` (fork's PS back to the plain tap, pipe still hooked) | **still broken** |
| `buildingPipe=` (empty — the fork does NOT hook the building pipe; everything else in the plugin stays) | **fixed** |

So candidate (a) is dead and (b) is the mechanism: **the fork's building PIPE — its instancer `DNInstance_PS2`
+ `ps2BuildingVS` — mishandles what the optimizer writes**, while the game's own building pipe draws the same
bytes correctly. The pixel shader is innocent. What remains to separate is WHICH property of our output the
fork's pipe trips on: the normals array (the `NORMAL` element / stride 40 / `rpGEOMETRYLOCKNORMALS` path in
`DNInstance_PS2`) or the strip→list re-encode + vertex split. Probe (c) — `model-lab.ts cehollyhil06
--strip-normals-after` (normals gone, trilist + 1 322 verts kept) — answers it in one restart; the fourth
variant is free: `--crease 180` makes smooth-normals split nothing, so the overlay path keeps the STRIP —
`cehollyhil06` comes out `0x7f STRIP NPL`, 1 320 verts, 73 184 B: **normals ON, tristrip KEPT, no split**.
The two probes are orthogonal:

| variant | flags | verts | if the field says FIXED | if the field says BROKEN |
| --- | --- | --- | --- | --- |
| `--strip-normals-after` | `0x6e LIST -PL` | 1 322 | it is the normals array (the fork's `NORMAL` element / lock path) | it is the re-encode |
| `--crease 180` | `0x7f STRIP NPL` | 1 320 | it is the re-encode | it is the normals array |

Both patched via `model-lab.ts` (HD + clone LOD), one restart each.

# Round 13 (2026-08-17, field + census): it is the RE-ENCODE, and stock never fed the fork's pipe a trilist

Field, one restart each, `build/bisect-nomods/sa`, `buildingPipe=PS2`:

| variant | flags / verts | verdict |
| --- | --- | --- |
| `--strip-normals-after` (rebuild path, normals removed) | `0x6e LIST -PL` / 1 322 | **broken** |
| `--crease 180` (overlay path, normals ON, strip kept) | `0x7f STRIP NPL` / 1 320 | **fixed** |
| ini `buildingPipe=PC` (the fork's Xbox shader path, same instancer) | — | broken |
| ini `buildingPipe=` (fork's pipe not hooked, game's own DN pipe draws) | — | fixed |

So the normals array is innocent and **`rebuildGeometry`'s output is what the fork's building pipe cannot
draw** — while the game's own DN pipe (RW's default instancer + a CPU day/night lerp,
`CCustomBuildingDNPipeline`) draws the same bytes correctly. The fork replaces only the VERTEX instancing
(`DNInstance_PS2`); index data comes from RW in both. Reading the fork's callbacks found no branch on list vs
strip — and a census says why nobody would have noticed one:

**Stock `gta3.img`: 16 275 geometries, 11 743 with night colours, 338 trilist — and 0 trilist WITH night
colours.** No trilist geometry ever reaches the building pipe in stock; the fork's pipe has never drawn one.
Whatever the exact line, "trilist on the fork's building pipe" is untested territory, and our rebuild path
puts every rebuilt world model there (also `encodeLodDff` — decimated clone LODs and hole-fill LODs are
trilist + night colours too, the same class).

Two probes separate "the trilist itself" from "the rest of the rebuild", and the second is the candidate FIX
that keeps normals AND prelit:

| variant | what it is | FIXED ⇒ | BROKEN ⇒ |
| --- | --- | --- | --- |
| `--list-only` | the SOURCE, no chain, forced through `rebuildGeometry` (`0x6e LIST -PL`, 1 320 verts, prelit untouched) | the rebuild's other output (bounds / re-emitted Struct triangles / mesh order) | the trilist form alone |
| `--restrip` | the full chain (normals, split), BinMesh converted BACK to a tristrip (degenerate-joined, parity kept, TRISTRIP flag on; `0x7f STRIP NPL`, 1 322 verts, 88 784 B) | **the fix: emit strips for the sa target** — a real stripifier replaces the probe encoder | the trilist was not it |

Both via `model-lab.ts` (HD + clone LOD), `restore` between. Note for the reader: the same HD taken from
`game-src/original` and from `build/bisect-nomods-noopt/sa` split at different vertices — compare variants
cut from ONE `--src` only.

**Round 13 field, `--list-only`: BROKEN.** The source with nothing but the trilist re-encode (no chain, no
normals, no split, prelit untouched) already misrenders on the fork's building pipe — **the trilist form
alone is the variable.** `--restrip` is the next and, if it passes, the fix.

# Round 14 (2026-08-17): FIXED — the rebuilt BinMesh had lost the source's mesh ORDER

`--restrip` was broken too, so the trilist FORM was never it. What `--list-only` and `--restrip` share and the
overlay path does not touch: `rebuildGeometry` regenerates the `BinMeshPLG` — and `buildBinMesh` emitted its
splits **materials ascending**. Dumping `cehollyhil06`'s source: 15 splits in the order `0..7, 9..14, 8` —
material 8 (`cs_rockdetail2`, the vertex-alpha rock-detail layer, 226 triangles) is authored **LAST**, because a
BinMesh's mesh order IS the draw order inside the atomic and RenderWare's mesher puts the materials that blend
after the opaque ones. Ours drew that blended split in the middle: under the fork's building pipe (dual pass,
z-write at alpha ≥ 200) the tiled detail texture painted over the sky, wrote depth, and z-rejected the rock
splits 9–14 drawn after it — the "washed-out smear on repeat textures". The game's own pipe composites the
same bytes differently, which is why the symptom needed the plugin.

Fix: `c754efdb` — `buildBinMesh` keeps the source BinMesh's split order (materials the source did not draw are
appended ascending), unit test in `geometry-rebuild.test.ts`. **Field: `chain` (normals ON, trilist, split
vertices, source order) — "no bug, it worked".** Normals stay; the `addNormals` pass is not the defect and
never was; the round-9 census (prelit + normals on 48 % of the build) stands as a fact about our data, not a
fault.

What the bisect table now reads as: the round-7 "white patches" (`lodcuntw65`) and the rock are the SAME
class — every rebuilt world model with a blended split not last. The other two vectors (mods → the hospital
group, the burger joint's absent LOD) are untouched by this and stay open.

**Same class, other writer — follow-up:** `tools/lod-common/src/encode-dff.ts` (`encodeLodDff`) writes ONE split
per texture group in `MeshBuilder` first-appearance order. For a single-geometry clone that order is the source
draw order (the parser reads triangles from the BinMesh), so blended-last survives; for a MERGE across several
geometries (multi-atomic clumps, cells, procobj) a later geometry's opaque groups land after an earlier one's
blended group. Decimated clones (`decimateBudget 0.01`) and hole-fill LODs take that path. Needs a "blended
groups last" rule (vertex alpha < 255 / tint alpha < 255 / texture alpha via `TextureSource`), preserving
relative order — recorded here and in `restrictions/assets-and-data.md`.

**BUILT 2026-08-22 (`6b2e37ab`).** `encodeLodDff` partitions the merged groups opaque-first, each side keeping
its relative order, classifying a group as blended by its tint alpha, its texture's raster alpha flag (a new
`textures` option — both cell-LOD generators pass their source, resolved the way the group names are) or any
translucent prelit vertex; it reorders nothing when all or none blend, so an already-correct merge encodes
byte-identically. Unit-tested on `cehollyhil06` MERGED with a second model — the shape that buries the layer,
since a single clone of it already comes out of `buildClumpMesh` in split order. Not field-verified: it lands
with the next build of either generator's output.

# Round 15 (2026-08-17): the burger joint — a verbatim clone of a TWO-atomic clump, and SA keeps one atomic

Diagnosed with the one-model instruments alone (no rebuild): `model-lab.ts burger01_LAw --dry`, `img-patch.ts
get` from the three trees, `dump-binmesh.ts`, and a 20-line census of every multi-atomic model behind an IDE row.

**What the LOD was in each tree.** Stock `lodger01_law`: an authored 316-triangle single atomic. `bisect-nomods-noopt`
(LOD present): a **decimated** clone — ONE geometry, 870 triangles, the two HD atomics merged. `bisect-nomods` and
`build/original/sa` (LOD absent): a **verbatim byte-copy of the HD** — `cmp` says identical to `burger01_law.dff` —
77 824 B, **two atomics**: `burger01_LAw` (the building, 752 tris, root frame) and `burger01_LAw3` (the 5 m burger
sign, 336 tris, on a child frame at (7.18, −7.30, 1.01)). The budgeted decimator had rejected every target for the
optimized HD (with the un-optimized HD it accepted one), and the fallback was the byte-copy.

**Why two atomics vanish.** `burger01_LAw` is not an `objs` row — it is an **`anim` row** (`LAw.ide`, anim block
`LAw`; the sign turns), i.e. a `CClumpModelInfo` the game loads with `LoadClumpFile` and draws whole. Its LOD row
`LODger01_LAw` is a plain `objs` atomic model. gta-reversed's `CFileLoader::LoadAtomicFile` →
`SetRelatedModelInfoCB` → `CAtomicModelInfo::SetAtomic` sets `m_pRwObject = atomic` for EVERY atomic of the clump
it reads — the last one visited wins, the others are dropped, and the winner is re-parented to a fresh frame
(`RpAtomicSetFrame(atomic, RwFrameCreate())`) so a child-frame offset is lost. RW's `RpClumpAddAtomic` inserts
at the list head, so `RpClumpForAllAtomics` visits atomics in REVERSE file order — the LAST callback is the FIRST
atomic in the file: the burger sign, at the building's origin. A 5 m burger inside the footprint of an 800 m-draw
LOD is what "LOD absent" was.

**Census.** Every multi-atomic model behind an IDE row in stock `gta3.img` (34 of them, excluding `_dam` pairs)
is an **`anim` row** — rotating signs, the boigas/burger signs, windmills, oil derricks, the nodding donkeys —
and **zero `objs` rows are multi-atomic**: R\* never fed an atomic model info more than one atomic. Of the 34,
**16 LOD entries in `build/original/sa` were verbatim multi-atomic clones** (`lodger01_law`, `lod_cn2ringking`,
`oilderricklod01..07`, `lodbs_building_sfs`, `lodcandysign1`, `lodboigashot10/15/23/25`, `lodckpole`,
`lodprtlstation03`, `lodboigashotlawn`, and `oilplodbitbase`); one (`sprasfw → lodage_sfw`) had been decimated
and was fine. Round 3's "11 clones with atomics ≠ 1" was this list.

**Fix (this branch, `cloneLodDff`):** a clump with more than one atomic NEVER takes the verbatim path — it goes
through the mesh path (`buildClumpMesh` bakes the per-atomic frame transforms = the rest pose the animation
starts from) and is encoded as one atomic even when the budget keeps every triangle (`mergedLods` in the build
stats; `decimateBudget 0` too). Test: `clone-multi-atomic.test.ts` on the real `burger01_law.dff` fixture (2 → 1
atomic, 752 + 336 triangles kept, the sign's vertices at the frame offset). Rule + the loader fact in
`docs/restrictions/assets-and-data.md` and `docs/gta-sa-original/atomic-model-one-atomic.md`.

**One-model swap for the field:** `build/bisect-nomods/sa` now carries `burger01_law.dff` (chain variant) and a
one-atomic `lodger01_law.dff` (869 tris; `img-patch.ts status --game` lists 4 patched entries). **Field: fixed.**

**Seen on the way, not fixed:** `oilplodbitbase`, the LOD of the nodding donkey `nt_noddonkbase`, is ITSELF an
`anim` row (2 atomics, its arm nods at 800 m in stock). Our clone overwrites it with the 5-atomic HD, so the LOD
stopped nodding (verbatim: static, since the anim's frame names no longer match; merged: static, one atomic).
Whether an `anim`-row LOD should be left stock is the user's call — recorded in `docs/edge-cases/`.

# Round 16 (2026-08-17): the mods vector — a DXT texture that is not a multiple of 4 kills its WHOLE dictionary

Desk work only, then one-dictionary swaps. The three models sit on TWO clone dictionaries: `salod0424`
(`lodxhospital1` + `lodxhospground1`, atlas `hospital_lae`) and `salod0433` (`lod711block02`, `idlewood3_lae`),
and `lodxhospground1.dff` is byte-identical between the broken and the fixed tree — so the DFF was never the
variable there. Diffing those two dictionaries against every healthy one, the only thing that sets them apart:

| dictionary | texture | source | ours |
| --- | --- | --- | --- |
| `salod0424` | `marinadoor1_256` | mod 39 Realistic Hospital Door: 250×250 **A8R8G8B8**, uncompressed — the game takes it, the HD renders | ×0.25 → **62×62 DXT1** |
| `salod0433` | `pizzalogo` (+ `pizzatext` 700×52) | mod 62 Ghetto Pizzeria Update: 256×152 | **64×38 DXT3** |

Stock ships **26 004 textures and not one that is not a power of two** — R\* content could never hit this. In
`build/original/sa` exactly **five** of 995 clone dictionaries carried a DXT texture with a side not divisible
by 4 (`salod0176/0423/0424/0433/0687`), and one mod's own TXD did (`airwelcomesign_sfse`, `goldengates`
932×358 DXT1) — the "5–6 objects for the whole city" scale, and why `bisect-nomods` (stock sources, all pow2)
was clean. It also reads the old rounds correctly: 3 (stock dff + stock atlas → visible), 4 (stock dff + our
`salod0424` → missing; clone dff + stock atlas → appeared). Round 6's "clone dff + `hospital_lae` → still
missing" is the one observation this does not explain; the ground LOD sits under the hospital LOD and was judged
from a helicopter — recorded as unreliable rather than as a fact.

**Field, one swap at a time in `build/original/sa`** (`img-patch.ts set` on the dictionary only; the two IDE
columns hand-patched in earlier rounds put back to `salod0424`/`salod0433` first):

| swap | verdict |
| --- | --- |
| `salod0424` regenerated with `marinadoor1_256` at 64×64, every other texture byte-identical | **hospital AND the ground under it visible** |
| `salod0433` with `pizzalogo` 64×32, `pizzatext` 512×64 | **`lod711block02` visible** |
| prediction, unpatched: the container-crane LODs on `salod0176` (`Mich_Rmke` 224×207) | **absent, as predicted** |
| prediction, unpatched: the SFSE airport sign (mod 57's own 932×358 DXT1) | **absent, as predicted** — a mod's HD, not a LOD |
| `salod0176` with `Mich_Rmke` 256×256; `airwelcomesign_sfse.txd` through the optimizer's pass (1024×512) | **cranes and sign visible** |
| control: mod 64's HD `cranes_dyn2_cj` carries `Mich_Rmke` **896×828** DXT1 (4-aligned, NPOT) | HD cranes render — **the fatal property is "not a multiple of 4", NOT "not a power of two"** |

**Fix (this branch):** `encodeHalvedTxd`/`encodeLodTxd` resample every level to the nearest power of two
(`resampleToPow2`, reused from `cell-weld` — the same 62×62 was WebGPU's problem there); `map-optimizer`'s
`optimizeTxd` decodes any DXT texture that is not block-aligned in ANY dictionary of the tree (mods included),
resamples it to the power of two rounded UP and writes it back in the same format (`resized` in the run summary).
Rule with the measurement table: `docs/restrictions/dxt-raster-dimensions.md`. Census:
`scripts/debug/txd-dimension-census.ts` (0 fatal on `bisect-nomods`, 5 + 1 on the old `build/original/sa`).

**Closure (2026-08-17):** full `sa` rebuild, field-accepted on every point of the list; rebuilt tree measured
0 non-block-aligned DXT textures (39 720 checked) and 0 multi-atomic clone LODs (20 checked). Moved to `fixed/`.

