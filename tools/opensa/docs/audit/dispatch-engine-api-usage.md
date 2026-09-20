# The dispatch console against the engine's own API — what it was not asking for

**2026-08-09.** Written after the second field capture reported a 1068 ms frame with no owner, and the fix
turned out to be a number the engine had been computing since 074/01 and the console was throwing away.
That is not a one-off: this is the sweep of the whole public surface, so the next gap is found by reading
rather than by a field run.

Method: every export of `packages/engine/src/index.ts`, every public member of `Engine`, `CellStore`,
`TextureArrays`, `StreamingDriver` and `Resources`, against what `apps/dispatch` actually calls.

## Taken during this audit

| Capability | What it answers | Where it landed |
| --- | --- | --- |
| `StreamingDriver.update()`'s **return value** (`StreamStats`) | `blobMs` / `worstBlobMs` — the worker's message handler, decode and `createTexture`, which run BETWEEN frames where no in-loop timer can see them; `uploadMs`, creates, evictions, `lateCreates` | the console kept only `pendingCells` and dropped the rest. Now in the report as `streaming`. The game shell has read these since a 2026-07-27 field report of 20-250 ms frames turned out to be whole-array uploads at 15-85 ms a call — **the same shape of question the map profile's 1068 ms body is** |
| `Engine.ledger()` (`Resources`) | resident GPU bytes **by category** — `texture`, `cellVertex`, `cellIndex`, `target`, `uniform` — with counts | the report said `148 MB` and nothing else, against a pak whose whole texture ceiling is 99.7; the 48 MB had no owner. Now in the report as `world.byCategoryMb`. Note `target`: render targets are a cost of RESOLUTION, not of content, which is a different lever entirely |

## Found, not taken — with the step that wants each

Nothing here is a defect. It is capability the console has not needed yet, recorded so a later step does not
build a second version of it.

| Capability | What it is | Who should want it |
| --- | --- | --- |
| `StreamingDriver.setManualCells(cells, lod)` | pin an explicit cell set, bypassing the rings, keeping the frame budget and the atomic HD↔LOD swap | **[1/05](../plans/201-dispatch-console/1-the-map-profile/readme.md)** (the streaming profile) and every capture after it: a run with a PINNED cell set is an A/B without camera variance, which is what both 08-09 captures lacked. Also the baked-3D mode in [6/01](../plans/201-dispatch-console/6-display-modes/readme.md) |
| `StreamingDriver.listCells()` | every cell the pak offers, in GTA cell coords, independent of what is resident | the minimap in [7/04](../plans/201-dispatch-console/7-the-operator-map/readme.md), and a district/pak coverage check that is currently a hand-written rect in `districts.ts` |
| `StreamingDriver.unloadAll()` | tear down every loaded cell; the leak-assertion hook | [4/02](../plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md), the long-session step — a residency figure means much more beside the baseline it returns to |
| `TextureArrays.setMissingHighlight()` | paint missing-texture stand-ins magenta on demand (085 row B) | a data-QA affordance for the operator surface; also the honest answer to "is that grey building missing a texture or authored grey?" |
| `CellStore.hidePlacement()` / `breakPlacement()` | hide or smash one placement by id | nothing yet, but it is the mechanism a map would use to grey out a building or mark a structure |
| `Engine.createDebugLines()` / `updateDebugLines()` / `setDebugLinesVisible()` | a persistent line set drawn in world space | the streaming rings, the cell grid and the measuring tools in [7/05](../plans/201-dispatch-console/7-the-operator-map/readme.md) — the map currently has no world-space line primitive of its own |
| `Engine.debugViewMode()` + the `debug*` environment switches | unlit / normals / prelit-scale views | [5/01](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md) is already about taking picking OFF a `debug*` flag; these are the same family and the same caution applies (a production surface may not stand on one — [restrictions/architecture.md](../restrictions/architecture.md)) |
| `GpuTimers` | per-pass GPU timestamps, double-buffered | unusable on the target phone (no `timestamp-query`) and available on a desktop: the ONLY way this chain gets a real GPU column, on hardware that is not the target |
| `PakCollisionSource` (handed over by `setupStreaming`) | the baked collision the pak carries | nobody, and that is now a measured fact rather than an assumption: the 08-09 bytes capture recorded **zero** collision requests. It is [1/03](../plans/201-dispatch-console/1-the-map-profile/readme.md)'s omission candidate |
| `frustumFromViewProj` / `frustumIntersectsSphere` | the engine's own culling maths | the symbology layer culls by projecting each unit; at 150 units [5/02](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md) may want the cheaper test the renderer already uses |
| `IfpSampler`, `RigidEntity`, `createVehicleModel` / `createVehicle` | skeletal animation, rigid entities, the vehicle model path | [5/04](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md), where units stop being symbols and become cars and peds. The console draws no model today; the engine has carried the whole path since 081 |

## The pattern worth keeping

Both taken items have the same shape: **the engine already measured it, the console discarded it at the
call site.** `update()` returned a struct and one field was read; `ledger()` was never called at all. Neither
gap was visible in a code review of the console, because nothing there looked wrong — the missing thing was
in what the engine offered, not in what the app did.

So the check that finds this class of gap is the one above: read the provider's surface, not the consumer's
code. It is worth re-running whenever a chain starts asking a question its instrument cannot answer.
