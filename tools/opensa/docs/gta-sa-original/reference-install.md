# The reference install — what the real game we target actually provides

**Declared the baseline by the user on 2026-08-07.**

**The install the game actually RUNS from is a CrossOver bottle:**
`~/Library/Application Support/CrossOver/Bottles/Win10/drive_c/GTA SA/GTA San Andreas`. `NO_COMMIT/gta_sa` is a
COPY the user uploads for diffing, and it is not what launches — patching a file there changes nothing about the
next run. That cost a wasted launch on 2026-08-10, when an `.asi` probe was swapped into the copy and the crash
that came back was the probe's, from the bottle, still carrying the previous build. Read logs from the bottle;
diff against the copy. Every plan that
adds map placements is designed against THIS, not against unmodded SA 1.0 — and the difference is not
cosmetic: **two of the four ceilings [sa-target.md](../restrictions/sa-target.md) makes a plan budget for do not exist here.**

Read this before costing a map-content plan. Costing one against stock ceilings that the target lifts is how
plan 07 spent a fortnight organised around a limit nobody would have hit.

## What it runs, measured 2026-08-07 off the install itself

| | Value |
| --- | --- |
| Permanent text-IPL `inst` rows, map-wide | **72 914** — **2.23× the int16 ceiling** |
| gta.dat IPL lines / slots carrying `inst` | 52 / **36** |
| Largest single text IPL | **9 627 rows** — **2.35× stock's 4 096 per-file buffer** |
| Map content | ProperFixes 2.2.1 (via modloader) incl. its "Increased Vegetation Distance" optional — 57 583 of those rows in 6 files |

It boots and plays. That is the fact every ceiling below has to be read against.

## The three plugins that decide limits, and how they divide the work

Dozens of `.asi` files are installed; only these three touch the structures a map-content plan cares about,
and **they partition cleanly** — which is what makes the configuration legal under "exactly ONE adjuster may
own IPL limits" ([sa-target.md](../restrictions/sa-target.md)). A fourth of ours, `perfect-cutscene.asi`,
decides no limit at all — it is below the table because it owns draw ORDER, not a ceiling.

| Plugin | Owns | Evidence |
| --- | --- | --- |
| **OLA** (`III.VC.SA.LimitAdjuster.asi`) | the IPL/pool zones | its ini, below |
| **FLA** (`$fastman92limitAdjuster.asi`) | everything else — handling lines, car generators, ID limits, error reporting | **its whole `[IPL]` section is disabled**: 0 active lines in `[IPL]`, while `[HANDLING.CFG LIMITS]` is active and matches `fastman92limitAdjuster.log` |
| **`perfect-map.asi`** (ours) | the int16 `IplDef` truncation + the 2dfx `FxSystem_c` lifetime | `perfect-map-asi.log`, below |

Since 2026-08-14 the bottle also carries **`perfect-cutscene.asi`** (ours), and by that evening it is an
**APPLY** build: it defers cutscene cars into the engine's sorted entity pass so their glass stops erasing
scene actors ([plan 001](../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md), field-accepted
on RIOT_4B and SYND_3A, then swept 35/35). **Since 2026-08-15 it is SHIPPED, not hand-installed** (that plan's
step 7): a `sa` build that ran the cutscene stage writes it into the game root beside `perfect-map.asi` and
hashes both into `report-sa.json`. So the target runs **OLA + FLA + perfect-map + perfect-cutscene**, and the
last of those arrives with the fleet that requires it
([`restrictions/sa-target.md`](../restrictions/sa-target.md)) rather than by hand. A build with no converted
fleet ships no plugin — the two are coupled in both directions — and a cutscene A/B must still state which
side had it.

In fastman92's ini format a leading `#` **disables** the setting — confirmed against its own log, where the
uncommented `Number of standard lines = 500` appears and no IPL limit does. So FLA is present and loud, and
touches no IPL limit at all.

Our own log records the whole picture in six lines:

```
[perfect-map] loaded — built Jan  1 1980 00:00:00 (APPLY)
[perfect-map] fingerprint OK — GTA:SA 1.0 US
[perfect-map] adjuster present: fastman92 (FLA)
[perfect-map] adjuster present: LimitAdjuster (OLA)
[perfect-map] int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32
[perfect-map] fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)
```

