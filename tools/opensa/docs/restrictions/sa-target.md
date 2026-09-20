# Real-SA target restrictions

The `sa/` target runs inside a 2004 engine with fixed pools and no bounds checks. **Any plan that adds map
placements, archive entries or IPL files has to be budgeted against these ceilings before it is written** —
not because the build might fail, but because it might NOT fail and corrupt the heap instead.

The measured numbers live in [`edge-cases/sa-runtime-limits.md`](../edge-cases/sa-runtime-limits.md) and
[`edge-cases/sa-formats.md`](../edge-cases/sa-formats.md). This page is the planning gate over them.

## Budget first — and against the TARGET's numbers, not stock's

**The `sa` target always runs OLA + FLA + our own `perfect-map.asi`, and a stock 1.0 is not a configuration
we build for** (the user's call, reaffirmed 2026-08-09). So the useful column is the third one:

> **Since 2026-08-14 the converted CUTSCENE fleet also depends on `perfect-cutscene.asi`, and the failure is
> SILENT.** Cutscene cars ship window glass on every slot again (the pane-suppression hack is retired). A
> rendered pane z-writes, and without the plugin's deferral the scenes that lose the sector-scan roulette
> erase their own actors — the build succeeds, the scene plays, and a ped simply is not there. Anything that
> ships `models/cutscene.img` has to ship the plugin with it; anything that A/Bs the fleet has to say which
> side had the plugin.
>
> **pmb satisfies this itself since 2026-08-15** (plan 001 step 7): a `sa` build that ran the cutscene stage
> writes `perfect-cutscene.asi` into the game root and hashes it into `report-sa.json`, so the target runs
> OLA + FLA + perfect-map + perfect-cutscene. It is now only a rule for anything OUTSIDE pmb that delivers a
> fleet — a hand-dropped `cutscene.img`, the standalone app, a bottle install.


> **A design may add at most TWO `models/*.img` archives before it needs an ASI.** `CStreaming::ms_files`
> holds **8** (derived from gta-reversed: `0x8E4A58 − 0x8E48D8 = 0x180` over a `0x30` struct), the target
> spends 6 of them — gta3 / gta_int / player hardcoded, plus stock `gta.dat`'s CARREC, SCRIPT and CUTSCENE —
> and **nothing in this install lifts it** (FLA patches ID pools, not the archive count). Measurement and the
> derivation: [`gta-sa-original/reference-install.md`](../gta-sa-original/reference-install.md).
> **Caught: no.** Past the eighth the game crashes at load, so it is a boot-time death with no build-side
> warning — the same shape as exhausting an FLA pool.

| Ceiling | Stock | **On the target** | What overflowing does |
| --- | --- | --- | --- |
| Permanent text-IPL rows, map-wide | 32,767 (int16) | **lifted — `perfect-map.asi` patch #1** (the install runs 72,914) | `CIplStore::IncludeEntity` truncates building-pool indexes to int16; past 2^15 it corrupts stream-out ranges (the "ghost barriers" family) |
| Text IPLs carrying `inst` rows | 39/40 slots | **NOT lifted in practice — treat 40 as REAL** (2026-08-10, field) | `IplEntityIndexArrays` is written past without a bounds check |
| Rows per text IPL + its boot streams | 4,096 | **lifted — OLA `EntitiesPerIpl = unlimited`** (runs a 9,627-row file) | `gpLoadedBuildings` static array is written past → trashed statics |
| `CPool<CBuilding>` | 13,000 | **`Buildings = 150000`** (OLA) — raised 2026-08-10 for the permanent-row clutter layer, which took map-wide rows to **110 055**; verified in the install, not assumed | pool exhaustion at load — the `0x005381A5` crash was this pool at exactly 100 000 |
| `CPool<CDummy>` — an `inst` row whose model is in `object.dat` | 2,500 | **`Dummys = 100000`** (OLA) — raised from 50 000 in the field 2026-08-19. **Stock holds 59 of these permanently; our build holds 17 644**, 17 311 of them the procobj bake | the TWIN of the row above, at `0x00538103` — the pool allocator returns null and `LoadObjectInstance` dereferences it. **Caught since 2026-08-19** — `checkEntityPoolBudgets` splits every row by `object.dat` the way the game does, reads the pool off the OLA ini the build ships, and gates on the PERMANENT rows (the streamed half is reported, never budgeted — stock's own binary IPLs hold 25 624 building rows against a 13 000 pool). **What it does NOT catch**: the first entry's peak OCCUPANCY, which is not a row count — see the next row (40 000 passes the gate and crashes during the first entry) |
| **`IplDef.firstDummy/lastDummy`** — the range `RemoveIpl` frees dummies by | **32,767 (int16)** | **LIFTED 2026-08-19** — `perfect-map.asi` [plan 011](../../asi/perfect-map/docs/plans/011-ipldef-dummy-range.md): the same int32 sidecar as the building pair, two detours over `RemoveIpl`'s dummy pass (overlaid on FLA's jmps, as 004's are) | before the lift a dummy at pool index > 32 767 was never freed and the pool bought `floor(Dummys / 17644)` world entries per boot (field: 50 000 died on the 3rd, 100 000 on the 6th). **Now**: 8 entries at 100 000 and 5 at 50 000, the pool's high-water frozen after the first entry ([fixed issue](../open-issues/fixed/sa-load-game-crash-dummy-pool.md)). **Still a gate**: `Dummys` must cover the FIRST entry's peak, which is [40 960, 49 151] on this build against 33 043 map rows — the boot places more dummies than the map has rows, so the pmb guard (permanent rows only) does NOT catch a `Dummys` below that peak: 40 000 crashed during the first entry, at the same `0x00538103`. **Caught since 2026-08-20** — `assertDummyPoolCoversFirstEntry` refuses a shipped OLA ini under the measured peak (49 151) and warns between it and the recorded 100 000, after a delivery of the built tree put 50 000 back over a bottle raised by hand and nothing said a word. What it still cannot do is DERIVE the peak: it is a field number for a map this size |
| **FLA ID pools** | 5000/255/256 | **TXD 6000 / COL 400 / IPL 1024 — REAL, not `unlimited`; raised in the ini 2026-08-10** | heap corruption during data load — the crash lands right after `shopping.dat` |
| A DFF's frame list ORDER | a parent must precede its child | **unchanged — nothing lifts this** | RenderWare parents each frame in the pass that creates it, so a forward parent index reads an unwritten slot: crash in `RwFrameAddChild` (`0x007F0BF7`) or silent corruption, decided by leftover memory. **Caught for VEHICLES since 2026-08-19** — `stageVehicleImg` reorders and reports it. **NOT caught for map mods**: mod-installer has no such check, byte-faithful conversion ships a mod's file as authored, and OpenSA's own reader is index-based so it never notices ([the fact](../gta-sa-original/rw-frame-list-parent-order.md)) |
| **`carmods.dat` `link` pairs** — `CLinkedUpgradeList` arrays | **30, game-wide** | **LIFTED to 256 — `asi/perfect-vehicle` plan 002** (both accessors replaced over our own storage; no adjuster has a setting for it). Not field-confirmed yet | the 31st pair writes past the arrays (into `m_nLinksCount` and on) — silent static corruption. Stock uses 23, every added car that re-models its base's wings costs 1. **Caught: YES since 2026-08-19** — `assertCarmodsCeilings` (vehicle-installer, on every install/rebake path) reads the tree: 256 with `perfect-vehicle.asi` in it, 30 without, and the refusal names the plugin and the offending pair. **The added fleet needs 31, so it needs the plugin** ([measurement](../gta-sa-original/carmods-upgrade-ceilings.md)) |
| **Parts on one car's carmods line** — `CVehicleModelInfo::m_anUpgrades[18]` | **16 listed** (+`hydralics`+`stereo` appended always) | **unchanged — RE done (`perfect-vehicle` plan 001, 7 sites, sidecar shape decided), patch NOT built: nothing needs it** | the 17th part overruns the per-car array into the model info's next fields. Stock `jester` is full at 16. **Caught: YES since 2026-08-19** — the same guard counts every car's line, replacements included (the fleet's worst is 15) |
| **Vehicle colour palette** — `carcols.dat`'s `col` section into `CVehicleModelInfo::ms_vehicleColourTable` | **128** (FLA's stated default) | **leave the adjuster ALONE — raising it is what breaks.** `Vehicle colors = 256` was set on an inference 2026-08-19 and crashed this install at the end of loading, every run; commented back out, 142 rows load and play ([the issue](../open-issues/fixed/added-cars-crash-after-loading.md)). If headroom is ever genuinely needed, try **255** — over 255 pulls in FLA's uint32 colour-id patch family, which is the thing that breaks | past the table the loader writes into whatever follows it. Stock ships 127, so a mod set has 1 row of headroom before it is over — and the build has been running 15 rows past it with no observed symptom, so the 128 is FLA's annotation, not a watched ceiling. **Caught: WARNED, not refused** — `vehicleColourWarnings` prints the count on every install/rebake path. **Its warning is not an instruction to reconfigure the install** ([measurement](../gta-sa-original/vehicle-colour-table-128.md)) |
| **Car generators** — `CCarGenerator` array (FLA's `Car generators`, `CCarGenerator_extended` once `Accept any ID for car generator = 1`) | **500** (the install leaves the setting commented; FLA's log says it applies 500) | **500 — unchanged** | a permanent row (a `cleo/Parked Car Maker.ini` `[Cars]` entry, created through CLEO) holds its slot for the whole session, against a map that streams **1045** records in and out of the same array. Past the limit a generator is not registered — no crash, the car is simply never there. **Caught: PARTLY** — `vehicle-installer` refuses a tree whose parked rows ALONE reach the limit and logs the count every run, but the resident map peak has never been measured, so nothing catches the real starvation case ([measurement + the field test that would settle it](../gta-sa-original/car-generators-500-and-the-map-1045.md)) |
| **A tuning part's NAME** | prefix decides its component flags; ≤ 19 chars (IDE `sscanf` into `char[24]`, IMG name 24 bytes incl. `.dff`) | unchanged | a renamed part without its stock prefix loses its behaviour silently; a long name smashes the IDE loader's stack. **Caught: YES** — `tools/add-vehicles` appends `_<slot>` to the WHOLE stock name (so every prefix rule keeps matching, whatever the exact set is) and refuses > 19; the fleet's longest is exactly 19 |
| **Model id** | **≤ 18630** | **≤ 18630 — unchanged** | silently fails to load; "HD swapped but nothing changed" |

