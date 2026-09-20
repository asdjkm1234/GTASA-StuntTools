# 003 — plate bake: readable license plates in cutscenes

**Status: CLOSED 2026-08-13 — field-passed first round.** An IMPROVEMENT over the original, in the goals-doc sense: vanilla
cutscene cars show a BLANK white plate — the user's own gate-7 vanilla A/B screenshot is the recorded
evidence — because `CCustomCarPlateMgr` generates plate textures only for GAMEPLAY vehicles, and a
cutscene object renders the raw placeholders. The converted models can do better offline: bake a real,
readable plate into each slot's cs TXD. Zero DFF changes, zero runtime cost, kilobytes per slot.

## The mechanism (research already banked)

- Every plated DFF carries two quads, keyed by their material's placeholder TEXTURE name (the reversed
  `CCustomCarPlateMgr` keys on exactly these — `build-vehicle-model.ts`'s PLATE_TEXTURES mirror):
  `carplate` = the text strip, `carpback` = the background it is inset into.
- At gameplay model setup the manager swaps `carpback` → `plateback<town>` and `carplate` → a texture it
  RENDERS from the `platecharset` glyph strip. Cutscene objects never get that call.
- All source art lives in the resident `models/generic/vehicle.txd`, **uncompressed RGBA8888** (no DXT
  round-trip needed): `platecharset` 32×256, `plateback1/2/3` 64×32, the blank `carplate` 16×16
  (measured 2026-08-12). **Town order corrected 2026-08-13**: `eCarPlateType` is SF = 0, LV = 1,
  LA = 2 — `plateback1` is SAN FIERRO and `plateback3` is LOS SANTOS (the engine's measured mapping,
  plan 082/01), not the LS/SF/LV this plan first guessed.
- **Texture resolution prefers the model's OWN TXD over the txdp chain** — so shipping textures NAMED
  `carplate`/`carpback` inside the emitted `cs*.txd` overrides the placeholders with no DFF surgery at
  all. This is the whole trick.
- The hand-made pack half-knew this: it shipped `plateback1-3` + `platecharset` copies per car (megabytes)
  but never composed a text — its plates render the background only.

## Steps

### 1 — recover the original's plate-render formula ✅ 2026-08-13 (by REUSE — plan 082/01)

- [x] The formula was ALREADY recovered for the engine's own gameplay plates:
      `packages/game/src/vehicle/plate-raster.ts` (plan 082/01 — measured off the real rasters and
      independently confirmed against the reversed `CCustomCarPlateMgr`). The layout: the text raster
      is `RwRasterCreate(64, 16, 32)`, 8 cells of 8×16; the charset atlas is 4 columns, A–Z row-major
      then 0–9, index 36 = the blank cell (the fallback for unmapped chars); the blit is an OPAQUE
      memcpy (`rwRASTERFORMAT888`, no colour key — the charset's light ground IS the blank field);
      the mask is `LLDD DLL`. The tool REUSES that module rather than re-deriving it — the standing
      rule's best case.
- [x] UV check on the real corpus (probe 2026-08-13): every `carplate`/`carpback` quad spans the full
      0..1 (stock bobcat 4 quad pairs exact; taxi/glendale within 0.003 export rounding). The bike and
      boat mods carry NO plate materials at all — the bake derives from the asset and skips them.

**Record:** formula citation above; risk 1 (UV sub-rects) measured away.

### 2 — `plate.ts`: compose + encode ✅ 2026-08-13

- [x] Compose REUSES the engine module (`composePlateText`/`generatePlateText`): `carplate` = the
      64×16 text strip, `carpback` = the town background verbatim (the two-quad mechanism needs no
      compositing of one onto the other). Text is deterministic per slot —
      `generatePlateText('LLDD DLL', fnv1a(csName))` — with the `--plate <text>` override (truncated
      to 8 cells with a summary warning).
- [x] Encode (`textureNative` in `plate.ts`): the stock plate art's EXACT shape, measured off
      `generic/vehicle.txd` 2026-08-13 — platform 9 (D3D9), filter 0x1101, rasterFormat 0x600 (C888),
      d3dFormat 22 (X8R8G8B8), depth 32, one mip, rasterType 4, no alpha, pixels stored BGRX.
      `appendTextures` rebuilds the dictionary chunk-level (rw-codec), REPLACING same-named entries
      (risk 2: a mod shipping its own `carplate` deliberately gets ours).
- [x] Tests 10 (negative first): unknown town throws at install, no-plate-sources throws, long text
      truncates with a warning; round-trip via `parseTxd` (BGRX→RGBA swizzle exact), replace-not-
      duplicate, the real generic dictionary survives an append intact.

**Verification:** unit round-trip green; a baked pair rendered to PNG reads "YI08 OSJ" over the LOS
SANTOS background (offline visual check, 2026-08-13). **Record:** the pair costs **~12.5 KB** per slot
against the 40 B empty dictionary (64×16 + 64×32 X8R8G8B8 + headers; measured fleet-wide below).

### 3 — wire into the emit ✅ 2026-08-13

- [x] The pair lands in BOTH routes (after `slotTxd`, appended to whatever bytes the route chose) —
      but ONLY on slots whose converted DFF actually wears the placeholder quads
      (`referencesPlates`, derived from the asset): the bike and boat mods carry none and get none.
- [x] Town selection: default LS = `plateback3` (`eCarPlateType` 2 — the corrected mapping above);
      `--plate-town ls|sf|lv`, unknown value throws.
- [x] Summary + CLI + the pmb `cutscene` fragment report plates baked.

**Verification (run 2026-08-13):** full mod run over `game-src/original` — **23/23 converted,
21/21 plated slots carry the pair** (the two unplated are the bike + boat, by asset), 0 errors;
suite 78/78 for the tool, lint + tsc clean. **Record:** fleet cs TXDs 148 828 601 → 149 092 025 B —
**+263 424 B across 21 plated slots (~12.5 KB each**; self-contained slots replacing a mod's own
placeholder entries vary slightly); the composed `csbobcat92` pair rendered offline reads as a real
plate.

### 4 — FIELD: the improvement demonstrated ✅ PASSED 2026-08-13 (first round)

- [x] Field run (user, PROLOG3 via the cutscene-override — sheriff + taxi in one scene):
      **"checked — the plates are visible, everything's great."** The demonstration pair the
      improvement rests on: the user's own gate-7 vanilla A/B frame (the recorded BLANK white plate,
      plan 002 step 4) as the before, this verdict on the same scene class as the after. No dedicated
      screenshot was captured this round — the before-frame exists in the gate-7 record and the
      offline PNG render of the baked pair (step 2) documents exactly what the field then confirmed.

**Record:** verdict above; the override was disarmed (`scene =`) after the pass. The plan closes.

## Risks / notes

1. The `carplate` placeholder is 16×16 and the generated raster is larger — step 1's UV check guards the
   only way this could mis-render (a quad UV-mapped to a sub-rect instead of 0..1).
2. Mods whose plate quads carry NON-placeholder textures (a custom baked plate) already resolve their
   own art; the override pair in the cs TXD would shadow SAME-NAMED textures only — a mod using
   `carplate` deliberately gets ours (acceptable: same look class), any other name is untouched.
3. Gameplay parity note: gameplay plates are random per instance; the cutscene plate is one deterministic
   text per slot. That is strictly better than vanilla's blank, and nothing in a scene reads a plate's
   text as story content.
