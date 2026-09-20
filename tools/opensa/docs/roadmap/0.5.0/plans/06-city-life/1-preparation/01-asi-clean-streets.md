# 06·1·01 — `asi/city-life` v0: clean streets

[← chain](../readme.md) · the FIRST plan of the chain · relates: `asi/perfect-map` (toolchain, discipline)

A new ASI plugin for real GTA San Andreas that suppresses the vanilla **ambient** population — random
cars and random pedestrians — while leaving every scripted, mission, police and authored entity exactly
as it was. This is the foundation the whole SA-side track builds on ("clear the streets, then add our
own life step by step" — user, 2026-08-02), and it is standalone value on its own: a proven "clean
streets" mode for filming, modding and debugging.

## Goals gate (project-goals.md, the five questions)

1. *Authored data read as meant:* none consumed yet — this plan only removes RANDOM entities; authored
   populations (car generators from IPLs, mission scripts, `Decision/` ped behaviour) are untouched.
2. *What the original does:* spawns ambient cars (`CCarCtrl`) and peds (`CPopulation`) inside a ~100 m
   bubble, budgeted by density multipliers that mission scripts already adjust at runtime.
3. *What is better in ours:* nothing yet — v0 is deliberately subtractive; "better" starts in 2/05.
4. *Cost per frame:* one per-frame reassertion write set (a handful of float stores) — must be
   unmeasurable in SA's frame.
5. *Mod-author contract:* the ASI never patches a byte another mod patched (byte-verify + defer), never
   edits data files, and everything is a runtime ini toggle — removing the `.asi` restores stock 100 %.

## Why a NEW plugin, not a perfect-map extension

perfect-map is engine FIXES (a lifted limit, a crash guard) — always-on, no configuration. city-life is
a FEATURE with runtime state, an ini, and a growth path to a full simulation. Different lifecycle, same
infrastructure: the Makefile/link flags (`-nostdlib`, KERNEL32-only), `freestanding.cpp`, `log.hpp`,
`mem.hpp`, `hook.hpp` (all three hook shapes), `fingerprint.hpp` (exact-exe: 14,383,616 B, SHA1
`8c23ceff…`, HOODLUM), `coexistence.hpp`, and the `gen/catalogue.ts → generated header` codegen with its
vitest are copied/shared verbatim. That extraction is now the `asi/sdk` chain
(`asi/sdk/docs/plans/readme.md`, started 2026-08-06 — the full SDK, beyond the pure move this line
once sanctioned): city-life consumes the SDK instead of copying anything on this list.

## The suppression seam (decision D4)

Use the game's own density mechanism, not body surgery:

- `CCarCtrl`'s car density multiplier and `CPopulation`'s ped density multiplier are the values mission
  scripts already set through opcodes `01EB` / `03DE`. Setting them to 0 is semantics the game itself
  exercises constantly — the strongest possible mission-compat argument.
- Missions restore these values; therefore the ASI **re-asserts every frame** from its own tick (a
  game-loop hook we will need for the simulation later anyway). Holding 0 over a mission's own 0 is a
  no-op; holding 0 over a mission's 1.0 is exactly the intended behaviour.
- Explicitly NOT suppressed in v0: police/wanted response, emergency services, parked car generators
  (authored data), trains (ambient, but low-noise and mission-entangled — ours in 4/02), planes, mission
  and CLEO script spawns of every kind.
- If the multiplier seam proves insufficient (e.g. a spawner ignores it), the fallback is an observe/
  early-out hook on the specific RANDOM spawn entry — catalogued, byte-verified, and justified in the
  patch catalogue with the measured reason.

## RE session (the plan's real work — the population catalogue starts empty)

Nothing population-related is catalogued today (verified 2026-08-02: the perfect-map catalogue carries
only IplStore/Fx/pool addresses). Fresh RE per the plan-001 procedure — every row needs gta-reversed
semantics AND bytes read from the real exe; no address ships otherwise. Targets (symbols per
gta-reversed, addresses to be established):

- the two density multiplier globals + every writer (opcode handlers, `CCheat`, per-frame resets);
- `CCarCtrl::GenerateRandomCars` / `GenerateOneRandomCar` — the ambient path, and how the police/
  roadblock/emergency paths diverge from it (so we can PROVE we did not touch them);
- `CPopulation::Update` / `AddPed` and the ambient-vs-gang-vs-cop-vs-scripted ped provenance;
- the game-loop tick seam (where per-frame reassertion and, later, the sim tick live);
- pool sizes for `CVehicle`/`CPed` and where FLA raises them (needed by 2/05's ring-0 budget — count
  against the ini, never bisect in game).

## Config

`city-life.ini` next to the `.asi` (new — perfect-map has compile-time flags only; a feature needs
runtime toggles): `suppress_cars`, `suppress_peds`, master `enabled`, `log_level`. Every later phase
adds its own section; defaults conservative (v0 ships with suppression ON — installing it IS the opt-in).

## Verification (Wine ladder, the perfect-map pattern)

1. Dry-run build: fingerprint + all sites verify, nothing applied, log clean.
2. Suppression on: drive all three cities day+night — zero ambient cars/peds; parked cars still present
   (the `52. Abandoned Cars` mod and stock cargens are the probes); police still respond at 2 stars.
3. Mission sample (scripted-traffic coverage): intro missions + one mission per scripted-vehicle shape —
   a chase (scripted cars appear and drive), a train mission (Wrong Side of the Tracks), a taxi/ambulance
   side mission (script-spawned peds/cars appear). Each passes identically with the ASI on and off.
4. Coexistence: boot alongside FLA + modloader + a CLEO pack; byte-verify log shows zero deferred sites
   (we hook nothing they hook) — or names the conflict loudly.
5. Toggle test: `enabled=0` in the ini → vanilla streets return without reinstalling anything.

## Deploy

Manual drop in v0 (as perfect-map is today). The pmb `sa`-target deploy step (perfect-map plan 006) is
the shared answer for both ASIs — when it lands, `city-life.asi` + ini ride the same stage. Not a gate
for this plan.

## Tasks

- [ ] Scaffold `asi/city-life` (workspace, thin Makefile including `asi/sdk/mk/asi-plugin.mk`,
      gen/catalogue.ts + tests on the SDK's codegen library — the extraction decision is settled:
      consume `asi/sdk`).
- [ ] RE session → catalogue rows for the seams above (two-source rule; completeness check: enumerate
      every writer of both multipliers, the way plan 001 enumerated every reader of the int16 fields).
- [ ] Per-frame tick hook + multiplier reassertion + ini loading.
- [ ] Wine ladder 1–5 above; record each rung's verdict in this file.
- [ ] Docs in the same change: `asi/city-life/docs/` (architecture + patch catalogue, perfect-map
      shape), a row in `docs/links.md` if new external references were mined, `docs/features/` entry
      when v0 ships, restrictions/edge-cases for anything discovered about the population system.

## Measured numbers (fill per phase — a phase without numbers is unfinished)

- Sites catalogued / verified / deferred: —
- Frame cost of the reassertion tick (SA, Wine): —
- Mission sample results: —
