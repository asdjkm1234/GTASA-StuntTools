# 096/01 — Path graph + seeded route builder (offline-first)

**Priority P0. Ships alone: a debug script that prints validated candidate routes per region, plus the
parser/graph/builder code under test. No engine or host changes.**

## Why first

Everything downstream consumes a route. Building and validating routes OFFLINE (a node script over the
same data the game reads) means the route heuristics are argued about with printed numbers before a
single in-game frame — the same measure-first method that paid for itself in 084 and 095.

## What exists

- `vehiclePathNodes(areas)` (`packages/renderware/src/parsers/binary/paths.ts`) parses `NODES*.DAT` into
  flat `VehiclePathNode { area, id, position, heading, linkCount, boats }` — but `parseArea` builds the
  link table `[area u16, node u16]` (`paths.ts:98-103`) and THROWS IT AWAY; each node keeps only a
  first-link bearing. No traversable graph exists.
- `scripts/debug/road-straights.ts` proves geometric node-hopping over this data works (heading-tolerance
  hop, 40 m grid hash) — it found the phys-scene straights. It reconstructs adjacency geometrically
  because the parser hides it; this phase makes that unnecessary.
- `roadCarPlacements` (`packages/game/src/adapters/road-cars.ts`) shows the conventions: skip `boats`,
  lane offset 2.5 m to the RIGHT of node heading, deterministic seeding by position.

## Tasks

1. **Expose adjacency in the parser.** Extend `vehiclePathNodes` output (or add a sibling
   `vehiclePathGraph`) so each node carries `links: { area, node }[]` — the data `parseArea` already
   reads. Keep the existing shape backward-compatible (`road-cars.ts`, `road-straights.ts`, tests).
   Extend `paths.test.ts`: synthetic areas assert cross-area links resolve; the real-install check
   asserts a known node's degree.
2. **Pure graph ops** — `packages/game/src/paths/route-graph.ts` (NO renderware import; plain data in):
   node lookup by id, neighbour iteration, nearest-node-to-point (grid hash, reuse the `road-cars.ts`
   hashing idiom), and `walkRoute(graph, startNode, rng, constraints)` returning a polyline of nodes.
3. **Adapter** — `packages/game/src/adapters/path-graph.ts`: `loadRouteGraph(fs)` reads
   `data/paths/nodes{0..63}.dat` (same file loop as `road-cars.ts:56-61`), returns the graph. Lives in
   `adapters/` because it imports renderware (the lint boundary).
4. **Route builder** (in `route-graph.ts`) — seeded, constraint-driven, DERIVED from the data (no
   hand-placed coordinates):
   - target length `L = toSeconds × cruiseSpeed × 1.3` (margin for the speed ramp; cruise ≈ 12 m/s v1);
   - prefer straight continuations: at each junction score candidates by turn angle, hard-reject hops
     > `maxTurnDeg` (start 35°), soft-prefer < 15° (D5: long straights, gentle curves);
   - reject `boats` nodes and dead ends shorter than the remainder;
   - no node revisits (no loops through the same junction);
   - region containment (D15): accept only nodes inside the scene's region — region classification is a
     predicate passed IN (phase 05 supplies it from zone data; the offline script uses the same one);
   - output: ordered world-space polyline + per-vertex target speed from local curvature
     (`v = min(vCruise, sqrt(aLatMax / κ))`, `aLatMax` start 2.5 m/s² — calm cruise, D8) + the lane
     offset already applied (2.5 m right, the `road-cars.ts` convention), plus a corner-smoothed
     spline view for the follower (SA links are polylines; smoothing = Chaikin or arc-fillet at
     junction vertices, radius capped by lane offset).
5. **Seeded RNG** — `mulberry32`-style, one implementation, seed threading through every choice
   (start node, junction picks). Lives with the graph (pure); the app re-exports it later.
   `Math.random` is banned in the module by construction (D9 reproducibility).
