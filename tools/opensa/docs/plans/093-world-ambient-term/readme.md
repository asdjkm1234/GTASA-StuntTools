# 093 — The world ambient term: the piece of SA's own formula the engine skipped

**Status: CLOSED 2026-08-01 — SHIPPED and FIELD-CONFIRMED for BOTH day and night. Nothing is owed.**
Day: 2026-07-29 ("the wall looks right now", and the three Vegas controls "all three look good").
Night: 2026-08-01 — the user looked at the four frames below and the verdict was that they look adequate.
The night pass was answered in two halves: the arithmetic one PROVES our deliberate floor contributes
exactly 0 after dark (so a night frame is one this plan never touched), and the look one confirms the
authored night design survives the timecyc term that is left.
Spun out of map-optimizer plan 024 Phase 3b
([`tools/map-optimizer/docs/plans/024-broken-authored-vertex-data.md`](../../../tools/map-optimizer/docs/plans/024-broken-authored-vertex-data.md))
— read its diagnosis first; this plan only carries the ENGINE half.

## Why (the 024 evidence, compressed)

Field bugs: `gaz27_law` (a whole wall pure black at day), `sphinx01_lvs` (hard black facets),
`exclbr_hotl02_lvs` (black at day, fine at night), `flamingo01_lvs`. All are **authored day-prelit
black holes** — and the map-wide scan says the class is enormous and NOT a mod disease: 2 243 placed
models carry all-black day triangles on a healthy median; of the 186 with ≥100 such triangles,
**125 are vanilla**. Baking shadow to pure black was standard SA authoring practice, because the
original renderer lifts every vertex by an ambient term the shader below is missing.

The recovered formula (SkyGfx `shaders/vs/ps2BuildingVS.hlsl`, aap's PS2-accurate building pipe;
day/night blend confirmed in gta-reversed `CustomBuildingDNPipeline.cpp`):

```hlsl
OUT.Color  = IN.DayColor*dayparam + IN.NightColor*nightparam;  // dn blend
OUT.Color *= matCol / colorScale;                              // material colour
OUT.Color.rgb += ambient * surfAmb;                            // timecycle ambient × surfProps.ambient
```

`ambient = CTimeCycle ambient RGB × LightsMult` — **additive and normal-independent**. Our
`worldShade` runs `lit = prelit×sunIndirect×ao + sun×N·L + moon + local` with **no ambient floor**:
black prelit + a face angled from the sun = pure black, hard-edged against healthy neighbours.

Field proof of the mechanism (024 Phase 2): lifting `gaz27_law`'s day prelit to a luma floor of 40
on the DATA side ("the wall looks right now") — i.e. the missing term, emulated per-model,
is exactly the difference. The fix belongs in the ENGINE, not in map-optimizer: repairing 2 243
models rewrites the original map's data; adding the term restores the formula the data was authored
against. (User decision 2026-07-29: engine level, explicitly.)

## The change

1. **Driver** (`packages/game/src/adapters/engine-environment-driver.ts`): read the timecyc `amb`
   column (already parsed — `TimecycHour.amb`, unused until now), linearize like every other timecyc
   colour, scale by a new `worldLight.ambient` knob (default 1), write `environment.ambientColor`.
   Parametric fallback (paks without timecyc): a fixed day↔night mix in the same range.
2. **Engine** (`packages/engine/src/engine.ts`): `Environment.ambientColor` + default; frame uniform
   grows 100 → 104 floats (`size: 400 → 416`) — a boot-time change, so the recorded-bundle staleness
   the uniform comment warns about does not apply; `probeFrameData` grows with it (it copies the
   frame array wholesale).
3. **Shaders** (`packages/engine/src/render/shaders.ts`): `Frame.ambient: vec4f`; `worldShade` gains
   `+ frame.ambient.rgb * ao` inside `lit` (AO multiplies the ambient term — our SSAO stand-in
   occludes ambient exactly like it occludes the prelit indirect); the `clutter` shader gains the
   same term (no AO channel there). The `rigid` path is NOT touched — its `DYNAMIC_INDIRECT`
   stand-in is a separate debt with its own interaction (024 records it).
