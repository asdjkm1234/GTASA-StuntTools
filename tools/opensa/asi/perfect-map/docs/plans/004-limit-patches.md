# 004 — Limit-lift patches (the payload)

Part of the [perfect-map ASI chain](readme.md). Depends on [003](003-patch-framework.md) (safe declarative machinery) which depends on [001](001-reverse-engineering.md) (the addresses). This is the whole point of the chain: **remove the int16 ceiling** so builds can add unlimited objects.

> **Historical record — the framework this plan built now lives in [`asi/sdk`](../../../sdk/README.md)**
> (namespace `asi::`, headers in `asi/sdk/include/asi/`, build rules in `asi/sdk/mk/asi-plugin.mk`),
> extracted 2026-08-06 by the [asi/sdk chain](../../../sdk/docs/plans/readme.md). Paths to
> `log/mem/hook/fingerprint/coexistence/patch_table.hpp` and `freestanding.cpp` below are where they
> were WHEN THIS SHIPPED; the text is left unedited on purpose. `asi/perfect-map` keeps only its
> catalogue, payloads, config knobs and a thin Makefile.

## Context

The four unbounded structures, from [ghost-barriers.md](../../../../docs/open-issues/fixed/ghost-barriers.md), in impact order:

1. **`IplDef` int16 pool indexes** — THE root cause. `CIplStore::IncludeEntity` (0x404C90) truncates building-pool indexes to int16; `RemoveIpl` deletes entities by that `[firstBuilding..lastBuilding]` range. Past 32,767 permanent text rows the ranges wrap negative → stream-out corrupts CIplStore → ghost barriers + crashes. Ceiling: **2^15**, bisected exactly.
2. **`gpLoadedBuildings`** (0xBCC0E0, `CFileLoader::LoadScene`) — 4096 rows/scene into a static array; a 30k monolith writes ~26k pointers past it → trashed statics.
3. **`IplEntityIndexArrays`** (0x8E3F08) — 40 slots (one per gta.dat text IPL with inst rows); slot 41+ overwrites neighbours → boot crash in `LoadIplBoundingBox`.
4. **FLA×OLA `LinkLods` double-patch** — not ours to fix, but ours to NOT collide with (handled by 003's coexistence).

Our build's current work-around budgets (≤30k rows, ≤39 slots) exist ONLY because of 1–3. Lifting them is this plan; relaxing the budgets is [006](006-pipeline-integration.md).

## Decisions

1. **Widen by relocation, not in-place field edits, where the struct layout is fixed.** Per 001's per-structure strategy: `IplDef`'s int16 fields can't grow in place (the struct has a fixed size the whole engine indexes). The robust fix is to **widen the truncation logic to int32 and back the values with a parallel int32 store** keyed by IPL, OR relocate the pool-index bookkeeping — 001 decides which is minimal-and-complete. The patch here implements that decision; the completeness check (EVERY read of the four fields is covered) is the acceptance bar.
2. **Enlarge/relocate the two arrays** (`gpLoadedBuildings`, `IplEntityIndexArrays`) to our own `VirtualAlloc`'d blocks sized generously (e.g. 16× headroom), repointing every accessor found in 001. Static arrays are the easy case — no logic change, just base-pointer + bound edits.
3. **Each logical fix is one or more entries in 003's patch table** — declared, byte-verified, conflict-guarded, logged. No raw `WriteMemory` outside the table.
4. **Prove each fix independently.** A staged bring-up: patch (2) and (3) first (they crash at boot on big builds — easy pass/fail), then (1) (the subtle corruption — needs the row-count bisection test). Ship a build config that enables patches individually for bisection during bring-up.
5. **Headroom, not infinity.** int32 pool indexes + generously-sized arrays lift the ceiling far past any real build (millions of rows) without pretending other SA limits (streaming memory, pool sizes owned by FLA) vanish — those stay FLA's job. We fix exactly the truncation/overflow bugs, and document that streaming-memory/pool sizing is still FLA's domain (our ASI + FLA compose).

## Tasks

- [x] **Fix (1) `IplDef` int16 → int32 (buildings) — DONE, confirmed in-game.** `src/patches/int16.hpp`: OBSERVE `IncludeEntity` (0x404C90→body 0x1563730) → int32 sidecar (pure min/max); SNAPSHOT at `RemoveIpl` entry (0x404B20) + reset; REDIRECT its THREE building-bound reads (0x404B4A, 0x404B5D, and the loop back-edge re-read **0x404BA8**) to the snapshot so the delete loop iterates the full int32 range. Minimal blast radius — object/dummy/delete/car-gen untouched. Works over stock (OLA/vanilla) AND over FLA's jmp-hooks (we overlay). **Verified in-game: ghost barriers gone with FLA+OLA on the 33k repro.** Dummies were left alone on a live diagnosis that they don't overflow — **FALSIFIED in the field 2026-08-19**, and the dummy half is now [011](011-ipldef-dummy-range.md).
- [x] Per-fix enable flags for bring-up bisection (`config.hpp`: `PM_APPLY`, `PM_FIX_INT16/…`); `make APPLY=1`, default = verify-only.
- [x] Self-authored hook primitive (`hook.hpp`: `WriteJmp` + observe/replace trampolines) — injector.hpp rejected (pulls `<cstdio>`/gvm, breaks `-nostdlib`); our clean-entry case needs no relocation lib. Apply orchestration + coexistence-defer (`apply.hpp`).
- [ ] Fix (1b) `IplDef` **dummy** range int16 -> int32 — the original "004b", now its own plan: [011](011-ipldef-dummy-range.md). Mandatory: the pool cannot be kept inside int16 (`Dummys = 32767` does not boot)
- [ ] Fix (2) `gpLoadedBuildings` relocation + bound — **004b** (`PM_FIX_LOADEDBUILDINGS`, not yet implemented; defers to FLA on the user's install anyway).
- [ ] Fix (3) `IplEntityIndexArrays` relocation — **004b** (`PM_FIX_IPLINDEX`).
- [ ] In-game validation ladder (Wine), driven by **[the repro dial](../../../../tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md)**: a >33k-row build past the 2^15 flip runs WITHOUT ghost barriers and survives teleport-save near the Hampton Barns bridge (fix 1). Then dial higher `N`, confirm no flip. **Blocked on Wine + a clean install (see coexistence note).**
- [ ] Regression: stock/unmodded game still boots (patches inert when limits aren't exceeded).

## Verification

- The ghost-barriers repro (>33k rows, save near the bridge) that flips the bug at 2^15 is CLEAN with our ASI and no ProperFixes installed — the standing goal met with our own code.
- Stock game unaffected; each fix independently demonstrable via its enable flag.
- All patches byte-verified against 1.0 US; wrong version / FLA-owned zones handled by 003.

## Measurements / notes

### Iteration 1 (2026-07-09) — fix #1 buildings shipped (Wine-pending)

- **Build:** `make APPLY=1` → `perfect-map.asi` 12,800 B, KERNEL32-only (adds VirtualAlloc/VirtualProtect for
  the runtime trampolines). Default `make` stays verify-only (9,216 B). Both compile clean (`-Wall -Wextra`).
- **Mechanism:** sizeof(CBuilding)=0x38 (verified: magic 0x92492493/sar5 = /56); buildingId =
  (entity − buildingPool.m_pObjects)/0x38; sidecar `int32[256]` first/last per IPL slot; fresh-slot reset detected
  via the engine's `IplDef.firstBuilding==SHRT_MAX`. RemoveIpl bound-read detours computed slot =
  (ipldef − IplDefPool.m_pObjects)/0x34 and load the sidecar into edi/edx, keeping the original delete loop.
- **⚠ Coexistence — it's OLA, not FLA, that owns `0x404B4A`** (user-bisected 2026-07-09: removing FLA still
  DEFERs; removing **OLA** (`III.VC.SA.LimitAdjuster`) → `int16 APPLIED (buildings)`). So on any install with OLA,
  our detour at 0x404B4A conflicts → we DEFER (safe). Yet OLA does NOT lift the ceiling (the bug reproduces with
  it). Studying OLA's IPL patch (open source, github.com/GTAmodding/III.VC.SA.LimitAdjuster) to coexist / learn.
- **Clean validation path:** a bare **1.0 US install with NO adjusters** + the **int16-repro 33k build** (generated
  at `./NO_COMMIT/repro-33k`: 33,000 rows / 36 slots — fits stock's 40-slot / 4096-per-file limits, so it loads on
  vanilla and triggers ONLY the int16 ceiling). Confirmed our fix APPLIES there (`no limit adjuster detected → int16
APPLIED`). Next: boot it + APPLY asi, teleport-save near the Hampton Barns bridge, verify the ghosts are gone.
  (The `./1` modded map itself needs OLA's raised pools to load, so it can't be the no-adjuster test vehicle — the
  synthetic 33k build is.)

### ✅ Fix #1 (buildings) WORKS in-game (2026-07-09) — the standing goal met

Confirmed by the user on the real install (OLA raising the building pool + int16-repro 33k map): with
`perfect-map.asi` (tag `int16-fix2`) the **ghost barriers are GONE** and teleport-save near the bridge no longer
crashes — our OWN engine patch removes the int16 ceiling, the chain's whole point.

**Final mechanism (`src/patches/int16.hpp`):**

- Observe `IncludeEntity` (0x404C90→body 0x1563730) → pure int32 min/max into a per-slot sidecar.
- Hook `RemoveIpl` entry (0x404B20) → snapshot the slot's range for the detours, then reset the slot (lifecycle
  reset — the old `firstBuilding==SHRT_MAX` fresh-detect was WRONG: the engine keeps firstBuilding at SHRT_MAX for
  slots whose buildings are ALL >32767, so it fired every call and collapsed the range to a single element).
- Three detours feeding the snapshot into RemoveIpl's building loop: initial `firstBuilding` (0x404B4A), initial
  `lastBuilding` (0x404B5D), AND the **loop back-edge re-read** of `lastBuilding` (0x404BA8) — the compiled
  `for(i=first; i<last; i++)` re-reads `def->lastBuilding` from memory every iteration; missing that made the loop
  stop after one building (the last bug). Confirmed sole reader (exe scan + gta-reversed grep).

**Coexistence — BOTH confirmed in-game (2026-07-09):**

- **OLA** doesn't touch our sites → detours apply cleanly. Bug gone. ✅
- **FLA** jmp-hooks the three read sites (0x404B4A/5D/A8 → its own handlers ~0x22C49xx) but NOT the entries — so
  we verify entries + detour continuations and FORCE the detours over FLA's jmps, overlaying FLA's incomplete
  int16 patch with our complete one. **Confirmed: `int16 APPLIED`, bug gone with FLA+OLA loaded.** ✅
- Same binary works over stock (OLA/vanilla) and FLA because the detours hardcode the relocated stock instruction
  - jump to a fixed continuation.

- max rows tested clean (target ≫ 2^15): sidecar ranges observed up to ~38,437 with no flip; higher `N` pending.
- new effective ceiling + remaining FLA-owned limits: int32 pool range (millions); streaming/pool sizes stay FLA/OLA's.

### Pivotal correction (2026-07-09) — the int16 bug REQUIRES a pool-raising adjuster

The user's no-adjuster boot crashed at **0x5381A5** (`mov eax,[esi]`, esi=0) — `CBuilding` pool `New` returned
null: EDX=0x32C8=**13000** = the stock CBuilding pool capacity, and our int16-repro 33k build adds ~23,732
building instances → **building-pool exhaustion**. Confirmed NOT our ASI (crashes with perfect-map.asi removed).
Consequence: a building at pool index >32,767 needs a pool >32,767; stock is 13,000 → **the int16 IplDef bug
cannot exist without OLA/FLA raising the building pool.** So there is NO clean-install test — **fix #1 must
COEXIST with OLA/FLA**, which raise the pool, and run alongside them.

**OLA study** (github.com/GTAmodding/III.VC.SA.LimitAdjuster, source read): OLA does **not** fix or even touch the
int16 ceiling — `0x404B4A` is byte-stock in OLA; it never patches `RemoveIpl`/`IncludeEntity`/`IplDef`. It only
relocates two IPL arrays via `injector` `MakeCALL` growers: `EntitiesPerIpl` (gpLoadedBuildings 0xBCC0E0 @
0x5B892A, rewrites operands incl. 0x5B8938+3) and `EntityIpl` (IplEntityIndexArrays 0x8E3F08 @ 0x5B8A36). Those
are our #2/#3 zones — so **#2/#3 defer to OLA** (as designed); **#1 is free** (OLA leaves it stock). Both default
to `unlimited` in OLA's ini. ⇒ our #1 fix stays necessary and shouldn't collide with OLA at 0x404B4A.

~~**Open:**~~ **CLOSED 2026-08-07 by the field run below.** Our APPLY build had still DEFERRED with OLA present
(some #1 verify site differed) even though OLA doesn't touch 0x404B4A, and the fix was to run a per-site
diagnostic WITH OLA and adjust coexistence. That is no longer needed: #1 **applied and worked with OLA
loaded**, on ProperFixes' 70k-row map. Do not re-run the diagnostic without a fresh reason.

### ✅ Third-party validation at 2.14× the ceiling (2026-08-07)

Field run on the real install: **ProperFixes 2.2.1 with its "increase vegetation distance" optional** —
57 583 permanent text rows of its own on top of stock's 12 629, i.e. **70 212 map-wide**, in six IPL slots.
**FLA and OLA were BOTH loaded in both arms** — our own log names them — with OLA owning the IPL zones and
FLA's entire `[IPL]` section disabled, which is how they coexist. A pool-raiser is required — the symptom cannot exist without a
pool-raiser, so OLA is the floor the experiment stands on, not a confound. The only variable was the int16
patch:

- `ProperFixes.asi` removed → **ghost barriers reproduce on its data.** So the mod is genuinely over the
  ceiling, its own `.asi` is what normally hides that, and **OLA does not lift the int16 truncation** —
  exactly as the OLA source study above predicted from the source.
- `perfect-map.asi` in its place → **barriers gone, and the new-game 2dfx crash gone** (#6, the `FxSystem_c`
  guard — 009).

This is the first time either patch has been proven on a map nobody here authored, and at more than twice the
int16 ceiling; before it, the evidence was our own 33k repro dial and our own 30 566-row monolith.

**What it does not cover:** ProperFixes uses six IPL slots, so `IplEntityIndexArrays` was never stressed and
#2/#3 (`004b`) remain unmeasured in the field. The shipping configuration for a dense map is still **an
adjuster for the pools and slots PLUS our ASI for int16** — which is the argument for building `004b`, not
against it.
