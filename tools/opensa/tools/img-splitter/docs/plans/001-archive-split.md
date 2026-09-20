# 001 — Split `models/*.img` into typed, size-bounded archives

Give every kind of game content its own archive, and give the writer a ceiling it cannot cross, so no stage
ever produces a file the next stage cannot open. The design this implements is
[`docs/architecture/img-archive-layout.md`](../../../../docs/architecture/img-archive-layout.md); read it
first — the WHY is there, the HOW is here.

## Why now (measured 2026-08-15)

The `sa` build died mid-`vehicles` at 2 168 825 856 B. That specific failure is fixed (`a1a1217c`: one
archive open, one streamed write per run), and the fix exposed the real shape of the problem — the stage now
finishes in 6.13 s and emits **4 268 185 600 B**, which `readFileSync` refuses with `ERR_FS_FILE_TOO_LARGE`.
Numbers: [`benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md`](../../../../docs/benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md).

So the vehicles stage is unblocked and everything behind it is not: `sa-lod-generator` and
`opensa-lod-generator` open every `models/*.img` whole, and `vehicle-cutscene` reads `gta3.img` whole to
resolve txdp parents. **71 call sites across 53 files** read archives into one buffer.

This also parks `asi/perfect-cutscene` plan 001 step 7's field run, which needs a pipeline build that
completes.

## Steps

Every step ends with its verification; a step without recorded numbers is unfinished.

