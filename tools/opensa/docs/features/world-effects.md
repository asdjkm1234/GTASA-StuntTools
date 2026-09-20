# World effects (2dfx particles + escalators)

Data-driven particle emitters for the map's 2dfx type-1 entries (plan 044): fires, smoke
columns, steam vents, fountains — 113 entries across the shipped map, each naming a system in
`effects.fxp`. Plus the 2dfx type-10 escalators (×6): moving step rows along baked paths.

## Implemented

- **2dfx type-1 parsing** — `RWParticle2d { effectName, position }` on `RWGeometry.particles`
  (`parsers/binary/dff.ts`); positions are geometry-local (like lights, unlike roadsigns).
- **effects.fxp parser** — `parseFxp` (`parsers/text/fxp.parser.ts`): `FX_SYSTEM_DATA` blocks →
  `FxSystem { cullDist, boundingSphere, emitters }`; each `FX_PRIM_EMITTER_DATA` →
  `FxEmitter { texture, srcBlendId, dstBlendId, tracks }` with keyframed tracks keyed
  `"<info>.<channel>"` (emrate.rate, emlife.life/bias, emspeed.speed/bias, emdir.dir*,
  emangle.min/max, force.force*, size.sizex/y, colour.red/green/blue/alpha). `sampleFxTrack` =
  clamped linear interpolation.
- **Runtime emitters** — the bake is shared and renderer-agnostic (`renderware/src/fx/bake-fx.ts` +
  `sprites.ts`), driven by `apps/web/src/ui/engine-particles.ts`, which loads the LIBRARY once at
  bootstrap (`effects.fxp` + `effectsPC.txd`, absent-tolerant — no files, no particles) while the pak
  carries the emitter ANCHORS (welded per cell by the converter).
  `bakeFxSystem`/`bakeFxInstances` bake tracks into per-particle attributes (velocity cone around
  EMDIR within EMANGLE, life±bias, phase; deterministic mulberry32 so rebuilt cells are
  identical) + uniforms (colour/alpha/size sampled at age 0/0.5/1 — piecewise envelope, covers
  the 0→peak→0 fire shapes; COLOUR with COLOURBRIGHT fallback; force, CULLDIST fade). The
  lifecycle loops entirely in the vertex shader off a single time uniform — zero per-frame CPU work.
- **Draw batching** — two instanced passes over one sprite atlas: DSTBLENDID=1 → additive (flames,
  sparks), else premultiplied alpha (smoke). Particle counts are capped per emitter, and the buffers
  are rebuilt only when the streamed cell set changes.
- **Map plumbing** — 2dfx type-1 entries are frame-transformed to world space by the converter
  (`tools/opensa-pack`) and stored as per-cell anchors; the host resolves each anchor's `effectName`
  against the loaded library. **Both levels since plan 100/03**: a LOD bundle takes its anchors from the
  baked cell model's own 2dfx section, so an emitter survives the HD ring instead of vanishing at ~440 u.
  The shipping pak carries **943 anchors across 13 systems** in its 569 HD cells (`insects` 336, `vent` 209,
  `vent2` 162, `cigarette_smoke` 87, `fire` 53, the four smokes 77 between them, the rest single digits);
  the LOD level carries 888 of the same anchors, so the two levels must not be summed. Read off the bytes by
  `scripts/debug/fx-anchor-census.ts` — plan 100's ledgers quote 878/`insects` 402/`cigarette_smoke` none
  from an in-process bake count, which the pak does not bear out.
- **Draw distance is each system's authored `cullDist`** (plan 100/04). Until then one flat 300 was written
  into every system record, so a cigarette plume rendered 20× further than authored while a factory plume
  stopped at 300 whatever the streamer kept resident. `fxDrawDistance` reads the fxp value per system, with
  exactly two recorded departures: the four smoke systems take the host's LOD radius (so a plume lives as
  long as the chimney it rises from — [hack](../hacks/smoke-drawn-to-world-edge.md)) and
  `insects`/`cigarette_smoke` are floored at 100 instead of their authored 15
  ([hack](../hacks/tiny-fx-distance-floor.md)). 300 survives only as the fallback for a modded system that
  authors no `cullDist`. Shipped values: `vent`/`vent2`/`waterfall_end` 25, `water_fountain` 30,
  `fire`/`flame` 35, `carwashspray` 70, `insects`/`cigarette_smoke` 100, `prt_*` 300, smoke → LOD radius.
