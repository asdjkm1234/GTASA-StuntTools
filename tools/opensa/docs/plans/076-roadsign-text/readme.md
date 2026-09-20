# 076 — Roadsign / billboard text (2dfx type 7) in the own engine

[← plans index](README.md) · prod source: `packages/renderware/src/three/build-roadsign.ts` (plan 042 item 5) ·
engine home: [074/06](../074-opensa-engine/06-world-effects-parity.md) · pattern precedent: [074/18 UV-scroll](../074-opensa-engine/18-uv-anim.md)

**Status: SHIPPED + FIELD-CONFIRMED (2026-07-15) — CLOSED.** User: "everything is great". The glyph builder is now a
shared three-free module; a global converter pre-pass buckets each roadsign by the cell of its WORLD position
(deduped by model) and welds the glyph quads as **BEAM-class** geometry — unlit + full-bright (readable day AND
night, the field bug), palette colour in the prelit, `roadsignfont` (particle.txd) as one texture-array layer.
Beam rides the blend phase (after all opaque) so text composites OVER its plate, never before it (the user's
prior-decoupling concern). pak-map reconverted: **roadsigns=488** welded, +1 texture array. 739 pkg tests green,
tsc + eslint clean.

GOTCHA fixed en route: `particle.txd` is a LOOSE `models/` file, so `game-fs.get('particle.txd')` (by basename,
how img members resolve) returned null and `roadsignfont` fell back to magenta. Fix: game-fs now indexes loose
files by basename too (last-resort, after path + img) — the roadsign font, and any loose model TXD, resolve.

<details><summary>Original field report + design (2026-07-15)</summary>

Field report (2026-07-15): the LV overhead sign/billboard panels render BLANK
(bare dark plates) in `?engine=opensa`. Their text is a **2dfx ROADSIGN (type 7)** overlay — the same
mechanism as freeway direction boards and street-name plates — which prod draws and the own engine ignores.

## What it is

A model can carry `Roadsign` 2dfx entries: a plate whose **text is generated at runtime** as one textured
quad per character, UV-mapped into the shared `roadsignfont` glyph atlas (particle.txd — a grid of 8×16 px
cells). Each entry stores the plate size, rotation, colour-palette index (white/black/grey/red), lines of text,
and — unusually — a **WORLD-space position** (verified in `build-roadsign.ts`: entries land on real city
coordinates while their host road chunk sits elsewhere, so they are NOT instance-transformed like other 2dfx).

- **Parsed already:** `parseDff` yields `geometry.roadsigns: RWRoadsign[]` (`parse2dEffects` type 7,
  `packages/renderware/src/parsers/binary/dff.ts`; covered by `roadsign.test.ts`).
- **Prod renders it:** `buildRoadsignParts(roadsigns, roadsignFont)` — glyph indexing (`ATLAS_ORDER` +
  command glyphs for arrows), the solver-verified Z→X→Y rotation, per-side face-offset quads, batched by
  palette colour into alpha-tested font meshes at world coords with identity transform.
- **Own engine: nothing.** `.oscell` reserves objectTable `kind 3 = roadsign` but neither the converter nor the
  engine emit/draw it — the boards weld bare.

## Design — offline into the existing cutout pipeline (the UV-scroll pattern)

Rather than a new engine pass, bake the text quads OFFLINE and let them ride the world **cutout** (alpha-test)
pipeline — exactly how UV-scroll reused existing machinery.

1. **Share the glyph geometry, don't fork it.** Extract the pure glyph-quad builder from `build-roadsign.ts`
   into a renderware module (positions + atlas UVs + palette colour per character, world-space), used by BOTH
   the three path and the converter — the same "shared baker" discipline the fx/particle work used (avoid the
   divergence that copy #2 caused there).
2. **Converter (`opensa-pack` weld)** — a `collectRoadsigns` step (sibling of `collectLights`/`collectParticles`):
   for each cell's instances, gather their DFF roadsign entries, build the glyph quads in WORLD space, then
   convert world → engine → cell-local (the same axis change vertices take). **Dedup by world position** — a
   roadsign's coords are world-space, so N instances of one model must NOT stamp N copies (prod adds them once).
   Place each sign's quads into the cell that contains its world XY.
3. **Texture** — resolve `roadsignfont` (particle.txd) through the `TexturePlanner` like any texture → one
   texture-array layer; the glyph quads carry the atlas-cell UVs. Palette colour (white/black/grey/red) → the
   per-vertex day/night prelit colour slots (the plate text is unlit — treat as self-coloured, night = day).
4. **Weld as CUTOUT** — the quads join the cell's cutout buckets (alpha-test on the font's alpha; the A2C +
   coverage-preserved mips are our vanilla-alpha-test equivalent). They stay INSIDE the merged bundle — **no
   objectTable kind, no new engine pipeline, no format bump.** `kind 3` stays a reserved no-op.

_Alternative considered:_ a dedicated roadsign pass + `kind 3` objectTable draw (like coronas). Rejected —
the text is static geometry with a normal texture; welding it as cutout costs zero engine surface.

## Files

- New shared `packages/renderware/src/.../roadsign-quads.ts` (glyph builder extracted from `build-roadsign.ts`;
  the three path re-imports it — behaviour byte-identical, snapshot/tests carried).
- `tools/opensa-pack/src/weld.ts` (`collectRoadsigns` + world-space → cell-local + dedup; roadsignfont via the
  planner), `weld.test.ts` (a fixture model with a roadsign → cutout quads in the right cell, correct glyph
  count, deduped across instances).
- No `.oscell` / engine change expected (cutout path). Confirm during impl.

## Done means

- LV/freeway boards and street-name plates show their text in `?engine=opensa`, matching prod (e.g. the Grove
  Street plate near (2348, −1648)). **Reconvert required** (cells gain the glyph geometry).

## Open questions

**CLOSED 2026-07-21 (user triage)** — the two verification items below are dropped as done-enough (the
mechanism shipped and field-passed; no sign complaints since):

- ~~**World-space placement vs cells:** confirm each roadsign lands in exactly one cell and reads at the
  right spot after the axis change.~~
- ~~**Which panels in the field report are roadsigns?** Verify the specific LV billboards carry type-7
  entries.~~
- **Font atlas layout** already reverse-engineered in `build-roadsign.ts` (4 cols × 32 rows, `ATLAS_ORDER`) —
  reuse verbatim.

</details>
