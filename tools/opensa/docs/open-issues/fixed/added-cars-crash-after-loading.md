# The added fleet's TUNING crashes at the end of loading — it was OUR OWN `Vehicle colors = 256`

> **✅ FIXED 2026-08-19, field-confirmed the same evening (session 30).** The tuning data was never the
> cause. The crash came from an FLA setting **we** added on an inference four commits earlier (`db1f0ca4`):
> `Vehicle colors = 256`, set because the built palette carries 142 `col` rows against the 128 of FLA's own
> ini annotation. Crossing "over 255" makes FLA apply a **uint32 colour-id patch family** (+122 memory
> changes, `3712` → `3834`) and this install dies at the end of loading with it. Commented back out in
> `mods-src`, `build/original/sa` and the bottle → **the game loads with the tuning on**: full
> `carmods.dat`, full `shopping.dat`, all 46 `veh_mods.ide` rows, 115 added cars, and the mod shop serves
> every derived part. FLA's log is back to `Number of memory changes made: 3712`.
>
> **Correction, same evening**: run 5 was first written up here as carrying the FULL tuning "including
> ModelVariations". It did not — `ModelVariations_Vehicles.ini` was still the 1 097-byte stripped file from
> run 2 (the full one is 23 765 B), and I restored `shopping.dat` and `carmods.dat` without checking it. The
> verdict on the colour setting stands, but the composition of run 5 was smaller than claimed. **The process
> lesson: when a bisect ends, restore EVERY arm it ever stripped and diff the bottle against the tree — not
> just the arm you removed last.** The user found it from the game: the names were there and the traffic
> tuning was not.
>
> **The user's own history was the correct evidence all along** — he never raised the setting and the install
> has always run its palette without it. Four field launches were spent bisecting the tuning data because
> three docs recorded the setting as "tried and reverted" while it was live in all three trees; the revert
> had been written down but never performed.

## The lesson, and it is the expensive one

**A bisect that moves nothing is not telling you about the half you removed — it is telling you the variable
is not in the data at all.** Runs 1–4 stripped ModelVariations, `shopping.dat` and the 65 `carmods` lines one
at a time and the dump never moved by a single register (runs 3 and 4 matched even in their heap addresses).
That invariance was the signal, and it was read as "keep splitting" for three launches.

Two rules came out of it, both already in the standing set and both violated here:

1. **Do not touch the install's adjuster settings on an inference.** FLA's `(128)` is an ini annotation, not
   a ceiling anyone had watched bite, and the installer's `vehicleColourWarnings` prints a count precisely
   because the number is inferred. A warning is not an instruction to change the install.
2. **A revert is done when the file changes, not when the doc says so.** Three docs claimed this setting had
   been reverted. It had not, and that turned a live, invasive patch family into an "excluded" variable at
   the top of every subsequent triage.

## Why it crashes — NOT known, and worth one RE session

