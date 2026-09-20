# Audit — the sa build verified, and two guards that lied in opposite directions (2026-08-10)

Commits `2d5f56d8..530e170f` (4), 23 files, +964 −27. Suites after: `tsc` and `eslint` clean, mod-installer
121, perfect-map-builder 38, engine-perf-runs 12. **Three real builds were run** (two `sa` full, one `mods`
stage twice for a positive control) — unlike the previous session, every load-bearing claim here comes from
an artifact rather than from a read.

The session was asked for one thing: **verify a full `sa` build completes** (P0's deliverable, unmeasured
since the int16 guard came out). It does. But the throw was not the only blocker, and finding the real one
opened a chain that ended three subsystems away — in a mod's collision archive.

## What shipped

| # | Change | Where |
| --- | --- | --- |
| 1 | FLA pools raised (IPL 280 → 1024, COL 275 → 400) after the real gate fired; TXD corrected 6000 → the install's actual configuration | `perfect-map-builder/src/pipeline.ts`, `docs/gta-sa-original/` |
| 2 | The `[bench]` report grows a `hitch` block — the only cost columns a frame cap cannot pin | `apps/web/src/ui/engine-perf-runs.ts` + the host loop |
| 3 | `UNCAPPED=1` on the harness; `?procobj` / `?procobjLimit` as runtime clutter knobs | `tools-debug/bench-harness/drive.js`, `engine-canvas-host.tsx` |
| 4 | The target-split invariant is pinned by a test; a pak-vs-game-dir placement verifier | `pipeline.test.ts`, `scripts/debug/pak-placement-parity.ts` |
| 5 | A partial `.col` replacement stops deleting collision in silence | `mod-installer/src/col-replace.ts` |

## The chain, because no step of it was predictable from the one before

