# 18 — UV-scroll animation (B7·c)

**Status: SHIPPED + FIELD-CONFIRMED (2026-07-15) — CLOSED.** User verdict after reconvert: "everything is great". Built
end-to-end via **option 1's cheaper cousin** —
NOT a per-vertex slot (the vertex is a packed 36 B; growing it +11 % for a handful of signs was the wrong
trade), and NOT a whole extra pass. Instead the scroller leaves the merged bundle exactly like a timed object:
one **kind-4 objectTable draw** per dict material, its UVs transformed by a per-object cell uniform the engine
advances each frame. Rare feature, minimal-diff, zero cost on ordinary geometry (the vertex transform is a
uniform-gated no-op with identity `uvAnim`).

## What shipped

- **Format** — `OspakManifest.uvAnimations` (global list, dict entries verbatim from the parser);
  `.oscell` objectTable kind 4 (`params` = manifest slot, identity transform), minor bump 4→5.
- **Converter** — `weld.ts` detects `material.effects.uvAnim`, routes the part to a per-dict bucket
  (`~u<name>` key → trailing, out of the bundle), registers the animation in a convert-wide `UvAnimRegistry`
  (de-duped by name, slot = encounter order — HD only, a LOD copy would scroll a ghost). `assemble` emits the
  kind-4 rows via `buildObjectTable`. `convert.ts` feeds `uvAnimList(registry)` to `buildOspak`; the CLI report
  prints `uv-scroll=<draws>/<animations>`.
- **Engine** — world `Cell` uniform grew `origin`→`origin + uvAnim` (16→32 B; ordinary cells write identity).
  `vsWorld`: `out.uv = in.uv * cell.uvAnim.zw + cell.uvAnim.xy`. `cells.ts` gives each kind-4 object its own
  32 B cell uniform + bind group (origin shared, uvAnim rewritten per frame), released on unload.
  `Engine.setUvAnimations()` stores the list; `advanceUvAnimations(seconds)` ports the prod keyframe-pair lerp
  (equal-time pairs snap — DolSign's stepped flipbook); `drawObjects` writes each visible scroller's live
  transform (buffer offset 16) and draws it.
- **Host** — `setupStreaming` (both hosts) + the lab's `loadPak` call `setUvAnimations(manifest.uvAnimations)`.

## Tests

- `weld.test.ts` — the real `visagesign04.dff` fixture (3 dict entries: Money/DolSign/Material #…): HD+registry
  → 3 kind-4 draws + 3 registered animations with distinct slots; no registry → static (no kind-4); LOD →
  never scrolls; slots shared across cells. `ospak.test.ts` — manifest carries/omits the list.
  Golden WGSL snapshot updated. 119 package tests green, tsc + eslint clean.

## Field verification (DONE 2026-07-15)

Confirmed on `pak-map` (`?src=pak-map`): the LV running-neon signs and the Vegas waterfalls scroll. Two findings:

- **The plan's skull sign `visagesign04` has ZERO world placements** — (2029.5, 1726.0) was a phantom. A map
  scan (models whose DFF carries a UVAnimDict) found the 15 REAL scrollers; the placed outdoor ones are
  `vgsN_scrollsgn01` (2370.1, 2164.7), `vegaswaterfall02` (2088.0, 1901.5), `visagesign1`/mirage
  (2105.5, 1916.3). The `triad_*`/`MafCas*` ones sit at z≈1000 (casino interiors). Teleports added to
  `game-config.tsx`.
- **Speed is prod-exact, not a bug.** "Super fast" was authored data: the parser reads RtAnim `duration`/`time`
  as raw seconds, and both prod (`updateUvAnimations(performance.now()/1000)`) and the engine advance on the
  same wall-clock. `Standardmaterial` = 45 UV-units / 15 s ≈ 3 tex/s by design. A global `uvAnimSpeed` divisor
  would be a SHARED (three + engine) change vs authored data — deferred unless the native game proves slower.
- The "not moving" first report was a stale pak: the reconvert had gone to the wrong `--out` (a bare
  `public/`, not the `pak-map` symlink). RECONVERT LANDS IN `pak-map` — the manifest grows `uvAnimations` and
  cells grow kind-4 objects (`uv-scroll=13/12` in the CLI report).

## Known v1 caveat (accepted)

- Same as timed objects: a scroller's blend groups draw in the OPAQUE phase, so cross-object transparency
  ordering with the world blends is only approximate. Fine for emissive neon; revisit if a translucent
  scroller ever reads wrong.

---

## Original scoping (for reference)

Scoped out of B7·b deliberately (it shares nothing with the frame-hierarchy
path) and written up here so it is not quietly forgotten — it is a **prod-parity gap**: the three path renders
these, the own engine does not.

## What it is

A completely separate animation mechanism from the animated map objects of B7·b:

|           | Animated objects (B7·b, DONE)                          | UV-scroll (this plan)                                                                                                                   |
| --------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Marked in | the **IDE** (`anim` section → an IFP file)             | the **DFF** — a `UVAnimDict` chunk (0x2B) at the clump head, materials referencing dict entries **by name** via the UV Anim PLG (0x135) |
| Moves     | the clump's **frames** (a garage door, a windmill hub) | the **texture coordinates** of a material (the LV skull sign's crawling neon, conveyor belts)                                           |
| Driven by | an IFP clip per model                                  | a keyframed `offset`/`scale` pair, played **globally in sync** — SA's dict-entry names are global identifiers                           |

## What already exists

- **Parsed, both halves.** `parseDff` already yields `RWClump.uvAnimations` and
  `material.effects.uvAnim.names` (`packages/renderware/src/parsers/binary/dff.ts`) — the data reaches us and
  is thrown away.
- **Prod renders it:** `packages/renderware/src/three/uv-anim.ts` — a module-level registry keyed by dict
  name (deliberately global, matching SA), a generic keyframe-pair lerp (equal-time pairs snap, which is how
  DolSign's stepped flipbook works), applied as a shader variant:
  `vMapUv = vMapUv * uUvAnim.zw + uUvAnim.xy`. The `rotation`/`skew` params are parsed but unused — SA's
  assets do not need them.
- Plan [041](../041-animated-map-objects/readme.md) documented both mechanisms; the three path shipped both.

## What is missing

- The **converter** drops it entirely (`grep uvanim tools/opensa-pack` → nothing). The `.oscell` vertex has no
  room to say "this triangle's UVs scroll", and the texture atlas path has no per-material uniform slot.
- The **engine** has no consumer.

## The hard part (decide this first)

The world shader samples a **baked texture ARRAY** — a material is a layer index, not an object with its own
uniform. A scrolling material therefore needs one of:

1. **A per-vertex anim slot** — a small index into a global UV-anim table (a storage buffer of
   `vec4(offsetX, offsetY, scaleX, scaleY)` advanced once per frame on the CPU, since SA plays these globally
   in sync anyway). The world vertex shader adds one lookup: `uv = uv * anim.zw + anim.xy` when the slot is
   non-zero. Cheap, and it needs a spare per-vertex field — the vertex is already 36 bytes, so this is a
   format decision, not a free one.
2. A separate draw pass for scrolling materials (they leave the merged bundle). Costs draws for something that
   is, at heart, two floats.

Option 1 is almost certainly right; the cost is a `.oscell` minor bump and a re-convert.

## Done means

The LV skull sign at (2029.5, 1726.0) crawls in `?engine=opensa` exactly as it does on the three path, with no
measurable frame-time cost (it is one storage-buffer read on a handful of vertices).
