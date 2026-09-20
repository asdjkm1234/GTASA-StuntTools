# References — what we borrow, and what we did with it

**A living ledger of ideas taken from other projects.** One row per idea: what it is, whose it is, what it
answers for us, and **its status** — planned, built, noted, or refused with a reason.

Distinct from its neighbours, and the difference is what the row is *about*:

| Folder | The row is about |
| --- | --- |
| **`references/`** | an **idea** we took from someone, and where it landed |
| [`links.md`](../links.md) | a **resource** — where to find the thing, and what it is |
| [`hacks/`](../hacks/README.md) | an **expedient of ours**, and what would retire it |
| [`postmortem/`](../postmortem/README.md) | a **direction of ours** that died |

**We take ideas and formats, never code.** Every 3D-map project below is WebGL or three.js and this engine is
its own WebGPU renderer, so nothing here is linkable even where the licence would allow it (Apache-2.0
Cesium, BSD-3 MapLibre, MIT deck.gl / Giro3D / SnailyCAD). A borrowed *technique* costs an attribution line
here; borrowed *source* would cost a licence obligation and a second codebase.

Surveyed 2026-08-06 for [plan 202](../plans/202-pcad-dispatch/readme.md).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **built** | in the code, with the measurement that justified it |
| **planned** | a named step owns it |
| **noted** | worth having, nothing scheduled |
| **refused** | looked at and rejected — the reason is the point of the row |

---

## Rendering and world

| Idea | From | What it answers for us | Status |
| --- | --- | --- | --- |
| **LOD by screen-space error** — load a tile when its projected error exceeds N pixels | CesiumJS (`maximumScreenSpaceError`) | a map camera has no player to ring-stream around; one rule that works at every zoom and on every screen, instead of hand-picked radii | **planned** — [201/1-05](../plans/201-dispatch-console/1-the-map-profile/readme.md) |
| **Geometric error declared per tile** — the error introduced by drawing this tile instead of its children | [3D Tiles](https://docs.ogc.org/cs/22-025r4/22-025r4.html) (OGC) | the input screen-space error consumes. **Our pak carries no such number** — the idea found a gap rather than filling one | **planned** — same step, bake half first |
| **`ADD` vs `REPLACE` refinement** | 3D Tiles | names what our HD/LOD tiers already are (a two-level REPLACE) and what a deeper tree would need | **noted** |
| **Classification instead of tessellation** — drape a shape on the ground by rendering a volume and classifying the fragments it covers | CesiumJS ground primitives | every clamp-to-ground need at once: annotations, data layers, unit trails. Our ground is welded cell geometry, so fitting a polygon to it would be a per-cell join problem | **planned** — [201/7-05](../plans/201-dispatch-console/7-the-operator-map/readme.md) |
| **A layer model over the base world**, styled from data at runtime | deck.gl | zones by workload, coverage, heat — over a world whose look is baked | **planned** |
| **One-file tile pyramid, range-requested** | [PMTiles](https://github.com/protomaps/PMTiles) | the flat-2D mode's delivery: our pak is already static and range-friendly, so tile hosting disappears | **planned** — [201/6-02](../plans/201-dispatch-console/6-display-modes/readme.md) |
| **GTA-SA → tile-coordinate projection** | [SanMap](https://github.com/ikkentim/SanMap) (Unlicense) | the flat-2D zoom/tile scheme, proven, rather than invented | **planned** — same step |
| **A prebuilt satellite raster of San Andreas** | [samap](https://github.com/AmyrAhmady/samap) | — | **refused**: covers stock SA only (this engine exists to run total conversions) and the imagery is credited to gtagmodding, not owned by the repo publishing it |
| **Globe / CRS machinery** | OpenGlobus, NASA WorldWind, VTS | — | **refused**: real-world geography is out by decision, so a globe buys nothing |
| **Point-cloud pipelines** | Potree, COPC | — | **refused**: no use case |

## Symbology and interaction

| Idea | From | What it answers for us | Status |
| --- | --- | --- | --- |
| **Label collision with sort-key priority**, allow-overlap, variable placement | [MapLibre](https://deepwiki.com/maplibre/maplibre-native/3.3-symbol-placement-and-collision-detection) | 150 units with labels at city zoom is a decluttering problem, not a drawing one | **planned** — [201/3-03](../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md) |
| **Drag a unit onto a call, a group, a lookup window, a timer** | SonoranCAD | the best dispatch interaction in their product, and we have nothing like it — we have click-then-panel | **noted** — the strongest single borrow available |
| **Per-category blip visibility and outline colour** (police / fire / EMS / dispatch) | SonoranCAD | at 150 units this is necessity, not decoration | **noted** |
| **Hover shows brief, click opens an action menu** (add to call, group, lookup, edit, panic) | SonoranCAD | two-level disclosure instead of one panel carrying everything | **noted** |
| **A pin in a list opens the map and zooms to it** | SonoranCAD | binds the lists to the map, not just the map to itself | **planned** in part — [201/7-03](../plans/201-dispatch-console/7-the-operator-map/readme.md) |
| **Bodycam from a unit blip** | SonoranCAD (ER:LC) | a live view from the unit, reachable from the map | **noted**, future |
| **Visibility gated by duty, not by presence** — a unit appears only when logged into the CAD | SonoranCAD | we get this free: PCAD only reports units that are on duty | **built**, by construction |
| **Measurement, annotation, cross-sections on a 3D scene** | [Giro3D](https://github.com/giro3d-org/Giro3D) / iTowns | the operator tools | **planned** — [201/7-05](../plans/201-dispatch-console/7-the-operator-map/readme.md) |

## Data and time

| Idea | From | What it answers for us | Status |
| --- | --- | --- | --- |
| **Entity properties as functions over an interval, driven by a clock** | CZML (Cesium) | time as an axis rather than a field — scrub, trails and playback all fall out of one structure | **planned** — [201/8](../plans/201-dispatch-console/8-the-time-axis/readme.md) |
| **Interpolate between received samples, never past them** | general tracking practice, and CZML's shape | a car continuing on its last vector drives through a wall | **planned** — [201/8-02](../plans/201-dispatch-console/8-the-time-axis/readme.md) |

## Product shape

| Idea | From | What it answers for us | Status |
| --- | --- | --- | --- |
| **Self-hosted, Docker, Discord role sync, realtime state everywhere** | [SnailyCAD](https://github.com/SnailyCAD/snaily-cadv4) (MIT) | the feature checklist a roleplay CAD is measured against | **built** in PCAD, largely |
| **In-game account ↔ CAD account binding by an API id** | SonoranCAD | how a self-reported position earns the right to be drawn | **built** in PCAD (JWT + Discord role gate) |
| **Custom map upload** — six PNGs from the game's own texture dictionaries, ≤30 MB each | SonoranCAD | how the market solves "show my server's map". **We generate ours instead**, so a total conversion gets one too | **refused** as a mechanism, kept as a comparison |

---

## The finding that matters most

**Even SonoranCAD's "3D Live Map" is a picture.** Its map types are flat rasters — the custom one is six PNGs
pulled from the game's texture dictionaries — and "3D" is a 2D / 2.5D / 3D toggle over that image. There is no
streamed world and no geometry anywhere in the market leader's map, and its only *actual* 3D product is for a
Roblox game.

So the borrowing runs in one direction and it is not the direction that flatters us: **they are ahead on
dispatch interaction and we are alone on the world.** Every "noted" row in the symbology table above is
something a mature product does and we do not.
