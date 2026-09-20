# The unmountable tuning lines were cleaned BY HAND, not by a build check

**Live.** Taken 2026-08-22 (`vehicle-installer`
[plan 015](../../tools/vehicle-installer/docs/plans/015-a-replaced-car-does-not-inherit-tuning.md) step 2, the
user's call after the field crash it closes).

## What it is

26 mod cars declared a `carmods` line in their own `*.settings.txt` naming universal Transfender parts their
model cannot mount — a part of the `*_b_*` families hangs on a `ug_*` dummy inside the car
(`ug_bonnet`, `ug_spoiler`, `ug_roof`, `ug_wing_left/right`, `ug_lights`, `ug_nitro`) and most replacement
models do not carry those dummies over. **Those lines were deleted from the mods' own settings files**, once,
by a script run against `mods-src/original/{vehicles,add-vehicles}` — and the tree now has none.

The rule they violated is written down in
[`docs/contracts/vehicles.md`](../contracts/vehicles.md) ("A car's tuning line is a claim about its MODEL")
and summarised in [`docs/restrictions/assets-and-data.md`](../restrictions/assets-and-data.md). **Nothing in
the build enforces it.**

## What it stands in for

The check the installer should carry: when it writes a car's `mods` line, drop the parts whose `ug_*` mount
the car's own model does not have, and warn naming car and part. It is not hard — the mount table is derived
from stock data, the installer already parses car DFFs in `upgrade-collision.ts`, and parsing the whole fleet
costs **3.6 s for 327 models / 2 132 MB** (measured the same day). It was not built because the user chose the
data fix, which is correct for the fleet as it stands and wrong for the fleet as it grows.

## What it was judged on

Measured, not assumed. Stock SA has **0 of 77** cars offering a part its model cannot mount; our built tree
had **30 of 154**. Of those 30, four inherited a stock line (step 1's code rule removes those) and 26 declared
one — and **27 of the 30 lines are entirely unmountable**, so deleting the whole line loses nothing: none of
the 26 ships part `.dff`s of its own, and every one of their lines was nitro-only. After the edit the same
census over the source tree reports **0**.

The defect it closes is not cosmetic: installing a part whose dummy is absent kills the real game at
`0x007F0BF7` ("frame did not find the child"), and it needs nobody to visit a mod shop — `ModelVariations`
spawns traffic already tuned, which is how it was found, twice, from a helicopter.

## What would retire it

The installer growing the check. The trigger is a NEW mod: the moment one arrives whose settings name a part
its model cannot mount, the crash is back and nothing says so — no build error, no warning, and the field
symptom is a crash in traffic minutes later, with the upgrade id readable only from the stack of the dump.
**A crash log at `0x007F0BF7` after any fleet change is this card's signal**; the mount table and the census
method are in plan 015, so rebuilding the instrument costs nothing.

## Blast radius

- Only `mods-src/<game>/vehicles` and `add-vehicles` settings files were touched, one line each; the removed
  lines and the original files are backed up under `NO_COMMIT/carmods-lines-removed-2026-08-22/`, because
  `mods-src/` is gitignored and git cannot restore them.
- Those 26 cars are no longer tunable at all. That costs nothing today (their lines offered only parts that
  would have crashed), but a mod UPDATE that adds the missing `ug_*` dummies will not restore its tuning by
  itself — the line has to be put back.
- Re-running the fleet install from a fresh copy of the mods (a re-download, a restored backup) brings the
  lines back with it. **This hack lives in data that is not under version control**, which is the other half
  of why it is written here.
