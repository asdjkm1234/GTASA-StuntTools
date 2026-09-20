# 085 — map-object appearance

**Status: 🔒 CLOSED 2026-08-12** — rows A–H all shipped and field-confirmed. Row H was the last one: the
user drove the Old Venturas Strip entrance at night on the 2026-08-11 build and reported it right (no
see-through, solid facade), matching what the pak bytes already said. The 2026-08-12 sweep also struck
four checklist boxes that had been answered elsewhere in this same file (the F2 magenta toggle, rows A/C/D)
and handed the 084 row back to 084.

The field round the user queued after vehicles ([084](../084-vehicle-appearance/))
and before peds. Same method: the user reports what they see in game, each symptom is traced to data
(DFF → pipeline stage → pak bytes → shader) before any code is touched.

Scope: how a placed MAP OBJECT looks — prelight day/night, emissives, textures, alpha, LOD swaps.
Vegetation LOD impostors are lod-trees-generator's own plans; peds are the next round.

---

## Shipped in this round

### Row A — night emissive mask killed saturated neon (vgsn_nitree rope lights)

**Symptom (user, 2026-07-22):** `vgsn_nitree_r01` — the LV strip palm with a light-rope spiral. At night
the trunk glows but the rope itself stays dark pink/unlit. Model source: `mods-src/vegetation/`.

**Trace (the whole chain was checked, in order):**

- The mod DFF is authored correctly: rope night set avg 188 (max 225), rgb `188/37/62`; leaves night ~22.
  The STOCK model is the same shape: rope day `81/81/81`, night `255/49/49`.
- The pipeline was suspected of losing the night set (prelight bake in the trees stage) — it does not:
  `applyStockPrelight` replaces only the DAY prelit, and map-optimizer's conform-night runs BEFORE the
  vegetation swap so it never sees these models.
- The built pak (`build/original`) proved the night set SURVIVES: rope vertices carry night avg 188 — but
  their baked emissive byte is **0** while the bark next to them bakes 245. The bark glows, the rope
  doesn't — exactly the screenshot.
- Root cause: the emissive rule (offline in `weld.ts`, heuristic twins in the world + rigid shaders) used
  the **Rec709 luma** delta night−day. Saturated neon has low luma — the red rope's night luma (~92) barely
  beats its flat grey day (81): delta 0.046 < the 0.05 floor → mask 0. The blue tree (`b01`, night
  `48/156/205`) would half-glow; red/pink never glowed at all — a systematic bias against saturated colours.

**Fix (2026-07-22):** the delta is now the **max per-channel** difference night−day, in all three places
(`tools/opensa-pack/src/weld.ts` baked mask, `shaders.ts` world runtime heuristic, `shaders.ts` rigid glow).
Red rope: max delta 0.68 → full mask. Synthesized night sets (day × ambient) stay below day on every
channel → still mask 0, nothing new glows. Fixture: stock `vgsn_nitree_r01.dff` + txd
(`fixtures/original/dff/night-colours/`), test in `weld.test.ts` (rope ≥100 vertices at mask 255 — the luma
rule fails it; foliage stays 0).

**Field check: PENDING the next pak rebuild** — the mask is baked at pack time, the current
`build/original` pak still carries the luma-rule bytes.

---

### Row B — missing textures rendered as loud magenta instead of vanilla's untextured grey (visagesign04)

**Symptom (user, 2026-07-22):** `visagesign04` (the LV Visage skull sign arch) — the frame renders solid
purple; the animated LED screen inside it is fine. "Prod is fine." The model is modded
(`mods-src/original/mods/42. Animated texture (24 hours Las Venturas)/gta3_img/visagesign04.dff`).

**Trace:**

- Mod 42's DFF names `miragepillar2_257` / `miragesign1_257` / `miragesign2_257` on the arch (189+6+12 of
  231 verts). Those names exist NOWHERE — not in any mods-src TXD (only `_256` variants ship, e.g. mod 3's
  `skullsign.txd`), not in stock `gta3.img` (byte-searched). Mod 42 ships ONLY the DFF; its own TXD (which
  presumably carried the `_257` set) never made it into `mods-src`. The screen materials use `_256` +
  `vgsn_scrollsgn` — present — which is why the animated part worked.
- The purple is OURS: `TexturePlanner.resolve` painted every unresolvable texture the loud
  `[255, 0, 255]` marker. Prod (three path) did `textures.get(name) ?? null` — untextured material,
  grey under prelit — and vanilla SA draws the same, which is why the field read prod as "fine".
