# 04 — Real light from 2dfx coronas (blink-synced surface lighting, wet-road reflections)

**STATUS: DRAFT** — part of the [04-graphic-improvements](readme.md) idea bundle (0.6.0). Recorded
2026-07-23 from the 085 row E investigation; the user closed row E for the current iteration in favour
of doing this properly later.

## The problem (085 row E — Ten Green Bottles, the exemplar)

At the Ten Green Bottles bar (Ganton, ~2345.5 −1704.8) the reference build spreads a GREEN glow across
the ground and walls at night, and the glow BLINKS in sync with the green coronas on the bottle sign.
Our engine shows the coronas (steady) and no surface glow at all.

Field-verified mechanics (user, original build, 2026-07-23): the glow is NOT the junction's traffic
light (it stays red while the wash is green); it is tied to the sign's coronas — corona off → wash off.

**Data trace.** The coronas come from mod "19. Project Immerse-Yourself", which replaces
`liquorstore02_lae2` (the bar building) and authors EIGHT 2dfx light entries on the bottles. Raw entry
fields (decoded 2026-07-23; our parser currently reads only a subset):

| Field           | Value             | Meaning                                                        |
| --------------- | ----------------- | -------------------------------------------------------------- |
| colour          | rgba 15,230,0,200 | the green                                                      |
| coronaFarClip   | 100               | corona draw distance (we read this)                            |
| **range**       | **18**            | point-light radius — the surface wash (we DROP this)           |
| coronaSize      | 1                 | billboard size (we read this)                                  |
| **shadowSize**  | **8**             | SA's ground splat radius (we DROP this)                        |
| **showMode**    | **3**             | FLICKER_NIGHT — the blink pattern (we DROP this)               |
| shadowColorMult | 40                | splat intensity (we DROP this)                                 |

In SA one 2dfx light drives three things from ONE on/off state: the corona billboard, a ground splat
(`shadowSize`), and a `CPointLight` of radius `range` that lights world geometry and entities. The
blink pattern (`showMode`) gates all of them together — that is exactly the reference behaviour.
`showMode` also encodes the traffic-light phase modes (7/8): implementing it fixes the long-standing
row E wart "all three traffic-light colours glow at once".

## What the engine already has / lacks

Has:

- Coronas render (additive billboards, night-gated) — no blink.
- The world shader carries BOTH halves of local lighting: `localLightDynamic` (per-pixel, vehicle
  head/brake lights) and `localLightStatic` (per-vertex — SA-faithful for static lamps). The static
  half is currently UNFED: static 2dfx lights left the pool on 2026-07-17 ("lamps igniting ahead of
  the car" — see [02-hd-cell-lamps.md](02-hd-cell-lamps.md) and 074/17).
- A per-frame light pool (cap 64, dynamics first) with cone support.

Lacks:

1. Parser: `range`, `showMode`, `shadowSize`, `shadowColorMult` are skipped (`parse2dEffects`,
   `packages/renderware/src/parsers/binary/dff.ts` ~446).
2. Format: `OscellLight` (28 B/row) carries position/colour/size/farClip/owner only — no range, no
   showMode. Needs an oscell minor bump + weld `collectLights` pass-through → **pak rebuild**.
3. Engine: no blink function; nothing feeds visible cell lights into the pool.

## Staged plan (each stage independent, data reused throughout)

### Stage 1 — data + blink + diffuse wash (the row E closer)

- Parser keeps `range`/`showMode` (+`shadowSize`/`shadowColorMult` for later) in `RWLight2d`.
- Weld carries them into `OscellLight` (oscell minor bump; old paks keep reading).
- Engine: one shared `blinkFactor(showMode, gameClockMs, seedFromPosition)` drives BOTH the corona fade
  and the light's pool intensity. Deterministic (seed from the anchor position) so every client blinks
  identically. Covers: default/night, flicker modes, flash duty cycles, traffic-light phases (7/8),
  train-crossing alternation.
- Feed visible cell 2dfx lights into the pool's static range (radius = authored `range`, colour ×
  blink × night gate). The 2026-07-17 lessons are HARD requirements: smooth admission (distance +
  rank fade with hysteresis), no binary pops; verdicts on the real display, not headless.
- No ground splats: the authored `range` diffuse IS the pool of light — the fake splat becomes
  unnecessary by construction.

### Stage 2 — wet-road reflections (the "real light reflecting" ask)

Analytic specular from the same pool lights in the world shader: a camera-vs-light half-vector term
whose gloss rides the existing rain wet-look state. Cheap (a few ALU per light per pixel over the
per-pixel range), gives the classic stretched neon streak on wet asphalt. No SSR, no ray tracing.
Design decision owed: whether world specular applies only in rain (prod-like) or always-on-low.

### Stage 3 — scale (the whole LV strip lit at once)

The 64-light pool with per-pixel iteration caps how many coronas can cast real light. When the goal
becomes "every casino corona lights the street", move the per-pixel half to clustered/tiled lighting:
a compute pass bins lights into screen tiles (or froxels), the pixel loops only its tile's list.
Standard WebGPU territory (storage buffers + compute); an isolated renderer upgrade that changes no
data formats — stages 1–2 carry over untouched. This is also the natural meeting point with
[02-hd-cell-lamps.md](02-hd-cell-lamps.md) (light ALL lamps of loaded HD cells) — one design should
serve both.

## Non-goals

- Shadow maps from local lights — expensive, and SA's look never had them; the hd-realtime concept
  round may revisit.
- SA's splat "shadows" (`shadowSize` textures) — superseded by real diffuse in stage 1; the fields are
  still carried in case a stylised splat is ever wanted for LOD distances.

## Cross-links

- 085 row E (`docs/plans/085-map-object-appearance/readme.md`) — the symptom, the reverted pool
  restore, and the trace that produced this plan.
- [02-hd-cell-lamps.md](02-hd-cell-lamps.md) — the same pool-admission failure history and the
  cell-scoped lighting alternative; stage 3 should be designed together with it.
- `docs/plans/074-opensa-engine/17-map-lighting.md` — the 2026-07-17 removal record (four prod
  mechanisms v1 lacked).
