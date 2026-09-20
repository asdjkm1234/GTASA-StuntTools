# The install's SkyGfx fork: what its building pipe does with our geometry (2026-08-17)

**What this is:** the reference install (`NO_COMMIT/gta_sa`, [reference-install-config.md](reference-install-config.md))
runs `skygfx.asi` = the **JuniorDjjr fork** (<https://github.com/JuniorDjjr/skygfx>, `fb69df1`, 2026-01-13),
323 584 B, with `skygfx1.ini` and a 16 627-line `models/texdb.txt`. This file records what that plugin does to
a WORLD atomic — read out of the fork's source AND its shipped compiled shaders (`resources/cso/*.cso`,
constant tables + `dcl` inputs decoded), cross-checked with aap's original (`926616a`) and gta-reversed for
the stock side. It exists because a field verdict on this install can be a verdict about this plugin
([sa-lod-visibility-budget.md](../open-issues/fixed/sa-lod-visibility-budget.md), rounds 10–11).

## The install's settings that matter

| key | value | effect |
| --- | --- | --- |
| `buildingPipe` | `PS2` | world atomics on the building pipe draw with `ps2BuildingVS` (`"PC"` would mean the Xbox shader path — the fixed-function PC callback is not used at all: "The PC callback cannot be salvaged") |
| `stochasticTexturing` | `1` | tiled textures tagged `stochastic=1` in `texdb.txt` (306 names) get the de-tiling pixel shaders |
| `dualPassBuilding` / `zwriteThreshold` | `1` / `200` | alpha-blended building materials draw twice (alpha ≥ 200 z-writing, then < 200 not) |
| `explicitBuildingPipe` | commented | WHO is on the building pipe is still the STOCK rule (below) |
| `tagsBuildingPipe` | `Xbox` | only for tag (graffiti) atomics |
| `lightningIlluminatesWorld` | `1` | building ambient forced white during a flash |

## Who is on the building pipe (stock rule, unchanged by the fork)

The fork hooks the two building-pipe CREATORS (`0x5D7100` DN, `0x5D7D90` non-DN → one skygfx pipe, `buildingPipe.cpp:905-907`)
but leaves the attach decision to `CCustomBuildingRenderer::IsCBPCPipelineAttached` (`0x5D7F40`); its own
reimplementation of that check documents the rule: `pipe == nil && GetExtraVertColourPtr(geo) && RpGeometryGetPreLightColors(geo)`
— a geometry with a **night-colour chunk** (`0x253f2f9`) or a pipeline-set plugin. `cehollyhil06` stock and
built both carry the night chunk and an empty atomic extension → building pipe, with or without skygfx.

Stock consequence (gta-reversed `Entity.cpp` `0x533D30`): a building-pipe entity is NOT `m_bLightObject`,
so `SetupLighting()` / `ActivateDirectional()` never run for it — the world is drawn after
`DeActivateDirectional(); SetAmbientColours();`. **The sun never reaches building-pipe geometry, normals or
not, in stock SA either.**

## What the fork's shaders read — and do NOT read

**No building shader consumes vertex normals for lighting.** Verified on source and on the shipped `.cso`:

- `ps2BuildingVS` — inputs `POSITION0, TEXCOORD0, COLOR0 (night), COLOR1 (day)`; **no NORMAL input at all**.
  Colour = `day*dayparam + night*nightparam`, `*= matCol/colorScale`, `+= ambient*surfAmb`. Constant table:
  `ambient, combined, dayparam, matCol, nightparam, shaderParams, surfProps, texmat` — no light colour or
  direction.
- `xboxBuildingVS` — declares `NORMAL0`, uses it ONLY for env-map UVs (`mul(envmat, IN.Normal).xy`); the
  colour is the same prelit + ambient. `rpGEOMETRYLIGHT` there decides only whether the material's colour /
  surfProps or white are used.
- Every building PS (`simplePS`, `simpleDetailPS`, `simpleStochasticPS`, `simpleDetailStochasticPS`,
  `xboxBuildingStochasticPS`) = `tex * IN.color (* colorscale)`, plus a detail / env term. Constant tables
  carry `colorscale, tex` only. (`vehicleVS` by contrast has `directCol, directDir` — the VEHICLE pipe does
  light by normals; the building pipe never does.)
