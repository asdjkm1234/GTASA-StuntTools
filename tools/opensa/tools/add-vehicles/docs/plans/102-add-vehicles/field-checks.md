# The field round of plan 102 — what to look at, once, at the end

The chain's steps each end in something only the real game can answer, and each of them is worth seconds of
play — but a delivery + boot + drive is not. So the verdicts ACCUMULATE here (the user's call, 2026-08-19)
and are collected in ONE round when the chain is built, instead of one round per step.

**How to read a row**: _deliver_ is what has to reach the bottle for that check (a path under
`build/original/sa`), _look at_ is the observation, _if it fails_ names where the cause would be. Tick the
box and write the verdict + date into the owning plan's `## Measured` when the round is run.

**Before the round**: `stat` the bottle against the built tree — a stale bottle has cost a whole session
before (session 19). After any ROOT delivery, read FLA's `Number of memory changes made` (3712 = healthy)
before diagnosing anything.

---

## The field state as of 2026-08-19 evening — read this first

Seven launches went into the road the added cars take, and the result changed the design:

- **PROVEN**: the 115 cars load, drive, and a parked added car appears. Their `vehicles.ide` and
  `handling.cfg` rows go into `modloader/added-vehicles/<slot>.settings.txt`, not into `data/` — baked there
  they kill the game before a window appears. Mod Loader merges them by matching data lines by SHAPE
  ([the facts](../../../../../docs/gta-sa-original/modloader-data-files.md)).
- **CLOSED 2026-08-19 evening**: the loading crash was never the tuning —
  [`docs/open-issues/fixed/added-cars-crash-after-loading.md`](../../../../../docs/open-issues/fixed/added-cars-crash-after-loading.md).
  It was `Vehicle colors = 256`, an FLA setting we had added on an inference; with it commented back out the
  game loads with the FULL tuning on (run 5, 19:08, FLA `Number of memory changes made: 3712`). Four
  launches were spent bisecting the tuning data first — ModelVariations, `shopping.dat` and the 65
  `carmods` lines each excluded in turn, the dump never moving.
- **NOT YET SEEN AT ALL**: traffic (ModelVariations), tuned traffic, the shop, the HUD name, the engine
  sound. Everything below this line still stands, it just has not had its turn.

## From `vehicle-installer` 012 — trailers and part names (BUILT 2026-08-19)

- [ ] **A truck tows its trailer.** Deliver `modloader/Model_Variations/ModelVariations_Vehicles.ini`.
      Look at: a `tug` or `baggage` met at the airport pulls `bagboxa`/`bagboxb`/`tugstair`; a `linerun`
      or `towtruck` in traffic pulls one of its own list. If it fails: the section is in the built ini
      (verify first — it is 45 lines longer than the mod's), so the cause is the plugin's own reading of
      it, not the merge. `ModelVariations.ini` → `EnableLog=1` prints its parse errors.
- [ ] **The slamvan's two bonnets have names in the shop.** Deliver `cleo/cleo_text/slamvan.fxt` (55 B).
      Look at: a slamvan in a mod shop → the bonnet items read "Slamin Hood" / "Chromer Hood" instead of
      blank. If it fails: CLEO's FXT loader did not pick the file up. **The folder is the contract** —
      `CLEO/CLEO_TEXT/`, never `cleo/` beside the scripts; every `.fxt` was landing one folder up until
      2026-08-19. Do NOT use `cleo/ResprayPrice.fxt` as the control, as an earlier revision of this row
      said: it sits in `cleo/` because its own mod put it there, which proves nothing about the channel.
- [ ] **`petro` and `rdtrain` still behave.** Their sections ship with unresolved `{{205veh}}`-style
      placeholders on purpose (those are ADDED cars; `add-vehicles` allocates the ids). Look at: nothing
      breaks around them — ModelVariations logs an invalid model id and skips.
      **Measured 2026-08-19, and the expectation in this row was wrong**: 4 placeholders survived
      add-vehicles 002 in the built ini (`[petro] Trailers1`, `[rdtrain] Trailers1/2/3`) and always would —
      they name slots `205veh`–`216veh`, trailers of a set this fleet does not contain (trains are
      add-vehicles 008+). **Settled the same day (the user's call): an unresolvable name is DROPPED.**
      `[petro]` keeps `Trailers1=584` and still tows its stock trailer; `[rdtrain]`'s three chains and the
      `Global` that referenced them are gone, so it tows nothing rather than being refused. So what this row
      now looks at: petro tows 584, rdtrain behaves like a stock rdtrain, and the plugin's log carries no
      `invalid model id` for either.

## From `vehicle-installer` 013 — sound and parking (BUILT 2026-08-19)

**No folder in `vehicles/` ships either file today** — the four `audio.txt` and the one `parked.txt` live in
the ADDED-cars root, so both rows below are really exercised by add-vehicles 003. They can be brought
forward by authoring one file into a replacement car's folder (the user's `mods-src`, so his call).

- [ ] **A car with its own `audio.txt` sounds different.** Deliver `data/gtasa_vehicleAudioSettings.cfg`.
      Look at: the car whose row was authored starts and revs with the borrowed engine, not its stock one.
      If it fails: FLA's `Enable vehicle audio loader = 1` (on in the reference install), and the row's
      column count — the installer refuses a wrong one, so a silent miss means the row never merged.
- [x] **A `parked.txt` car stands where it says.** ✔ 2026-08-19 (the vega appeared at its spot) Deliver `cleo/Parked Car Maker.ini`. Look at:
      **after a NEW GAME** (parked cars land in the save, and `Accept any ID for car generator = 1` changes
      the save format), the car is at the authored spot. If it fails: mod 47 present, that FLA setting on.
- [ ] **The car-generator array is not starved.** Only worth doing once a real number of parked rows
      ships (add-vehicles 003). Switch FLA's `Car generator limit exceeded = 1` on, drive the busiest area
      (downtown LS at ground level), and read the log — this is the measurement
      `docs/gta-sa-original/car-generators-500-and-the-map-1045.md` says nobody has taken.

## From `add-vehicles` (002 BUILT 2026-08-19; 003–007 to come)

- [x] **The models load AT ALL — they are not in an archive any more.** ✔ 2026-08-19 Deliver
      `modloader/added-vehicles/` (322 files, 1.4 GB) with the rest. Look at: modloader's log carries
      `Importing model file for index <id> at "modloader\added-vehicles\001veh.dff"` — that line is the
      proof a file reached the game, and it is the FIRST thing to read if a car spawns invisible or as a
      stock model. If it is missing: `modloader.asi` active, and the folder actually delivered (it is 1.4 GB
      — a partial copy is the likely failure).
- [x] **A tuning part loads under its DERIVED name.** ✔ 2026-08-19, log-proven — **46 of 46** derived parts
      carry an `Importing model file for index <id> at "modloader\added-vehicles\<name>.dff"` line, and
      **0** stock parts are served from that folder, so the base car's own set is untouched. 059veh's ten
      parts land at 19051–19060, including all four names at the **19-character ceiling**
      (`fbmp_lr_rem1_059veh`, `rbmp_lr_rem2_059veh`, `wg_l_lr_rem1_059veh`, `wg_r_lr_rem1_059veh`) —
      **so the derived scheme needs no shortening map**, which was the open question the user raised from
      his own earlier tool.
- [x] **An added car exists and drives.** ✔ 2026-08-19 Deliver the vehicles archive family (`models/vehicles*.img`),
      `data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat,gta.dat}` and `data/vehicle-adds.txt`.
      Look at: spawn `19001` (the vega) with a trainer — it appears, it is the right model, and it drives
      with its OWN handling rather than the manana's. If it fails: the handling row is the one that was
      silently dropped before this plan (a digit-leading id), so check `handling.cfg` holds `001VEH`.
- [x] **The archive count is back to 8 of 8.** ✔ 2026-08-19 (the models are loose in modloader) The added cars used to want a ninth archive; they are loose
      now. Look at: the game boots at all (past the eighth archive it crashes at load with no symptom that
      points anywhere useful) — `data/gta.dat` should carry 5 `IMG` lines and `models/` 6 archives.
- [ ] **An added car has a NAME in the HUD.** Deliver `cleo/*.fxt`. Look at: entering the vega shows
      "1971 Chevrolet Vega", not a blank or a key. If it fails: CLEO's FXT loader, and whether the ide row's
      `gameName` is what the fxt keys on.
- [ ] **The stock trains kept THEIR names.** 9 added carriages deliberately get no `.fxt` because their
      gameName is the stock train's key. Look at: the freight train is still called what it always was.
- [ ] **An added car with no `audio.txt` sounds like its base.** 111 of the 115 inherit. Look at: the vega
      starts and revs like a manana rather than being silent.
- [ ] **An added car turns up in traffic on its own.** Deliver
      `modloader/Model_Variations/ModelVariations_Vehicles.ini`. Look at: drive the poor-family
      neighbourhoods (the manana's) and the vega appears without a cheat. If it fails: `EnableVehicles=1`
      in `ModelVariations.ini`, and `EnableLog=1` to see the plugin's own parse.
- [ ] **The one-section-per-model reading is the right one.** We write `[manana] Global=410,19001` where the
      user's older tool wrote the tuning keys in `[voodoo]` and the variations in `[412]` — two sections for
      one model. Look at: an added car spawns AND (once 006 lands) the tuned traffic still works for the same
      base. If only one of the two happens, the plugin keys sections by resolved model and the two writers
      must stay in one section — which is what we already do, so the failure would instead say the plugin
      wants them apart.
- [ ] **`petro` and `towtruck` still tow.** Both are a base AND author trailer keys; their `Global` now reads
      `Trailers1,<baseId>,<addedId>`. Look at: they still pull their trailer sets.
- [x] **An added car's own tuning parts fit it.** ✔ 2026-08-19, the user's own shop round: the parts are
      there and nothing crashes. Deliver `data/carmods.dat`, `data/shopping.dat`,
      `data/maps/veh_mods/veh_mods.ide` and the vehicles archives. Look at: take `059veh` (the Charger) to a
      mod shop — its bumpers, exhausts and wings are listed under the base's names, cost the base's prices,
      and sit on THIS body. A wing bought once fits both sides (the link). If it fails: the part is in
      `veh_mods.ide` under `<stock>_<slot>` with the added car's TXD, so check the TXD carries its textures.
- [ ] **The base car did not change.** The stock `remingtn` keeps its own parts — nothing was renamed out
      from under it. Look at: a remington in a mod shop still has its full set. **Half of this is already
      log-proven** (2026-08-19): no stock part name is served from `modloader/added-vehicles/`, so nothing
      was renamed out from under the base; what is unseen is the shop list itself.
- [ ] **Traffic is TUNED, at about the configured rate.** 103 models carry a tuned section
      (`TuningChance=75`, `TuningFullBodykit=1`). Look at: roughly three cars in four wear parts or a paint
      job. Too much or too little is one number in `mods-src/original/add-vehicles/add-vehicles.json` and a
      re-run — no rebuild. If police or emergency cars look wrong tuned, that is the `exclude` list.
- [x] **`Vehicle colors`** — NOT NEEDED: tried, reverted, and the install has always run 140 rows without it Set 2026-08-19 because the palette (145 rows with the
      added cars) was over the game's own 128 —
      `docs/gta-sa-original/vehicle-colour-table-128.md`. Deliver `fastman92limitAdjuster_GTASA.ini`.
      Look at: FLA's log names the setting, `Number of memory changes made` is still healthy (3712 was the
      figure before), and cars painted with ids above 127 (the added ones use 140–144) show the right
      colour. If FLA refuses the number it says so in its log — that is the first place to read.

## From `asi/perfect-vehicle` (link half BUILT 2026-08-19)

**This is the round's riskiest delivery — it rewrites two functions of the exe.** Deliver
`perfect-vehicle.asi` into the game root beside `perfect-map.asi`, and keep the previous `carmods.dat` to
put back.

- [x] **It loads and says so.** ✔ 2026-08-19 — `perfect-vehicle-asi.log` reads `fingerprint OK`, both
      adjusters detected, `links APPLIED: 256 pairs (stock 30), both accessors on our storage`.
      Look at: `perfect-vehicle-asi.log` beside the others, ending in `links APPLIED: 256 pairs`. A `DEFER` line instead means a site's bytes have moved — the log names
      which, and that is the whole diagnosis.
- [x] **31 link pairs boot.** ✔ 2026-08-19 — the full 115-car `carmods.dat` boots and plays.
      Look at: the game boots and plays. Before the plugin this was the pair that would have written past the array.
- [ ] **Both wings of a re-modelled set swap together.** Take `059veh` (the Charger) to a mod shop and buy
      a wing: the mirror appears on the other side. That is `FindOtherUpgrade` — our replacement — doing its
      job, and it is the single most direct test of the patch.
- [ ] **The stock links still work.** A stock car's mirrored parts (`blade`, `slamvan`) pair as they always
      did: our storage is loaded from the same `carmods.dat`, so the 23 stock pairs must behave unchanged.
- [ ] **Eight world entries.** The perfect-map 011 ladder, as the regression: nothing else moved.
- [ ] **Then take the plugin away.** With the stock `carmods.dat` back and no `perfect-vehicle.asi`, the
      game is what it was. A patch that cannot be removed is one nobody can bisect.
