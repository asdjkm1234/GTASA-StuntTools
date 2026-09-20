# Mobile on-screen controls

**State: shipped (plan [055](../plans/055-input-sources-mobile-controls/readme.md)), lost in the engine
migration, restored + field-checked 2026-08-03.** On a touch device the game mounts an overlay — a move
joystick (left), a look joystick (right), Jump above it, Enter when a car is in reach — and the desktop
"Click to play" pointer-lock prompt is hidden, because there is no pointer to capture.

**What "mobile support" is and is not.** It is the controls: everything else about the game is unchanged, and
nothing is scaled down for a phone. There is no touch UI for the pause menu, the debugger or the map viewer,
and a device with no WebGPU still gets the shell's sorry screen.

## How a press reaches the game

The overlay is DOM; it drives a headless `TouchInputSource`, and that source reaches the game through **two**
separate wires — the second one is easy to miss and its absence is silent (`docs/restrictions/architecture.md`):

| Signal | Wire | Consumer |
| --- | --- | --- |
| `move()`, `isActive()` | `CombinedInput` (`input.add(source)`) | the character controller, enter/exit, the gait selector |
| `consumeLook()`, `consumeZoom()` | the host's `foldTouchCamera` → `pendingInput` | the camera director |

The camera is host-owned in the engine host (the director steps over `pendingInput`, filled by the host's own
DOM handlers), so a source that is only in the combiner walks and jumps but never looks. The pinch has a
second trap on that wire: the director counts WHOLE notches, so the fold carries the leftover travel across
frames instead of truncating it away every frame.

Gait comes from the stick's deflection, not from a button: full deflection is `run`, partial is `walk` — the
analog gait a keyboard can only reach through a modifier. The **Enter button is contextual**: the overlay
polls `EngineVehicles.canEnterExit()` and shows it only while it would do something.

## Key files

| Concern | File |
| --- | --- |
| The headless source (setters + `InputState`) | `packages/game/src/input/touch/touch-input-source.ts` |
| Overlay, joystick, action button, pinch | `apps/web/src/ui/controls/` |
| Touch-device detection (`pointer: coarse` / `maxTouchPoints`) | `apps/web/src/ui/controls/is-touch-device.ts` |
| Both wires + the mount | `apps/web/src/ui/engine-canvas-host.tsx` (`setupTouchControls`, and the fold in the loop) |
| Look/pinch → the host's camera input | `apps/web/src/ui/controls/touch-camera.ts` (`foldTouchCamera`) |
| Enter-button gate | `apps/web/src/ui/engine-vehicles.ts` → `EnterVehicleSystem.canEnterExit()` |

## Tests

- Unit: `touch-input-source.test.ts` (deflection → gait, actions, zoom accumulation) and
  `touch-camera.test.ts` (the camera fold, including the pinch remainder that has to survive a frame).
- E2E: `e2e/touch-controls.spec.ts` drives the real overlay on `/controls-harness.html` — **no game behind
  it**, so it stays green when the overlay is not mounted in the product. It was green through 0.4.0, which
  shipped with no mobile controls at all.
- Field: `npx tsx scripts/debug/touch-controls-check.ts` boots the real game with `hasTouch` and drives the
  overlay's own pixels (walk / turn / jump, read off the dev HUD). This is the only check that covers the
  wiring; see `docs/debug/README.md` for the invocation.

## Field check, 2026-08-03 (the restore)

Emulated landscape phone (932×430, DPR 2, `hasTouch`), Santa Maria beach spawn, `npm run dev` against
`build/original/opensa`:

| Control | Measured |
| --- | --- |
| Move stick, 1.2 s full deflection | 8.0–8.1 m walked, four runs |
| Look stick, 1.2 s full deflection | the next walk left 19–26° off the previous heading |
| Jump button, held | +1.00 m of lift |
| `.sa-capture` ("Click to play") | absent, as it must be with no pointer to capture |

**Both failure modes were reproduced deliberately** before the run was believed. Cutting the combiner wire
(`input.add`): 0.0 m walked, 0° turned, 0.00 m of lift. Cutting the camera fold: the walk and the jump stayed
healthy (8.0 m, +1.00 m) and the turn went to **0°** — the "walks but never looks" shape, exactly as the
restriction describes it.

The turn understates the camera's real rate (0.004 rad/px × 10 px/frame is ~140°/s): it is read after the
stick is released, and auto-centering swings the camera back the moment the player walks. It is a
connected/not-connected signal, not a sensitivity measurement.

## Known gaps

- The look joystick is the only camera control — no touch equivalent of look-behind, the photo camera or F2.
- Nothing is tuned per device: the joystick geometry is fixed px (with safe-area insets), and the look gain is
  one constant for every screen size and refresh rate.
- Field-checked headless (an emulated 932×430 phone at DPR 2), **not on real hardware** — no touch-device
  frame-time row exists in `docs/benchmarks/`.
