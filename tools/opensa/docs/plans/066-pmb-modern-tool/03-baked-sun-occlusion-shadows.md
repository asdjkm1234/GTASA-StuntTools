# 066·03 — Baked sun occlusion → static shadows + sunVis

[← chain](readme.md) · prev: [02 batching](02-static-batching.md) · next: [04 ambient/emissive](04-ambient-emissive-channels.md)

**The headline of the chain.** The user's verdict on runtime CSM: the static-world shadows read **angular** (shadow-map
stair-stepping on edges) and **jittery** (cascade swim under camera motion), and they cost us the +35–50 % draw calls the
[072 bench](../072-quality-tiers-default-flip/readme.md) measured. This plan bakes the **static→static** sun shadow into the cell
data so it is evaluated analytically per vertex/fragment — no shadow-map resolution, no cascade transitions → smooth and
stable at any camera distance — and CSM shrinks to a small dynamic-only near cascade.

## The core problem with runtime CSM for static geometry

A shadow map is a raster of depth at fixed resolution: silhouettes stair-step (angular), and as the camera/cascade frustum
moves the texel grid shifts under the world (swim/jitter). Cascades add blend seams and per-frame caster re-renders. For
**static geometry shadowed by static geometry**, all of this is wasted: the occlusion is a fixed function of the sun
direction only. Bake it once, evaluate it smoothly, and the map is never needed for that class of shadow.

## Decisions

1. **Bake sun occlusion as a function of sun direction, not a single shadow.** SA's sun travels a known arc. For each
   welded cell vertex, ray-trace occlusion against the static world at a set of sun elevations/azimuths along that arc and
   store a **compact directional occlusion** the runtime interpolates:
   - **v1 (scalar sunVis, 1 byte)**: occlusion averaged over the sun arc. Cheap, kills double-lit prelit, gives soft
     ambient-occlusion-of-the-sun. Does **not** track the moving sun — a good first landing that already removes the
     worst CSM artifacts on static faces.
   - **v2 (directional, a few bytes)**: store the sun elevation at which each vertex enters/leaves shadow (a horizon angle
     in the sun's travel plane), or a tiny per-vertex occlusion curve. Runtime evaluates a **smooth** shadow term as the
     sun moves — real time-of-day static shadows, no map, no jitter. This is the target; v1 is the stepping stone.
2. **Soft edges for free.** Sampling a small sun disc (area light) during the bake gives penumbra baked into the value →
   soft contact shadows without PCF/PCSS. Penumbra width ∝ occluder distance, exactly what CSM struggles to do.
3. **CSM scope-down to dynamic-only.** Once static shadows are baked, CSM keeps **only the near cascade** for cars/peds/
   dynamic objects (short range, small hi-res map, looks fine, never swims against static geometry). Mid/far cascades and
   the static caster passes — the +35–50 % draws — are **removed**. Dynamic objects receive the baked static term on the
   world for free; the world receives dynamic shadows from the small near map as today. (Wiring lands in
   [05](05-runtime-csm-scopedown-tiers.md); this plan produces the data and the receive term.)
4. **Bake over WELDED geometry** (map-optimizer output) so occlusion is continuous across cell borders — no seams. Reuse
   the LOD-generator occlusion/raytrace helpers (they already exist for the decimation harness).
5. **Determinism**: fixed sun-arc sample set + fixed seeds; the bake is reproducible and reported (per-cell bytes, bake ms).
6. **Interaction with 002 split**: sunVis modulates `uDirectScale` per vertex, fixing 002's global-split double-count of
   Rockstar-baked sun in already-shadowed areas (the original 066 motivation) — same channel, two payoffs.

## Tasks

- [~] Sun-arc sampler + per-vertex occlusion raytrace over welded cell geometry (area-sampled sun disc for penumbra);
      reuse LOD-generator occlusion helpers. Deterministic.
- [~] **v1**: bake scalar `sunVis` (1 byte) into the 01 format channel; world-shader receive term (`uDirectScale ×
    sunVis`), uniform-gated, graceful when absent.
- [~] **v2**: bake the directional representation (horizon angle / occlusion curve); world-shader evaluates a smooth
      moving-sun static shadow; unit-test the term against the raytraced ground truth at several sun elevations.
- [~] Seam test: bake on seam-weld fixtures → no discontinuity at cell borders.
- [~] Penumbra/softness knob (sun disc size) → tier parameter for [05](05-runtime-csm-scopedown-tiers.md)/072.
- [~] A/B screenshots: runtime-CSM static shadows vs baked (edges, camera-motion stability, under-bridge/north-face).

## Verification

- Static shadows read **smooth and stable** under camera motion — no stair-step, no swim — side-by-side vs current CSM.
- Moving-sun (v2): the static shadow tracks time-of-day continuously with no popping; matches the raytraced reference.
- Baked-shadow areas no longer double-lit at noon; no cell-border seams.
- With CSM scoped to dynamic-only ([05](05-runtime-csm-scopedown-tiers.md)), the static caster passes are gone from the
  draw count.

## Measurements

_(record after implementation)_

- shadow GPU ms + draws: full CSM → baked-static + dynamic-near; bytes/cell for sunVis v1 vs directional v2; bake ms: …
