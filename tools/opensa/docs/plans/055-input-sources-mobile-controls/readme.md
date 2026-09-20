# 055 — Pluggable input sources + mobile on-screen controls

> **Regressed and restored (2026-08-03).** Phase 2's wiring lived in `canvas-host.tsx`, which the engine
> migration deleted (074/13 phase 5a+5b) — the overlay, the source and the e2e spec all survived, but nothing
> mounted them, so **0.4.0 shipped with no mobile controls**. The engine host now does both halves
> (`setupTouchControls` + `foldTouchCamera` — the camera is host-owned there, so look/zoom need their own
> wire: `docs/restrictions/architecture.md`). Current state lives in
> [`docs/features/mobile-controls.md`](../../features/mobile-controls.md); the field check that would have
> caught it is `scripts/debug/touch-controls-check.ts`. Everything below describes the original 2026-06-22
> work and its `src/…` paths, which the monorepo move has since renamed.

**Status: ✅ DONE (2026-06-22).** Two phases — (1) a device-agnostic input layer the game reads
(behaviour-preserving refactor), (2) the mobile on-screen controls + touch look as an additive UI module.
Builds on the existing `src/game/input/` (`Keyboard`), the `ControlsConfig` keymap, the movement systems
([016](../016-enter-vehicle/readme.md)/[017](../017-vehicle-driving/readme.md), character-controller) and the camera
([036](../036-follow-camera/readme.md), [022](../022-debug-viewers/readme.md)).

> **Phase 2 implemented (2026-06-22).** `TouchInputSource` (`src/game/input/touch/`) — a headless source the
> overlay drives (`setMove`/`setAction`/`setLookRate`/`addZoom`); full move deflection sets `run`. Overlay in
> `src/ui/controls/`: `Joystick` + `ActionButton` + `TouchControls` (move joystick left, look joystick right,
> Jump/Enter stacked above the look stick) + `controls.css` + `is-touch-device.ts`. `canvas-host` creates +
> registers the source and renders the overlay only on touch devices (the desktop "Click to play" capture is
> hidden there). `PointerLookSource` now ignores `pointerType: 'touch'`, so dragging a joystick never also
> orbits the camera. **Pinch-zoom** is a `usePinchZoom` hook (two-finger `touchmove` → `addZoom`). Tests:
> `TouchInputSource` unit + a Playwright spec (`e2e/touch-controls.spec.ts`) that drives the real overlay on a
> dev-only harness page (`controls-harness.html` → `src/standalone/controls-harness.tsx`, exposing the source
> on `window.__touchSource`) — move/look/run/jump via the pointer, pinch via synthetic `TouchEvent`s. The
> **Enter button is contextual**: `EnterVehicleSystem.canEnterExit()` (seated, or idle with a car in range) is
> threaded to `<TouchControls>`, which polls it and shows Enter only when actionable.

> **Phase 1 implemented (2026-06-22).** `InputState` contract (`move()`/`isActive()`/`consumeLook()`/
> `consumeZoom()`), `CombinedInput` combiner, `KeyboardSource` (WASD/actions) and `PointerLookSource`
> (mouse look/zoom). `character-controller`, `enter-vehicle` and `CameraController` now read `InputState`;
> `Game` owns the combined input (`getInput()`/`addInputSource()`, pointer source created at camera setup),
> `setup-character` registers the keyboard source. Files are grouped by source:
> `input/{input-state,combine-input}.ts` + `input/keyboard/{keyboard,keyboard-source}.ts` +
> `input/pointer/pointer-look-source.ts` (`index.ts` barrel). Edge detection stays in `enter-vehicle` (no
> `wasPressed` API yet — added if a consumer needs it). Tests: combiner, keyboard-source, pointer-look-source,
>
> - the refactored system tests. **Phase 2 (mobile touch sources + `src/ui/controls/` overlay) is unstarted.**

## Context / problem

Input enters the game in **three** device-coupled places:

1. **Movement / actions** — systems call `keyboard.isDown(controls.<action>)`, where `ControlsConfig` maps an
   action to a `KeyboardEvent.code`. Axes are digital (`isDown(pos) - isDown(neg)`). The device **and** the
   key bindings are baked into game logic (`character-controller.system.ts`, `enter-vehicle.system.ts`).
2. **Look (camera)** — `CameraController` attaches its own `pointermove`/`wheel`/`keydown` listeners and reads
   `event.movementX/Y` for the follow-orbit (azimuth/polar) and fly (yaw/pitch) look, plus wheel zoom. Mouse is
   wired directly into the game core; there is no seam for a touch look.
3. **Debug / fly** — OrbitControls + arrow keys via their own listeners.

So "mouse look" is really **look deltas (azimuth/polar, yaw/pitch) + zoom delta**, and none of it is abstracted.
A touch device cannot produce key codes or `movementX/Y`, so mobile has no path in today.

## Goal

The game consumes **device-agnostic signals (intents)**; concrete **input sources** (keyboard, pointer, touch
overlay, later gamepad) feed them and are pluggable. The on-screen mobile controls + touch look live **outside**
the game core (in `src/ui/`), so the game stays DOM/React-agnostic — same boundary as the asset loaders.