**P0's verification failed on a different gate.** The `sa` chain completed every stage (2.3 GB tree, 10 m 9 s)
and then `checkImgIdBudgets` threw: **binary IPL files 522 of 280**. That is FLA's `FILE_TYPE_IPL` — one of
the ceilings the target really has, so the guard was right and the standing rule ("delete the museum pieces,
keep the gates") had just been paid for.

**The cause was the density change, three weeks downstream of itself.** Counted per archive: the layer's
`plobj*_stream*` tiles went **50 → 331** across the column fix, against a 5.96× object count. The knob is
`STREAM_MAX_INST = 512` (instances per binary tile) — **not `AREA_MAX_PAIRS`**, which had been the suspect on
the backlog. The streams hold ~156 600 records at ~92 % tile utilisation, and 156 600 / 512 ≈ 306 against 331
measured. Worth noting for anyone reading the old numbers: the BEFORE state had only 31 slots of headroom, so
this pool was near the wall before anyone looked at it.

**Answered by raising the number, not by shaping the build.** The user's call, and directive 3 applied
directly: an FLA pool is a configured value in an ini. Raising `STREAM_MAX_INST` would have cut the file count
4× at the cost of 4× coarser position streaming — a behaviour change on both targets, deliberately not taken
as part of a build fix. It belongs to the streaming measurement.

## The finding that was NOT asked for, and is the more dangerous one

`IMG_ID_BUDGETS` had carried **TXD 6000 since it was written, while the install's pool was 5000.**
`FILE_TYPE_TXD` carries a `#` in the ini — one of the disabled lines — so FLA left it at its default, and its
own log says so: `20000 - 24999 (5000)`. The build measures **4999 TXD archives**.

So the pool with **one slot of real headroom** was the one printing `4999 of 6000`, and no build could ever
have warned. **A guard number ABOVE the install's is silent by construction: it can only fail to fire.** The
verbatim capture in `docs/gta-sa-original/` quoted the disabled `#FILE_TYPE_TXD = 5000` line two paragraphs
above its own summary claiming 6000, and nobody had read the two together — including, for a month, this
project's own tooling.

The rule that came out of it and is now in `docs/restrictions/sa-target.md`: **read a pool off
`fastman92limitAdjuster.log`, never off the ini** — a disabled line still prints a value.

## The field error, and where it actually came from

The user launched the game and got `Error 0x534134, model ID 3752 does not have loaded collision`. Not the
pools — model 3752 is `ferseat01_LAx`, a stock bench, and its collision was **missing from our build while
present in the source game**.

The chain, each step measured rather than assumed:

| step | measurement |
| --- | --- |
| stock `laxref.col` | 148 collision models, has `ferseat01_LAx` |
| mod 0 / mod 25 copies | 148 / 149 models, both have it |
| **mod 60 copy** | **147 models, does NOT** — and it installs last |
| built tree | 147, byte size matches mod 60's |
| map-wide damage | **2 models lost across 216 archives** |

**A `.col` is a LIBRARY, and the IMG contract replaces an entry whole.** So a mod shipping its own copy to
change one object silently strips the collision of every model it omits. The objects are still placed; they
just have nothing to stand on, which looks like nothing at all. The only reason this surfaced is that the
user had FLA's optional error reporting on — otherwise it was a walk-through bench nobody would ever file.

**Not a bug against the contract — a hole IN the contract**, now written into `docs/contracts/mods.md` (the
author rule, plus what catches you) and `docs/edge-cases/converter-pipeline.md` (the measured scope).

Fixed as the user chose: **B** — the mod's archive restored to 149 models from the stock copy, so the data is
self-contained (`mods-src/` is gitignored, so that fix lives on his disk only); **C** — the installer now
prints `<name>.col replaced — N collision model(s) LOST: …` naming them.

**Confirmed on the artifact, not on the source**: the rebuild after the fix (10 m 1 s) carries
`ferseat01_LAx`, and the census over all 216 archives reports **0 collision models lost** where it reported 2.
The build printed no `LOST` line — which is a meaningful silence, because the same check on the reverted mod
printed both names on a real `mods` stage.

## What the measurement work actually bought

**P1's instrument, and a correction to its plan.** `avgMs` was known to be saturated at the 120 fps period;
`p95Ms` turns out to be pinned too — **9.1 on all nine scenes in both A/A arms** — so the fallback plan 013
named ("read it from p95") was as dead as the mean. The `hitch` block replaces it and does carry signal:
`maxMs` spans 9.4–21 ms across five arms whose `avgMs` is 8.329–8.334.

**P1's load knob turned out not to exist.** The pak bakes the procobj layer into its cells AND the host feeds
`adapter.cellClutter` into an instanced render every frame, which reads exactly like double clutter. It is
not: `convertProcObj` strips every species it bakes, so a built `procobj.dat` is 9 rules of 96, all
underwater. Measured as a null result (`?procobj=0` and `procObjLimit` 1 → 3000 both inside 0.007 %, against
a 0.41 % A/A drift) — **and the positive control failed on the SITE, not the instrument**: `country-dusk` is
dry, so the surviving rules could not have printed non-zero there. Consequence: clutter load on `opensa` is a
BUILD-time quantity, so the perf budget needs two PAKS. One is already on disk (`NO_COMMIT/old_map`, 15 286
objects against 91 092).

**The two targets are the same world, and now both halves are measured.** Input: 46 text IPLs + 331 binary
streams byte-identical between `sa/` (built 08-10) and `opensa/` (built 08-09) — two independent runs, which
also makes the scatter's reproducibility a measurement rather than a claim. Convert: **182 184 / 182 184**
placements found in the pak within 0.05 u. Both halves now have an instrument: a test for the first, a
verifier with its own positive control for the second.

## What it cost

- **Build time**: 10 m 9 s per `sa` run (`sa` stage 60 % of it), three runs plus two `mods` stages.
- **One wrong number published mid-session.** "227 759 placements" was a raw row count that summed two
  different cell LEVELS (`hd` + `lod` rings, 569 cells each) and counted stock instances of shared model
  names as ours. The user caught it. What survived the correction was the part that mattered — `plo*` names
  are ours alone, and there are 110 852 of them in the pak.
- **A lint failure at commit time** because the split test was written after the file's last lint run;
  `vi.fn()` returns `any` and the type-aware rules refuse it.

## What is still open

- **FLA has not re-read the ini.** Its log is rewritten at boot, so nothing yet proves it accepts
  `FILE_TYPE_IPL = 1024`. `reference-install-config.md` says so explicitly rather than implying a capture.
- **The three streaming columns of `hitch` have never printed non-zero in the field** — a settled leg streams
  nothing. Pinned in a unit test now, still owed a field positive control.
- **`UNCAPPED=1` is untested.** If it unpins the headless cost columns, P1's "needs his display" half
  collapses into the automated lane.
- **The collision census compares against `game-src` only**, so a mod dropping a model that another MOD added
  is invisible to it. The new warning catches that case, but only on the next build.

## The afternoon: the field kept talking, and four of my axes were wrong

The morning's work made the `sa` build exist. The user then ran it, and the rest of the day was field
debugging with no commits — everything tried was reverted. It is written down because the WRONG turns are the
expensive part, and three of them were mine to avoid.

**The crash chain, each step measured:**

| # | Symptom | Diagnosis | How it was found |
| --- | --- | --- | --- |
| 1 | `model ID 3752 does not have loaded collision` | a mod's partial `.col` (fixed, see above) | census over 216 archives |
| 2 | Access violation at `0x00405C3A` | **the 40-slot `IplEntityIndexArrays`** | modloader's log ends at `plobj10.ipl`, the stack carries the string `plobj10_`, and `plobj10` is the **40th** inst-bearing IPL |
| 3 | NULL deref at `0x005381A5` | an entity pool exhausted | disassembly: `push 0x38` → allocator → `je` failure path → `xor eax,eax` → `mov eax,[esi]`. `EDX = 100000` = OLA's `Buildings` |
| 4 | World loads as LODs only | **SOLVED the same day** — one mod, five stock models deleted from `gta3.img` while the map still placed them | HIS bisection (all mods up to `60. Pacific Park Rotating Ferris Wheel` play fine, adding it breaks) + the diff of two complete installs he handed over. See [`open-issues/fixed/sa-world-loads-only-lods.md`](../open-issues/fixed/sa-world-loads-only-lods.md) |

**Finding 2 is the one that outlives the session.** `docs/restrictions/sa-target.md` recorded the 40-slot
ceiling as *"lifted — OLA `EntityIpl = unlimited`"*. The setting IS in the install's ini, and the game died on
slot 40 anyway. The reason nobody knew: the reference install carries **36** inst-bearing IPLs, so the lift
had **never been exercised**. And plan 007 had budgeted for this ceiling correctly — *"stock 30 + 8 = 38 ≤ the
40-slot array"* — at 15 283 objects. The density fix took the layer to 91 092, the areas 8 → 46, the slots
38 → 76, and nothing re-checked the budget the plan had written down.

**The four wrong axes, in the order I walked them:** ID pools → stream FILE count → entity count → a mod
corrupting the map. Each was falsified: cutting stream files 533 → 46 (11.6×) changed nothing at all; the
mods-stage repro exonerated procobj entirely; and the mod bisection converged on `0. Map Fixes Pack` before a
trivial mod shipping one `readme.txt` reproduced the marker identically.

**That last one is the process failure worth naming.** The bisection had **no negative control** — every arm
was positive from the first run, and I never asked what an arm WITHOUT the culprit prints. The marker I was
bisecting (`gen_int1.ipl` emptied, 206 rows → 0) turned out to be our own intentional, lossless slot
compaction. I had written the governing lesson into memory that same morning ("a zero is only evidence if the
instrument could have printed non-zero"), applied it to other people's measurements, and not to my own. The
compaction's loss-free property is now pinned by a test, so the next reader gets a one-line answer where I
spent six builds.

**What the field did give us, and it is a lot:** a tight repro (clean game + `.work/1-mods` alone), the
texture-weight measurement (557 → 805 MiB against an unchanged 1024 MB stream budget), archives proven
structurally clean, and ProperFixes' layer measured as a working counter-example on the same machine — 6
files, ~9 600 rows each, every row `lod = -1`, zero binary streams, range from the IDE at 299 m.

## The lesson worth carrying

**Two guards lied in opposite directions and neither could be caught by running the build.** The int16 one
fired on every build to protect a ceiling the target does not have; the TXD one could never fire because its
number was above the ceiling the target does have. The first was loud and wrong, the second silent and wrong,
and the same question separates them: *what is the install actually configured with?* Not what the ini file
contains, not what a doc summarised — what the adjuster's own log says it built.

**The afternoon added its mirror image, and it is the same question again.** `EntityIpl = unlimited` was in
the ini, the doc said "lifted", and the game died on slot 40 — because the install had never carried more than
36 and nothing had ever tested the lift. So: **a ceiling you have never crossed is not a ceiling anyone has
lifted.** Read a limit off the artifact that enforces it, and if you cannot, treat the number as real until
something crosses it and survives.

And one about method rather than about SA: **an instrument that has only ever printed one answer has told you
nothing.** It cost a whole bisection — six builds converging confidently on an innocent mod — and the guard
against it is a single cheap run: the arm you expect to be NEGATIVE.

---

## The close, same day: symptom 4 solved, and the answer had been on this page all along

**He bisected it himself and it was one mod:** every mod up to `60. Pacific Park Rotating Ferris Wheel` installs
and plays perfectly, adding that one gives slowdowns and an empty world. He handed over both complete installs,
which turned the rest into a diff instead of a theory.

**Our installer read the mod's `gta3_img/Remove original/` folder as a delete list.** It is not one: the five
files are one 653-byte empty RW clump each, meant to REPLACE the stock geometry so the mod's script can draw its
own wheel (stock is 4 341-66 357 B of payload, all different). Deleting the entries left five stock models
declared by `LAw2/LAxref.IDE` and placed by **23 inst rows** with nothing in any archive to stream. Fixed, gated
and field-confirmed the same day — `tools/mod-installer/docs/plans/010-remove-original-is-a-replacement.md`.

**What this audit has to admit.** The defect is written on this page, in the open-issue it links, under a heading
that says *"Related, real, and NOT this symptom"*: **5 object definitions with no DFF after the mods stage, defined,
placed, no geometry.** I measured it, wrote it down, ranked it as a side-finding, and spent the day on ID pools,
stream file counts and entity counts. What made it look harmless was the clean game's own count of **1** — and that
one, `carupg_int_rays`, is placed NOWHERE. Placement was the whole discriminator and it was one query away.

So the fifth lesson of the day is not about SA at all: **when the leading hypothesis dies, re-read the discard pile
before generating a new one.** A finding filed as unrelated is still a finding, and "unrelated" was my ranking, not
a measurement. The four wrong axes each cost a 10-minute build; re-reading my own notes would have cost nothing.

The sibling lesson, on the thing that made the misreading possible in the first place: **a convention's NAME is not
its specification.** Three checks settle it and none needs the author — what are the BYTES (empty clumps, not
backups), where does the name SIT (inside the injection path), and what can the real loader physically DO
(Modloader has no delete mechanism at all). A folder name that reads as an imperative is exactly where to run them.
