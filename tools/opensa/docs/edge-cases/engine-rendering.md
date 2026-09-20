# Engine rendering edge cases

Limits and deliberate approximations of the own WebGPU engine.

- **WebGPU `sampleCount` is 1 or 4 only**; alpha-to-coverage needs 4. No arbitrary MSAA ladder (the old
  `msaa`/`bloomq` params were removed for this).
- **World shadowing is baked, the sun doesn't track.** Per-pixel shading of the ~1,038 static 2dfx lamps
  cost 120 → 25 fps; instead the world carries a baked arc-averaged sun-visibility scalar. Street lamps
  light nothing but themselves — surface lighting from lamps is unimplemented (plan 074/17, deferred).
- **No runtime SSAO.** A vehicle carries its own AO instead: `vehicle/sky-occlusion.ts` computes per-vertex
  sky visibility from a height field over the car's shown shell (LOD/`_dam` excluded, so a convertible is
  not roofed by its own LOD blob) and it rides in the night set's alpha. It darkens what is UNDER something
  — cabin, underbody, exhaust — and nothing else: a panel gap and the contact with the ground still can't
  darken, and PEDS get no AO at all. Reflection strength stays an open row of plan 084.
- **A TEXTURED material with SA's `reflection` plugin but no env map still renders matte.** Reflectivity
  without an env map is granted to UNTEXTURED materials only (bare metal and plastic — exhausts, trim,
  bumper irons). The mods' exporter stamps `reflection` on every material it writes, so honouring it
  everywhere turned 100 % of both field mods reflective, carpet and tyres included. Plan 084 row 2.
- **Shader-stage limits are invisible to tests.** The fake GPUDevice doesn't validate the 16-varying
  fragment-input cap or binding visibility — two shader defects shipped through 2,325 green tests. Check
  WGSL by eye (a static check is a noted follow-up in plan 084).
- **A branch on a per-fragment value bans implicit-derivative sampling for the REST of the function.**
  WGSL's uniformity rules only allow `textureSample`/`dpdx`/`dpdy` in uniform control flow, and a `return`
  inside an `if` makes everything after it non-uniform too — so one branch poisons the whole function, not
  just its own arm. `rigidTexel` hit this the moment plates gave it a `matClass` branch (it fails at
  `createShaderModule`, i.e. at boot, and no test sees it). The fix: take `dpdx(uv)`/`dpdy(uv)` at the top,
  where the flow is still uniform, and have EVERY path sample with `textureSampleGrad` — identical mip
  selection, no restructuring.
- **The rigid (vehicle/ped) vertex output stands at 15 of those 16 inter-stage locations.** There is room
  for ONE more and no test will tell you when it is gone. Anything per-vertex a new feature needs has to
  ride an existing location's spare components instead: sky occlusion sits in `local.w` (plan 084), the
  license-plate atlas layer in `lamps.w`, and a plate's very IDENTITY is a `MaterialClass` value because
  the high nibble of `meta.w` was the only per-vertex channel left (plan 082/03). Note the knock-on: a
  fragment shader cannot be handed the instance index, so anything per-INSTANCE must be resolved in the
  vertex stage and forwarded as a single number.
- **A smashed lamp goes dark per PAIR on the MESH, per lamp everywhere else.** SA's light damage is per
  lamp (`eLights`: 0 FL, 1 FR, 2 RR, 3 RL) and the beam, pool light and corona all die one lamp at a time —
  they are geometry the game layer places (`vehicle-lamp.system.ts`). The lamp GLASS cannot: a DFF authors
  ONE lamp material per end, so both sides of a car share a submesh and the lit-twin swap plus the emissive
  glow can only be withheld when BOTH lamps of that end are smashed (`vsRigid`, gated on the mask in the
  lamp row's spare `w`). One broken headlight therefore still shows two glowing lenses with a single beam.
  Splitting the mesh per side would need a geometry split nothing in the pipeline does today.
- **Two-sided world rendering.** SA's static world renders without backface culling (mirrored coplanar
  pairs, `0x200000 DISABLE_BACKFACE_CULLING` honoured); glass is double-sided gated by
  `@builtin(front_facing)`. Roadsign glyphs render twice at ±0.05 m; sign text does not dim at night.
- **Particles are approximate.** No heat-haze refraction (prims skipped), tracks baked at 3 sample points
  (no rotation / texture-frame animation), emission approximated by a fixed `rate × life` budget, point
  emission only. Particle 2dfx on generated LODs is kept alive by a null-`m_SystemBP` guard.
- **No corona occlusion** — coronas draw through geometry at some angles (SA traces line-of-sight; the
  engine doesn't). Traffic-light bulb cycling isn't modelled. Vehicle headlights are an MVP — no projected
  road beam.
- **Escalators don't move** — the step renderer died with the three renderer; no replacement, no step
  colliders.
- **Stochastic de-tiling (`?stoch=`) is UNSTABLE v1, default off** (plan 074/12).
- **Frustum culling only** — SA's `occlu` occlusion volumes are unused; interiors are filtered out
  entirely.
- **Streaming shows seams at speed** (deferred to the plan-21 tuning round): ≤1 cell-create/frame can spike
  ~22 ms on fast traversal; free-fly can show late cells and magenta-before-texture; the HD↔LOD swap
  visibly steps at speed.
- **No moving colliders.** IFP-animated map objects don't collide with their moving parts; breakable shards
  land analytically (one ground probe, freeze); on-foot players can't smash props (contact events fire for
  chassis colliders only — matches vanilla); `_dam` damage-model swaps are unhandled (shatter only).
