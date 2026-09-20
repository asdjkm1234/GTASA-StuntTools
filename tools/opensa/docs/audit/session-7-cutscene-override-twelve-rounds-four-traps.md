# Session 7 (2026-08-13) — cutscene-override: one instrument, twelve field rounds, four traps

The whole session is one plan, opened, rewritten and CLOSED the same day:
[`cleo/scripts/docs/plans/003-cutscene-override.md`](../../cleo/scripts/docs/plans/003-cutscene-override.md).
The deliverable is a real-SA field instrument for the vehicle-cutscene chain: write a scene name
into `cleo\cutscene-override.ini`, start a session, and ~15 s after the game goes quiet the scene
plays AT its world site — player warped there under the fade, world preloaded, traffic off, control
and menu restored after. 21 commits; the tool it serves is `tools/vehicle-cutscene` (002 steps 8–11
next).

## What shipped

- **The script** `cleo/scripts/cutscene-override/` — 792 B artifact, the first `sa-only` script.
  The opcode sequence is main.scm's own, measured off the bottle's main.scm in step 0:
  `04BB area → 02E4 → wait 06B9 (mandatory: unloaded start silently degrades) → 02E7 → poll 02E9 →
  instant 016A 0 → 02EA same tick → 02EB/0373 camera return`. Its story test is STRUCTURAL (the VM
  cannot execute sa-only opcodes): sequence asserts + listing snapshot + a linear WAIT-gap budget.
- **SDK: the `sa-only` target** — the mirror of `opensa-only`: the gate holds the reference
  install's real-CLEO 4.4 surface (`servedByRealCleo44`: game opcodes + classic CLEO 4 core + the
  IniFiles module the bottle measurably loads) and lifts the VM half; the artifact name carries it
  (`docs/contracts/mods.md` row added). Plus `localString`/`lvarStr8` — 8-byte string locals.
- **Two debug scripts** (rows in `docs/debug/README.md`): `cutscene-scm-sites.ts` (every main.scm
  cutscene call site + areas + the ONMISSION global) and `cutscene-override-ini.ts` (the generated
  ini: 35 vehicle scenes annotated, `[areas]` for all 148 scenes, `[sitex/y/z]` world sites from
  each `.cut`'s own `offset` row).
- **Original-game facts** into `docs/gta-sa-original/cutscenes.md`: the script API sequence; the
  `.dat` is CAMERA data and the object list is the IFP `NAME` chunks (corrected a wrong 2026-08-12
  note); the `.cut` `offset` is the scene's world origin; `csdinghy` is driven by NO cutscene
  (22/23 census models appear across 35 vehicle scenes — 002 step 9's boat has no stock scene to
  field-test in); `$ONMISSION = $409`, `$PLAYER_ACTOR = $3`; the bottle runs CLEO 4.4.4.

## What the twelve field rounds cost and bought

Every round was one variable; the plan's round records carry the full ledger. The four that became
permanent traps (all in `docs/edge-cases/cleo-vm.md` + SDK docs, because every one is SILENT):

1. **The new-game boot race** (rounds 3–4): CLEO threads outrun main.scm — for the first moments
   the player "plays", ONMISSION is 0 and no cutscene is loaded, so a naive gate fires during
   loading and the game's own intro starts on top of the script's scene (two cutscenes, one
   manager, contaminated clocks).
2. **The intro is NOT a mission** (rounds 4–5): ONMISSION stays 0 through the airport scene, so
   "wait for mission-free" neither blocks the intro nor (the user's call) fits the tool — the gate
   keys on the cutscene MANAGER (`06B9` free + no fade + playing, held 10 s on TIMERB).
3. **Global-var operands carry BYTE offsets** (round 7): `$3` goes into the stream as 12; passing
   the slot number compiled fine and CRASHED the game — `00A1` collected a garbage char handle
   from inside `$0`. Also retro-corrected round 5's ONMISSION reads (offset 409 = garbage inside
   `$102`).
4. **A failed CLEO ini read WRITES a failure marker into the target var** (rounds 6–10): the
   "default, then try read" pattern is wrong under real CLEO. A missing `[areas]` row corrupted
   the area var and `04BB <garbage>` hid the entire exterior world — four rounds of "empty world"
   that looked exactly like a streaming problem and was diagnosed as one (the round-6/8 warp +
   `LOAD_SCENE` work stays anyway: it is main.scm parity and it is what puts the world at the site
   for far scenes).

Also field-proven on the way: string8 locals as `02E4`'s arg and as ini KEYS under real CLEO 4.4.4
(the step-3 "one unproven encoding"); the manager owns widescreen and fade-in; anything between
`02E9` and `02EA` is a window for the manager's end-fade to hold `016B` forever (round 1's white
screen — main.scm's instant `016A 0 0` is the shape for a reason).

## Suite / tree at close

- Full suite **4 175 tests / 463 files green** (session 6 closed at 4 165/462); coverage floors
  held: **91.92 / 82.6 / 92.09 / 92** vs floors 86 / 77 / 88 / 86 (cleo scope alone 253/31).
- No benchmarks owed: the session shipped a debug instrument and SDK surface, no performance
  claims; no runtime path in any game build changed.
- Tree clean; 21 commits unpushed (push is the user's call). The bottle carries the final build
  with `scene =` EMPTY (inert until armed).
