# SA asset-format edge cases

Strict RenderWare/SA requirements every generated or byte-edited asset must satisfy. Violations are usually
**silent** in-game (invisible model, corrupted collision) — they render fine in viewers. Detailed war
stories: `tools/lod-trees-generator/docs/plans/005-sa-asset-format.md`,
`tools/sa-procobj-placement/docs/plans/003-sa-asset-format.md`.

- **Model id ≤ 19000 on the target; 18630 is the STOCK ceiling.** Ids above 18630 silently fail to load on a
  plain 1.0 — "HD swapped but no LOD shows" — but the target always carries FLA, whose DFF range is
  `0 - 19999` (its own log prints it). **Raised to 19000 on 2026-08-10** (the user's call): budgeting to the
  stock number was designing down to a ceiling the target does not have, and 19000 keeps ~1000 ids of FLA
  headroom. Allocators (`allocateLodIds`, `findFreeBlock` in `tools/map-placement`) share the window; a build
  shipped to a plain 1.0 would lose whatever it placed above 18630, silently.
- **uint16 vertex/index ceiling (65,535).** Indexed geometry must split across atomics past 65,535 verts.
  The engine paths are widened to uint32, but the index-width flag is load-bearing everywhere (cell path,
  rigid path, LOD encoders) — two ~90k-vert custom cars once took the whole vehicle system down.
- **Tristrip flag must match the data.** `rpGEOMETRYTRISTRIP` set on a triangle-_list_ geometry makes SA
  read it as a strip → draws nothing (`clearTristripFlag`).
- **Extra-vertex-colour (`0x253F2F9`) must be stripped when the vertex count changes.** A template's
  extension carried onto a rebuilt mesh applies stale RGBA → black or fully transparent
  (`stripExtraVertColour`).
- **mod-installer's PNG→TXD merge** _patches_ an existing `.txd`, never creates one, and needs 8-bit
  RGB/RGBA PNGs; atlases the tools bake go DXT5 (alpha) / DXT1. (TXD _reading_ is broad: DXT1/2/3/4/5 —
  DXT2/4 are the premultiplied-alpha variants of DXT3/5 — plus uncompressed 32-bit A8R8G8B8 and X8R8G8B8
  and 16-bit rasters all decode. Modern D3D9-platform exporters, e.g. Carcer City, ship DXT4 and X8R8G8B8;
  the `X` byte is padding and must decode OPAQUE, not alpha-0, or the whole model renders invisible/black.)
- **Empty COL3 model is exactly 112 bytes.** Any other size misaligns the rest of the COL library and
  corrupts collision _globally_, faulting an unrelated model (the "3999" crash). Collision binds by **name**;
  `.col` must be packed into the IMG to be auto-discovered.
- **IMG VER2 entry names ≤ 24 bytes including extension** — the 24-byte name field is NUL-terminated only
  when the name is shorter (TCs ship full 24-byte names, e.g. Carcer City's `cj_padlockgate_l_(d).dff`);
  longer impostor names get short aliases (`lodt<i>`, `plobj`, `plotr`).
- **A text IPL's `lod` field is an INDEX into that file's own `inst` list**, not a name. Deleting instance
  lines shifts every index above the cut and silently re-links LODs to unrelated objects. To remove
  instances, drop them together with their linked LOD partners and remap the survivors through an old→new
  index map.
- **Anti-rip "locked" DFF/TXD.** Four lock variants (inflated sizes, hidden wrappers) are recovered by the
  **engine parser only**; the offline byte-editing tools (`vehicle-optimizer`, map-optimizer's size-trusting
  `readRw`) still trust declared sizes — a locked DFF there reads 0 geometries until an explicit `unlockDff`
  exists. More lock variants remain in the wild. See `docs/open-issues/locked-dff.md`.
- **UV-layer-count byte can be 0** with the truth in the `TEXTURED`/`TEXTURED2` flags — trusting the bare
  byte reads triangles out of UV float data (garbage that masquerades as a lock). Handled in the parsers;
  keep honouring the flags in new code.
- **COL v1 unsupported** (none shipped in SA); don't emit it.
- **`water.dat` stores a quad's corners in GRID order, not around its perimeter** — bottom-left,
  bottom-right, top-left, top-right (the vanilla file's first line is (−1584,−1826), (−1360,−1826),
  (−1584,−1642), (−1360,−1642)). Walking them as a loop traces a self-intersecting bowtie, so any
  perimeter-based point-in-polygon test hits NOTHING and does it silently: 311 polygons loaded and a
  height lookup answered `null` over the entire map (plan 025, 2026-08-11). Triangulate the way
  `flatWaterMesh` does — `0,1,2` + `2,1,3` — and the lookup cannot disagree with what the game draws.
  The sea also extends past the authored polygons: `oceanFrame` fills out to the horizon around their
  bounding box, so a query that omits it reads open water as dry land. Interior gaps stay dry ON PURPOSE —
  that is how the file keeps tunnels under land from flooding.
- **A face's UV triangle can be degenerate while its position triangle is healthy** — stock SA ships them in
  quantity (30 faces on `road_lawn34`, 16 of 39 on `sbseabed3_las20`), and one texel row is then smeared
  across the whole face. Nothing in the geometry says it is wrong, and the class SHIPS AS-IS: an automated
  repair was built and field-retired the same day (2026-08-11) — the authored intent needed to fix it is not
  in the data, and a partial fix reads worse than the smear
  ([`postmortem/uv-stretch-repair.md`](../postmortem/uv-stretch-repair.md)); the rule it left behind is in
  [`restrictions/assets-and-data.md`](../restrictions/assets-and-data.md).
- **`surfinfo.dat`'s `W_SPRAY` is set on `default` and every `tarmac*` row** — it means "throw water spray
  when the road is WET" (`CWeather` wetness gates the read in the original), NOT "this surface sprays".
  Read unconditionally it turns every road into a sprinkler (plan 089/05 field round 1). This game tracks
  no road wetness yet, so the flag is deliberately unread (`surfaceFxClassOf`, pinned by a test).
- **SA's `prt_*` particle systems are authored colourless** — `prt_wheeldirt`'s colour envelope is pure
  white and its sprites (smokeii_3, bullethitsmoke) neutral grey; the earth colour arrives PER SPAWN
  (`FxPrtMult_c`, ground-derived). Rendering them unpainted gives white smoke; the dynamic lane bakes
  per-class tints as the stand-in (see `docs/hacks/surface-fx-fit.md`).
