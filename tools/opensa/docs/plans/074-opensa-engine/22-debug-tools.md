# 074·22 — Debug tools port: F2 debugger + photo mode + pointer capture

[← chain](readme.md) · the LAST pre-flip blocker ([10](10-integration-flip.md))

**Status: BLOCKER (user, 2026-07-17) — "the debugger is core workflow; its point is live config
mutation." Scope raised from an audit to the full port. THE FLIP SEQUENCE: this plan ships →
remind the user to run `?bench=all` on the display AND the parity screenshots → flip.**

## The headline finding (audit, 2026-07-17)

**The engine host mounts NONE of the three debug tools today:**

1. **F2 debugger** — `DebugOverlay` + `DebugActions` live only in `canvas-host.tsx` (three);
   `engine-canvas-host.tsx` has a read-only `<pre>` HUD and URL params.
2. **Photo mode** — prod's **K+M chord** toggles a detached free-fly camera
   (`game.setFlyCamera` → camera mode `'fly'`: ARROWS move, mouse looks, gameplay untouched;
   F2 drops fly mode; `fly-camera` event). Nothing similar on the engine host.
3. **Pointer capture button** — prod shows the `sa-capture` **"Click to play"** button whenever the
   pointer is not locked (lock via `canvas.requestPointerLock()`, look = movementX/Y while locked,
   pause/F2 exit the lock, `pointerlockchange` drives the button visibility). The engine host locks on
   canvas click but has NO button — no affordance telling the player to click.

Mechanics that make the port cheap: every debugger control mutates the shared runtime `Config` in
place (`game-runtime-config.ts` — ONE source of truth, both hosts already consume it), and the engine
host re-reads config every frame through the environment driver. Bucket-B controls work the moment the
overlay mounts; bucket A needs `DebugActions` implementations; bucket C needs per-host gating.

---

## Task breakdown (detailed — nothing gets lost)

### Phase 1 — decouple the overlay from the three `Game` object

- [x] 1.1 Inventory every `game.*` touch inside `debug-overlay.tsx` / `perf-panel.tsx` /
      `map-inspector.tsx`. **RESULT — the surface is far narrower than feared:** `debug-overlay.tsx`
      touches the game object exactly ONCE (`game.events.on('city')`); `perf-panel.tsx` touches it
      NEVER (it already goes through `DebugActions.setPerfEnabled/perfStats/gpuTimings`); the whole
      rest — `getConfig`, `getViewCell`, `listCells`, `setMapViewer`, `setManualCells`,
      `setShowCollision`, `hideSelectedObject`, `restoreHiddenObjects`, `events.on('select')` — is
      confined to `map-inspector.tsx`, i.e. to the PARKED Map screen.
- [x] 1.2 `DebugGame` = `{ events: Pick<EventBus<GameEvents>, 'on'> }` (the whole overlay view of
      the game). The inspector's `Game`-shaped surface moved to a separate OPTIONAL `mapGame` prop
      instead of widening `DebugGame` — the engine host simply omits it. Prod passes
      `game={game} mapGame={game}`: zero behaviour change.
- [x] 1.3 `debug-capabilities.ts`: `DebugCapabilities` (per-control/per-screen flags; 20 after phase 2 added `cameraRig`) +
      `ALL_DEBUG_CAPABILITIES` (three host, the default when the prop is omitted) +
      `ENGINE_DEBUG_CAPABILITIES` (bucket-C rows off). Screen filtering (`menuFor`) and the split sky
      slider list (`skyControlsFor`) moved OUT of the .tsx into this pure module so they are unit
      testable (the vitest lane is node-only, `.tsx` is e2e territory); `__DEBUGGER_HIDE__` became a
      `menuFor` parameter instead of a global read.
- [x] 1.4 Unit tests — `debug-capabilities.test.ts`, 7 cases (map screen drops for the engine, dev-only
      screens drop in the deploy build, both full menus, god-ray sliders drop / shared sky keys stay).

### Phase 2 — engine-host `DebugActions` (bucket A: gameplay actions) — SHIPPED 2026-07-18

Landed as `apps/web/src/ui/engine-debug-actions.ts` (`createEngineDebugActions(deps)`, thin host accessors
like `setupPerfRuns`) + the wiring in `engine-canvas-host.tsx`; the overlay mounts with
`ENGINE_DEBUG_CAPABILITIES`. Every graphics row is a plain mutation of the shared `Config` — no per-host copy.

- [x] 2.1 `teleport` / `teleportToGanton` / `respawnPlayer` — over the host's `placePlayer` (physics.teleport +
      Transform writes), the same path the bench teleport uses.
- [x] 2.2 `playerCoords()` — the host `viewOf()` (native Z-up).
- [x] 2.3 `setGameTime(minutes)` — host `hour` (the env driver applies it the next frame).
- [x] 2.4 `setWeather` + `weatherList()` — `WeatherTransition.begin` at `config.weatherTransitionSeconds`,
      sharing the live `[`/`]` weather id; list = the renderware `WEATHER_NAMES` (26 entries).
- [x] 2.5 `vehicleModels()` / `spawnVehicle()` / `flipVehicle()` — `vehicleModelsFromIde` + `vehicles.spawn`
      (awaits the worker model build, carcols colour cycle, `groundSnap`). **Direction gotcha found in the
      field:** the first spawn landed BEHIND the camera — the host's `yaw` is a camera azimuth whose native
      forward is `(sin yaw, −cos yaw)`, while a heading `h` points along `(−sin h, cos h)`, so the car spawns
      at `+forward × 5` with heading `yaw + π`. Flip = prod's algorithm with the quaternion written out
      (the host stays three-free).
- [x] 2.6 `breakNearest()` — new `CollisionStreamingSystem.nearestBreakable(position, radius)` (shared, unit
      tested) + `EngineBreakables.breakNearest`; `smash(impact)` was refactored to `smashKey(key, force, …)`
      so the debugger's forced smash (`force = Infinity`) and a real contact share one path. Tuned-
      indestructible props still survive, as in prod.
