# Converter-pipeline edge cases

Boundaries of opensa-pack / perfect-map-builder / map-optimizer / the LOD generators.

- **Node cannot read a file past 2 GiB, and cannot write a buffer past it either.** Measured directly on
  Node 24.15 (2026-08-15): `readFileSync` of a 3.2 GB file throws **`ERR_FS_FILE_TOO_LARGE`**;
  `writeFileSync` of a 2.2 GB buffer throws `ERR_OUT_OF_RANGE` (`"length" … <= 2147483647`). What still works
  is the **positional** API — `writeSync` at a 3 GiB offset and `ftruncateSync` past 2 GiB both succeed — which
  is why `writeImgFile` (entry-at-a-time, through a descriptor) can produce an archive that `readFileSync`
  cannot then open. This is a HOST limit, not a game or format one: VER2 addresses entries in uint32 sectors
  and has room for terabytes.
  Hit for real on 2026-08-15: the `sa` build died mid-`vehicles` at 2 168 825 856 B, because
  `vehicle-installer` rebuilt the whole `gta3.img` per car (212 of them) through `writeFileSync`. The numbers
  that make it structural rather than a one-off — gta3.img after `mods` is 1 242 236 928 B and the mod vehicle
  payload is 3 077 354 628 B over 752 dff/txd, so the finished archive is ~4.32 GB. The installer inflates
  nothing: cumulative source through the car it died on was 916 181 801 B against 926 588 928 B of observed
  growth, a 1.1 % delta that is VER2 sector padding.
  `tools/opensa-pack/src/game-fs.ts` (`openLazyVer2`) is the one fd-backed reader that already exists for this
  reason — its own comment records the converter having been unable to read its own output once.
  Hit again on 2026-08-17, one stage later: the pack's `rewriteModelArchives` rewrote each `models/*.img`
  on its own, and the `.osm` a car becomes (private `TEXS` inside) is fatter than the dff+txd it replaces —
  `vehicles.img` (1.87 GB after the install spilled into `vehicles2.img`) crossed the 1.75 GiB cap at the
  152nd of 406 entries and the writer, correctly, removed the half-written file. Fixed by rewriting per
  FAMILY (`openImgFamily` → `writeImgFamily`, siblings registered/un-registered): every grower of an archive
  has to be family-aware, not just the installer that first spilled it.
- **Node heap ceilings.** A full pmb build **or a standalone `opensa-pack` run with AO on** needs
  `NODE_OPTIONS=--max-old-space-size=12288` (the cell bake holds the mod-grown ~1.3 GB `gta3.img` + merged
  cells); the default 4 GB dies around 37 % of the AO bake. sa-lod-generator needs ~8 GB. The full map cannot
  weld in one heap — welding is chunked.
- **A mod replacing a `.col` deletes every collision model its copy omits.** The IMG contract replaces an
  entry whole, and a `.col` is a LIBRARY of named models — so a partial copy silently strips the rest. Found
  2026-08-10 on the shipping mod set: `laxref.col` 148 → 147 models, losing `ferseat01_LAx` +
  `LODseat01_LAx`, because mod 60 installs last and its copy lacked them. **Map-wide damage was exactly
  those 2 of 216 archives' models** — bounded, but invisible: an object with no collision looks normal and is
  merely walk-through. The installer now WARNS with the names (`N collision model(s) LOST`); nothing catches
  it at runtime except FLA's optional error box, which is how it surfaced. Contract + author rule:
  [`contracts/mods.md`](../contracts/mods.md).