What is measured: with the setting on, the game faults at the end of loading, always identically, in the
first pass that walks a heap structure (a pickup's `CObject` construction, below). With it off, the same
tree loads. The mechanism between "FLA widens the colour id to uint32" and "a pointer that structure holds
is garbage" is unread. `255` would be enough headroom if the palette ever genuinely needs raising (a
vehicle's colour is a byte in the save), and staying at or below 255 avoids the whole patch family — that is
the cheap route if the day comes.

## What the crash says

```
Unhandled exception at 0x40B30890 in gta_sa.exe: 0xC0000005: reading location 0x40B30890
EDI: 0x000004FD   EBP: 0x009789C4   (stack: 0x83D326, 0x456878, 0x457332, 0x47E63B, 0x47D415, 0x4693D8)
```

`0x40B30890` is outside the image — **execution jumped through a corrupted pointer**, which is the signature
of a fixed-size array being written past. The frame is `CPickups` (`0x9788C4` is `aPickUps`; `EDI = 1277` is
`pickupsave`, the save icon) — pickups are simply the first thing that walks over the corrupted memory at the
end of loading, not the cause.

Reproduced **byte-identically twice**, with ModelVariations present and then stripped — so MV is excluded and
the cause is inside the tuning half.

## What has been excluded

| | |
| --- | --- |
| the cars themselves (ide + handling rows, models, carcols, parked) | **loads and drives** |
| ModelVariations sections + tuned traffic | same crash with and without → excluded (and it stayed stripped in the bottle until 2026-08-19 21:2x — see the correction above) |
| **`shopping.dat`** | **EXCLUDED 2026-08-19 (run 3)** — stripped to 174/71/90, same crash byte-identically |
| both `carmods.dat` ceilings | measured on the built tree: per-car max **15** listed parts against the 16 the array allows, link list **31** pairs on `perfect-vehicle`'s 256-entry storage (`links APPLIED: 256 pairs` in its log) |
| model `1277` itself | `pickupsave` in `data/maps/generic/dynamic.ide`, row intact — the pickup is the victim, not the cause |
| a `veh_mods.ide` row with no model | all 48 added rows resolve; the two that looked missing (`1194 spl_b_lr_bl`, `1195 bnt_b_lr_bl`, the blade mod's parts) are in `models/vehicles2.img` |
| `perfect-vehicle.asi` (the `link` array) | loaded and applied; the crash is identical in shape to runs where it was OFF |
| **the 65 `carmods` `[mods]` lines** | **EXCLUDED 2026-08-19 (run 4)** — stripped, same crash, identical to the byte |
| the 46 `veh_mods.ide` rows | never had to be tested — the full tuning loads with the colour setting out |
| FLA `Vehicle Models` | tried, reverted, unrelated |
| **FLA `Vehicle colors = 256`** | **THE CAUSE** — see the header |

### Run 3 — 2026-08-19 18:53, `shopping.dat` stripped

`logs/gta_sa.exe_2026-08-19_18-54-13.log`. Identical to runs 1 and 2 in every register that is not a heap
address: `EIP 0x40B30890`, `EDI 0x000004FD`, `EBP 0x009789C4`, same six stack frames. Only `EAX`/`EDX`/`ESI`
moved (`0x0CF80B64` → `0x0D050B64`).

The frames, disassembled against `fixtures/original/gta_sa.exe`:

| frame | what it is |
| --- | --- |
| `0x457332` | `lea ebp,[esi+0x9788C4]` = `CPickups::aPickUps`, then `call 0x4567E0` with the slot |
| `0x456878` | inside it: `movzx edx,WORD PTR [edi+0x18]` (the model id) → `call 0x5A1F20/0x5A1F60` — the pickup's `CObject` is being built |
| `=> 0x40B30890` | the call target itself, outside the image — a **jump through a pointer that is already garbage** |

So a structure the object constructor walks is corrupt before pickups ever touch it. Pickups are simply the
first pass at the end of loading that walks it.

## The live confounder found while reading this run's log — `Vehicle colors = 256`

FLA's log of run 3 closes with `Number of memory changes made: **3834**`, not the 3712 recorded as this
install's healthy line, and it carries
`Vehicle colours limit is over 255 … Applying colour ID uint32_t patches`.

**The setting is on, in `mods-src`, in `build/original/sa` and in the bottle.** It was set deliberately
earlier the same day (the built palette is 142 `col` rows against FLA's annotated 128) and then written up
in two docs as "tried and reverted", which it never was. Both docs are corrected. It is applied in the boots
that WORK as well as in the ones that crash — so it is not the top suspect, but it has never had a field
verdict of its own and it is not an excluded variable.

## The guard that has gone blind

`npx tsx scripts/debug/carmods-check.ts` now reports **65 failures on a healthy tree** — every added car's own
`[mods]` line, e.g. `'001veh' in "001veh, nto_b_l, …"`. The cars' IDE rows moved to
`modloader/added-vehicles/<slot>.settings.txt`, and the checker only reads `.ide` files under `data/`. Either
it learns to read Mod Loader's readme rows, or the guard is permanently red and stops being read — which is
how the crash class it exists to catch gets shipped. Fix it in the same change as the next add-vehicles step.

### Run 4 — 2026-08-19 19:05, the 65 added `[mods]` lines stripped

`logs/gta_sa.exe_2026-08-19_19-05-34.log`. Identical to run 3 in **every** register including the heap
addresses (`EAX`/`ESI` `0x0D050B64`). That is the invariance the lesson above is about.

### Run 5 — 2026-08-19 19:08, everything restored, `#Vehicle colors = 256`

**Loads.** Full `carmods.dat`, full `shopping.dat`, every `veh_mods.ide` row, ModelVariations, the whole
fleet. No crash dump. `fastman92limitAdjuster.log`: `Number of memory changes made: 3712`.

## Superseded — what the next step WAS going to be

1. **The test armed in the bottle now** (2026-08-19, session 30): `shopping.dat` restored to the full
   212/83/116 and the **65 added `[mods]` lines stripped from `data/carmods.dat`** — one variable against the
   full crashing configuration. The `veh_mods.ide` rows, the parts' models and the shop entries all stay.
   Backup of the full file: `data/_bisect-backup/carmods.dat.full`.
   - **boots** → the cause is in the carmods lines themselves, and the remaining split is per-line: the
     `nto_b_*` nitro triple every added car carries, versus the derived parts of the 9 cars that have them.
   - **still crashes** → carmods is out too, and what is left standing is the 46 `veh_mods.ide` rows and the
     colour patch family above. Strip the `veh_mods.ide` rows next, then `Vehicle colors`.
2. Whatever the verdict, it goes into `tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md` with the run's log name.

## Where the state is

Bottle and built tree both carry the full fleet, the full tuning and `#Vehicle colors = 256` commented out.
`data/_bisect-backup/carmods.dat.full` in the bottle can be deleted; nothing else was left armed.

**Still open, and now the next thing to do**: the 21 unticked rows of
[`tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md`](../../../tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md) — traffic, tuned
traffic, the shop, the HUD name, the engine sound — none of which has been seen yet, and all of which the
loading crash was blocking.