### The row that was WRONG, and it cost a crash (2026-08-10)

**`EntityIpl = unlimited` is set in the install's OLA ini and the game still died on the 40th inst-bearing
IPL.** The `sa` build shipped **75** of them at the time (46 `plobj` areas + stock); the game loaded 39 and
crashed on `plobj10.ipl`, which is **slot 40**. (The layer ships **10** areas since
[014](../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md), 39 map-wide — the numbers
below are the crash's, not today's.) Three independent lines agree: modloader's log ends at that file, the
crash stack carries the string `plobj10_`, and 40 is the documented size of `IplEntityIndexArrays`.

This row previously read "lifted", on the strength of the ini alone — and the reference install has only
**36** inst-bearing IPLs, so **nothing had ever exercised the setting**. A ceiling nobody has crossed is not
a ceiling anyone has lifted. **Design to ≤ 40 inst-bearing text IPLs until something proves otherwise in the
field**, and note the corollary for the shape of a placement layer: an area split that multiplies text IPLs
spends a scarce, hard resource, while rows inside one file are cheap
([ProperFixes ships 9 627 of them per file](../gta-sa-original/reference-install-config.md)). A text IPL with
**no** `inst` rows takes no slot.

**Where the build stands: 39 of the 39 usable slots** (2026-08-16) — 28 stock areas, 10 procobj areas, 1 tree
overflow. There is no margin. What holds it there is mod-installer's fold: a map pack's IPLs are appended
into the stock areas rather than registered as files of their own (`66. Urbanize only MAP` alone is 13 files
/ 16 172 rows, and costs zero slots this way), and the two stream-less stock inst blocks are compacted away.
A pack whose rows carry internal `lod` links cannot be folded and costs one slot per file
([mod-installer/013](../../tools/mod-installer/docs/plans/013-slot-fold-across-hosts.md)).