- **Player IFP root translation is ignored for LOCOMOTION** — it stays in-place, physics owns
  position, so the jump's height/arc is purely `movement.jumpSpeed` + gravity (plan 088/04): the
  authored root motion in `JUMP_*` clips does not contribute. The VEHICLE enter/exit clips are the
  exception (088/09a): their root travel IS replayed, endpoint-warped between the real doorway and
  seat. Air/land clips shorter than their state HOLD their last frame (the ~0.4 s `JUMP_glide` vs a
  ~0.9 s flight — looping it jerked mid-air, field 2026-07-24).
- **Only the DRIVEN car lights up** — headlights, tail lamps, their pool lights and coronas are per-vehicle
  state and the lamp system drives exactly one car, the one the player is in. Parked and traffic cars stay
  dark at midnight, and since retractable headlights follow the same signal, their pods stay parked too.
- **A `features.txt` declaration only reaches a car through the BUILD.** `UP/DOWN_LIGHTS` (and anything else
  a mod declares) is copied into `data/vehicle-features.txt` by `vehicle-installer` and consumed by
  opensa-pack. There is no runtime path that could pick it up later — a car with no `.osm` is refused at
  spawn rather than parsed from its DFF, precisely because such a car would silently lose this. Re-run
  `vehicle-installer --rebake` after editing a `features.txt`. The declaration's spelling and the rest of the
  vehicle name contracts: `docs/contracts/vehicles.md`.
- **The enter/exit choreography assumes a door that swings OUT, not UP.** The swing itself is generic (a
  rotation about the hinge frame's own local Z, so a mod's scissor door rises correctly), but the sequence
  around it — the 1.2 m standoff ring, the swept-arc clearance behind the hinge, the step-in path — is laid
  out for a panel sweeping horizontally. On a scissor door the player still walks a horizontal arc around a
  panel that is going vertical: correct, just more cautious than it needs to be. Nothing is measured for it
  yet.
- **The one perf knob is `?scale=`** (render scale, try 0.75 first on perf problems); there is no quality
  tier ladder on the engine.
- **Street-level foliage is fill-bound, and the cost is per-PIXEL, not per-triangle or per-draw.** Measured
  2026-07-21 (benchmarks #21/#22): the same ~1.46 M triangles cost 4.15 ms on a 90–120 m flyover and
  13.72 ms at 20–30 m over Ganton; removing 18 % of the triangles cut the pass 44 %, while draw calls did
  not move at all (1255 → 1258). Foliage also lands in the probe pass (2.45 → 1.57 ms on the same change).
  When a scene is slow, measure `gpuMs.pass` against leaf/canopy screen coverage — draws and triangle counts
  will mislead you.
- **The fog cut is a CULL, so a high camera sees nothing.** A cell lying entirely at or past
  `environment.fogCutDistance` (2 400 by default) is skipped, not drawn faded: at 100 % fog it is pixel-equal
  to the sky, so the frame graph drops it (074/21 P1). Correct in play, where the eye is at head height —
  but from a map-viewer altitude of ~4 km EVERY cell is past the cut, and the canvas comes back empty with
  the readout still reporting 562 resident cells. Found 2026-07-29 in plan 094 phase 2; the viewer now
  pushes fog to its far plane by default. Any camera far above the world has to move the fog with it.
- **Vegetation wind sway is the only thing an otherwise static noon frame animates.** Two runs of one
  scripted pose in sa-map-viewer came back pixel-identical everywhere EXCEPT the trees (mean Δ 0.02/255, max
  Δ 114/255, the difference map sitting exactly on the canopies). Anything doing a pixel A/B must set
  `environment.windStrength = 0` first, or the noise floor is the foliage.
- **…and the SEA is the second one.** The water pass runs its Gerstner trains off the frame clock, with no
  amplitude knob to still it, so any frame containing water is time-dependent: two runs of one scripted
  sa-map-viewer pose with the sea in view differ by mean Δ 0.006/255, max Δ 14.6/255 (094 phase 7). The gate
  is `Engine.waterEnabled` — switch the surface OFF for a pixel A/B (the viewer's `?water=0`, which
  `map-viewer-shot.ts` now sets by default); with it off, two runs are byte-identical again.
- **`trianglesRecorded` counts SUBMITTED clutter instances, so it is blind to the per-category range cull.**
  A clutter group whose bounding sphere lies entirely past its `drawDistance` is skipped on the CPU, and that
  group's triangles do leave the count. But a group the camera stands INSIDE is submitted whole and culled per
  instance in `vsClutter` (the instance is pushed outside the clip volume), and the counter has already added
  `indexCount / 3 × instanceCount` by then. Clutter cells are 256 units against ranges of 100–300, so the
  straddling case is the common one. **The column is accurate about vertex load and under-reports the fill
  saving** — measure a clutter-range change on `gpuMs.pass`, and read `avgTriangles` only as a direction.
  (Shipped 2026-08-10 with the ranges; the honest fix would be a counter the shader can decrement, which
  nothing else in the engine needs yet.)
- **`?procobjFloor=0` brings back a real defect, so treat it as an A/B knob and not a tuning one.** Without the
  species floor `procObjLimit` pools every candidate in a cell and keeps the lowest lotteries, so a species
  competing against many others loses all of its placements: measured 2026-08-11, **17 of 96 clutter cells
  (17.7 %)** lose at least one model, worst `8,-3` (~2125, −625) at 16 of 23. It reads as terrain that simply
  has no cacti, and nothing warns. **Fixed and ON by default since 2026-08-11**
  ([plan 012](../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md)) — this entry
  stays only because the old behaviour is one URL parameter away.
