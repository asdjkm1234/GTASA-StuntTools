# Map pipeline (DAT / IDE / IPL → streaming world)

`packages/renderware/src/parsers/text/`, `packages/renderware/src/map/`, `packages/game/src/streaming/`,
`packages/game/src/adapters/gta-sa-world.adapter.ts`.

## Implemented

**Text parsers**

- `gta.dat` (IDE/IPL/IMG directives).
- IDE: `objs` (incl. the mesh-count multi-draw-distance variant — max wins), `anim` (IFP name
  kept on `def.anim`), `tobj` (time windows), `txdp` (TXD parents). Other sections ignored.
- IDE flags (`ide-flags.ts`): DRAW_LAST, ADDITIVE, NO_ZBUFFER_WRITE, no-shadow (moot),
  IS_TREE/IS_PALM, DISABLE_BACKFACE_CULLING — full render-relevant set per the flag histogram.
  A GENERATED far-LOD is classified as the model it stands for: the weld's `swayKindFor` retries the wind
  name list with a leading `lod` stripped, because most stock vegetation rows carry no `IS_TREE` bit at all
  (105 of the 184 impostors of the 2026-08-21 build) and the impostor's own name is not on the list — without
  it the tree sways and welds cutout while its LOD stands still in a soft-blend pass (lod-trees plan 013/02).
  NO_ZBUFFER_WRITE (0x40) is applied only to **transparent** materials (decals/shadows/glass, which
  always also carry DRAW_LAST) — opaque geometry keeps depth writes, else bare-0x40 countryside
  terrain tiles show through under a free camera (plan 039 follow-up). In the own-engine pack it is the
  welder's overlay gate (`classOf`): a 0x40 def keeps the compositing BLEND class even when its texture
  is an alpha mask, so a coplanar decal cannot lose its own depth test (plan 092).
- **A material's ALPHA CLASS decides its pass, and it is read from the texels** (`alpha.ts`): opaque,
  `cutout` (alpha-tested, writes depth, A2C renders the edge) or `softBlend` (composites, no depth write).
  `classifyAlpha` reads the histogram against 0/255; `isAlphaMask` reads it against our A2C reference 128 —
  both sides populated, at most a tenth of the sheet ON it — and upgrades a mask out of the blend pass
  whoever draws it. Vegetation additionally requests the upgrade for canopies authored semi-transparent
  throughout, and those (only those) get their alpha sharpened. Vanilla has no classes at all: one pass,
  reference 140/100/0 per entity per frame — the split and its two fitted floors are a documented debt
  ([`hacks/alpha-mask-thresholds.md`](../hacks/alpha-mask-thresholds.md)).
- IPL `inst` (11 columns), interior **area codes** (`interior & 0xFF`, world ids {0, 13}).
- Binary `bnry` IPL streams (full-detail placement) + **standalone script-gated groups**
  (`resolveMap({ extraIpl })`, default `['truthsfarm']`; barriers/carter/crack deliberately
  off — our world-state choice).
- zones (`info.zon`, `map.zon`), water.dat, timecyc(+24h), carcols, handling, vehicles.ide,
  procobj.dat, surfinfo.dat, GXT (CRC-32 without final inversion).

**World assembly**

- `resolveMap`: catalog + timed catalog + txdp + all instances (text + streams + extras).
- `buildWorldGrid`: 250 m cells, HD vs LOD lists (authoritative `IplInstance.isLod` from the IPL
  lod-index targets — the `lod`-name prefix is only a heuristic), exterior filter. Timed (tobj) and
  `lod-always.json` models go into BOTH lists (087 row D: a lod target behind a stub HD — gostown's
  `LODEnsemble*` forests — IS the content and must survive the HD ring).