**The rule this table exists to enforce: do not design content down to a lifted ceiling, and do not add a
guard, cap or migration that shapes output to one.** Its mirror image, learnt the same day: **do not trust a
lift you have never exercised.** Both are answered the same way — by measuring the target, not by reading its
ini. Budgeting against a stock number the target does not
have silently under-builds, and it looks exactly like success. The bottom two rows are the ones that are
still real — those a plan must respect, and `checkImgIdBudgets` still FAILS the build on the FLA pools. **It
did, on the first `sa` build at the recovered procobj density** (2026-08-10: 522 binary IPL files of 280),
which is the row's proof that it is a gate and not a museum piece. The answer was to RAISE the pool in the
ini — a real ceiling is a number to move, not a reason to ship less content — and the same build showed the
opposite failure too: the guard's TXD limit had always read 6000 while the install's pool was 5000, so a
4999-archive build reported comfortable headroom while standing one slot short. **A guard number ABOVE the
install's is silent by construction — it can only fail to fire.** Since 2026-08-18 the guard does not carry
the numbers at all: `flaIdPools()` reads them off the adjuster ini the build SHIPS into the tree root, treats a
`#`-disabled line / an unapplied `Apply ID limit patch` / a missing ini as FLA's defaults (the strict
direction), and prints the file each ceiling came from. Read pool numbers the same way — from the ini in force
plus FLA's own log, never from a constant somebody once matched to a bottle.