## The ceilings, stock versus here

`EntitiesPerIpl` and `EntityIpl` are the two OLA growers our own source study named in
[`asi/perfect-map` 004](../../asi/perfect-map/docs/plans/004-limit-patches.md): `EntitiesPerIpl` grows
`gpLoadedBuildings` (0xBCC0E0 @ 0x5B892A) — the per-file `LoadScene` buffer — and `EntityIpl` grows
`IplEntityIndexArrays` (0x8E3F08 @ 0x5B8A36) — the slot array.

| Ceiling | Stock | **Reference install** | Who lifts it |
| --- | --- | --- | --- |
| int16 `IplDef` building indexes | 32 767 rows map-wide | **lifted** (running at 72 914) | **only `perfect-map.asi`** — OLA leaves `0x404B4A` byte-stock; FLA jmp-hooks `0x404B4A/5D/A8` (→ `0x22C4xxx`) and does not finish the job, so perfect-map overlays it |
| int16 `IplDef` dummy indexes (`firstDummy/lastDummy`, the range `RemoveIpl` frees by) | 32 767 pool slots | **lifted 2026-08-19** (perfect-map 011; first entry peaks at 41–49k) | **only `perfect-map.asi`** — FLA jmp-hooks `0x404C0F` (→ `0x022C5EA8`, its 5-byte jmp spans both adjacent reads) and `0x404C4E` (→ `0x022C5EB9`, spans `movsx` + `inc edi`) but the dummies past 32 767 still leaked with those hooks live; OLA leaves both byte-stock. Read off the live bytes with the SDK's `VerifyAllSites` |
| `gpLoadedBuildings` per-file buffer | 4 096 rows | **`EntitiesPerIpl = unlimited`** (running a 9 627-row file) | OLA |
| `IplEntityIndexArrays` | 40 slots | **NOT LIFTED — `EntityIpl = unlimited` is set and does not work** | nothing |
| `CPool<CBuilding>` | 13 000 | **`Buildings = 150000`** (raised 2026-08-10 for the clutter layer) | OLA |
| `CPool<CDummy>` | 2 500 | **`Dummys = 100000`** (raised from 50 000 in the field 2026-08-19 when the pool was exhausted on the third world entry; KEPT after perfect-map 011 fixed the leak — the FIRST entry alone peaks in [40 960, 49 151] on this build against 33 043 map rows, 40 000 crashes during it, and the pool costs 56 B × 100 000 = 5.6 MB) | OLA |
| `IplDef.firstDummy/lastDummy` — the dummy range `RemoveIpl` frees by | int16, **32 767** | **LIFTED 2026-08-19** by `perfect-map.asi` ([plan 011](../../asi/perfect-map/docs/plans/011-ipldef-dummy-range.md)); field: the dummy pool's high-water freezes after the first world entry ([fixed issue](../open-issues/fixed/sa-load-game-crash-dummy-pool.md)) | perfect-map.asi |
| Streaming object instances | — | `StreamingObjectInstancesList = 30000` | OLA |
| `CStreaming::ms_files` — registered IMG archives | **8** (3 hardcoded + 5 from `gta.dat`) | **NOT LIFTED; 6 in use, 2 free** | nothing here — see below |

### The archive table: 8 slots, and we own 2 of them

**Derived, not remembered** (gta-reversed `Streaming.h`, 2026-08-15): `ms_files` is at `0x8E48D8` and the next
static, `ms_bLoadingBigModel`, is at `0x8E4A58` — a gap of `0x180` = 384 B over a `tStreamingFileDesc` the
header itself size-asserts at `0x30` = 48 B, so the array is **8** entries. GTAMods states the same split
independently: *"3 standard archives gta3.img, gta_int.img, player.img and 5 archives defined within
default.dat or gta.dat"*. Past it the game crashes.

What this install spends: the three hardcoded ones, plus the three `IMG` lines stock `gta.dat` carries
(`DATA\PATHS\CARREC.IMG`, `DATA\SCRIPT\SCRIPT.IMG`, `MODELS\CUTSCENE.IMG`) — **6 of 8**.

