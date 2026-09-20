# Own engine: a short-fog NIGHT renders pure black (rain/fog weathers)

**Status: ✅ FIXED (2026-07-18).** Root cause: **SA authors NEGATIVE timecyc cloud colours**
(RAINY_COUNTRYSIDE 21:00 `lowClouds = −15,−36,−45`, `bottomClouds = −50,−50,−50`), and the engine
environment driver's `lin()` was a plain power curve — `(−15/255) ** 2.2` is **NaN in JS** (fractional
power of a negative). The NaN rode `cloudTopColor`/`cloudBottomColor` into the frame UBO, where WGSL
`mix(sky, cloud.rgb, factor)` poisons the result **even at factor 0** (NaN × 0 = NaN; only a LITERAL 0
gets constant-folded away). That blackened both `fsSky` (sky pixels) and `fogColorFor` (every fogged
world pixel — plan 074/21 composites clouds into the fog colour), so a short fog cut turned the whole
frame black. Prod survives the same data because three's piecewise sRGB decode maps negatives through
its LINEAR segment (a tiny negative, never NaN).

**The fix** (`packages/game/src/adapters/engine-environment-driver.ts`): `lin()` floors its 0–255 input
at 0, with a regression test feeding the authored negative row through a synthetic timecyc
(`engine-environment-driver.test.ts`). Verified headless: the repro below went frame-luma 2.6 → 34.7
(lit shopfronts / night windows / fogged distance all back), `?bench=ls-rain-night` renders at 120 fps.

**Debug lessons for the next NaN hunt:** (1) a WGSL NaN check `x != x` and a black uniform visualization
both LIE under fast-math — the give-away was `mix(col, rgb, 0.0-literal)` ≠ `mix(col, rgb, computed-0)`;
(2) meter TRUE sky pixels — in a street canyon every "sky-looking" pixel is fogged geometry painted by
`fogColorFor`, so an fsSky probe changes nothing; (3) the headless harness pitch: drag must start OFF
the "Click to play" button or it becomes a pointer-lock click.

The original investigation record (still accurate up to its "downstream of the LUT" arrow — the LUT
probe was right, the loss was in the CONSUMER mixes):

## Symptom

Bench `?bench=ls-rain-night` (and any rain/fog weather at night) renders an almost completely black
frame while the HUD still reports a healthy world: 120 fps, ~1000 draws, 90 cells loaded, GPU 0.65 ms.
Geometry IS being drawn — it is just black.

One-line repro (no bench needed):

```
http://localhost:5173/?spawn=1456,-1400,30&hour=21&weather=16
```

## Measured evidence

Same spawn (downtown LS), same hour (21:00), only the weather changes — headless 1×, frame luma of the
world band (`magick … -colorspace gray`):

| Weather              | fog cut (timecyc) | frame luma |
| -------------------- | ----------------- | ---------- |
| 0 EXTRASUNNY_LA      | 673 m             | 35.7       |
| 4 CLOUDY_LA          | 700 m             | 27.8       |
| 16 RAINY_COUNTRYSIDE | 412 m             | **0.31**   |

Further probes:

- **The night sky itself is ~0 in EVERY weather.** Pointing the photo camera up at 21:00 gives frame luma
  **0.36/255** for weather 8 and 16 alike. The short fog cut does not create the black — it merely fills
  the frame with the sky colour, which is already black. With a long cut (673–700 m) the near buildings
  are only partly fogged, so their own prelit/emissive light still reads: that is the whole difference
  between the "working" and "broken" rows above.
- **The clouds are not the cause**: `?clouds=0` leaves the frame bit-identical (luma 0.306 both ways).
- **The authored data is fine**: RAINY at 21:00 authors `skyTop 40,40,40 / skyBot 60,60,60` (grey
  overcast night), identical in `timecyc.dat`, `timecyc_24h.dat` and the pak bake.
- **The LUT is fine**: a unit probe of `buildSkyLut` with `pbrNight = 1` and those colours returns the
  authored gradient — `0.0414` linear at the horizon → `0.0170` at the zenith (≈ sRGB 60 → 40). So the
  night hand-over (`pbrNight`) and the gradient blend both work.
- The same spawn at **noon** renders normally (luma 114), so the spot/camera is not the problem.

⇒ The gradient is correct up to the LUT texture and ~0 on screen. Suspects, in order: how `fsSky`
consumes `skyBaseFor` at night, the frame-uniform feed of the LUT/its sampler state, and any night-side
multiplier in the sky pass or post chain.

## Why it matters (and why it is not just a bench artefact)

- SA authors rain only for SF and the countryside, so `weatherForCity` maps LS/LV rain to
  `RAINY_COUNTRYSIDE` — driving into a rainy Los Santos is normal gameplay, not a bench-only state.
- `FOGGY_SF` authors `farClip 250`; at night it lands in the same trap without any remap at all.
- Any measurement taken in that state is invalid: the short cut culls cells, so the bench under-reports
  work (`ls-rain-night` draws 1031 → 975 while black).

## Interaction with the regional-weather remap (plan 074/21, same day)

The remap is correct and prod does the same (it fixed a real draw-distance parity gap: countryside fog
700 → 1150). It did not create this bug — it made a black-capable weather reachable in the
`ls-rain-night` bench, where prod happens to never remap (its bench never crosses a city border, so it
keeps `RAINY_SF`, cut 650, and stays visible). Rolling the remap back would hide the symptom in that one
bench while re-opening the parity gap in `country-dusk`, so the fix belongs here, in the sky path.

## Pointers for whoever picks this up

- `packages/engine/src/render/sky-lut.ts` — `buildSkyLut` (verified correct), `skyLutKey` change detection.
- `packages/engine/src/engine.ts` — `refreshSkyLut()` builds the input (`pbrNight` from `sunDir.y`).
- `packages/engine/src/render/shaders.ts` — `skyBaseFor` (LUT sample + night moon/city glow), `skyFogFor`,
  `fogColorFor`, `fsSky`.
- The engine debugger's **Perf** screen now shows `fog start → cut` and the active regional `weather` —
  that readout is what makes this state identifiable in the field.
