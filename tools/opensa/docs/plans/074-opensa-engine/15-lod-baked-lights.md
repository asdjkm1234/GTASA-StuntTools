# 074·15 — Baked light pools for the far field (LOD night lighting)

[← chain](readme.md) · relates: [07 baked channels](07-baked-channels.md) · 06 rows 7/13 · user request
2026-07-12: "at night the far city should show streetlight pools, lit billboards and sign glow — on LODs".

## Feasibility: yes, and the data is already in the converter

The welder already collects every 2dfx light anchor (positions, colours, sizes, farClip — plan 06 row 13
built this for coronas). LOD cells already re-bake channels (the HD/LOD seam round). Combining the two:
**bake the STATIC NIGHT LIGHT of the 2dfx lamps into the LOD (and optionally HD) night-prelit vertex set**,
so the far field glows at night with zero runtime lights — the classic "city at night" look for free.

## Design

- **New converter stage `bakeNightLights`** (after the sun/AO bakes, before assemble): for every LOD vertex,
  accumulate the district's 2dfx lights: `contribution = lightColor × falloff(dist) × hemisphere(N·toLight)`
  with a squared falloff over ~1.5× the corona size and an intensity cap. ADD into the night-prelit RGB
  slots (clamped) — the existing day↔night blend then shows it automatically; no engine change AT ALL for
  the base effect.
- **HD cells too, weaker**: the HD ring has the real light pool (06 row 7, M3) near the camera; a subtle
  baked term on HD keeps the HD/LOD transition seamless (same rule as the shadow-seam fix: bake both, tune
  amplitudes). Once row 7 lands, the runtime pool fades IN as the baked term fades OUT with distance —
  decide the crossfade knob then.
- **Emissive interplay**: baked lamp light raises night-vs-day luma → the emissive mask bake would tag lit
  ground as "glowing". Order the stages: emissive mask FIRST (from authored night sets), night-light bake
  AFTER, and exclude the bake's contribution from the mask input.
- **Billboards/signs**: their 2dfx lights get the same treatment (they are just anchors); the CORONA sprite
  at distance is already handled by the light table (farClip). Consider raising corona farClip floors for
  "landmark" lights (billboards) so the sprite survives to LOD range — one knob in the corona pass.
- **Occlusion (v2, optional)**: reuse the district BVH to shadow-test each vertex↔light pair (lamps behind
  buildings should not light the street behind them). Costly (lights × verts) — v1 ships falloff-only with
  a short reach (~2× corona size) which mostly self-limits bleed; measure before adding rays.

## Tasks

- [ ] `bakeNightLights` stage: LOD verts (+ weak HD term), squared falloff, hemisphere factor, clamp; report
      block (lights, verts touched, ms).
- [ ] Stage-order fix: emissive mask before the light bake; exclusion of baked contribution.
- [ ] Corona farClip floor knob for landmark lights (billboard/sign anchors).
- [ ] Field: night `city` flight — far streets show lamp pools, transitions HD↔LOD seamless; bench row.
- [ ] (v2, measured first) BVH occlusion per vertex↔light pair.

## Measurement ledger

_(bake ms, verts touched, night screens far-field before/after, HD↔LOD transition verdict)_
