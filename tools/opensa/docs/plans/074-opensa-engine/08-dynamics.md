# 074·08 — Dynamics (character, vehicles, particles, procobj)

[← chain](readme.md) · prev: [07 baked](07-baked-channels.md) · next: [09 post-FX](09-postfx-aa.md)

The grind — scheduled with an EARLY architecture probe so skinning can't invalidate the renderer late (the
concept's explicit risk). Dynamics render through the direct-encoder path (01): flat entity list, transforms in
one storage buffer with dynamic offsets, NEVER inside static bundles (the 073 barberpole lesson).

## The early skinning probe (runs right after M1, not in M3)

One skinned mesh (CJ, one idle clip) through the whole intended path: bone palette in a storage buffer,
vertex WGSL skinning, an OWN IFP clip sampler (the prod `AnimationController` rides three's `AnimationMixer` —
NOT portable; the sampler is small: keyframe lerp/slerp over the parsed IFP data we already have).
**Purpose: freeze the bind-group/vertex-layout consequences of skinning while the architecture is still soft.**
Deliverable = a lab toggle + a one-page "what it forced us to change" note in this doc.

## Full scope (M3)

| Piece                                   | Design                                                                                                                      | Reuse                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Character                               | skinned pipeline variant; palette/frame in storage; A-pose→clip via own sampler                                             | IFP parser, bones/retarget logic (pure parts), setup-character data |
| IFP animation set                       | sampler + crossfade (the controller's blend semantics re-implemented thin)                                                  | clip tables, existing anim names/config                             |
| Vehicles                                | rigid part hierarchy flattened per frame into the transform buffer; damage = part swaps; paint/env: SA sphere-map WGSL port | build-vehicle part logic (data side), carcols, reflection math      |
| Night fill (plan 034)                   | WGSL module on the dynamics shader                                                                                          | 073 night-fill port (emissive hemisphere + rim)                     |
| Near shadow (dynamics-only)             | one small map rendered from casters; world+dynamics sample it near-field                                                    | 07 decision; sky-lite sun arc drives it                             |
| Particles / coronas / headlight sprites | instanced billboard pass (06·13 shares it)                                                                                  | shader math                                                         |
| Procobj clutter                         | TRUE instancing (one draw per batch × placements) — the natural instancing case                                             | procobj placement/wind data                                         |
| Physics/gameplay                        | NOT here — the lab drives entities from recorded paths; real gameplay arrives in 10                                         |                                                                     |

## Coverage matrix (user checklist, 2026-07-12 — where each concern lives)

| Concern                         | Covered?               | Where                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Camera                          | ✅ plan 10 (B3)        | The game camera is GAMEPLAY code (renderer-agnostic per the plan-10 audit) — it produces a `CameraState` per frame; the engine consumes it. Follow-cam/collision logic reuses as-is                                                                                                                                                                                                           |
| Vehicles (render)               | ✅ here                | rigid part hierarchy → per-frame flatten into the transform storage buffer                                                                                                                                                                                                                                                                                                                    |
| Vehicle damage                  | ✅ here                | SA's ok/dam GEOMETRY STATES per part — damage = part-visibility swaps in the entity's part list (render side); the deformation physics idea is separate (ideas 0.6.0/01 VehDeform)                                                                                                                                                                                                            |
| Dummy hierarchies               | ✅ here (explicit now) | DFF frame/dummy tree (wheel*\*, door*\*, exhaust, headlight dummies) parses into the part hierarchy; dummies drive part transforms, light/exhaust anchor points, and the 2dfx attachment slots                                                                                                                                                                                                |
| Reflections (vehicle paint/env) | ✅ here                | SA sphere-map env WGSL port + carcols; per-pixel on the vehicle pipeline variant                                                                                                                                                                                                                                                                                                              |
| Reflections (world/planar)      | ❌ out of scope        | SA has no world planar reflections; if ever wanted → post-M4 idea                                                                                                                                                                                                                                                                                                                             |
| Character rigging               | ✅ here                | skinned pipeline variant, bone palette in storage buffer, DFF skin data                                                                                                                                                                                                                                                                                                                       |
| Character animation             | ✅ here                | OWN IFP sampler + thin crossfade re-implementation (three's AnimationMixer not portable) — THE early probe                                                                                                                                                                                                                                                                                    |
| IDE anim objects (world)        | 🟡 static now → here   | Welded STATIC at bind pose since the 2026-07-12 field fix (06 row 17 — skipping them deleted whole buildings). Runtime IFP playback = promote the instance to a dynamic entity (same IFP sampler as characters, frame-tree transforms per clip frame); the welder then needs an `--anim-dynamic` exclusion so promoted defs stop being baked into bundles                                     |
| Breakable props (plan 045)      | ✅ here (explicit now) | Old path registers smashables per HD cell (`collectBreakables`). Own engine: breakables are welded into the static bundle until HIT — on break, carve = per-instance groups stay addressable via the objectTable mechanism (06 row 9's kind byte has room for a `breakable` kind: hide the intact run, spawn debris as dynamic entities). Same promote-on-interaction pattern as anim objects |

## Probe note (B1, 2026-07-13 — what the probe built and what it forced)

**Built (one ped through the whole intended path):** `tools/opensa-pack/src/ped-probe.ts` extracts a
throwaway fixture (`public/ped/ped.json+bin`) — male01 + IDLE_stance/WALK_civi (1166 verts, 32 bones);
`packages/engine/src/anim/ifp-sampler.ts` (own keyframe slerp → palette, zero steady-state allocation);
pipeline #11 `ped` (storage-buffer matrices: slot 0 = model, bones follow; 4-bone vertex blend; textured
sun/indirect + shared fog); lab `?ped=1` (+`?pedy=` height), HUD `ped sampler` ms line, clips alternate 6 s.

**What it forced / froze (the probe's purpose):**

1. **A second vertex layout family.** Dynamics do NOT ride the `.oscell` interleaved stride-36 layout —
   the ped uses five tight attribute buffers (pos/normal/uv/joints u8x4/weights unorm8x4). Consequence:
   pipelines are keyed by layout FAMILY, not just effect — accepted, the registry stays enumerable (11).
2. **Bind model holds.** Group 0 (frame UBO + sky LUT) is shared untouched; dynamics live in their own
   group 1 (storage matrices + texture). No bind-group-layout churn was needed — the 01 frequency model
   survives skinning.
3. **Palette convention:** [model, bone 0 …] in ONE storage buffer, model matrix owns the GTA→engine axis
   change (geometry stays native RW bind space — parity with the prod skinned path, and the transform
   buffer generalizes to vehicles' part hierarchies).
4. **The prod bone lore ports cleanly:** HAnim skin-order mapping, skin-plugin inverse binds (pad-row
   fix), root anchoring, in-place locomotion (no root translation) — all re-encoded in the extractor,
   sampler parity pinned by unit tests (bind-pose identity, child-carry, slerp/wrap).
5. **Textures:** probe uses a plain `texture_2d` (rgba8unorm-srgb). M3 will need the real ped TXD set
   through `.ostex` (1-layer arrays or a dedicated dynamics texture path) — open, deliberately not decided
   by the probe.

## Tasks

- [x] **Skinning probe (early — gate M1→M2 boundary)**: storage palettes + WGSL skin + IFP sampler + probe
      note — 2026-07-13, see above. FIELD ✅ same day: the ped renders and both clips animate through the
      own sampler (`?ped=1` on the full-LS pak; two boot fixes on the way — writeBuffer %4 padding on the
      odd u16 index payload, and a zoomed camera start: a 1.8-unit ped is subpixel at a city orbit radius,
      and the default probe height sat below the terrain — `?pedy=` overrides). The ≤1 ms sampler ledger
      row: HUD reads the cost per frame; record it with the B2 entity-count measurements.
- [x] **(B5 step 1) Engine capability for real vehicles — 2026-07-14.** The B2 probe was a SINGLE slot
      (`private vehicle` + `setVehicleProbe` evicting the previous car) drawing every submesh
      unconditionally: nothing the gameplay needs (many parked cars, `_ok`/`_dam` swaps, `_vlo` bands,
      detached debris, door hinges, wheel scale) was expressible. Now:
      **MODEL ↔ INSTANCE split** — `createVehicleModel` uploads geometry + the texture array once;
      `createVehicle` spawns instances that SHARE them, each owning its own `RigidEntity`. All instances of a
      model live in ONE matrix storage buffer and draw with `firstInstance = slot × partCount + part`, so the
      **WGSL is unchanged** from the single-probe days (it already read `matrices[instance_index]`). Capacity
      starts at 8 and DOUBLES on demand (buffer + bind group rebuilt — safe precisely because vehicles are
      never recorded into a cell bundle; the row-15 immutability lesson applies to bundles only). Growth
      re-uploads live instances immediately, else a frame drawn before the next `updateVehicles()` reads an
      uninitialized buffer and flings the existing cars across the map for one frame.
      **Per-submesh visibility** per instance (`setSubmeshVisible`) — the one primitive behind damage swaps,
      LOD bands and detach, because prod expresses all three as three's `.visible`.
      **`RigidPartInit` gained `pivot` and `scale`; `RigidEntity` gained `setPartWorldMatrix`** — doors swing
      about the `door_*_dummy` hinge rather than the part origin (prod pivots a parent Group there), wheels
      take `vehicles.ide` wheelScale, and a detached part carries its own WORLD matrix, bypassing root and
      locals: the own engine has no scene graph to `parent.attach()` debris into, and this is its stand-in.
      Lab: `?vehicle=N` drives an N-car convoy off ONE model (the multi-instance check). 3 new unit tests
      (hinge swings about the pivot, uniform scale pins the origin, detach ignores the root and re-attaches).
      KNOWN COST KNOB: one draw per visible submesh per car (the landstal fixture has 73) — fine for a
      handful of cars, to be measured when a street's worth of parked cars lands in B5 step 4.
- [x] **(B5 step 2) Shared vehicle BUILDER — 2026-07-14.** `@opensa/renderware/vehicle/build-vehicle-model`
      (+ `vehicle/textures`, `vehicle/types`): renderer-agnostic, browser-callable, so the game builds a car
      at SPAWN time instead of loading a pre-extracted fixture. Signature mirrors prod's
      `buildVehicle(clump, textures, options)`, so tests pass synthetic clumps exactly like the three one.
      Carries the lore the B2 probe SKIPPED: all four wheel conventions (shared `wheel`, per-corner
      `wheel_lf|rf|lm|rm|lb|rb`, the `f_wheel_*` container, and the lone-corner = MIS-NAMED-shared fallback
      that saves comet-style mods), `_ok`/`_dam` damage twins, `_vlo` LOD meshes, `extraN` mutually-exclusive
      alternatives, door hinges, `vehicles.ide` wheelScale, lamp head/tail tags, the night lamp twin.
      **PAINT IS A SLOT, NOT A BAKE** (the design decision of this step): the probe baked carcols into vertex
      colours, which with shared-per-model geometry would mean ONE colour per model — a street of identical
      parked cars, or a geometry copy per colour. Now the vertex carries a paint SLOT (`meta.z`: 0 = the
      material's own colour, 1-4 = primary/secondary/tertiary/quaternary) and the engine resolves it PER
      INSTANCE from a new paint storage buffer (rigid bind group binding 3), indexed by the same
      `instance_index` as the matrices — 4 colours replicated per part row, which costs a few hundred bytes
      per car and avoids both a partCount uniform and an integer divide in the vertex shader.
      `VehicleInstance.setPaint()`; written on spawn/change, never per frame (so a capacity grow must restore
      it — it does). Marker colours (lamp IDs and paint markers) now render WHITE: leaving the marker in the
      vertex colour would paint the car marker-green the moment a slot lookup missed. A test caught exactly
      that.
      `frameWorldTransform` + `rotationToQuat` MOVED opensa-pack → `renderware/mesh/frame-transform` (one
      implementation, two consumers — the welder and the builder). `vehicle-probe.ts` is now a THIN CLI over
      the builder (500 → 120 lines): it only bakes the fixture the lab reads, so the lab needs no DFF parser
      and no game VFS. Fixture type `VehicleFixture` lives with the model, shared by CLI and lab.
      REAL-DATA CHECK (landstal): 18 parts, **4 doors, 44 `dam` submeshes, 6 `lod` submeshes** — all three
      were ZERO before; 123 submeshes total of which 73 visible, so the draw count is unchanged.
      9 builder unit tests. Golden WGSL snapshot updated (the paint lookup).
- [x] **(B5 step 3) `VehicleHandle` — three is OUT of vehicle gameplay — 2026-07-14.** The plan-10 audit's
      Tier 0. `packages/game/src/vehicle/vehicle-handle.ts` is the renderer-agnostic contract gameplay drives
      a car through: `setTransform` · `setWheel(i, spin, steer)` · `setDoorAngle(side, angle)` ·
      `setPartDamaged` · `detachPart`/`setDetachedPose`/`removeDetached` · `setLodBand` · `doorHinge` ·
      `parts`/`wheels`/`hasLod`. Everything crossing it is plain data.
      Ported: `VehicleRig` (now PURE arithmetic — it emits ANGLES, the renderer makes rotations),
      `VehiclePhysicsSystem`, `VehicleDamageSystem`, `VehicleLodSystem`, `EnterVehicleSystem` (its
      `followTarget` takes the VEHICLE now; the host resolves it to something three can track).
      DELETED `vehicle-door.ts` / `vehicle-part.ts` (three types that only the renderer needs).
      **Detached debris was the awkward one** (the audit flagged it): prod re-parented the panel into the
      scene graph with `attach()` and let three carry it. The own engine has no graph, so the fall is now
      PLAIN DATA in the damage system (position/velocity/spin/rotation), pushed out as a world pose per
      frame; the three adapter still does the `attach()` internally so its behaviour is bit-identical.
      `ThreeVehicleHandle` (`game/adapters/`) holds every scene-graph mutation the logic used to do inline —
      a MOVE, not a rewrite; `disposeVehicle` moved out of canvas-host into it (materials included: my first
      draft dropped them and would have leaked).
      RESULT: `grep 'from three'` over `game/src/vehicle/` returns only `Vector3`/`Quaternion` MATH — no
      `Object3D`, no `.visible`, no `.attach`, no `.traverse`. The one exception is
      `VehicleHeadlightSystem`, ~80% renderer-specific (sprites/materials/uniform arrays) and explicitly
      deferred to step 5; until then it reaches the render object through the three handle.
      Tests now assert the CONTRACT, not three internals: new `FakeVehicleHandle` recording double; rig,
      damage, LOD, physics and enter-vehicle suites rewritten against it (52 vehicle tests green, full suite
      1920). Prod behaviour is unchanged by construction — field check owed on the WebGL path.
- [x] **(B5 step 4) Cars in the GAME on the own engine — 2026-07-14 (awaiting field check).**
      `EngineVehicleHandle` (game/adapters) = the twin of the three handle: chassis pose → the entity ROOT
      (the GTA Z-up → engine Y-up change rides in that one matrix), wheels/doors → per-part animation
      rotations, `_ok`/`_dam` + `_vlo` → submesh visibility, a detached panel → its own WORLD matrix. Damage
      and LOD compose through ONE visibility decision (`setLodBand` is the only writer), else a damaged panel
      would reappear intact on an LOD swap. A detaching panel inherits the BODY's rotation — handing back
      identity would snap it flat the instant it came off a moving car.
      `GtaSaWorldAdapter.loadVehicleData()` = the renderer-agnostic sibling of `loadVehicle` (both now share
      one `vehicleCommon` — def/DFF/COL/half-extents/handling/paint), plus `vehiclePaint()` so a spawn can
      resolve carcols WITHOUT re-parsing the DFF. `engine-vehicles.ts` wires the REUSED systems (physics →
      damage → enter/exit → LOD, the three host's exact order) and holds the **model cache: one uploaded
      model per car TYPE, one instance per car** — the whole point of the B5 engine work. The model is
      colour-AGNOSTIC by construction (paint is a per-instance slot), so a street of Landstalkers shares one
      geometry+texture upload and differs only by part matrices and four colours.
      NEW SEAM the plan-10 audit missed: `EnterVehicleSystem` depended on the three
      `CharacterAnimationSystem` for the climb-in/sit/climb-out clips. Narrowed to a `VehicleAnimator`
      interface (`faceTo` + `setScripted`) that BOTH renderers satisfy structurally; `engine-player` grew
      scripted-clip playback (one-shot clips HOLD their last pose — the seated driver stays seated) and the
      ped fixture was re-extracted with `car_getin_lhs, car_sit, car_getout_lhs` (they were already in
      ped.ifp; the probe's `--clips` list just never asked for them).
      Field: `?engine=opensa` — walk to a parked car, enter, drive. Camera trails the CAR while seated (the
      rider is teleported into the seat every frame; following the ped would judder).
      KNOWN GAPS (step 5): headlights/lamp state (the three-only `VehicleHeadlightSystem` is not wired into
      this host) and map car generators (parked.json only for now — generators need the city-box resolver
      the three host builds).
- [x] **(B5 step 5) Vehicle LAMPS ported — 2026-07-14 (awaiting field check).** The plan-10 audit called the
      headlight system ~80% renderer-specific and recommended splitting it into a pure producer + renderer
      sinks. Done exactly that.
      PURE (`vehicle-lamps.ts`, shared by BOTH renderers): `lampStateFor()` — which car is lit and whether it
      is braking (occupant-agnostic, so NPC traffic drops in unchanged) — and `lampsOf()` / `lampAnchorsOf()`
      — the four lamps in world space (SA authors ONE dummy per end and mirrors it to ±X; half-extents
      fallback for models with none).
      HANDLE: `setLamps(state)` + `lampAnchor(kind)`. The three material poking (texture twin swap +
      `emissiveMap` glow) MOVED out of the system into `ThreeVehicleHandle` — where it belongs; the system
      kept only its sprites and uniform arrays and now calls the shared decision.
      ENGINE: **per-instance lamp state** (storage buffer #4, one vec4 per matrix row: headlights, brakes,
      config intensity), replacing the GLOBAL day/night gate in the shader — which lit every parked car in
      the city at once. The per-vertex lamp TAG rides `meta.w` (`LampTag`), so the fragment shader can glow a
      lamp texel: lit lamps SELF-ILLUMINATE (shading them like painted metal left a dull grey patch at
      night), tails run dim and jump to full on the brakes. Head/tail coronas + the beam pool lights feed the
      **existing** corona pass and light pool through `Engine.dynamicCoronas` / `dynamicLights` — no second
      corona renderer. Host coronas fill BEFORE the world's dn early-out: they carry their own night gate.
      `VehicleLampSystem` (renderer-agnostic, sink-driven) wires it in the engine host.
      **FIELD ✅ 2026-07-14 after 6 rounds — B5 CLOSED.** The rounds, because every one of them corrected a
      wrong belief: 1. _"The whole street glows."_ The pool had POINT lights only; a headlight with no cone lights the road
      behind the car too. Ported prod's cone (dir + cos half-angle in `dir.w`, 2 = point), squared toward
      the rim, plus prod's WRAP term — a headlight grazes the road tangentially and a hard N·L collapses
      the beam to nothing. 2. _"Light lies strangely on the road / broken normals / drove forward and the light vanished."_ THE
      REAL ARCHITECTURAL BUG: the world consumed the pool in the VERTEX shader (a deliberate optimisation —
      SA is vertex-lit). Fine for static 2dfx lamps, fatal for a MOVING one: SA road polygons are tens of
      metres wide, so the beam lands between vertices — it blotches along the mesh normals and disappears
      outright when the car sits mid-polygon. Split the pool: DYNAMIC lights first and shaded per PIXEL
      (world VsOut gained a normal), static lamps still per vertex. `params4.x` = the dynamic count. 3. _"Light is far in front of the car / leaks through fences."_ The 4.5 m forward push came from the LAB
      demo, which had no cone to aim with. Prod puts the source AT the lamp. Removed. 4. _"Beams merge into one blob under the nose."_ Prod's cone (57°, 27° down) was tuned for a source
      shoved metres ahead; at the lamp it must be narrower and flatter (≈38° / ≈18°) to read as two beams. 5. _"Tail lights are cropped"_ (five rounds, three wrong theories — each killed by DATA, not by eye):
      sampler wrap (UVs proved to be inside [0,1]); texture packing (dumped the packed atlas — clean); the
      env-mapped glass (its bbox is in the FRONT of the car). Then the clue that cracked it: the seam ran
      STRAIGHT ACROSS BODY AND LENS — across two different materials — so it could not be geometry, UV or
      shading. It was the CORONA: the lamp dummy sits ON the lens surface, so a camera-facing quad centred
      there is half-buried in the bodywork and the depth test slices it along the car's own silhouette.
      Fix = nudge the corona along the VIEW RAY (pure depth, no screen movement), NOT outward along the
      lamp facing — which fixes the clipping but detaches the glow, leaving it floating behind the bumper. 6. En route, two more prod-parity rules: a lit lamp is a SOURCE, not a surface (emissive-dominant; a
      nearby street lamp was painting the lens's ~90° normal sweep straight onto the glass), and a car is
      never lit by its OWN lamps — vehicles and peds take the STATIC half of the pool only, exactly as prod
      does by construction (its pool lives in the world material alone).
      GUARDRAIL ADDED: `assertGuardrails` now rejects WGSL RESERVED WORDS in declarations. `from` broke the
      build this session; `meta` broke it in B2. naga does not catch them and the browser was our linter
      twice. (The first reserved-word list I wrote from memory was itself wrong — `out`/`in`/`vec` are NOT
      reserved and our shaders use them; the test caught me. It is now the spec's list.)
      REMAINING in 08: vehicle reflections (deferred out of B5 by the user), map car generators on the engine
      host, headlight SHADOWS (the pool casts none — prod does not either, so a beam still passes through a
      fence).
- [ ] Transform buffer + dynamic-offset draw path + entity registry (01 dynamics module made real).
- [ ] **Vehicle lamp STATE** (user spec 2026-07-13): lamp submeshes carry `head`/`tail` tags from the SA
      marker colours (extractor done); runtime needs per-vehicle state — headlights on/off (texture twin
      swap is currently dn-gated globally), BRAKE lights (tail lamps glow bright on braking, like a real
      car), reverse later. Lands with the B3 game wiring (the entity gains gameplay inputs there).
- [ ] **Headlight beams v2**: today's pool entry is a forward-offset POINT light; upgrade to a directional
      cone (the prod modern-pipeline 070 headlight look) — spot term in the pool struct (direction + angle
      in the spare w slots).
- [ ] **Vehicle LOD** (user spec): swap to the `chassis_vlo` mesh at range (extractor currently SKIPS
      `_vlo` atomics — carry them as a fixture LOD part set) and drop lamp submeshes to CORONA-only
      rendering (the 2dfx corona pass already exists; lamp dummies are in the fixture).
- [ ] Character full: sampler crossfades, retarget (port the pure logic, drop the three mixer).
- [ ] Vehicles: DUMMY-tree parse → part hierarchy, part flattening, paint/env WGSL, night fill module, ok/dam damage part-swap hooks (render side only).
- [ ] Dynamics-only near shadow map pass + world/dynamics sampling.
- [ ] **(B7·b)** IDE anim objects: dynamic-entity promotion + IFP playback on the frame tree (replaces the
      static-weld freeze of 06 row 17 — the converter welds anim defs at BIND POSE and only counts them,
      `weld.ts:153` `animatedStatic` = 64 instances map-wide; converter grows the exclusion/objectTable flag
      for promoted defs). Inventory prod's UV-scroll animation (`renderware/src/three/uv-anim.ts`) here too.
- [ ] **(B7·a)** Breakables: objectTable `breakable` kind (hide intact run on hit) + debris entities
      (plan-045 parity; prod side = `renderware/src/three/breakable.ts` + `build-debris.ts` + the
      `object.dat` parser). NB a recorded cell bundle is IMMUTABLE — breakables must live outside it.
- [ ] **(B6)** Particles/coronas instanced pass; procobj instancing.
- [ ] Ledger: skinning CPU+GPU ms (gate ≤ 1 ms), dynamics draw counts, near-shadow pass ms.

## Measurement ledger

| Date       | Piece                                     | Number                                                                                                                                        | Gate                       |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 2026-07-13 | B1 IFP sampler + palette upload (in-game) | **0.00 ms/frame** (below the 0.005 ms display resolution; male01, 32 bones, idle — HUD field reading on the B3 host, Grove Street live scene) | ≤ 1 ms ✅ (~200× headroom) |
| 2026-07-13 | B3 whole-frame context of that reading    | frame 8.33 ms vsync · submit 0.10 ms · GPU 1.70–2.10 ms · draws ~450 · residency ~540–590 MB                                                  | vs three-WebGL ~31 ms GPU  |

(vehicle-entity flatten/update ms + per-piece rows join as M3 pieces land)

---

## B7·a — Destruction (breakable) objects — LEDGER

**Step 1 — converter: `.oscell` minor 3 carries a BREAKABLE table. ✅ DONE 2026-07-14.**

The design question was how a single crate disappears when the cell's render bundle is IMMUTABLE.

- **Attempt 1 (rejected on measurement):** give every smashable PLACEMENT its own objectTable run, so it can be
  hidden individually — the obvious reading of the plan's own note. Measured on the same Ganton rect
  (`--rect 8,-8,10,-6`): **groups/cell 21.8 → 99.1 avg, 49 → 294 max; objectTable entries 6 → 886.** That is
  **4.5× the draw calls** — it dismantles the very batching the bundle exists for. Reverted.
- **Shipped instead:** breakables stay welded INSIDE the merged bundle, and the cell records each placement's
  **index RANGES** (`OscellBreakable { keyHash, indexOffset, indexCount }`). A bundle references the index
  BUFFER, not its bytes — so the engine shatters one prop by writing degenerate triangles over its range. No
  bundle rebuild, no extra draw, and a cell reload restores the prop for free (the pak is the source of truth).
  Re-measured: **groups/cell 21.8 avg, 49 max — identical to baseline. Zero draw-call cost.**
- Gate = prod's gate, both halves: the DFF carries an RW Breakable shatter mesh, OR object.dat gives the model
  a smash damage effect (`breakableModels`, optional — absent object.dat still works on the mesh gate alone).
- `keyHash` = FNV-1a of `breakableInstanceKey(model, gtaPosition)` — the SAME key the physics collider is
  tagged with, so a contact-force event resolves to a range with no lookup table. The key now lives in
  `renderware/src/breakable/key.ts` and the three path imports it — one definition, not two (the heat-haze
  lesson).
- Counts on the Ganton rect: **1 636 smashable placements** across 9 HD cells.

**Steps 2–5 — engine, host, debris, TOPPLE. ✅ DONE 2026-07-14, FIELD ✅** (props smash, poles fall over,
coronas go with them, the car drives on).

**Shipped**

- **Engine:** `CellStore.breakPlacement(keyHash)` overwrites the placement's triangles with degenerate ones.
  The bundle references the index BUFFER, not its bytes, so this respects the immutability rule and costs one
  `writeBuffer`. No restore path by design: a cell reload rebuilds the buffer from the pak — which is exactly
  how SA respawns props.
- **Host:** `engine-breakables.ts` — prod's impact gate (3 000 N scaled by object.dat's colDamageMultiplier;
  mass ≥ 90 000 = a fixture). Contact-force events fire only on the vehicle chassis, so as in vanilla you
  cannot smash a crate on foot.
- **Debris:** the shard arithmetic is SHARED (`renderware/breakable/bake-debris.ts`) and prod consumes it. One
  draw per break; every vertex carries its shard's centroid, velocity, spin and landing time, and the whole
  flight is an analytic function of age in the vertex shader. **Prod's own defect is FIXED, not copied:** it
  never probes the ground, so its shards fall through the floor and sink; here `physics.groundBelow` gives
  them something to land on.
- **TOPPLE (`engine-props.ts`):** object.dat's **uproot limit** (column G — a lamppost carries 240, a crate 0)
  is SA's own "knock it over" flag, and our parser had been discarding it. Uproot props do not shatter: they
  become real dynamic Rapier bodies, and physics decides where they fall and what they land on.
- **`.oscell` minor 4:** a light knows which placement OWNS it, so a smashed traffic light takes its coronas
  down with it instead of leaving them lit in the sky.

**The field cost five rounds. Every one was a lesson worth keeping:**

1. **Nothing broke at all** — while the pak provably carried the ranges and the physics keys matched. The
   reader was `push({ keyHash: r.u32(), indexOffset: r.u32(), indexCount: r.u32() })`, and **the linter sorted
   the object literal's keys alphabetically, reordering the SIDE-EFFECTING reads with them.** The bytes were
   right; the fields were rotated. Neither tsc, nor eslint, nor the round-trip test saw it — the test counted
   rows instead of comparing values. **RULE: never read a binary record inline in an object literal. Read into
   locals, and assert VALUES.**
2. **The felled pole was invisible.** `writeGtaRoot` converts the ROTATION into engine space but takes the
   position ALREADY converted (the vehicle handle and the player both do this). Raw GTA coordinates put the
   pole 1 656 units under the world. Its name promises more than it does.
3. **The pole rocketed away and the car bogged down in it.** It was spawned as a dynamic body at the instant
   the car was embedded in it, and given an angular velocity about its own centre — which drives the bottom
   half of an 8 m body into the asphalt. Fixes: its own collision group (collides with the WORLD, passes
   through vehicles — including the suspension RAYS, which do not honour collision groups unless you pass
   them), and a point impulse instead of a spin, so the GROUND is the hinge.
4. **The pole fell TOWARDS the car, and landed on a phantom edge.** Both were the bounding box: a lamppost's
   arm makes its box 2.8 m wide, which shifted the centre of mass off the pole (so the shove landed BELOW it
   and kicked the base out, like a rug) and gave the body a face to rest on that the eye cannot see. The
   collider is now the mesh's own CONVEX HULL. **The user's own clue cracked it: "the fence falls correctly" —
   a fence IS its bounding box.**
5. **`BufferOffset is not a multiple of 4`.** WebGPU REJECTS an unaligned `writeBuffer` (the browser only
   warns), so with u16 indices any prop whose range began on an odd index silently refused to break.
   `alignedErase` widens the write to the 4-byte window and writes the neighbour's dragged-in bytes back
   verbatim — zeroing them would degenerate a triangle of the prop next door.

**Measured:** converter cost unchanged (groups/cell 21.8 avg, 49 max — identical to baseline; splitting props
out per placement had measured 4.5×). 27 355 smashable placements on the full map.

**Tests:** `engine/world/degenerate.test.ts` (the alignment window), `renderware/breakable/bake-debris.test.ts`
(shard flight, ground landing, determinism), `opensa-pack/weld.test.ts` (per-placement ranges + light
ownership + the LOD negative), `engine-formats/oscell.test.ts` (the breakable/light records round-trip by
VALUE — it fails on the rotated reader).

**Deliberately not done:** shards do not collide with anything (they are analytic, and prod's don't either);
a felled prop is cleaned up after 8 s rather than persisting until the cell streams out.

**B5 follow-up — coronas slid off a rolled car (fixed 2026-07-14, FIELD-reported).** `lampsOf` placed the
lamps with `quatFromHeading(vehicle.heading)` — a YAW. A yaw cannot express a car on its roof, so the lamps
(and the coronas riding them) stayed in a flat frame while the wreck did not, and the glows floated beside the
body. `EnterableVehicle` now carries the chassis's FULL `orientation`, kept live by the physics system (which
was already reading the quaternion and throwing it away), and the lamps ride that. **This is the THIRD time
this exact class of bug has landed: the seated ped rotated with a yaw in B5, and now the lamps.** Anything
bolted to a BODY must ride the body's quaternion, never its heading. Fixes the three path too — it shared the
same helper. Test: `vehicle-lamps.test.ts`, "the lamps ride the BODY, not the heading".

---

## B7·b — Animation objects — ✅ DONE 2026-07-14, FIELD ✅

**No new engine machinery.** SA's animated map objects are not skinned: the DFF is a multi-frame CLUMP and the
IFP's "bones" are its FRAMES, matched by name — each atomic rides one frame rigidly. A frame tree is therefore
a skeleton where every vertex has weight 1 on one bone, so the pieces already in the tree do the whole job:
the B1 `IfpSampler` composes the chain (fed IDENTITY inverse-binds, so it yields frame WORLD matrices rather
than skinning matrices), and `setPartWorldMatrix` — written for damage debris — drives each atomic from it.

**The converter promotes only what MOVES.** `burger01_LAw` is a 22 × 35 m diner that sits in the anim section
purely because its sign spins. Skipping anim defs wholesale once deleted it (the "blue hole" of plan 041);
promoting the whole def would drag the diner out of the merged batch for one sign. So `weld.ts` computes the
frames the clip touches (plus their descendants — a windmill's blades are not in the clip, its hub is) and
leaves ONLY those atomics out. Measured on the real `nt_noddonkbase`: 854 vertices whole → **294 welded**
(the pump's base), the swinging arm goes to the host. Map-wide: **64 live, 0 static**, groups/cell 15.1 —
unchanged, the batching is intact.

**Two SA facts, both encoded in `renderware/anim/frame-clip.ts` (shared, so the two renderers cannot drift):**
the clip inside an IFP is named after the **MODEL** (not the def, not the file); and object clips KEEP their
translation — a garage door SLIDES. Ped clips drop it (locomotion is in-place), which is why the sampler
gained optional translation tracks rather than assuming them.

**The field round, and its lesson:** the sign spun with a FROZEN COPY of itself inside it. The converter was
computing the moving-frame set correctly (it reported `animated(live)=64`) but **never passing it to
`weldGroup`** — an edit that did not apply, and an OPTIONAL parameter, so `tsc` was silent and the lint was
silent. **A missing optional argument is invisible to every static check we run.** Only a test comparing
NUMBERS caught it (welded vertex count with vs without the anim). The same test also caught a trap in itself:
`animDefs(undefined)` hits the parameter's DEFAULT — passing `undefined` is not passing "nothing".

**Tests:** `renderware/anim/frame-clip.test.ts` (the real `nt_noddonkbase` + `counxref.ifp` — hierarchy, clip
naming, descendants, translation), `opensa-pack/weld.test.ts` (moving frames leave the bundle; a MISSING IFP
welds the model whole, so a lost clip can never delete a building again).

**Not in scope, planned separately: UV-scroll animation — [18](18-uv-anim.md) (B7·c).**

**B7·b field round — the stall that was NOT the animation.** The countryside sat at 12 fps and the animated
windmill was the obvious suspect. It was innocent: `anim` measured **0.00 ms**. Per-block CPU timers (now
permanent, behind a slow-frame threshold in `engine-canvas-host.tsx`) showed `physics` eating 17 ms PER STEP,
with the fixed loop's 5 catch-up steps turning that into 85 ms frames — a spiral that hid its own cause and
made the recovery look mysterious. The bodies: **9 803 static clutter colliders** the engine host had asked
for by passing NONE of prod's clutter knobs — for clutter it does not even draw. Written up as
[19](19-procobj.md) (B7·d). Lesson: **a catch-up spiral makes the loudest thing on screen look guilty; measure
the blocks.**
