# 103 — one owner per archive entry: the vehicle bucket takes everything the vehicle tables name

**Status: BUILT 2026-08-20 — every step, field-confirmed the same day.** Planned that morning to the user's design. Field-found the same morning: the **slamvan has no
textures**, because `slamvan.txd` exists in `gta3.img` (stock, 14 336 B) and in `vehicles2.img` (the mod's,
9 359 360 B) at once and the stock one wins. The issue is
[`docs/open-issues/fixed/mod-file-shadowed-by-its-stock-twin.md`](../../../../docs/open-issues/fixed/mod-file-shadowed-by-its-stock-twin.md);
this is how it gets closed. Spans `img-splitter`, `vehicle-installer` and the `sa` stage's census, which is
why it lives here rather than beside one tool.

## The rule

> **Everything `vehicles.ide` and `veh_mods.ide` name — models and dictionaries alike — belongs to the
> vehicle bucket, and is MOVED there: written to the vehicle archive and deleted from `gta3.img`.**
> No entry may then exist under one name in two archives of a built tree.

Today the splitter decides an `objs` row is a vehicle part only when `carmods.dat`'s `mods` line names its
model, and a name claimed by two buckets stays in `map`. Both halves fail on the same data:

- `slamvan.txd` is claimed by `vehicles.ide` AND by the `veh_mods.ide` rows of `bnt_lr_slv1`/`2` — the two
  stock parts no shop offers, so they are on no `mods` line, so they claim the MAP bucket and the dictionary
  is contested into `gta3.img`. It is the **same false premise 014 disproved this morning**: a car's parts
  are not the parts on its `mods` line (22 mirrored parts game-wide are on none).
- A paintjob dictionary (`blade1.txd`) is named by no IDE row at all, so all 36 of them stay behind.

**Measured before writing this:** under the new rule, dictionaries claimed by both a vehicle file and
something else in the whole stock tree = **0**. There is nothing to contest.

## What is broken today, measured on the built `sa` tree

| | |
| --- | --- |
| names living in two archives | **45** — 39 of them ours, on top of a stock baseline of 6 |
| the stock baseline (accepted, not a defect) | `changeme.txd`, `kbmiscfrn1.txd`, `barrier.txd`, `lawest1.txd` (gta3 + gta_int), `coach.dff`, `coach.txd` (gta3 + player) |
| of ours: paintjob dictionaries | **34** across 12 cars — those cars wear STOCK paintjobs, silently |
| of ours: a car's base dictionary | **1** — `slamvan.txd`, the visible one |
| of ours: tuning-part models | **3** — `bnt_lr_slv1.dff`, `bnt_lr_slv2.dff`, `coach.dff` |

Stock paintjob dictionaries, for the record: **36 across 13 cars** — 11 cars with 3, `broadway` with 2,
`camper` with 1.

## Steps

### 1 — The claim set is the vehicle TABLES, not `carmods.dat` — **DONE 2026-08-20**

`claimsFromIde` gets its vehicle-part answer from the file a row is IN: every row of `vehicles.ide` and of
`veh_mods.ide` claims its model and its dictionary for `vehicles`. `vehiclePartsFromCarmods` goes.
**Verify**: 0 contested dictionaries over the stock tree; `slamvan.txd`, `bnt_lr_slv1/2.dff` land in the
vehicle bucket; the classifier's own unclaimed/contested counts are reported before and after.

**Measured** over stock `game-src/original` (16 316 entries, 212 cars), the old numbers produced by running
the code that was actually shipping rather than a reconstruction of it:

| | before | after |
| --- | ---: | ---: |
| contested dictionaries | **1** — `slamvan.txd` | **0** |
| unclaimed entries | 952 | **916** |
| entries in the vehicle bucket | 613 | **654** |

