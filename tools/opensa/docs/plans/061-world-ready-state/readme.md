# 061 — World-ready state (boot reveal + teleport freeze on streaming)

**Status: ✅ shipped 2026-07-05 (awaiting an in-game drive).** Coverage: settle-watcher unit tests
(timeout by frame deltas, one-shot, settles on first true frame), StreamingSystem `settled()/progress()`
(not-settled before first update / while in flight; teleport → unsettled → settles again),
CollisionStreamingSystem `settled()`. Known nuance (documented on `settled()`): while MOVING, an in-flight
lookahead cell can be adopted into the view ring by the hysteresis margin and briefly unsettle it — the
freeze use case has zero velocity, so it never affects boot/teleport.

**The problem:** after plan 060 the cell build/warm pipeline is fully asynchronous — at boot the
shell reveals the game while cells are still warming (player sees an unloaded world), and a debug teleport
drops the player into emptiness until streaming catches up. Introduce a real readiness signal and a
"time freeze" state driven by it — vanilla SA's own behaviour (black loading veil on far teleports).

## Existing pieces this builds on

- `StreamingSystem` already knows everything: `desiredKeys` vs `loaded`/`loading`/`ingesting`, where
  `loaded` now means _built + GPU-warmed + atomically added_ (plan 060) — the semantically right signal.
- `CollisionStreamingSystem` mirrors the same sets for physics colliders.
- `GameState` (`'pause' | 'play'`) already freezes exactly the right things when `!== 'play'`: the game
  clock (game.ts loop), `CharacterControllerSystem`, `CharacterAnimationSystem`, `PhysicsSystem`. Streaming
  systems are NOT gated — they keep running. So a new state freezes gameplay for free while the world loads.
- canvas-host already has a `world-ready` one-shot system (player grounded → `onWorldReady` → shell boot
  machine `WORLD_READY`), with a timeout fallback — but it only waits for COLLISION (grounding), not visuals.
- The debug teleport is `actions.teleport(coords) → character.placePlayer(coords, true)` — instant, no wait.

## Phases

- **Phase 1 — settled signals.** `StreamingSystem.settled()`: every key of the CURRENT VIEW ring (explicitly
  NOT the velocity-lookahead prefetch keys — waiting on prefetch would flap readiness while moving) is in
  `loaded`, none pending in `loading`/`ingesting`. Plus `progress()` (`{loaded, total}` over view keys) for
  a loading veil. `CollisionStreamingSystem.settled()` — same over its desired set. Both are cheap
  set-membership checks (no allocation beyond the per-update view-key set we already build).
- **Phase 2 — `'streaming'` game state + orchestration.** Add `'streaming'` to `GameState` — the existing
  `!== 'play'` gates freeze clock/physics/controller/animation with zero extra wiring; render loop and
  streaming keep running (the warm-up NEEDS frames). `Game` gets the collision system ref (next to the
  existing `setStreamingSystem`), `worldSettled()` (visual && collision), and
  `withStreamingFreeze(move)`: enter `'streaming'` → run `move()` (reposition) → resolve when
  `worldSettled()` holds (or a `timeoutMs` guard fires — a failed cell build must not deadlock the game;
  warn and proceed) → restore `'play'`. The poller is a plain one-shot `System`
  (`streaming/settle-watcher.ts`) so the state machine is unit-testable headless (game.ts is on the e2e
  lane).
- **Phase 3 — host wiring.** Boot: the `world-ready` system now requires `game.worldSettled()` AND grounded
  (timeout stays) — the shell reveal waits for the world to actually be on screen. Teleport:
  `actions.teleport` goes through `game.withStreamingFreeze(() => character.placePlayer(coords, true))`.
  Veil: canvas-host listens to `game-state` — `'streaming'` shows a dedicated **`StreamingVeil`**: opaque
  BLACK cover (the plain `LoadOverlay` is transparent — its backdrop comes from the shell, so a teleport
  would show the world assembling) with the `Loading world… N/M` caption bottom-centre
  (`game.streamingProgress()`, polled 250 ms). z-order: veil (20) covers the HUD (10) like SA's loading
  screen; the debug overlay (1000) stays usable above it.
- **Phase 4 — no fade behind the veil.** While `gameState === 'streaming'`, `finishSwap` adds new cells at
  full opacity (skip the fader): everything appears atomically behind the veil, so the reveal shows the
  finished world instead of a mass fade-in.

## Notes / guards

- Physics is frozen during `'streaming'`, so "grounded" can NOT be part of the settle condition (the player
  can't land while frozen) — grounding is checked AFTER restoring `'play'`, as the boot path already does.
- Timeout default ~15 s: a build error in one cell degrades to "reveal anyway + warning", never a black
  screen forever.
- Readiness ignores manual/map-viewer mode (debug cells) — settled() is only meaningful while streaming
  normally; the map viewer never freezes.
- The canvas-host pause effect never clobbers `'streaming'`, and `withStreamingFreeze` restores `'play'`
  only if the state is still `'streaming'` — a pause menu opened mid-freeze stays paused.
- Boot grounding wait: `GROUNDING_TIMEOUT_MS` (3 s) after the settle; the settle itself is bounded by
  `WORLD_READY_TIMEOUT_MS` (12 s).
