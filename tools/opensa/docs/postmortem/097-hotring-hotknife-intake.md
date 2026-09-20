# 097 intake: hotring `no_lights.cs` + hotknife paintjobs — cut same-day (2026-08-05)

Two CLEO vehicle mods were added to the corpus on 2026-08-05, fully analysed (decode, census,
headless runs, natives verified against gta-reversed), and intake plans 097/08-09 were drafted —
then the user cut both the same morning, before any implementation. Final state after a follow-up
the same day: **hotknife is cut entirely** (mod deleted, paintjob support not wanted); **hotring
the CAR returned to the corpus** (good model) **but its `no_lights.cs` is SKIPPED** — a per-frame
polling loop for a one-shot effect ("a race car with no lights") is not worth supporting, and the
honest form of the effect is engine-native. Verdict: **if we ever want liveries or light damage,
we build them as native engine features, not to serve a CLEO script.** No support code was
written; the drafted plan files were deleted. This file keeps the recon so it is never re-run from
scratch. (The 097/08 slot was later reused by the CLEO authoring SDK plan — unrelated to this
intake.)

## What the analysis established (all verified 2026-08-05)

### Light damage (was plan 08 — one atlas row + an engine effect)

- The script: walk all cars via `0AE2` each frame; for every model-494 car,
  `GET_VEHICLE_POINTER` → `+0x5A0` → four `0AA6 CALL_METHOD 0x6C2100` calls. Zero new opcodes —
  the whole gap was one atlas row plus a lamp-system effect.
- **`0x6C2100` = `CDamageManager::SetLightStatus(eLights light, eLightsState status)`**
  (gta-reversed `DamageManager.cpp` scoped-install block; `GetLightStatus` at `0x6C2130`).
- **`CAutomobile+0x5A0` = `m_damageManager`** (`VALIDATE_OFFSET`, `Automobile.h:406`).
- `eLights`: 0 FL, 1 FR, 2 RR, 3 RL; `eLightsState`: 0 OK, 1 SMASHED.
- Engine seam ready when wanted: `packages/game/src/vehicle/vehicle-lamps.ts` +
  `vehicle-lamp.system.ts` already own per-car lamps/coronas/pool lights — a smashed-lamp state
  there is the whole feature, derived from STATE not model id (the no-hardcode rule).

### Paintjobs/liveries (was plan 09 — the SA remap mechanism, fully recovered)

- **`CVehicleModelInfo::AssignRemapTxd`** (`VehicleModelInfo.cpp:1178`): a TXD named
  `<model><digits>` registers as a remap for `<model>`; registration order = paintjob index.
- **`CVehicleModelInfo::FindTextureCB`** (`VehicleModelInfo.cpp:854`): DFF material textures named
  `remap*` are the paintjob surface (marked with a leading `#`).
- **`CVehicle::SetRemap` `0x6D0C00`** (−1 = clean) + **`SetupRender` `0x6D64F0`**: the remap TXD's
  FIRST texture is drawn on the remap-marked materials; a paintjob forces primary colour to index 1
  unless `bDontSetColourWhenRemapping`. SA also rolls a random remap at SPAWN for models carrying
  them — vanilla livery variety needs no script.
- Both mods conformed on bytes (measured via `strings`): hotknife.dff texture `remap` /
  hotknife1.txd first texture `remap`; hotring.dff `remaphotringbody256` / hotring1.txd
  `hotringbody256`.
- Pipeline fact: `vehicle-installer` DROPS `<model><digits>.txd` today — declared out of scope in
  its plan 002 / `readme.md:88` ("a later iteration in the engine's vehicle texture/paintjob
  handling"). That later iteration is this section, whenever it is wanted.
- The CLEO half (never needed now): `06ED GIVE_VEHICLE_PAINTJOB`, `0A11/0A12` extra car colours
  (used as a processed-marker), `0AB0 IS_KEY_PRESSED` (VK map; the host contract already reserves
  an Input facet), `097A` audio event (no audio subsystem — would have been tier-a), `0209`,
  `00DD`. hotknife's pool walk ran headless against the plan-05 atlas end-to-end (peak 1 283
  instr/tick, 0.151 ms/tick) — the `0xB74494` byte-map emulation serves script-built handles.

### A live tool defect found by the intake (still worth fixing)

`createRecordingHost().carInSphere` ignores `findNext` and always returns car [0]
(`packages/cleo/src/vm/recording-host.ts:196`) — a `0AE2` findNext-walk never exhausts, so
`no_lights.cs` burned the full 10 000 instr/tick budget headless (2.158 ms/tick) with the real
story hidden (lesson: diff the mock's GATE ANSWERS when headless and field disagree). Any future
corpus script that walks cars with `0AE2` hits this. Fix when the next such script arrives.

**FIXED 2026-08-06 (097/07 close-out):** the next script was already shipping — vandoor. And the
defect was not mock-only: the ENGINE host dropped `findNext` too, so the walk never exhausted in
the field either (~3 ms/tick whenever a car sat in the probe radius). Both hosts now run a real
walk cursor; the numbers and the story are in the 07 ledger + the 2026-08-06 benchmark.

## Revisit when

- A damage model (or any feature) wants per-lamp breakage → the light-damage section above is the
  data meaning; build it engine-native.
- Livery/paintjob support is wanted (racing cars, variety at spawn) → the remap mechanism above is
  the authored-data contract: numbered TXDs + `remap*` textures. Build it engine-native
  (installer carry + bake + material swap + spawn roll); a CLEO opcode consumer is optional on top.
