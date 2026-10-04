# 003 — Name, sound, parking

**Status: BUILT 2026-08-19.** Three things a stock slot has and an added id does not. All three merges
are `vehicle-installer`'s (012 `.fxt`, 013 audio + parked); this plan only decides WHAT to feed them.

## Steps

1. **Name** — the GXT key is the ide line's `gameName` (`001VEH`); the text is the folder's second field
   (`1971 Chevrolet Vega`), overridable by a line in `text.txt` whose key equals the gameName. Written as
   `cleo/<slot>.fxt` with every other `text.txt` line (part names). Refuse a gameName longer than 7 chars
   (the GXT key width) — the ide line already enforces it for the game, we say it earlier.
2. **Sound** — `audio.txt` present → its line, with the first token forced to the slot (an author who
   copied the base's line and forgot to rename it ships a duplicate of the base otherwise); absent → the
   FIRST `(base)`'s line from the built `gtasa_vehicleAudioSettings.cfg`, copied under the slot, and LOGGED
   (`001veh: audio inherited from manana`). No base line either → warning: the car is silent in the game.
3. **Parking** — `parked.txt` lines → Parked Maker `[Cars]` with the car's id (013's merge); the
   `Car generators` budget warning as 013 counts it.
4. **Tests** — name derivation (folder field, `text.txt` override, > 7 refusal), audio inherit/own/forced
   token/silent warning, parked pass-through of the id.
5. **Verification** — the `--only 001veh` tree: `cleo/001veh.fxt` has `001VEH 1971 Chevrolet Vega`;
   `gtasa_vehicleAudioSettings.cfg` has a `001veh` line equal to `manana`'s; `Parked Car Maker.ini` has one
   more `[Cars]` row with id 19 001.

## Measured

**Built 2026-08-19.** `add-vehicles/name.ts` decides both; the writing is `vehicle-installer`'s
(`applyVehicleText` gained a `derived` list the caller passes through `applyVehicle`'s `gxt` option, and
`audio.ts` was split into `readAudioRow` / `retarget` / `writeAudioRows` so the inheritance can reuse the
same merge).

**One rule the plan did not have, and the data demanded it: a gameName the game ALREADY defines is left
alone.** The GXT key is the ide row's `gameName` column, and 18 of the 115 do not use their own slot there —
they reuse their base's (`STREAK`, `FREIGHT`, `FRFLAT`, `FRBOX`). Writing an `.fxt` line for those would
rename the STOCK train. The check is a lookup in the built `american.gxt` (its keys are CRC hashes, so a name
is asked for, never listed), which is why the outcome splits 9/9 rather than 18: `STREAK`, `FREIGHT` and
`FRFLAT` are real keys and are skipped; `FRBOX` is a gameName SA never gave text to, so the nine boxcars do
get a name — and the eight duplicate-key warnings say plainly that they all define `FRBOX` and the last CLEO
to load wins.

**The forced audio token is a fix for the replacement fleet too.** A row is written under the model whose
FOLDER it is in, and a row naming someone else is retargeted with a warning — an author who copies a donor's
line and forgets to rename it would otherwise silently re-point the DONOR's engine sound.

**Full run on an APFS clone of `build/original/sa`** (5.8 s, 115 cars):

| | |
| --- | --- |
| `cleo/<slot>.fxt` written | **106** (115 − 9 whose key is the stock train's), e.g. `001VEH\t1971 Chevrolet Vega` |
| duplicate-key warnings | **8** — the nine `FRBOX` boxcars |
| audio rows in the table | **115** (4 from their own `audio.txt`, 111 inherited from the base and retargeted) |
| cars left silent | **0** |
| gameName over 7 characters | **0** |
| a second run | byte-identical (`vehicles.ide`, the audio cfg, `carcols.dat`, the fxt, the parked ini) |

Parking needed no work here: `applyVehicle` already writes it (013), and the one `parked.txt` the fleet
authors lands as `0=19001 35 35 2495.98 -1673.15 13.25 0.00` — the same shape as the user's old tool's
output, with our allocated id.

Tests: 12 in `name.test.ts`; add-vehicles 25, vehicle-installer 185.