**A pool raised in the FIELD must be raised in `mods-src` in the same change — the build SHIPS the ini — and
its value WRITTEN DOWN in `reference-install-config.md`, because `mods-src/` is gitignored and the doc is the
only committed copy.**
The adjuster is a mod (`mods-src/<game>/mods/sa/6. fastman92 limit adjuster 6.5 (stable)`), so its
`fastman92limitAdjuster_GTASA.ini` is a BUILD OUTPUT: it lands in the tree root and any delivery that copies
the root puts it in the install. The 2026-08-10 raise was made in the bottle only, the repo kept
`5000 / 280 / 256`, and the first delivery of a whole tree root (2026-08-18) silently reverted the target to
those numbers with 5 177 TXD archives in the build — a boot-time heap fault with no message naming any of it
([the write-up](../open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md)). **Nothing catches
this**: the guard compares against constants that happened to match the bottle, the build succeeds, and the
crash lands in an unrelated `free()` during a model read. One cheap check exists — FLA's log closes with
`Number of memory changes made`, which was **3632** against the working install's **3712**.

Where the numbers come from: [reference-install-config.md](../gta-sa-original/reference-install-config.md)
(verbatim ini capture) and [reference-install.md](../gta-sa-original/reference-install.md) (what it means for
a plan). Read that table rather than assuming a stock value.

**Caught:** the FLA pools and the model id, yes — on a `:sa` build only, since `checkImgIdBudgets` reads the
built `sa/` tree and an `--exclude sa` run never reaches it. Everything else in the table is not enforced
because it is not a limit here. **Designing down to a lifted ceiling is caught by nothing at all.**

## A ceiling is enforced on the branch whose target has it — never on the shared build

The rule for a new plan: **decide which target a ceiling belongs to, and put its guard on that branch.** A
shared-stage guard is not "safe by default" — it silently rations the target that does not have the limit,
and the build still succeeds, which is indistinguishable from success.

**Enforced since 2026-08-08** (07/04): the text-IPL check moved off the common baked build onto the `sa/`
branch, beside `checkImgIdBudgets`. Moving it also fixed a false PASS in the other direction: the sa LOD stage
appends hole-fill instances to the text IPLs *after* the split, so the shared-build count was never the count
SA loads.

**And on 2026-08-09 the other half of the rule landed: a guard for a ceiling the target LIFTED is not a guard
at all.** `checkTextIplBudgets` threw past an invented 30,000-row budget; after the procobj column fix the
layer alone costs 39,219 rows, so the condition was constant and the throw failed every `sa` build to ration
an install we never ship to. It is now `reportTextIplCensus` — rows, inst-bearing IPLs, census coverage, no
ceiling quoted — and the 30,000 budget, the 39-slot line and `--allow-text-row-overflow` are deleted with it.
Nothing had ever culled to fit that cap, so no content moved.

Two things neither move fixed, and both are live:

- `checkImgIdBudgets` reads the built `sa/` tree, so an opensa-only run never checks the FLA pools — a ceiling
  the target really HAS going unchecked on the common case;
- the `opensa/` branch has **no budget guard of its own**. SA's numbers reach no OpenSA code path (our engine
  reads a pak: no building pool, no int16 index, no `IplEntityIndexArrays`), and the streaming budget that
  should replace them has never been measured. The build ANNOUNCES the gap on every opensa run rather than
  leaving it silent, which is the most that can be said honestly until the measurement exists.

