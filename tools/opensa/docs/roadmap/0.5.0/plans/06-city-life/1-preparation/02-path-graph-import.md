# 06·1·02 — Full path-graph import (the data gate for everything)

[← chain](../readme.md) · next: [03 population data](03-population-data.md)

Extend the shipped `nodes*.dat` parser from "vehicle nodes + links" to the COMPLETE graph: ped nodes,
navi-node lane/direction data, the full flag set, and `tracks*.dat`. Nothing in this chain may drive,
walk or ride before this lands — the current graph literally cannot express a one-way street.

## Current state (verified 2026-08-02)

- `packages/renderware/src/parsers/binary/paths.ts` (`vehiclePathNodes`, 117 lines): header + the
  28-byte VEHICLE nodes (position ÷8 fixed-point, baseLink, area, id) + link table. Decodes exactly
  2 of the flag bits (`linkCount`, `boats`). **Skips**: ped nodes (offset-walked), navi nodes (14 B
  each — where SA keeps lane counts and travel direction), link lengths, path intersections, and all
  remaining flags (traffic-light, dead-end, emergency-only, roadblock, spawn probability).
- `packages/game/src/paths/route-graph.ts` builds the runtime graph; it refuses to invent reverse edges
  BECAUSE direction is unparsed — measured: **0 one-way links in 30,587 vehicle nodes** (see
  `docs/restrictions/assets-and-data.md`, "The node graph says WHERE roads are, not how they may be
  driven"). Gradient is likewise absent (the 18° hill lesson).
- `tracks*.dat` / `train.dat`: shipped in every build (`data/paths/`, loose), parsed nowhere.
- Consumers already live: `loadRouteGraph` (returns `null` for path-less games), video-mode autopilot,
  bench road cars (841 placements — the field-proven precedent).
- Two hacks exist only because of these gaps: `docs/hacks/pedestrian-route-on-a-vehicle-graph.md`
  (walk routes = vehicle route + 6.5 m offset) and the route-graph edge case that a dense city grid
  yields no route (`docs/edge-cases/route-graph.md`).

## Goals gate

1. *Authored data:* `nodes*.dat` and `tracks*.dat` read COMPLETELY, as SA meant them — lanes, direction,
   light flags, spawn hints are the author's design and currently thrown away.
2. *Original's answer:* SA parses all of it into `ThePaths` (CPathFind) — the meaning is fully known via
   gta-reversed; the community format docs are the second source.
3. *Better:* our graph gains what SA's runtime graph has, then exceeds it via the sidecar (1/04);
   correctness demonstrated by round-trip + cross-checks against SA's own loaded values (the ASI can
   dump `ThePaths` under Wine as ground truth — a parity fixture SA itself wrote).
4. *Frame cost:* boot-parse only (~3.5 MB across 64 files); measure and record boot delta; zero
   steady-state cost.
5. *Contract:* file formats unchanged (read-only plan); `data/paths/*` naming already flows through the
   build untouched.

## Design

- **One parser, layered outputs**: extend `paths.ts` to emit `{ vehicleNodes, pedNodes, naviLinks,
  linkLengths, flags }`; keep `vehiclePathNodes` as a thin compatibility view so video mode and the
  bench do not churn.
- **Navi decode is the heart**: per directed link — lane counts each way, travel direction bits, the
  traffic-light direction flags. Output: a DIRECTED lane-aware link table replacing today's mutual one.
- **Flags decoded in full** on both node kinds: traffic-light control, dead-end, emergency-only,
  boats, roadblock candidacy, spawn allowance — named booleans, not raw masks, in the runtime graph.
- **Ped graph**: second node set + links on `RouteGraph` (same spatial-hash `nearest()` machinery),
  cross-links to road nodes where SA marks crossings.
- **Rail**: `tracks*.dat` polylines with arc-length parameterisation (`s → position/tangent`), station
  markers deferred to the sidecar (1/04). `train.dat`/`train2.dat` decoded for what SA keeps there.
- **Graph queries library** (shared by sim/editor/ASI-parity): nearest-lane, A* over directed lanes with
  per-KIND cost (car/ped/rail), "advance s metres along route", per-vertex speed carried by the SUBJECT
  travelling it (the 096/07 restriction).
- **Gradient**: computed per link from node Z deltas at load — the graph's own answer to the 18° lesson.

## Verification

- Unit: negative-first describe blocks per record type; real-fixture tests (one manifest line per real
  `NODES*.DAT` — the real-fixtures-over-synthetic rule).
- Cross-host ground truth: dump SA's in-memory `ThePaths` node/link/lane values for 2–3 areas via a
  debug hook in `asi/city-life` (Wine) and diff against our parse of the same files. Direction and lane
  counts must match 100 %.
- Field probe: a debug overlay drawing directed lanes + light-flagged nodes over the map
  (`?paths=1`-style, self-gated; ONE owner per view — the 094 lesson); eyeball one-way streets in
  downtown LS against known ground truth (they are visibly one-way in the map).
- Boot census: `[paths] nodes: V vehicle / P ped / N navi links / T track points` — every population of
  the world announces its size.

## Tasks

- [ ] Navi-node decode + directed lane table; retire `oneWayLinks: 0` for real.
- [ ] Full flag decode (both node kinds), named fields.
- [ ] Ped node + ped link parse; `RouteGraph` second graph + crossings.
- [ ] `tracks*.dat` importer + arc-length runtime.
- [ ] Graph queries library + per-subject speeds.
- [ ] `ThePaths` parity dump (ASI debug hook) + diff test.
- [ ] Debug overlay + boot census lines.
- [ ] Docs same change: update `docs/edge-cases/route-graph.md` (lift what's lifted, keep what stays),
      the two restriction entries if their facts change, `docs/debug/README.md` for the overlay.

## Measured numbers

- Boot parse cost (before/after, ms): —
- One-way links found / total links: —
- Parity diff vs `ThePaths`: —
