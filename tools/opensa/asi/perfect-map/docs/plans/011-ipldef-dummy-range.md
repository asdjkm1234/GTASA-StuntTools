# 011 — `IplDef`'s dummy range int16 → int32 (the "004b" half of the int16 lift)

Part of the [perfect-map ASI chain](readme.md). This is the work
[004](004-limit-patches.md) deferred as **004b** and the
[patch catalogue](../patch-catalogue.md) recorded as *"dummies don't overflow in practice … 004b if ever
needed"*. **That diagnosis was falsified in the field on 2026-08-19**, and this plan is the consequence.

Depends on [003](003-patch-framework.md) (declarative table, fingerprint, byte verification, coexistence)
and on 004's shipped building fix, whose machinery this extends rather than duplicates.

## Context — what the field proved

Full forensics: [`docs/open-issues/fixed/sa-load-game-crash-dummy-pool.md`](../../../../docs/open-issues/fixed/sa-load-game-crash-dummy-pool.md).
The short of it:

- The game crashes at `0x00538103` — `CFileLoader::LoadObjectInstance` takes null from the `CPool<CDummy>`
  allocator, jumps past the constructor and dereferences it. `ESI = 0` in the dump; `EDX` carries the
  configured pool size and matched the ini on both captures (`0xC350` = 50 000, `0x7FFF` = 32 767).