- [x] 2.7 `setFlyMode(on)` — the PHOTO CAMERA (one implementation, phase 5 adds the chord): a detached eye
      seeded from the live camera, ARROWS move / PageUp-Down lift, the player entity is untouched. The pure
      halves live in `engine-camera.ts` (`flyStep`, `resolveCamera` — bench > photo > follow rig), unit tested.
- [x] 2.8 Camera screen — **split by counterpart**: distance + zoom bounds now re-read live (a debugger change
      re-seeds the wheel zoom; `followZoom` gates the wheel, as in prod). The five follow-RIG sliders
      (height/angle/response/angle limits) have NO engine counterpart — its orbit is mouse yaw+pitch with a
      fixed eye height — so they are gated off by the new `cameraRig` capability (`cameraControlsFor`).
- [x] 2.9 ProcObj screen — the adapter now gets `procObjDensityOf` (0 when a category is disabled, prod's
      wiring) and `setProcObj` re-scatters: `invalidateColliderCache` + `collision.reload()` + clutter cells
      dropped, so render and colliders re-run from ONE scatter. Field: all 7 categories off →
      draws 206 → 186 (repeatably ~10 %), no errors. Owed: a pixel A/B at a clutter-only spot (Truth's Farm
      keeps its AUTHORED bushes, which reads as "nothing happened" on a screenshot).
- [x] 2.10 Browser click-through with the headless harness (fake picker, real LS install), all clean:
      panel opens on F2 · **Map screen absent from the menu** (capability gating) · Position shows
      `CITY: Los Santos` (the shared `CityZoneSystem` is now wired on this host, emitting `'city'` on the
      shared bus) + live coords + the teleport list · Time 12:00 preset → HUD clock 12:01 · Graphics shows
      god-rays/mood/pbrExposure/bloom/tonemap/reflect-intensity and HIDES SSAO, CSM, water, rays-size,
      density/exposure/weight · Vehicles filter + spawn (draws 567 → 618) · fly mode detaches the camera
      while the player coords stay at `2495.0, −1675.0, 13.3` (that is phase 5.5's criterion, met early) ·
      Weather list 26 · 120 fps throughout, no page errors.

### Phase 3 — engine-host graphics wiring + the Perf screen — SHIPPED 2026-07-18

- [x] 3.1 Per-control smoke, metered headless (screenshot → ImageMagick crop means, so "it changed" is a
      NUMBER). Noon, right-third crop vs base `134.9/132.4/128.5`: bloom intensity+threshold → `189.6`
      (huge) · `sky.pbrExposure` 0.05 → `132.2/127.6/118.0` · `sky.mood` 1.0 → `132.9/130.6/128.4` ·
      tone map off → `128.8/125.4/121.4` · `worldLight.dayBrightness` 0.3 → `117.6`. Sky-band crop:
      `sun.godrays` off → blue −3.7 · cloud cover/opacity max → blue −3.2. Night (22:00), same crop vs
      `40.1/31.1/22.6`: `night.emissiveBoost` 4 → `41.6` · `night.skylight` 2 → `54.4` ·
      `moon.brightness` 3 → `52.5` · `worldLight.nightPrelitBrightness` 1.5 → `63.8` ·
      `vehicleReflection.intensity` 3 → the car crop moves `71.9/34.4/33.6` → `28.7/27.0/29.3`.
      **BUG FOUND AND FIXED — the whole point of the pass:** `night.litFade` did nothing (`40.0` before and
      after). `createEngineEnvironmentDriver` destructured `litFade` (and computed `fogScale`) ONCE at build
      time, while the debugger REPLACES nested config objects (`setNight({ litFade: {...} })`) — so both
      froze at their boot values. Both now read inside `apply()`; regression test added
      (`engine-environment-driver.test.ts`). Re-metered: dusk window → 23:00 at hour 22 now flips the world
      to day lighting, `40.1` → `91.8`.
- [x] 3.2 Streaming screen — **user decision (2026-07-18): no slider, a line of text.** The Draw Distance /
      HD / Fog sliders live on the Map screen, which is capability-gated off here anyway; the engine Perf
      screen instead states `draw distance <N> m — boot-only, set with ?draw=N`. No live ring setter is
      built (plan 21 showed re-ringing is its own project); it stays a post-flip option.
- [x] 3.3 Perf screen — REPLACED with the engine ledger (`EnginePerfPanel`, chosen by the presence of
      `engineStats`): FPS · frame avg/p95 · draws · gpu world/post/probe · submit · cells loaded/pending ·
      late creates · residency MB + the by-category breakdown · the draw-distance note. Rows are built by
      the pure `engineStatRows(snapshot)` (unit tested); three's `renderer.info` counters (triangles,
      programs, geometries, textures) have no engine twin and are gone.