The blind spot was narrower than the plan first said and no less fatal: the old rule DID catch a mirrored
part (`vehiclePartsFromCarmods` reads `link` pairs and `wheel` rows too, not only `mods`), so the only
models it missed were `bnt_lr_slv1`/`2` — the two stock parts no shop offers, on no line of any section.
Two rows, one contested dictionary, one car with no textures.

### 2 — A paintjob dictionary belongs to its car, by name — **DONE 2026-08-20**

`<car><n>.txd` for every car in `vehicles.ide` is a vehicle claim — derived from the car list and the
archive's own entry names, no table. **Verify**: all 36 stock paintjob dictionaries move; the 13 cars are
the ones listed above; nothing whose base name is not a car is dragged along.

**Measured**: 36 of 36 in the vehicle bucket, where the old rule left **all 36** behind as unclaimed. The
name rule is anchored on both ends (`^([^.]*[^.\d])\d+\.txd$` against the roster), so `lae2_roads17.txd`
is not read as a paintjob of a car called `lae2_roads`.

### 3 — The guard: one name, one archive — **DONE 2026-08-20**

A built tree is refused when a name lives in two of its archives, naming both archives and both sizes,
against the **stock baseline of 6** (which is a fact about the original game and stays allowed). The class is
silent by nature — every file valid, every archive registered, and one car quietly wearing another's
textures — so the guard is what says the fix held.
**Verify**: it fires on today's tree with 39 and is silent on the rebuilt one.

**Built** as `assertOneOwnerPerEntry`, in the `sa` branch beside the id-pool and archive-slot gates, reading
archive directories rather than buffering gigabytes.

**Its scope is `gta3.img` and what came OUT of it** — the user's correction, and it is the right one. The
first shape allowed any duplicate the stock game ships, BY NAME, and that would have let one of ours ride in
under a stock exemption: the six stock duplicates are not what they look like. Four are map/interior
dictionaries repeated between `gta3.img` and `gta_int.img`. The other two are `coach.dff`/`coach.txd` in
`player.img` — the CLOTHES archive, whose `coach.txd` holds a single 256×256 texture called `coach`,
nothing to do with the bus of that name (`coach92wheel64`, `coach92interior128`) in `gta3.img`. **And we
ship a coach mod**, so under a by-name baseline the mod's bus and the stock clothing texture would have
passed as "stock". Scoped to the archives this build decides the contents of — `gta3.img` plus the ones the
source tree does not have — the expected number is 0, with no exemptions at all.

### 4 — A mod owns its slot's paintjobs — **DONE 2026-08-20**

**The user's rule, and it needs nothing recovered:** a car's dictionary and its paintjob dictionaries are one
bundle, found by the `<car><n>` convention off the car's own name and named by nothing else. A mod that
replaces the car replaces the bundle — so `pruneReplacedSlotTextures` drops `<slot>.txd` and every
`<slot><n>.txd` the folder does not itself ship, a moment before the folder's own files are staged over the
names it does. A folder that ships no `.txd` for the slot does not own its textures and is left alone: taking
the stock dictionary from it would leave its car with none at all.

Safe to delete by name because of two measurements over stock `vehicles.ide`: **no two cars share a
dictionary, and no car's dictionary is named anything but its own slot** (0 and 0 of 212).

**Measured on the real fleet: it drops nothing today.** Of 212 folders, 49 ship numbered dictionaries, and
every stock paintjob dictionary of the 13 tunable cars is replaced by the mod that owns the slot — several
ship MORE than stock (`slamvan` 5 against 3, `broadway` 5 against 2). **Stock paintjobs a mod does not
replace: 0.** So this is the door closed before anyone walks through it, and the log line is there for the
day one does.

**A mod shipping FEWER paintjobs than stock is not a problem — the user's field answer, 2026-08-20.** The
plan had left that open on a wrong reading of FLA's `Make paintjobs work for any ID`, which does not lift a
per-id COUNT for stock cars at all: it lets an ADDED car — a new model id — have paintjobs. Nothing here
waits on anything.