- **Map objects have no standalone `.osm` texture set.** Only by-name classes (peds, vehicles, props,
  breakables, clutter) carry private `TEXS` dictionaries. Map objects are `textureSource: 'world'`
  (`DESC + GEOM` with global refs into the pak's shared dictionary — ~400 MB shared vs ~3.7 GB per-model) —
  such a model is **not viewable standalone**; the object/compare viewer skips that side and says so. At
  runtime a submesh whose world array hasn't streamed in is skipped, not drawn.
- **Vehicle `.osm` path degrades doors + mesh COL** — both are DFF-only today; a vehicle DFF with no
  embedded COL falls back to a box hull collider.
- **Unconditioned (vanilla) maps convert with bad lighting — run map-optimizer first.** 12,004 of 12,964
  vanilla world models ship no normals; the converter's naive fallback produces polygon-shaped light patches
  (it warns when >10% of world models take it; synthesis is map-optimizer's job).
- **map-optimizer refuses geometry it can't provably remap** — skinned, multi-UV, or multi-morph geometry
  is skipped per-asset on any count-changing pass rather than corrupted.
- **We weld EVERY atomic of a simple map model; SA keeps one.** `CFileLoader::SetRelatedModelInfoCB` calls
  `mi->SetAtomic(atomic)` for each atomic of the clump into the same single slot (a `_dam`-suffixed frame goes
  to the damaged slot instead), so an `objs`/`tobj` model ends up with only the LAST atomic and the rest are
  dropped. Measured over the merged original map: **41 multi-atomic placed models, 47 894 welded triangles
  across 82 instances the real game never draws** — leftover xref helpers such as `sprasfw`'s stray
  `xenonsign_SFw` (1772 tris), `desn2_stripsigs1`'s `des_cowtail` (17 163) and `des_bigbull`'s `des_bulltail`
  (4226). In 29 of the 41 the surviving atomic is the one whose frame is named like the model, which is why
  the picture still reads right. **Not fixable by "keep the last atomic":** the same set holds the animated
  props (`nt_windmill`, `derrick01`, `nt_noddonkbase`, `a51_radar_scan`), which are `anim` IDE entries that
  SA loads as CLUMPS and whose extra atomics are the moving parts — so any fix needs the IDE-section gate
  that [plan 095](../plans/095-dff-geometry-parity/readme.md) added for the frame transform. Forensics:
  [`open-issues/fixed/mod-dff-winding-and-atomic-frame.md`](../open-issues/fixed/mod-dff-winding-and-atomic-frame.md).
- **Two-sided world geometry breaks smooth-group normals.** SA's world is heavily two-sided (mirrored
  coplanar pairs); where incident faces cancel, faces degrade to flat shading and
  `sanitizeDegenerateNormals` substitutes an arbitrary face — sometimes pointing down.
- **Prelit is dark and load-bearing.** SA bakes map lighting into the _dark_ prelit set (mean luma 88/255);
  dropping it renders ~3× too bright. Night synthesis is gated on a model actually having prelit; ONE
  `NIGHT_AMBIENT` formula must be shared across weld/rigid/clutter paths.
- **QEM must be UV-drift guarded.** GTA roads tile V as per-segment patchwork; unguarded collapses smear it
  into lengthwise stripes (`maxUvDrift`). Never flip windings — a wrong flip is a hole.
- **Gamma vs linear TXD split.** Real SA (D3D9-era RW) multiplies/filters texels in GAMMA, the own engine in
  LINEAR, and the conversion isn't per-pixel invertible — atlases are encoded per target (gamma into the
  real-SA build, a linear sidecar swapped into the OpenSA img). **And never bake a lighting LEVEL into a
  texture the engine lights again** — bake a normalized atlas and carry prelit/night on vertices, so unknown
  pipeline multipliers (skygfx etc.) cancel; a level baked into texels breaks under any of them.
- **LOD bakes must exclude exactly what the engine excludes** — timed (tobj), interior, `lod`-target, and
  script-gated binary-only IPL groups (except `truthsfarm`) — or closed props get painted into far LODs
  (the bridge-roadblocks-in-LOD bug). Trees/procobj are excluded from cell LODs (they get impostors from
  the sibling tools).
- **A lod-target is not always a replaceable stand-in** — TCs place a stub HD (gostown `fakebit01`,
  24 verts) whose lod link points at the REAL geometry (`LODEnsemble*` forests): stripping such targets
  deletes the content, and the cell bake cannot replace it (it bakes the stub). List them in
  `lod-always.json` — kept by the strip, welded into both levels (plan 087 row D).
