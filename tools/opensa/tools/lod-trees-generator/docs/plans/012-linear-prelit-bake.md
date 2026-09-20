# 012 — Colour-space-correct impostor bake (normalized prelit + per-target texel encoding)

**Status: ✅ SHIPPED & VERIFIED IN-GAME 2026-07-07** — regenerated build confirmed visually consistent
in BOTH targets (real SA from the gamma common build, OpenSA with the swapped linear TXDs).

## Symptom

Nearly every generated LOD rendered 2–3× darker than its HD neighbour — in OpenSA **and** real SA, worst
at dusk/night. After fixing the first finding, the two targets SPLIT: OpenSA matched, real SA flipped to
LODs noticeably LIGHTER — the decisive clue that the two renderers use different colour pipelines.

## Two root causes, one class

1. **sRGB-space multiply in the bake** (iteration 1): the rasterizer blended `texture × prelit` in raw
   sRGB bytes while OpenSA/three.js decodes textures to linear before multiplying — effectively
   `prelit^2.2` (trunk tex 97 × prelit 86 → atlas 33 shipped vs 57 the engine shows for the HD). Same
   class in the mip chain (sRGB-byte averages darken mid-tones ~15–20 %).
2. **Baking the lighting level into the texture at all** (iteration 2): with the mean prelit baked into
   the atlas and WHITE card vertices, any pipeline multiplier real SA applies to prelit models (plain ×1
   modulate, skygfx PS2 building pipe ×2, whatever a user's mod stack does) hits the HD and the impostor
   DIFFERENTLY — the pair can never match across configs we don't control. Field-verified: changing
   skygfx `buildingPipe` moved HD but not the (white-vertex) impostor.

## The fix — the impostor behaves like a stock prelit model

- **Normalized atlas**: texels store only the per-texel VARIATION `tex × (prelit / dayAvg)`; the tree's
  average day prelit rides the card **vertices** (`Impostor.dayColor`), its average night colour is the
  card's absolute night set (`nightColor` — the old `255 × night/day` ratio-on-white encoding is gone).
  Whatever a renderer multiplies prelit models by now cancels between HD and LOD by construction.
- **Per-target texel encoding** — the one thing that cannot be shared, because the normalize multiply
  itself has a colour space and the conversion between conventions is not invertible per-pixel:
  - `Raster.color` / `lodtrees.txd` in the game build: **gamma** (raw byte product) — real SA's
    D3D9-era pipeline filters and modulates in gamma space; every bootable `.work` stage stays SA-true.
  - `Raster.colorLinear` / `linear-txd/lodtrees.txd` sidecar: **linear** (`lin2srgb(srgb2lin(tex)·f)`) —
    what OpenSA/three.js shows. Both encodings are produced in ONE rasterization pass.
- **Mips follow the same rule**: `rw-codec` `downsample`/`buildMipChain` take a required
  `MipColorMath = 'gamma' | 'linear'`; every producer declares its target — map-optimizer,
  mod-installer PNG→TXD, sa-lod clones = `gamma`; opensa cell atlases = `linear`; lod-trees /
  lod-procobj TXDs = both (gamma into the build, linear sidecar under `<stage>/linear-txd/`).
- **pmb opensa split** (`swapLinearTxds`): swaps the linear sidecars into `opensa/models/gta3.img`;
  sidecar dirs are removed from both final targets.

## Invariants (worth remembering)

- Any offline colour multiply/average must pick its colour space to match the TARGET renderer — and when
  a build feeds two renderers with different conventions, texels must be encoded per target (the
  placement/geometry stays shared; only TXDs fork).
- Never bake a lighting LEVEL into a texture the engine will light again — bake the variation, put the
  level where the engine's own pipeline applies it (vertex prelit). This is also how stock SA lod assets
  are authored.
- The measurement harness diffs LOD vs HD through the same rasterizer — it cannot catch a convention
  error applied to both sides; only absolute texel audits against each engine's formula can
  (`atlasMean` vs `tex×p` for SA, vs `lin2srgb(lin(tex)·p)` for OpenSA).

## Verification

- Unit: `raster.test.ts` (normalization identity at `prelit == dayAvg`; per-convention products
  128/188 for factor 0.5; clamping; the 97×86 → 33/57 field case), `mip.test.ts` (both maths,
  alpha-weighting preserved), `io.test.ts` (dayAvg/nightAvg extraction), atlas/DFF encode fixtures.
- Field (after full regen): `veg_palm04` ↔ `lodveg_palm04` trunk at noon / dusk / midnight in BOTH
  engines; flipping skygfx `buildingPipe` must now move HD and LOD together.