## Design — the intent layer (`src/game/input/`)

Two signal shapes cover every current input:

- **Continuous**
  - `move: Vec2` in [-1,1]² (forward/back, strafe) — keyboard → ±1, joystick → analog; also drives vehicle
    throttle/steer.
  - `look: Vec2` — per-frame delta, **read-and-cleared each tick** (identical for mouse `movementX/Y` and a
    touch-drag delta); integrated by the camera.
  - `zoom: number` — per-frame delta (wheel or pinch).
- **Discrete actions** — `jump`, `run`, `enterExit`, `brake/handbrake` (extensible). Exposed as **held**
  (`isActive`) **and edge** (`wasPressed`, consumed-once): enter/respawn want the edge, forward/run want held.

Contract:

- `InputState` (read side, what the game consumes): `axis2('move')`, `consumeLook()`, `consumeZoom()`,
  `isActive(action)`, `wasPressed(action)`.
- `InputSource` (write side) + a small **combiner** that merges all active sources: OR booleans, clamp-sum
  axes, accumulate look/zoom deltas. Pure and unit-testable.
- `Action` — a semantic union (`Forward`/`Back`/`Left`/`Right`/`Jump`/`Run`/`EnterExit`/`Brake`/…) replacing
  stringly-typed key codes in game logic.

Mirrors the `AssetLoader`/`AssetSink` pattern (one contract, many implementations).

## Sources (the external adapters)

- **`KeyboardSource`** (headless, `src/game/input/`) — wraps the existing `Keyboard` + the `ControlsConfig`
  keymap → emits `move`/actions. The key-code bindings **move out of the game core into this source** (they are
  keyboard-specific; also the seam for future remapping).
- **`PointerLookSource`** (desktop, `src/game/input/`) — `pointermove` (optionally pointer-lock) + `wheel` →
  `look`/`zoom`. The mouse logic extracted out of `CameraController`.
- **Touch overlay** (`src/ui/controls/`, React/DOM over the canvas) — on-screen joystick → `move`, buttons →
  actions, a look-pad / drag region → `look`, pinch → `zoom`. Renders DOM, so it lives in the UI layer and only
  feeds the same intent (game core imports no React). **This is the mobile module.**
- (future) `GamepadSource`.

Multiple sources coexist (keyboard + touch both wired); the combiner handles overlap.

## Phase 1 — input layer + refactor (behaviour-preserving, no UI change)

| Area                                                  | Change                                                                                                                                                                                                                          | Risk    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `input/` contract + combiner                          | new `InputState`/`InputSource`/`Action` + merge logic (pure, tested)                                                                                                                                                            | low     |
| `KeyboardSource`                                      | wrap current `Keyboard` + `ControlsConfig` → intents; 1:1 behaviour                                                                                                                                                             | low     |
| `character-controller.system`, `enter-vehicle.system` | `isDown(controls.x)` → `axis2`/`isActive`/`wasPressed`; math is already scalar, so mechanical (bonus: analog steer/throttle). Tests' `hold('KeyW')` stub → `setMove`/`press` (simpler)                                          | low-med |
| `CameraController`                                    | drop its own `pointermove`/`wheel`/arrow listeners; consume `look`/`zoom` in `update(delta)`. Orbit + auto-follow + fly math **unchanged** — only the delta source changes. Debug OrbitControls may stay DOM-coupled (dev tool) | med     |
| Wiring (`canvas-host`)                                | build sources, register in the combiner, pass `InputState` to Game/systems/camera                                                                                                                                               | low     |

Outcome: keyboard + mouse play exactly as today, but the game reads intents. Fully under green tests.

## Phase 2 — mobile on-screen controls (additive, UI only)

Mounted only on touch devices. **Left thumb = movement, right thumb = look** (the requested layout); the
action buttons sit by the left controls. No game-core changes — a touch source feeds the Phase-1 combiner.

### Layout (mockup)

```
┌────────────────────────────────────────────────┐
│ ⏱ 12:00                                  LOS …  │  HUD (unchanged)
│                                                  │
│                                    [ ⇄ Enter ]   │  contextual: near a car / seated
│                                    [ ⭡ Jump  ]   │  Jump on foot · Handbrake in a car
│    ╭─────╮                          ╭─────╮      │
│    │  ◉  │  move                     │  ◉  │     │  look
│    ╰─────╯                          ╰─────╯      │
└────────────────────────────────────────────────┘
   translucent · ≥44px targets · safe-area insets on every edge
```

Left thumb drives the move joystick; the right thumb drives the look joystick and taps the action buttons
stacked just above it.

### Controls → signals

| Control                   | Signal                | Notes                                                             |
| ------------------------- | --------------------- | ----------------------------------------------------------------- |
| **Move joystick** (left)  | `move: Vec2` (analog) | full deflection (>~0.85) also sets `run` — no run button          |
| **Look joystick** (right) | `look` delta          | rate × elapsed (holding orbits the follow camera; dt-independent) |
| **Jump** button           | `jump`                | doubles as **handbrake** in a car (same action)                   |
| **Enter/Exit** button     | `enterExit`           | held ≥1 frame → the system's existing edge logic fires            |
| **Pinch** (two fingers)   | `zoom`                | optional — defer if it complicates the MVP                        |