### 5 — `add-vehicles` needs nothing, and that is worth checking — **DONE 2026-08-20**

An added car has no stock twin and its models go LOOSE into `modloader/added-vehicles/`, so it cannot shadow
anything. **Verify**: after 1–3, the duplicate count over a full build is the stock 6 with the added fleet
installed.

**Measured on the finished tree, 115 added cars and their 46 parts installed: 6 duplicate names, all six the
original's own.** Nothing the added fleet ships reaches an archive, so there was nothing to fix and now
there is a number saying so.

### 6 — a car is not split across two archives

**The user's call, 2026-08-20: not a correctness requirement, a diagnosability one.** Today
`writeImgFamily` places entries greedily one at a time and starts a sibling wherever the cap falls, so
**148 of 201 cars have their `.dff` in `vehicles.img` and their `.txd` in `vehicles2.img`**. Nothing breaks —
the game resolves by name across archives — but every question of the form "where does this car live" gets
two answers, and this morning's diagnosis spent its first minutes ruling that out as the cause.

So the writer takes an optional grouping: entries sharing a key are placed together, and a group that does
not fit starts the next sibling instead of straddling. The key is the car slot, derived from the entry name
against the vehicle tables (`<car>.dff`, `<car>.txd`, `<car><n>.txd`, and a part's model + its dictionary,
which after step 1 is the car's own). A single group larger than the cap still has to split, and says so.
**Verify**: cars whose files land in two archives 148 → 0; the archive count does not grow (today 2 for the
vehicle family); the family stays stable for a given input.

**Built 2026-08-20**: `writeImgFamily` takes an optional `keyOf`, and `vehicleCohortKey` answers it from the
built tree's own tables — the car names from `vehicles.ide`, a part by the car its `veh_mods.ide` TXD column
names, a paintjob by the `<car><n>.txd` convention. A cohort larger than a whole archive still splits and
says so, because writing a file past the cap is the one thing the writer may not do.

## Docs to update in the same change

- `docs/architecture/img-archive-layout.md` — the bucket rule: the FILE wins over the section for the two
  vehicle tables, and paintjob dictionaries are claimed by name. **DONE**
- `docs/contracts/vehicles.md` — that a slot's paintjob dictionaries are the mod's to ship (step 4).
- `docs/gta-sa-original/vehicle-paintjobs.md` — what a paintjob is made of and what the FLA setting really does.
- `docs/restrictions/assets-and-data.md` — one name, one archive, and the stock baseline that is not a defect.
- The open issue → `fixed/` with the before/after.

## Measured

Rebuilt end to end 2026-08-20 (11 m 9 s, every gate green), then read back off the tree:

| | before | after |
| --- | ---: | ---: |
| duplicate names in the built tree | **45** (39 ours) | **6, none of them ours** |
| names held twice among the archives the split owns | 39 | **0** |
| cars wearing stock paintjobs | **12** | **0** — every `<car><n>.txd` is the mod's, in the vehicle archive |
| cars with no textures at all | **1** (`slamvan`) | **0** — `slamvan.txd` has one owner, and it is the mod's 9 359 360 B copy |
| cars split across two archives | **148** of 201 | **0** of 209 keyed |
| archives in the vehicle family | 2 | 2 (unchanged) |
| stock paintjob dictionaries a mod leaves behind | 0 | **0** — the prune is a closed door, not a fix |

The six that remain are the original's own and out of scope by construction: four map/interior dictionaries
between `gta3.img` and `gta_int.img`, and `coach.dff`/`coach.txd` between `player.img` (the clothes, 264 192 B)
and the vehicle archive (the mod's bus, 15 419 392 B) — one name, two unrelated things, and the game reads
the clothing one through the clothes system rather than by streaming name.

**Field-confirmed 2026-08-20**: the user played the delivered build and reported it good, the slamvan included.
