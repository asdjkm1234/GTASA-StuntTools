# 03 — Contact darkening / shadows for dynamics (cars + peds)

**STATUS: DRAFT** — part of the [04-graphic-improvements](readme.md) idea bundle (0.6.0). Recorded
2026-07-17; to be thought through properly later — nothing scheduled.

## Where this comes from

The user asked whether prod-style SSAO could be added "for cars and peds". The reformulated goal (agreed
2026-07-17): **contact darkening / shadows for dynamic entities** — the baked per-vertex AO covers only
the static world (it replaced prod's SSAO, on by default in opensa-pack since 2026-07-17), so cars and
peds receive no contact term and read pasted-on. The plan-16 contact BLOB was one attempt at exactly this
and was rolled back the same day (record + constraints in
[074/16 § steps 3+6](../../../../plans/074-opensa-engine/16-vehicle-paint.md)).

## Why full-screen SSAO is the awkward tool for this goal

1. It cannot scope to dynamics: a screen-space pass darkens everything, so it double-darkens the already
   AO-baked world unless masked (stencil / ID buffer — extra machinery we don't have).
2. It needs a normals buffer — prod runs a scene-normals PREPASS (a second geometry pass per frame) —
   plus the MSAA depth store; all of it is per-pixel night-budget territory at 2× retina (~1.5–3 ms by
   eye), the exact cost class that killed SSR and must be measured on the REAL display only.
3. Per-pixel screen-space AO is a poor fit for "the car sits on the road" — its output is corner
   darkening, not a grounded silhouette.

## Candidate approaches for the thinking round (unordered)

- **Dynamic-only near shadow cascade** — the ORIGINAL 066/07 design ("the only runtime shadow map":
  static world shadows are baked; the near cascade renders only dynamic casters — cars, peds, props).
  Gives real ground shadows AND self-shadowing; casters are few; receiver is the near field only.
  Fits the [hd-realtime concept](../../../../plans/074-opensa-engine/concept/hd-realtime-lod-baked.md)
  round directly.
- **Capsule/proxy AO** — analytic occlusion from a handful of spheres/capsules per entity (the classic
  character grounding trick); no G-buffer, no prepass; per-pixel only under the entity's footprint.
- **Contact blob v2** — the rolled-back plan-16 decal with its written constraints (height from a physics
  raycast never bind pose; falloff knee at the sill line; no binary anything).

## Hard requirements (learned 2026-07-17)

1. Verdicts on the REAL display only — headless A/Bs under-reported both per-vertex and per-pixel costs.
2. Must not double-darken the baked-AO world.
3. Whatever ships must be free at frame level or an opt-in preset — grounding is beyond prod parity for
   cars (prod grounds them via CSM, which this engine deleted by design).
