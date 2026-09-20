# bench-harness

Headless field-check harness for the own-engine game: boots the REAL web app in headless Chromium
(WebGPU over ANGLE/Metal) through the **`http-dir` loader** (`?loader=http-dir&src=<served build>`) — the
shipping load path, no fake picker — so bench sweeps, soak runs and boot-gate checks run with no human at
the screen and no user screenshots.

**The full guide lives in [docs/development/benchmarks.md](../../docs/development/benchmarks.md)** —
scenes, report protocols, the recording ritual, DPR caveats. This README is just the file map:

- `drive.js` — boots the app via `?loader=http-dir&src=`, clicks the game, waits for `[bench]` (or
  `TAG='[soak]'`) report lines, screenshots on exit. `DPR=2` gives retina-equivalent render targets.
  **`UNCAPPED=1`** drops the presentation clock (`--disable-frame-rate-limit --disable-gpu-vsync`) so the
  frame-time columns stop sitting on the vsync period — the run prints `frameClock=uncapped|vsync`, and a
  capture must say which it was, because the two modes are not comparable.
- `gate-check.js` — WebGPU boot-gate verification: `canvas` mode reports which context type the game
  canvas holds (WebGPU is the only one since 074/13 deleted the three path); `sorry` mode launches WITHOUT
  WebGPU and expects the sorry screen.
- `warnings.js` — the WARNING CATCHER (bug-round tool, 2026-08-05): same boot as `drive.js`, then lives in
  the world for `<durationMs>` collecting every console warning/error, pageerror and WebGPU validation
  message — deduped with counts — into `<out>.json` (+ HUD text + screenshot). `TAGS` also records info
  lines (`[spawncar]`, `[cleo]`, `[stream]`, `[osmspike]` by default); `KEYS='Wait:5000;KeyW:4000;Enter:700'`
  holds keys in sequence (`Wait` = idle — let a `?spawncar` retry land first); `FAIL_ON=error` turns it
  into a CI gate. Point it at a reported spot with `?spawn=x,y,z&spawncar=…` and read the JSON instead of
  a human reading DevTools.

The served build is `serve-static`'s `/build` mount (`npm run serve:static`, port 3001) — it exposes the
`/__index` listing + Range files the http-dir loader reads. (Plan 079 phase 3 retired the bespoke
`game-server.js` + the fake `showDirectoryPicker`.)

Deliberately plain dependency-free Node scripts (playwright resolves from the repo root via
`NODE_PATH`) — not a workspace, no lint/test registration: they drive a browser, they don't ship.

Plans for the harness itself live in [`docs/plans/`](./docs/plans/) beside it — `001` the settle that lied and
the fall that poisoned the sweep (moved here from the engine plans on 2026-08-17).
