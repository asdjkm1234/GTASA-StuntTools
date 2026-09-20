# Plan 087 — the gostown field round (TC bugs after the first full boot)

The first TC to boot end-to-end (2026-07-23: player model, collision sweep, per-game draw distance,
hole-fill in the cell bake, phase-8 layout all landed the same day) surfaced its own field-bug batch.
Same method as 085: symptom → source asset → pipeline stage → pak bytes → shader; inspectors in
`docs/debug/README.md`.

## Rows

### A+B — lod cells missing from RING streaming (CLOSED 2026-07-23 night — field-verified on the 250-bake pak)

**Field discriminator (user): pinning the whole map with "Show LODs" renders EVERYTHING — the bridge,
the islands, no holes, no console errors.** Diagnosed OFFLINE from the pak bytes + `lods.ipl` (no
instrumentation needed — `scripts/debug/stream-ring-bounds.ts` is the verifier). THREE stacked root
causes, none of them the ring state machine (suspect 2, eviction pressure, is ruled out BY CODE:
inside the 3000 u gostown ring nothing ever evicts — there is no residency target at all):

**Root cause 1 — the pak convert CLIPPED the map.** pmb's `pack.rect` was hardcoded `[-12,-12,12,12]`
("covers the whole map" — true for SA, false for a TC). Gostown content occupies cells x −8..37,
y −16..5; **95 of the 374 baked lod impostors (and every hd cell beyond ±12) were silently dropped**
— the far islands never existed in the pak at ANY level. That part of row B was unfixable by any
streaming logic. → FIX: the rect is now optional everywhere (pmb config / `packGameDir` /
`convertDistrict` / CLI `--rect`); the default auto-fits the occupied world grid (`occupiedRect`).