- **Elevated lakes have no TRUE depth** — the water bake's height grid only rasterizes ground at GTA
  z ≤ 4 (`Z_CAP`, sized for SA's sea), so a TC reservoir far above it takes the shore-distance
  pseudo-depth path (plan 087 row C). Fine for the look; anything needing the real lakebed (underwater
  rendering, buoyancy) will need the cap rethought per water level.
- **A texture's PASS is decided once, offline, from its texels — and the decision cannot follow the frame.**
  The pack classifies every texture opaque / cutout / soft-blend (`alpha.ts`); cutout draws with A2C and
  WRITES depth, soft-blend composites and does not. SA has no such classes: it runs one pass with blending
  always on and an alpha-test reference that moves per entity per frame: the world pass opens at **140**
  (`CRenderer::RenderEverythingBarRoads`) and `CVisibilityPlugins::RenderEntity` then sets **100** per
  ordinary entity, or **0** for a no-z-write model, an interior, or an entity that is distance-FADING
  (recovered from the reversed source 2026-07-29). Consequences we live with: a cutout does
  not soften as it fades out, and one reference (128) serves every masked texture. The `0x40` case matches
  vanilla exactly — such defs stay in the compositing class. Thresholds + their residual:
  [`hacks/alpha-mask-thresholds.md`](../hacks/alpha-mask-thresholds.md).
- **The classification is per TEXTURE, so it cannot see placement.** A texture that is a mask everywhere but
  coplanar in one spot has no way to say so; the only signal is the def's own `NO_ZBUFFER_WRITE`, which the
  welder honours for alpha materials. Known residual after plan 092: `Desrtmetal` (a diamond mesh whose
  low-res edge puts it at 13 % ON the reference) stays in the blend pass — a miss, not a regression.
- **A VEHICLE submesh's translucency is judged over its own UV region, not the whole texture**
  (`hasAlphaIn`, 2026-08-04). Mod interiors share alpha ATLASES — the comet maps its parcel shelf, gauge
  housings and lamp bodies onto `911_lights`, whose only transparent texels are the lamp glass — and the
  whole-texture answer sent every one of those opaque parts into the no-depth blend phase (the world showed
  through the shelf behind the rear glass; the gauges had holes behind the side glass). SA never asks: one
  pass, z-write on, alpha ref — an opaque texel occludes whatever texture it is on. A submesh whose region
  genuinely samples transparent texels (glass, decals, gauge needles) still blends; one material mixing
  opaque and transparent texels stays blend — the narrowing is per submesh, not per texel.
- **Texture sizes are asset-driven.** Never hardcode a size that belongs to a source asset — texture arrays
  derive one size from `max(assets)`, fixed slots resample instead of throwing. Only shadow maps / probes /
  LUTs stay constants.
- **A model's private dictionary is bucketed by NATIVE size — one array per (w, h), BC1/BC3 chosen per
  bucket** (2026-08-04; before that a single max-size array cost mod cars up to 8×, and the comet's 32
  textures hit exactly 128 MB — over the VER2 entry ceiling). What still cannot vary WITHIN a bucket is the
  format, and a submesh's vertices must all land in one bucket — a straddling submesh (SA geometries do
  share vertices between material groups) or a lamps-on twin split from its base falls the model back to
  the legacy single max-size array, with a logged warning. The measured negative result stands: a SHARED
  per-size dictionary buys vehicles nothing (car textures do not repeat — 8 %):
  [`performance/applied/vehicle-texture-array-buckets.md`](../performance/applied/vehicle-texture-array-buckets.md).
- **ImVehFt `ivflights` geometry is a lighting convention we do NOT read.** A mod authored for Improved
  Vehicle Features puts its lamps in `ivflights` parts plus its own config, and such a car can ship with
  no standard SA lamp material at all — to us it then looks lampless, and since plan 098/11 that means it
  gets no beam, pool light or corona either. In today's fleet exactly ONE model carries `ivflights` (the
  GTA 5 Rhino, 15 submeshes) and it also authors standard lamp materials and dummies, so nothing depends
  on it — **but that is a property of the current fleet, not a rule**, and 098 exists to install more
  custom cars. `scripts/debug/lamp-census.ts` prints the cross-tab (models with no standard lamp material
  × models carrying `ivflights`); run it after each batch of installs.