- **The pool never empties between world entries.** Measured across two field points: `Dummys = 50000` dies
  on the 3rd LOAD GAME, `100000` on the 6th — a leak of ~17 000 per entry, which is exactly the permanent
  set this build places (17 644 dummies from its text IPLs, against stock SA's **59**).
- **The pool cannot be kept inside int16.** `Dummys = 32767` does not boot — 15 s in, before the menu. So
  there is no configuration in which `RemoveIpl` walks an untruncated dummy range, which is what turns this
  from an option into the only exit.

## What already exists (this is an extension, not a new patch)

`src/patches/int16.hpp` shipped the building half in 004, and every piece of it is shaped to be widened:

| piece | building (shipped) | dummy (this plan) |
| --- | --- | --- |
| observer hook | `IncludeEntity` **0x404C90** → body 0x1563730 | **the same hook** — `IncludeEntity` already has both branches (`ENTITY_TYPE_BUILDING` and `ENTITY_TYPE_DUMMY`), and `PmIncludeObserver` already discriminates on the entity-type byte at `+0x36 & 7` (building = 1, dummy = 5) and already `return`s on 5 |
| pool base | `kBuildingPool = 0xB74498` | `ms_pDummyPool = 0xB744A0` — already hardcoded in the file's `PM_INT16_LOG` diagnostic |
| element size | `kSizeofBuilding = 0x38` | **identical**: `sizeof(CDummy) == sizeof(CDummyObject) == sizeof(CBuilding) == 0x38`, so the index arithmetic is unchanged |
| sidecar | `gFirstBuilding/gLastBuilding[256]` | a second pair, same shape |
| snapshot | `PmRemoveIplSnapshot` at `RemoveIpl` entry (0x404B20) | **the same hook**, snapshotting and resetting a second pair |
| bound-read detours | 3 sites: 0x404B4A, 0x404B5D, 0x404BA8 | 2 sites — see below |

There is even a diagnostic already written for this exact question, under `PM_INT16_LOG`:
*"does the DUMMY pool (type 5) also overflow int16? (dummies aren't fixed yet — 004b.)"* Step 1 is to run
it.

## The patch sites, read off the shipping exe

```
404c0f: 0f bf 7b 26   movswl 0x26(%ebx),%edi    ; firstDummy
404c13: 0f bf 4b 28   movswl 0x28(%ebx),%ecx    ; lastDummy
404c17: 3b f9         cmpl   %ecx,%edi
404c19: 7f 3f         jg     0x404c5a           ; empty range → skip the pass
...
404c4e: 0f bf 43 28   movswl 0x28(%ebx),%eax    ; lastDummy, re-read on the loop back-edge
404c52: 47            incl   %edi
404c53: 83 c5 38      addl   $0x38,%ebp
404c56: 3b f8         cmpl   %eax,%edi
404c58: 7e c6         jle    0x404c20
```

**Two detours, not three** — unlike the building pass, whose reads are 19 bytes apart, the two pre-loop
dummy reads are ADJACENT (8 bytes, `0x404C0F`–`0x404C16`). One 5-byte `jmp` at `0x404C0F` covers both:
load `edi` = snapped first, `ecx` = snapped last, return to **`0x404C17`** (the `cmpl`). The back-edge
detour mirrors 004's `0x404BA8` exactly: at `0x404C4E` set `eax` = snapped last, re-run the clobbered
`incl %edi`, return to **`0x404C53`**.

> **Trap, and it must be verified before anything is written:** the dummy loop's back-edge is `jle` —
> **inclusive** — while gta-reversed renders the pass as `for (i = minId; i < maxId; i++)`, i.e. exclusive.
> A snapshot fed in with the wrong convention deletes one entity too few or walks one past the end. Confirm
> the bound convention against the asm, not the C.

## Decisions

1. **Extend `int16.hpp`, do not fork it.** Same strategy as 004: OBSERVE `IncludeEntity` into an int32
   sidecar, SNAPSHOT at `RemoveIpl` entry, REDIRECT the bound reads. The engine's own `(int16)dummyId`
   writes stay untouched — we never write the struct, so we cannot corrupt it.
2. **A separate snapshot pair for dummies.** `RemoveIpl` runs buildings → objects → dummies in one call, so
   one pair cannot serve both. `RemoveIpl` is non-reentrant, so two static pairs suffice.
3. **Behind its own flag** (`PM_FIX_INT16_DUMMY`), like every other fix, so the field can bisect it against
   the building fix alone.
4. **Ship nothing until the completeness scan is done.** 001 called this "the plan's hardest task" and the
   building work proved why: the compiler emitted a THIRD read on the loop back-edge, and missing it stopped
   deletion after one entity. A partial widen re-introduces the bug at a different site, silently.
5. **No demand reduction here.** Whether 17 311 procobj rows should be `object.dat` models at all is a real
   question and it belongs to the pipeline, not to this patch. This plan makes the engine correct for the
   data we already ship.

## Steps

### Step 1 — measure the overflow instead of inferring it (the oracle)

Build with `PM_INT16_LOG` and the existing type-5 diagnostic, boot the real install at `Dummys = 100000`,
enter the world twice.

**Expect:** `[dbg] incDUMMY slot/id` lines with ids above 32 767, and `RemoveIpl` snapshots whose engine
int16 `firstDummy/lastDummy` are negative or clamped while the true range is not. **Verification:** those
lines exist. If they do NOT, the truncation is not what strands the dummies and steps 4–5 would fix
nothing — stop here and re-open the diagnosis (see Risks).

*Measured 2026-08-19, debug build `built Aug 19 2026 11:02:43 (APPLY)`, real install (CrossOver bottle),
FLA + OLA loaded, `Dummys = 100000`, NEW GAME → world → LOAD GAME → world. **The gate PASSES** — the
log (kept in full as `assets/011-step1-field-log-2026-08-19.txt`) carries both expected signatures:*

```
[dbg] incDUMMY slot/id 35 32768 0          ; first dummy past int16, 24 of them logged in slot 35
[dbg] rmvDUMMY slot/i16dFirst/obsFirst 35 9640 32736
[dbg] rmvDUMMY slot/i16dLast/obsLast  35 -32718 32818   ; engine int16 last WRAPPED, true last 32 818
[dbg] rmvDUMMY slot/i16dLast/obsLast  37 -32499 33037
[dbg] rmvDUMMY slot/i16dLast/obsLast  50 -31474 34062   ; every slot from 35 to 50 (the 40-line cap ended it)
[dbg] dummyPEAK slot/id/prevPeak 118 40960 40959         ; pool high-water after entry 1
[dbg] dummyPEAK slot/id/prevPeak 129 98304 98303         ; after entry 2 — 98 % of a 100 000 pool
```

- *From slot 35 on, `lastDummy` is negative while `firstDummy` is positive → `cmpl; jg` at `0x404C17`
  sees an empty range and the whole dummy pass is SKIPPED for the slot — nothing of it is ever deleted.
  That is the stranding, and it begins the moment the pool crosses 32 767, which it does on the FIRST
  entry (`dummyPEAK 32768` is logged from slot 35 before any LOAD GAME).*
- *The pool's high-water mark went 40 960 → 98 304 between the two entries, which is the leak the crash
  forensics measured from the other side (3rd load at 50 000, 6th at 100 000).*
- *Collateral observation for step 2: the engine's int16 `firstDummy` (and `firstBuilding`) is STALE,
  not truncated — slot 5 reads `8210` where this load's true first is `31065`, and the same holds for
  buildings (`16520` vs `99368`). The engine does not reset the pair on unload, so a slot loaded and
  unloaded once (below int16) keeps its old low `first` forever; a fresh slot reads `32767`/`0x7FFF`
  (slots 2, 3). Harmless to the loop (it walks extra ids and filters by IPL index) and irrelevant to the
  fix (we snapshot OUR range), but it means a writer other than the one we hook is NOT implied by a
  `first` that disagrees with ours — classify the `+0x26/+0x28` writes in step 2 with that in mind.*
- *Instrument: the `PM_INT16_LOG` diagnostic was widened for this step (own cap for `incDUMMY`, a
  diagnostic-only int32 dummy range per slot compared against the engine's int16 pair at `RemoveIpl`,
  and the `dummyPEAK` high-water trace) — `src/patches/int16.hpp`, nothing outside `#if PM_INT16_LOG`.*

### Step 2 — the completeness scan for `+0x26` / `+0x28`

Prove `RemoveIpl` is the only consumer of the dummy range, the way 004 proved it for the building pair
(exe scan AND a full gta-reversed grep, agreeing).

Technique and starting point, already run once on the shipping exe: 146 word-sized accesses to `+0x26`
/`+0x28` exist across `.text`; filtering to a window containing `IplDef` arithmetic (`imul …,0x34`) or the
IplDef pool (`0x8E3FB0`) leaves **7**, of which two are WRITES (`0x156C498` `movw %cx,0x28(%eax)`,
`0x156C4BA` `movw %dx,0x26(%eax)` — the neighbourhood of the HOODLUM-relocated bodies, so check them
against `IncludeEntity`'s body at `0x1563730` before assuming) and one is another reader worth resolving
(`0x11D9316` `movswl 0x28(%edx),%eax`). **The filter is not yet trustworthy** — it did not retain the two
sites we know are IplDef reads (`0x404C0F`, `0x404C13`), so it is under-inclusive and must be widened
before its output is believed.

**Verification:** every surviving site is classified — IplDef or not — and the IplDef ones are either
covered by a detour or argued harmless in writing.

*Measured 2026-08-19 — the scan and the grep AGREE; step 2 closed.*

- *gta-reversed (`gta-reversed-modern`, shallow clone of the day): `firstDummy`/`lastDummy` occur in exactly
  two functions — `CIplStore::IncludeEntity` (`std::min/max` writes, `(int16)dummyId`) and
  `CIplStore::RemoveIpl` (`ProcessPool(*GetDummyPool(), def->firstDummy, def->lastDummy)`). `IplDef` is not
  named in any file outside `IplStore.*`, `IplDef.h` and `ColAccel.*`. `RemoveIpl` does NOT reset the pair —
  which is the "stale first" step 1 saw.*
- *exe (`objdump -d` of the 1.0 US exe, 3 959 327 lines): 184 word-sized accesses to `+0x26`/`+0x28`
  (`movswl/movzwl/movw/cmpw/incw/decw` + 16-bit-register `mov/cmp/add/sub`). Window filter (±150
  instructions containing `0x8E3FB0` ms_pPool, `0xBC4094` m_iplDefs, `$0x34` or the RemoveIpl/IncludeEntity
  addresses) keeps 31 and — unlike the old filter — RETAINS `0x404C0F`/`0x404C13`. Classified by hand:*
  - *IplDef READS: `0x404C0F`, `0x404C13`, `0x404C4E` — RemoveIpl, the three detour sites. No other.*
  - *IplDef WRITES: `0x15637CA` / `0x15637D6` (IncludeEntity's HOODLUM-relocated body, the min/max stores;
    reads `0x15637C2`/`CE` beside them — we observe BEFORE this body runs), `0x156C494–4BA` (an
    `IplDef` initialiser after `call 0x4059B0` = pool New: `0x7FFF` into +0x22/+0x26, `0x8000` into
    +0x24/+0x28, `-1` into +0x2A) and `0x15632CF–DB` (a second constructor, same constants). Constants
    only — harmless, the sidecar never reads the engine's pair.*
  - *Struct-level: `CColAccel::getIplDef` (`0x5B2EF0`, called from `0x404FF5` SetupRelatedIpls and
    `0x4057DD`) / `setIplDef` (`0x5B2ED0`, from `0x406162`) copy 13 dwords with `rep movsl`. Only under
    `isCacheLoading()`; nothing in gta-reversed sets that state on PC and the install has no
    `models/CINFO.BIN` → dead path (the Risks entry is retired by this).*
  - *Not IplDef: every `(%esp)`/`(%ebp)` site (none lies in `0x404A30–0x406300` or the relocated
    CIplStore bodies), `0x4D68C7` (RpAnimBlend node), `0x485960–90` (four uncalled int16 getters),
    `0x1569975`/`0x156DBF5` (a pool with `imul $0x2c` elements), `0x156B298`, `0x11D9316`/`0x122185C`/
    `0x124B190` (the second `.text` at `0xCB1000+`, protection wrapper, PIC-style code), the rest (stores of
    constants into unrelated structs, `0x75Cxxx` int16 arrays).*
- *Bound convention: the dummy loop is `cmp edi,ecx; jg skip` … `inc edi; cmp edi,eax; jle body` — INCLUSIVE;
  the building loop at `0x404BB2` is `jle` too. 004 feeds the max id and is field-proven, so 011 feeds the
  max id unchanged — the plan's trap was real (gta-reversed renders `<`) but costs nothing.*
- *Working files: the disassembly and `word26_28.txt` were scratchpad; the method is in this block AND kept
  as `scripts/debug/exe-field-access-scan.ts` (2026-08-19, his call) — it reports 192 / 34 for the same
  question because it also counts the 8 `fldcw` (x87 control word) stack loads the hand filter skipped.*

### Step 3 — coexistence probe at the dummy sites

004 found that **OLA**, not FLA, owns `0x404B4A`, and that FLA jmp-hooks all three building read sites with
5-byte `e9`s. Neither is documented for the dummy pass.

Read the live bytes at `0x404C0F`, `0x404C13` and `0x404C4E` on the reference install and record what is
there. **Verification:** the patch table's declared original bytes for the two detour sites match the real
install, or the coexistence rule for them is written down (defer, or overlay as 004 does for FLA).

*Measured 2026-08-19 — FLA owns both sites, exactly as it owns the building ones; step 3 closed.* The four
sites went into the catalogue (`ipldef-dummy-range`) and the SDK's `VerifyAllSites` now prints the LIVE bytes
of a differing site (`Log::KeyBytes`), so the probe is the debug build's own verification block:

```
RemoveIpl.dummyRange     0x00404c0f  live  e9 94 12 ec 01 bf 4b 28   ; FLA jmp → 0x022C5EA8, spans BOTH reads
RemoveIpl.lastDummy.loop 0x00404c4e  live  e9 66 12 ec               ; FLA jmp → 0x022C5EB9, spans movsx+inc edi
RemoveIpl.cont.404C17    pristine
RemoveIpl.cont.404C53    pristine
```

- *FLA's 5-byte jmp at `0x404C0F` covers the same 5 bytes ours will (both reads' 8 bytes minus the orphan
  `bf 4b 28`), so its handler must already return to `0x404C17`; its jmp at `0x404C4E` eats `inc edi`, so
  its handler re-runs the inc — identical shape to our planned detours. Rule: **overlay, as 004** — verify
  the two continuations (pristine), force our jmps over FLA's. OLA is stock here (it was stock on the
  building sites too).*
