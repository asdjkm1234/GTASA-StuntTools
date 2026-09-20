# 3 — Off the main thread: the hitches are all one shape

Every spike this project has named is the same story — **heavy work executed inside a frame** — and the field
drive proved the render loop is not where the time goes: GPU pass mean 15.64 ms against a CPU render of
0.1–0.6 ms. There is nothing to win in the draw path and everything to win beside it.

The measured contributors, from [plan 091](../../../plans/091-frame-time-attribution/readme.md) and the
093 sweep:

| Cost | Measured | Where it runs today |
| --- | --- | --- |
| COL parse (per cell) | **9.6–78.3 ms** | main thread |
| Rapier body build (per cell) | **5.6–28.1 ms** | main thread |
| `.osm` read + parse (per NEW vehicle type) | worst **20.5 ms** (`bus`), typical 0.5–2 | main thread |
| Cold district entry | first frame 235 ms, then ~20 frames of 110–170 ms | main thread |
| Boot frame | **576.1 ms** | main thread |
| `unattributed` | 40–55 % of a bench spike; on a real drive it is **the CPU waiting on the GPU** | — |

A phone's CPU makes each of these several times worse, which is why this chain sits inside the mobile
bundle rather than beside it.

## 01 — Bake the collision into the pak (the format break, spent well)

The single largest named cost is a **parse of a 2004 file at runtime**. We have our own formats; there is no
reason a browser ever sees a COL.

**Landed: the container, the bake and the runtime read.** `.oscol`
(`packages/engine-formats/src/oscol.ts`) carries a cell's regions — flat vertex/index arrays, primitive
boxes and spheres, the world transforms of every placement, and the per-triangle surface table, with the
writer refusing a surface table that is not exactly one id per triangle. `bakeCellCollision`
(`tools/opensa-pack/src/pack-collision.ts`) produces it, and its test uses the runtime's own
`toModelColliders` as the oracle so the bake cannot quietly disagree with the path it replaces. The pak carries it too: a `collision`
entry kind plus `collisionCellSize` in the manifest, and `opensa-pack --bake-collision` fills them (off by
default — it costs build time).

The read (2026-08-05) is three pieces. `PakCollisionSource`
(`packages/engine/src/stream/collision-source.ts`) fetches an entry's range through the SAME pak worker the
cells use — keys prefixed `collision-` so the streaming driver ignores replies that are not its cells — and
de-dupes concurrent reads of one cell. `bakedModelColliders`
(`packages/game/src/adapters/baked-collision.ts`) re-wraps the decoded regions as the `ModelColliders` the
physics layer already consumes, surface bytes carried straight through. `GtaSaWorldAdapter.loadCellColliders`
asks `has(cx, cy)` FIRST, so a cell with no bake never introduces an `await`, and the COL branch stays
byte-for-byte the path it always was — including its "no span here" reasoning, which only holds while that
branch is synchronous. A baked cell's decode runs in a promise continuation and therefore times ITSELF, as
`cell-collision-decode`.

**Three fallbacks, all quiet by design**: a cell the bake does not cover, a pak built without the bake, and a
failed range read (warned once per key) each parse COL exactly as before. The failure a run must NOT survive
quietly is the grid one, so the adapter throws when the source's grid is not the grid collision streams on —
the restriction's "caught: no" becomes "caught, for the mismatch that has actually happened".

**Reachable from the canonical build, and checkable without one.** `perfect-map-builder --bake-collision`
forwards the flag (off by default — the flag IS the A/B: the same tree built twice, one switch apart, with no
code change on either side), the converter memoizes the shatter gate per model so a full-map bake does not
re-parse the same DFF once per cell, and `scripts/debug/dump-cell-collision.ts` answers "did this pak get a
bake, on which grid, and what is in a cell" from the pak bytes alone. The writer→runtime agreement is a test
(`tools/opensa-pack/src/collision-round-trip.test.ts`): regions → bake → `.ospak` → byte-range read →
adapter, against `toModelColliders`, with no game assets.

**Still to do: the before/after.** Nothing here has been run against a real pak — the claim is a CI fact
until a field capture shows the census without `cell-collision-read`-shaped work on a cold district entry.
The field procedure is in [development/mobile-pak.md](../../../development/mobile-pak.md): build both paks,
drive the same district, read `cell-collision-decode` and the `collision` block. **The map inspector's "Show
collision" wireframe draws whatever `loadCellColliders` returned**, so on a baked pak it is a direct picture
of the bake — the fastest way to see a wrong-grid bake, which lands the outlines beside the geometry.

**The breakable gate followed the same day** (`.oscol` **v2**). The runtime's gate opens a model's DFF to
look for a shatter mesh — an archive read on the one path this bake exists to keep out of the archive, and on
a streamed run the LAST reason the collision path opened a DFF at all. So the writer resolves it, with the
same expression the runtime uses over the same lowercased region names, and writes one instance key per
placement: **present = breakable, absent = not**, no third meaning. That is also why v1 is refused rather than
read — a v1 file's breakability is unknown, and reading it as "nothing shatters" would ship a world whose
bins and lamp posts quietly stop breaking. An unreadable container falls back to COL, saying so once per
distinct reason.

The test that keeps it honest counts ARCHIVE reads: a baked cell must open nothing (verified by re-adding the
runtime tagging — the test fails with `[ 'baked_road.osm' ]`).

