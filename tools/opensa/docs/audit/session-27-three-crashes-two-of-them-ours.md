# Session 27 (2026-08-19): three crashes, two of them ours

**On `main`, 9 commits after `9b928d3b` (session 26 part 2), tree clean; `tsc` + `eslint` clean; full suite
**505 files / 4 629 green — the first fully green run since session 22**, the four-session red closed on the
first item. Verified after a from-scratch `npm run test:fixtures` regeneration, not just in place.**

The session was his four-item list. Items 1 and 3 closed, item 2 diagnosed to the instruction level and
planned, plus a build guard he asked for on the way. Everything here was found by reading the shipping
`gta_sa.exe`, and two of the three defects turned out to be ours rather than the game's.

## What changed

| area | change | commit |
| --- | --- | --- |
| `packages/renderware` `vehicle/translucent-clusters.ts` (+1 test) | **The flaky test was never a test problem.** 91 % of its 3.7 s sat in `closestPair`: the agglomeration re-scanned every cluster pair before every merge — O(n³) — and the ferris ring is **1 440 separate bulbs over 50 400 triangles in ONE material group**. Replaced by a cached nearest-partner-per-row, merge order preserved exactly. **3 745 → 412 ms**, and the curve proves the class (1 440 pieces 3 238 → 25 ms) | `54c77e1d` |
| `docs/benchmarks/tools/2026-08-19-translucent-cluster-agglomeration.md` (+ index) | the before/after table at five sizes, the A/B method, and an explicit statement of what was **not** measured (the effect on a full pak build) | `54c77e1d` |
| `docs/open-issues/sa-load-game-crash-dummy-pool.md` (+ README row), `restrictions/sa-target.md` (2 rows), `gta-sa-original/{reference-install,reference-install-config,fla-id-limits-are-part-of-the-savefile}.md` | **The LOAD GAME crash: cause found, ours, not fixed.** `0x00538103` = `CFileLoader::LoadObjectInstance`; disassembled from the install's own exe, the `CPool<CDummy>` allocator returns null, the game jumps PAST the constructor and dereferences it. Dummies are never released between world entries because `IplDef.firstDummy/lastDummy` are int16 and `perfect-map.asi` lifts only the BUILDING pair | `24d876d4`, `95c0d9fe`, `5d520d88` |
| `asi/perfect-map/docs/plans/011-ipldef-dummy-range.md` (+ chain readme, 004's task line, patch catalogue) | **plan 011 — the deferred "004b"**, seven steps, sized off the exe: two detours (not three — the two pre-loop reads are adjacent), the `jle` inclusive-bound trap, and a step 1 that is a GATE which can invalidate the whole plan | `69edb50b` |
| `packages/renderware` `parsers/binary/frame-order.ts` (+10 tests), `tools/vehicle-installer` `img-merge.ts` / `apply-vehicle.ts` (+2 tests), `docs/gta-sa-original/rw-frame-list-parent-order.md`, `contracts/vehicles.md` §3 | **The tuning crash, older than the project: FIXED and field-accepted.** A DFF frame list whose parent is declared AFTER its child; RenderWare parents in the pass that creates it, so it reads an unwritten slot. One file in 2 096 swept. `reorderFrameList` is a permutation, and `stageVehicleImg` checks every `.dff` with a bounded 64 KiB probe | `c0a18e3d`, `ac050ef4` |
| `tools/perfect-map-builder/src/entity-pools.ts` (+10 tests), `pipeline.ts` (guard call + `report-sa.json` field), `architecture/perfect-map-builder.md` + its diagram, `edge-cases/sa-runtime-limits.md` | **The build guard.** Splits every `inst` row by `object.dat` the way `LoadObjectInstance` does, counts the streamed half, reads `Buildings`/`Dummys` off the OLA ini the build ships, gates on the PERMANENT rows and states the leak arithmetic | `d9b9f960` |
| `scripts/lib/img-patch.ts` (+1 test), `docs/debug/README.md` | **Our own instrument was aiming at the wrong record.** Its directory index was last-wins; SA reads the FIRST record, so a `set` on a duplicated name patched the copy the game never opens and reported success | `2e00df9a` |

## The three crashes

### 1. LOAD GAME — the dummy pool (ours, not fixed)

Proven from the exe, not from a community list: the allocator returns null at `0x5380E3`, the code
`je`s past the constructor at `0x5380F5`, and `0x538103` dereferences the null it just accepted. Every
register in the dump matches, twice — `EDX` even carries the configured pool size (`0xC350` = 50 000,
`0x7FFF` = 32 767), agreeing with the ini both times.

The count grows per world entry, and the field measured the rate in both directions: `Dummys = 50000` dies
on the **third** LOAD GAME, `100000` on the **sixth**. That is `floor(pool / 17 644)` entries per boot and
nothing else. The `32767` experiment was the decisive one — it does **not boot**, which killed the only
non-ASI workaround and turned plan 011 from one option among several into the only one.

### 2. Tuning parts — a DFF frame list (ours to catch, not ours to cause)

`0x007F0BF7` in `RwFrameAddChild`. RenderWare's clump reader writes `frames[i]` and parents it in the same
loop (`0x807B32` reads `frames[parentIndex]` two instructions later), with no bounds check and no ordering
check. A forward parent reference reads an unwritten slot, and what happens next is decided by leftover
memory — which is exactly why Transfender was *sometimes* and the trainer *always*.

One file across 2 096 swept: the blade mod's `wg_r_lr_bl1.dff`, `parents=[1, -1]` where its own mirrored
sibling ships `[-1, 0]`. Same size, same chunk layout, same hierarchy — serialised child-first. Our archive
copy was byte-identical to the mod's file, so the pipeline neither caused it nor could have; the mod is
dated 2008, which matches his "older than the project".

### 3. The delivery that changed nothing

The first field attempt swapped the repaired model into the bottle with an editor that **added** the entry
instead of replacing it, leaving the name twice — broken at index 163, repaired at 454. SA maps a model to
the FIRST record, so the crash did not move. `img-patch.ts` would not have helped either (last-wins index),
and is fixed. `--rebake --kind sa --only blade` (5.5 s) replaced by name across the archive family, and the
field accepted it: **0 duplicate names on 456 + 338 entries, tuning works.**

## The measurement that was wrong, and how it was caught

The first entity census was a throwaway that split `object.dat` on whitespace and took each row's name as it
found it. The file writes `lamppost3,` **with a trailing comma**, so every comma-terminated name failed to
match its IPL rows and counted as a building. It under-reported dummies by 10 655 and stated the building
headroom as 3.2 % when it is 10.3 %. Corrected numbers, from the shipped parsers:

| | rows | → `CPool<CBuilding>` | → `CPool<CDummy>` |
| --- | ---: | ---: | ---: |
| stock SA, permanent | 9 268 | 9 209 | **59** |
| stock SA, streamed | 41 667 | 25 624 | 16 043 |
| our `sa` build, permanent | 127 384 | 109 740 | **17 644** |
| our `sa` build, streamed | 40 200 | 24 801 | 15 399 |

**Stock holds 59 permanent dummies; we hold 17 644 — 299×**, and the streamed halves are comparable, so the
whole difference is in what is placed forever (17 311 of ours are the procobj bake, eleven models). The
corrected peak, 33 043, is **already past the int16 ceiling of 32 767**, which is a second and independent
reason the pool cannot be kept inside that field.

Two further instrument errors were caught the same way and are worth keeping: walking a clump with a
boundary-respecting `findChild` skips anti-rip-**locked** files silently (87 → 3 unreadable once switched to
`forEachClumpChild`, which is what `parseDff` uses), and the first version of the build guard **gated on the
peak** — it failed the stock tree, which is how the error surfaced. Stock's binary IPLs hold 25 624 building
rows against a 13 000 pool and the game has run since 2004, because they stream: the permanent rows are the
budget, the streamed ones are a ceiling nobody reaches.

## Cost and gain

- **Gain, measured**: the suite's only red for four sessions is gone and its slowest test is 9× faster; one
  field crash fixed and accepted; one field crash explained to the instruction level with a written plan;
  two silent guard gaps closed (`CPool<CDummy>` was in no build report at all) and two instruments corrected.
- **Cost**: no rebuild was spent. One `--rebake --kind sa` (5.5 s) and one two-archive delivery. The
  agglomeration change is the only behavioural change to a shipped output, and it was proved byte-identical
  across all 4 605 tests before it was kept.
- **Not measured**: the effect of the clustering fix on a full pak build — it depends on how many models
  carry many-component translucent groups, which nobody has counted. Stated in the benchmark rather than
  guessed at.

## Left open

- **`004b` is the next session's first task** — plan 011, and its step 1 is a gate that can invalidate the
  rest, so it runs before anything is written.
- Items 3 (the second bug he has not named) and 4 (does `vehicle-installer` read every file kind a car
  folder ships) of his list.
- **mod-installer has no frame-order check.** 0 of 1 706 map-mod DFFs need it today, which is why it was not
  built; that measurement is what to re-run before assuming it stays true.
- **The delivery hazard stands**: `build/original/sa` still ships `Dummys = 50000` while the bottle and
  `mods-src` are at 100 000. A whole-tree-root delivery from the current tree puts the LOAD GAME crash back.
