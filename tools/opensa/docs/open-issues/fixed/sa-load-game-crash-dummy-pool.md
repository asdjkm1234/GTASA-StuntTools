# Crash on LOAD GAME: the dummy pool fills up and `RemoveIpl` cannot empty it

> **FIXED 2026-08-19** — `perfect-map.asi` [plan 011](../../../asi/perfect-map/docs/plans/011-ipldef-dummy-range.md)
> lifted the int16 `IplDef.firstDummy/lastDummy` pair the way 004 lifted the building pair (int32 sidecar, two
> detours over `RemoveIpl`'s dummy pass, overlaid on FLA's jmps). Field ladder: 8 world entries at
> `Dummys = 100000` (the 6th used to die) and 5 at 50 000 (the 3rd used to die), the pool's high-water frozen at
> the first entry's 40 960 instead of climbing 17 644 per entry. What the ladder ALSO measured: the first entry
> alone occupies [40 960, 49 151] slots against 33 043 map rows — `Dummys = 40000` crashes during it — so the
> value stays 100 000 and the pmb guard's permanent-only gate is known not to see that peak
> (`docs/restrictions/sa-target.md`). The forensics below are kept as written.

**Field 2026-08-19.** Symptom: the game boots and plays fine; loading a save works; loading a **second**
time crashes. Cause found the same day, and the field's own workaround confirms it. **Not fixed** — the
workaround moves the wall, it does not remove it.

## The crash itself — proven, not inferred

`logs/gta_sa.exe_2026-08-18_21-12-24.log`:

```
Unhandled exception at 0x00538103 in gta_sa.exe (+0x138103): 0xC0000005: Access violation reading location 0x00000000.
    ESI: 0x00000000
```

`0x538090` is `CFileLoader::LoadObjectInstance`. Disassembled out of the install's own `gta_sa.exe`:

```
5380db  cmpw  %bx, 0x10(%ebp)   ; mi->m_nObjectInfoIndex == -1 ?
5380df  je    0x538146          ;   -1 → the CBuilding branch
5380e1  pushl $0x38             ;   else: operator new(56) — sizeof(CDummyObject)
5380e3  calll 0x5326e0          ;   the pool allocator
5380ef  cmpl  %esi, %eax        ;   returned NULL?  (esi = 0)
5380f5  je    0x538100          ;   YES → jump PAST the constructor, esi stays 0
538100  movl  0x1c(%edi), %eax
538103  movl  (%esi), %edx      ;   <-- read through the null it just accepted
```

`CPool<CDummy>` was empty, the allocator returned null, and SA used it without a check. Nothing subtle:
the exhaustion is the whole story, and the register dump matches term for term.

## Why it is OUR crash and not a 2004 one

Every `inst` row of a tree, split by whether the model has an `object.dat` entry (that is exactly the
`m_nObjectInfoIndex == -1` branch above — a dynamic object becomes a `CDummyObject`, everything else a
`CBuilding`):

| | rows | → `CPool<CBuilding>` | → `CPool<CDummy>` |
| --- | ---: | ---: | ---: |
| **stock SA**, text IPLs (permanent) | 9 268 | 9 209 | **59** |
| stock SA, binary IPLs (streamed) | 41 667 | 25 624 | 16 043 |
| **our `sa` build**, text IPLs (permanent) | 127 384 | 109 740 | **17 644** |
| our `sa` build, binary IPLs (streamed) | 40 200 | 24 801 | 15 399 |

**Stock holds 59 permanent dummies. We hold 17 644 — 299×**, and the streamed halves are comparable, so
the whole difference is in what is placed FOREVER. 17 311 of ours are the procobj bake in
`plobj0..9`: eleven models, all scattered vegetation and rock.

> **These numbers were wrong when this file was first written, and the mistake is worth keeping.** The first
> census was a throwaway that split `object.dat` on whitespace and took the row's name as it found it — but
> the file writes `lamppost3,` **with a trailing comma**, so every comma-terminated name failed to match its
> IPL rows and counted as a building. It under-reported dummies by 10 655 and mis-stated the building
> headroom as 3.2 % when it is 10.3 %. The table now comes from the shipped parsers (`parseObjectDat`,
> `parseIpl`, `parseBinaryIpl`, `parseIde`) — the same ones the build guard uses.

```
3446 sand_josh2   3357 sand_josh1   2005 elmdead_po   1551 cedar1_po   1509 cedar3_po
1478 cedar2_po    1015 sm_fir_scabg_po   1010 rockbrkq   985 pinebg_po   942 ash_po   13 sjmcacti2
```

So the class is invisible in stock and in any ordinary mod install — stock could re-enter the world sixty
times against its 2 500-entry pool. Ours cannot re-enter it three times.

## The count grows per world entry — and the arithmetic is exact

The field sequence was: new game (fine) → load a save (fine) → load again (**crash**). Three entries into
the world, against `Dummys = 50000`:

| world entry | dummies held, if none are released | pool |
| ---: | ---: | --- |
| 1 (new game) | 17 644 | fits |
| 2 (first load) | 35 288 | fits |
| 3 (second load) | **52 932** | **over 50 000 → crash** |

`CWorld::ClearForRestart` (0x564360) supports this directly: it deletes only `Peds` and `Vehicles` out of
the repeat sectors. Buildings and Dummies are not in its list.

## The reason they cannot be released: `IplDef`'s dummy range is still int16 — by our own decision

`RemoveIpl` (0x404B20) is the function that frees what an IPL placed, and it frees dummies by walking a
pool-index range stored in the IPL's own `IplDef`:

```cpp
ProcessPool(*GetBuildingPool(), def->firstBuilding, def->lastBuilding);
ProcessPool(*GetObjectPool(),   0,                  GetObjectPool()->GetSize());
ProcessPool(*GetDummyPool(),    def->firstDummy,    def->lastDummy);   // <-- int16 @0x26 / @0x28
```

`IplDef` is `0x34` bytes with `firstBuilding`@0x22, `lastBuilding`@0x24, **`firstDummy`@0x26,
`lastDummy`@0x28 — all `int16`**. `perfect-map.asi` lifts the **building** pair into an int32 sidecar and
deliberately leaves the dummy pair. Our own note, `asi/perfect-map/docs/patch-catalogue.md`:

> `dummies` don't overflow in practice (diagnosed live — no over-int16 dummies), so `firstDummy/lastDummy`
> are left alone (**004b if ever needed**).

**That assumption is now false, and this is 004b's trigger arriving.** Any dummy sitting at pool index
above 32 767 has an index that does not fit the field that records it, so `RemoveIpl` walks the wrong range
and never deletes it. The ceiling is on the POOL INDEX, not on our row count — so it bites as soon as the
pool is used past 32 768, whatever `Dummys` is set to.

## What the field workaround actually bought

`Dummys` was raised 50 000 → 100 000 and the symptom went away. It is a **postponement**, and the numbers
said by how much before it was tested: at 17 644 per world entry, 100 000 holds five entries and the
**sixth** must crash (105 864). The int16 ceiling at 32 767 is untouched — the raise simply hands the leak
67 232 more slots to fill.

**FIELD-CONFIRMED 2026-08-19: the sixth LOAD GAME crashed, same address.** So the leak rate is not an
estimate any more — it is the permanent set, once per world entry, and the pool size buys
`floor(Dummys / 17644)` entries per boot and nothing else.

## `Dummys = 32767` does not boot — which settles the design question

**Field 2026-08-19.** The obvious non-ASI workaround is to keep the pool INSIDE the int16 range, so no
dummy can ever get an index `firstDummy/lastDummy` cannot hold. It does not work, and the corrected census
says why on its own: the map's full peak is **33 043 dummies**, already past 32 767, so a fully-resident
world cannot be described by that field even once.

```
Unhandled exception at 0x00538103 ... reading location 0x00000000.
    EAX: 0x0000059E   EDX: 0x00007FFF   ESI: 0x00000000
```

Same site, same null. **`EDX` carries the configured pool size** — `0x7FFF` = 32 767 here, `0xC350` = 50 000
in the 08-18 dump — so the two field points agree that the pool was full at exactly what the ini said. `EAX`
is `objInstance->m_nModelId`, the instance that could not be placed: `1438 DYN_BOX_PILE_2` and
`3460 vegaslampost`, both ordinary stock map objects, so the pool was long full before they came up.

**It died during BOOT, before the menu.** The bottle's plugin logs give the timeline: `09:15:55` the ASIs
load, `09:16:10` the crash — **15 seconds**, against 80 for the healthy 08-18 boot. SA places the permanent
world on the loading screen, ahead of the menu, so no game had been started.

So the boot's own live dummy count already exceeds 32 767 — more than the 17 644 this build
places from its text IPLs, which means the permanent set is placed more than once before the menu appears
(`CIplStore::LoadIplBoundingBox` is a second path into `LoadObjectInstance` and frees nothing; the
`CColAccel` cache branch of `SetupRelatedIpls` overwrites a whole `IplDef`, dummy range included). That
last step is not pinned and does not need to be for the conclusion below.

**The conclusion is what matters: the dummy pool can never be kept inside int16 on this map.** Capping
`Dummys` at 32 767 does not boot, so `RemoveIpl` will be walking truncated dummy ranges on every run for as
long as the field runs a pool it can actually boot. There is no configuration that avoids the defect —
which makes 004b mandatory rather than one option among several.

**Stopgap until it is built:** `Dummys` must stay above 32 767, and the pool buys `floor(Dummys / ~17000)`
world entries per boot. 400 000 is about 23 entries and costs ~22 MB (`sizeof(CDummyObject)` is 56, read off
the `pushl $0x38` at `0x5380E1`). It postpones; nothing more.

## Confirmed from the inside — 2026-08-19, perfect-map 011 step 1