**What the read still does NOT remove:** the procobj scatter binds COL regions per cell (it is seeded from the
cell's own collision surfaces and its density is a LIVE knob), so `buildCollisionIndex` stays alive on any run
with clutter colliders on. That one is a step of its own and is parked as a
[performance lever](../../../performance/deferred-optimizations/procobj-scatter-bake.md) until a capture asks
for it.

**The grid is the trap, and it is recorded as a restriction**: collision streams on `GAME_CELL_SIZE` (256)
while the pak's render cells are 250. A bake keyed on the render grid hands back the *wrong* cell's
colliders and reads in the field as a physics bug.

- `opensa-pack` parses COL once, at build time, and writes the cell's collision as ready-to-transfer
  vertex/index buffers plus the per-triangle surface table.
- **The data must survive intact.** A baked collider that loses the surface id is a data regression however
  fast it loads — `p_grassmid1 ×0.71` under the wheels is authored design, and `SAND`/`ROUGHNESS` are the
  columns we still owe ([offroad-feels-like-tarmac](../../../open-issues/offroad-feels-like-tarmac.md)).
- Keep the parry back-face encoding in mind when baking triangle ids: a hit on the back of a triangle comes
  back as `featureId + triangleCount`, and the game's roads are wound so a downward ray lands there. Whatever
  the bake writes, the runtime lookup still takes it modulo the triangle count — and the regression fixture
  must wind its quad *away* from the ray or it passes while the game fails.
- Expected: `cell-collision-read` disappears from the census. Measure, do not assume.

## 02 — Cell collider assembly, budgeted — SHIPPED 2026-08-04 (unmeasured)

With the parse gone, what remains is building Rapier bodies (5.6–28.1 ms).

**A worker cannot take this one.** Rapier's bodies live in the physics world's wasm heap on the main thread;
there is nothing to build elsewhere and transfer. So the step became what the same problem became for
textures: `beginStaticColliders` makes the build resumable and `CollisionStreamingSystem` drains it under a
per-frame allowance, turning one spike into slices. Details and the price:
[the applied lever](../../../performance/applied/collider-build-budget.md).

The two rules it had to keep: a cell is not `loaded` until its build is whole (the restriction below), and an
abandoned build removes exactly the bodies it created. Both are pinned by tests.

**Unmeasured**, like 3/01 — the budget constant is borrowed from the texture drain, and what this really
spends is streaming MARGIN, which is what the field round must look at rather than the mean.

- The handover is budgeted like the texture drain: a cell may not land in one frame if it costs more than
  the allowance.
- **The restriction to respect:** a dynamic body may only be *created* where its static collision already
  exists — a streamer gating on its own radius spawns cars into a hole
  ([restrictions/architecture.md](../../../restrictions/architecture.md)). Deferring collider assembly
  moves that ordering constraint; the spawn gate follows it or parked cars free-fall again.

## 03 — `.osm` parse into the worker — DELIBERATELY NOT STARTED

Per *new type*, worst 20.5 ms. The field drives say it never lands on a slow frame when types arrive one at a
time — so this is not urgent on desktop, and it is exactly the kind of cost a phone converts into a stutter.

Two things changed its footing, and both say wait:

- **02 did not build a transport.** It turned out a worker cannot take the collider assembly at all, so the
  "cheap once 02 has built the transport" assumption is void — this step now needs 04's transport first.
- **Nothing has demanded it.** By this bundle's own rule, a step justified only by a phone is a step that
  waits for a phone measurement. Starting it now would be building against an estimate.

## 04 — The worker transport: `crossOriginIsolated` as progressive enhancement

- One worker pool, two transports: **SharedArrayBuffer + Atomics when the page is cross-origin isolated**,
  structured clone + transferables when it is not. Same code path, same results, different latency.
- The engine must not *require* the headers. Requiring them is a deployment and embedding constraint, and it
  would silently degrade any host that cannot set them — the failure mode being "slower", which nothing
  catches.
- **Same change, when this lands:** a row in `docs/restrictions/` — what may and may not be assumed about
  isolation, and what breaks (silently) when a host does not provide it.

## 05 — The physics step in a worker (gated on 04)

The big one, and the one with a real chance of being refused.

- Requires a fixed-step contract with the renderer and a transform ring buffer; the render side already
  interpolates camera position (the [camera-position-render-interpolation
  lever](../../../performance/deferred-optimizations/camera-position-render-interpolation.md) was
  PULLED on 2026-07-25), which is the same problem solved once already.
- The measured budget it has to beat: the vehicle slice is **7.6–9.5 µs per car**, 0.6 ms at 80 cars — i.e.
  the physics step is *not* currently a frame problem on desktop. So this step is justified by the phone or
  by 0.5.0's city-life population, and by nothing else. **If the phone measurement does not demand it, it
  does not ship** — an improvement nobody can point at is an opinion.
- Watch the known trap: a Rapier body is born **massless** and its mass properties fold in at the next
  `world.step`; anything that reorders stepping re-opens
  [that crash](../../../open-issues/fixed/map-car-generators-poison-physics.md).

## 06 — Re-run the census after every step

091 exists for this. `unattributed` was 40–55 % of a bench spike and, on a real drive, turned out to be the
CPU waiting on the GPU. As main-thread costs leave, that ratio changes meaning — and a step that moves work
without moving the census has not been demonstrated.

## Acceptance

- A cold district entry shows **no main-thread contributor above the frame budget** in the `[slow]` census.
- The boot frame's 576 ms is decomposed and reduced, with the residual named.
- Desktop steady state is neutral (this chain buys smoothness, not throughput — the same shape as the
  texture-upload fix, which measured neutral averages and won on the census).
- A non-isolated host still runs, measurably slower and never wrongly.
