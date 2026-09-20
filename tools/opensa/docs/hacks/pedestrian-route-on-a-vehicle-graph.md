# Pedestrian route on a vehicle graph

**Live.** Taken 2026-07-31 with plan 096/07 (video mode's walk scene).

## What it is

`apps/web/src/ui/video/walk.ts` + the walk scene's route constraints in `engine-video-runs.ts`:

```ts
export const WALK_LANE_OFFSET = 6.5;  // m right of the ROAD CENTRE — "roughly where a pavement is"
const WALK_ROUTE = { laneOffset: WALK_LANE_OFFSET, maxTurnDeg: 100, maxWindowTurnDeg: 200, preferTurnDeg: 40 };
export const WALK_GROUND_DROP = 3;    // no ground within this below a waypoint ⇒ the route is rejected
```

A showcase walk is a DRIVING route pushed 6.5 m to the right of the carriageway and walked. The lane offset
is the whole of the "pavement": there is no pavement in the data, only a number that usually lands on one.

## What it stands in for

SA's own pedestrian paths. The game ships them and **we skip them on purpose, having already counted them**:
`packages/renderware/src/parsers/binary/paths.ts` reads the area header as
`[nodes, vehNodes, pedNodes, naviNodes, links]`, notes that the file stores "vehicle nodes first, ped nodes
after", and then loops `for (index < vehicleNodes)` — the ped nodes are bytes the parser walks past to reach
the link table (`:89`, "ped nodes skipped"). SA's peds walk a real pavement network with crossings, and it is
sitting in a file we open.

The honest fix is therefore smaller than "parse the ped paths": the offset is already computed and the count
is already read. What is missing is a second node list on `RouteGraph` and a link table for it — plus whatever
the ped links mean, which nobody here has looked at yet. It simply was not what 096 was about.

## What it was judged on

A headless walk scene in San Francisco (seed 47, scene 8, 2026-07-31): a 160 m route, 62 of 82 waypoints
ground-probed (the rest outside the streamed collision ring), 0 rejections, the ped walked the whole thing
and the five cameras all framed him — `safe: 1.000` over 3 844 judged frames. That is the instrument saying
"a person walked down a street and was in shot". It is not a human saying the route looked like a pavement —
so it was watched: **field verdict 2026-08-01, the walk scene looks good.** That is what the hack is now
judged on, and it is an eye on the scenes that played, not a proof about the ones that have not.

Two things it is known NOT to handle:

- **Furniture.** The ground probe rejects verticality — a waypoint over water, a bridge parapet, a void — and
  nothing else. A route that clips a bench, a lamppost or a set of building steps passes every check we have.
- **Anything the road has no pavement beside.** A tunnel mouth, a freeway shoulder, a desert verge: 6.5 m
  right of the centreline is dirt, a wall, or a drop. The ground probe catches the drop and not the other two.

## What would retire it

Reading the ped nodes the parser already skips over and giving `route-graph.ts` a pedestrian graph to walk.
The walk scene would then ask for a route the same way it does now, and this file's three constants would go
with it — `laneOffset` included, because a ped node already IS on the pavement.

## What else moves if it changes

- The walk scene's route length is derived from the ped's configured `walkSpeed`, not from this; a pedestrian
  graph changes WHERE the route goes, not how long it is.
- `WALK_STATION_LATERALS` (2.5-8 m) are measured off the walked line. On a real pavement network the same
  numbers mean the same thing, so the tripods carry over unchanged.
- The ground-probe rejection stays useful either way: a ped node over a collapsed piece of collision is still
  a route nobody can walk.

See also `docs/edge-cases/route-graph.md` (what the graph does and does not carry) and
`docs/features/video-mode.md` (the scene that uses it).
