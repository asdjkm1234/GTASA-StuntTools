# The vehicle colour table is 128 rows, and the shipping build is already past it

**Found 2026-08-19** while making `tools/add-vehicles` idempotent (plan 002): the run's second pass grew
`carcols.dat`'s `col` palette by five rows, every time.

## The numbers

| tree | `col` rows |
| --- | --- |
| stock (`game-src/original`) | **127** (ids 0–126) |
| the shipping build (`build/original/sa`) | **140** |
| + the 115 added cars | **145** |
| the table the game holds them in | **128** — `Vehicle colors (128)` in FLA's own ini, and that line is COMMENTED OUT in the reference install, so 128 is what runs |

FLA writes the game's own default in the parentheses, which is where the 128 comes from — it has not been
read out of a disassembly here, and that is exactly why the installer WARNS about the overflow instead of
refusing it (`vehicleColourWarnings`). A build the user plays every day is not a build a tool gets to refuse
on an inference.

## What made it grow, and what that says

`addPaletteColors` appended a mod's custom colours **unconditionally**: every `--rebake` of a car that
authors colours added the same rows again and re-pointed that car's carcols line at the new ids. The
evidence is in the shipping build itself — three colours are in it twice:

```
57,124,155   # 131 spinnaker blue solid   blue      …and again at # 138
108,4,0      # 132 coral red     light              …and again at # 139
88,76,51     # 134 jlf beige dark beige  dark       …and again at # 137
```

Fixed the same day: a colour whose RGB **and** description already exist is reused, so the palette is a
function of the mod set rather than of how many times the installer ran. The existing twins are left where
they are on purpose — collapsing them would renumber colours that cars already reference by id.

**The general lesson is the one this repo keeps re-learning**: a merge that is not idempotent does not fail,
it DRIFTS, and the drift is only visible against a fixed-size table nobody was counting.

## What is still not known

The array's real length, and what sits behind it — nobody has read
`CFileLoader::LoadVehicleColours` / `CVehicleModelInfo::ms_vehicleColourTable` out of the exe or the reversed
source. What the field has settled is the practical half, below: 142 rows run, and RAISING the adjuster's
limit is what breaks.

## The setting was tried, and it CRASHES this install — field verdict 2026-08-19

`Vehicle colors = 256` was set on 2026-08-19 (`db1f0ca4`) on the inference this file records: the palette is
past FLA's annotated 128, so give it headroom. **It is what was killing the added fleet at the end of
loading** — the game faults identically in every run with it on, and loads with the FULL tuning the moment it
is commented back out (`docs/open-issues/fixed/added-cars-crash-after-loading.md`, runs 1–5). It cost four
field launches, because the same evening three docs recorded it as "tried and reverted" while it was live in
`mods-src`, `build/original/sa` and the bottle — the revert had been written down and never performed.

**So the two numbers this file was unsure about now have field answers:**

| question | answer |
| --- | --- |
| does the build really run past FLA's 128? | **yes — 142 `col` rows, loading and playing, with the setting untouched.** The install has done so for as long as the mod set has existed |
| is FLA's 128 a ceiling that bites? | **no evidence it is.** Nothing has been observed to break at 142 |
| is raising it safe? | **no — it is the opposite.** Crossing "over 255" applies a uint32 colour-id patch family (`Applying colour ID uint32_t patches`, +122 memory changes, `3712` → `3834`) and this install dies at the end of loading |

**The mechanism is unread**, and that is the honest state: what is measured is the effect, not the cause. If
the palette ever genuinely needs raising, **255 is the value to try** — the palette is 145 rows with the added
fleet, a vehicle's colour is a byte in the save, and 255 stays under the threshold that pulls in the patch
family at all.

**What `vehicleColourWarnings` should keep doing: warning.** It prints the count against an inferred limit
and refuses nothing, and that shape was right — the failure here was reading its warning as an instruction to
change the user's install. A build the user plays every day is not a build a tool, or an assistant, gets to
reconfigure on an inference.

## Where this bites

- `tools/vehicle-installer` — the palette merge (plan 003) and the report on every install/rebake path.
- `tools/add-vehicles` 002 — 115 added cars want five colours of their own.
- `docs/restrictions/sa-target.md` carries the one-line rule.