- The marker was also USELESS for diagnosis: the failed name was recorded nowhere.

**Fix (2026-07-22):** vanilla parity + loud ledger + a runtime dev highlight (user's call, paraphrased: "easier to debug this way").

- A miss falls back to the MATERIAL COLOUR (the `empty-txd` white-stand-in precedent generalized); every
  failed name lands in `report.json` `textures.missing` (`txd/texture` → count + the MODELS that asked for
  it) and the pack log prints one ⚠ line per failed name with its models — a broken mod is identifiable
  straight from the console (user's ask: they will triage the mods from this list).
- The stand-in is minted in a POOL of its own (never shares a layer with a legit colour material) and
  listed in the pak manifest (`missingLayers`: array/layer/packed texel). The engine repaints exactly
  those 4×4 layers magenta when the highlight is on — `TextureArrays.setMissingHighlight` writes the
  texels live, on-load and on-toggle, no re-fetch. Default: ON in dev builds, OFF in production; toggled
  from the F2 debugger's Map screen ("Missing Textures: magenta ON/OFF").
- Tests: `textures.test.ts` (separate pool, shared stand-in per colour, ledger), `ospak.test.ts`
  (manifest carries/omits `missingLayers`), `engine.missing-textures.test.ts` (paint-on-load, resident
  repaint + colour restore, no-op toggle, bounds guard) — the fake device now records `writeTexture`.

**Field check: PENDING the next pak rebuild.** Data follow-up (user decision): the arch will render
untextured grey like prod until either mod 42's missing TXD is restored or the DFF's `_257` names are
patched to the shipped `_256` set.

---

### Row C — IdeFlag.ADDITIVE ignored: LV neon overlays welded as lit geometry (vgncircus2neon)

**Symptom (user, 2026-07-22):** `vgncircus2neon` (the Circus casino's timed neon dressing) — many glowing
elements in the original, dull in ours. Suspected the row-A palm problem; it is NOT.

**Trace:**

- The stock DFF's dominant material (`neon_centrala`, 1019 of 1273 verts) is FULLBRIGHT in **both** prelit
  sets (day = night = 255/168/83) — night−day delta is 0, so no emissive rule can or should fire.
- The def is `tobj` 7226, flags **140** = DRAW_LAST (0x4) + **ADDITIVE (0x8)** + 0x80, window 22:00–06:00.
  In vanilla RW the mesh ADDS its fullbright texture onto the base building — that IS the glow.
- Our welder consumed only DISABLE_BACKFACE_CULLING / IS_TREE / IS_PALM from the IDE flags. The neon
  welded as ordinary lit geometry: `prelit × night indirectScale (~0.13) × ao` — crushed to dull.

**Fix (2026-07-22):** honor `IdeFlag.ADDITIVE` end-to-end.

- Pack: `classOf` gained class **4 = additive** (wins over beam), from `def.flags & 0x8`. Composes with
  the timed window and the placement/breakable tables unchanged; AO/sun-vis bakes already skip class > 1.
- Engine: `world-additive-front/double` pipelines — the beam's self-lit shading (`fsBeam`: texel × dn-mixed
  prelit, no sun/indirect terms) with an ADDITIVE blend (`one, one` on colour; dst alpha untouched),
  depth read-only like every blended class. `pipelineIdFor` maps class 4; old paks never emit it.
- Covers every additive-flagged def map-wide (the whole LV strip's neon dressings), not just this model.
- Tests: weld routes a flags-140 def to class 4 (and never without the flag); `pipelineIdFor(4, ·)`.

**Field check: PENDING the next pak rebuild** (the class is assigned at weld time).

---

### Row D — night-only timed models crushed by the synthesized dark night (casinoblock41_nt, Fremont facades)

**Symptom (user, 2026-07-22):** casinoblock4 area (pos 2247.6, 2200.3) — the casino's lit facade glows in
the original, dull in ours. Reported as "animated facade"; the geometry there is the `tobj` pair
`casinoblock41_dy` (5→22) / `casinoblock41_nt` (22→5).

**Trace:** the `_nt` night model is authored FULLBRIGHT (day prelit 255/255/255, lit textures
`casinolights6lit3_256`/`casinobulb2_128n`) and carries NO night set — vanilla renders it at full texture
brightness after the 22:00 swap; that IS the "casino blaze". Our converter synthesized night = day ×
ambient (~0.25) and the shader multiplied by the night indirect (0.7): ~0.18 of vanilla's brightness. The
emissive mask also read delta = synthesized−day < 0 → mask 0. Every `*_nt` night dressing on the map
shares this crush.

**Fix (2026-07-22, weld.ts):** a NIGHT-ONLY timed window (`on ≥ 18 && off ≤ 8`) means the model does not
exist by day, so (1) a missing night set falls back to the DAY prelit verbatim (not the dark ambient), and
(2) the baked emissive compares the night set against VOID — its own brightness is the delta. Authored
night sets still win unchanged. Tests on the `mine` fixture (no prelit/night): night==day + mask 255 for a
22→5 window; day-window keeps the dark synthesis and mask 0.

**The ANIMATION half (user insisted, and was right):** the stripes running down the facade are a real
UV-scroll — `casinoblock41_nt` carries a UVAnimDict (`Material #1611953998`) referenced by the
`casinolights6lit3_256` material. The weld DID route it — but a bucket that is BOTH timed and scrolling
produced TWO objectTable rows (kind 0 + kind 4): the scroll drew around the clock, doubled the geometry
inside the window, and at ~18 % brightness the motion was invisible. Fix: **objectTable kind 5 = timed
UV-scroll** (oscell minor 7; params = slot | on<<16 | off<<24) — weld writes ONE row, the engine gates it
by hour AND feeds it the live scroll uniform; the model's non-scrolling remainder stays kind 0. Older
readers skip unknown kinds (the standing convention). Tests: weld (one kind-5 row per scroll material,
no kind-0 twin, window packed), engine frame (no draw outside the window; scroll uniform refreshed
inside it).

**Field check: PENDING the next pak rebuild.** Note: there is no bulb-chase FRAME animation in the assets
(single `lit3` texture) — vanilla's motion here IS the UV scroll, which kind 5 restores.

---

### Row E — ground glow at Ten Green Bottles (CLOSED for this iteration 2026-07-23 — spec captured, deferred to roadmap/0.6.0)

**Symptom (user, 2026-07-22):** at Ten Green Bottles (2345.5, −1704.8) prod spread a GREEN glow across the
ground at night; the original also blinks it. The named model (`telwire_01_lae2`) is just wires — no 2dfx
(the pick hit its street-spanning AABB).

**Spec answered 2026-07-23 (user, original-build field check):** the glow is tied to the CORONAS on the
bottle sign — they blink and the wash blinks with them; the junction's traffic light is unrelated (stays
red while the wash is green). Data trace: the coronas are authored by mod "19. Project Immerse-Yourself"
on its replacement `liquorstore02_lae2` (the bar building) — EIGHT 2dfx lights, rgba 15/230/0/200,
point-light **range 18**, **showMode 3 = FLICKER_NIGHT**, shadowSize 8, farClip 100. In SA one 2dfx light
drives corona + ground splat + a range-18 point light from ONE blink state. Vanilla `liquorstore02_lae2`
carries no lights — the earlier "only green 2dfx in 60 u is the trafficlight" fact was true of the STOCK
data only. The parser still drops `range`/`showMode`/`shadowSize`; static lights left the pool 2026-07-17.

**Decision (user, 2026-07-23):** close row E for this iteration; do it properly later. The full staged
plan (parser+oscell fields → shared blink function driving corona AND pool intensity → wet-road specular
→ clustered lighting for strip-scale) lives in
`docs/roadmap/0.6.0/plans/04-graphic-improvements/04-2dfx-real-lights.md`. The blink function also fixes
"all three traffic-light colours glow at once" (showMode 7/8).

**History:** a bare pool restore (smooth admission, no blink) was tried 2026-07-22 and REVERTED the same
day (user, paraphrased: "not what we need") — the missing half was the blink sync; do not re-apply as-is.

---

### Row F — the OLD pak's magenta roster: 28 models, two data classes, ONE fix (global by-name fallback)

**Symptoms (user, 2026-07-22, five reports in a row):** magenta surfaces on `sw_block02` (next to
sw_shopflat05 @1282,373 — the pick hit the neighbour), `subpen_crane_sfse` (@−1744,−1784, the "purple
bus"), `triadcasno01_lvs` roofs, `vgnlowbuild13` roof, `lacnchasgn*_lvs` (La Conca sign rim).

**Trace:** a MAP-WIDE pak scan (decode every cell, attribute every triangle on the 4×4 colour layer whose
texel is 255/0/255) produced the complete roster — **28 models**, top offenders `bonaventura_lan` (6048
idx), `sw_block02` (3729), `visagesign04` (2304), `triadcasno01_lvs` (726). Every user report is in it.
Spot-checks split the class in two:

- **Mod TXD dropped names** its stock predecessor carried: mod 32 (`Lit Four Dragons Casino`) replaces
  `triadcasino.txd` without `black32`/`greyground256128` — and after install the stock TXD no longer
  exists to fall back to.
- **Stock cross-TXD references**: `lacnchasgn_lvs` names `carparksignplate_64`, which its own
  `laconchasign.txd` NEVER carried — vanilla RW finds it through the loaded-txd pool.

**Fix (2026-07-22, `textures.ts`):** a LAZY global name→txd index (sorted archive order, first-wins,
names only — no pixel data retained) as the LAST-RESORT lookup behind the scoped def→txdp→fallback chain.
Scoped stays first (the lod-common plan-004 lesson). Resolutions land in `report.json`
`textures.crossTxd`, keyed `txd/texture`, each entry carrying the FULL triage view (user's ask): the txd
that LACKED the name, the donor txd it was taken from, the texture name, and every model that asked. The
pack log prints one ℹ line per rescue. Only a true universe-wide absence still takes the row-B grey
stand-in + `textures.missing`. Test: planner resolves a name absent from the def TXD but present in
another archive TXD, ledgered as crossTxd, missing stays empty.

**Field check: PENDING the next pak rebuild** — see `testing-checklist.md` for the six spot positions.

---

## Rows closed on a later build

### Row H — LV facade "holes": row C's ADDITIVE class erased a no-alpha night facade (FIXED 2026-07-23, field-PASSED 2026-08-12)

**Symptom (user, field, night 23:50):** see-through "holes" + a translucent look on the Old Venturas
Strip entrance facade; day is clean. The picked names (`vgsn_blucasign`, `vgnlowmall3`) were RED
HERRINGS — the AABB picker attributed pixels of the real subject to neighbours (`vgnlowmall3`'s box
spans the whole mall; the reported pos 2098/2076.1/31.7 is a box centre, not a hit point).

**The real subject** is the timed pair on the entrance: `casinoblock3_dy` (tobj 4→23, the solid arched
day wall) / `casinoblock3_nt` (tobj 23→4, flags 140 = DRAW_LAST + ADDITIVE, the fullbright night
dressing: `casinolights*` bulb lattices) over the always-on `casinoblock3` base block. At 23:50 the day
wall legitimately hides — vanilla shows the night model as a SOLID glowing facade (black fascia band
occludes, field-verified in the original build 2026-07-23, 23:21/23:25 screenshots).

**Root cause:** row C's fix classed EVERY submesh of a flag-8 def as pipeline class 4 (additive).
Vanilla only puts a model through blended render states on its ALPHA pass — a DXT1 no-alpha texture
draws OPAQUE regardless of the flag. Every `casinolights*` texture is DXT1 hasAlpha=false
(`txd-alpha.ts`), so vanilla renders `casinoblock3_nt` opaque; our additive classing made its black
texels invisible (holes into the block interior) and its mid texels a translucent wash. The circus neon
that motivated row C keeps class 4 legitimately — its glow textures (`neon_centrala`,
`circirctex4_neon`…) are DXT3 WITH alpha.

**Trace method (the full chain, 2026-07-23):** headless day/night A/B at the spot reproduced the user's
screenshots 1:1 (temp bench scenes + a screenshots-during-path driver); kill-tests (hiding objectTable
kinds via a temp engine switch) isolated the draws; `dump-cell.ts` (NEW inspector) read the welded
cell's objectTable — `_nt` = 3 groups all cls=4; decoded vertex meta proved the LAYERS were correct
(3561/3513/3381 & 0xff = 233/185/53 = casinolights5/3/2 — high byte is other packed data), killing the
layer-mismatch theory; pixel sampling killed the "bright beige" illusion (the wedge reads 43/37/34 in
BOTH renders — it is the dark marquee silhouette); `dump-dff-materials.ts` showed the base block's
AUTHORED night sets (pillars 170/181/175 lit, roof10L256 12/15/13 dark — both render faithfully). The
discriminator was the user's vanilla night check: the black fascia is SOLID there, and the kill-test
had already shown the base model has NO wall behind it — so the solidity must come from `_nt` itself
rendered non-additively.

**Fix (weld.ts `classOf`):** class 4 requires `alphaClass !== 'opaque'` — an additive-flagged def's
no-alpha submeshes stay lit geometry (class 0). Their vanilla fullbright night look is already covered
by row D (night-only window → nightIsDay prelit + emissive-vs-void mask 255 → glow ≈ full texture
brightness), and black texels now write depth and occlude. Offline re-weld of cell 8,8 confirms: the
23→4 row welds `[0,0,0,0,0]` (was `[4,4,4]` + kind-5 cls-4 scrollers); `casinoblock41_nt` (22→5) keeps
its blend/cutout groups `[0,0,0,0,2,1]`. Tests: weld routes flags-140 + DXT3-alpha (bin fixture) to
class 4, flags-140 + DXT1-opaque (trafficlight fixture) to class 0.

**The fix is IN the built pak — verified offline 2026-08-12** (`dump-cell.ts 2110 2076` against
`build/original/opensa`, the 2026-08-11 18:04 build). The night row reads
`#4 timed on=23 off=4 groups=3 [cls=0 …] [cls=0 …] [cls=0 …]` — **no class 4 anywhere in the 23→4
window**, which is the whole content of the fix; the class is assigned at weld time, so this is the pak
bytes, not an intention. (The 2026-07-23 offline re-weld predicted five groups for cell 8,8; this cell
welds three. The group COUNT is a welding detail, the CLASS is the claim.) `weld.ts` carries the rule at
`classOf`: `if (additive && alphaClass !== 'opaque')`.

**Field check: PASSED 2026-08-12** — the user drove the Old Venturas Strip entrance (~2110, 2076) at
night and reported it correct: no see-through, the facade reads solid. Row H closed, and with it the plan.
(The dark sloped marquee silhouette IS vanilla — authored `roof10L256` night prelit 12/15/13 — and was
called out in advance so it would not be read as a regression.)

### Row G — mod 46 "Animated Radars" (CLOSED 2026-07-22 late — engine correct, the DARK look is the mod's own texture)

**Field result after the rebuild:** the radar spawns and the dish ROTATES — the loud-warn fix (`a12fa71`)
plus the rebuild resolved the invisibility. The user then read the dish as "no texture" (renders black).

**Traced to data — the render is byte-faithful:** `ap_radar1_01.osm` carries its OWN 512×512 BC3 TEXS
(one layer, meta all layer 0, vertex colours white — `scripts/debug/dump-osm.ts` /
`dump-osm-meta.ts`); no `textures.missing`/`crossTxd` entries. The pak layer's opaque texels average
rgb 28/1/0 vs the source's 29/2/1 with identical opaque counts (187 802) and the same 28.4 %
transparent share (`dump-texel-avg.ts` + a block-level DXT1 decode). The source is mod 46's own
`ap_misc1bit.txd`: its `ap_radar` (512² DXT1a) is a NEAR-BLACK dark-red lattice whose slat gaps are the
transparent texels. Stock `ap_radar` (128² DXT3) is a BRIGHT RED frame with white slats. Vanilla +
modloader would render the same dark dish — this is the mod author's texture, not a pipeline loss.

**Data decision RESOLVED 2026-07-23:** the user deleted mod "46. Animated Radars" ENTIRELY (folders
renumbered to a contiguous 0..54 via the `renumber-mods` skill) — the next rebuild restores the stock
static red radars at all 4 airport placements (id 1682).

**Noted, separate:** this own-TEXS `.osm` (built by `pack-anim-objects`' `buildModelOsm` fallback, no
world dictionary) ships mipCount 1 — distant aliasing; the world-dictionary path bakes full chains.

### Row G history — the offline verification trail (kept for the method)

**Verified 2026-07-22 (correcting an earlier note: the "clip named '0'" reading was a debug-script bug —
the clip IS named `ap_radar1_01`):** the entire offline chain is consistent. The installer applies the
mod's `.ide.merge` (anim row present in the BUILD's multiobj.ide); the pak carries the model's static base
(42 idx welded, cell −7,−3) with the 1860-vert dish left out for the host (B7·b); `ap_radar1_01.osm` has a
valid SKEL (frames `bigsprunkpole`/`coe_bigsprunkcan_` — the mod author re-rigged the Sprunk-can skeleton,
that's authored, not a converter mixup); `radar.ifp` is in the build archive; `clipForModel` finds the clip
and `animatedFrames` marks exactly one moving frame. The runtime half (`engine-anim-objects.ts`) is wired
after `adapter.prepare()` and its roster comes from the same defs.

**Remaining suspect:** the runtime module's model build swallowed failures (`catch { built = null }`) —
a failed build means the moving part is simply MISSING in the world, which is the field report exactly.
That catch now logs `[anim-objects] <model> failed to build …` — the next live session reads the console
at the LS airport and gets the answer for free. (Also check spawn: RANGE 300 m, 1 birth/frame.)

### Row E follow-up — ground glow (deferred to 078 ledger #11; user owes the wanted behaviour)
