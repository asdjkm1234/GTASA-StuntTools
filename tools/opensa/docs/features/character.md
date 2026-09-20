# Character

`packages/renderware/src/ped/build-ped-model.ts` (renderer-agnostic skinned model + bones),
`packages/engine/src/anim/` (`IfpSampler` — the clip player + crossfader), `packages/game/src/character/`
(controller, heading, jump FSM), `apps/web/src/ui/` (`engine-player.ts` + `locomotion-mixer.ts` +
`gait-selector.ts` — the animation state machine), plans 008/011/012/013/036/**088**.

## Implemented

- **Skinned model**: Skin plugin → a plain `PedModelData` struct (vertices + `PedBone[]`, no GPU
  types — the character viewer builds the same thing); bones from the frame hierarchy
  (skin bone i ↔ frame i+1, frame 0 = dummy root); bind pose = raw mesh regardless of mapping;
  named-bone map for animation retargeting. The shipped player model is `GAME_CONFIG.mainCharacter`
  (`apps/web/src/game-config.tsx` — `bmycg` for gostown/carcer/anderius), loaded from `<mainCharacter>.osm`
  by name (the old hardcoded `PLAYER_MODEL`/`male01` const is gone) — see "Where the OWN-ENGINE player comes
  from" below.
- **Root anchoring** (`anchorRootBone`): the root bone's rest position is snapped to the skin's authoritative
  bind translation (`inverse(boneInverse)`). The IFP root **translation** track is dropped (locomotion stays
  in-place — physics owns position), so the root bone would otherwise keep its DFF **frame** position. Standard
  peds author that at the origin (matching the skin bind), but some mods offset the root frame (e.g. gostown's
  `BMYPOL1` puts `Root` at +2.16) — which would shove the whole body off the entity pivot (off-centre, with
  rotation orbiting the offset). The snap is a no-op when the frame and skin bind already agree.
- **Animation** (plan 012, reworked by 088): ANP3 IFP parsing (quaternions i16/4096, times i16, root
  translation i16/1024) → `PedClip` (quaternion tracks per skin-order bone; translation opt-in), played
  by the engine's `IfpSampler`. The locomotion state machine lives in `apps/web/src/ui/engine-player.ts`
  on three pure, GPU-free collaborators (plan 088):
  - **`GaitSelector`** — speed → idle/walk/run/sprint tier at the tier-midpoint thresholds with 0.5 m/s
    hysteresis (no clip flicker at a boundary);
  - **`LocomotionMixer`** — 0.2 s crossfade on every clip switch (landings 0.12 s), walk↔run↔sprint carry
    normalized phase so the legs stay in step, cycle clocks scale by `speed / tierSpeed` clamped
    [0.7, 1.4] (no foot sliding), one-shot clips (launch, the glides, the land tiers, the riser)
    park on their last frame,
    and an interrupted fade retargets from a frozen `holdPose` — pop-free;
  - **`IfpSampler.sampleBlended`** — the crossfade blends per-bone LOCAL quats/positions BEFORE compose
    (blending palette matrices would shear); measured 8.2 µs vs 6.0 µs single per 32-bone frame.
  The clip set (`PLAYER_CLIPS`): `idle_stance`/`walk_civi`/`run_civi`/`sprint_civi` gaits +
  `JUMP_launch`/`JUMP_glide`/`JUMP_land`/`FALL_glide` air states + the 088/07 landing tiers
  `fall_land` (impact crouch) and `fall_front`+`getup_front` (down flat, stand back up — NOT
  `FALL_collapse`: its standing-knockout stagger read as two clips on a landing). Every 088 addition
  degrades on a TC whose IFP lacks it (`resolveGaitClip`, `airClipFor` chains) — never a bind pose.
- **Movement feel** (plan 088/01+03): the controller owns a rate-limited heading
  (`Locomotion.heading`, 720°/s near idle → 240°/s at the top tier; an intent >120° behind PLANTS —
  decelerate, pivot, re-accelerate); RUN is the default gait (SA jogs), Shift sprints, `walk` is an
  optional binding or a partial touch-stick deflection. All tuning in `MovementConfig`
  (`game-runtime-config.ts`).
- **Jump/fall FSM** (plan 088/04+07, `CharacterControllerSystem.advanceAirState`, states in
  `Locomotion.state`): LAUNCH (0.1 s anticipation crouch before the impulse; jumpSpeed 4.5 → apex
  ≈ 1.03 m) → AIRBORNE → a landing TIER by touchdown speed: LAND (1–12 m/s, 0.15 s beat) ·
  HARD_LAND (12–16, the `fall_land` impact crouch, 0.5 s) · COLLAPSE (>16, `fall_front` down flat +
  `getup_front` back up over 2.2 s, `stateTime`-driven handoff); walking off an edge FALLs after the
  0.12 s coyote window (a press inside it still jumps); a press ≤0.15 s before touchdown fires on the
  landing frame (rising-edge armed — holding jump never auto-hops); feather touches (<1 m/s) take no
  beat. Touchdown impact is recorded in `Locomotion.fallSpeed` (the 080 camera shake's future input).
- **Warp reset** (plan 102, `CharacterControllerSystem.resetIfWarped`): the controller drives a kinematic
  capsule, so the body lands exactly on the translation it asked for — a body more than 5 m from where the
  controller left it was moved by something else (debugger teleport, bench anchor, respawn, a script), and
  its velocity + air FSM + `fallSpeed` are dropped on the next fixed step. DERIVED, so no warp path has to
  remember to ask: the bench harness's own teleport did not, and an inherited 20 m/s fall then rode from
  scene to scene. The seated rider is exempt because the controller is disabled while riding, and fly mode's
  own placements record themselves.
- **Slope slide** (plan 088/08): ground steeper than `slideSlopeDeg` (40°, from a per-step
  `groundNormalBelow` probe) enters `LOCOMOTION_SLIDE` — the CONTROLLER pushes downhill (gravity's
  along-slope component, capped 12 u/s; Rapier's kinematic controller never accelerates a slide
  itself), control drops near-frictionless (0.05), the pose braces in `FALL_glide`, and there is NO
  jump out of a slide — landing on steep ground slides immediately, so the jump-ladder up a hillside
  is impossible. Exits below 36° (4° hysteresis) or off an edge into FALL.
- **Vehicle ingress/egress** (plan 088/09): the enter/exit slides ride the clips' authored ROOT
  MOTION (`rootMotion`/`warpAlongRootMotion` — endpoint-pinned to the real doorway and seat); entry
  uses the NEAR front door (passenger side climbs in `car_getin_rhs` and shuffles across on
  `car_shuffle_rhs`); the step-in walks a three-leg route around the open panel; the exit probes
  each egress (driver door → passenger door → windscreen crawl `car_crawloutrhs` → appear on the
  roof) with two-height `pathClear` rays, an overturned car goes straight to the crawl-out, and the
  exit door shuts only once the player has stepped clear. Details in vehicles.md.
- **Physics** (plans 008/013): bitECS entity + Rapier capsule/box controller, gravity, map
  collision, slope handling; respawn/teleport debug actions. The game's `playerSpawn`
  (`GAME_CONFIG`, `apps/web/src/game-config.tsx`) is the single source for where the player starts — it seeds both the
  player capsule and the initial collision zone (`loadGame` centres on it), so there is ground under the drop
  (Ganton on `original`).
- **Night lighting**: the ped is dynamically lit (sun/moon + indirect) by the engine's `ped` pipeline —
  no prelit. The indirect term is the SAME hemispheric weight the vehicles use (`skyVisibility` ×
  `DYNAMIC_INDIRECT`, shared through the `<frame>` shader module, plan 084 → 087 ped): a flat
  `vec3f(params.y)` gave the body no readable edges at night, when the sun term is gone and indirect
  dominates (peds carry no baked AO, so `DYNAMIC_INDIRECT × skyVisibility(normal)` is the whole weight). The
  old plan-034 "night fill" shader was removed with the three renderer and has **no replacement yet**; the
  moonlight band carries the night read (see night-and-time.md).
- **Follow camera**: the own-engine rig lives in the camera director (`Config.camera`, plan 080 — see
  [camera.md](camera.md)); free mouse look, pitch clamped by config, wheel zoom with min/max, debug Camera
  screen sliders. The 036 three-era spherical rig (auto-trail on direction CHANGE) is what 080 replaces.

## Known gaps / candidates

- Single character model; no CJ/ped variety, no ped NPCs.
- Animation set is locomotion + jump/fall + vehicle enter/exit; no combat/swim/climb.
- IFP translation tracks unused for the player (physics-driven; jump height = `jumpSpeed`, not the
  authored root motion) — used for map objects instead.
- Transition polish clips queued as plan 088/05 (`WALK_start`, `Run_stop(R)`, `turn_180`, `Turn_L/R`) —
  only if a field round shows the crossfades leave gaps.

## Where the OWN-ENGINE player comes from (opensa-pack 003 phase 5f, 2026-07-19)

`apps/web/src/ui/engine-player.ts` used to `fetch('/ped/ped.json' + '/ped/ped.bin')` — the LAB's probe
fixture, baked by `ped-probe`, served over HTTP **in the production host**. So the shipped player was
whatever a developer last converted, with its animations frozen at bake time, and the game directory the
user picked had no say in it.

It now loads `<mainCharacter>.osm` (from `GAME_CONFIG`) from the archives through the VFS, and resolves
the whole `PLAYER_CLIPS` set (gaits + the 088 jump/fall clips) — plus the scripted vehicle clips
`car_getin_lhs` / `car_getout_lhs` / `car_sit` that
`EnterVehicleSystem` drives by name — from the game's own `ped.ifp` at load, so a modded IFP changes how the
player walks AND sits. A scripted clip is only registered under its name when it actually resolves
(`duration > 0`); an absent one falls through to the standing locomotion stand-in rather than an empty clip
(which would drop the ped to the flat bind pose). Before this the scripted names resolved to nothing, so the
driver rode STANDING with his legs out of the car. Two traps
this path carries, both found in the field and not by tests:

- the IFP is keyed `anim/ped.ifp` in the browser VFS and bare `ped.ifp` in the archives, and **with no clips
  the sampler holds the BIND pose — SA's bind mesh lies along X, so the player lies flat on the ground**;
- `minZ` is the lowest POSED vertex (the feet level the host aligns to the capsule), so the converter has to
  pass `options.poseWith`; measured on the bind pose instead, the player sinks in to the knees.

The lab reads the same way now (plan 079 phase 2): `?ped` decodes `<model>.osm` + `anim/ped.ifp` from the
served build through `readPedOsm` + `parseIfp`. So the `ped-probe` CLI and its `ped.json`/`ped.bin` fixture
were retired (plan 079 phase 5) — nothing bakes a ped fixture any more; the `.osm` IS the format.

## Test coverage anchors

`ped/build-ped-model.test.ts` (real fixtures: `bmypol1`, and `army` for the HAnim ≠ frame-order case),
`engine/src/anim/ifp-sampler.test.ts` (incl. the 088/02 blend/hold gates),
`ifp` parser tests, `character-controller.system.test.ts` (heading/plant + the 088/04 FSM with real
Rapier), `character/locomotion.test.ts`, `ui/locomotion-mixer.test.ts`, `ui/gait-selector.test.ts`,
`ui/engine-player.test.ts` (`buildClipIndex`/`resolveGaitClip` degradation gates), `ui/camera/*.test.ts`.
The converted-ped path: `tools/opensa-pack/src/no-data-loss.test.ts` (every skinned buffer byte for byte,
the whole skeleton, `minZ`, and every texture present across arrays).
