# 098/01 — Data foundations (read what the fleet already authors)

**Goal:** every piece of authored data the land fleet needs is parsed, typed and reachable at runtime —
and a mod that ships bike handling can actually install it. Pure parser/adapter work, fully headless.

## What exists (recon 2026-08-04)

- `vehicle-defs.parser.ts:4-49` keeps `id, model, txd, type, handlingId, gameName, wheelModelId,
  wheelScale*`; **drops `anims` (col 6), `class` (col 7), `flags` (col 9), `upgradeClass` (col 14)**.
  Rows with ≤ 13 columns are dropped by a count guard (`:32-34`) — that is what excludes boats, not a
  type check.
- `handling.parser.ts:20` keeps only letter-leading lines: the `!` bike table (13 rows,
  `handling.cfg:355-367`, legend `:348-353`), the `^` anim-group table (30 rows, legend `:404-425`) and
  the `$`/`%` tables are all dropped. Test at `handling.parser.test.ts:15-16` asserts the skip.
- `gta-sa-world.adapter.ts:672-714` consumes main-row indices 0-5, 7-26, 28, 30. **Unread: 6
  `percentSubmerged`, 27 `seatOffsetDistance`, 31 `handlingFlags` (hex — hydraulics, `NO_DOORS`,
  `TANDEM_SEATS`), 32/33 front/rear lights, 34 `animGroup` — the row index into the `^` table, i.e. THE selector
  of a vehicle's whole animation set (13's finding, 2026-08-20; `vehicles.ide` `anims` only names the IFP to
  stream).** Of `modelFlags` (30) only the axle nibbles
  are used; the class nibble (`IS_BIKE` etc.) is parsed into the integer but never tested.
- `VehicleDef.type` never reaches the runtime: `loadVehicleData` (`gta-sa-world.adapter.ts:346-370`)
  returns `EngineVehicleData` without it. The `type === 'car'`-style filters in the repo are
  `road-cars.ts:60`, `vehicle-models.ts:34` and — since 097/05 — `cleoIsCarModelId`
  (`gta-sa-world.adapter.ts:327`, `car | mtruck | quad`).
- `vehicle-installer`: `stripHandling` (`strip.ts:61-71`) carries `!` lines through, but `classify`
  (`settings.ts:94-123`) rejects them (`parseHandling` yields nothing) and `mergeHandling`
  (`merge.ts:28-42`) cannot match them — **a mod's `!BIKE` lean row is silently dropped at install.**
- `scripts/debug/handling-diff.ts:64` carries a stale `READ` set comment from 081/01.

## Steps

- [ ] **`vehicles.ide` columns.** Parse `anims` and `class` into `VehicleDef` (keep the column-count
      guard as is — boats stay a 0.6.0 problem, the guard is documented there). `flags`/`comprules`/
      `upgradeClass` stay unread until a consumer exists (say so in the parser comment).
- [ ] **`!` bike table.** New `BikeHandlingEntry` keyed by handling id. Column semantics recovered from
      gta-reversed (`cHandlingDataMgr::LoadBikeHandlingData` / `tBikeHandlingData`) — names like
      `LeanFwdCOM`, `LeanBakCOM`, `MaxLean`, `DesLean`, `FullAnimLean`, `WheelieAng`, `StoppieAng`,
      stability multipliers; the doc comment cites the reversed struct field per column. No guessed
      meanings: a column we cannot ground stays named `unknownN` and typed, never interpreted.
- [ ] **`^` anim-group table.** New `VehicleAnimGroupEntry` (30 rows): enter/exit clip pairing, door
      open/close timings, the flag bits (`4 = kart drive anims`, `8 = truck drive anims`). Consumer lands
      in 04/07; the parser lands here so fixtures cover the whole file once.
- [ ] **`handlingFlags` + model-class nibble.** Fetch col 31 as hex into `VehicleHandling`; expose the
      named bits a consumer is planned for (hydraulics → 06, `NO_DOORS`/`TANDEM_SEATS` → 07). Bit
      positions from gta-reversed, cited per constant. Same for `modelFlags`' class nibble
      (`IS_BIKE`/`IS_HELI`/`IS_PLANE`/`IS_BOAT`) — parsed and named, used by 03's spawn-time class check.
- [ ] **`seatOffsetDistance` (col 27).** Type it now (07 consumes it for seat placement per class).
- [ ] **Thread class to runtime.** `EngineVehicleData` gains `type` (+ `anims` name); `EnterableVehicle`
      learns its class. Replace nothing yet — 03/05/07 branch on it; this step only makes it visible.
- [ ] **Installer `!`-line support.** `classify` recognises a bike-handling line as part of the handling
      block; `mergeHandling` matches `!<ID>` rows the way it matches `<ID>` rows; `--strip` behaviour
      unchanged. Negative tests first (malformed `!` line, `!` id with no main row), per the repo test
      rules.
- [ ] **Docs in the same change.** `docs/contracts/vehicles.md` §2: the newly-read columns and what a
      wrong value does; `handling-diff.ts` READ-set comment refreshed; `docs/edge-cases/` row for the
      boat column-count drop if not already recorded.

## Verification

Headless only: parser fixtures drawn from the REAL built files (all 212 `vehicles.ide` rows, all 13 `!`
rows, all 30 `^` rows — real fixtures over synthetic, per the standing memory rule); vehicle-installer
merge round-trip on a synthetic bike mod (a `!` row survives install → strip → rebake byte-identical).
Ledger below records row counts parsed/dropped before vs after.

## Ledger

(numbers after each step — parse counts, dropped-row census, install round-trip result)