- **The DYNAMIC lane is floored at 300** ([hack](../hacks/vehicle-fx-lane-reach.md)) — a floor on the LANE,
  applied by `buildDynamicLibrary` alone, not a row in the departures table. Every `prt_*` system authors 50,
  which is a cheap guard on effects SA only spawns around the player; we spawn them for every vehicle, so read
  literally it ended another car's tyre smoke 50 m away.
- **Live config** — `graphics.effects { enabled, drawDistanceScale }` (init config + debugger → Graphics →
  "World effects"). `enabled` gates both lanes (`engine.particlesEnabled`); `drawDistanceScale` (default 1,
  slider ×0.25–×4) multiplies every system's SHIPPED distance — authored, departed or floored — and is applied
  last, inside `fxDrawDistance`. It rides in on `rebuild(scale)`: a changed value re-bakes the placed lane
  (it is in the upload signature) and re-installs the dynamic lane's records, which are otherwise built once
  at boot. It replaces the plan-044 `drawDistance` knob, which had REPLACED each system's authored cullDist
  and, since the three renderer went, reached no code at all (found by the plan-100 audit).
- **Escalators (2dfx type 10)** — `RWEscalator` parsing only (geometry-local path
  start → bottom → top → end + direction). The moving-step RENDERER was deleted with the three
  renderer (074/13) and has **no replacement on the engine** — escalators currently do not move.
  Hosts, for whenever it is redone: escl_la ×4, escl_singlela, shack02, vgseesc01/02.

## Known gaps

- Heat-haze prims are skipped (screen-space refraction pass not implemented).
- Tracks are baked at 3 sample points (age 0/0.5/1) — no full keyframe interpolation, no
  particle rotation (EMROTATION/ROTSPEED ignored), no texture animation frames.
- The PLACED (2dfx) lane approximates emission by a fixed particle budget (`rate × life`, capped), not a
  spawn-rate simulation; EMSIZE/EMBOX emitter volumes ignored (point emission). Since 089/01 a separate
  DYNAMIC one-shot lane exists (`Engine.spawnParticle` + `createEmitter` in `engine-particles.ts`): pooled
  CPU spawns at runtime points, real rate accumulation / caller-driven `burst(count)`, same shader with an
  age-clamping `oneShot` pipeline override. Its systems are a boot-time list (`DYNAMIC_SYSTEMS`) — the
  lane's atlas cannot grow after install. 089/03 added the engine's first DECAL lane beside it
  (`Engine.initSkidMarks`/`addSkidSegment`): ground ribbon quads in a world-wide ring, fading on the wall
  clock — today's only writer is the vehicle skid marks.
- **Escalators (REVISIT)** — not rendered at all since the three teardown. When redone, also settle
  the old open item: no step colliders, so the player can't ride them (vanilla carries standing
  entities with the step). Likely shape: static ramp collider on the incline (check the host COL
  first) + a velocity impulse while standing on it. Step model was always `esc_step` — the LV
  travelators may want the wide `esc_step8` variant.

## Test coverage

- `parsers/binary/particle.test.ts` — type-1 parsing on the real `skullpillar01_lvs.dff`
  (1 entry, `fire`, pos (0, −0.3, 2.1)); trafficlight negative/lights regression.
- `parsers/text/fxp.parser.test.ts` — real `effects.fxp`: 80+ systems, fire layer structure,
  prt_blood keyframe reference values, all 15 map-referenced effect names resolve.
- `fx/bake-fx.test.ts` — real fxp: dead/heat-haze prims dropped, additive-vs-alpha blend from the
  authored dst id, `rate × life` particle counts, phase spread, determinism, the system record layout.
  `fx/sprites.test.ts` — the RGB-on-black sprite alpha synthesis.
- `ui/engine-particles.test.ts` — the GTA Z-up → engine Y-up direction/force conversion.
- `parsers/binary/escalator.test.ts` — type-10 parsing on the real `escl_la.dff` (pair, opposed
  directions, flat landings + rising incline). No render-side test exists — there is no renderer.
