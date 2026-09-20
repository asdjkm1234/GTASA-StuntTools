# 068 — Unified fog & aerial perspective (cut the horizon)

**Status: 🔒 CLOSED 2026-07-21 (user triage) — superseded by the own WebGPU engine ([074](../074-opensa-engine/readme.md)): every effect re-implemented there; remaining tails in this plan are void.**

> **The unticked boxes below are VOID with the plan, and are struck rather than deleted (2026-08-11).**
> They were left as `- [ ]` when the chain was closed, so every repo-wide scan for open work kept
> reporting them — 118 phantom tasks across the ten closed chains. Nothing here is a debt: the banner
> above is the authority. They stay readable because what these plans INTENDED is still the record of
> why the own engine does what it does.


Part of the [rendering overhaul chain](../062-rendering-overhaul/readme.md). Depends on [067](../067-pbr-sky-clouds/readme.md) (the horizon LUT). Fixes the reported bug-class: **the ocean/far world is visible through the haze at the horizon** — fog must actually terminate the world.

## Context

Today: scene `FogExp2` with density `2/config.fog.distance`, colour tracking a single `skyBot` sample (`fog.plugin.ts`); `scene.background` follows the same colour. The water shader CANNOT see scene fog (custom ShaderMaterial) so it re-implements the same exponential by hand and fades to `uHorizonColor` (`water.plugin.ts`) — two fog implementations already disagree at the seam, and a single fog colour for all view directions guarantees a visible mismatch against a sky whose horizon varies with azimuth (sun side vs opposite). timecyc `farClip`/`fogStart` are parsed but unused.

## Decisions

1. **One fog, as a shared shader chunk.** `applyOpensaFog(color, viewDir, dist, height)` — a single GLSL include injected into the world material, water, procobj/vegetation, particles, and any custom ShaderMaterial. Scene-level `FogExp2` is retired on the modern pipeline (three's per-material `fog:true` plumbing can't express what we need).
2. **View-direction fog colour from the horizon LUT** (005): `fogColor = texture(skyHorizonLut, azimuth(viewDir))` — fog ALWAYS matches the sky it fades into, sun-side warm / anti-sun cool, for the cost of one 1D texture fetch.
3. **Two-term analytic model** (no volumetrics yet):
   - **distance fog**: exp² term with `fogStart`/`farClip` finally driven by timecyc (per weather/hour) × a config multiplier — fog distance becomes a MOOD, as SA intended (SF fog weather actually rolls in);
   - **height fog**: exp falloff with world height — valleys/ocean surface haze first, Mount Chiliad pokes out; cheap, huge atmosphere win.
4. **The horizon CUT**: at `farClip` the fog term reaches 1.0 EXACTLY (clamped smoothstep tail, not an asymptote) — geometry at the far plane resolves to pure LUT colour, indistinguishable from sky. The ocean-through-haze artefact dies by construction: water at horizon distance = fog colour = sky colour. Far-plane/streaming distance and `farClip` are linked in config so nothing renders past full fog.
5. **Aerial perspective tint** (stretch, if 005 picked takram/Bruneton): distant geometry additionally shifts hue via the scattering LUTs — defer unless free.
6. **Volumetric/froxel fog is OUT of scope** — the LUT design deliberately leaves the door open (user note: "including volumetric fog in the future").

## Tasks