- *FLA's hooks were live in every field capture that leaked — so whatever its `0x022C5Exx` handlers do,
  they do not free the over-int16 dummies; overlaying them is not a regression.*

### Step 4 — the sidecar and the observer

Widen `PmIncludeObserver` to record type 5 into `gFirstDummy/gLastDummy`, and `PmRemoveIplSnapshot` to
snapshot and reset that pair alongside the building one.

**Verification:** verify-only build (`make`, no `APPLY`) still reports every site clean; unit-level byte
tests on macOS still pass; the log shows dummy ranges accumulating per slot.

*Measured 2026-08-19 — built.* `gFirstDummy/gLastDummy[256]` beside the building pair, `PmIncludeObserver`
accumulates type 5 into it (the step-1 diagnostic arrays are gone — the log now reads the real sidecar),
`PmRemoveIplSnapshot` snapshots into `gSnapFirstDummy/gSnapLastDummy` and resets the slot. All three flavours
(`make`, `make APPLY=1`, `make APPLY=1 DEBUG=1`) compile warning-free under `-Wall -Wextra`; KERNEL32-only
import table kept. Field numbers are step 6's.

### Step 5 — the two detours

Write them into the patch table with declared original bytes, generated the way 004's are (self-contained,
hardcoding the relocated stock instruction, so identical code works over stock and over an adjuster's jmp).

