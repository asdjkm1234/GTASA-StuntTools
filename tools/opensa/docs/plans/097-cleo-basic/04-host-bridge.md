# 097/04 — Engine host bridge + wiring: class A alive in the engine

`CleoHost` implemented over the engine's real seams, wired into the real frame loop, and the first
field checkpoint: **the Ferris wheel spins in the browser**. All engine facts below were re-verified
in the 2026-08-04 recon (file:line current as of that date).

## Decisions

1. **Model loading = the existing rigid-model path.** `host.requestModel(idOrName)` resolves id→name,
   reads `<name>.osm` from the VFS, `readModelOsm` (`packages/game/src/adapters/vehicle-osm.ts:57`) →
   `engine.createVehicleModel` → `engine.createVehicle` → `instance.entity.setRoot(mat4)`. The working
   template is `apps/web/src/ui/engine-props.ts:73-127` (props already spawn arbitrary models this
   way, with a DFF/TXD fallback). Build in the vehicle-model worker if profiling shows spawn hitches —
   props currently build on-thread; measure first, copy the worker only if needed.
   `isModelAvailable` returns true once registered — exactly the SCM request/poll contract, so async
   loading bridges to SCM semantics with no blocking.
2. **A model id→name resolver must be BUILT** (recon: none exists). Compose from
   `MapDefinitions.catalog` (IDE object defs, `packages/renderware/src/parsers/text/types.ts:74-86`)
   + the adapter's `vehicleDefs`; name-first (`GET_MODEL_BY_NAME 0E9C` gives names — Wind Farm uses
   it), ids resolved through the composed map. Lives adapter-side (the game layer touches renderware
   only through `adapters/` — lint-caught restriction).
3. **Phase-0 spike stays first** (the `[[local-loader-vfs-subset]]` burn): load ONE known map-object
   `.osm` by name at runtime from the host, render it at a fixed transform. If the local-loader subset
   blocks arbitrary lookup, fall back to `cleoModelRefs` discovery (enumerate `cleo/*.cs`, pre-decode
   with plan 01, collect model names — the `procObjModelRefs` pattern in
   `packages/loaders/src/asset-local-loader/build-vfs.ts`). Record which path was needed.