- **Mod vegetation is ~48× stock density, and almost none of it buys coverage.** `mods-src/vegetation`
  models run 1451–5813 triangles against SA's 48–132; in draw range of the Ganton path that is 13 524 →
  645 433 triangles (×47.7) for a leaf-area growth of only ×1.66 — **~96 % of the added triangles add no
  screen coverage**. `veg_palm04` is the extreme: 105× the triangles for LESS painted area than stock
  (524 vs 621 m²), average triangle 0.104 m² (~32 cm), i.e. under the rasteriser's 2×2 quad at play
  distance. There is no duplication to blame — each DFF is 1 atomic / 1 geometry. The chain also has no mid
  LOD: 5000 triangles HD → 8-triangle impostor, carried to a stock `vegepart.ide` draw distance of 150 that
  was sized for 48-triangle models.
- **A placement-only mod costs nothing until the `trees` stage swaps the models under it.** The mod
  "39. Green Piece 1.47" shipped no models at all — one IPL, 233 `inst` lines, installed into
  `data/maps/interior/stadint.ipl`. It was invisible in the mods-layer benchmark (stock trees then) and
  became **73 % of the whole trees-layer regression at Ganton** (6.09 of 8.36 ms) once the swap landed. When
  a stage multiplies per-instance cost, re-audit every earlier stage that added instances.

- **A later mod silently DROPS what an earlier one added to a shared dictionary.** Mods apply in order and a
  whole `.txd` overwrites its predecessor, so a texture an earlier mod *added* disappears and the model
  needing it renders untextured. Live example: mod 3 ships `cj_thin_frige.dff` plus a `cj_commercial.txd`
  carrying the `cj_frame_glass2` it needs; mod 4 overwrites that dictionary with a 10-texture version and the
  fridge loses its glass — in the shipped build. **The pak build already detects this** and writes it to
  `report.json` → `textures.missing` (**66 entries** as of 2026-07-28); nothing surfaces it, so nobody reads
  that far. `scripts/debug/txd-retune.ts --add` puts one back.
- **Text mod data is read as UTF-8 everywhere except `vehicle-installer`.** A Windows editor writes `.txt`/
  `.ide`/`.ipl`/`.dat` as UTF-16 as readily as UTF-8, and read as UTF-8 such a file is NUL-interleaved
  garbage that parses to nothing — silently, because a mod contributing no lines looks exactly like a mod
  that ships none. This cost 8 of gostown's 10 vehicle mods their entire `handling.cfg` / `vehicles.ide` /
  `carcols.dat` contribution (they ran STOCK rows under mod models until 2026-07-28) and it showed up in the
  field only because plan 081's stance law made a car's authored suspension visible. `vehicle-installer` now
  decodes by BOM (and by NUL parity when there is none) and warns about every block it drops, and
  `mod-installer`'s Modloader BAKE path reads its loader/data text BOM-aware. What is still UTF-8-only: the
  path-overlay's `.merge` / `.ide` / `.ipl` readers — a map mod shipping one of those as UTF-16 is still lost
  without a word.
- **The installer recognises IMG folders only at the TOP level and only by exact name.** (Every mod-folder
  name that carries behaviour is collected in `docs/contracts/mods.md`.) `apply-mod.ts`
  matches `cutscene_img` / `gta3_img` / `gta_int_img` against the mod's own top-level entries — anything else
  (`models/gta3img/`, a nested `models/gta3_img/`) is copied verbatim as loose files the game never reads, so
  **the mod is silently inert**, with no error and no report line. A Modloader-style mod (one carrying a
  loader file) escapes this because `bakeMod` routes by BARE NAME and ignores the path — but it injects every
  `.dff`/`.txd`/`.col`/`.ifp` into `models/gta3.img` **only**, so an interior asset (whose stock home is
  `gta_int.img`) lands in the wrong archive and shadows nothing. Correct placement is the stock residence:
  check which archive holds the entry before choosing the folder.
