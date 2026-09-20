# 06·3·02 — Ped LODs: silhouettes for models that never had them

[← chain](../readme.md) · prev: [01 ped rendering](01-ped-rendering.md) · next: [03 ped sim](03-ped-sim.md)

SA ped models ship NO LOD meshes — the original never drew a ped far enough to need one. We will
(commitment 2), so the LOD chain is ours to invent. Decision D3 picks generated silhouettes, with the
user's alternative (duplicated originals) kept as the explicit A/B loser-or-winner — the field decides
(goals directive 4).

## The two candidates (user, 2026-08-02)

| | A — generated silhouettes (D3 default) | B — duplicated originals |
| --- | --- | --- |
| Mesh | 2–3 generic body classes, decimated from REAL roster models via the lod-common HD→LOD core | every model, auto-decimated |
| Texture | none — flat dark tint, semi-transparent, dither-faded | original textures at low mip |
| Draw cost | ONE instanced draw for the whole tier (no per-model texture binds) | per-model groups, texture residency for every distant model |
| Identity | lost at distance (a person-shape, not "that ped") | preserved |
| Risk | reads as "shadows walking" in daylight? — the A/B question | GPU/VRAM scales with distant variety; contradicts the far tier's job |

The bet behind A: beyond ~150 m a pedestrian is a GAIT, not a face — a correctly-walking dark
silhouette with alpha fade reads as a person (and at night it is exactly right). B's identity
preservation matters at ranges where ring 0/1 already show real models.

## Design (A, the default)

- **Offline generation** (opensa-pack stage beside pack-peds): cluster the `peds.ide` roster by
  skeleton proportions into 2–3 body classes; decimate a representative of each through the lod-common
  MeshBuilder/hdToLod chain; strip materials to a single tint slot; keep ~4 bones (root, spine, legs
  proxy) OR bake a 8–16 frame vertex-cycle walk — decide by measuring both (a 4-bone skinned
  silhouette rides 3/01's bucket machinery for free; a vertex-cycle needs no palettes at all).
- **Runtime tiers** (distances tuned in field, dither-faded bands):
  - Ring 0 (≤ ~40 m): full model, full anim (3/01 near tier).
  - Ring 1 (~40–150 m): full model, bucketed shared clips (3/01 crowd tier).
  - Ring 2 (~150–400 m): silhouette class, instanced, phase from the sim; day = dark translucent
    tint (~0.6 alpha), night = near-black; NO coronas (peds don't glow).
  - Beyond ~400 m: nothing — peds fade out; the far city's life is carried by traffic light rivers
    (crowds are invisible at 500 m in every AAA reference too).
- The tint/fade lives in the shader, the anchor in the bake — "if a value will be iterated on it
  belongs in the shader" (build-vs-runtime restriction).

## The A/B (the plan's decision gate)

Build A; build B's cheap probe (auto-decimated per-model LODs through the same generator, textures at
lowest mip); field-compare on the Market noon scene and an LV night scene: which reads as "people
there" without drawing the eye; GPU/VRAM delta recorded. Keep the winner, record the loser in this
file with its numbers (and in `docs/performance/` if the loser is cheaper).

## Goals gate

1. *Authored data:* roster models are the SOURCE of the silhouettes (derive from the asset — never a
   hand-modelled generic that ignores what mods put in the slots; a total conversion's peds produce
   THEIR silhouettes).
2. *Original:* nothing to recover — SA has no ped LODs at all.
3. *Better:* by existence; the A/B verdict is the demonstration.
4. *Cost:* ring-2 tier budget: **≤ +0.3 ms GPU at 2× retina for 300 silhouettes** (one draw, tiny
   meshes); generation cost recorded per pack run.
5. *Contract:* new pack product (silhouette section) recorded in formats docs; class-assignment
   derivation documented so mod peds land predictably.

## Tasks

- [ ] Pack stage: clustering + decimation + tint slot; report line (classes, verts, coverage).
- [ ] Skinned-4-bone vs vertex-cycle measurement; pick and record.
- [ ] Ring-2 instanced silhouette path (3/01 pipeline variant) + dither band to ring 1.
- [ ] B probe + the field A/B; verdict + numbers here.
- [ ] Docs: formats row, features/ update; performance/ entry for the loser if relevant.

## Measured numbers

- Generation: classes / verts each / roster coverage: —
- Ring-2 GPU at 300 silhouettes: —
- A/B field verdict: —