**FLA does not lift it here.** The captured ini patches the ID pools and `handling.cfg` and turns on error
reporting (`IMG archive needs rebuilding`, `Stream handles limit exceeded` are REPORTS, not lifts); nothing
in it touches the archive count. fastman92's separate *IMG & Stream Limit Adjuster* raises the ceiling to 127
archives / 400 stream handles, and it is not installed here. So the limit is stock, and it is ours to take if
a design needs a seventh archive — which
[`architecture/img-archive-layout.md`](../architecture/img-archive-layout.md) does.

**The consequence for our generators — corrected 2026-08-10, twice by the field.** The per-area row cap and the
slot count are NOT interchangeable:

- **The row cap is genuinely lifted**, and this install proves it by running a 9 627-row text IPL. But that
  proof is for a text IPL with **zero binary streams**; an area's rows and its stream records share the same
  buffer, and 8 520 mixed entries crashed on the first area. Read the number for the path it was measured on.
- **The 40-slot array is NOT lifted at all.** `EntityIpl = unlimited` is set, documents itself as *"Maximum
  number of IPL files that creates entities"*, and the game still dies loading the 40th inst-bearing IPL —
  measured with our `perfect-map.asi` and again with an `-DPM_FIX_INT16=0` probe of it, so nothing of ours is
  the cause. This install never crossed it (36 in use), which is why the setting looked like it worked.
  `checkInstBearingIplSlots` in pmb now fails the build on it.

### The building pool was raised for the permanent-row clutter layer (2026-08-10)

`sa-procobj-placement/014` puts one permanent text row per clutter object, which took map-wide rows
**44 523 → 110 055** (read off the build, not estimated). `Buildings = 100000` could not hold that — pool
exhaustion at load, and the 2026-08-10 `0x005381A5` crash was this pool at exactly 100 000.

**Raised to 150 000 and verified in the live install** (`[SALIMITS]`, ini mtime 15:51). It was checked rather
than assumed: the first attempt at this edit did not reach the file the game reads, and a number written here
above the install's own is silent by construction — it can only fail to warn (the `FILE_TYPE_TXD` lesson, same
day). Headroom over the measured 110 055 is ~36 %, which is what a density rise has to be priced against.

**And the piece only we supply:** OLA raises every pool and array it knows about and still cannot fix int16,
because the truncation is inside the `IplDef` struct rather than in a pool size. At 72 914 rows this install
is 2.23× past that ceiling, so `perfect-map.asi` is not an optimisation here — without it the map corrupts,
which is exactly what the 2026-08-07 A/B showed when `ProperFixes.asi` (its own equivalent patch) was
removed.

## The fourth plugin — it owns no ceiling and still changes what we may ship (2026-08-16)

The table above is about LIMITS. `skygfx.asi` sets none, and it still belongs in any plan that touches world
geometry, because on this install it is the **JuniorDjjr fork** and not aap's original: it replaces SA's
building pixel shaders and carries its own path for **repeating / tiled** textures (the same stochastic
de-tiling our own [074·12](../plans/074-opensa-engine/12-stochastic-texturing.md) took its design from).

What that means for a plan: **"the vanilla renderer" is not what this install runs.** A geometry property SA
itself tolerates can still misrender here, and the reverse — a field verdict of "the game cannot take this"
may be a verdict about one plugin's shader. The first case is already measured
([sa-lod-visibility-budget.md](../open-issues/fixed/sa-lod-visibility-budget.md)): the optimizer's output smears
only on repeat-textured objects, and only while this plugin is loaded. What the plugin actually does with a
world atomic — and that its building shaders read NO vertex normals — is
[skygfx-fork-building-pipe.md](skygfx-fork-building-pipe.md).

**Caught:** no, and it cannot be. The build validates, our own engine renders it correctly, and the symptom
exists only under a third-party shader — the only instrument is a field run with the plugin removed.

## What may and may not be assumed

- **May be assumed** for a plan targeting this install: no per-file row ceiling **for text rows alone** (9 627
  proven), a **150 000**-building pool, and `perfect-map.asi` present for int16.
- **May NOT be assumed here either, despite the ini saying so:** the 40-slot `IplEntityIndexArrays`. It is real
  on this install.