4. **Config**: `WorldLightConfig.ambient` (scale, default 1, live-tunable in debug → Atmosphere like
   its siblings).

Magnitude expectation: midday LA `Amb ≈ (78, 83, 89)/255` → linear ≈ 0.07–0.09 — a floor, not a
flood; the existing calibration (`dayBrightness 0.85`) may need a small compensating trim, decided
in the field sweep, not pre-emptively.

## Field round 1 falsified that expectation — vanilla day `Amb` is ~ZERO

First field check (gaz27_law, noon): no change, and the new `WORLD AMBIENT` knob was dead — it was
multiplying an honest zero. **Vanilla `timecyc.dat` authors EXTRASUNNY_LA noon `Amb = 11 0 0`**,
byte-identical in the 2004 PS2 `timecycp.dat` and a third-party original copy (the earlier
"78 83 89" expectation was simply wrong). The mod's whole day span (06:00–20:00) sits at 6–11/0–4.
Consequences, recorded:

- Real SA renders black-day-prelit walls **black at noon too** — buildings have no directional term
  (wall sun is entirely baked prelight), and the day ambient is negligible. The 024 Family B mod
  models are broken in the original game as well; the engine was accidentally SA-faithful.
- The timecyc term stays (it is the formula, and it matters at night — `35 35 35` ≈ lin 0.0126 —
  and in authored weathers), but it cannot fix Family B by day.
- The fix the field approved is therefore a DELIBERATE deviation: **`ambientColor =
  max(lin(Amb) × worldLight.ambient, ambientFloor × (1 − dn))`** — `max()` keeps every timecyc's
  authority whenever it authors more than the floor (custom/mod timecycs included; the user's
  design question), the `(1 − dn)` shape retires the floor at night so authored darkness survives,
  and `ambientFloor` default **0.13** is fitted to the field-approved `--prelit-floor 40` experiment
  (40/255 × 0.85 ≈ 0.133). `ambientFloor: 0` = strict SA parity, live on the
  `WORLD AMB FLOOR (093)` slider. Debt file: `docs/hacks/world-ambient-floor.md`.

## Built 2026-07-29 (same day)

All four change-list items landed: `Environment.ambientColor` (+ noon default), frame uniform
100 → 104 floats / 416 bytes (probe copy grows with it), `Frame.ambient: vec4f`, `worldShade`
`lit = (prelit×sunIndirect + ambient) × ao + …`, clutter `+ ambient` (no AO channel), driver reads
`sample.amb` → `lin3` → `× worldLight.ambient` (parametric fallback mixes day/night constants),
`WorldLightConfig.ambient` (default 1) + debug slider `WORLD AMBIENT (093)` (0–2). Suites: engine
286 ✓ (shader golden snapshot re-baselined — the mechanism working as designed), game 734 ✓ (new
driver case: amb column × knob), web 304 ✓ (capability rows extended). `tsc` + `eslint` clean.
Owed: bench sweep + field round below.

## Field + bench (2026-07-29)

- `gaz27_law` noon, main build, floor active: **"the wall looks right now"** (user) — the
  Family B mechanism closed engine-side, no data touched.
- Bench ritual: all NINE scenes at the 120 Hz cap (incl. the new `strip-noon` debut at 119.9 fps),
  `gpuMs.pass` 1.50–2.69 ms, p95 9.2–9.3, `lateCreates` 0 — a clean A/B against the 092 sweep
  (same pak, engine-only change), no cost.
  Row: `docs/benchmarks/opensa-engine/2026-07-29-headless-093-world-ambient-sweep.json`.
- Day eyeball round: `exclbr_hotl02_lvs` / `sphinx01_lvs` / `flamingo01_lvs` — "all three look
  good" (user, same day). The NIGHT pass was answered on 2026-08-01 — see the section below.

## Verification

- Unit: engine suites stay green (fake-GPUDevice floors); driver test asserts `ambientColor` follows
  timecyc `amb` and the knob.