The forensics above inferred the int16 truncation from the crash dump and the load arithmetic. The
`PM_INT16_LOG` debug build of `perfect-map.asi` then watched it happen (plan
[011](../../../asi/perfect-map/docs/plans/011-ipldef-dummy-range.md), step 1 — the measured block carries the
lines): from IPL slot 35 on, the engine's `IplDef.lastDummy` reads negative (`-32718` for a true last of
`32818`) while `firstDummy` stays positive, so `RemoveIpl`'s `cmpl; jg` sees an empty range and skips the
slot's dummy pass entirely. The pool crosses 32 767 on the FIRST world entry, and its high-water mark went
40 960 → 98 304 across two entries at `Dummys = 100000`. The cause is settled; 011 is the fix.

## What would actually fix it, in order of honesty

1. **004b — extend the existing int32 sidecar to `firstDummy`/`lastDummy`.** The catalogue already says
   they are "the same shape", and the exe agrees exactly: the dummy pass reads its bounds at **three**
   sites, mirroring the building pass site for site —

   | | first | last | last, re-read on the loop back-edge |
   | --- | --- | --- | --- |
   | buildings (patched) | `0x404B4A` `movswl 0x22(%ebx),%edi` | `0x404B5D` `movswl 0x24(%ebx),%edx` | `0x404BA8` `movswl 0x24(%ebx),%edx` |
   | dummies (**not** patched) | `0x404C0F` `movswl 0x26(%ebx),%edi` | `0x404C13` `movswl 0x28(%ebx),%ecx` | `0x404C4E` `movswl 0x28(%ebx),%eax` |

   The third column is the one the building work nearly missed — a detour set that skips the back-edge
   re-read stops deleting after ONE entity. `IncludeEntity` also has to mirror the dummy pool-index range
   into the sidecar as it already does the building one. ASI work: a Windows build and a field bracket.
2. **Find out why a world entry does not release the previous one's dummies at all.** Step 1 makes the
   release possible; it does not prove it happens. `CWorld::ClearForRestart` not touching them is the
   lead.
3. **Reduce the demand.** 17 311 of 17 644 permanent dummies are the procobj bake. Whether that layer has to be
   permanent `inst` rows of `object.dat` models is a design question nobody has asked yet — it is the
   difference between a 299× and a 1× multiple of stock.

## The build guard — BUILT 2026-08-19

`installRequirements` priced `census.rows` — **every** text-IPL row — against `CPool<CBuilding>`, wrong in
three ways and silent in all of them: it counted the 17 644 dummy rows as buildings, it had **no
`CPool<CDummy>` row at all**, and it ignored the streamed half entirely.

`tools/perfect-map-builder/src/entity-pools.ts` replaces it. It splits every row by `object.dat` the way
`LoadObjectInstance` does, counts the binary IPLs too, and reads `Buildings`/`Dummys` off the OLA ini **this
build ships** — including the trap that the same file declares both keys in `[SALIMITS]`, `[VCLIMITS]` and
`[GTA3LIMITS]` with Vice City's numbers larger, and that it is CRLF. It **gates on the permanent rows
only**, because stock proves the peak is not a budget: stock SA's binary IPLs hold 25 624 building rows
against a 13 000 pool and the game has run since 2004, because they stream.

On this tree it prints

```
entity pool — CPool<CBuilding>: 109740 permanent of 150000, +24801 streamed (never all resident)
entity pool — CPool<CDummy>: 17644 permanent of 50000, +15399 streamed (never all resident)
! CPool<CDummy> is NOT released between world entries: 17644 permanent dummies per entry against
  Dummys = 50000 holds 2 entries per boot, and the next one crashes at 0x00538103.
```

— the field's own result, before the build ships. The count goes into `report-sa.json` as `entityPools`, and
the misleading `CPool<CBuilding>` row was removed from `installRequirements` rather than left standing
beside a truer one.

## Delivery hazard

`Dummys = 100000` is set in the bottle **and** in `mods-src/original/mods/sa/5. Open Limit Adjuster 1.6.1/`,
so a rebuild carries it. **The currently built tree (`build/original/sa`, 2026-08-17) still has 50 000** — a
whole-tree-root delivery from it would put the crash straight back, the same way session 26's delivery
reverted the FLA pools
([fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md](sa-boot-crash-fla-pools-reverted-by-delivery.md)).
Rebuild before the next full delivery.

## Reproduction material

- crash log: `<bottle>/GTA San Andreas/logs/gta_sa.exe_2026-08-18_21-12-24.log`
- the address database that agreed independently: `CrashList.txt`, entry `0x00538103`
- the census reproduces from a built tree alone: `data/object.dat` + `gta.dat`'s IDE/IPL lists + the binary
  IPLs in the IMGs (`instOffset` @0x1C — `packages/renderware/src/parsers/text/ipl-binary.parser.ts`)
- disassembly: `/Library/Developer/CommandLineTools/usr/bin/llvm-objdump -d --start-address=0x538090 --stop-address=0x538150 gta_sa.exe` (it reads PE/COFF)