- [x] **0. The census, and the ceiling that decides the shape. DONE 2026-08-15.**
      **The archives, by extension**: `gta3.img` 16 316 entries — dff 12 964, txd 2 759, col 216, ipl 164,
      ifp 149, dat 64; `gta_int` 2 484; `player` 542; `cutscene` 634. **The IDE sections** that drive the
      classifier: `objs` 14 052, `peds` 276, `cars` 212, `tobj` 160, `2dfx` 97, `anim` 54, `weap` 50,
      `txdp` 38, `hier` 35.
      **`TOTAL_IMG_ARCHIVES` = 8, derived not remembered**: gta-reversed `Streaming.h` puts `ms_files` at
      `0x8E48D8` and the next static, `ms_bLoadingBigModel`, at `0x8E4A58` — `0x180` = 384 B over a
      `tStreamingFileDesc` the header size-asserts at `0x30` = 48 B. GTAMods corroborates the split (3
      hardcoded + 5 from `gta.dat`). The target spends **6** (gta3 / gta_int / player, plus stock `gta.dat`'s
      CARREC, SCRIPT, CUTSCENE) and **FLA does not lift it in this install** — its ini patches ID pools and
      handling; `IMG archive needs rebuilding` is error reporting, not a limit. Recorded in
      [`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md) and as
      a rule in [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md).
      **What that settles**: 2 free slots. Three wanted archives (`vehicles.img` + a spill sibling +
      `peds.img`) would need a lift — so the shipped shape drops the peds bucket and spends both slots on
      vehicles, which fits 8 of 8 exactly. The lift became a DEFERRED task with a named trigger rather than a
      certainty: [`in-reserve/img-archive-limit-lift.md`](../../../../docs/in-reserve/img-archive-limit-lift.md).
      **Dropped from this step** (the user's call, 2026-08-15): researching what the game does when one name
      exists in two registered archives. The layout is built so it cannot happen, so the right answer is a
      GUARD, not a fact — step 2 refuses a duplicate instead of relying on precedence.
- [x] **1. The classifier — pure, no I/O. DONE 2026-08-15.** `src/classify.ts`: `claimsFromIde` reads every
      model-declaring section (`cars` → vehicles, `peds` → peds, `weap` → weapons,
      `objs`/`tobj`/`anim`/`hier` → map) taking columns 1 and 2 as the model and its txd, and
      `classifyEntries` places each archive entry. `txdp` and `2dfx` claim nothing — one declares a texture
      PARENT, the other attaches to a model declared elsewhere. Tests 13/13, negative cases first.
      **Two corrections the user made during the step, both of which move a bucket onto better authored data:**
      1. **Mod-shop parts belong to the car, and `carmods.dat` is where the game says so.** They are authored
         as plain `objs` rows in `veh_mods.ide`, so section alone puts them in `map` — away from the car they
         bolt onto, and contesting the car's own dictionary. `vehiclePartsFromCarmods` reads all three of its
         sections (each hides the parts differently: `link` pairs two per row, `mods` leads with the CAR,
         `wheel` leads with a group index) and yields **190 part names**.
      2. **Weapons get their own bucket, from the `weap` IDE section — not from `weapon.dat`.** That file is
         the stats table and addresses a weapon by numeric `modelId`, so reading it would only resolve back
         through this section.

      **Verification, over the real stock tree** — all **16 316 `gta3.img` entries placed, none lost**:

      | Bucket | Entries | Bytes |
      | --- | --- | --- |
      | map | 15 073 | 832.1 MB |
      | peds | 530 | 55.6 MB |
      | vehicles | 613 | 50.5 MB |
      | weapons | 100 | 1.3 MB |

      **CONTESTED — 1**, down from 12 before `carmods.dat` was read. The eleven that resolved were the
      tunable cars, whose parts now sit with them. The one that remains, `slamvan.txd`, is an inconsistency
      in the STOCK data rather than in the classifier: `veh_mods.ide` declares `bnt_lr_slv1` and
      `bnt_lr_slv2` against it, and `carmods.dat`'s `slamvan` row lists neither — two bonnet models the mod
      shop never offers. It resolves to `map`, which is safe because the game finds an entry by name across
      every registered archive.
      **UNCLAIMED — 952**: `.txd` 284, `.col` 216, `.ipl` 164, `.ifp` 149, `.dff` 75, `.dat` 64. The
      non-model extensions are expected (no IDE row declares them). The 284 dictionaries are the generic ones
      (`gb_generic`, `gb_country`, `gb_la…` — reached through `txdp` parents rather than a model row) and the
      75 models are specials like `copgrl1`/`copgrl2`. All stay in `gta3.img`, which is where they are today.
- [x] **2. The splitter tool. DONE 2026-08-15.** `src/split.ts`: full passthrough copy of `--game`, then
      `gta3.img` is emitted as buckets, `gta.dat` gains an `IMG` line per new archive (after the last existing
      one, idempotent on a re-run), and `cutscene`/`player`/`gta_int` are left alone. Tests 24/24.
      **Two gates, and the first one had to be rewritten once it was tested.** `assertUniqueNames` compares
      the DIRECTORY's declared entry count against the distinct names the reader returns — the obvious version
      (walk the names looking for a repeat) is dead code, because `parseVer2Directory` keys a `Map` by name and
      has therefore already collapsed any duplicate, silently dropping one entry's bytes, before anything
      downstream can look. `assertArchiveSlots` refuses a tree registering more than the 8 the target's table
      holds, which turns a ceiling recorded as **"Caught: no"** into a build failure with the arithmetic in it.
      **Verification, on the real stock tree** (`game-src/original`, run 2026-08-15):

      | Archive | Entries | Bytes |
      | --- | --- | --- |
      | vehicles.img | 613 | 50.5 MB |
      | peds.img | 530 | 55.6 MB |
      | weapons.img | 100 | 1.3 MB |
      | gta3.img | 15 073 | 832.6 MB |

      **2.0 s** for the split itself. **Conservation holds exactly**: 16 316 entries in, 16 316 out, no name in
      two archives, and **0 entries differ — byte-identical to the source**. `gta.dat` ends with
      `CARREC | SCRIPT | CUTSCENE | VEHICLES | PEDS | WEAPONS`.
      **And the slot arithmetic is now demonstrated rather than argued**: `slots: {needed: 9, stock: 8}` — the
      run only completed because it was given `liftedArchiveLimit`, and that is with NO vehicle spill yet.
- [x] **3. The cap and the spill, in the shared writer. DONE 2026-08-15.** `tool-kit` gains
      `ARCHIVE_CAP_BYTES` (**1.75 GiB** — under Node's 2 GiB read wall with ~200 MB for the directory, sector
      padding and the next mod somebody installs) and `writeImgFamily`, which places entries greedily into
      `<stem>.img`, `<stem>2.img`, … and **deletes stale siblings a shorter run leaves behind** (a leftover
      would stay registered in `gta.dat` and serve superseded entries).
      Planning where the cap falls needs sizes, and getting them through `get` would read the whole staged mod
      set into memory — the cost `setFile` exists to avoid — so `EditableImg` gains **`size(name)`**: `stat`
      for a staged file, buffer length for one held in memory.
      vehicle-installer routes through it and now **derives WHICH archive it writes from the tree**: a split
      tree owns `models/vehicles.img` and that is where a car belongs; an unsplit one has only `gta3.img`. One
      installer, both shapes, and a mod car never lands in an archive the split moved its stock twin out of.
      **Verification, real set** (`game-src/original` split, then all 212 vehicles installed):

      | | Entries | Bytes | |
      | --- | --- | --- | --- |
      | `vehicles.img` | 458 | 1 872.6 MB | under cap |
      | `vehicles2.img` | 332 | 1 205.2 MB | under cap |

      Family size **2**, summing to 3 077.8 MB — the whole payload, nothing lost to the spill. Install 5.0 s,
      peak RSS 2.48 GB (down from 3.11 GB: the base archive is now 50.5 MB instead of the 1.24 GB map).
      Synthetic cases in `tool-kit`'s tests cover the sibling, the stale-sibling delete and the one-file case.
      Numbers: [`benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md`](../../../../docs/benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md).
      **Left open on purpose**: nothing registers `vehicles2.img` in `gta.dat` yet, and the installer WARNS
      when it writes a sibling rather than letting it be invisible content. That is step 4 — which also has to
      face the arithmetic this run makes concrete: the tree now wants **10** registered archives against 8.
- [x] **4. Wire it into pmb, before `mods`. DONE 2026-08-15.** A new first stage, excludable like the rest;
      `checkImgIdBudgets` enumerates archives instead of listing four names; the archive-table gate runs on the
      FINISHED `sa` tree (the total is only known after the vehicle install registers its sibling);
      `splitBuckets` defaults to `['vehicles']`.
      **Registration moved to whoever WRITES an archive** (`registerImgArchives`, now in `tool-kit/game-dir`):
      the split for its buckets, vehicle-installer for a spill sibling. An unregistered archive is invisible
      content, and this makes it impossible rather than warned about.
      **The first attempt FAILED at the cutscene stage, and the two causes split cleanly:**
      1. **Ours.** `vehicle-cutscene` opened `models/gta3.img` by name to resolve txdp parents, and the split
         had moved `dinghy.txd` into `vehicles.img`, `washing.txd`/`monster.txd`/`mtbike.txd` into
         `vehicles2.img`. Fixed by the index below.
      2. **NOT ours.** `cutscene template has no HAnim skeleton root (bone 0)` on ~19 slots. The same
         `cstaxi92.dff` parses from `game-src` and fails from the built tree: `cutscene.img` grows
         26 947 584 → 31 279 104 B in the `mods` stage, because a mod REPLACES cutscene models with rigs that
         carry no HAnim root. The converter reads its template from the installed archive. The user removed
         those mods; recorded here because the pipeline route is the only place it shows.
      **The index, and the manifest** (the user's call, 2026-08-15). `openLazyVer2` was promoted out of
      `opensa-pack` into `tool-kit/archive/layout` — it was the repo's one fd-backed reader — and
      `openArchiveIndex(gameDir)` builds a name → archive map from each archive's DIRECTORY. **That is the
      authority and it cannot go stale**; `writeArchiveManifest` writes `data/img-layout.json` as a REPORT for
      readers outside the build, saying so in the file. The first run proved the distinction the hard way: the
      shipped manifest described the tree as it had been at stage one, so a refresh on the finished tree is
      part of the sa branch now, carrying forward the fields it cannot recompute.
      **Verification — a full `sa` build, exit 0, 638.9 s.** split 1.6 s · mods 82.7 · vehicles 7.1 ·
      **cutscene 7.5 (23 converted, 0 skipped, 21 plates)** · peds 11.1 · optimize 78.7 · trees 82.4 · sa
      363.6 · procobj 4.2. Archives: `gta3` 16 990/1.64 GB, `vehicles` 458/1.87 GB, `vehicles2` 332/1.21 GB,
      `cutscene` 634/199.1 MB, `gta_int` 2 485, `player` 542. **`gta.dat` = 5 IMG lines + 3 hardcoded = 8 of
      8**, the stock table exactly full. Id pools with every archive counted: TXD 5171/6000, COL 263/400, IPL
      191/1024.
      Numbers: [`benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md`](../../../../docs/benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md).
      **A gap this run exposes**: `gta3.img` grew 889 MB → 1.64 GB across mods and the LOD stages and nothing
      caps it — `mod-installer` and the LOD generators do not write through `writeImgFamily`. 500 MB under the
      wall today, and silent if it were not.
- [x] **5. The field run. PASSED 2026-08-15 — the user: everything launched, no problems, and no ASI work.**
      The stock-fitting shape (peds and weapons left in `gta3.img`, both free slots spent on `vehicles.img` +
      its spill sibling) boots and plays.
      **What that verdict does NOT say, and it is the thing most likely to be misremembered:** it is not
      evidence that the archive ceiling is lifted on that install. The build registers **8 of 8** — we never
      reached it. From the outside a lifted ceiling and an unreached one are indistinguishable, and only one
      of them survives a ninth archive.
      **So the lift is deferred, not cancelled**, with its trigger written down and — the part that matters —
      enforced in code: `assertArchiveSlots` fails the build and names the card when a ninth archive appears,
      because past the eighth the game crashes at load with no symptom that points anywhere. The card is
      [`in-reserve/img-archive-limit-lift.md`](../../../../docs/in-reserve/img-archive-limit-lift.md); the
      facts it rests on stay in
      [`gta-sa-original/img-archive-limit.md`](../../../../docs/gta-sa-original/img-archive-limit.md).

## What this plan may not do

- **Do not shape content down to the ceiling.** The 2 GiB wall is Node's, not the game's and not VER2's
  (`project-goals.md` directive 2). Dropping the 362 865 928 B of extra numbered txds the game does not read
  today is a separate, arguable saving — it is not a fix, and it must not be smuggled in as one.
- **Do not classify from a name list in code.** The bucket derives from what the asset's IDE row says
  (`restrictions/assets-and-data.md`). A hard-coded roster is a slot rule wearing a data rule's clothes.
- **Do not let an archive be added without the id-pool guard learning it** (step 4). The FLA pools are global
  and real on the target.
