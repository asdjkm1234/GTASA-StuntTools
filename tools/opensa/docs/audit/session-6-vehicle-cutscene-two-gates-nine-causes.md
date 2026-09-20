# Session 6 audit — vehicle-cutscene: a new tool, two field gates, nine root causes (2026-08-12)

One session took `tools/vehicle-cutscene` from "an unnamed very important task" to a shipped converter
whose output the user field-verified frame-against-frame with vanilla: **plan 002 steps 1–7 done, gate 4
(vanilla parity) and gate 7 (mods in cutscenes) both PASSED** — "по первой катсцене все отлично".

## What shipped

- **The tool** (`tools/vehicle-cutscene/`): census (23 cs vehicles / 21 slots, derived never hardcoded),
  car rig converter (template from the vanilla model + shim-frame emit + adoption), carcols paint bake
  (271–402 materials per run), empty-TXD emit with fail-loud texture closure (`--self-contained-txd`
  escape hatch for stock-gameplay targets), game emit with txdcut.ide patching. 55 tests in the tool;
  registered in vitest/eslint tool lists (both enumerate tools explicitly).
- **Plans**: 001 (architecture + banked research), 002 (steps 1–7 recorded with numbers and verdicts;
  8–11 remain), 003 (plate bake — planned), and `cleo/scripts/docs/plans/003-cutscene-override.md`
  (tomorrow's first job: the field-testing multiplier; planned as a cheat-code viewer, rewritten
  2026-08-13 to the ini-driven start override — the file was renamed with it).
- **Kept instruments**: `scripts/debug/cutscene-anim-channels.ts` — reads the ANPK cutscene anims the
  engine parser cannot; it closed gate 7 in one shot. Fixtures: 8 cutscene DFF pairs + txdcut.ide +
  bobcat.txd + a real LOCKED mod DFF, all one manifest line each.
- **Docs**: `docs/gta-sa-original/cutscenes.md` (the original-game facts in one place), commands.md,
  debug README row, plan indexes.

## What it cost / what it bought

- 29 commits, 30 files, +3 976 lines net against the session-5 close. Suite **4 110 → 4 165** green
  (462 files), coverage floors hold (91.92 / 82.6 / 92.09 / 92 vs 86 / 77 / 88 / 86).
- Ten field rounds across two gates (4 on stock parity, 6 on mods) — each round produced a named root
  cause, recorded in plan 002's step-4/7 records. The method that repeatedly broke deadlocks was the
  user's own instinct from session 4: **A/B the same frame against vanilla** (one screenshot ended
  round 3 of gate 4), and when screenshots ran out, **read the original's own data** (the ANPK channels
  ended gate 7).

## The nine root causes (the emit model was rebuilt twice on them)

1. Junk mesh-frame transforms are real; the game's collapse destroys ONLY `_ok/_dam` under their own
   dummy (copcarla's chassis keeps its junk space — and its geometry is authored there).
2. Cutscene anims bind by frame NAME and carry a channel for EVERY vanilla bone — an animated bone's
   local is anim-owned; vanilla locals are the mandatory bind pose.
3. Dropped donor parts leave holes (the '92 bodies bake their glass) → adopt visible orphans.
4. `_ok`-only adoption dismantles funky-style mods (body/interior/glass are chassis sub-meshes) →
   adopt the whole shell; only `_dam`/`_vlo` stay out.
5. Variant containers (`f_extras`/`f_class`) show ONE mesh; year-variant subtrees (`_[1991]:2`, typo'd
   `}` included) are alternatives to carried parts and never adopt.
6. Vertex-baking deltas fixes only the CLOSED pose — anims swing parts around vanilla hinges → SHIM
   frames absorb every donor delta while bones keep vanilla locals; both poses exact.
7. LEFT wheels of identity-rotation templates need a mirrored geometry copy (x flip + rewound
   triangles) — their anims replay identity, nothing else mirrors the shared wheel.
8. A derived geometry copy must never alias the source's dedupe slot (the asymmetric splayed wheels).
9. Mods misname parts (`door_lr_ok` under `door_rr_dummy`) — gameplay keys by DUMMY and forgives;
   name-bound anim channels do not → the dummy-keyed fallback.

## Numbers recorded on the way

- Golden pairs: bobcat reproduces vanilla to **0.0000** on every shared frame; taxi/zr350 deltas are
  the measured proof the `cs*92` bodies were re-authored.
- Parity build: 21/21, archive 25.7 → **25.2 MB** (smaller than vanilla: shared wheels + dropped junk).
- Gate-7 build: 21/21, **306.7 MB** self-contained; empty-TXD route emits **840 B** of cs TXDs total
  where the hand-made pack spent ~11.5 MB per car.
- Paint bake: 271 materials / 21 stock models; 396–402 on the mod fleet.

## Open at close

- Plan 002 steps 8–11 (bike, boat, full-fleet numbers → `docs/benchmarks/`, pipeline integration —
  paint from MOD carcols arrives with step 11's ordering).
- Plan 003 (plates) and cleo/scripts 003 (viewer — TOMORROW FIRST, then back down the chain with it).
- The bottle carries the gate-7 build; `.vanilla` originals beside it.
