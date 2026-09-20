# The world ambient floor (max() over the timecyc term)

**Where:** `packages/game/src/adapters/engine-environment-driver.ts` (`worldLight.ambientFloor`,
default 0.13) — plan 093, on top of the honest timecyc-ambient term.

**Stands in for:** nothing in SA — this is a DELIBERATE deviation. The recovered formula (SkyGfx
`ps2BuildingVS`: `Color.rgb += ambient*surfAmb`) is faithfully implemented, but the recovered DATA
killed the expectation behind it: vanilla `timecyc.dat` authors daytime `Amb` at ~zero
(EXTRASUNNY_LA noon = `11 0 0`, byte-identical in the 2004 PS2 `timecycp.dat` and a third-party
original). Real SA therefore renders a black-day-prelit wall BLACK at noon — buildings have no
directional term at all (the sun on walls is entirely baked prelight), and the ambient the formula
adds is negligible by day. The 024 Family B mod models (`gaz27_law`, `sphinx01_lvs`,
`exclbr_hotl02_lvs` — black holes on sunlit walls) are broken in the original game too; our engine
was accidentally SA-faithful in showing them black.

**What we do:** `ambientColor = max(lin(timecyc Amb) × worldLight.ambient, ambientFloor × (1 − dn))`.

- `max()`, not `+`: whenever a timecyc (stock or mod) authors MORE than the floor — nights (35 35 35
  ≈ lin 0.0126), fog weathers — the timecyc keeps full authority and the floor is invisible.
- `× (1 − dn)`: the floor retires at night, so authored darkness (and dark horror-mod timecycs)
  survives untouched.
- `0.13` day value: **fitted, not derived** — it reproduces the field-approved `--prelit-floor 40`
  experiment (prelit byte 40/255 × sunIndirect 0.85 ≈ 0.133 in the shader's lit units), the look the
  user judged "the wall looks right now" (2026-07-29).

**Judged on:** the 024 field round — `gaz27_law`'s black wall with the data-side floor emulation;
plus the map-wide scan showing 2 243 models carry all-black day triangles (repairing data at that
scale rewrites the original map; the user chose the engine level explicitly).

**What would retire it:** (a) deciding strict SA parity is the wanted look after all
(`ambientFloor: 0` IS that, live-tunable — the black walls return on demand); or (b) a data-side
repair pass that fixes broken mod prelight at the source, after which the floor could drop to a
purely cosmetic value or 0.

**What else moves if it changes:** the whole map's daytime shadow-side brightness (every prelit
below 0.13 rides the floor); the `WORLD AMB FLOOR (093)` debug slider; the day/night balance
against `dayBrightness` 0.85 (both multiply/lift the same indirect lane); plan 093's field
calibration round assumes 0.13 as the starting point.
