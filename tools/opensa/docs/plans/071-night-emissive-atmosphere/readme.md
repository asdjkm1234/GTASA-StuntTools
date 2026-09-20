# 071 — Night & emissive atmosphere (dawn, dusk, night)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [067](../067-pbr-sky-clouds/readme.md) (sky/moon) and [070](../070-local-lights/readme.md) (local lights). The "make night actually beautiful" plan: keep prelit + night vertex colours AND make them glow.

## Context

- Night vertex colours (the `0x253F2F9` set) drive the night prelit blend (038); lit windows/neon are tobj-swapped models + additive `windowGlow` (build-region tagging, `timed-object.system.ts` hour gating).
- Bloom exists (composer-wide, pmndrs) but is threshold-based over the whole frame — night sources glow only as much as their LDR brightness allows; nothing is truly emissive-bright.
- 004 (if landed) provides a baked per-vertex `emissiveMask`; without it a runtime heuristic (night≫day prelit delta) approximates it.

## Decisions

1. **True emissive channel for night sources.** World shader outputs `emissive = nightPrelit × emissiveMask × uEmissiveBoost` ADDED after the lighting model (unaffected by fog dimming until the fog term, immune to tone-map crush via boost >1). Sources: night-vertex hot spots (windows baked bright by Rockstar), tobj lit-window variants, neon 2dfx materials. This is the user ask verbatim: tobj and night-vertex sources must glow.
2. **Selective bloom over a real HDR threshold**: emissive boost pushes sources above 1.0 so the EXISTING bloom picks them up naturally (no second render pass, no layer juggling — threshold does the selection). Bloom params get a night profile (larger radius, lower threshold) cross-faded by the night factor.
3. **Dawn/dusk are first-class**: a grading calibration pass per time band (dawn/day/dusk/night) — exposure/saturation curves on top of the 001-frozen tone mapping, driven by sun elevation (NOT wall clock — sunset must look right whenever it happens). Golden-hour warmth on the sun term (002 curves), long-shadow mood (003) verified together here.
4. **Moon as a light**: tiny cool `DirectionalLight` at night (dynamics) + a `uMoonTerm` in the world shader indirect (barely-visible blue grounding); full moon nights slightly brighter (moon phase already exists in config).
5. **Wet night stretch** (rain): screen-space wet-look (darker albedo + boosted spec/reflection on roads) — only if trivially composable with 007/008 results; otherwise noted for a future chain.
6. **Nothing here replaces prelit** — every term is additive/multiplicative around the prelit core; classic pipeline unaffected.

## SHIPPED (2026-07-10) — user-confirmed: emissives glow great, then "looks fire" after the moon/grading pass

1. **HDR frame buffer — the unlock.** Bloom runs BEFORE tone mapping and the composer buffer was
   `UnsignedByte`, so EVERY emissive clipped at 1.0: a lamp at 5.0 and a sheet of white paper fed bloom the
   same value. Nothing could ever "glow" more than white. `EffectComposer(..., { frameBufferType: HalfFloatType })`
   keeps real intensities for the bloom threshold; the ACES pass compresses at the end. This was the plan's
   "true emissive above 1.0" decision (#1/#2) — it needed the buffer, not a second pass.
2. **Baked night sources glow (decision #1, no new data).** In `world-material.ts`: a vertex much brighter at
   night than by day IS a lit window / neon / sign, so `saGlow = albedo × nightColor × mask × uEmissiveBoost ×
dnBalance` with `mask = smoothstep(0.05, 0.32, luma(night) − luma(day))`. Free: both colours already exist
   in the night program variant (no attribute, no texture, no pass); models without night colours compile the
   term to a constant zero. Knob `night.emissiveBoost` (1.6) + Atmosphere slider. Modern only.
3. **Vehicle lamps bloom too** (user ask): head 1.2 → 2.4, tail 0.6 → 1.0, brake 2 → 4 — clearly past the
   bloom threshold now that HDR preserves it. Brake reads brighter than head, as in life.
4. **Moonlight on the WORLD (decision #4).** Until now the moon only lit dynamics (a hemisphere fill); the
   prelit map never saw it. `worldMoonUniforms` adds a cool directional term to the modern world shader,
   **wrapped** (`(N·L + 0.6)/1.6`) because the moon is a huge soft source — a hard terminator reads as a
   second harsh sun — and **un-shadowed** (it lifts form even inside a building's sun shadow). Zero cost: the
   world-space normal was already computed for 064's sun term. Scales with `moon.brightness × night.skylight`.
5. **Time-band grading (decision #3), driven by SUN ELEVATION — never the wall clock**, so a sunset reads
   right whenever it happens (custom timecycs, sped-up clocks). Pure `timeBandGrade()`
   (`packages/game/src/sky/time-bands.ts`, 14 unit tests) returns `{night, golden, moon, bloomThreshold}`,
   continuous across every boundary. It is now the ONE source for the moon term and:
6. **Night bloom profile (decision #2).** The threshold crossfades 0.70 (day) → 0.38 (deep night), scaled by
   the user's configured value: at night lamps/neon/lit windows bloom while dark walls stay dark; by day the
   sky doesn't smear. Applied per frame through a `PostFxPlugin` threshold closure (mutating the config each
   frame would broadcast a config change to every plugin).
7. Regression guard: the shader tests assert that `uniform float uEmissiveBoost` and `const vec3 SA_LUMA` are
   DECLARED in both program variants — a stale replace anchor silently dropped them once and only the live
   GL compile caught it.

## Tasks

- [~] Emissive term in world material: mask source selection (004 attribute if present, else night/day delta heuristic — unit-test the heuristic on night-window fixtures like `newvic1_sfw`), `uEmissiveBoost` config.
- [~] tobj/neon material tagging → emissive path (extend build-region `WINDOW_EMISSIVE` tagging; neon 2dfx materials join).
- [~] Bloom night profile + crossfade; verify LV strip: neon blooms, dark buildings don't.
- [~] Moon light (directional + shader term), phase-scaled; stars/moon/sky coherence pass with 005.
- [~] Time-band grading: sun-elevation-driven exposure/saturation curves; calibration sweep dawn→night with sign-off screenshots per band (the 038-style calibration discipline: constants recorded here).
- [~] Street-level night composition pass: prelit pools + 008 lamp light + emissive windows + coronas — tune relative levels so no layer dominates (the "balance" the user called out).
- [~] (Stretch) rain wet-look spike; measured, separate toggle.
- [~] Bench: LV night, LS rain night; before/after screenshot pairs into this doc.

## Verification

- Night city reads like a modern game: glowing windows/neon with real bloom, lamp pools, readable but moody darkness — while a daylight A/B against classic still reads unmistakably as San Andreas.
- Dawn/dusk sweep (accelerated clock) shows no banding/jumps across band boundaries.
- Perf: emissive term ≈ free; bloom profile change ≈ free (same pass).

## Measurements

_(record after implementation)_

- final boost/threshold/grading constants per band: …
- LV-night frame ms before/after: …