- [x] Core shipped (2026-07-10, v1): **`worldFogUniforms` + a `fog_fragment` REPLACEMENT** in `world-material.ts`
      (uniform-gated `uFogMix`; classic keeps three's exact exp² — asserted in tests). Modern: fog colour =
      **067 horizon LUT sampled by view azimuth per fragment** (sun-side warm / anti-sun cool; the dawn glowing
      silhouettes die — the fog now IS the sky behind it) + **the horizon cut** (smoothstep tail → factor 1.0 at
      `fog.distance`; far geometry resolves to pure sky). Covers the whole streamed world incl. vegetation/procobj
      (they use `buildWorldMaterial`).
- [x] Water: private fog upgraded in place — same LUT-azimuth colour + cut on the modern path (`WaterPlugin`
      gains a `getFog` closure); classic path untouched. The sea/sky horizon seam dies by construction.
- [~] Particles/effects/corona materials: still on scene FogExp2 / far-fade — coherence check pending.

### v1 debug arc (2026-07-10, user A/B — all fixed same day, final state CONFIRMED looking good)

- **White skyscraper silhouettes against the blue sky:** fog sampled the LUT at EYE LEVEL only — tall fogged
  geometry got the bright horizon-haze band instead of the sky at its elevation. FIX: the LUT is now 2D
  (512×32, azimuth × view-elevation to ~44°) and the fog samples by the fragment's own direction — cheap
  aerial perspective.
- **Still white after that:** an AZIMUTH PHASE bug — the shaders sample `atan/2π + 0.5` but the LUT rendered
  without the half-turn → fog took the OPPOSITE side of the horizon (white dawn fog on the teal anti-sun sky).
  One-line fix in the LUT fragment (`phi = (u − 0.5)·2π`). This also explains why the dawn silhouettes had
  survived the first fog fix.
- **Distant objects flickering every second:** the LUT refresh key quantized to the game minute — which is
  ~1 REAL second in SA — so near-fully-fogged objects stepped while the dome moved smoothly. FIX: the LUT
  (16 k px) renders EVERY frame — trivial cost, perfectly continuous. User confirmed the flicker is gone.
- **(after the timecyc ranges) fog vs sky mismatch returned at dawn:** the LUT rendered the CLOUDLESS
  `skyBase` while the dome layers clouds on top — with the closer timecyc cut, fully-fogged towers stood
  milky against the cloudy sky. FIX: the cloud layer moved into the shared GLSL chunk (`applyClouds`) and
  renders into the LUT too (stars stay dome-only). Fog now dissolves into the CLOUDY sky.
- **Objects popping in/out of the cut on camera ROTATION:** the fog used view-Z, which shrinks toward the
  screen edges — visible in peripheral vision, gone when looked at directly. FIX: RADIAL distance (like the water always
  did) for the modern exp² + cut; rotation-invariant. **Final state user-confirmed as looking good.**
- [x] timecyc wiring **shipped (2026-07-10)**: modern fog ranges = timecyc `fogStart`/`farClip` ×
      `fog.timecycScale` (new config, default 1; floor 350 so a broken row can't collapse the view; start
      clamped ≤ 0.8·cut). One `fogRangeFor()` source feeds the world shader (own exp² over [start, cut]),
      the water shader, AND the scene FogExp2 density (FogPlugin `range` closure — dynamics match the world).
      Classic pipeline: `fog.distance` untouched. **Fog distance is now a weather/hour MOOD — SF fog rolls in.**
- [x] Height fog **shipped**: `exp(−max(worldY,0) × uFogHeightK)` (1/180) attenuates the distance term down to
      `uFogHeightMin` (0.4) — sea-level haze first, peaks poke out; the horizon CUT stays absolute (nothing
      renders past full fog, whatever the height). Constants = first-cut, calibrate in the sweep.
- [x] Particles/effects/coronas coherence: checked — both fade out by their own draw distances (effects 150 u,
      coronas ~120 u), far below any fog cut; additive sprites must NOT be fogged toward sky colour anyway
      (they should fade, and they do). No change needed.
- [~] Sky/background: `scene.background` no longer needed on the modern path (dome covers all); verify god-rays/moon fade against fogged horizon.
- [~] The cut: clamped tail + far-plane link; verify the LS→ocean bench at multiple hours — the water horizon line must be GONE (screenshot the old artefact first for the doc).
- [~] SF fog weather + rain showcase calibration; height-fog params per weather class.
- [~] Bench cost (expected ≈ free: one tex fetch + few ALU per fragment).

## Verification

- Ocean bench: no visible sea/sky seam at any hour/weather (the reported artefact — before/after shots in this doc).
- 360° pan at dusk: fog colour tracks the sky around the full circle (sun-side vs anti-sun).
- Water/world/vegetation fade identically at equal distance (the two-fog mismatch is gone).

## Measurements

_(record after implementation)_

- fragment cost delta: …
- final fogStart/farClip/height tables per weather: …