**Root cause 2 (measured mechanism; the fix was ROLLED BACK — see the user decision below).**
The 256-grid bake vs the 250-grid pak = two DIFFERENT partitions of the plane: an impostor (baked per
256-cell, anchored at that cell's centre) welds whole into the 250-slot of its anchor, so a slot's lod
footprint ≠ its hd footprint. Promoting a slot to HD unloads lod coverage that spills into neighbours
still at LOD range → holes that WANDER with the HD ring. Measured at the gostown spawn (slot 5,−6
centre is 187 u from spawn → HD): its lod spans z 1266..1731 (holds the paradise-bridge far span),
its hd only z 1233..1351; the neighbour 5,−7 sits 386 u away (> 380 HD ring) and its lod starts at
z 1646 — **the bridge span z 1351..1646 is covered by NOTHING**; ±10 u of walking flips 5,−7 across
the HD edge and the hole moves. The grid mismatch also produces the paired hd-only/lod-only slot
columns (31 hd-only vs 20 lod-only slots: `-4,y`↔`-3,y`, `11,y`↔`10,y`, `y=-11`↔`y=-10`…).
**Status history:** the 256→250 re-alignment was first reverted (user: 256 looked deliberate — it WAS,
for the three-era streaming grid, which was 256; plan 002's real invariant is bake = STREAMING grid) —
then **RE-APPLIED after the first rebuild field-confirmed the mechanism** (below). Collision streaming
and procobj scatter keep `GAME_CELL_SIZE` 256; only the bake's `lodCellSize` moved to 250.

**Field confirmation (first rebuild, pak `20:20 23-07-2026`, 757 cells).** Rect fix ✓ (islands in,
extent `[-8,-16,37,5]`); hole-fill b/c ✓ in the bake (`5,-7,lod` 15 621 → 26 348 verts, `5,-6,lod`
50 627 → 51 032) — **and the spawn bug persisted exactly as this root cause predicts**: span a's HD
sits in slot 5,−7 (pak pivot on 250: floor(−1522/250) = −7) while its verbatim LOD sits in slot 5,−6
(bake pivot on 256: floor(−1522/256) = −6). At spawn 5,−6 is at HD (its lod unloaded) and 5,−7 is at
LOD (its hd not loaded) → the span exists in NEITHER loaded level; a few steps promote 5,−7 → HD and
it appears (user screenshots 20:21). Second field case, non-bridge: a shore hole at GTA
(1514.3, −1498.4), F2-picked as `lod_5_-6` — the point lies in slot 6,−6 territory, its far
representation lives in `lod_5_-6` (unloaded, slot at HD), its HD owner slot 6,−7 was at LOD. Plain
terrain, same split — the mechanism is map-wide, not a bridge quirk.

**Root cause 3 — the ring tests the GRID rect, but geometry is welded by PIVOT.** Measured overhang of
true vertex XZ AABBs beyond the slot rect (gostown pak, 2026-07-23): hd mean 127 u / p90 171 / p99 339 /
max 799; lod mean 141 u / p90 215 / p99 339 / max 799 (worst: `4,-9` — one mesh spans x 245..2049 in a
250 u slot). With `FOG_RING_MARGIN = 100` any overhang > 100 u can hold geometry visible inside the fog
while its slot is still outside the ring (matters most for original's 1200 u ring — likely the 078
in-game LOD finding). → FIX: the manifest cell entry gains `aabb` (world XZ, from the weld's bucket
bounds, verified against the pak-measured bridge cell to ±1 u rounding); `StreamingDriver` now tests
the level's TRUE rect for LOD desire, the union of level rects for eviction, and the created level's
rect for the late-create honesty metric. Pre-`aabb` paks fall back to the grid rect. HD stays a
centre-distance quality ring.

**The bridge MODEL story (decoded 2026-07-23 night — corrects row A's history below).** The merged
build's `Gp_City.IPL` DOES place the authored `LODParadiseBridgea/b/c` (draw distance 2500) and links
them properly (the HD instances carry lod indices 194/195/196 → those text lines) — the old "defined
but never placed, IPL lod = −1" claim was wrong. What actually happens in the opensa chain:
`stripLods` removes the authored LODs (they are lod-targets), the cell bake's reduction then eats the
replacement impostors' bridge geometry, and only span **a** was exempted via `lod-holes.json`. So the
pak's far bridge = verbatim span a inside `5,-6,lod` only; spans b (HD draw 100!) and c have NO far
representation at all — "the main span pops at its ~190 u HD draw; a SECOND span IS visible far" was
exactly this. **User field addendum:** at spawn the missing span starts ~80 u away (HD range!) — that
is the root-cause-2 geometry above (span a+b HD lives in slot 5,−7 which sits 6 u outside the 380 HD
ring; the lod that should mask the band is hostage to 5,−6's HD promotion) COMBINED with b/c simply
absent from the lod bake. → FIX (data): `mods-src/gostown/lod-holes.json` now lists
`gp_paradisebridgea/b/c`; pivots — a (1494,−1522) slot 5,−7 · b (1478,−1664) slot 5,−7 · c
(1509,−1351) slot 6,−6.

**Per-game rects (user directive).** One hardcoded map rect is gone for good: pmb `PACK_RECTS` maps
game id → named rects — `full` (what the pipeline passes: original `[-12,-12,12,12]`, gostown
`[-8,-16,37,5]` measured this round) plus pinned debug/bench districts (original `ls = [8,-9,11,-5]`,
the 074/11 bench scenes). A game without a `full` entry auto-fits to content (`occupiedRect`);
`config.pack.rect` stays as a per-run override, CLI `--rect` for standalone subsets.

**CLOSED — second rebuild (250 bake, pak `20:40 23-07-2026`, 764 cells) field-verified by the user:
the spawn bridge renders and the shore holes are gone.** `stream-ring-bounds.ts` confirms structurally:
hd-only/lod-only slot pairing 31/20 → **4/0** (the 4 are legit empty-bake cells), lod overhang now
mirrors hd (mean 130.4 vs 129.0, p90 identical) — the systematic 256-grid spill is dead, only
object-level overhang remains and the manifest-`aabb` ring covers exactly that (the script's one
remaining "grid-rect would skip" cell from spawn is the case the aabb test now catches). `5,-7,lod`
aabb == `5,-7,hd` aabb — span a shares its slot across levels. Original inherits all three fixes at
its owed rebuild (its 078 in-game LOD anomalies were almost certainly this same class).

### A (history) — the paradise bridge bake side (superseded by the model story above)

**NB the premise here was WRONG** — the authored `LODParadiseBridge*` ARE placed and lod-linked in the
merged `Gp_City.IPL`; they vanish because `stripLods` removes lod-targets and the bake's reduction ate
their replacement (see "The bridge MODEL story" above). Kept as written for the history of the trap:

`gp_paradisebridgea` (44 784 verts of trusses/cables, IPL lod = −1, its authored `LODParadiseBridge*`
defined but never placed) vanished from the far view. The hole-fill exemption
(`mods-src/gostown/lod-holes.json`, plan 086) IS in the rebuilt bake — `lods.img` `lod_5_-6.osm` is
2.8 MB (the bake grid is **256**, so the bridge's cell is `5,-6`, not the pak-grid `5,-7` — a
comparison trap that cost an hour). Field: the main span still pops only at its 190 u HD draw; a
SECOND span IS visible far, so part of the family already rides the lods. Next: in-browser evidence —
console errors at cell create, F2 map inspector pinning lod cells `5,-6 / 6,-6 / 5,-7` (their welded
verts: 50 627 / 84 239 / 15 621; the engine handles uint32 indices, weld has no 65 535 cap — both
checked). If the pinned cells draw the bridge, the streaming path is fine and the miss is elsewhere
(group class? distance?); if not, decode the welded positions.

### B — part of an island not streamed at range; a lone tree floats where its ground should be (CLOSED with A+B)

Screenshot 2026-07-23: a chunk of a far island absent while a palm renders mid-air over the water.
Explained by the A+B root causes: the islands beyond cell ±12 were clipped out of the pak entirely
(root cause 1), and the palm-over-nothing pattern is the partition mismatch (the palm's anchor slot
loaded while the terrain's lod coverage lived in a different/absent slot — root cause 2). Re-check in
the field after the rebuild; only if a hole survives does this become its own row.

### C — black stripes on the water (FIXED IN CODE 2026-07-23 night; rides the next rebuild)

Long parallel dark bands across every lake. Field discriminator (user): **static, hour-independent**
— killed the sun/time suspects. Pak bytes told the rest (`scripts/debug/water-depth-map.ts`): the
BAKED DEPTH FIELD ITSELF is striped — periodic shallow columns run across the whole bridge/dam lake
region. Root cause: gostown's elevated lakes (z≈539) sit far above the height grid's `Z_CAP = 4`, so
their depth is the PSEUDO path — distance to the nearest "shoreline" × 0.15 — and `boundaryEdges`
mis-detected every interior water.dat seam as a shoreline: a TC's water grid is not endpoint-aligned
(one long quad edge meets TWO shorter neighbours — T-junctions), so the endpoint-key pairing never
matches and each seam counts as a boundary. Depth dips toward ~0 along each seam → the shader's
`shallow` term (brighter + alpha down to 0.4) paints a static band over the dark lakebed → the
"stripes". FIX (water.ts): every unpaired candidate edge is re-checked by a TWO-SIDED COVERAGE probe
(3 samples along the edge, ±1 u across it): water on both sides at the same level (±3 m) ⇒ interior
seam, dropped; a reservoir lip above lower water keeps its shoreline (the level gate). Verified
offline: re-baking the real gostown `water.dat` turns the striped field into a smooth basin (shallow
at true shores, deep mid-lake). Tests: T-junction seam ≠ shoreline, dam lip stays one. Needs the next
`build:game:gostown` run to reach the field (water.bin only).

Related but NOT ours: the dark pipe/structure shadows on the dam wall itself are painted into the
authored gostown textures (user-confirmed baked content).

### D — forests vanish at LOD range; trees unpickable (FIXED IN CODE 2026-07-23 night; rides the next rebuild)

User: gostown trees have no generated lods (example area `gp_land71`, the island at GTA 809,−1074).
Pak bytes: the island's hd cell holds NO tree placements at all, and `lodensemble*` exists NOWHERE in
the pak. Gostown's forests use the **stub-HD/real-LOD pattern**: `fakebit01` (24 verts, draw 65) is
the placed HD whose lod link points at `LODEnsemble1–5` (~112 tris each, draw 2000) — the ensemble IS
the forest. Our chain assumed lod-targets are replaceable stand-ins: `stripLods` deleted them and the
cell bake "replaced" them with a bake of the HD side — the stub. Forests gone at every level; that is
also why the picker had nothing to hit. `lod-holes.json` cannot fix this class (hole-fill exempts
models the bake MERGES — these never reach the merge). → FIX: **`lod-always.json`** (per game, like
lod-holes): lod-target models that are the real content — the strip keeps them (`keepLods` →
`stripOldLods` exclude) and `buildWorldGrid` welds them into BOTH levels (like timed instances;
per-slot level exclusivity keeps them single-rendered; the impostor bake still skips lod-targets, so
nothing double-bakes). `mods-src/gostown/lod-always.json` = lodensemble1–5. Individual palms
(`gp_petitpalm1` ×91 cells, ~800 tris) are real HD placements that DO reach the impostor bake — if the
field still misses single palms at range after the rebuild, THEY go to `lod-holes.json` (reduction),
not this list.

### E — map-inspector hide crashed on writeBuffer alignment (FIXED 2026-07-23 night)

`hidePlacement` → `OperationError: Number of bytes to write must be a multiple of 4`: `alignedErase`
clamped its window to `indexData.byteLength`, and a u16 cell with an ODD index count ends on a 2-byte
boundary — hiding a placement at the buffer tail produced a 2-byte-short write that WebGPU rejects.
The GPU index buffer is `align4`-padded, so the window now legally runs into the pad (the clamp is
gone; the tail READ is still clamped). Same helper serves `breakPlacement` — tail-end smashables were
silently refusing to break too. Test pins the odd-count tail case.

### F — terrain brightness seams (`gp_land112` dark vs `gp_land110` light) — AUTHORED, lever ready

Measured (getClump, identical in `game-src/gostown` AND the optimized `build/gostown/sa` — the
optimizer changed NOTHING): `gp_land112` day prelit averages **50/50/50**, `gp_land110` **88/87/87**;
neither ships normals. Not a map-optimizer bug — the prelight pass's preserve-authored gate correctly
kept both; the AUTHORS baked adjacent land pieces at different light levels. The existing lever if the
seams should go: list the dark models in `mods-src/gostown/broken-prelight.json` (the optimizer's
prelight FORCE list) and rebuild — user's call, since it overwrites authored shading.

## Closed the same day (2026-07-23)

- Player model from `GAME_CONFIG.mainCharacter` (gostown → BMYCG) — boots.
- Collision: the world col/ipl sweep covers override archives — gostown collides.
- Far islands: per-game `drawDistance` (gostown 3000) — confirmed better in field.
- Boot clock from `GAME_CONFIG.loadGame.startMinutes` (gostown 12:00; original keeps 22:00) — the
  host's hardcoded NIGHT_HOUR ignored the config until now.
- Phase-8 layout: `opensa/` self-contained (pak at `pak/`), `opensa-pack/` = the fetch build,
  `build:game:*` chains both; `npm run fetch:pack` alias deleted (redundant).