- [x] 3.4 **The Perf screen now OWNS the two developer readouts** (user request, 2026-07-18): the
      on-screen HUD and the `[slow]` console breakdown are toggles there, defaulting to
      `process.env.NODE_ENV !== 'production'` (`apps/web/src/dev-mode.ts`) — ON while developing, OFF in a
      deploy build. The hidden HUD also stops being composed (the string build is the frame's last work);
      a running soak forces it back on, since its verdict is read OFF the HUD. Field: toggling flips
      `#engine-hud` to `display: none`, and a cross-city teleport after switching logs off produced no new
      `[slow]` lines.
- [x] 3.5 **The F2 tip does not show in development** (user request, same round): `GameHint` returns null
      under `IS_DEV` — it is a notification aimed at players, and it covered the corner of the screen for
      the person who wrote the debugger.

### Phase 4 — bucket C gating on the engine host — SHIPPED 2026-07-18 (NOTHING deleted from prod)

- [x] 4.1 Hidden by capability. **The pass found MORE dead rows than the audit listed** — the phase-3 metering
      had proved a knob "works" while its neighbour in the same block did nothing, so every remaining row was
      traced to a consumer in `engine-environment-driver` / the host. Three additions to the gate:
      **CLOUD COVER** (`cloudCover` — the engine takes cover/scale/tint from the per-weather cloud profile
      since sky v2; only `clouds.opacity` reaches the frame), **MOON SIZE + ELEVATION** (`moonRig` — the
      engine builds its own moon arc and draws the disc in the sky model; `moon.brightness` is the one live
      knob) and **five of the seven WORLD LIGHT scalars** (`worldLightExtras` — the driver applies
      `dayBrightness` and `nightPrelitBrightness` only). Row lists follow the phase-2 pattern
      (`worldLightControlsFor`, unit tested), so the split is data, not JSX conditionals.
- [x] 4.2 Per-row disposition — the table below. Nothing is deleted: C2 (plan 13) removes the three path and
      with it the rows marked _retire_; the rest name the plan that would bring them back.
- [x] 4.3 Verified in the browser — the full engine-host row dump, screen by screen:
      **Atmosphere** = dusk/dawn ×4 · cloud opacity · moon brightness · night emissive · night skylight ·
      world day · world night prelit. **Camera** = distance · min/max zoom · wheel zoom.
      **Graphics** = god rays · mood · pbrExposure · bloom + intensity + threshold · tone map ·
      reflect intensity. **ProcObj / Player / Time / Weather / Position / Perf** unchanged.
      Every surviving row was measured moving the frame in phase 3.1 — the engine debugger now has NO row
      that does nothing.

### Phase 5 — photo mode (prod parity: K+M) — SHIPPED 2026-07-18

- [x] 5.1 Free-fly camera state — landed with phase 2.7 (`flyEye`, seeded from the live camera on entry,
      follow rig resumed on exit; the player entity is never touched).
- [x] 5.2 Prod semantics and prod CONSTANTS: `FLY_SPEED` 24 → **18**, the value in
      `camera-controller.ts`, so both hosts fly at the same speed. The strafe axis was also wrong and is
      now prod's: `right = forward × up` = `(−cos yaw, 0, sin yaw)` — ArrowRight used to strafe the wrong
      way. ARROWS move, the mouse look is the shared yaw/pitch; PgUp/PgDn lift (an engine addition — prod's
      fly camera has no vertical key, and a photo camera wants one).
- [x] 5.3 K+M chord — prod's state machine extracted as `createChordWatcher` (fires ONCE while both keys
      are held, re-arms only after a release; key repeat cannot re-fire it), unit tested. F2 drops the photo
      camera; **pausing drops it too** (with the pointer-lock release that was already there).
- [x] 5.4 HUD gained the chord line: `F2 = debugger · K+M = photo camera (ARROWS move, PgUp/PgDn lift,
mouse looks)`.
- [x] 5.5 Verified headless: chord ON → the frame changes completely (RMSE 0.26 vs the follow shot) while
      the player HUD coords stay at `2495.0, −1675.0, 13.3`; chord OFF → the follow rig returns
      (RMSE 0.036 vs the original — clock text only); flying high then F2 → back on the follow rig, and the
      debugger's Player screen agrees (`Fly Mode On` = it is off). **Bonus parity that fell out of reusing
      prod's `'fly-camera'` event: the game HUD (clock/zone) hides itself in photo mode**, because the
      shared `<Hud>` already listens for it — one emit, zero new code.

### Phase 6 — pointer capture button — SHIPPED 2026-07-18

- [x] 6.1 Prod's `sa-capture` "Click to play" button ported into `EngineCanvasHost` verbatim — same class
      (so the shell CSS already styles it), `locked` state from `pointerlockchange` compared against THIS
      canvas, hidden while locked, while paused, or before the world is up.
- [x] 6.2 The existing canvas-click lock stays (the button is the affordance, not the only path); Esc /
      pause still release the lock, and pause now also drops the photo camera (phase 5).
- [x] 6.3 Verified headless: visible at boot (screenshot shows CLICK TO PLAY centred over Ganton) ·
      hidden while the pointer is locked · back when the lock is released · hidden while paused (Esc opens
      the pause menu, HUD reads `PAUSED`). **Harness note:** headless Chromium refuses a real pointer lock,
      so the locked/unlocked branch was driven by stubbing `document.pointerLockElement` and dispatching
      `pointerlockchange` — that exercises OUR rule; the request path is prod's code unchanged.

### Close-out of phases 1–6

- [x] 7.1 The ritual display sweep — **user-run `?bench=all` on both renderers, 2026-07-18**, recorded in
      [bench/series.md § 22·debug-tools](../../benchmarks/opensa-engine/2026-07-18-series.md). Engine: all six scenes vsync-locked, avg
      8.33–8.41 ms / p95 ≤ 9.4 (118.9–120.1 fps), draws 11–1 069, `lateCreates` 0. Prod (`?engine=three`,
      same 841-car population): 16.7–38.8 fps on land, 4 252–10 078 draws. Frame ratio 3.1–7.2×.
      **The overlay costs nothing while closed** — the engine rows match the pre-port C1 rows (8.32–8.33
      then, 8.33–8.41 now, inside noise).
- [x] 7.2 Series row written (with the honest tail: the residual 20–54 ms hitches are Rapier step time at
      ~1 000 bodies / 5 378 colliders, not the renderer; one 22.8 ms collision-cell spike; residency
      ≈1.6–1.7 GB at 2× with 841 cars). Bucket D stays a POST-FLIP batch for the user to pick from.
