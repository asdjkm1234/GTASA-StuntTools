# 003 — cutscene override: play a chosen cutscene at new game, picked by ini

**Status: CLOSED 2026-08-13 — all three field verdicts in.** (1) `scene = PROLOG3`: plays from the
start, in the streamed world, camera on its spline, control + menu return, CJ standing on the
site; (2) `scene = DESERT1`: the ini is the knob — monster truck in the desert, a cross-map warp,
no stray traffic; (3) `scene =` empty: fully inert, nothing happens. Final artifact 792 B
(`cutscene-override.sa-only.cs`) + the generated ini (148 scenes listed, 148 area rows, 148 site
rows). It took 12 field rounds — every one bought a recorded fact (the round records below), and
FOUR of them are traps now written into `docs/edge-cases/cleo-vm.md` / the SDK docs: the new-game
boot race, ONMISSION not covering the intro, global operands as byte offsets, and failed CLEO ini
reads corrupting the target var.

**Status history: PLANNED 2026-08-12, REWRITTEN 2026-08-13 (user's call).** A debug instrument, not a corpus
replacement: every vehicle-cutscene field round so far cost "new game → sit through the intro" per
look. The override turns that into: write a scene name into an ini, start a new game, watch that
scene. It is the field-testing multiplier for vehicle-cutscene plan 002 steps 8–11 and plan 003
(plates), and for every cutscene-adjacent job after them.

**What the rewrite dropped (2026-08-13):** the first version was a viewer — cheat code `CSVIEW`,
cycle scenes with `[`/`]`, on-screen label, restart-on-end. The user cut it to the part that pays:
no cheat detection, no key polling, no state machine, and — the known-fragile bulk — no back-to-back
scene transitions to stabilise. One ini key, one scene per run, script terminates when the scene ends.

## Why CLEO, not ASI (decided 2026-08-12, survives the rewrite)

The cutscene API is script-first: SA's own main.scm plays scenes with four opcodes —
`02E4 LOAD_CUTSCENE_DATA 'NAME'` → `02E7 START_CUTSCENE` → `02E9 HAS_CUTSCENE_FINISHED` →
`02EA CLEAR_CUTSCENE` — and in SA the object list + anims come from `<name>.dat` INSIDE cuts.img (the
III/VC-era per-object `02E5/02E6` calls are gone), the camera rides the `.cut`. The scene NAME is the
entire input, and here it comes from an ini read — CLEO4 serves that natively (`0AF4`-family INI
opcodes). The bottle already runs CLEO (the vehicle mods ship `cleo/` folders), and this repo already
authors scripts through its own SDK DSL with a proven build (`npm run build:cleo-scripts`). An ASI
would re-implement all of that against `CCutsceneMgr` with per-exe fragility (the HOODLUM relocation
trap) and a compile-deploy loop where CLEO is drop-a-file.

**Single-target, deliberately.** Unlike 001/002 this script is NOT dual-target: OpenSA has no cutscene
system to drive (the six unconsumed 2dfx types' neighbour fact — plan 100/101). The headless story
test covers the emitted opcode structure and budget; the behaviour verdict is the bottle's.

## Design

- **`cutscene-override.ini` beside the compiled script is the whole interface.** Head of the file is
  a generated comment block listing every vehicle cutscene and the cs vehicles it drives (the lookup
  that answers "which scene shows the taxi?" — the intro pair alone proves the value: the vehicles
  live in `prolog1/prolog3`, not `intro*`, and nobody guesses that by name). Below it, one key:

  ```ini
  ; vehicle cutscenes (generated — do not hand-maintain the list):
  ;   prolog1 = cstaxi92, ...
  ;   prolog3 = cstaxi92, cscopcarla92
  ;   ...
  [cutscene]
  scene = prolog3
  ```

  `scene` accepts ANY cutscene name in `anim/cuts.img` (~148), not just the listed vehicle ones —
  the comment lists the vehicle scenes because those are the job. Empty `scene`, missing key or
  missing ini → the script is INERT (terminates immediately); that is the shipped default.
- **The comment list is generated OFFLINE by our own tooling** — never hand-maintained. The census
  knows the 23 cs vehicle names; the ANPK channel reader (`scripts/debug/cutscene-anim-channels.ts`)
  knows which cutscenes drive which objects.
- **Script flow, one shot (the opcode sequence is main.scm's own, measured in step 0):** session
  start → read ini → (empty → terminate) → wait until the player is in control (`0256
  IS_PLAYER_PLAYING` AND `$409 ONMISSION == 0` — main.scm's intro finished or skipped, the user
  skips it with one keypress) → fade out, freeze player, `04BB SET_AREA_VISIBLE` (from `[areas]`,
  default 0) → `02E4` name → **wait `06B9 HAS_CUTSCENE_LOADED`** (required: `02E7` on unloaded data
  starts degraded — no camera, no widescreen; a name that never loads, e.g. an ini typo, hits the
  timeout → clean restore) → `02E7` (the MANAGER sets widescreen and fades in itself) → poll `02E9`
  → fade, `02EA`, `04BB` back to 0, unfreeze, fade back → terminate. Never a hang.
- **The `[areas]` section rides in the same generated ini**: main.scm sets the interior area per
  scene BEFORE loading (the `.dat` does not carry it), so the generator emits `PROLOG1=14`-style
  rows and the script reads the key named by the chosen scene (missing row → 0). No hand-copying.
- **The cheapest round is a save, not a new game:** CLEO scripts start on ANY session start, so
  loading a save right after the intro plays the ini scene immediately — no intro to skip at all.
  Field loop: edit ini → load save → watch.

## Steps

### 0 — recon: pin the start sequence and the runtime facts — DONE 2026-08-13

- [x] Verified against the Sanny SA opcode library + gta-reversed + the bottle's own main.scm:
      `02E5/02E6` are `is_nop` in SA (they exist and do nothing); `02E4` alone loads the `.ifp` anims
      and the `.dat` objects+camera from cuts.img. Interior scenes DO need `04BB` from the script —
      main.scm sets the area immediately before every one of its 135 `02E4` sites; the `.dat` does
      not carry it.
- [x] Pinned the safe start point: `0256 IS_PLAYER_PLAYING` AND `ONMISSION == 0`; the ONMISSION
      global is `$409`, measured from the bottle's main.scm (`0180 SET_ON_MISSION_FLAG` @ 0xdce4 →
      offset 1636/4). One scene start from that state is the mild transition case — main.scm has
      already `02EA`-cleared its intro scene.
- [x] The bottle runs **CLEO 4.4.4** (version string in CLEO.asi) and cleo.log confirms
      `IniFiles.cleo` loads → `0AF0`/`0AF4` INI reads are served.

**Record (measured off the bottle's main.scm, 3 079 599 B, and gta-reversed `CCutsceneMgr`):**

- main.scm's sequence at every site (PROLOG1 @ 0x43300, PROLOG3 @ 0x434f7 are the vehicle pair):
  `04BB area` → `02E4 'NAME'` → **loop until `06B9 HAS_CUTSCENE_LOADED`** → `02E7` → `016A DO_FADE`
  in → loop until `02E9` → `016A` fade out + `016B IS_FADING` wait → `02EA` → `04BB` restore. The
  waits are all CONDITION-driven (`06B9`/`02E9`/`016B`) — no fixed settle sleeps anywhere, which
  retires the old viewer plan's "budget explicit settle waits" worry.
- **`06B9` is the load-bearing discovery**: gta-reversed's `StartCutscene` on not-yet-loaded data
  still flips play status but SKIPS camera setup and widescreen — a degraded half-start, not an
  error. The override's timeout path exists exactly for a name that never reaches LOADED.
- The manager itself sets widescreen on start and fades in (`TheCamera.SetWideScreenOn()`,
  `Update_overlay`) — main.scm's fades are courtesy framing, and the script copies only those.
- Scene names: main.scm stores them UPPERCASE; the manager compares case-insensitively. 135 unique
  scenes are referenced by main.scm (vs ~148 in cuts.img — the census list is the superset).
- Areas measured (adjacent-`04BB` decode reaches 54/135 sites; the generator owns the full decode):
  `PROLOG3=0`, `PROLOG1=14`, `INTRO1A=3`, `INTRO2A=2`; histogram of decoded sites
  `{0:3, 1:21, 2:11, 3:8, 5:4, 6:1, 10:1, 11:3, 12:1, 14:1}`.

### 1 — the ini generator — DONE 2026-08-13

- [x] `scripts/debug/cutscene-override-ini.ts` (imports the tool's census + the ANPK walk) emits
      `cutscene-override.ini`: the comment header (one row per vehicle scene), `[cutscene]` with
      `scene =` empty, and `[areas]` decoded from main.scm (nearest immediate-arg `04BB` within 64
      bytes before each `02E4`; only non-zero rows are emitted).
- [x] **35 vehicle scenes, 65 area rows.** Spot-checked against `cutscene-anim-channels.ts`:
      PROLOG3 = cscopcarla92+cstaxi92 (the known pair), STRP4B2 = csmtbike92, RIOT4E1 =
      CsCopcarSF+CsFirela, GARAG3A = csremington92 — all match.

**Record:**

- **The scene's OBJECT list comes from the IFP's `NAME` chunks, not the `.dat`** — the `.dat` inside
  cuts.img is CAMERA data (zoom/FOV keyframes; measured on prolog3.dat, and no `.dat` names any
  model). The 2026-08-12 note saying objects come from the `.dat` was wrong; cutscenes.md fixed in
  the same change.
- **`csdinghy` appears in NO cutscene** — 22 of the census's 23 cs vehicles are driven somewhere
  across the 35 vehicle scenes; the boat alone is scene-less (a cutscene model with no cutscene —
  cut content, like `csandrom92`'s dead txdcut row). Consequence for vehicle-cutscene plan 002 step
  9: the boat conversion has NO stock scene to field-test in; its verdict needs another route.
- Anim object names are mixed-case in the ANPK (`CsCopcarSF`, `CsFirela`) — the generator matches
  case-insensitively, and the ini prints the census's lowercase cs names.
- Area decode coverage across ALL 135 main.scm sites: 68 decoded from an immediate arg, 67 have no
  `04BB` within 64 bytes (second scenes of a mission inherit the area from earlier flow — the
  generator deliberately does not chase control flow; those scenes ride the default-0 note in the
  ini header).

### 2 — SDK vocabulary — DONE 2026-08-13

- [x] The opcode TABLE needed nothing: the vendored Sanny DB already knows every opcode the flow
      uses (`02E4/02E7/02E9/02EA/06B9`, `04BB`, `016A/016B`, `0256/01B4`, `0AF4/0AF0`), with names,
      arity and condition flags. The real gaps were two:
- [x] **A target for real-SA-only scripts.** The gate's rule was "the VM half always holds", and the
      VM serves no cutscene opcode — so `dual`/`opensa-only` both refuse this script by design. Added
      `target: 'sa-only'`, the MIRROR of `opensa-only`: the real-CLEO half always holds (new
      `servedByRealCleo44` — game opcodes + classic CLEO 4 core + the IniFiles module `0AF0–0AF5`
      the bottle measurably loads), the VM half is lifted, and the artifact name carries it
      (`<name>.sa-only.cs`; contract row added to `docs/contracts/mods.md` in the same change). The
      other bottle modules (FileSystemOperations, IntOperations, CLEO+) stay unclaimed until a
      script needs one — extending the predicate is the way to claim them.
- [x] **Local string8 vars** for the ini read: `lvarStr8` (IR) + `s.localString(name)` (DSL,
      allocator's 2-slot `string8` kind — the allocator and the byte writer both already knew the
      type). Same-name-different-kind is a build error.
- [x] Tests: whitelist gains 4 cases (the cutscene sequence + ini read passes `sa-only` and fails
      `opensa-only`; a VM-only opcode and a file-module opcode both fail `sa-only`; the artifact
      name), DSL gains 2 (string8 takes two slots; kind collision throws). cleo/sdk + cleo/scripts:
      **91 tests / 11 files green.** No whitelist regeneration needed — `sa-only` is a predicate
      over the vendored DB, not a generated set.

### 3 — the script — DONE 2026-08-13

- [x] `cleo/scripts/cutscene-override/script.ts` + `story.test.ts`. The story is STRUCTURAL — the
      VM cannot execute an sa-only script, so the review surface is the emitted sequence and the
      committed disasm listing (46 instructions, 358 bytes as `cutscene-override.sa-only.cs`).
      5 tests: the dual/opensa-only gates refuse it (the reason sa-only exists); a failed ini read
      jumps straight to TERMINATE with no cutscene opcode on the path; the sequence is main.scm's
      own (area before load, LOADED wait between load and start, FINISHED poll after start, one
      CLEAR outside the started-guard so the timeout path clears too); the longest WAIT-free
      stretch (linear over-approximation) fits `budgetPerTick: 24` and no loop warns; deterministic
      bytes + listing snapshot. cleo scope: **253 tests / 31 files green.**
- [x] Flow decisions the plan text did not fix: a 500 ms settle after control returns; fade-out
      completes BEFORE freeze/area/load (mirrors main.scm's framing); `[areas]` read keyed by the
      scene string itself (`0AF0` with the string8 local as the key), defaulting 0; load timeout
      15 s on TIMERA; the finish poll trusts `02E9` (no timeout — main.scm doesn't have one either).
- **The one unproven encoding, and it is what field round 1 proves:** a string8 LOCAL (`0@s`) as
  the string arg of a game opcode (`02E4`) and as an ini KEY (`0AF0`). CLEO documents var-strings
  in any string slot; this bottle has never demonstrated it. If round 1 black-screens into the
  timeout path with a correct ini, suspect this first.

### 4 — FIELD: the instrument proves itself

**Delivered to the bottle 2026-08-13**: `CLEO/cutscene-override.sa-only.cs` (358 B) +
`CLEO/cutscene-override.ini` (35 scenes, 65 area rows, `scene = PROLOG3` pre-set) — round 1 is
just: launch, new game (or load a save), skip the intro, watch. If the game was already running
during the install, the files land on the NEXT launch.

- [ ] Three rounds: `scene = PROLOG3` → the scene plays and control returns cleanly; a second
      scene name (`GARAG3A` is a good interior probe — area 0 unrecorded, watch for blue void) to
      prove the ini is the knob; `scene =` empty to prove inert.

**Round 1 (2026-08-13): the scene PLAYED — then a stuck white screen, no menu.** What it proved and
what it broke:

- PROVED: the whole start half — ini read, string8 local into `02E4`, `06B9` wait, `02E7` — works
  under real CLEO 4.4.4. The step-3 "one unproven encoding" is proven.
- BROKE: the restore half. cleo.log shows the script registering and NO `Unregistering … cutscen`
  line — the thread never reached `0A93`, it is parked in a wait loop. Diagnosis: the 500 ms
  fade-out + `016B` wait BETWEEN `02E9` and `02EA` is a window in which `CCutsceneMgr`'s own
  end-fade (the intro's white "camera shutter" — the white screen itself) keeps the fade state
  alive, so `GET_FADING_STATUS` never goes false. main.scm has no such window: its end fade is
  `016A 0 0` — INSTANT — so the `016B` guard exits the same tick and `02EA` follows immediately
  (decoded at the PROLOG3 site; the fade-in after start is `016A 1000 1`, which also pins
  FADE_IN = 1 as ground truth). The no-menu part was not the fade: `01B4 SET_PLAYER_CONTROL OFF`
  (MakePlayerSafe) blocks the pause menu, and the restore that would re-enable it never ran.
- FIX (same day): the restore mirrors main.scm exactly — instant `016A 0` fade-out, `02EA` in the
  same tick (no `016B` loop between), then `02EB RESTORE_CAMERA_JUMPCUT` + `0373
  SET_CAMERA_BEHIND_PLAYER` (a generic scene, unlike the intro's scripted flow, must hand the
  camera back), area 0, control on, `016A 1000 1` fade-in. The finished-poll now runs every frame
  (`WAIT 0`, main.scm's own cadence) with a 5-minute belt timeout so even a `02E9` that never fires
  restores instead of hanging. 353 B rebuilt + reinstalled in the bottle.

**Round 2 (2026-08-13): restore PASSED** — control and the Esc menu return cleanly after the
scene. OPEN: the camera during the scene is wrong ("strongly zoomed at the objects / as if the
scene is one and the camera is another"). Facts banked for the diagnosis, verdict pending the
user's answers:

- The user's content description across both rounds ("airport → boarding the taxi") matches
  **PROLOG1**'s object list (csplay, suitcases, csbogman, cstaxi92), while the delivered ini says
  `scene = PROLOG3` — whose content is the COPS scene (cstenpenny, cspulaski, cshernandez,
  cscopcarla92, handcuffs, money stack). If the airport scene really played, the bug is
  which-scene-loads, not camera framing.
- gta-reversed: the camera rides `TheCamera.LoadPathSplines(<name>.dat)` +
  `TakeControlWithSpline`; `ms_cutsceneOffset` comes from the `.cut`'s own INFO `offset` row
  (reset to 0,0,0 at preload — SA main.scm calls `0244 SET_CUTSCENE_OFFSET` exactly ONCE in the
  whole script, so per-scene offsets are file-owned, not script-owned). **If the `.dat` fails to
  apply, the manager's fallback is SILENT: the scene plays and the camera just stays put** — the
  exact "scene is one, camera is another" shape. `SetWideScreenOn` happens only on the
  with-camera path, so missing letterbox bars during the scene are the fallback's fingerprint.
- Known main.scm pre-start parity we do NOT yet do (streaming, not camera): `0A0B
  LOAD_SCENE_IN_DIRECTION <site>` + `0395 CLEAR_AREA` before `02E7` (decoded at the PROLOG3 site:
  2493.4, −1734.3, 12.4, heading 258.8 — Grove Street). Held back deliberately — one variable per
  field round.

**Round 3 (2026-08-13): the user's screenshot sequence SOLVED it — not a camera bug, a BOOT RACE.**
Right after the loading screen his shots show ~1 s of OUR PROLOG3 (the sheriff car + taxi floating
in an unstreamed void), then the game's own intro title card ("Francis INTL. Airport"), then the
intro playing 10 s late with the audio ahead and the framing off. Root cause: **CLEO threads outrun
main.scm on a new game** — in the first moments `IS_PLAYER_PLAYING` is already true and ONMISSION
is still 0, so the gate passed DURING loading, our `02E7` ran first, and main.scm's intro then
started on top — two cutscenes on one manager, whose clock had already advanced (the 10 s offset,
the desync, round 1's "airport scene" — that was the STOCK intro over our scene all along, which
also retro-explains round 1's white stuck: the intro's own white shutter). FIX: 5 s grace before
the gate + a third OR-condition `GET_FADING_STATUS` (never fire during any fade main.scm owns).
360 B rebuilt + reinstalled. Consequence for the user's flow: on NEW GAME the scene now fires only
after the intro MISSION fully passes (bike ride included) — the cheap loop is a POST-INTRO SAVE:
load → 5 s → scene. The unstreamed-void shot is the recorded evidence for the `0A0B` parity gap —
next variable if a far-from-site scene still shows a broken world.

**Round 4 (2026-08-13): the grace was not enough — SA's new-game INTRO is NOT a mission.** The
stock airport scene got interrupted at second ~5 (the grace expiring): ONMISSION is STILL 0 while
the intro plays, so the gate opened mid-intro, our PROLOG3 stomped the manager (worldless, animы
glitching on the contaminated clock — CJ leaving the car in 2 frames), and main.scm then recovered
and played ITS OWN prolog3 with the world streamed (the second cops scene of the round). The
condition that DOES mark the whole intro is the manager itself: `06B9 HAS_CUTSCENE_LOADED` is true
through every intro scene. FIX: the gate becomes "the manager is FREE and everything quiet
(playing, ONMISSION 0, no fade, no cutscene loaded), held CONTINUOUSLY for 10 s on TIMERB" — the
debounce bridges the between-scenes gaps where the next intro scene is still loading and `06B9`
momentarily reads false. 479 B rebuilt + reinstalled. New-game flow bonus: the scene now fires ~10 s
after the cops drop CJ at Grove (no bike ride needed); load-save flow = 5 s grace + 10 s debounce.

**Round 5 (2026-08-13): the intro plays untouched (gate holds), but the scene never fired — the
bike-home phase IS a mission.** cleo.log showed csovrd alive until session end: standing at the
drop point keeps ONMISSION = 1 (399 `SET $409 1` sites in main.scm — missions own that flag), so
the mission-free wait meant "finish In the Beginning first". **The user's call: the trigger is NEW
GAME, not mission-passed — ONMISSION leaves the gate entirely.** The gate is now manager-only:
player playing + no fade + `06B9` free, held 10 s. Deliberate consequence, recorded: on a
mid-mission save the scene fires during the mission — acceptable for a debug instrument. 458 B
rebuilt + reinstalled. Flow: new game → skip the intro with one key → ~10–15 s → the scene.

**Round 6 (2026-08-13): the gate is CLOSED as a subject — the scene fires from the start, clean
anims, camera on its spline. Last defect: the WORLD is missing** (cars and actors against bare sky
— the user's three screenshots). Cause: the scene plays at ITS world site — the `.cut`'s own
`info / offset x y z` row (PROLOG3: 2484.1, −1722.3, 12.6) — while the world only streams around
the PLAYER, who stands ~300 m away at the intro drop point. FIX (main.scm parity, completed): the
generator now reads every scene's `.cut` offset out of cuts.img and emits a per-scene `[SCENE]
x/y/z` section (148 sections, full coverage — no main.scm heuristics needed); the script reads it
back (`0AF2` with the scene string as the section name) and, under the fade, WARPS the frozen
player to the site (+1 m z; he is the streaming center), then `04E4 REQUEST_COLLISION` + `03CB
LOAD_SCENE` + `0395 CLEAR_AREA r=300`, then area/load/start as before. `$PLAYER_ACTOR = $3`
(measured: `01F5 $2 → $3` @ 0xdc15 in MAIN; one of the three CLEO-safe globals). A scene with no
section plays where the player stands, as before. Deliberate consequence: after the scene the
player REMAINS at the site — for a field instrument that is a feature (you are standing on the
stage you just inspected). 647 B + the 9.7 KB ini reinstalled.

**Rounds 8-10 (2026-08-13): the empty world SOLVED — it was never streaming.** Round 8 (warp via
per-scene ini SECTIONS): world still empty; could not tell a failed var-SECTION read from a failed
warp → round 9 moved the site rows to flat `[sitex]/[sitey]/[sitez]` with the scene name as the KEY
(the proven `[areas]` shape) and added an on-screen verdict (`CSOVRD: SITE OK` / `NO SITE ROW`)
before the fade. Still empty → the streaming theory itself was wrong. The real cause (round 10,
CONFIRMED): **a failed CLEO ini read writes a failure marker INTO the target var** — PROLOG3 had no
`[areas]` row (only non-zero areas were emitted), the failed `0AF0` corrupted the area var, and
`04BB SET_AREA_VISIBLE <garbage>` HID the entire exterior world. Cutscene objects + sky render,
map does not — looks exactly like streaming, diagnosed as streaming for four rounds. It also
retro-explains round 4's "main.scm's own scene had world right after ours" (our cleanup `04BB 0`
had just fixed the area for it). FIX: `[areas]` rows for ALL 148 scenes (0 included) + a guard that
re-sets 0 when the read fails; trap recorded in `docs/edge-cases/cleo-vm.md`. **Round 10 verdict:
SITE OK on screen, the world present, CJ standing at the Grove site after the scene — the
var-key ini reads, the warp AND the area handling all proven in one run.** The round-6/8 streaming
work (site warp + `LOAD_SCENE`) stays: it is main.scm parity and it is what puts the world AT the
site for far scenes.

**Round 7 (2026-08-13): CRASH — access violation in `00A1 SET_CHAR_COORDINATES` (the opcode id is
sitting in the crash log's stack dump; the call comes through CLEO's script hook at `0x0053E981`).
My encoding bug, and a general trap now recorded in `docs/edge-cases/cleo-vm.md`: a global-var
operand carries the BYTE offset, not the `$n` slot — `$3` must go into the stream as 12. I passed
`3`; `00A1` collected a garbage char handle from inside `$0` and dereferenced it. The same bug
RETRO-CORRECTS round 5: the old ONMISSION gate was reading offset 409 (garbage inside `$102`), not
`$409` — its "never opens" verdict was this encoding bug, not (only) the bike mission. ONMISSION
stays out anyway — the manager-only gate is the user's design call and round 6 proved it. FIX:
`PLAYER_ACTOR = 3 * 4`, `s.global()` doc rewritten (the raw stream value IS the byte offset), the
edge-cases row added. 647 B reinstalled.**

**STOP: user's verdict closes the plan.** **Record:** verdict + the ini row count + any scene that
needed the timeout path (each is a fact about that scene worth a line).

## Notes

- Ships as a DEBUG artifact to the bottle only — not part of any game build; the README table gains
  its row when it lands.
- Once alive, vehicle-cutscene's remaining gates (bike, boat, plates, full fleet) test in minutes:
  the order is this script first, then back down the vehicle-cutscene chain with it in hand.