**Verification:** `make APPLY=1` boots the real install; `perfect-map-asi.log` reports
`int16 APPLIED (dummies)`; the game reaches gameplay.

*Measured 2026-08-19 — built, field pending (step 6).* `detail::InstallDummyRangeDetour` (0x404C0F →
`mov edi,[gSnapFirstDummy]; mov ecx,[gSnapLastDummy]; jmp 0x404C17`, nothing relocated) and
`detail::InstallLastDummyLoopDetour` (0x404C4E → `mov eax,[gSnapLastDummy]; inc edi; jmp 0x404C53`), both
behind `PM_FIX_INT16_DUMMY` (default on), applied only after the building hooks succeeded and the two
continuations (`kInt16DummySites`) verify — so an adjuster owning a continuation defers the dummy half alone.
The read sites are overlaid over FLA's jmps exactly as 004's are.

### Step 6 — the field ladder, against the deterministic repro

The oracle needs no synthetic build: the failure is already deterministic and quantified. At
`Dummys = 100000` the 6th world entry crashes today.

1. Set `Dummys = 100000`. Enter the world **eight** times (new game plus seven loads). **Pass:** no crash.
2. Set `Dummys = 40000` — under two permanent sets, so it must fail fast without the fix and hold with it.
   **Pass:** repeated entries survive.