- **A merged map's occupied extent can be stretched by ONE placement, and the convert's auto-fit follows
  it.** Removing an object by moving it thousands of metres out of the world — rather than deleting its IPL
  row — is standard SA modding. Measured on a merged `original` build (2026-08-01): a single lamppost at
  `y = -20 101` (id 1226, one row rewritten in the binary `las2_stream1.ipl`) made the occupied 250-grid
  extent `[-12, -81, 11, 11]` — **93 cell rows instead of the map's 24, one of them holding one instance**.
  A pinned `PACK_RECTS.full` clips it away (`original` is pinned at `±12`, so no pak was ever affected), but
  a game WITHOUT a pinned rect auto-fits to content (`occupiedRect`, `opensa-pack --rect` absent) and would
  chunk a mostly-empty map four times too tall. `scripts/debug/grid-extent.ts` now names the stragglers next
  to the extent so the number can be read before it is pinned.
- **The VEHICLE build path does not sanitize corrupt vertices — the world path does, and its threshold
  misses sub-1e6 strays anyway.** `sanitizeVertexPositions` (prepare-clump.ts, `MAX_VERTEX_COORD` 1e6)
  collapses garbage vertices for WORLD meshes only; `buildVehicleModel` reads raw positions. Both
  stratumx MCI mods ship one corrupt ORPHAN vertex (unreferenced by any triangle, invisible to
  RenderWare) in `wheel_lf` — coach at ~5.8e25, bus at ~1.4e4, the latter under the world threshold
  too. Any positions SCAN in the vehicle path must measure over triangle-referenced vertices, the set
  RW draws (`wheelRadius` learned this 2026-08-05 — the wheel had scaled to nothing; `appendGeometry`
  was already safe). New scans over `geometry.positions` inherit the trap SILENTLY.

- **A game without `models/cutscene.img` gets NO cutscene stage** (2026-08-17: gostown, a TC, ships none —
  the first build after the stage was added died on the raw ENOENT after the vehicles stage). The pipeline
  now skips the stage with `cutscene — skipped (the game ships no models/cutscene.img …)`; the consequence
  is that such a game's mod cars have no cutscene twins at all — nothing to convert them into — and
  `perfect-cutscene.asi` is not shipped, which is right (it exists to reorder our translucent atomics).
- **`vehicle-cutscene` decides translucency from the MATERIAL alpha only, so a surface whose transparency
  lives in the TEXTURE's alpha channel converts as opaque.** It then takes the vehicle-pipeline stamp with
  every other opaque atomic, and outside a real `CVehicle` that pipe does not composite alpha — the surface
  renders as a solid sheet. Measured 2026-08-14 on `cscopcarla92`: `defrost_ad` is a 224-triangle,
  1.5 m-wide mesh with material `0,0,0,255` and texture `defrost_lines` (8×16 DXT3, alpha 0..15) — thin
  defroster wires in gameplay, a **black plate over the rear window** in a cutscene. Four more surfaces on
  that car have the same shape (`f_logo`, `vint`, `aero_dynic24`). Not fixed: the field's call was that it
  is real but was not the defect being chased (the matte windscreen was the modulate bit, plan 004 round
  21). A fix has to check the alpha channel actually VARIES — a fully-opaque alpha channel is common and
  means nothing.


- **`sa-lod-generator` clones an `anim` HD into a STATIC LOD, and one stock LOD was itself animated.**
  `oilplodbitbase` (`counxref.ide`, `anim` row, 2 atomics — its arm nods) is the LOD the ten `nt_noddonkbase`
  instances point at, so in stock the pump nods at 800 m too. Our clone overwrites `oilplodbitbase.dff` with a
  merge of the 5-atomic HD (one atomic, frame transforms baked; before 2026-08-17 a verbatim 5-atomic copy whose
  frame names no longer matched the anim), so the far view stands still. The animation is authored data we stop
  honouring; whether an `anim`-row LOD should be left stock is the user's call and has not been made. The
  other 15 multi-atomic HDs with a clone LOD have plain `objs` LOD rows, where nothing is lost.