6. **Offline validation script** — `scripts/debug/video-routes.ts` (KEPT, debug README row): for a given
   game dir, region predicate and seed, print N candidate routes with their numbers (length, straightness
   histogram, max turn, min curve radius, node count) and reject stats. This is the tool the field
   rounds of 02 will use to pick a hard-corner route deliberately.
7. **Tests** (deterministic; negative describe first per project rules): graph ops on synthetic areas;
   builder rejects loops/region-exits/sharp turns; same seed → identical route; real-fixture check via
   the existing manifest pattern if a NODES fixture is available (`real-fixtures-over-synthetic-tests`).

## Acceptance / verification

- `npm run test` green; lint/tsc clean.
- `video-routes.ts` over `build/original/opensa` prints ≥ 20 accepted routes per region for 5 seeds with
  0 region-exit violations and max turn ≤ 35°.
- Record in the readme ledger: routes accepted/rejected per region, mean length vs target, worst min
  curve radius.

## Close-out (2026-07-30)

**Shipped**, all seven tasks, acceptance met — the numbers are in the [readme ledger](readme.md). What the
plan did not foresee:

- **The builder was split in two.** `paths/route-graph.ts` (build, lookups, `randomNode`) and
  `paths/route-builder.ts` (`walkRoute` + the drivable line) — one file carrying both ran past what the
  project's "small focused files" rule tolerates. `paths/rng.ts` holds the seeded RNG, as planned.
- **Two constraints had to be ADDED to make D5 true**, both found by the offline run and neither in the
  original task list:
  - _curvature over a fixed arc length._ SA nodes sit 2.7–23 m apart; reading the radius off adjacent
    smoothed points called a 32°-max road a 2.0 m hairpin and asked the car to take it at 2.2 m/s. The line
    is now resampled at a uniform 2 m (which the phase-02 follower wants anyway — its lookahead becomes an
    index) and the radius is read over an 8 m baseline.
  - _an accumulated-turn budget_ (`maxWindowTurnDeg` 45° over `turnWindow` 25 m). A per-junction ceiling
    does not make a route gentle: five legal 25° turns in a row bend 125° inside ten metres. This is now the
    binding constraint on acceptance — 112–136 of the ~150 rejects per region are `too-tight`.
- **Region containment moved to the DRIVEN line.** Checking the nodes is not enough twice over: a segment
  between two San Fierro nodes runs through the countryside for a quarter of the route, and a road hugging
  the `y = −742.306` box edge stays inside by its nodes while the 2.5 m lane offset sits 10 cm outside. Both
  would have fired `CityZoneSystem`'s 6 s weather rewrite mid-scene. The walk now samples each segment every
  5 m, and the finished line is cut where it first leaves the region.
- **`RouteStop` gained `too-tight`**, so "the graph ran out" and "road was there, we refused the turn" stop
  being one number. That distinction is what tells 05 which knob to turn.
- **The turn/speed defaults are stated knobs, not fitted constants** — they encode what the footage should
  look like (D5/D8), not a game formula being approximated, so no `docs/hacks/` entry is owed. The one
  number borrowed from the game's own conventions is the 2.5 m lane offset (`road-cars.ts`).
- **`pathAreaFiles` was extracted** from `road-cars.ts` into the new adapter — both readers of `NODES*.DAT`
  now share one loop and one pair of spellings.

Carried into 02:

- **The link table is fully mutual** (0 one-way links in 30 587 nodes), so travel direction cannot be read
  from it — SA keeps lanes in the navi nodes we do not parse. The autopilot may therefore drive a one-way
  street against its traffic direction; nothing in the data catches it. First field round should look for it.
- **Re-run the validator against `build/original/opensa`.** These numbers came from `game-src/original`
  because no built tree existed on the machine, and the standing rule is that a field run reads the build.
- Only `original` ships a path graph at all — written up in
  [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md).

## Risks / notes

- Link table crosses NODES area boundaries — the synthetic test must cover a cross-area link explicitly
  (the parser already resolves them for the heading hint).
- Node density differs wildly between city and desert; the length target may be unreachable in sparse
  areas — the builder returns its best route WITH its achieved length, and the sequencer (05) shortens
  the fragment rather than looping a bad route.
