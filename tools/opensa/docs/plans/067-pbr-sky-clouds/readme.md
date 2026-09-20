# 067 — PBR sky, horizon LUT, clouds

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Independent of 002–004 (can run in parallel after [063](../063-render-foundations-instrumentation/readme.md)). Feeds [068 — fog](../068-unified-fog/readme.md) via the horizon LUT.

## Context

Today's sky (`sky.plugin.ts`): a gradient dome (`uBottom→uTop` from timecyc skyBot/skyTop) + fbm procedural clouds + hash stars + sprite moon + additive sun disc/corona + god-rays source. It reads decently but is a 1997-style colour ramp: sunsets lack scattering physics, the horizon band is a lerp, weather moods come entirely from timecyc colour keys and a curated cloud-profile table.

## Decisions

1. **Physically-based sky with timecyc as the art director.** Replace the gradient with an atmospheric-scattering model whose inputs (turbidity, rayleigh/mie, sun intensity) are DRIVEN by timecyc + weather so every SA mood remains reachable. Evaluation order (cheapest first):
   - three.js `Sky` addon (Preetham) — one screen-quad shader, zero dependencies; likely sufficient for stage 1;
   - Hosek-Wilkie fit — better sunset spectra, still analytic;
   - **@takram/three-atmosphere** (Bruneton precomputed scattering, MIT) — best quality incl. aerial perspective LUTs; heavier integration. Decide by side-by-side on the dusk bench.
