# 0.6.0 · 02 — Water realism (the own-engine v4+ rework)

PARKED 2026-07-13 (user verdict on the 074 water v3: "looks bad — as I suspected, water won't get there
without good textures and the rest; leave it, come back later"). This plan collects the honest diagnosis
after ~12 field iterations and the concrete upgrade path.

## What v3 is (state at park time)

`074/06 row 12` — engine `water` pipeline: baked tessellated water.dat mesh (global 16 u lattice, no
T-junctions) with a TRUE per-vertex depth field (sea-band height grid rasterized during the weld);
Gerstner SLOPE trains + swash surge (the waterline breathes up the beach) + a single oscillating foam
front (soft birth → hard at the edge → soft retreat) textured by SA's own `waterwake`/`waterclear256`.

## The honest diagnosis — why it still reads as fake

1. **The source textures are the ceiling.** `waterwake` is 64×64 and `waterclear256` is 128×128 — 2005
   particle sprites. No amount of shader math turns them into a believable foam mass or a rich surface
   normal field. The reference mods the user liked ship AUTHORED textures.
2. **Analytic trains are too regular.** Four fixed-frequency sines (even domain-warped) produce a visibly
   periodic sea; real spectra need many octaves or FFT.
3. **The foam is a math band, not a material.** A band function × a tiny sprite cannot look like churned
   water regardless of envelope tuning — 12 rounds proved the envelope was never the real problem.
4. **No refraction/absorption.** Shallow water reads via an alpha hack; real shallows need a scene tap
   (refracted sand, depth-based colour absorption) — blocked on the plan-09 post chain (scene texture
   exists since the godrays pass; a refraction tap is now actually cheap).
5. **Blind iteration is slow.** Every constant change cost a full user round-trip. Tuning needs LIVE
   knobs in the field.

## The upgrade path (each step is independently shippable)

1. **Buy/source real textures first** (user pre-approved buying ASSETS, never closed code): a tiling foam
   atlas (≥512², with alpha), a 2–3 octave ocean normal map set, optionally a shore-foam "swash sheet"
   texture with directional streaks. CC0 candidates: ambientCG/PolyHaven water sets. This alone is
   expected to move the look more than all shader work combined.
2. **Live tuning knobs**: expose the ~10 water constants (train amplitudes, foam thresholds, surge
   amplitude, cycle speed) through `Environment` + `?water*=` URL overrides so look-dev happens in ONE
   field session instead of N round-trips. (Fold into the plan-10 config API.)
3. **Bake the shore DIRECTION field** (normalized ∇depth per vertex, 2 bytes) next to depth: foam UVs
   advect TOWARD the beach, wave fronts orient along real shore contours (today's depth-phase trick only
   works on straightish beaches), swash streaks stretch along the slope.
4. **Normal-map surface** (with texture set from step 1): replace/augment the analytic slope trains with
   2–3 scrolling normal-map octaves + the trains only for the large swell silhouette. Kills periodicity.
5. **Refraction tap** (needs plan-09 target plumbing, already half-built): sample the scene colour behind
   the water with a normal-based offset + Beer-Lambert depth absorption using the BAKED depth. True
   shallows, no alpha hack.
6. **Real swash decal ON the sand**: a second small pass rendering the foam sheet directly over the beach
   strip (height grid → a small shore-strip mesh baked at convert time), so the runup tongue climbs the
   sand itself instead of relying on the under-sand water plane reveal.
7. **Open-sea spectrum**: 8+ randomized-phase trains or a small FFT patch (128²) for the far field;
   Gerstner XY (choppy crests) on the ocean contour only.
8. **Underwater**: camera-below-surface fog/tint state (the 069 parked scope).

## Carried over from the 0.5.0 "Water, done right" idea (written for three-WebGL, still valid — the

## original plan is deleted, this section preserves its keepers)

- **Jacobian foam (the best idea in it)**: real Gerstner displacement's Jacobian goes negative exactly
  where a crest breaks → the whitecap mask comes from the WAVE MATH itself, per vertex, no depth buffer,
  and it is unit-testable against finite differences. Use for open-sea whitecaps once step 7 (XY
  displacement) lands — today's `crest = f(swell height)` is a crude stand-in.
- **Camera-following projected/radial grid** as an alternative/complement to the baked 16 u lattice:
  fixed ~128² vertex budget concentrated near the camera, decaying to the flat far plane under the 068
  fog cut. Revisit if the uniform lattice ever limits close-up wave detail.
- **`seaState()` weather drive**: prod's pure calm↔storm parameter function (amplitude/steepness/wind
  from weather) — port into the shared environment driver so storms actually change the sea.
- **Tier ladder** (feeds the 072-style knobs): low = flat + glint · medium = displaced + foam · high =
  - shore field runup · ultra = + refraction/SSR.
- **Waterline meniscus strip + underwater murk** — the 069 v1 parts worth porting verbatim.
- Its library survey (three Water.js/Water2/FFT ocean/SSR) is obsolete for the own engine — we own the
  pipeline; only the SSR-as-ultra-tier thought survives as step 5's refraction tap.

## Grounding / references

- Prod `water.plugin.ts` GLSL (packages/game) — the Gerstner slope + ripple + fog model v3 already ports.
- The user's reference: LibertyCity "realistic HD effects nextgen" beach shots (breaking line + foam mass
  - wet swash edge).
- `074/06` field-round log (rounds 1–12) — every dead end documented; do not re-walk them.
