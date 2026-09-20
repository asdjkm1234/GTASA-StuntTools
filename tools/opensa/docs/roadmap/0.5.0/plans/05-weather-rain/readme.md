# 05 — Rain & weather phenomena (timecyc-driven)

Full weather visuals driven by the timecyc/weather system the engine already samples (074/06 row 14):
rain is the headliner; the rest of the SA weather set rides the same drive. **And what the weather does to
the CAR**: the wet-tyre rule moved here from [081/10](../../../../plans/081-vehicle-physics/10-surface-types.md)
on 2026-07-27, because there is no rain to be wet from until this plan lands (piece 9).

**Migration note:** targets the 074 engine (WebGPU) — the particle/billboard pass from 06 row 13 is the
substrate for rain; the fog/sky/wind knobs already live in `Engine.environment`. The deferred
weather→wind rule ([02-weather-wind](../02-weather-wind/readme.md)) lands as part of this plan.

## The SA timecyc weather catalogue (what "everything" means)

SA ships 23 weather ids; grouped by the EFFECT they need beyond the timecyc colour/fog values the engine
already samples (074/06 row 14):

| Weather ids                                                                   | Effect class | Extra work beyond timecyc colours                                                           |
| ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| EXTRASUNNY/SUNNY × LA/SF/Vegas/countryside/desert (0,1,5,6,10,11,13,14,17,18) | clear        | none — colours/fog already drive it                                                         |
| SUNNY_SMOG / EXTRASUNNY_SMOG LA (2,3)                                         | smog         | haze tint rides the fog knobs; optional horizon dirt band                                   |
| CLOUDY × regions (4,7,12,15)                                                  | overcast     | sun gating (timecyc `dir` already darkens); softer shadows via `sunVisStrength`/`sunDirect` |
| RAINY_SF / RAINY_COUNTRYSIDE (8,16)                                           | rain         | particles + occlusion + WETNESS + PUDDLES (below) + thunder                                 |
| FOGGY_SF (9)                                                                  | fog          | dense fog values exist; add ground-hug boost (fogHeightK) + reduced far coronas             |
| SANDSTORM_DESERT (19)                                                         | sandstorm    | tinted particle wash + strong wind (weather→wind rule) + visibility crush                   |
| UNDERWATER (20)                                                               | special      | not a sky weather — handled by the water/interior system, out of this plan                  |
| EXTRACOLOURS 1/2 (21,22)                                                      | scripted     | colour-only (interiors/missions) — timecyc sampling covers it                               |

## Pieces

1. **Weather state machine**: SA weather ids per zone/time (timecyc rows already parsed), transitions with
   cross-blends (`sampleTimecycBlend` supports the blend — wire real FROM→TO instead of same-id).
2. **Rain particles**: instanced streak billboards in a camera-follow volume (cylindrical shell), count/
   length/tilt from weather intensity + camera speed; splash sprites at ground hits (cheap: probability ×
   ground plane estimate near camera). GPU budget gate like every effect row.
3. **Rain occlusion (dry under roofs)**: v1 = a small top-down depth render around the camera ("rain map",
   one 256² pass refreshed on cell change) sampled by the particle shader — reuses the engine's depth
   infrastructure; measured before accepting.