- **May NOT be assumed** for the stock target, which still has all four. A build that ships raised density
  must either keep the stock guards for the stock target or state plainly that it requires the adjusters.
- **May not be assumed to be stable.** This is one user's install, recorded on one day. `NO_COMMIT/gta_sa`
  is the copy to diff against when a symptom does not reproduce; re-read the two ini files before trusting
  any row of the table above.

**Caught:** partly. pmb's guards catch a stock-target violation loudly. Nothing catches the opposite mistake
— designing down to a ceiling this install does not have — and that one is silent by nature, because the
result is a build that works and simply carries less than it could.

## The trap in delivering to it (2026-08-17)

**A field run reads the bottle, so a delivery is the WHOLE `models/` + `data/` of the built tree — not the
files a session happens to be about.** The session-18 LOD retest copied `models/gta3.img`, `data/gta.dat`,
`data/maps/*` and `procobj.dat` into the bottle (16 Aug 22:45); `models/vehicles.img`/`vehicles2.img` stayed
the 15 Aug build and `data/{vehicles.ide,carcols.dat,handling.cfg,carmods.dat}` the 10 Aug one. The next
morning a car dropped into `vehicles/new/` "had not installed" — the built tree carried it byte for byte, the
bottle was serving the archive from before it existed, and the diagnosis cost a rebuild's worth of diffing
before anyone compared mtimes. Also present in the bottle and NOT in our tree: `modloader.asi` +
`modloader/` (`Car Addons`, `_ESSENTIALS`, …, 10 Aug) — an active second source of models and data whenever
the bottle disagrees with the tree.

**And the mirror trap, paid for on 2026-08-18: delivering the tree ROOT overwrites the install's PLUGIN
CONFIGURATION.** The root of a built `sa` tree carries every `.asi` and every `.ini` the mods stage installed
— including `fastman92limitAdjuster_GTASA.ini`. A `--delete` sync of the root therefore replaces whatever the
bottle was configured with by whatever `mods-src` ships (and deletes what the tree has no copy of; the
bottle's `logs/` went that way). The FLA ID pools had been raised in the bottle on 2026-08-10 and never in the
repo, so that one delivery took them from `TXD 6000 / COL 400 / IPL 1024` back to `5000 / 280 / 256` against a
build carrying 5 177 TXD archives — and the game died at boot in an unrelated `free()`, four arms deep into a
hunt ([write-up](../open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md)). **So: a setting
changed in the bottle is a setting that must go back into `mods-src` the same day**, and after any root
delivery read FLA's log line `Number of memory changes made` (3712 for this install) before diagnosing
anything else.

The sync that closed it (no `--delete`, `.DS_Store` excluded), from the repo root:

```sh
B="$HOME/Library/Application Support/CrossOver/Bottles/Win10/drive_c/GTA SA/GTA San Andreas"
rsync -rlt --itemize-changes --exclude '.DS_Store' build/original/sa/models/ "$B/models/"
rsync -rlt --itemize-changes --exclude '.DS_Store' build/original/sa/data/   "$B/data/"
```

`>f.s` rows in its output are content changes **only when the file's SIZE changed** — a fixed-layout archive
rewritten in place keeps its byte count, so a fresh `gta3.img` itemises as `>f..t....` exactly like an
untouched file (2026-08-21: 0 of 419 rows carried the `s` flag on a delivery that replaced the whole map).
Verify such a file by digest — `md5 -q` on both sides — not by the itemise flags; `>f..t` alone means
mtime-only for files whose size is a fingerprint, and nothing for archives. `anim/` was already identical
(`cmp`), and `vehicle-installer --rebake --kind sa` (plan 008) is the one-car path that makes a rebuild
unnecessary in the first place.

## The trap in reading the log

The banner reads `built Jan 1 1980 00:00:00` on every build. That is our own reproducibility pinning
(`SOURCE_DATE_EPOCH` + `--no-insert-timestamp`, required for a byte-identical `.asi` A/B) doing its job, and
it means **the banner can no longer tell you which build loaded** — the one thing the recorded procedure says
to check first. Identify the file by hash or by an intentional log line, never by its timestamp.
