# Session 26 (2026-08-18): features reach the real game, and a delivery that reverted the install

**On `main`, 16 commits after `710ef278` (session 25's audit), tree clean; tsc + eslint clean; full suite
502 files / 4 604 green with the ONE pre-existing red (`model-osm-uv-anim` times out under full-suite load,
predates session 23). 50 commits ahead of origin — push is his call.** The session ran on after its first
audit; everything below the horizontal rule is part 2, written at the real close. The session did what
it set out to do (plan 011, all five steps, field-accepted) and then paid for a boot crash that had nothing to
do with it: the same delivery reverted the install's FLA ID pools. Both are now closed, and so is the class
behind the second one.

## What changed

| area | change | commit |
| --- | --- | --- |
| `packages/renderware` `vehicle-features.parser.ts` (+ barrel, tests) | **The shared vocabulary module** — `VEHICLE_FEATURE_TOKENS` (15 tokens → their stock carriers), `saCarrierFor(tokens)` (prefer one carrier covering everything, else best cover with the rest as `dropped`, ties by table order), `saAbilitiesOf(model)`, `vehicleFeatureToken(spelling)`. 16 tests. Plan 011 step 1 **and** 098/02's first step: one module, both targets | `c2ae49c2` |
| `tools/vehicle-installer/src/special-features.ts` (+ install/rebake wiring, 14 tests, +2 e2e, +1 rebake test) | **A mod's `features.txt` reaches the REAL game.** On the `sa` target the installer writes `<model> <stock carrier>` into fastman92's `data/model_special_features.dat`: foreign lines kept verbatim, ours in ONE marked and TERMINATED block sorted by model (byte-identical rebuild), a `--rebake --only <car>` speaks only for the cars it rebaked. Six warnings, every one of them silent in the game otherwise | `1844157a` |
| `docs/contracts/vehicles.md` | §1 becomes the FULL 15-token vocabulary with the `sa` carrier and the OpenSA state per token; §2 gains the `model_special_features.dat` row (what a misspelling does, what the log says, what is written when the slot already carries the ability) | `1844157a` |
| `docs/open-issues/mod-inst-rows-folded-before-their-ide.md` (+ README row) | **New open issue, root cause pinned, not fixed**: `mergeGtaDat` appends a mod's `IDE`/`IPL` refs, then the slot fold moves its `inst` rows into stock hosts — so `LAs.ipl` (gta.dat line 93) places id 12780 whose `missing smokes fix.ide` sits at line 158. 39 rows on that id. modloader masks it by supplying the mod IDEs itself | `dca632f9` |
| `docs/open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md` (+ README row), `reference-install.md`, `reference-install-config.md`, `restrictions/sa-target.md` | **The boot crash, closed.** The delivery copied the whole tree ROOT, so `mods-src`' copy of `fastman92limitAdjuster_GTASA.ini` — which never got the 2026-08-10 field raise — took the install from `TXD 6000 / COL 400 / IPL 1024` back to `5000 / 280 / 256` against a build carrying 5 177 `.txd` archives. Raised in `mods-src` (local, gitignored) and recorded in the docs (committed); the delivery trap and the rule are written where a plan will read them | `1cd2ecf9` |
| `tools/vehicle-installer/docs/plans/011-model-special-features.md` | **DONE, all five steps**, with the resolver census, the three decisions the plan did not fix, the real-tree dry run, and the field verdict | `1844157a`, `649acccd`, `1cd2ecf9` |
| `docs/gta-sa-original/vehicle-special-features.md` | The field answers: **FLA does remap a STOCK model id**, the file is read per boot, and the loader's own log lines (including the per-name "does not exist" warning) | `1cd2ecf9` |
| `tools/perfect-map-builder/src/pipeline.ts` (+ 6 tests) | **The guard stops carrying pool constants.** `flaIdPools()` reads `FILE_TYPE_TXD/COL/IPL` off the adjuster ini the build SHIPS into the tree root; a `#`-disabled line, an unapplied `Apply ID limit patch` and a missing ini all fall back to FLA's defaults, said out loud, which is the strict direction. Every log line and failure names the file | `8ccb4f7d` |

## What it cost / what it bought

- **Plan 011 cost about an hour** (three commits, 33 tests) and one 40-second `--rebake --kind sa --only <nine
  cars>` instead of a 10-minute build. The block it produced matched the user's worked example line for line,
  and the field verdict came back the same hour: the features work.
- **The boot crash cost the rest of the session, four field boots and one full rebuild (11 m 28 s).** Six
  hypotheses were falsified before the cause was found, and the two facts that would have pointed at it were
  already on disk: the build's own `report-sa.json` (`TXD archives: spent 5177, ceiling 5000`) and FLA's log
  line `Number of memory changes made` (3632 against the working install's 3712). **Nobody had read either.**
  Both are named in the write-up as the first things to read after a delivery.
- **The rebuild bought a fact worth keeping**: a fresh `sa` build at HEAD produced `gta3.img`, `gta_int.img`,
  `player.img`, `cutscene.img`, `vehicles.img` and `vehicles2.img` **byte-identical** to the delivered tree.
  The pipeline is deterministic on real data, the tree was never damaged, and session 23's mods-folder
  renumbering is proven to change nothing in the install result. `build/original-repro` was deleted after the
  comparison.
- **Two instruments were paid for and are worth reaching for again**: the reversed source resolves a crash
  address (`0x0074E79A` → inside `_rpMaterialListStreamRead`), and the bottle's own logs carry a boot timeline
  (CLEO's registration lines end 5 s before the exit, modloader's last line is only where ITS logging stops).
- One self-correction inside the session: a throwaway script read the archive FAMILY twice and reported
  5 511 `.txd` where the truth is **5 177** — the number the build report had printed all along. Corrected in
  five documents.

## What the session settled

- **A mod car's declared ability now works on the real game**, by the only lever the install has: a model id.
  `feltzer` gets the ZR-350's pods, `bullet` hotknife hydraulics, `infernus` the BF engine — nine slots, all
  stock, which answers the plan's open question: FLA's loader is not limited to added ids.
- **The adjuster ini is a BUILD OUTPUT.** It lives in `mods-src`, the mods stage installs it into the tree
  root, and any delivery of the root carries it into the install. A pool raised only in the bottle is a pool
  that survives exactly until someone delivers the root — and `mods-src/` is gitignored, so the committed
  protection is the number in `reference-install-config.md` plus a guard that reads the ini in force.
- **A guard number ABOVE the install's is silent by construction.** The old constants were right about a
  bottle and wrong about the build; the new reader is right about whatever the tree ships, or strict when it
  cannot tell.
- Delivering the whole tree root also **deletes** what the tree has no copy of (the bottle's `logs/` went that
  way) and replaces every plugin ini. That belongs in the delivery rule, and now is.

## Left for session 27 (his order)

1. **Fix the fold/IDE ordering** (`docs/open-issues/mod-inst-rows-folded-before-their-ide.md`): splice mod
   `IDE` lines before the first `IPL` line, then guard the pair positions in `gta.dat` at build time, then
   re-check with modloader OFF — the only configuration that reports the fault. A restriction row follows the
   fix.
2. His items: push (41 commits ahead), re-upload the cutscene-converter zip if that is still open.
3. Standing: `docs/plans/098-all-land-vehicles/02` can now start from its second step — the shared module it
   waited for is in.

---

# Part 2 — the mod library, one merge, and three rounds on the vehicle optimizer

Written at the real close of the same day. Part 1 above ends with plan 011 and the boot crash; what followed
was his own queue: two new map mods, one mod that needed converting, and a tool bug that turned into the
session's second measurement lesson.

## What changed

| area | change | commit |
| --- | --- | --- |
| `mods-src/original/mods` (local, gitignored) | Two mods arrived at the LAYERED root, where the build refuses to guess (`planLayers` throws naming both). Conflict scan against all three layers: **`bill` 5 names** (Project Lumos ×4, Global Textures Fixes ×1), **`Pre-light Night Lights` 16** (Map Fixes Pack ×6, Neon Objects ×4, Small Prelight Pack ×3, SF Neon Bridge ×2, Project reLIT ×2) — all five owners are prelight/neon mods, so the overlap is by nature. At his word the 21 conflicting `.dff` were deleted (copies kept in the scratchpad), leaving 0 conflicts, and both went into `common` as **`5.` / `6.`** with 63 folders shifted +2 | — |
| `docs/contracts/mods.md`, `restrictions/assets-and-data.md`, `open-issues/road-lawn-crossroads-collision.md`, `benchmarks/index.md` | **A folder's NUMBER is install order, not an identity** — the rule, plus the four live references repointed by NAME with the date the number was true. One reference was ALREADY stale from an earlier renumber, which is the argument | `5c472b4b` |
| `mods-src/…/common/70. HD Aircon` (local) | A mod shipping the FULL stock `multiobj.ide` converted to the repo's shape: its real change is one row (**1617 `nt_aircon1_01` moves `objs` → `anim`** with the `levelxre` clip), written as a `.ide.merge` in the `Animated Radars` pattern, assets into `gta3_img/`. Verified by APPLYING the merge against the built tree's own copy (2 directives, 0 warnings, the row lands in `anim` beside the radar). Its `alleyprop.txd` was rebuilt as a **superset** of `3. Global Textures Fixes`' version (which upscales `hoteldetails2` to 256²) plus the two `aal_aircon1*` textures, spliced chunk-for-chunk so nothing is re-encoded. 58 placements, **0 lod links** — the `anim` move touches no LOD | — |
| `docs/contracts/mods.md` | The rule that came out of it: **a shared `.txd` is replaced WHOLE, so a later mod must carry a superset** — with the lossless splice, the note-what-it-was-derived-from requirement, and `txd-retune --add` for when a re-encode is acceptable | this |
| `tools/vehicle-optimizer/src/cli.ts` | **The reported bug**: `--model`/`--prototype` were resolved against `src/cli.ts`, so only an absolute path worked. Now every path goes through tool-kit's `fromCwd`, and the output lands in an `out/` folder BESIDE the model (`--out <dir>` overrides) instead of in the tool's own directory | `f88ef359` |
| `tools/vehicle-optimizer/src/adapters/gta-sa/copy-effects.ts` (+ 23 tests) | **Three rounds to get the reflection transfer right, two of them mine being wrong.** (1) I widened the "is this material reflective" gate to the SA reflection plugin — measured wrong: the plugin sits on nearly every material (yankee 116/116, walton 180/180) while the env-map MARKS the reflective surfaces, and widening also flipped the reference median 0.16 → 0.50 so the copy transferred nothing. (2) Reverted to the marked set, keeping the parts that were real: a deliberate **0** is never written to (admiral carries 19 such chunks), a target with no marked material falls back, and the run PRINTS what it did. (3) The field still saw nothing, and the measurement said why: **the specular level was the term being looked at** | `dbfc615f`, `169f86e7`, `4866b237`, `5d0a0562` |
| `docs/gta-sa-original/skygfx-fork-vehicle-pipe.md` (+ README row) | Read out of the fork's source: with `vehiclePipe=PS2` the pipe takes the reflection strength from the DFF reflection plugin's `intensity` **quantised to an int8** and multiplies it by **8** (so ≥ 0.125 saturates — 0.5 and 0.16 are identical on screen), and the specular `level` by **3**. Includes what is NOT verifiable from source | `01c33677` |
| `scripts/debug/dff-reflection.ts` (+ README row) | The instrument that ended the argument: all three numbers per texture and as a histogram, `--diff` for a before/after pair. It is what turned "nothing applied" into a table | `743f6044`, this |

## What it cost / what it bought

- **Three field boots on a wrong hypothesis, and the file was never at fault.** The proofs that made that
  certain are cheap and were available from the first round: a byte diff (264 bytes, 66 runs of 4 — exactly the
  floats), modloader's own log line (`Importing model file for index 456`), and — decisively — running the
  PRE-CHANGE implementation beside the current one on the same pair: **0 differing bytes**. That last one should
  be the first move whenever "it used to work" meets "the code changed since".
- **The answer came from the renderer's source, not from ours.** Cloning the install's SkyGfx fork and reading
  `vehiclePipe.cpp` + `gta.h` took minutes and produced the ×8 / ×3 asymmetry, the int8 quantisation, and the
  0.02–0.12 visible band. A field verdict on this install can be a verdict about that plugin — the same lesson
  the building-pipe note already carried, now for vehicles.
- **The measured numbers are what turned three "no change" reports into a fix**: yankee's specular 0.26–0.56
  across 80 of 91 materials against walton's 0.05 (124 of 180). The transfer now moves 91 of 116 materials.
- The mod round cost nothing but scans: every conflict was found statically, and the merge was verified against
  the built tree without a build.

## Coverage, honestly

- `tools/vehicle-optimizer`: **23 tests** on real fixtures (admiral's 19 zero-coefficient chunks, walton as a
  locked reference, the specular collapse, the explicit knobs, the summary shape).
- **The CLI wiring itself is hand-verified only** — no tool in this repo tests its own `cli.ts`; the shared
  helpers it now uses are tested (`tool-kit/src/cli.test.ts`). The verification for this change is in the audit:
  a report run from a relative path, a scaled write into `<model>/out/`, and the same run redirected by `--out`.
- Docs touched in the same changes as the code: the tool's readme, plan 003 (status + a ledger with the
  per-texture measurement), `docs/commands.md` (the tool had no row at all before), the SkyGfx note, both debug
  README rows, and the two mods-contract rules.
- Not built, and named: matching a donor's per-part CHARACTER (by part/dummy or material role) instead of a
  texture name two authors never share — plan 003's ledger says so and stops there.