2. **The 512×1 horizon LUT** (user's idea, adopted verbatim): after each sky-state change (time/weather step, not per frame), render the sky's horizon ring into a **512×1 RT** (azimuth → horizon colour at eye level). This LUT becomes THE fog colour source (view-direction-dependent!) for scene fog, water, and any future volumetrics — PBR colour math runs once over 512 pixels, everything else samples a texture. Seam-free sky↔fog blending by construction, replacing the current single-colour `skyBot` tracking.
3. **Sun/moon/stars**: keep the existing disc/god-rays/moon/star machinery, recolour from the PBR sky (sun disc colour = transmittance-attenuated), stars gated by the same night factor.
4. **Clouds, two stages**:
   - **Stage A (this plan)**: better non-volumetric clouds — layered scrolling cloud textures on the dome (SA-style but higher quality) OR per-weather panorama sets; keep the curated per-weather profile table as the driver. Deliverable: every timecyc weather has a distinct, good-looking cloud state, blendable during weather transitions.
   - **Stage B (stretch, separate toggle)**: volumetric raymarched clouds — evaluate **@takram/three-clouds**; technique reference: Schneider's Horizon Zero Dawn "Nubis" talk. Only if Stage A + budget allow; ultra tier only at first.
5. **Weather blending**: sky params, LUT, and cloud state all interpolate through the existing weather-blend (`sampleTimecycBlend`) so transitions stay smooth.
6. **Budget**: sky ≤ 0.8 ms (it's a dome/quad + rare LUT refresh); volumetric clouds get their own ultra-tier budget (≤ 2 ms half-res) if Stage B lands.

## Tasks

- [~] Spike: **Preetham implemented FIRST** (cheapest, zero deps — the evaluation order's step 1): the model is
  live-switchable in-game, so the "spike" is now an in-game A/B; Hosek-Wilkie/takram remain as upgrades IF
  the user finds Preetham dusks lacking (the param-mapping + LUT infra is model-agnostic).
- [x] Sky model: **shipped** — Preetham integrated INTO the existing dome shader (`SKY_BASE_GLSL` shared chunk,
      uniform-gated `uPbrMix` — clouds/stars/dither stay on top, zero recompiles on toggle) behind
      `graphics.sky.model: 'classic' | 'pbr'` (+ Graphics-screen toggle). Night blends BACK to the SA gradient
      (`uPbrNight` — Preetham is a day model; the authored night palette stays). timecyc as art director:
      `pbrSkyParams` (`packages/game/src/sky/sky-params.ts`, unit-tested) maps cloudCover/cloudDark/sunElevation
      → turbidity/rayleigh/mie/sunE, and skyTop → a normalized MOOD tint (0.5 v1). LDR CAVEAT: the composer
      buffer is UnsignedByte — the sky is exposure-scaled (`uSkyExposure` 1.2) to stay ≤1; an HDR
      (HalfFloatType) composer upgrade is noted for later (071 emissives want it too).
- [x] Horizon LUT: **shipped** — 512×1 RT rendered from the SAME `skyBase()` GLSL (always matches the visible
      sky, works for BOTH models — fog gets one code path), re-rendered only when the quantized sky state steps
      (game minute / cover / palette / model). Exposed as `SkyPlugin.getHorizonLut()` for 068 fog + 069 water.
      Debug view strip in the overlay: later, with the 068 consumer.
- [~] Sun disc/corona/god-rays/moon/stars recolour integration; overcast behaviour parity. _After the user's
      first PBR look._
- [x] **Night sky glow (2026-07-10, user ask: PBR for the night sky — it is far too dark):** the authored SA
      night gradient is near-black, so the modern sky adds two physically-plausible terms over it — the
      MOON's cool Rayleigh scatter (halo + soft lift of its hemisphere, follows the moon sprite's direction,
      brightness × phase/cloud fade) and the warm URBAN skyglow horizon band (SA is a metropolis; brighter
      under cloud — the deck reflects city light, real light-pollution behaviour). Rides `uPbrNight`
      (fades in through twilight), lives in the shared chunk → night fog matches the glowing horizon.
      Knob: `night.skyGlow` (default 1) + NIGHT SKY GLOW slider in Atmosphere. Classic pipeline untouched.
      **User-confirmed: the night looks great.**
      NOTE: user dropped a candidate 24h timecyc into `./1/timecyc_24h.dat` — its night rows are equally
      dark (skyTop 9 11 13), so the glow complements rather than replaces it; wiring that file through
      timecyc-builder = a separate task.
- [x] Clouds Stage A **shipped (2026-07-10), procedural-layered (kept fbm, upgraded — no texture assets to
      author, weather-blendable by construction):** - **CIRRUS layer**: thin stretched high wisps on their own slow heading; suppressed by coverage (they
      belong to clear skies) — depth the single deck never had; - **Sun-lit deck**: `uCloudSunTint` = timecyc `sunCorona` × golden-hour strength (0.9 at the horizon
      sun → 0.25 at noon, 0 below) → pink/orange cloud rims at dawn/dusk (`pow(dot(dir,sun),5)` rim +
      silver lining on bright cores), driven entirely by the timecyc palette; - **timecyc `cloudAlpha` wired** (was parsed-unused): modulates ±40 % of the configured opacity over
      the hour/weather arc — it stays a MODULATOR because raw cloudAlpha is too noisy to drive coverage
      (the curated per-weather profile keeps that job — see cloud-profile.ts); - all in the shared `applyClouds` chunk → the dome and the sky/fog LUT stay consistent automatically.
- [x] Clouds Stage B **shipped as our own compact raymarcher (2026-07-10)** behind `graphics.clouds.volumetric`
      (default OFF, debug checkbox in Atmosphere; ultra-tier candidate for 072): a 24-step march through a
      500–1000 u slab — 2D weather field with the SAME coverage threshold the flat deck uses (one driver for
      both), height-profiled 3D value noise, two-tap sun light march (Beer's law, self-shadowed bases),
      HG-phase silver lining toward the sun, timecyc colours as ambient + `uCloudSunTint` golden hour, heavy
      weather darkens the unlit mass. Lives in the shared chunk → the fog LUT marches it too (fog dissolves
      into VOLUMETRIC clouds). takram/three-clouds stays the documented upgrade if this stylized version
      falls short (it drags their atmosphere stack — deliberately avoided as a dependency).
      Also same-day: overcast fixes — cloudAlpha modulation gated to clear weathers (Rockstar's CLOUDY rows
      carry low alphas → the deck went translucent), sun tint gated by clearness (no red smear through the
      deck), a fine detail octave (the full-coverage deck read as giant soft smears), and the sky BASE hands
      back to the authored timecyc gradient as coverage grows (the Preetham overcast is a milky Mie wash that
      fought the dark deck — under a full deck you see cloud base, i.e. the authored gradient).
- [~] Bench + calibration sweep across all weathers × key hours; sign-off screenshots.

### Calibration arc (2026-07-10, user A/B)

1. First look: midday WASHED OUT white (raw Preetham HDR clipped by the LDR composer buffer before ACES) and
   sunset ≈ classic (the night-blend used the golden-hour night factor → PBR was off exactly when it matters).
   FIXES: in-shader Reinhard + exposure 1.2 → 0.55; twilight handover moved BELOW the horizon (sinEl −0.02…−0.12).
2. Second look: midday good but paler than the original → `sky.mood` raised 0.5 → 0.7 and exposed as a live
   slider (+ `sky.pbrExposure`) in Graphics. Dawn: distant objects glowed — FogExp2 colour was still classic
   `skyBot`, mismatching the dark PBR dawn → CPU twin `pbrHorizonAverage` (same formula/tint/Reinhard/handover)
   now feeds the fog colour in PBR mode (interim until 068's in-shader LUT fog).
3. Third look (user): **noon improved, the overall picture is very good**; remaining dawn silhouettes →
   handled by 068's directional LUT fog (started).

### How to try it (user)

F2 → Graphics → **PBR sky (plan 067)**. Compare vs classic at: **dawn ~6:30–7:30 and dusk ~19–20** (the whole
point — scattering gradients vs the old two-colour lerp), noon (should stay believably SA), night (must look
IDENTICAL to classic — the blend hands back), fog/rain weathers (haze physics). The mood tint keeps SA's
palette at 50 % strength — report if the sky drifts too "real" or too flat.

## Verification

- Sunset/sunrise on the dawn bench visibly superior to classic (side-by-side), all weathers distinct, transitions smooth.
- LUT: fog-coloured test quad matches the sky at every azimuth (no seam where geometry meets sky).
- Budget: sky pass ms within target on reference machine.

## Measurements

_(record after implementation)_

- chosen sky model + param table: …
- sky pass ms / LUT refresh ms: …
- Stage B verdict: …