3. Regression: the building half still holds (the ghost-barriers repro), and a stock/unmodded boot is
   unaffected.

**Verification:** all three. Then, and only then, drop the `Dummys` stopgap back to something sane and
record the value the install actually needs.

*Measured 2026-08-19, debug build `built Aug 19 2026 11:23:00 (APPLY)`, FLA + OLA, bottle. Logs in
`assets/011-step6-*.txt`.*

1. *`Dummys = 100000`, NEW GAME + 7 LOAD GAME = **8 entries, no crash**. `int16 APPLIED (dummies)` logged.
   `dummyPEAK` (the pool's high-water, logged per 8 192-id boundary): 8 192 → 29 695 → 32 768 → **40 960
   during the first entry, and not one more line across the other seven.** Before the fix the same trace
   went 40 960 → 98 304 in TWO entries. The leak is gone.*
2. *`Dummys = 40000` — the step as written was WRONG: it crashed at `0x00538103` (`EDX = 0x9C40`) **during
   the first entry**, the log ending at `dummyPEAK 32768`. So the first entry alone occupies more than
   40 000 slots — the plan's "under two permanent sets" assumed the first entry costs ~17 644, and it costs
   2.3× that. Re-run at **`Dummys = 50000`** (the value that died on the 3rd LOAD GAME before the fix):
   NEW GAME + 4 LOAD GAME = **5 entries, no crash**, `dummyPEAK` again frozen at 40 960 after entry 1.*
3. *Regression — PASSED 2026-08-19 on the SHIPPING build (`built Aug 19 2026 11:47:37 (APPLY)`, no DEBUG,
   24 576 B): all three fixes `APPLIED`, FLA healthy (`Number of memory changes made: 3712`), no crash dump,
   and his field verdict: **ghost barriers do not return**. The whole ladder is green.*

*What the 40 000 crash measured, and what it means for the pool value:* `CPool::Delete` rewinds the
cursor (`m_LastFreeSlot = min(cursor, idx)`), so SA allocates lowest-free-slot-first and the high-water IS
the peak occupancy. The first entry's peak lies in **[40 960, 49 151]** (the trace's granularity) against
**33 043 rows in the whole map** (17 644 permanent + 15 399 streamed) — the boot occupies more dummies than
the map has rows, i.e. the permanent set is placed more than once during boot (the Risks entry, now
measured though not pinned). Two consequences: (a) the pmb guard's permanent-only gate (17 644) would NOT
have caught `Dummys = 40000` — the first-entry peak is not derivable from rows; (b) 50 000 holds with a
margin somewhere between 2 % and 22 %, which is not a margin to ship on. **`Dummys` stays at 100 000** —
a `CDummy` is 0x38 = 56 B, so the whole pool is 5.6 MB, and the value is already in `mods-src` and the
reference-install docs. The stopgap became the value; what changed is that it is now headroom, not a
per-boot entry budget.

