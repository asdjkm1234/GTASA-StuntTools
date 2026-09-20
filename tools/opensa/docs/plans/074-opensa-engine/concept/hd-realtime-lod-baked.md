# Concept: HD segment lit in real time, opensa-pack bakes ONLY the LOD segment

**Status: THINKING — not scheduled (user decision 2026-07-15). Nothing here is being built; the triggering
bug (below) deliberately stays OPEN in [17-map-lighting](../17-map-lighting.md).** This doc preserves the
architecture discussion so the eventual decision starts from evidence, not memory.

## The proposal (user, 2026-07-15)

Split the lighting model by segment, matching each segment's nature:

- **HD ring (≤380 u): everything real-time.** 2dfx lamps as live lights (authored flicker/blink/traffic
  phases work — signs shimmer like the original), directional sun light + real-time shadows. No HD bakes.
- **LOD ring (>380 u): everything baked by opensa-pack.** Static light pools under lamps, baked sun
  shadows/AO — at LOD viewing distance per-vertex baked quality is sufficient by construction.
- **Pipeline: opensa-pack consumes the full perfect-map-builder chain** — mod-installer → map-optimizer →
  … → opensa-lod-generator — and bakes onto OUR generated LODs (not the stock ones). This is
  [14-pmb-integration](../14-pmb-integration.md) with a sharpened role split.

## The bug that triggered this (diagnosed 2026-07-15, left OPEN on purpose)

Ten Green Bottles (`Liquorstore02_LAe2`, 2318,-1645, 8 green 2dfx anchors color 15,230,0, coronaSize 1,
authored farClip 100). Four distance states, all explained:

| Field state                             | Cause                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bright green from very far              | our corona farClip FLOOR of 350 (`engine.ts` drawCoronas) — the "game restores authored clip" tail from 06 row 13 was never done; vanilla clips at 100 |
| Green wash near (correct-looking)       | camera-ranged light pool paints the façade per-vertex (fabricated radius max(14, size×8) = 14 u here)                                                  |
| Fades when driving off                  | hard `LIGHT_POOL_REACH = 130` cut, no fade — the 8 anchors drop out one by one                                                                         |
| No glow approaching from the other side | pool (cap 64) fills with NO sort in `cells.all()` = **cell-creation order** — lamps of earlier-streamed cells eat the slots                            |

Data facts: the vanilla HD night set carries only a WEAK green (mean 34,35,10; 58/192 verts tinted) — the
strong green is entirely our runtime pool. **No LOD near the bar has green night verts** — the far glow is
100 % the 350-floor coronas, i.e. the state the user likes at distance is itself a byproduct of the floor.
map-optimizer only ran smooth-normals on this model (prelit untouched).

Prod is clean on this scene because `street-light.system.ts` (plan 070) has all four mechanisms we lack:
nearest-sort + hysteresis (rebuild every 30 frames), range fade from 0.72×90 u to 90 u, per-slot temporal
ramp (~0.4 s), and corona↔pool handover. That closes plan 17's open question №1 for the LAMP symptom.
(The PATCHES symptom resolved separately: the engine was fed the unconditioned map — map-optimizer input
fixes it; see map-optimizer plans 020–023.)

## Why the split is architecturally right

- **Nature-matching.** LOD is static by definition (seen from ≥380 u, sun doesn't move perceptibly during
  an approach, per-vertex suffices). HD is where authored dynamics live: 2dfx flicker flags, traffic-light
  phases, sign shimmer, moving sun shadows. Today we either lose those or fake them.
- **Sun-vis v2's fundamental problem dies.** The directional bake was REVERTED because per-vertex thresholds
  on SA's metre-sparse receivers punch holes (bridge falls between road verts). Real-time shadows are
  per-PIXEL — the sparse-receiver problem does not exist. The parked plan `roadmap/0.5.0/03` (prerequisite:
  receiver densification 2–4 m) is superseded.
- **Convert time collapses.** Bakes were 91 % of the full-LS convert (760 s of 833 s). LOD-only baking is a
  small fraction of the verts.
- **Better LODs for free.** opensa-lod-generator LODs come from the same HD (QEM chain, night-ratio
  machinery) — HD↔LOD consistency beats stock LOD models.

## The four hard problems (any build-out must answer these first)

1. **Static-lamp selection must NOT be a camera pool.** Even prod's fixed pool fades lamps by ~90 u, which
   violates the recorded plan-17 requirement ("the glow stays on for as long as the building draws in HD" =
   380 u). The scalable design: **per-cell light lists** (already in `.oscell` — the corona pass reads them),
   consumed per-pixel with AUTHORED ranges by each cell's world draw; edge lamps duplicated into neighbour
   cells' lists at CONVERT time. No camera selection → no churn, no asymmetry, no distance gate, by
   construction. Loop bound = the cell's lamp count, capped by importance at convert. Stress case: Vegas
   strip — measure.
2. **GPU budget — the 120→25 fps lesson stands.** Per-pixel lamps + 1–2 shadow cascades over the HD ring ≈
   +2–4 ms GPU on top of today's 2–4.5 ms p95. Fine at 60 Hz, tight at 120 Hz on M3. This REVERSES a
   founding 074 decision ("baked occlusion replaces CSM, SSAO dies") — legitimately: that call was made
   against three-WebGL's CPU wall (gone) and prod's jittery CSM (own engine controls texel snapping). But it
   re-opens ONLY through a numbers-gated spike, M0-style.
3. **The HD↔LOD seam at 380 u becomes THE invariant.** Real-time-lit HD must land at the baked LOD's light
   level at swap distance: ONE shared falloff model (constants shared converter↔shader — the azimuthScale
   MIRRORED lesson), the bake's sun arc = the runtime arc, and an A/B swap test in the harness. Otherwise
   every cell swap pops.
4. **Shadow cascades × render bundles.** Cells are pre-recorded bundles bound to specific pipelines; a
   shadow pass means a second shadow-variant bundle per HD cell (or re-record). Memory + create-time must be
   costed against the ≤1-create/frame budget before committing.

Open tail: ambient occlusion on HD once its bake is gone — SSAO (we own depth; 074 buried it) or accept
flatter overhangs in v1 and judge in the field.

## Phasing sketch (numbers-gated, if/when un-parked)

1. **P0 spike** — per-cell per-pixel lamps on one dense district (Ganton + a Vegas strip rect), bench vs
   120 Hz. This spike IS the fix for the green bug.
2. **P1 spike** — near-cascade sun shadows over the HD ring; bench + anti-jitter stability check.
3. **P2** — pipeline rewire: opensa-pack eats opensa-lod-generator LODs; HD bakes off; light/shadow/AO bakes
   become LOD-only (plan [15](../15-lod-baked-lights.md) folds in here).
4. **P3** — seam invariant (shared constants + swap A/B test) + field.

## Interim note

The ONLY change worth making independently of this decision: coronas restore AUTHORED farClip in the game
host (one line — the 350 floor is a lab-camera accommodation and an acknowledged unfinished tail). Parked
with the rest per the user's call; listed in plan 17's tails.
