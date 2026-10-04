# 021 — Angle-weighted normal accumulation

**Status: DONE — built 2026-07-15, closed 2026-08-11 with [020](020-preserve-authored-normals.md) on the same
field verdict** (no problems seen; no A/B run). Implements the weighting
half of option 2 of the 0.4.0 normals-smoothing idea (graduated here, idea doc deleted) (plans 020–023 are the normals batch).

Landed: `accumulateGroupNormals` weight = `area × cornerAngle` (`cornerAngle` from the two edges leaving the
corner, acos-clamped; degenerate corners weigh 0). Both consumers get it (map-optimizer rebuild/point-repair

- opensa-lod-generator via the shared core). Unit test: a 200 u road-strip sliver (4× the area) sharing a
  junction edge with a 30°-tilted unit face — area-only lands at nz ≈ 0.99, angle×area keeps the tilt
  (asserted analytically, not a snapshot). 337 tests green across the five consumer suites (no snapshot
  re-baselining was needed — no existing fixture pinned exact rebuilt normals).

## Problem

`tool-kit/mesh/smooth-normals.ts#accumulateGroupNormals` weights each face's contribution by **area only**.
Long thin triangles dominate junction vertices: a road strip 100 m long outvotes every local face at an
intersection corner, skewing the vertex normal along the strip (kin to the road-stripe artifact family —
GTA road meshes are exactly this shape). Under the 074 engine's per-vertex N·L the skew is a visible
brightness tilt at junctions.

## Design

Standard corner-angle × area weighting: for face `f` incident to vertex `v`, weight = `area(f) ×
cornerAngle(f, v)` where `cornerAngle` is the angle at `v`'s corner of the triangle (radians). A sliver's
huge area is cancelled by its tiny corner angle; equilateral fans are unchanged. The corner angle is computed
from the two edges leaving `v` — needs the per-corner context, so the accumulation loop keys the weight per
corner, not per face.

Cost: 3 extra `acos` (or a dot-product clamp) per triangle in an offline tool — negligible against the run's
bake time.

## Determinism

Same inputs → same outputs (pure arithmetic, no RNG, no iteration-order dependence beyond today's).
Golden-fixture normals WILL shift — the LOD harness and any snapshot fixtures must be re-baselined in the
same change, with before/after screenshots in this doc.

## Tasks

- [x] Corner-angle weight in `accumulateGroupNormals` (tool-kit core; both consumers get it).
- [x] Unit test: sliver + tilted face sharing a junction EDGE — sliver no longer dominates (analytic
      expectation, not a snapshot).
- [x] Re-baseline affected fixtures — none needed: no existing fixture pins exact rebuilt normals
      (map-optimizer + lod suites green unchanged).
- [x] **Field A/B on a road junction — CLOSED 2026-08-11 with [020](020-preserve-authored-normals.md)'s, on
      the same verdict and with the same caveat.** The user reports no problems and has not seen any across
      the rebuilds since; no A/B was run, so this says "nothing visible went wrong" and not "the weighting
      helped". The junction shot is still the right instrument if the question ever comes back.
