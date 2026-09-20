# Engine lab (`apps/engine-lab`)

The own-renderer proving ground (plan [074/04](../plans/074-opensa-engine/04-engine-lab-p0.md)) — NOT a
game: no React shell, no gameplay, no physics. A synthetic or converted-district fixture running through
the REAL engine path (formats → upload → bundles → culling → MSAA4+A2C → post), with an orbit camera, a
scripted bench harness and the gate HUD. **It stays after the migration** — the fastest way to look at
one district/vehicle/effect in isolation.

## Run

```bash
npm run dev -w @opensa/engine-lab    # vite, fixed port 4300
# open http://localhost:4300/
```

No build target on purpose — it is a dev-server lab, not a shipped app. (Sources:
`apps/engine-lab/src/` — `main.ts` entry + params, `bench.ts`, `debug-panel.ts`, `environment.ts`,
`ped.ts`, `vehicle.ts`, `vfs.ts`, `synthetic.ts`.)

## Data modes

Since plan 079 phase 2 the lab reads the ONE canonical build the game reads — a served perfect-map-builder
output — through `?src`. Serve it with `npm run serve:static` (mounts `/build` with Range) and point `?src`
at the game dir: `?src=http://localhost:3001/build/original/opensa`. There is no lab-only fixture format; the
ped/vehicle probes decode the SAME `.osm`/`.ostex` bytes the game does (`readPedOsm` / `readModelOsm`).

| Mode                | URL                                                     | What it does                                                                                                                                    |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic (default) | no params                                               | In-memory box-field district through the real `.oscell`/`.ostex` encoders — no files needed; the cutout layer is the A2C sanity check.          |
| Streaming           | `?pak=1&src=http://localhost:3001/build/original/opensa` | The REAL pak worker + LOD rings (hysteresis, atomic swap, eviction). WASD pans the focus — the rings follow. `?src=` names the served game dir. |

The ped/vehicle probes (`?ped`/`?vehicle`, below) read their converted models from the same `?src` build.

## Query parameters

### Scene / data

| Param                 | Default   | Effect                                                                                                     |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `pak=1`               | synthetic | stream the converted district (worker pak + LOD rings) instead of the synthetic one                        |
| `src=<url>`           | `pak`     | the served game dir (an opensa-pack `--out`); the world, the probes and the `report.json` all read from it |
| `cells=N` / `boxes=N` | 8 / 12    | synthetic grid size                                                                                        |
| `test=leak`           | off       | streaming leak assertion: sweep → unloadAll → ledger vs baseline, PASS/FAIL HUD (exclusive with `?bench=`) |

### Camera (all live-adjustable afterward)

| Param             | Default      | Effect                                                                                     |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `at=x,y,z`        | Los Santos   | orbit focus at a GTA coordinate (`?pak=1` defaults to Grove St., not the empty map centre) |
| `orbit=N`         | scene radius | starting camera distance                                                                   |
| `az=deg` / `el=N` | 0 / 0.9      | pinned starting azimuth / height factor                                                    |
| `freeze=1`        | off          | stop the auto-spin (auto-off when a vehicle is present)                                    |

### Time / weather

| Param           | Default | Effect                                                             |
| --------------- | ------- | ------------------------------------------------------------------ |
| `hour=0..24`    | 12      | environment hour                                                   |
| `daycycle=1`    | off     | animate the hour                                                   |
| `weather=0..19` | 0       | weather id (streaming/timecyc); `[` / `]` cycle live               |
| `fogscale=N`    | 2.5     | timecyc fog-mood scale (high lab camera compensation; game runs 1) |

### Effect A/Bs

| Param          | Effect                                               |
| -------------- | ---------------------------------------------------- |
| `ao=N`         | baked AO strength (074/07)                           |
| `sunvis=N`     | baked sun-shadow strength                            |
| `stoch=N`      | stochastic de-tiling (UNSTABLE v1, default off)      |
| `wind=N`       | vegetation sway multiplier                           |
| `scale=N`      | render scale (the tier knob)                         |
| `sky=preetham` | legacy dome vs Hosek-Wilkie default                  |
| `clouds=N`     | cloud layer opacity; 0 = naked dome                  |
| `aces=0`       | raw output (no ACES)                                 |
| `bloom=0\|N`   | bloom off / intensity override                       |
| `draw=N`       | LOD ring radius (≥400); fog capped at N−100 (074/21) |
| `probe=1\|0`   | env probe (default ON with a vehicle, OFF without)   |
| `probeview=1`  | probe cube debug view                                |

### Probes / look bench

| Param               | Effect                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `ped=1` (+`pedy=N`) | animated skinning-probe ped at the focus (idle/walk alternate); reads `<pedmodel>.osm` from `?src` |
| `pedmodel=<name>`   | ped model name (default `male01`) — any converted ped in the served build                          |
| `vehicle=N`         | N vehicle instances (N>1 = multi-instance pool, convoy paints); reads `<vmodel>.osm` from `?src`   |
| `vmodel=<name>`     | vehicle model name (default `landstal`) — any converted vehicle in the served build                |
| `drive=1`           | convoy circle drive + wheel spin + night head/taillights (default = parked look bench)             |

### Bench

`?bench=<scene>` — deterministic scripted camera, warmup 120 + measured frames, then a frozen summary
HUD + auto-downloaded `bench-<scene>-<date>.json` (frameMs avg/max/p50/p95, submit, gpuPass, draws,
residency, heap, env, converter metrics from `<src>/report.json`). Scenes: `orbit` · `close` · `drive` ·
`city` (pairs with `pak-ls`, 3600 frames) · `map` (whole-map tour, `pak-map`, 9000) · `teleport` ·
`whip`. Records are committed per the [benchmarks ritual](benchmarks.md); compare with
`bench-compare.ts` (>10 % gate). Bench/leak modes suppress the debug panel.

The GAME-side sweeps (`?bench=all` 6 prod scenes, `?soak=`) live in the web app, not the lab — see
[benchmarks.md](benchmarks.md).

## Controls

- **Wheel** — zoom (floor lets you zoom into a car); **left-drag** — orbit; **WASD** — pan the FOCUS
  (streaming rings follow; speed scales with zoom).
- **`[` / `]`** — cycle weather (streaming).
- **Debug panel** (top-right, auto-hidden in bench/leak): time readout, hour presets
  00/06/12/18/21, 24 h slider, `env probe` + `probe view` checkboxes — all live, no reload.

## Headless

The same harness that drives the game drives the lab (`tools-debug/bench-harness/` — playwright WebGPU
flags; no folder-picker fake needed here, the lab fetches its paks over HTTP). Point `drive.js` at
`http://localhost:4300/?...` for screenshots; the lab bench downloads its JSON itself.
