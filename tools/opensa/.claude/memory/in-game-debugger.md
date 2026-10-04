---
name: in-game-debugger
description: F2 in-game debugger (src/ui/debug) + debugMode→mapViewer rename; the only debug overlay
metadata:
  type: project
---

Plan 023 (`.claude/plans/023-in-game-debugger/readme.md`), iterations 1–4 DONE. The old Ctrl+X overlay was
deleted and this one renamed in place — files are now `src/ui/debug/debug-overlay.tsx` (`DebugOverlay`,
F2), `map-inspector.tsx`, `debug-styles.ts`. No `debug2`/Ctrl+X anymore.

- **`debugMode` renamed to `mapViewer`** everywhere (config, `Game.setMapViewer`, event `'map-viewer'`,
  `streaming.system`, canvas-host, old overlay, 4 config test fixtures). It is the map-inspector mode:
  free-fly camera (`cameraController.setMode('debug')`) + manual cell render + click-to-pick.
- **`DebugOverlay2`** (`src/ui/debug/debug-overlay2.tsx`), toggle **F2**. Opening it does NOT enter
  mapViewer. Multi-level menu (`screen` state): root → Player / Vehicles / Game / Map (each with Back).
  - Player: Respawn (re-drop at current spot +1z), To Ganton (`placePlayer(PLAYER_SPAWN)`).
  - Vehicles: Admiral/Camper Spawn (in front of Tommy, distance from the car's COL `halfExtents`),
    Flip vehicle (180° roll about forward via `physics.holdBody`; on wheels↔roof).
  - Game: Show coords → Copy Coords (clipboard).
  - Map: Activate Map Viewer → mounts `MapInspector` (`map-inspector.tsx`), which owns the mapViewer
    lifecycle: `setMapViewer(true)` on mount, `false` + clear on unmount — so Back/×/F2 all exit cleanly.
- **Wiring**: GTA-specific actions live in a `DebugActions` object built in `canvas-host` (`bootstrap`
  now returns `{ game, debugActions }`), passed to `DebugOverlay2`. `spawnVehicle` factory gained an
  optional `anchor` (in-front placement). Getters added: `CharacterAnimationSystem.getFacing()`,
  `EnterVehicleSystem.getActive()`. Styles in `debug2-styles.ts`.

Dropped from the old overlay: GAME Play/Pause (not in the new spec) — re-add to a screen if needed.

**Screenshot fly camera** (separate mini-feature, DONE): `CameraController` gained a third mode
`'fly'` (arrow keys translate along the view dir, mouse looks; seeded from the current view so no jump).
`Game.setFlyCamera(enabled)` switches `'fly'`⇄`'follow'`; `CameraController.update(delta)` now takes
delta. Toggled by the **K+M** chord in canvas-host (a keydown/keyup effect); pressing **F2** (open
debugger) drops fly. Camera-only — streaming still follows the player (`viewOf`), nothing else changes.
Related: [[standalone-viewers]].