- [x] 7.3 **Remind the user: parity screenshots → THE FLIP.** Done — the user signed parity off ("parity
      ok") and [10-flip-decision](10-flip-decision.md) was written 2026-07-18; C2 followed the same day.

---

## Audit reference (2026-07-17) — the four buckets

### Bucket A — carries AS-IS (renderer-agnostic; Phase-2 wiring)

| Screen   | Controls                                         | Engine-host reality today                                               |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Player   | fly mode, respawn, to-Ganton, break nearest prop | breakables EXIST (B7); fly/respawn/teleport need `DebugActions` impls   |
| Vehicles | filter + spawn any vehicles.ide model, flip      | vehicle system EXISTS (B5, worker builds); spawn/flip need action impls |
| Time     | presets + 0–1439 slider                          | engine host has `hour` — trivial                                        |
| Weather  | timecyc weather list                             | `WeatherTransition` already wired (6 s blend, `[`/`]` keys) — trivial   |
| Position | city label, coords, copy, teleports              | teleport = the bench `teleportPlayer` path — trivial                    |
| Camera   | 8 follow sliders + wheel-zoom toggle             | same `camera.*` config — verify live re-read                            |
| ProcObj  | per-category enabled/drawDistance/density        | engine clutter uses the SAME scatter — verify config reaches it live    |

### Bucket B — already flows through the env driver (works once the overlay mounts)

`graphics.bloom.{enabled,intensity,threshold}` · `graphics.sun.godrays` · `graphics.sky.mood` ·
`graphics.sky.pbrExposure` · `graphics.clouds.opacity` · `graphics.night.emissiveBoost` ·
`graphics.night.litFade.*` (4 sliders) · `graphics.night.skylight` · `graphics.moon.brightness` ·
`graphics.worldLight.{dayBrightness,nightPrelitBrightness}` · `graphics.toneMapping` (on/off) ·
`graphics.vehicleReflection.{preset='off',intensity}` · `fog.timecycScale`. **All verified with metered
screenshots in phase 3.1** — and that pass is what caught the driver reading `night.litFade` / `fog.timecycScale`
only once at boot.

### Bucket C — hidden on the engine host, with their DISPOSITION (phase 4.2 — user reviews before C2)

`retire` = dies with the three path at C2 (plan 13) · `plan 17` = comes back with the map-lighting round ·
`needs feature` = the engine would have to grow something first · `0.6.0` = an idea-cycle plan owns it.

| Control (prod)                                                                                         | Why it has no engine counterpart                                              | Disposition                  |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------- |
| Tone-mapping CURVE selector (aces/agx/neutral/none)                                                    | engine ships ONE prod-exact ACES + on/off                                     | retire                       |
| Pipeline switch classic/modern                                                                         | one pipeline; the switch IS what C2 deletes                                   | retire                       |
| PBR sky toggle classic/pbr                                                                             | engine sky is always physical (`?sky=preetham` = dev A/B)                     | retire                       |
| Car reflect presets enhanced/PC/PS2                                                                    | engine = skygfx-neo live probe; off/on + intensity remain                     | retire                       |
| SSAO enabled/intensity/radius                                                                          | replaced by the BAKED AO channel                                              | bucket D (`aoStrength`)      |
| Sun shadows + CSM distance                                                                             | no CSM; baked sun-vis (`sunVisStrength`)                                      | 0.6.0/04 shadows             |
| Volumetric clouds toggle                                                                               | no raymarcher; decks are the baked 256² field                                 | retire                       |
| God-rays shader sliders density/exposure/weight                                                        | engine godrays = one pass, one strength                                       | retire (strength → bucket D) |
| Night dynamicObjectsFill strength/rim                                                                  | plan-034 three shader; engine lights peds/vehicles itself                     | retire                       |
| Night skyGlow                                                                                          | built into the engine sky model (city glow + moon scatter)                    | retire                       |
| Night windowGlow                                                                                       | superseded by the baked emissive mask (`emissiveBoost` kept)                  | retire                       |
| Corona distance slider                                                                                 | engine restores the AUTHORED 2dfx farClip; a cap fights the data              | plan 17                      |
| Headlight pool sliders (beam/brake/glow/corona)                                                        | engine `dynamicLights` intensities are host constants                         | bucket D                     |
| Water sliders (6)                                                                                      | engine water = own shader (sea/inland, baked shore); no 1:1 mapping           | 0.6.0/02 water               |
| Sun size / rays size                                                                                   | `sunSize` comes from timecyc through the driver                               | retire                       |
| Show Normals / Show Faces                                                                              | three material overrides; engine needs a debug shader variant                 | needs feature                |
| Map inspector (manual cells, pick, hide/restore)                                                       | SHIPPED phases 7-8 — pinned cells + the `.oscell` placement mapper            | **done**                     |
| Draw distance / HD / fog sliders (Map screen)                                                          | SHIPPED phase 7 — restored unchanged; its four accessors were already live    | **done**                     |
| Night stars toggle                                                                                     | the starfield is part of the sky model, no flag                               | retire                       |
| Night lights (lamps) toggle                                                                            | static lamp pool REMOVED 2026-07-17                                           | plan 17                      |
| Effects distance (2dfx particles)                                                                      | knob not wired                                                                | plan 17                      |
| **Cloud COVER** (found in phase 4)                                                                     | cover/scale/tint come from the per-weather profile (sky v2)                   | retire                       |
| **Moon SIZE + ELEVATION** (found in phase 4)                                                           | the engine builds its own moon arc + draws the disc in the sky model          | retire                       |
| **World light: dusk / LOD-night-amb / shadow strength / sun direct / sun indirect** (found in phase 4) | the driver applies day + night-prelit brightness only                         | retire                       |
| Camera follow-RIG sliders (height/angle/response/limits)                                               | engine orbit = mouse yaw+pitch, fixed eye height; distance + zoom bounds stay | needs feature                |
| Perf panel content                                                                                     | REPLACED with the engine ledger + HUD / slow-log toggles (phase 3.3–3.4)      | done                         |

### Bucket D — NEW engine-only knobs (POST-FLIP batch, user picks)

`renderScale` (THE tier knob — config exists, prod never had UI) · draw distance (`?draw`) ·
`aoStrength` · `sunVisStrength` · `windStrength` · `stochastic` (unstable v1) · `skyModel` A/B ·
`godrayStrength` · `fogHeightK`/`fogHeightMin` · probe on/off + `probeView` · `reflectionStrength`
raw · `moonPhase` · `bloomThreshold` night profile · dynamic light/corona intensities · bench/soak
launchers · wishlist: normals/wireframe debug pipeline. (The engine map inspector left this list — shipped in
phases 7–8 below.)

## Ledger

| Date       | What                                                                                                                                                                                                    | Notes                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-17 | Audit (3 explore passes: prod overlay · engine host+Environment · lab)                                                                                                                                  | Headline: no debug tools mounted on the engine host at all. Buckets frozen above.                                                       |
| 2026-07-17 | Scope raised to BLOCKER + photo mode (K+M) + capture button; plan renamed `22-debug-tools`                                                                                                              | User: after this ships → display `?bench=all` + screenshots → FLIP.                                                                     |
| 2026-07-18 | **Phase 7 (7.1–7.2)** — display `?bench=all` on both renderers recorded in series § 22·debug-tools                                                                                                      | Engine 118.9–120.1 fps all six vs prod 16.7–38.8; overlay-closed cost = none. Residual hitches identified as PHYSICS, not the renderer. |
| 2026-07-18 | **Phase 6 SHIPPED** — `sa-capture` "Click to play" ported to the engine host (locked/paused gating, shell CSS reused)                                                                                   | Field-verified all four states; real pointer lock is unavailable headless, so that branch was driven through `pointerlockchange`.       |
| 2026-07-18 | **Phase 5 SHIPPED** — K+M chord (prod's watcher, extracted + tested), prod fly speed/axes, F2 + pause drop it, HUD hint; the game HUD hides itself via the shared `'fly-camera'` event                  | Field: RMSE 0.26 photo vs follow, 0.036 back vs original; player never moves.                                                           |
| 2026-07-18 | **Phase 4 SHIPPED** — bucket-C gate closed; tracing every surviving row to its consumer found 8 MORE dead knobs (cloud cover, moon size/elevation, 5 world-light scalars)                               | Per-row disposition table written for the C2 review. Engine debugger now has no row that does nothing.                                  |
| 2026-07-18 | **Phase 3 SHIPPED** — bucket-B metered smoke (found + fixed the frozen `litFade`/`fogScale` driver reads), engine Perf ledger, HUD + slow-log toggles defaulting to dev, F2 tip hidden in dev           | 3.2 closed by user decision: text, not a slider. Suite 2150 green.                                                                      |
| 2026-07-18 | **Phase 2 SHIPPED** — `engine-debug-actions.ts` + host wiring (city system, procobj density, photo camera, spawn/flip/break), `engine-camera.ts`, `nearestBreakable`                                    | Browser-verified click-through (see phase 2.10). 18 new unit tests; suite 515 green.                                                    |
| 2026-07-18 | **Phase 1 SHIPPED** — `DebugGame` + optional `mapGame` + `debug-capabilities.ts` (19 flags, `menuFor`/`skyControlsFor` extracted as pure logic), bucket-C rows gated in the Atmosphere/Graphics screens | Prod unchanged (default = all capabilities; `mapGame={game}`). 7 new unit tests; tsc + eslint clean; apps/web suite 45/45.              |

---

## Phase 7 — the Map screen RESTORED on the engine host (2026-07-19)

Plan 13 phase 5 recorded the Map screen as a deliberate loss ("three-host only; the engine host never had
them"). The user's verdict on the rebuilt debugger: it was **the most important element**, so it comes back.

**What was there** (recovered verbatim from `a312f0d^`): `map-inspector.tsx` (241 lines) — the region-coloured
SECTION grid with per-cell checkboxes, "Whole map", "Show LODs", a COLLISION toggle and a SELECTED panel
(name/txd/pos/mat + Hide object / Restore all) — plus `MapScreen` and `DrawDistanceControls` inside
`debug-overlay.tsx`.

**What survived the deletion**, and made this cheap: the `'map'` screen union member, the `Map` menu row, the
`mapScreen` capability + its `menuFor` filter, and **every** grid style in `debug-styles.ts` (`CELL_PX`, `cell`,
`cellCenter`, `cellEmpty`, `grid`, `sectionsBox`, `legend`, `swatch` …) — dead but intact. Only the components
and the render branch had gone.

### Shipped

- **`StreamingDriver.listCells()` + `setManualCells(cells, lod)`** — the driver's public surface was
  `unloadAll()` + `update()` and nothing else. The pin is injected at `desiredLevel()`, so the rings are
  BYPASSED rather than the update loop suspended: creates keep their frame budget and the atomic HD↔LOD swap
  still applies, and a pinned set fills in over a few frames instead of hitching. **Gotcha found by test:** the
  evict branch is guarded by the RING margin, so an unselected cell sitting under the camera would never
  unload — deselecting one would leave it on screen forever. Eviction now also fires whenever a pin is active.
- **`StreamSetup.cellSize`** — the inspector's grid maths needs the PAK's pitch, and `setup.ts` was computing
  it and throwing it away. It is the truth over the runtime config's copy, which a pak converted at another
  size would contradict.
- **`MapGame`** — the inspector's host contract, declared in `map-inspector.tsx` (the three `Game` class it
  used to take no longer exists). Selection members are OPTIONAL: a host without picking omits them and the
  SELECTED panel explains itself instead of showing dead buttons.
- **Host wiring** — `debugRef.mapGame`: `listCells`/`setManualCells` straight to the driver, `viewCell` from
  the player position, and `setMapViewer` reusing the existing photo camera (`setFlyMode`) plus the shared
  `'map-viewer'` event the HUD already listens for. `topDownView` was a stub returning `undefined`; it now
  lifts the detached eye 400 u over the player and pitches down (stopping 0.01 rad short of vertical — a
  perfectly vertical forward vector is degenerate for the look-at basis).
- **New capability `meshOverrides`** — Show Normals / Show Faces are three material overrides needing a debug
  world-pipeline variant, so they are gated OFF separately rather than dragging the whole screen down with
  them. `mapScreen` flips to `true` for the engine.
- **`DrawDistanceControls` restored unchanged** — it needed no engine work at all: `streaming()`,
  `setStreaming()`, `fogDistance()`, `setFogDistance()` were all already live on the engine actions.

6 new driver tests (pin ignores the rings · the pin LOADS its cell even outside the ring · a pinned level the
pak lacks · deselect evicts under the camera · the pin clears back to focus streaming · listCells dedups
levels); the two capability tests that asserted the Map
screen DROPS for the engine were updated — the behaviour intentionally changed. Suite 2266/321 green.

### Still open — picking (the selection half)

`WorldObjectInfo` selection is NOT wired, because cells are welded, material-batched geometry recorded once
into an immutable `GPURenderBundle`, with no per-vertex id channel and no model name anywhere in the cell
data. The `objectTable` is not an identity table — it holds only unmergeable objects (timed/breakable/
animated/roadsign/uvScroll) and its `params` is an animation slot, not an id.

**The agreed route (user, 2026-07-19) is an auxiliary MAPPER in the format, and the user will rebuild for it.**
The pattern already exists in miniature: `OscellBreakable {keyHash, indexOffset, indexCount}` gives per-
placement identity for smashables, and `CellStore.breakPlacement()` already hides one placement by degenerating
its indices with a single `writeBuffer`. Generalising that table to ALL placements (`nameRef` into a string
table + `indexOffset/indexCount` + an AABB) buys the whole SELECTED panel: pick = CPU ray against the
placements' AABBs in visible cells (no BVH, no ID-buffer readback), hide = the existing `breakPlacement`,
restore = re-upload the cell's original indices. Note `breakPlacement` has no inverse today, and `indexData`
is retained only for cells that carry breakables — restore has to solve that.

---

## Phase 8 — the placement MAPPER in the format (2026-07-19)

Phase 7 left the SELECTED panel unwired because welded cells have no per-object identity. The user chose the
mapper route and accepted the rebuild it costs.

**The insight that made it cheap:** the identity is not lost during the weld, only unrecorded. `OscellBreakable
{keyHash, indexOffset, indexCount}` already does this for smashables, and `CellStore.breakPlacement()` already
hides one by degenerating its indices. The mapper is that table generalised to every placement.

### `.oscell` minor 6

`OscellPlacement {id, nameRef, txdRef, indexOffset, indexCount, bounds[6]}` — 40 B/row — plus a per-cell name
pool (`Oscell.names`). One row per (part × instance × bucket), sharing an `id` (the SAME FNV-1a placement hash
the breakable table and the physics colliders use, so rows cross-reference either). Each row carries its OWN
AABB: a box around the whole model would swallow its neighbours on a pick.

Header count appended under `minor >= 6`, table appended after the breakables, pool last and written only when
rows reference it — the established rule, so a pre-mapper pak reads as "no placements" and the Map screen just
does not pick.

**The trap this rule exists for, and it bit immediately:** `oswire.ts` re-parses the header independently to
find the payload sections (`r.seek(68 + (minor >= 2 ? 4 : 0) + …)`). The new count shifted every wire offset
and two wire tests failed. The comment there warns about exactly this; the `minor >= 6` term is now in it.

### The welder

`WeldPlacementRange` mirrors `WeldBreakableRange` and is filled by a shared `recordRanges()`; bounds come from
exactly the vertex rows that append produced. `buildPlacementTable()` resolves bucket-relative starts to
absolute offsets (only the layout knows where a bucket landed), interns names, and MERGES rows of the same
placement that ended up adjacent in the final index buffer — a five-material building placed 40 times would
otherwise be 200 rows. The mapper rides BOTH levels, because "Show LODs" must still answer what was clicked.

### The engine

`CellStore.debugPicking` (default OFF) gates BOTH parsing the mapper and retaining `indexData`. This is the one
real design decision: a full map's mapper is tens of MB and the heap is 21 MB today, so paying for it in play
would undo the residency work. It takes effect on the next load, which entering the map viewer forces with
`unloadAll()`.

- `pick(origin, direction)` — ray/AABB slab test over the rows of every VISIBLE cell, nearest wins. No BVH, no
  ID-buffer readback; neither is possible on batched geometry with no per-vertex id. A ray starting INSIDE a
  box hits at 0 (clicking while stood inside a building selects it).
- `hidePlacement(id)` — `breakPlacement`'s degenerate-index trick on a mapper row, with the same 4-byte
  alignment rule (an unaligned `writeBuffer` is REJECTED with only a warning — a u16 range starting on an odd
  index would silently refuse to hide).
- Restore needs no inverse and no extra memory: the host calls `driver.unloadAll()` and the pinned set
  re-streams, rebuilding index buffers straight from the pak. That is already `breakPlacement`'s documented
  restore story, and SA's.

### The host

A click in the map viewer PICKS instead of grabbing the pointer, along the camera's forward vector — the
crosshair, not a cursor: the viewer flies with the mouse steering the look, so unprojecting a cursor position
would be wrong the moment the pointer locks. The hit is emitted as `'select'` with the position converted back
to GTA coords (engine `(x, y, z)` → `(x, −z, y)`), which is what the map files use and therefore what the panel
should show.

### Tests — 15 new, suite 2281/321 green

Format: mapper + name-pool round-trip FIELD BY FIELD (a rotation inside a reader is what cost a round on the
breakable table), a bad AABB throws, a pre-mapper cell reads clean. Welder: every placement named, ranges
inside the buffer, one id and one box per instance 10 u apart as placed, and **the mapper covers every triangle
in the cell exactly once** — a gap is an unpickable object, an overlap means two objects claim the same
triangles. Engine: picking off ⇒ no hits at all; ray beside/behind the boxes misses; frontmost wins; the
**cell ORIGIN is applied** (cell-local bounds would pick the wrong district); inside-the-box hits at 0; a
hidden placement stops picking while its neighbour survives.

### Owed after the user's rebuild

The pak-size delta. Estimate only, to be replaced with the measured number: 40 B/row after merging, so a cell
with ~2 000 rows adds ~80 KB, and a full map lands in the tens of MB against a 1.4 GB pak. `weldStats.placements`
reports the row count per cell and rides the existing convert report.

## Phase 9 — the map viewer, field-repaired (2026-07-20)

The user reported the Map screen as "completely non-functional": activation did nothing, orbit/pan were dead,
and Show Normals / Show Collision were absent. It turned out to be FIVE independent gaps, not one break, and
the headline symptom had the smallest cause.

**The pointer-lock regression is the one that mattered — and the user diagnosed it.** `canvas-host` (prod) has
exactly ONE `requestPointerLock`, in the "Click to play" button's handler; the canvas's own click only PICKS.
The engine host had added a second one to `pointerdown`, so the first press anywhere captured the pointer.
Click-to-select could therefore never fire: the click that would have selected was spent taking the pointer.
Removed — drag-look already covers looking around while unlocked, and capture is the button's job again.

**Activation looked dead because nothing moved the camera.** The chain was intact — `setMapViewer` pinned
cells, enabled `debugPicking`, detached the eye — but `setFlyMode` only detaches the eye WHERE IT STANDS.
You entered the viewer at the player's shoulder looking where you already looked, which is indistinguishable
from a dead button. Prod snapped overhead inside `enterDebug()`; the port had moved that to a separate "Top"
button and lost it from activation. `snapTopDown()` is now shared by both.

**Orbit/pan had no implementation at all.** Prod used three's `OrbitControls` (LEFT = pan, RIGHT = rotate);
three is gone and nothing replaced it, and the `mapViewer` branch of `pointerdown` returned early so even
drag-look was off. New pointer handling in the host, with the pure math in `engine-camera.ts`: `cursorRay`
(the NDC→world ray, matching `mat4LookAt`'s basis exactly) and `panStep` (eye slides opposite the drag,
scaled by eye HEIGHT so a gesture covers the same apparent distance at any altitude). A left press is
ambiguous until it ends — under 0.01 NDC of travel it is a pick, above it a pan — so panning a district no
longer selects whatever it started on.

**Picking now uses the CURSOR.** Phase 8 picked along the camera forward and justified it by pointer lock;
in the viewer there IS no pointer lock, so the crosshair was simply the wrong aim. `cursorRay` replaces it.

**Show Collision** was not ported because `build-col-wireframe` was three-shaped. The engine had a complete,
UNUSED debug-line stack (`createDebugLines` + the `debug-line` line-list pipelines, zero consumers outside
the engine). New `collision-wireframe.ts` builds endpoint pairs from `ModelColliders` — the engine-agnostic
seam physics already consumes, so the overlay draws exactly what physics was given — and converts GTA Z-up to
engine Y-up. It follows the CAMERA, not the player (in the viewer you fly away from the player), and rebuilds
only when the camera changes cell.

**Show Normals** had no WebGPU equivalent: prod used a scene-wide `MeshNormalMaterial` via `overrideMaterial`.
Implemented instead as a debug VIEW MODE widening the existing `moonColor.w` lane — 0 normal · 1 unlit ·
2 normals — so the frame uniform does NOT grow. That constraint is load-bearing: growing it mints a new bind
group, and that bind group is recorded into every cell bundle. Normals win over unlit, which is exactly how
prod's single override slot behaved. Returned before fog (a fogged normal shows nothing).

`meshOverrides` used to gate Show Normals AND Show Faces together. Split into `meshOverrides` (normals) and
`meshFaces` (the wireframe), so a host can honour one without the other. `meshFaces` was false at this point
and its button visibly disabled rather than silently inert; it was implemented properly later the same day —
see "Show Faces, restored properly" below. The disabled styling stays as the general rule for a
capability-gated button.

### Tests — 20 new, suite 2309/322 green

`cursorRay`: centre returns forward untouched, stays unit length off-centre, leans the right way per axis,
widens with aspect, and survives the near-vertical top-down forward the viewer rests at (the reason the pitch
stops at −π/2 + 0.01 — a vertical forward has no defined screen basis). `panStep`: opposite the drag, scaled
by height. `buildCollisionLines`: triangles → three edge PAIRS, the GTA→engine swap, placement translation
applied, one set per placement, box edges and sphere rings counted. `debugViewMode`: 0 by default (normal
play must not take a debug branch), 1/2 per flag, normals win when both are set.

The 13 shader golden snapshots moved because the debug helper block is shared by every module; the two real
call-site changes appear once each, which is what the review gate is for. (A 14th, `cell-wire`, was added by
the Show Faces work below.)

### Not verified in-game yet (at the time of writing)

All of this was compile- and unit-verified only; the fog fix and Show Faces were headless-field-verified
afterwards (see the two sections below). What is still unconfirmed in-game is picking and the collision
overlay. Picking additionally needs a pak carrying the `.oscell`
placement mapper (minor 6) — on an older pak `pick()` returns null forever and the panel says so, which is a
DATA state, not a code bug. Confirm both on the user's next run.

### The black map viewer was FOG, not coordinates (2026-07-20, headless field check)

The user reported that after the phase-9 fixes the camera moved but showed an empty brown screen, that the
active district was invisible, and that "Whole map" changed nothing — suspecting broken coordinates.

Reproduced headlessly (`bench-harness` over the user's own `build/original/opensa`, F2 → Map → Activate →
Whole map). The coordinates were fine and the streaming was fine: the whole-map pin loaded **840 cells /
2 518 cell-vertex buffers / 4 622 MB residency and drew 1 297 batches**. Every one of them into an invisible
frame.

`TOP_DOWN_HEIGHT` is 400, and the authored fog cut is routinely far less — clear LA is 800, FOGGY_SF is 250,
and 074/21 deliberately removed the old `max(…, 1200)` floor so weathers run their raw `farClip`. So from
overhead the ground sat at or past the cut. Worse, `fogCutDistance` is not only a look: `engine.ts`
culls with `sphereFullyBeyond(camera.eye, …, env.fogCutDistance)`, so distant cells were **discarded**, not
merely tinted. At night the fog colour is the night sky, which is why it read as a dead brown screen.

Fix: the map viewer renders with fog OFF (`NO_FOG_DISTANCE = 100 000`, past the 10 000 far plane), re-applied
after `environmentDriver.apply` each frame because that rewrites both distances from timecyc. Fog is a look
and the viewer is an inspection tool. Verified in the same harness — the district reads cleanly from above,
and "Whole map" shows the freeway, the stadium and the LS blocks at 1 646 draws.

**Known caveat:** `streaming.ts` counts a `lateCreate` for any cell appearing inside the fog cut, so while the
viewer is open that honesty metric is meaningless (every pinned cell counts). The bench never opens the map
viewer, so the perf-ritual numbers are unaffected — but do not read `lateCreates` from a map-viewer session.

**Show Faces was still unavailable at this point** and was made to LOOK it (dimmed, `not-allowed`, a title
explaining why) instead of presenting an enabled button that does nothing — which is exactly how it got
reported as broken. It was implemented properly later the same day via the storage-buffer index lookup named
here; see the next section.

### Show Faces, restored properly (2026-07-20)

The user chose the correct implementation over the cheap one, and it is in.

**Why it could not be a port.** A solid wireframe needs to know where in its triangle each pixel is, and
indexed geometry cannot say: under `drawIndexed`, `vertex_index` is the value READ FROM the index buffer, so
`vertex_index % 3` is meaningless, and neighbouring triangles share vertices anyway. three answered this with
a scene-wide `overrideMaterial` + `wireframe: true`; WebGPU has no such concept.

**What it does instead.** The `cell-wire` pass does not use the fixed-function index path at all. It draws
**non-indexed** with `vertexCount = indexCount` and reads the cell's vertex AND index buffers as read-only
STORAGE: `vertex_index` is then the position in the triangle list, its remainder mod 3 IS the barycentric
corner, and the real vertex is looked up through the index array by hand. No geometry is duplicated and no
edge buffer is built. The fragment draws the edge with an `fwidth`-scaled band — one pixel wide at any
distance — and discards the interior.

Costs and details worth keeping:

- Cell vertex/index buffers gained `GPUBufferUsage.STORAGE`. Read-only, no extra allocation.
- The index WIDTH has to travel to the shader, because this is the one consumer that unpacks the buffer
  itself rather than getting the format from `setIndexBuffer`. It rides **bit 2 of the per-cell flag word**
  (`origin.w`), next to the existing baked-channel bits — the same spare-lane discipline the debug view mode
  uses. u16 pairs share a word, low half first.
- `STRIDE_WORDS` is DERIVED from `OSCELL_VERTEX_STRIDE`, not typed into the WGSL: a format change must not
  need a second edit in a shader.
- The pass is depth-TESTED but does not write, draws with `cullMode: 'none'` (a front-faces-only wireframe
  reads as a solid shell from above), and runs once per visible cell only while the toggle is on.
- Unlike Show Normals it is an OVERLAY pass, not a shading mode, so the two are independent in the engine —
  the UI still makes them mutually exclusive, matching how prod's single override slot behaved.

`meshFaces` is now true on the engine host, and the capability split introduced earlier stays: it is a real
per-feature gate, not a placeholder.

**Field-verified in the headless harness** on the user's own pak: the whole district renders as a correct
per-triangle wireframe — road triangulation, building faces and tree cards all read individually — and the
button toggles back off.

### Coverage audit, and what it caught (2026-07-20)

An audit of the phase-9 work against the test suite found the pass itself untested end to end. Eleven tests
were added (suite **2320/323**); the ones worth naming:

- **`drawCellWireframe` gating** — a frame with `debugFaces` off issues NO `cell-wire` draw; on, exactly one
  per visible cell, `kind: 'draw'` (not `drawIndexed` — an indexed draw would destroy the shader's whole
  premise), `vertexCount === cell.wireVertexCount`, bind group 2 = `<key>:wire`. One test covers the
  pipeline, the bind group, the count and the gate.
- **`wireVertexCount` for BOTH index widths** — the stride divide was executed on both paths every run and
  asserted on neither; a mix-up would silently halve or double the wireframe.
- **The STORAGE usage flag.** This one needed a harness extension: `fake-device.ts` was dropping
  `descriptor.usage` on the floor, so losing the flag was invisible to every unit test and would have failed
  only on a REAL device, at bind-group creation. `FakeGpu.bufferUsage` now records it, and the test asserts
  the cell buffers keep VERTEX/INDEX as well as gaining STORAGE.
- **Flag-word bit 2** composing with the baked-channel bits (`SUN_VIS | index16 === 5`) — a mask regression
  is otherwise silent.
- **The debug view reaching the frame uniform** (`floats[71] === 2`): `debugViewMode()` being correct is
  worth nothing if the lane it rides is never written.
- **`setShowNormals` / `setShowFaces` forwarding** — both were literal no-ops before this plan, so a
  regression back to one would have been invisible.
- **`hdFolder`** in lod-trees, mirroring `swapFolder`'s five cases. It was exported for this; the two helpers
  are duplicated logic with slightly different `.dff` checks, and are a merge candidate.

**Standing gap, honestly recorded:** `apps/web/src/ui/**` is EXCLUDED from the coverage floors
(`vitest.config.ts`), and that exclusion carries a written rule — anything excluded must have e2e coverage on
the Playwright lane. The `e2e/` specs mention neither the map screen nor any of these toggles. So
`collision-wireframe.ts` is unit-tested by choice rather than by policy, and the map-viewer INPUT path
(orbit/pan/dolly, the click-vs-drag threshold, `ndcOf`) has no automated coverage at all — only the headless
screenshots taken this session. Two pure functions worth extracting into `engine-camera.ts` next to their
tested siblings: `ndcOf` (a missing y-flip breaks picking while `cursorRay`'s own tests stay green) and the
wheel-dolly step.

## Show Faces — REMOVED (2026-07-20)

The `cell-wire` pass described above is gone, one day after it landed. It was correct and it worked; it was
not worth its price.

**Why.** The technique needed `GPUBufferUsage.STORAGE` on the vertex AND index buffer of every cell, because
the shader looks a vertex up by hand to keep `vertex_index % 3` as the barycentric corner. That flag is not
free and it is not conditional: declaring a buffer storage-capable denies the driver fast paths for
vertex/index fetch, and it was paid on every cell in the world, in every frame, for a debug view that is off
in normal play. Buffer usage cannot be changed after creation, so there was no way to pay it only while the
view is on short of recreating every cell on toggle.

The field reported an fps drop that was present **day and night and unrelated to vehicles** — the profile of
something touching all world geometry rather than one model class. This landed in the same commit
(`03f05b1`). The removal was the user's call: the viewers already render a wireframe, so the capability was
duplicated, and the engine host paid for it in every frame of normal play.

**What went with it:** the `cell-wire` shader module and pipeline, `cellWireLayout`, `CellHandle.wireBindGroup`
and `wireVertexCount`, `Engine.debugFaces` and `drawCellWireframe`, the `meshFaces` capability and the Show
Faces button, and cell-flag **bit 2** (the index width, which only that pass had to unpack by hand — every
other consumer gets it from `setIndexBuffer`).

`cells.test.ts` now pins the inverse invariant: the cell buffers must NOT carry `STORAGE`, and the flag word
must carry the baked-channel bits only. Show Normals and Show Collision are untouched — neither needs
storage access.

**Not yet measured.** The fps hypothesis above is reasoned from the usage flag, not benchmarked; the
before/after belongs in [084](../084-vehicle-appearance/readme.md) row 4 with a number next to it.