- Bench ritual (`?engine=opensa&bench=all`) — shader change = frame-cost mechanism (074 series row).
- Field: DONE for day (2026-07-29): `gaz27_law` ("the wall looks right now"),
  `exclbr_hotl02_lvs` / `sphinx01_lvs` / `flamingo01_lvs` "all three look good", healthy
  districts unchanged. Night: DONE (2026-08-01) — the floor is provably 0 after dark and the four
  night frames were looked at and judged adequate. Both halves are in the night section below.
- Numbers land here per phase; anything perf-visible additionally in `docs/benchmarks/`.

### Night control pass — ANSWERED 2026-08-01, both halves

Read out of the shipped adapter with `scripts/debug/world-ambient-hours.ts`, which boots nothing:

| hours | `dn` | ambient | floor term | whose number |
| --- | --- | --- | --- | --- |
| 20:00–06:00 | 1.000 | 0.0120, 0.0140, 0.0200 | **0** | timecyc — strict SA parity |
| 07:00–19:00 | 0.000 | 0.1300, 0.1300, 0.1300 | 0.1300 | **ours** — the deliberate floor |
| 06:00→07:00, 19:00→20:00 | ramps | — | ramps | a continuous one-hour hand-over |

**So "nothing shifted after dark" is proven for OUR term, not merely asserted: after dark the floor
contributes exactly 0** — every night frame is the same frame this plan's deviation never touched. Probing
fractional hours (6.1, 6.25, 6.5, 6.75, 6.9 and the dusk mirror) shows the retirement is a smooth ramp, not
a step, so there is no ambient pop at the boundary either.

**That narrowed what a look could even be about**: since our term is zero at night, the only thing that can
wash the authored night design is SA's own `Amb` (0.012, 0.014, 0.020) — vanilla parity, not this plan's
doing. The look still had to happen, and it did.

**The night frames, and the verdict (2026-08-01).** Four districts, day and night from the same spot. **The
user looked at all four and the verdict was that they look adequate — 093 is closed on it.**

| spot | day | night | day/night |
| --- | --- | --- | --- |
| `gaz27_LAW` — LS beachfront | 105 | 17 | **6.2×** |
| `flamingo01_lvs` — the Strip | 128 | 35 | **3.7×** |
| `sphinx01_lvs` — Luxor | 192 | 82 | 2.3× |
| `exclbr_hotl02_lvS` — Excalibur street | 137 | 84 | 1.6× |

(mean luma of the lower 1440×600 of the frame, ImageMagick 1×1 resize.) Night is darker everywhere; the two
Vegas spots contrast least, which is what a street full of neon and lamps is supposed to do. What the frames
show: LS is genuinely dark with lamp pools and moonlit water; the Strip reads as neon against dark road and
dark sky; the Luxor's lit windows and the beam sit in a dark frame. **Nothing is washed out and nothing that
should be lit is missing**, and the user's own word on the four frames was that they look adequate.

**How to take a night frame — the trap that cost the first attempt.** `?spawn=x,y,z` on a MODEL's own
coordinates fails three ways: the player falls through collision that has not streamed yet (`grounded 0`, 12
draws, z −1697 and still falling), and a spawn on a model origin puts the camera INSIDE its geometry — the
sphinx metered *brighter* at night than at noon purely because both frames were a close-up of a wall, which
is exactly the shape of number that gets reported as a finding. The fix is `scripts/debug/teleport-spot.ts`,
which already exists for this (built for 092's field controls): it rings the target, casts down onto real
collision, rejects any spot a player-sized box intersects, and says which spots can see the target. Every
frame above is one of its spots, and every one reports `grounded 1` with 300-900 draws.


## Docs touched in the same change

- `docs/architecture/` has NO rendering/lighting doc to update (checked — the world formula lives
  in `docs/restrictions/engine-lighting.md` + the shader comments; if a lighting architecture doc
  is ever written, this term belongs in it).
- `docs/restrictions/engine-lighting.md` — DONE: the two-part indirect rule (formula term + the
  deliberate floor), the max() semantics warning, and `ambientFloor = 0` as the parity lever.
- 024 Phase 3b closed with a link here — DONE. Debt file: `docs/hacks/world-ambient-floor.md`.
