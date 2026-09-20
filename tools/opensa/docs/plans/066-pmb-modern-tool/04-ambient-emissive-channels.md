# 066·04 — Baked ambient + emissive channels

[← chain](readme.md) · prev: [03 shadows](03-baked-sun-occlusion-shadows.md) · next: [05 integration](05-runtime-csm-scopedown-tiers.md)

The two remaining baked channels — the quality half of the tool. Shares the same offline baker as
[03](03-baked-sun-occlusion-shadows.md) (visibility raytrace over welded cell geometry), so it costs little once 03's
machinery exists. Both are 1 byte per vertex in the [01](01-native-cell-format.md) format.

## Decisions

1. **skyVis / AO (1 byte)** — hemispheric sky visibility per vertex, ray-traced against the static world.
   - **Grounds SSAO**: SSAO is a half-res screen-space guess (a measured cost in the modern pipeline). A baked
     world-space AO term lets SSAO contribute _less_ (or drop to a lighter setting on low tiers) while corners/alleys/
     under-bridges darken _correctly_ and stably — no screen-space haloing, no view dependence.
   - **Modulates indirect**: multiplies the 002 indirect/ambient term so occluded pockets keep GI but sit darker,
     fixing flat over-bright alcoves at noon.
2. **emissiveMask (1 byte)** — derived offline from the **night-vertex delta** (night prelit ≫ day prelit = a lit window /
   neon / sign). This replaces the runtime heuristic that [071](../071-night-emissive-atmosphere/readme.md) glow uses to guess
   emitters, giving a clean authored mask → tighter bloom, fewer false positives on bright-but-unlit surfaces.
3. **Scope guard**: scalar channels only — no emissive _textures_, no new materials. The mask gates the existing 071
   glow term; skyVis gates existing SSAO/indirect. Both uniform-gated and graceful when absent.

## Tasks

- [~] skyVis baker: hemispheric visibility raytrace over welded cell geometry (reuse 03's sampler); 1-byte channel in 01.
- [~] World-shader: consume skyVis on the indirect term; feed it into the SSAO blend so baked AO offsets screen-space AO
      (tier-tunable in [05](05-runtime-csm-scopedown-tiers.md)/072).
- [~] emissiveMask: derive from day/night prelit delta at build; 1-byte channel; wire into the 071 glow term (replace the
      runtime heuristic when the mask is present).
- [~] Seam test on both channels (bake over welded geometry → no cell-border discontinuity).
- [~] A/B: baked AO vs SSAO-only in alleys/under-bridges; emissiveMask vs heuristic on window/neon-heavy night blocks.

## Verification

- Alleys/under-bridges darken correctly and stably (no screen-space halo, no view dependence); noon alcoves no longer
  flat-bright.
- Night emitters bloom from the authored mask with fewer false positives than the heuristic; classic pipeline unaffected.
- No seams across cell borders on either channel.

## Measurements

_(record after implementation)_

- SSAO ms with baked AO offset vs SSAO-only; emissive false-positive count heuristic → mask; bytes/cell added: …