- The instance callback `DNInstance_PS2` DOES put normals into the vertex buffer when `rpGEOMETRYNORMALS`
  is set (a 12-byte `NORMAL` element, stride 28 → 40) — the PS2 VS then ignores that element.

So in this plugin there is **no "prelit + normals" combination** that double-lights or drops prelit; prelit
is always the per-vertex light term, and a non-prelit geometry is instanced with forced white.

## The stochastic path (fork-only; aap's tree has no `stochastic` string)

`StochasticSamplerPS.hlsl`: UV space is skewed onto a triangular lattice (period ≈ 1/3.464 UV, callers
pre-scale ×1.2) and the fragment is the **barycentric blend of three samples of the same texture, each
offset by a hash of its lattice vertex**, with explicit `ddx/ddy` so mips stay right. Then `* IN.color`
exactly like the plain PS. Nothing in it depends on normals, on the mesh being a list or a strip, or on the
material's flags. **By construction it IS a "giant triangle-interpolated" pattern in UV space** — on a
surface whose UVs span few periods it reads as large triangular ghost patches.

`texdb.txt` (`src/texdb.cpp`): one line per texture NAME — `alphamode / isdetail / hasdetail / detailtile /
hassibling / affiliate / stochastic / dualPass / zwriteThreshold`; matching is by lowercase name, world-wide,
no per-model scope, and `stochastic` is carried across `affiliate`. Install census: 306 `stochastic=1`,
479 `hasdetail`, 1 870 `alphamode`, 1 138 `hassibling`. `cehollyhil06`'s atlas: `cs_rockdetail2 stochastic=1`
(the vertex-alpha rock detail layer), `desgreengrass hasdetail=2 stochastic=1`, `desertgryard256 hasdetail=2
detailtile=120 stochastic=1`; the rest untagged.

## What the fork's instancer does differently — the one structural surface

`DNInstance_PS2` (`buildingPipe.cpp:643-818`, same in aap) replaces RW's default instance callback for
building-pipe atomics: it builds its own vertex declaration, instances vertex COLOURS per mesh over
`[minVert, minVert + numVertices)` and derives `vertexAlpha` per mesh. Primitive type is whatever RW put in
`resEntryHeader->primType` — no branch on list vs strip. **This is the only place where a re-encoded mesh
(a `BinMeshPLG` our optimizer regenerated) is handled by fork code instead of the game's**, and therefore the
only structural reason a re-encoded model could look different WITH the plugin and fine WITHOUT it.

## Measured (2026-08-17, field)

`stochasticTexturing=0` does NOT remove the optimizer-output smear; `buildingPipe=` (empty) DOES — the fork's
building pipe (instancer + VS) is the surface that mishandles our re-encoded geometry, and the game's own
pipe draws the same bytes correctly. **Resolved (round 14):** the property was our regenerated `BinMeshPLG`'s
split ORDER — a blended split moved out of last place; the fork's dual pass (z-write at alpha ≥ 200) turns that
into a smear where the game's own pipe hides it. Neither normals nor the trilist form (`--restrip` was broken
too). See `restrictions/assets-and-data.md`, "A BinMesh's split order is the DRAW order".

## What is caught

Nothing. The build validates, our own engine renders the same bytes correctly, and the plugin's ini is
runtime-toggleable — the instrument is a field run with `stochasticTexturing=0`, then `buildingPipe=`
(empty → the pipe is not hooked), then the plugin removed. Recorded in
[sa-lod-visibility-budget.md](../open-issues/fixed/sa-lod-visibility-budget.md) round 11 as the probe order.

## Sources

- <https://github.com/JuniorDjjr/skygfx/blob/master/src/buildingPipe.cpp>, `src/texdb.cpp`, `src/main.cpp`,
  `shaders/vs/ps2BuildingVS.hlsl`, `shaders/vs/xboxBuildingVS.hlsl`, `shaders/include/StochasticSamplerPS.hlsl`,
  `shaders/ps/2_a/simpleStochasticPS.hlsl`, `resources/cso/*.cso`
- <https://github.com/aap/skygfx/blob/master/src/buildingPipe.cpp>
- gta-reversed `Pipelines/CustomBuilding/CustomBuildingPipeline.cpp`, `Entity/Entity.cpp`, `Renderer.cpp`
- Local: `NO_COMMIT/gta_sa/skygfx1.ini`, `NO_COMMIT/gta_sa/models/texdb.txt`, `NO_COMMIT/gta_sa/skygfx.asi`
