# Zones, HUD, debug tooling

`packages/game/src/zones/`, `apps/web/src/ui/hud/`, `apps/web/src/ui/debug/`, plans 022/023/027/035.

## Implemented

**Zones**

- `map.zon` level boxes → city classification (LA/SF/VEGAS/COUNTRYSIDE/DESERT) driving the
  per-city weather sets; desert detection by named `info.zon` zones.
- `info.zon` named zones + GXT lookup (CRC-32 hash WITHOUT the final inversion — not Jenkins)
  → district display names.

**HUD** (DOM overlay, immune to post-processing)

- Clock and zone-name widgets with configurable font/outline (`Config.hud`), SA-style fonts
  loaded via `loadFonts`; zone name fades on change.

**Debugger (F2)** — multi-level menu; opening it never touches the simulation:

- Player (**Fly Mode** — float/fly at 2× speed, Space up / Ctrl down, drops to the ground beneath on
  off/close — then respawn, coords), Vehicles (spawn any car from `vehicles.ide` — sorted, with a name filter),
  Time (presets + speed),
  Atmosphere (night/world-light calibration sliders), Camera (follow rig), Graphics (bloom,
  tonemapping, reflections, water, sun/god-rays, clouds, stars, fog), **ProcObj**
  (per-category clutter knobs), Weather selector, Position (live coords + teleports incl.
  Truth's Farm), Map (map-viewer mode with manual cell selection, collision overlay,
  click-to-describe picking, **Show Normals**; right-drag orbits, left-drag pans,
  the wheel dollies).
  **On the own-engine host the overlay is capability-gated** (`ENGINE_DEBUG_CAPABILITIES`, plan
  074/22): rows the engine has no equivalent for are HIDDEN rather than left dead — SSAO (replaced by
  the baked AO channel) and the CSM/shadow and pipeline-switch rows. The **Map screen is RESTORED on the
  engine host** (074/22 phases 7-9): pinned cells, a detached camera that lifts overhead on activation,
  cursor picking against the `.oscell` placement mapper, hide/restore, Show Normals and Show
  Collision — and fog is forced off while it is open, so a district reads cleanly from above. The `game.*`
  calls named in the Map bullets below are the WebGL-era ones; the engine host reaches the same features
  through `mapGame` + engine flags. The engine's live equivalent of the draw-distance slider is `?draw=`
  ([query-parameters.md](../development/query-parameters.md)).
- **Physics screen** (engine host only, `physicsScreen` capability; plan 081/01): the driven car's live
  telemetry — speed/lateral, slip angle + slip ratio, yaw rate, **pitch (+ = nose up)** and roll, the three g
  channels, the applied throttle/steer/engine/brake, then one line per wheel (contact · suspension-travel
  meter · load · slip). Wheels are named by corner (`FL`/`RR`; a straddled hub reads just `F`/`R`). Below the
  divider, the SHARED vehicle constants (`VEHICLE_PHYSICS_CONSTANTS`) read-only — every car in the world runs
  that one set today, which is what 081/02 replaces with per-car handling. **The sampler runs only while the
  screen is open** (mount enables the capture, leaving disables and resets it), and only the SEATED car is
  sampled, so a closed debugger costs the physics step nothing.
- **Show Normals** (Map screen): on the engine host a debug VIEW mode riding the `moonColor.w` frame lane
  (0 normal · 1 unlit · 2 normals), returned BEFORE fog so the normals read clean; the WebGL host used a
  scene-wide `MeshNormalMaterial` override (`game.setShowNormals`). Auto-resets when leaving the screen /
  closing the panel (`resetTo`) or entering the map viewer.
- **Show Faces** — REMOVED from the engine host 2026-07-20. Its `cell-wire` pass needed `STORAGE` usage on
  every cell's vertex AND index buffer, paid on the whole world at all times for a view that is off in
  normal play, and the field reported a day-and-night fps drop with it. The viewers already provide a
  wireframe.
- **Draw-distance controls** (Map screen): live sliders for the streaming **Draw Distance** (LOD
  ring) + **HD Distance** + **Fog** (`game.setStreaming` / `setFogDistance`; systems read config live
  so they apply next frame). Fog moved here from Atmosphere and **coupled** to the LOD ring — the
  Draw Distance slider sets `fog ≈ lod × 0.8` (FogExp2 saturates at ~1.25× its distance) so the LOD
  cull edge is always hidden; the Fog slider can only pull fog closer (thicker), never expose the edge.
- Picking (WebGL-era; parked on the engine pending a ray query): instanced map objects, procobj
  clutter and road-sign text meshes each reported their host model.
- **Hide object** (Map screen, on a picked model, WebGL-era — the implementation was deleted with that
  renderer; the engine's equivalent primitive is `CellStore.breakPlacement`, which degenerates a
  placement's triangles in the cell index buffer): collapsed the picked instance so you could peek behind it;
  a hidden counter + **Restore all** appear, and every hide is restored automatically on map-viewer exit /
  debugger close (`setMapViewer(false)` calls `restoreAll` — hides can't leak into gameplay). Transient by
  design: a rebuilt cell brings the instance back.
- **Show water / Show procobj** (Map Viewer checkboxes, 2026-08-11): the two SUBTRACTIVE layers — the sea
  sheet (`Engine.waterEnabled`) and the generated clutter (`Engine.clutterEnabled`). Both gate the DRAW only,
  so a dozen toggles cost nothing and the colliders never move, and both are restored on map-viewer exit —
  the checkboxes live in the inspector, so leaving with one off would strand the world without it and take
  the control away with the panel. `MapGame.setShowWater` had been optional and unimplemented on this host
  since 094/07; the checkbox was already written and simply never rendered.
- **The Map Viewer opens NORTH-UP** (`MAP_YAW`, fixed 2026-08-11). `snapTopDown` inherited the player's yaw,
  and the default spawn faces such that the rig sits at yaw 0 — where the top-down basis comes out a half
  turn round (screen right = −X, screen up = −Y in GTA terms), i.e. the map upside down, every time. The
  standalone `sa-map-viewer` had found this in 094 and fixed it only there; the constant is shared now.
- Debug URL params: `?nocull=1`, `?shadowdebug=1`.

## Known gaps / candidates

- HUD: no minimap/radar, no money/health (out of scope so far).
- Zone names cover exterior districts only.

## Test coverage anchors

zone tests (`city`, `zone-name`, `city-zone` systems), GXT hash tests, debug overlay is mostly
manual (UI). Picking and hide-object had unit tests in the WebGL era; both features and their tests went
with that renderer (074/13), and the engine host restored both in 074/22 (phases 7-9) on top of the
`.oscell` placement mapper and `cells.pick`. The overlay's capability gating itself is covered by `debug-capabilities.test.ts`.