### Step 7 — record and retire

- Move the open issue to `docs/open-issues/fixed/` with the field verdict.
- Update the [patch catalogue](../patch-catalogue.md) row: the falsified assumption becomes the shipped fix.
- Update `docs/restrictions/sa-target.md` — the `IplDef.firstDummy/lastDummy` row changes from **NOT
  LIFTED** to lifted, and the `CPool<CDummy>` row gets the value the install ends on.
- Numbers into `docs/benchmarks/tools/` if the fix moves any measurable cost.

*Done 2026-08-19: the open issue moved to `docs/open-issues/fixed/`, the catalogue row reads shipped,
`docs/restrictions/sa-target.md` / `docs/gta-sa-original/reference-install.md` / `docs/edge-cases/
sa-runtime-limits.md` say LIFTED, the pmb guard's "NOT released between world entries" warning is retired
(the guard itself stays — it gates the permanent rows, and the first-entry-peak finding above is recorded
beside it). No benchmark: the fix adds two detours on an unload path and nothing measurable to a frame.*

## Verification (acceptance for the whole plan)

- Repeated world entries no longer grow the dummy pool: the crash at `0x00538103` does not return at eight
  entries where six used to be fatal.
- The completeness scan is written down and every IplDef reader of `+0x26`/`+0x28` is accounted for.
- Both fixes are independently bisectable by flag; stock and unmodded installs boot unchanged.
- Nothing writes the engine's `IplDef` — the sidecar remains read-only with respect to engine state.

## Risks

- **004b may not be sufficient on its own.** It makes the range correct; it does not prove the entities are
  then freed. Step 1 is the gate: if the diagnostic shows no over-int16 dummy ids, the stranding has another
  cause and this plan is the wrong tool. The best evidence that it IS the cause is that **buildings do not
  leak** across the same world entries — and the building range in this same function is precisely what 004
  fixed.
- **The boot places the permanent set more than once.** `Dummys = 32767` dies during boot, above the 17 644
  the text IPLs hold, and `CIplStore::LoadIplBoundingBox` is a second path into `LoadObjectInstance` that
  frees nothing. Not pinned, not required for this plan, and worth pinning if step 6 comes back short.
- **`CColAccel`'s cache branch of `SetupRelatedIpls` overwrites a whole `IplDef` from disk** (`def =
  CColAccel::getIplDef(slot)`), dummy range included. If the collision cache is live on this install, a
  slot's range can arrive from a cache file rather than from `IncludeEntity` — which the sidecar would not
  have seen. Check before trusting step 6's result. **Retired by step 2 (2026-08-19): nothing on PC sets
  `isCacheLoading`, and the install has no `models/CINFO.BIN`.**
- Same standing constraints as 004: SA 1.0 US only, fixed image base, byte-verified sites, coexistence with
  OLA and FLA.
