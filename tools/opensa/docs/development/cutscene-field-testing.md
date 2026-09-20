# Field-testing cutscene bugs in the real game (the CLEO override loop)

How converted cutscene vehicles are verified and debugged IN GTA:SA itself — the instrument, the
per-scene loop, the forensic toolkit, and the rules that keep a fix round honest. This is the method
that closed plan 002's gates and drove plan 004's twelve fix rounds (lamp markers, the five-round
glass chain, the burrito's VehFuncs decomposition).

## Why an instrument at all

A cutscene defect is only visible inside a playing cutscene, and story progression to a given scene
costs minutes-to-hours per look. The override collapses that to **~15 seconds per verdict**: any of
the game's 148 cutscenes plays at its real world site, with the real anims, camera and models, from a
fresh session. The whole 35-scene vehicle sweep (plan 004's ledger) is only feasible because a
verdict costs an ini edit, not a playthrough.

## The instrument

`cleo/scripts/cutscene-override/` (chain plan 003) — a 792 B `.sa-only.cs` CLEO script + sidecar ini,
living in the CrossOver bottle's `CLEO/`:

- `CLEO/cutscene-override.ini` — `scene = <NAME>` arms a scene (`BCESAR5`, `FARL_3B`, …; the ini
  lists all 148); empty = inert. Editing the ini IS the whole per-scene setup.
- Start a new game (skip the intro) or load a save → the script warps to the scene's world site,
  preloads, disables traffic, plays the scene, restores control after.
- The four traps its 12 build rounds recorded (boot race, ONMISSION in the intro, byte-offset
  globals, the failure-marker ini read) live in `docs/edge-cases/cleo-vm.md` and the script's README.

The bottle (`~/Library/Application Support/CrossOver/Bottles/Win10/drive_c/GTA SA/GTA San Andreas`)
runs the REAL 1.0 US game; its gameplay is stock, so cutscene builds are self-contained
(`--self-contained-txd`). Vanilla `cutscene.img`/`txdcut.ide`/`anim/cuts.img` sit beside the
installed ones as `.vanilla` — restoring them is the vanilla A/B, the cheapest decisive experiment
there is.

## The loop (one scene, one variable)

1. **Arm**: write `scene = <NAME>` into the bottle ini (the sweep order lives in plan 004's ledger).
2. **Run** (the user): launch, ~15 s to the scene, verdict against the LOOK-FOR list — vehicles
   present and mod-shaped, wheels both sides, doors/parts riding their anims, gameplay paint, plates
   readable, glass see-through with tint and sheen, lamps lit right, nothing floating/sunk/stacked.
   Findings come back as exact deltas, usually with a screenshot.
3. **Decompose offline** — never fix from the pixels alone. The finding is reproduced against the
   MODEL DATA (see the toolkit below) until the mechanism is measured; the screenshot only picks
   which measurement to make.
4. **Fix ONE variable**, rebuild the fleet, run the structural gate, install, re-run the same scene.
   A fix that changes the shared emit re-opens earlier-passed scenes for a one-eye glance.
5. **Record the round** in the plan ledger (seen / root cause / fix / re-check) and land any
   permanent rule in `docs/contracts/vehicles.md` in the same change.

Rebuild + gate + install:

```bash
npx tsx tools/vehicle-cutscene/src/cli.ts --game game-src/original \
  --in mods-src/original/vehicles --out "$(pwd)/NO_COMMIT/<build>" --self-contained-txd
npx tsx scripts/debug/cutscene-fleet-verify.ts "NO_COMMIT/<build>"   # must be 0 failures, 0 duplicate channels
cp "NO_COMMIT/<build>/models/cutscene.img" "<bottle>/models/"
cp "NO_COMMIT/<build>/data/txdcut.ide"     "<bottle>/data/"
cp "NO_COMMIT/<build>/anim/cuts.img"       "<bottle>/anim/"   # round 20: the wheel-stash sink rides in scene data
```

Keep the previous build folder aside by RENAME (something in this environment deletes builds
mid-session); a running game picks the swap up on its next launch.

## The forensic toolkit (measure, don't theorize)

- `scripts/debug/cutscene-fleet-verify.ts` — the structural gate after every rebuild: every DFF
  parses, skeleton invariants hold, **0 duplicate channel names** (a duplicate binds and
  double-transforms — plan 004 round 1).
- `scripts/debug/dump-dff-materials.ts`, `dump-vehicle-materials.ts` — per-material colours, alphas,
  textures; `cutscene-anim-channels.ts` — which channels a scene actually drives (KRT0 = rot+trans,
  KR00 = rot only, 8×f32 rows; a 1-frame channel is a static POSE).
- Throwaway `scripts/debug/.tmp-*.ts` walkers for the question of the hour (frame trees with parent
  chains, atomic order + extension plugins, per-atomic bboxes, translucency censuses) — deleted
  before commit; promote one to a kept script + `docs/debug/README.md` row only if it answers a
  recurring question.
- **The vanilla fleet is the reference implementation.** Every layout/recipe question is answered by
  measuring `game-src/original/models/cutscene.img` first: vanilla bakes lamp markers white, orders
  windscreen_ok last, stamps the vehicle PipelineSet per atomic, authors window alpha per model.
  What R* shipped is what the cutscene path is known to render correctly.

## Rules that kept twelve rounds honest

- **One variable per round.** When a fix regresses something else, the user says so plainly — and
  attribution only works if the round changed one thing. Two independent-subsystem fixes may share a
  rebuild, but the ledger records them as separate rounds with separate verdicts.
- **Field chronology is evidence.** The glass chain was cracked by bisecting across BUILDS: glass
  rendered before PipelineSet, vanished after, at any alpha — that isolated the pipeline as the
  variable when the pixels could not (rounds 5–8).
- **Derive from the asset, never the slot.** No fix names a car; every rule keys off structure the
  mod itself carries (translucency, selector groups, dummies, marker colours) resolved against the
  slot's vanilla template at convert time. `grep` the tool for model names: only comments.
- **Wrong-mechanism fixes get retired, not patched over.** The round-4 alpha clamp treated the
  symptom of round 5's render-order bug; once the true mechanism landed, the clamp was deleted and
  the ledger says so (round 7).
- **The screenshot picks the measurement; the measurement picks the fix.** Every plan-004 root cause
  was confirmed offline (material bytes, atomic order, frame parents, bboxes) before code changed.

## Where things live

- Per-scene ledger + all round records: `tools/vehicle-cutscene/docs/plans/004-full-scene-field-review.md`
- Name/structure rules the rounds produced: `docs/contracts/vehicles.md` §3–§4
- The override script's own plan + traps: `cleo/scripts/` README, `docs/edge-cases/cleo-vm.md`
- Original-game facts recovered along the way: `docs/gta-sa-original/cutscenes.md`