**Caught:** the enforcement half, yes. The unchecked half, no. Owned by
[07/04](../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md).

## In-game bisection of pool exhaustion gives false negatives

Removing ANY img entry can make the symptom disappear without the removed entry being the cause. Diagnose
pool exhaustion by COUNTING against the ini, never by bisecting in the field.

**Caught:** no — and the failure mode is a confident wrong answer.

## Only one limit adjuster may patch IPL/pool limits — but both may be INSTALLED

FLA and OLA patching the same zones crash in `LinkLods`. What the rule forbids is the overlap, not the
coexistence: the [reference install](../gta-sa-original/reference-install.md) runs **both**, and boots,
because FLA's entire `[IPL]` section is disabled and OLA owns those zones alone. So "which adjuster is
installed" is the wrong question — a plan that raises a limit has to name **which adjuster owns that
limit's zone**, and check the other one's ini is not also set for it.

**Caught:** no. And the failure is a boot crash with no attribution, so read both inis before blaming a
build.

## An exe address or expected byte is DECLARED ONCE, in the catalogue — never in the patch

Everything an `.asi` writes into the game is blind: there is no type system on the other side, and a byte that
is wrong by a nibble corrupts a running process. So the address, the expected original bytes and any
continuation the patch resumes at all come from the plugin's typed catalogue through its generated header
(`asi/sdk`, `asi::FindSite` / `asi::VerifySitesOrDefer`). A patch may NAME a site; it may not restate what is
at it. The same rule kills the near-miss shape: a trampoline's continuation must be DERIVED
(`entry + site->length`), because a literal silently desyncs the moment the catalogue's byte window changes.

**Caught:** partly, and only since 2026-08-06. The generator now rejects duplicate site names (a duplicate is
a `FindSite` key collision — the framework would hand a patch the wrong entry's bytes and verification could
not see it, because the site it picked really is pristine), and `asi/perfect-map/gen/generate.test.ts` asserts
that every name the payloads look up still exists in the catalogue and that the catalogue agrees with the
shared fingerprint wherever both name the same site. Nothing catches a hand-written address that merely
disagrees with the catalogue.

Before that it was **silent in the worst available way**: perfect-map's payloads carried seven hand-copied byte
arrays, and three of them — the `RemoveIpl` trampoline continuations — were verified ONLY inside the apply
path, so no dry run in the field could ever see them. The project's own architecture doc claimed "a hand-edited
address is structurally impossible" while the payloads had been doing exactly that since 004. Detail:
[`asi/sdk/docs/plans/004-shared-runtime-apis.md`](../../asi/sdk/docs/plans/004-shared-runtime-apis.md).

## opensa-lod-generator output is for OpenSA only

Uncapped per-cell LODs (hundreds of materials) are not loadable by real SA. The two LOD generators are not
interchangeable, and a plan may not "just reuse" the cell bake for the `sa/` target.

**Caught:** yes in practice — the real game will not load it.

## `gta.dat` is read top-down

An IDE line must precede the first IPL line that uses its ids, and an IDE id may not be defined twice — a
baked IDE redefining a stock id must strip the older definition. Binary IPL streams reference text rows **by
index**, so removing a row renumbers everything after it.

**Caught:** no — wrong or missing objects, no error.

## Range comes from a permanent row, never from a binary stream

`CIplStore` loads a binary stream's IPL slot only while the player is inside its bounding box grown by **190
units**, so an instance in a stream is not resident far enough to use a long draw distance at all. Our clutter
layer was declared at 290 and effectively capped at ~190 m for months because of it; the measurement is in
[`edge-cases/sa-runtime-limits.md`](../edge-cases/sa-runtime-limits.md).

The rule for a new design: **decide the mechanism by what you want from it.** Streams buy position streaming and
cost no permanent rows; a permanent text row buys unconditional residency, i.e. range, and costs one `CBuilding`.
A layer that wants to be seen at distance has to be permanent rows — which then puts it against the 40-slot array
and the building pool instead, and those are the numbers to budget.

**Caught:** no, and it is silent in the worst way — the objects are there, they draw, they just stop appearing at
a distance nobody wrote down. What surfaces it is a field observation of the pop-in radius, or reading
`IplStore.cpp`.
