# Collision defect at the `road_lawn34` × `road_lawn01` crossroads

**Status: 🔴 open, reported 2026-08-11, not investigated (the user's call: record it, do not fix it yet).**

## Symptom

On the `sa` build, the collision misbehaves right on the junction where `road_lawn34` and `road_lawn01`
meet — the crossroads itself. Reported by the user from a drive; the exact failure mode (a lip, a hole, a
wall, a wrong surface) is not written down yet, only that collision is wrong there. **His own first
suspicion: an incompatibility introduced by one of the installed mods, not stock data.**

The two models, from `find-instances.ts` against the stock tree:

| model | id | placement | source |
| --- | --- | --- | --- |
| `road_lawn34` | 5802 | 1124.57, −950.24, 41.76 | `LaWn.ipl`, lod-link 31 |
| `road_lawn01` | 5747 | 1084.47, −1048.88, 32.07 | `LaWn.ipl`, lod-link 110 |

## The user's own follow-up: it feels like the neighbouring building slid onto the junction

> "there is something very big there — as if it slid, or duplicated, onto the crossroads"

He named it: `standard01_lawn`, txd `sunset01_lawn`, at 1024.4, −990.5, 45.1. **In the map data it has not
moved and it is not duplicated** — one placement, at stock's own 1024.44, −990.49, 44.97, with `lod-link=175`
resolving to `LODndard01_LAwN` at the same spot. Within 150 u of the junction the built map adds nothing stock
does not have (the only differences are our generated LOD trees and `salod*` dictionaries, plus mod REMOVALS:
`newstandnew1..5` and six `sjmpalmbigpv` palms are gone). So nothing visible slid.

**What DID change on that building is its collision, and this is the concrete lead:**

| | stock | built |
| --- | --- | --- |
| `standard01_lawn` DFF | 1791 verts, 1 atomic | **2837 verts**, plus ~40 `2dfx*` light frames |
| `standard01_lawn` COL | 427 faces, **31 boxes** | **1173 faces, 0 boxes** |
| COL bounds | −51.9,−21.4,−9.3 … 51.9,21.4,9.3 | identical |
| `road_lawn34` / `road_lawn01` COL | 176 / 61 faces | unchanged |

The DFF is `18. Project Lumos` (it ships `gta3_img/standard01_lawn.dff` — the light frames are its whole
point). **The collision comes from `0. Map Fixes Pack`'s `gta3_img/lawn_4.col`, which contains this model** —
confirmed by content, not by area. So the mod re-authored the building's collision and turned its 31 boxes
into a triangle mesh; we install that byte-faithfully, **which means we also install its latent defects**
(the same pattern as [`fixed/mod-dff-winding-and-atomic-frame.md`](fixed/mod-dff-winding-and-atomic-frame.md)).

**Caveat that keeps this honest:** the bounds are unchanged and the building's footprint (±51.9 × ±21.4 around
1024.4, −990.5) does **not** reach the junction at ~1084, −1049 / 1124, −950. So a re-authored `standard01`
collision explains "an invisible big thing near the building" but not, on its own, one standing on the
crossroads. Either the field position needs pinning down more tightly, or a second model is involved.

## What is already known about the roads themselves

- **No mod ships `road_lawn34` or `road_lawn01`.** Nothing under `mods-src/original/` mentions either, and no
  mod carries a DFF or COL file named after them; their COL comes out of the build with stock's face counts.
- **The A/B that splits it in one round is a build with `0. Map Fixes Pack` excluded** — it owns the replaced
  `lawn_1/2/4.col` and `law_3.col` (`SA Xbox Map Features` (`7.` since 2026-08-18) owns `law_4.col`). No code needs to be read
  first.
- `road_lawn34` is *also* one of the confirmed texel-smear models
  ([`texel-smear-authored-uv.md`](texel-smear-authored-uv.md), 1124.6, −951.4, 40.9). Almost certainly a
  coincidence — that defect is in UVs and this one is in collision — but worth knowing the model has two
  open entries against it.

## What is missing from this report

The failure mode itself. Before anyone spends a build on it, get from the field: does the car stop dead,
climb, sink, or lose grip; is it a thin seam or an area; does it happen on foot too; and **the position of the
obstacle rather than of the nearest named model**. That distinction picks the tool (COL dump vs surface-type
read) and this entry cannot pick it.