- Cell building now happens OFFLINE in `tools/opensa-pack` (`weld.ts`): every cell is welded into
  merged per-material batches recorded as render bundles, with per-def IDE-flag treatment, hour-gated
  timed objects as objectTable kind-0 entries, 2dfx corona and emitter collection
  (**both levels** since plan 100 — a LOD bundle reads the baked cell model's own 2dfx section, so a
  district past the HD ring keeps its lamps and plumes), animated `anim`-section objects (per-instance
  groups), road-sign text meshes, procobj clutter. The convert covers the game's `PACK_RECTS.full` rect (per-game since plan 087 — one
  hardcoded ±12 dropped gostown's far islands), auto-fitting to content when a game has no pinned rect.
- Map meshes ignore DFF frame transforms (SA re-frames atomic model infos — junk-frame proof). **True since
  plan 095, not before:** the welder applied the frame chain to every model, and the gate that fixes it is
  the IDE section — `def.anim !== undefined` keeps the chain (an `anim` entry is a CLUMP, which is how a
  windmill's blades sit on their tower), everything else drops it. It has to live in the weld rather than in
  `prepareClumpAtomics`, whose results are cached by model name.
- **Floodlight beams** (`ws_floodbeams`, Vegas site lights): a `white` placeholder texture whose soft cone is
  baked into the per-vertex prelit ALPHA (the only transparency signal). `world-material.isVertexAlphaBeam`
  detects them and `build-clump` keeps the alpha as a vec4 `color` attribute; `buildWorldMaterial` renders them
  alpha-BLENDED (alphaTest 0 — the cone is ~0.2 alpha; no depth write). Without this they were opaque white
  blocks. **ASSUMPTION** (heuristic, not from SA — grep `ASSUMPTION`): "white texture + prelit alpha < 255 =
  beam". A full-map scan verified it matches only the genuine beams (never terrain blends — real textures — or
  foliage — texture alpha); tighten in `isVertexAlphaBeam` if a future model trips it. Tested against the real
  `tests/dff/floodbeams/ws_floodbeams.dff`.
- World streaming is the engine's `StreamingDriver` (see
  [architecture/world-streaming.md](../architecture/world-streaming.md)): HD ring by slot centre, LOD
  ring against the cell's TRUE geometry rect (manifest `aabb`, plan 087 — pivot-welded meshes reach
  past the grid rect), hysteresis + atomic same-slot HD↔LOD swap (the old level stays until its
  replacement is resident), velocity prefetch, manual pin for the map inspector. The swap is atomic by
  FOOTPRINT only because the cell-LOD bake runs on the same 250 grid as the weld (the plan-087
  invariant, pinned by `perfect-map-builder/config.test.ts`). Game-side `packages/game/src/streaming/`
  keeps COLLISION streaming on the 256 game grid.
- Picking/describe: the engine has a ray query — `CellStore.pick` (slab test over the `.oscell` placement
  mapper), and the debugger's Map screen is restored on the engine host (`map-inspector.tsx`, plan 074/22
  phases 7–9). See [zones-hud-debug.md](zones-hud-debug.md) for the current story.

## Known gaps / candidates

- IPL sections `cull`, `enex`, `grge`, `pick`, `jump`, `tcyc`, `auzo`, `mult`, `occlu` ignored.
- Interiors are filtered out entirely (no interior worlds yet).
- `anim`-def draw distance uses the normal HD ring only (fine for the rare props).
- No occlusion culling (SA `occlu`); frustum culling only.

## Test coverage anchors

Parser tests per format; `map/world-grid.test.ts`, `map/resolve-map.test.ts` (extraIpl),
`map/cell-groups.test.ts`, `streaming/grid.test.ts`, `streaming/collision-streaming.system.test.ts`,
`streaming/settle-watcher.test.ts`. Engine-side: `engine/src/stream/streaming.test.ts` (rings,
geometry-aabb decisions, swap atomicity, texture residency, manual pin) and
`engine/src/world/cells.test.ts` (100 %, through the fake `GPUDevice` — plan 077). The bake↔weld grid
invariant: `perfect-map-builder/src/config.test.ts` + `opensa-lod-generator/src/core/grid.test.ts`.
(`build-region.test.ts`, `build-cell.test.ts`, `fade.test.ts` and `streaming.system.test.ts` died with
the three renderer in 074/13.)
