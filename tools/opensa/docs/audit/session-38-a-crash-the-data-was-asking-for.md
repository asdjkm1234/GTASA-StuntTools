# Session 38 (2026-08-22) — a crash the data had been asking for, and a plan that closed

Two builds, five subsystems, 14 commits. The day's shape: **lod-trees 013 closed and field-accepted on both
targets**, and a reproducible crash in the real game was traced from a stack dump to a rule the fleet's own
data had been breaking for months.

Checked at the close: **4 916 tests green (525 files)**, `tsc` and `eslint` clean, **0 broken links across 820
markdown files**.

## 1. lod-trees 013 — DONE, field-accepted on both targets

Both targets rebuilt (the first `opensa` pak ever to carry any of the plan), everything measured off the
shipped bytes rather than the bake, and the verdict came back: *"definitely better on both — the LOD→HD
transition is much less noticeable, no defects."*

- The chain's own audit: [`lod-trees-013-impostor-parity.md`](./lod-trees-013-impostor-parity.md).
- Numbers on the built trees: `benchmarks/tools/2026-08-22-lod-trees-013-on-the-built-trees.md` — 6 triangles
  per impostor on `sa` and 8 on `opensa`, **182 of 184 rows classify as vegetation (67 without the `lod`-strip
  retry, and 0 by their own name)**, the pak welding **49 820 impostor triangles ALL cutout**, sway in 425 of
  562 LOD cells against 435 of 562 HD.
- Frame cost: `benchmarks/opensa-engine/2026-08-22-lod-trees-013-sweep.md` — **mean frame −1.9 %, GPU pass
  −2.8 %, slow frames 35 → 24**, on his own display lane against the pre-013 pak.
- Build cost: `benchmarks/tools/2026-08-22-pmb-both-targets-after-013.md` — `opensa` stage **2 532 → 2 529.5 s
  (unchanged)**, the whole +616 s of the run being the `trees` stage.
- `asi/perfect-vegetation` deleted with a [postmortem](../postmortem/asi-perfect-vegetation-view-weighted-cards.md):
  it existed to weight card alpha at draw time, and step 06 did the same in the bake.

## 2. The crash: `0x007F0BF7`, twice, from a helicopter

**The subject of this session.** The chain of reasoning is worth keeping because each step was cheap and each
one narrowed the next.

1. **The log named the class.** `CrashInfo`'s own database (downloaded into the bottle that morning) has the
   address verbatim: *"frame did not find the child — installing a tuning part on a vehicle that does not
   support it."* ESI = 0, faulting read at `+0x98`, consistent.
2. **The second cause it names was excluded by looking**: no save games exist in the bottle, so "a car saved
   in a garage" was out. And the bottle's tuning data matched the build file-for-file, so it was not a stale
   delivery.
3. **Two of my own hypotheses died on controls** — nitro mounts on `misc_a` (67 of 77 STOCK nitro cars have no
   such frame), and "46 renamed parts have no model" (they ship loose in `modloader/added-vehicles/`).
4. **The dumps carried the part id.** Same stack slot in both: `0x3F4` = 1012 `bnt_b_sc_p_l`, `0x3ED` = 1005
   `bnt_b_sc_l` — hood scoops, two different cars.
5. **The mount table came out of stock data.** Every stock car offered `bnt_b_*` carries `ug_bonnet`, all 31
   with `spl_b_*` carry `ug_spoiler`, all 77 with nitro carry `ug_nitro` — and **stock SA has 0 of 77 cars
   offering a part it cannot mount. Our tree had 30 of 154.**
6. **He read the census and named the cause himself**: a replaced car ships no `carmods` line, so it inherits
   the stock one — a kit its model was never adapted to. Three of the four inheritors are the cars that
   crashed.

Fixed in two halves, both his call: the installer now REMOVES the stock line from a car that declares none
(`vehicle-installer` [plan 015](../../tools/vehicle-installer/docs/plans/015-a-replaced-car-does-not-inherit-tuning.md)),
and the 26 cars that declared a line naming unmountable parts had that line deleted from their own settings
files. The rule is in [`contracts/vehicles.md`](../contracts/vehicles.md); the fact that **nothing in the
build enforces the second half** is in [`hacks/`](../hacks/carmods-lines-hand-cleaned.md) and
[`restrictions/assets-and-data.md`](../restrictions/assets-and-data.md).

Related, same morning: `add-vehicles` stopped putting the nitro family into tuned-traffic sections at all —
154 sections and 457 tokens of mount work for parts nobody can see from outside a car.

## 3. `gta.dat` definition order — found, fixed, verified on the build

`mergeGtaDat` appended a mod's IDE refs while the IPL slot fold moved that mod's rows into stock hosts chosen
by capacity, 55+ lines earlier. Measured on the tree without rebuilding it: **137 rows / 31 ids from six mod
IDEs**, not the one id the issue had recorded; stock 0 of 9 268. Fixed by splicing the IDE refs before the
first `IPL` line, guarded by `assertDefinitionOrder` on the finished tree, and **the build that carries it
reports 0 of 127 384** (`mod-installer` plan 016; the issue is now in `open-issues/fixed/`).

## 4. Two smaller things the day surfaced

- **`lod-common`'s merge writer now puts blended splits last**, closing the last SILENT half of a restriction
  written in session 17. Measured while doing it: a single clone was already correct (`buildClumpMesh` yields
  split order), so the rule bites on merges — opensa cells and hole-fill.
- **A failed pmb run no longer leaves the previous run's numbers on disk.** `build-timings.json` gains
  `startedAt`/`finishedAt`/`status`, is written by whichever step throws, and both it and the run's
  `report-<target>.json` are cleared on entry — past every refusal, so a rejected `--resume` destroys nothing.

## What this session should be remembered for

1. **A crash dump is data, not noise.** The upgrade id sat in the same stack slot in both dumps; reading it
   turned "something about tuning" into two named parts on two named cars.
2. **Controls killed two of my hypotheses in minutes** — both times by running the same census on STOCK SA.
   The lesson is now cheap to repeat: any rule about our data should be run against R\*'s first, because
   `0 of 77` is what a real invariant looks like.
3. **The user out-diagnosed the instrument.** I had a census of unmountable parts and was building a
   mount-check; he read the list and saw the cause behind it — inheritance — which is a smaller, earlier fix
   in a different file.
4. **A gap recorded is a gap that stays visible.** The mount check was not built; it is written down three
   times over (contract, restriction, hack) with its trigger, so the next `0x007F0BF7` costs an afternoon
   rather than a session.
5. **The doc lifecycle absorbed two dispositions** without either being deleted: a dead ASI to `postmortem/`,
   a never-reproducing crash to a new `open-issues/not-reproduced/`.