4. **Objects = engine rigid instances in a handle table** (`Map<scriptHandle, instance>`):
   CREATE_OBJECT_NO_SAVE allocates + places; SET_OBJECT_ROTATION/COORDS/HEADING update the stored
   transform (GTA Z-up native — **no axis conversion**; degrees→radians centralised in ONE place);
   DELETE_OBJECT destroys and frees. Detach-safe: a torn-down handle no-ops with a once-log.
   No physics (readme's out-of-scope).
5. **`CONNECT_LODS 0827`**: pair the two script handles so the far model renders when the near one is
   outside its draw distance — served with a simple camera-distance visibility swap on the pair (both
   Junior mods spawn their own lod models and link them). Not the world-LOD system; just the pair.
6. **Query facets the corpus demands, no speculative surface**: clock (`GET_CURRENT_HOUR` from the
   game clock), camera distance (`0EBE` against the active camera position), area visible (`077E`),
   player position (ECS `Transform`/`Locomotion` — `packages/game/src/ecs/components.ts`),
   `GET_PLAYER_CHAR/IS_PLAYER_PLAYING` (trivially true/0 in play state), vehicle queries
   (`activeVehicle()`/`ridingVehicle()` via `apps/web/src/ui/engine-vehicles.ts:59/:101`,
   `GET_CAR_MODEL`, `IS_CAR_MODEL`, `IS_THIS_MODEL_A_CAR`), **`IS_GAME_VERSION_ORIGINAL 0AA9` → true**
   (the impersonation doctrine — van door bails otherwise), `IS_PC_VERSION` → true. Text facet:
   `PRINT_STRING_NOW/0ACD` and friends onto the existing HUD message surface (or a minimal toast if
   none exists — record which).
7. **Wiring is explicit, not `addSystem`** (recon: `SystemRegistry` is dead). `CleoRunnerSystem`
   implements the `System` interface (`packages/game/src/core/system.ts:6`) but is constructed in the
   `engine-canvas-host.tsx` boot closure and called by name inside `runFixedSteps` — AFTER
   `vehicles?.fixedUpdate` (scripts read seated-vehicle state the same step they animate), gated
   `config.gameState !== 'play'` early-return (the `physics.system.ts:35` pattern). Script count
   announced at boot (the populations restriction). `Config.cleo` added to
   `packages/game/src/interfaces/config.interface.ts` + the default literal in
   `apps/web/src/ui/game-runtime-config.ts` — `{ enabled: false, trace: false, maxScripts }`,
   live-read.
8. **Scripts for THIS plan are hand-placed** in `build/<game>/opensa/cleo/` (loose files ride every
   pipeline stage untouched — recon-verified; the mods pipeline learns to put them there in plan 06).
   Boot discovery: `vfs.names` filtered on `cleo/` + `.cs` (keys are lowercase in all loaders).

## Subtasks

- [x] Phase-0 spike (decision 3); record the verdict + the path taken.
- [x] id→name resolver (adapter-side) + tests.
- [x] `CleoHost` object facet: request/available cache, handle table, create/rotate/coords/delete,
      unit conversions, disposal on runner teardown; detach-safety + missing-model tests
      (`isModelAvailable` stays false → the scripts' own not-installed guard runs, same as real CLEO).
- [x] Query facets (decision 6) + tests against mock game state.
- [x] `CONNECT_LODS` pairing + test.
- [x] `CleoRunnerSystem` + `Config.cleo` + boot discovery + explicit wiring + play gating + boot
      census line.
- [x] Headless integration: decoded Ferris (01) on the VM (03) against the REAL host facets with a
      fake engine — expected transform sequence asserted on the handle table.
- [x] **Field checkpoint 1**: Ferris Wheel + Wind Farm hand-placed into a gostown/original build,
      `cleo.enabled` on — the wheel spins, the turbines turn (Wind Farm's two global reads land on
      plan 05's globals table; until then its not-installed/zero-wind fallback path is the accepted
      behaviour — record what the field actually shows). Screenshot + boot census + frame numbers
      into the ledger.

## Verification

- Ferris produces the expected transform sequence headless; the spike model renders in-engine;
  missing/streamed-out handles never throw; `enabled: false` = zero overhead (measured).

## Ledger

_(worker vs on-thread decision + numbers, facet inventory, field checkpoint 1 record)_

### Field checkpoint 1 — 2026-08-04, THE WHEEL SPINS

Hand-placement (decision 8, via `scripts/debug/cleo-place-mods.ts` — retired by plan 06 as planned): `cleo/*.cs`
+ mod IDEs + `gta.dat` IDE lines + a `models/cleomods.img` override into `build/original/opensa`
(the Jul-30 build), served over http-dir, booted with `?cleo=1&spawn=350,-1900,9`.

- **Ferris: PASSES.** Boot census `[cleo] 2 script(s): ferris.cs, windfarm.cs`; zero thread faults;
  two photo-camera frames 4 s apart show the wheel rotated (~19 deg at the authored ~4.8 deg/s) —
  gondola positions and the light lattice are in a different phase, and the 16 seat objects moved
  WITH the rim (they are separate script objects repositioned per frame). Frame HUD steady at
  8.33 ms / 120 fps with the scripts running — no `[slow]` lines the whole session.
- **The id-resolve chain needed `gta.dat`**: the adapter catalog reads IDEs via `resolveMap`
  (gta.dat-listed), NOT the partition's scan-everything path — a hand-placed mod IDE must also be
  LISTED, or `[cleo] model id 14644 resolves to nothing` (the diagnostic caught it on the first
  boot). The placement script appends the lines now; plan 06's installer must do the same.
- **Wind Farm: degraded exactly as designed, and now MEASURED.** Its visibility radius comes from
  `0A8D READ_MEMORY 0xB6F118` (the draw-distance multiplier global — plan 05's atlas) multiplied
  into the LOD model's struct-read draw distance (`0EF8 GET_MODEL_INFO` + `0D4E` at struct offset
  24). Both are plan-05 natives; with them unimplemented the radius stays 0, `0EBE` never passes,
  and the script WAITS forever — creating nothing, faulting nothing. (The headless run builds 68
  objects + 34 LOD links only because the recording host forces `cameraWithin` true.) This is the
  acceptance test plan 05 must flip: turbines appear the moment 0A8D/0EF8/0D4E resolve for real.
  Note for the 05 field round: the mod authors its turbines at z 59-73 (the Panopticon hills);
  THIS build's terrain at the site reads z~25 — judge turbine placement from the reporter's angle
  then, not from the stock map's memory.
- **PRINT_STRING_NOW surface**: a minimal DOM toast (`#cleo-toast`, `engine-cleo-setup.ts`) — the
  HUD has no message lane; a real one can replace the toast without touching the host. Recorded as
  the "or a minimal toast" branch of decision 6.
- **Model build is on-thread** (decision 1's measure-first): both class-A mods build DFF/TXD-fallback
  models in single-digit ms at request time; no spawn hitches, no `[slow]` lines — the worker copy
  stays unbuilt until a profile demands it.
- **drawCorona is deliberately dark in 04** (windfarm calls it once when its LOD swap fires) — the
  wiring lands with plan 05's field polish.
- The 04 vehicle facet is the seat-state slice only (`isCharInAnyCar` via `ridingVehicle`); pool
  walking, car models and driver handles are plan 05's handle table.

### Phase-0 spike — 2026-08-04, verdict POSITIVE (direct lookup; discovery still required for non-placed models)

Temporary `?osmspike=<model>` hook (`apps/web/src/ui/osm-spike.ts`, wired in `engine-canvas-host.tsx`):
`fs.get('<name>.osm')` → `readModelOsm` → `engine.createVehicleModel` → `engine.createVehicle` →
`setRoot` each frame — exactly the `engine-props.ts` template, against the Jul-30 `build/original/opensa`
served over `?loader=http-dir&src=http://localhost:3001/build/original/opensa`, headless.

- **Positive**: `ferris01_law2.osm` (344 064 B, exterior-IPL-placed, `textureSource: 'world'`) resolved
  by bare name, built, and rendered WHOLE at a fixed transform 60 m south of the player
  (`spawn=350,-1900,9`, anchor gta 350,-1960,27) — rim, A-frame and platform all textured, so the
  engine's `worldArrays` path (`engine.ts` — empty `textures` => submesh `array` refs sample the world
  plan) covers spawned instances too, not only anim-objects. The REAL pier wheel visible in the same
  shot confirms the near one is ours.
- **Negative (the subset boundary, measured)**: `ab_jetseat_hrest.osm` is IN the served `gta3.img`
  (10 944 entries, 8 779 `.osm`) but `MISSING from the runtime VFS` — the local/http-dir partition
  selects only exterior-placed + peds + vehicles + procobj (`build-vfs.ts`), and interior-placed
  models fall outside it. A model referenced ONLY by a CLEO script therefore cannot be found by name.
- **Consequence for 04/06**: direct name lookup is the primary path and works for every map-placed
  exterior model; the `cleoModelRefs` discovery (enumerate `cleo/*.cs`, pre-decode, feed the names
  into the partition — decision 3's fallback) is REQUIRED, not optional, for mod-carried and
  interior/unplaced models. Plan 06's packaging must add CLEO-referenced models to the selection on
  every loader path (the fetch pack shares the same partition logic).
- Probe kit: drag-look pitch needs `.sa-capture` hidden FIRST (the overlay eats the mouse); drag dy
  is INVERTED (negative dy = pitch up; -120 framed a target 25° up at 60 m).
