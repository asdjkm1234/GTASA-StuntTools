# Session 29 — a hundred and fifteen cars that were never there

**2026-08-19, after session 28.** Nine plans built in one run: `vehicle-installer` 012–013,
`tools/add-vehicles` 001–007, `asi/perfect-vehicle` 001–002 — the whole of central plan
[102](../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md). What changed, what it cost, what it bought, and the four defects
that fell out of it.

## What changed

| | |
| --- | --- |
| new tool | `tools/add-vehicles` — added cars (new model ids) into a built `sa` tree |
| new plugin | `asi/perfect-vehicle` — the `carmods.dat` link array, 30 → 256 |
| `vehicle-installer` gained | the ModelVariations merge, the `.fxt` writer, the FLA audio row, the Parked Maker row, the carmods ceilings guard, an id and a part-rename option on `applyVehicle` |
| `tool-kit` gained | `free-ids.ts` (the allocator + the tree's used ids), `parseVehicleBases`, `reserved/` |
| pipeline | the added cars are installed INSIDE the `sa` branch, on the finished tree, after the plugin ships and before the budget guards |
| where the rows go | `modloader/added-vehicles/<slot>.settings.txt` for the ide + handling pair, everything else baked — **changed by the field, see below** |
| commits | 19, all on `main`, not pushed |

## What it cost

The whole fleet installs in **6.6 s** onto a clone of `build/original/sa` and a second run is byte-identical
across every file it writes. The build-time cost of the stage is therefore that plus what it adds to the
tree:

| budget | before | after | ceiling |
| --- | --- | --- | --- |
| model ids | — | **161** (115 cars + 46 parts), 19 001–19 161 | 999 in the window |
| FLA `TXD` pool | 5 177 | **5 338** | 6 000 configured |
| FLA `DFF` pool | 15 596 | **15 711** | its 20 000 range |
| vehicles archive family | 3.10 GB, 2 members | **unchanged** — the models go loose (below) | 8 registered archives, and the tree already spends 6 |
| `carcols.dat` palette | 140 | **145** | 256 (raised from 128 this session) |
| `carmods.dat` link pairs | 23 | **31** | 256 (lifted this session; was 30) |
| `carmods.dat` parts per car | 15 | **15** | 16 — NOT lifted, and the guard says so |

**The archive road did not survive contact with the build.** Staging the models into the vehicles archive
family grew it from two members to three, and the `sa` build then stopped at `assertArchiveSlots`: SA
registers 8 IMG archives, the tree already spends six on stock content, and this wanted a ninth. That is the
in-reserve trigger written down on 2026-08-15, fired by exactly the case its own text predicted ("the vehicle
payload growing past two files … one large mod set away"). **The user's call: put the models in
`modloader/added-vehicles/` instead** — loose, 161 dffs + 161 txds, 1.4 GB, which is the road his earlier
build shipped these same cars by and the road the install already runs `modloader.asi` for. The family went
back to two members, the tree to 8 of 8, and the second `sa` build passed end to end.

What that answer costs is stated in `loose-files.ts` rather than left to be discovered: a loose TXD still
takes a streaming id at runtime while `checkImgIdBudgets` counts ARCHIVE entries, so the FLA TXD pool is
under-counted by the 161 files that land there (the guard reported 5 177 of 6 000 both before and after the
fleet — the same number is the tell). The in-reserve card stays live: the next thing that wants a ninth
archive gets no such escape.

A working method worth keeping: **`cp -Rc` clones the 5.7 GB build tree instantly on APFS**, so every one of
these runs was against a real tree and none of them touched the one the field uses.

## What it bought

115 cars that the game has no reference to anywhere — no `cargrp` row, no car generator, no mission — now
have everything a stock slot gets for free, and every bit of it is DERIVED from the built tree rather than
authored per car (the user's earlier tool carried a hand-written table per car; this one has none):

- an id from a window measured against the tree, pinned by a ledger because parked cars and variations land
  in the SAVE;
- a name (`cleo/cleo_text/<slot>.fxt`, 106 of them — the 9 train carriages whose gameName is a stock key deliberately
  get none, or they would rename the stock train);
- a sound (111 of the 115 inherit their base's row, retargeted; 4 ship their own);
- a place in traffic (101 base sections) and a parked spot;
- their base's tuning parts re-modelled under derived names, with the IDE row, shop item, price and mirror
  link cloned — 46 parts across 5 cars;
- tuned traffic for the whole fleet, stock cars included (103 sections).

## The four defects, all of them silent

This is the part worth re-reading. None of these was the thing being worked on; each was found because
something downstream refused to be idempotent or refused to install.

1. **`handling.cfg` refused a digit-leading id.** `parseHandling`, `mergeHandling` and `stripHandling` all
   took "a car row starts with a letter" as the rule. An added car's handling id IS its slot (`001VEH`), so
   the whole block was dropped and the car would have run stock physics — with one warning that named the
   line and not the reason. The game only reads the first character to spot `;` and the punctuation-marked
   sub-tables; the rule is one shared `isHandlingCarLine` now.
2. **The palette merge was not idempotent, and it was walking a fixed table.** `addPaletteColors` appended a
   mod's custom colours on every run: the shipping build carries three colours twice because of it. The
   table is 128 rows and the build was at 140 — [the measurement](../gta-sa-original/vehicle-colour-table-128.md),
   and `Vehicle colors = 256` in the FLA ini since (the user's call).
3. **`petro` and `towtruck` lost their trailers** the first time traffic was written. Each is the base of an
   added car AND authors `Global=Trailers1`; writing the key outright left `Trailers1` defined and referenced
   by nothing. `Global` is extended now, never rewritten.
4. **A failed run renumbered the fleet on retry.** The ceilings are checked after every row is merged, so a
   refusal leaves the ide rows and no ledger — and the next run would have seen those ids as taken by
   strangers. The tree is the ledger's fallback now.

There is a shape here: **every one of the four was found by asking the same question — "does running it
twice change anything?"** Three of them were pre-existing and would have kept drifting.

## What the chain decided against its own plan

- **The derived part name is the whole stock name plus `_<slot>`**, not a rebuild from a prefix table. The
  set of prefixes `SetupVehicleUpgradeFlags` switches on is documented with a trailing "…", so appending
  keeps every rule matching whatever it really is. The fleet's longest name lands on exactly the 19-character
  ceiling.
- **One ModelVariations section per model, keyed by name.** The user's earlier tool wrote the tuning keys
  into `[voodoo]` and the variation list into `[412]` — the same model twice, and whichever the plugin reads
  last wins. Not field-proven yet; it is a row in the field round.
- **The added cars are installed inside the `sa` branch**, not as a common-chain stage. That is `procobj`'s
  placement for content belonging to one target, and it is also what puts the plugin in the tree before the
  guard that reads its ceiling.
- **`reserved/` is a reserved NAME, not a stray.** The plan said refuse it; the folder holds a car the author
  set aside on purpose, and a refusal there stops every tool that reads the root.

## The evening the cars would not load

The chain was "built" by mid-session. Then the tree was delivered to the bottle and the game did not start —
not a black screen, nothing. **Seven launches later** the design had changed, four of my own hypotheses were
dead, and the honest lesson is about method, not about SA.

**What it actually was**: an added car's `vehicles.ide` and `handling.cfg` rows may not be baked into
`data/`. Read from `default.dat` at boot, 115 of them kill the game before a window appears. The same rows in
`modloader/added-vehicles/<slot>.settings.txt` are merged by Mod Loader — whose own documentation says it
matches data lines by SHAPE out of any text file, `cars` rows included. The fleet then loads and a parked
added car appears.

**And the trap that ate most of the launches**: a file NAMED after a stock data file is a REPLACEMENT to Mod
Loader. `vehicles.ide` in the mod folder silently deleted the stock 212 cars (the game then died on a null
model info for `admiral` deep in `carmods.dat`); `handling.cfg` deleted every stock handling line
(`LANDSTAL ... cannot be found`). A `.txt` extension is not enough either — a name it KNOWS is a data file,
anything else is a "readme" it scans. All of that is now
[`docs/gta-sa-original/modloader-data-files.md`](../gta-sa-original/modloader-data-files.md).

### What I got wrong, in order

1. **I trusted `NO_COMMIT/1/build` as a working reference — twice.** It has no `modloader.log` (never
   launched) and not one added-car row in `vehicles.ide` or `handling.cfg` anywhere in it. Those cars could
   not have loaded from that tree. I used it to justify shapes and to explain "what worked before"; it was
   evidence for the files it really does regenerate (carmods, veh_mods, shopping, MV, audio, parked) and for
   nothing else. Recorded at the top of `recon.md` now.
2. **I changed the user's install configuration on a hypothesis, twice.** `Vehicle colors = 256` (his own
   history said the palette had always run at 140 without it — he was right) and `Vehicle Models = 400`
   while OLA already had `VehicleModels = unlimited`; the second BROKE the game outright, leaving
   `CModelInfo::AddVehicleModel` reading a zeroed vtable at the stock store address. Both reverted, both
   recorded.
3. **I left a variable in during a bisect.** Test 5's setting was still on for test 6, so a run meant to
   isolate one thing carried two. Caught it from the dump, said so, redid it.
4. **I reasoned from ceilings instead of from evidence.** Three plausible fixed-size arrays were suspected
   and priced (vehicle model store, train tables, colour table) before the first crash dump existed. The
   dump — once `logs/` was recreated, which the delivery had deleted — pointed somewhere else entirely
   within one launch.

### What actually worked as method

- **Recreating `logs/`.** A delivery of the tree ROOT deletes what the tree lacks, and CrashInfo writes
  there. No dump, no diagnosis: the first four launches produced nothing but "it does not start".
- **Reading the crash address in the exe.** Every dump was disassembled rather than guessed at
  (`CModelInfo::AddVehicleModel` at `0x4C6770`, the `wheel` case of `LoadVehicleUpgrades` at `0x5B6B2F`,
  `CPickups` at `0x9788C4`), and each one named its own function within minutes.
- **Reading the third-party mod's own documentation.** The answer was one footnote in
  `modloader/.data/plugins/gta3/std.data.md`, shipped inside the mod folder we already carry.
- **The user's memory of his own install.** "It worked before, the difference is that we baked it" was worth
  more than every ceiling I had lined up.

### Where it stands

The cars load. **The tuning does not** — a corrupted pointer at the end of loading, ModelVariations excluded
by a byte-identical repeat, `CShopping`'s fixed arrays the standing suspect, the next test armed:
[`docs/open-issues/fixed/added-cars-crash-after-loading.md`](../open-issues/fixed/added-cars-crash-after-loading.md).

## What is NOT done

**The field round.** Sixteen rows in [field-checks.md](../../tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md), collected
rather than run one at a time (the user's call). It includes the riskiest delivery of the session — a plugin
that rewrites two functions of the exe — with the row that matters most being "then take the plugin away
again".

**`PV_FIX_UPGRADES`**, the per-car array. Its RE is complete (7 sites, the sidecar shape decided); the patch
is not written because nothing needs it, and the guard says that rather than implying the plugin covers it.

**The benchmark half of this audit.** No runtime number moved that anyone has measured: the fleet is content,
not a code path, and what it costs the frame is a field question.
