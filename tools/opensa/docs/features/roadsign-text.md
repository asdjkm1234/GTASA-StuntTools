# Road-sign text (2dfx ROADSIGN, plan 042 item 5)

`packages/renderware/src/roadsign/glyph-quads.ts` (`roadsignGlyphQuads` — pure geometry), dff parser
type-7 entries, `tools/opensa-pack/src/convert.ts` (world-space pre-pass, signs bucketed per cell) +
`weld.ts` (`weldRoadsigns` — BEAM-class unlit text, `roadsignfont` as a texture-array layer).

## Implemented

- 2dfx type 7 parsing: plate size, rotation, flags (lines 4/1/2/3, chars/line 16/2/4/8, colour
  white/black/grey/red), 4×16-char text.
- **Entry coordinates are WORLD-space** — the only 2dfx type that is, measured over the whole corpus and
  unanimous (`scripts/debug/two-dfx-space.ts`: 489/489 world; every other type model-local). The converter
  therefore collects signs in a global pre-pass and welds each one's quads into the cell its world position
  falls in, at identity — never through the instanced path.
- **Text survives to LOD range** (plan 100/03): the same world-keyed pre-pass feeds the LOD bundle, so a
  plate keeps reading in the ~440 → 1000 u band instead of going blank. It stays keyed by the plate's own
  world position rather than read off the LOD model, and that is not a style choice: **131 of the 489 plates
  sit outside the cell holding the instance that carries them**, so the two sources would file the same
  plate under two different cell keys and draw it twice whenever both are resident.
  **Field-verified 2026-08-08, by COUNT rather than by eye**: `.oscell` minor 8 records each cell's roadsign
  GLYPH-QUAD total and the engine sums it over VISIBLE cells (`EngineStats.roadsignQuadsRecorded`, HUD
  `signs N`). Map-wide on the canonical pak, **334 of 1137 cells carry plates, 50 552 quads, and no cell's
  two levels disagree**; standing off a board reads 2460 quads at 200 u and 1594 at 600 u. A plate is 2.4 m
  wide, i.e. ~8 px at LOD range, so a screenshot was never going to answer this — the counter is the
  instrument, and `signs 0` on a pak older than `13:19 08-08-2026` means UNKNOWN, not none.
- Plate transform (solver-verified across every observed rotation family,
  `scripts/debug/solve-roadsign.ts`): flat base (width +X, lines −Y, normal −Z), entry Euler applied
  **Z→X→Y**, angles as stored. 90°-multiple rotations satisfy several wrong conventions — never
  hand-calibrate on one junction.
- Glyphs: `roadsignfont` atlas from particle.txd (32×512; 4 cols × 32 rows of 8×16 px cells);
  cells 0–81 = ASCII minus command chars, then arrows/fractions/¢/plane/skull/icons. Command
  table (`COMMAND_GLYPHS`): `_`=space, `<`=←, `>`=→, `^`=↑, `~`=↓ (lane row,
  vanilla-verified), `}`=plane, `#`/`%`=↗/↖ (best-effort).
- Layout: fixed quarter-plate line slots, block centred vertically, `TEXT_INSET = 0.85` margin,
  width = plate/charsPerLine (authored).
- **Each glyph renders twice at ±0.05 m with identical UVs (two-sided)** — board face
  direction varies by rotation family; the visible-side copy hugs the board, the other stays
  buried. Readable from the front, mirrored from behind (vanilla behaviour).
- Colour-batched into BEAM-class (unlit, full-bright) buckets so the text stays readable at night.

## Known gaps / candidates

- `#`/`%` glyph mapping is a best-effort guess (diagonal exit arrows) — adjust the single table
  if a real board disagrees.
- Some PF-mod gantries sit slightly rotated/offset vs the vanilla entries (text can sink into
  the custom board) — data quirk, reproduces in real SA+PF.
- **Many boards are empty in vanilla too (user-verified)** — a blank board is not a bug; check
  `scripts/debug/find-2dfx.ts` for an entry first.
- Sign text doesn't dim at night (plain unlit material, no world tint).

## Test coverage anchors

`parsers/binary/roadsign.test.ts` (parser: vegasnroad19 + se_bit_17 regressions). `glyph-quads.ts` has
no unit test of its own — the quads are covered end-to-end by the converter's roadsign count in the
`opensa-pack` report (488 signs on the shipped map).