### Source — `src/game/input/touch/touch-input-source.ts`

`TouchInputSource implements InputState` (headless, no React); the overlay drives it via setters:

- `setMove(x, y)` → `move()`; `isActive('run')` = `hypot(x, y) > RUN_THRESHOLD`.
- `setAction(action, held)` → `isActive(action)`.
- `setLookRate(x, y)` → `consumeLook()` integrates `rate × (now − lastConsume)` (smooth, frame-rate independent).
- `addZoom(delta)` → `consumeZoom()`.

Registered with `game.addInputSource(touch)`, so it merges with keyboard/pointer in `CombinedInput`.
Unit-tested in isolation (setters → signals, run threshold, look integrates + clears, zoom accumulates).

### Overlay — `src/ui/controls/` (React, DOM over the canvas)

- `touch-controls.tsx` — container; renders the two joysticks + buttons and forwards their `onChange` to the
  source setters. `pointer-events: none` on the container, `auto` on each control, so taps elsewhere fall
  through to the canvas. Safe-area padding.
- `joystick.tsx` — reusable on-screen stick: `pointerdown/move/up` with pointer capture → normalized offset
  (`onChange(x, y)`), recentres on release. Used for both move and look.
- `action-button.tsx` — press-and-hold button → `onChange(held)`.
- `controls.css` — layout/sizing/translucency (Tailwind classes per the styling rules).

### Platform detection + wiring

- `is-touch-device.ts` (ui) — `matchMedia('(pointer: coarse)')` + no-hover / `navigator.maxTouchPoints`.
- `canvas-host.tsx` — on a touch device: create the `TouchInputSource`, `game.addInputSource(it)`, and render
  `<TouchControls source={it} />` above the canvas. Desktop is unchanged (keyboard + pointer only). Both can
  coexist (a 2-in-1) — the combiner merges them.

### Phase-2 decisions

- **Look = rate joystick** (hold to orbit), dt-scaled — per the requested layout. (Alt considered: a drag-to-
  look region mapping 1:1 like the mouse; rejected in favour of the joystick.)
- **Auto-run** at full move deflection — no separate run button (fewer controls).
- **Enter/Exit is contextual** — shown only when actionable: `EnterVehicleSystem.canEnterExit()` (seated → can
  exit; idle with an upright car in range → can enter) is threaded through `canvas-host` to `<TouchControls>`,
  which polls it per frame (`usePolledFlag`) and renders the Enter button only when true.
- Action buttons sit **above the right (look) joystick** — the right thumb taps Jump/Enter between look
  gestures while the left thumb keeps moving. Position is CSS-only, easy to retune.

### Phase-2 files

- New: `src/game/input/touch/touch-input-source.ts` (+ test); `src/ui/controls/{touch-controls,joystick,
action-button}.tsx` + `controls.css` + the touch-detection helper.
- Changed: `canvas-host.tsx` (mount + register on touch). **No game-core changes.**

### Phase-2 out of scope (later)

Key/button remap UI; gamepad; contextual Enter visibility; pinch-zoom if deferred; haptics; orientation lock;
on-screen debug-camera controls.

## Scope

- **In:** the intent contract + combiner; keyboard & pointer sources; refactor of the two movement systems and
  the camera to read `InputState`; the touch overlay + touch look/zoom; platform detection for the overlay.
- **Out (later):** key/button remapping UI (the `Action→code` map makes it cheap); gamepad source; on-screen
  debug-camera controls (debug stays mouse/OrbitControls); haptics; aiming/shooting actions.

## Decisions to lock

- **Pull model** — systems read `InputState` each tick + edge flags cleared per tick (matches today's
  `isDown` polling and the fixed-step loop). Not an event bus.
- **Look/zoom as accumulated deltas** cleared on read — identical handling for mouse and touch drag.
- **`Action` enum in game logic**; `ControlsConfig` retained but owned by `KeyboardSource` as the `Action→code`
  map.
- Game core stays DOM/React-free; all DOM-bound sources (touch overlay) live in `src/ui/`.

## Testing

- Unit: combiner merge semantics; `KeyboardSource` (code→intent); systems over a fake `InputState`
  (replaces the current keyboard stubs — simpler); camera consuming synthetic look/zoom deltas.
- e2e: a touch-emulation spec for the overlay (joystick → movement, buttons → actions) on the Playwright lane.

## Risks / notes

- `CameraController` is the most intricate touch point, but the orbit/auto-follow maths is untouched — only the
  delta ingress moves. Keep its public API (`setMode`/`setTarget`/`focus`/…) stable.
- Keep Phase 1 strictly behaviour-preserving so the diff is reviewable and the existing system/camera tests stay
  meaningful; ship mobile (Phase 2) only after Phase 1 is green.
- Naming (per the input-module discussion): `input/` = contract + headless sources; `controls` = the keybinding
  map (now inside `KeyboardSource`) and the UI overlay name (`src/ui/controls/`); `*-controller` unchanged
  (entity drivers that consume `InputState`).