4. **Wet world**: weather-driven uniforms — darkened + slightly specular ground (a wetness factor on the
   world shader's indirect/direct mix), reflective streak on roads at night (cheap fresnel-ish term),
   drying transition after rain ends (a "wetness memory" scalar that charges during rain and decays after).
5. **Puddles (after-rain)**: standing water patches on near-horizontal asphalt/pavement. 074-friendly
   design reusing existing infrastructure: gate by surface class via the texture NAME-LIST mechanism
   (the stochastic list proved the offline curation loop — a `puddle-surfaces.txt` marks roads/pavements;
   bit in the spare layer-u16 space or a material table), mask by a world-space noise texture (stable
   puddle SHAPES, not shimmer) × up-facing normal × wetness memory; puddle pixels flip to a reflective
   response: `skyColorFor(reflect(view, up))` — the shared sky function gives sky-reflection puddles for
   ~free, fresnel-blended over the darkened wet diffuse. Drying shrinks the mask threshold so puddles
   recede from the edges inward — the classic look. (True mirror reflections of buildings = out of scope;
   sky + sun glint reads right and costs almost nothing.)
6. **Storm extras**: lightning (sky flash = a frame-long skyTop boost + delayed thunder), fog/sandstorm
   densities (fog knobs exist), overcast sun gating (timecyc already darkens `dir`).
7. **Weather→wind** (the deferred 02 idea executes here): windStrength/clock from weather id with
   cross-faded transitions.
8. **Interior/tunnel suppression**: reuse the rain-map occlusion; zones marked interior kill weather.
9. **WET GRIP — what rain does to the tyres.** The physics half, moved here from
   [081/10 step 6](../../../../plans/081-vehicle-physics/10-surface-types.md) on 2026-07-27 for the plain
   reason that **there is no rain to be wet from yet**: the weather system stops short of precipitation
   (`docs/features/weather-environment.md`: "rain/storm/sandstorm intentionally not selectable"), so a wet
   tyre rule would have had nothing to switch it on. See below — the seam it needs is already shipped.

## Wet grip (piece 9), in detail

**Everything on the physics side already exists**; this piece is the missing STATE and one rule.

What 081/10 shipped, and this plan consumes:

- `surfinfo.dat` is fully parsed, and every row's **`WET_GRIP`** is on the engine-side `SurfaceRecord`
  (`packages/game/src/interfaces/world-adapter.interface.ts`). The stock spread: **116 of 179 rows at 0.00,
  38 at −0.40, 18 at −0.25, 6 at +0.50, 1 at +0.40** — so most surfaces do not care, and the ones that do
  lose a quarter to a bit under half.
- `surface.dat`'s adhesion matrix is parsed too, and its own **WET group is 2.8 against road's 4.5** (0.62)
  — two different mechanisms in the data: a wet SURFACE (a puddle, a riverbed) versus a dry surface made
  wet BY WEATHER, which is what `WET_GRIP` is for.
- The wheel already knows what it stands on and is scaled by it every fixed step
  (`PhysicsWorld.readVehicleWheelAdhesion` → `setVehicleControls`), and **the steering limiter is given the
  same number** — that coupling must be preserved here, or the limiter promises lock the wet tyre cannot
  answer (the 081/09 mechanism).
- Instruments that will measure this one for free: `?surfGrip=0` for a one-URL A/B, the `[phys]` capture's
  per-lap `surfaces` block, the F2 wheel rows (`surface ×factor`), and the `grass-corner` scene's method for
  finding controlled ground.

What this plan must add:

1. **A wetness scalar the physics can read.** Piece 4 already needs a "wetness memory" that charges while it
   rains and decays after — **one scalar for both**, so a road that LOOKS wet IS wet. Anything else and the
   two halves drift apart on the same frame.
2. **The rule, taken from the original rather than invented.** The legend calls `WET_GRIP` a "wet multiplier
   on tyre grip" while the values are negative, so the shape is almost certainly
   `adhesion × (1 + wetGrip × wetness)` — **verify in the reversed source before coding** (repo rule: the
   game's own formula first; the same read settled `ROAD_ADHESION` and the `×0.001` in 081/05).
3. **Interior/tunnel agreement**: a car under a roof must not be on a wet road — reuse piece 3's rain map or
   the interior zones, whichever the visual half ends up using. One source of truth for "is this spot wet".
4. **Puddles are their own case**: a puddle (piece 5) is a wet SURFACE, not merely weather; if a puddle mask
   exists per-pixel it does not follow that the physics can sample it cheaply — decide explicitly whether
   puddles affect grip at all, or whether wetness is uniform under rain. Do not let the visual imply a
   physics that is not there.

**Read this before tuning it** — [`docs/open-issues/offroad-feels-like-tarmac.md`](../../../../open-issues/offroad-feels-like-tarmac.md):
the field verdict on the same class of change was "applied, verified, and almost unnoticeable", because a
grip CEILING is invisible until the tyre is against it. Wet grip will land in exactly the same place unless
it comes with what makes wet roads FEEL wet — the visual half (piece 4/5) plus, if the field asks for it,
SA's own extra mechanisms. Budget the field round accordingly, and do not answer a "cannot feel it" verdict
by scaling the constant.

**Verification owed**: the dry world must not move — the 081/07 regression pack
(`npx tsx scripts/phys-regression.ts`) is the gate, and it must pass untouched with rain off. Then an A/B of
the same scenes with rain forced, recorded in `docs/benchmarks/vehicle-physics/`.

## Tasks

- [ ] Weather state machine + real FROM→TO timecyc blending (+ debug `?weather=a,b,t`).
- [ ] Rain particle pass (instanced streaks + splashes) with intensity from weather; bench row (gate ≤ 1 ms
      GPU at storm intensity, 2× retina).
- [ ] Rain map (top-down occlusion) v1 + particle sampling; measure; accept/iterate.
- [ ] Wetness uniforms on the world shader (darken/spec/dry-out curve + the wetness-memory scalar).
- [ ] Puddles: surface name-list + world-noise mask + sky-reflect response + edge-inward drying; bench row
      (target ≈ free — it is a per-pixel branch on wet frames only).
- [ ] Lightning + thunder timing; smog/fog/sandstorm presets per the weather catalogue above.
- [ ] Weather→wind rule (closes ideas 02).
- [ ] **Wet grip (piece 9)**: the shared wetness scalar; SA's own `WET_GRIP` rule read out of the reversed
      source and applied per wheel through the existing adhesion path (limiter fed the same number);
      interior/tunnel agreement; an explicit decision on puddles-vs-grip.
- [ ] **Wet grip verification**: the 081/07 pack green with rain OFF (the dry world must not move), then a
      rain-on A/B of the same scenes recorded in `docs/benchmarks/vehicle-physics/` + a field round.
- [ ] Field matrix: each SA weather id screenshotted at 3 times of day; series bench rows for rain on/off.
