# AGENTS — start here (current development after V1.1)

Local **GTA:SA stunt-flight recorder + WebGPU replay**. Full detail in **[`HANDOFF.md`](HANDOFF.md)**; this
file is the fast onboarding for a new AI session. Do not distribute game assets; OpenSA is AGPL-3.0.

## What it is
- **Recorder**: standalone ASI `recorder/src/FlightRecorderASI.cpp` — records Hydra(520)/Rustler(476) to v11 CSV at
  25 Hz, with Hydra nozzle, smoke, explosion events and a same-name game-process WAV captured by
  `GameAudioCapture.exe`, plus five measured surface-damage slots after runtime layout validation.
  v11 adds W/S/Left/Right and keyboard focus validity; all ten default keys are sampled at 25 Hz.
  Older v4–v10 CSVs still load (pre-v10 damage unknown, pre-v11 new keys unknown); camera debug capture remains disabled.
- **Replay**: OpenSA WebGPU engine in the browser, streaming a **locally baked map pak** (Route A). The
  raw-install live-welding path was removed (HANDOFF §8) — a pak is required.
- Everything runs on this machine. Baking reads the user's own install; replay reads the baked pak and CSV/WAV only.

## Run / build / test (this machine)
```powershell
# 1. Map pak (required; re-bake after any map mod or when upgrading to the FX-capable pak)
cd tools\opensa
npx tsx scripts\bake-map.mts map-pak          # whole map: ~40s, ~760MB (gitignored)

# 2. Serve + open (keep the window open)
..\..\start-replay.cmd                        # -> http://127.0.0.1:4173/ (auto-loads latest CSV)

# 3. After changing app code
cd tools\opensa
npx tsc --noEmit -p tsconfig.json             # MUST be 0 errors
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1   # publish to web-replay\dist\opensa

# 4. Recorder (when the .cpp or audio helper changed)
cd recorder
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Architecture
- App entry: `tools/opensa/apps/web/src/standalone/flight-replay.ts`
  + `apps/web/src/flight/`: `pak-world.ts` (stream the pak), `pak-resources.ts` (aircraft/data),
  `camera.ts`, `csv.ts`, `aircraft.ts`, `math.ts`, `fx.ts`, `free-camera.ts`, `replay-navigation.ts`,
  `cockpit-instrument-data.ts`, `cockpit-instrument-mesh.ts`, `cockpit-instruments.ts`,
  `replay-audio.ts`. `map-source.ts` and `asset-store.ts` serve the baker.
- Baker: `tools/opensa/scripts/bake-map.mts` → `map-pak/{index.json,cells,collision,textures,data,aircraft}`;
  `aircraft` contains only 520/476 plus their shared `vehicle.txd`; `fx` contains local effects. `replayAssets.version=2` is required;
  re-bake older pak files before replay.
- Server: `web-replay/local-server.mjs` (`/map-pak`, `/local-recording/latest.csv`, `/local-recording/audio`,
  `/video-export`, `/webgpu-report`);
  `/game-src` is indexed lazily for baking only. `RECORDINGS_ROOT` can point to CSV files outside the game folder.
- Self-tests (self-close their Chrome): `tools/opensa/scripts/{capture-replay,test-multitrack,test-scrub,soak-replay,test-hud,test-standalone-pak}.mjs`, `smoke-map.mts`.

## Hard rules (violating these caused real regressions)
1. `tsc --noEmit` must be 0; rebuild with `build-flight-replay.ps1`; verify with a `scripts/*` screenshot run.
2. Texture uploads MUST use `engine.textures.beginLoad()` + per-frame `drainUploads(budget)`. A single
   synchronous bulk `load()` of the arrays TDRs the Intel Arc (`DXGI_ERROR_DEVICE_HUNG` → black canvas).
3. Never replace a texture array while cells are resident; keep `MAX_PARALLEL_LOADS` small (2).
4. `.cmd`/`.ps1` that cmd/PowerShell run MUST be ASCII-only (cmd reads BOM-less UTF-8 as GBK → instant exit).
5. Only close browsers you started; use FRESH throwaway profiles; never `taskkill /F` a reused Chrome profile
   (it corrupts that profile's WebGPU state).
6. Diagnose root causes, don't widen radii or force-kill to hide symptoms. See HANDOFF §5 (13 documented
   root causes, all with the fix).

## Known environment issue
- Intel Arc driver occasionally resets (`DXGI_ERROR_DEVICE_HUNG`). The page auto-recovers (reload, once per
  minute). It is NOT a data bug.

## Next steps (see HANDOFF §10)
1. Graphics master switch (bloom/godrays/clouds off) to reduce driver resets.
2. Route B (optional): engine in-place texture append for true dynamic streaming.
3. Compatibility: SA-MP `SAMP.img/custom.img` override baking; Rustler(476) cockpit anchor.

Route pak baking and its HUD button are implemented; see HANDOFF §14. Route pak has a shorter 1200-unit
far horizon, and its size varies with the recording path.

Hydra cockpit instruments are implemented (HANDOFF §46): stock-model guarded geometry, dedicated
in-place RGBA atlas updates, green sight-glass heading, real v10 surface warning lamps. The floating
analysis HUD is deleted. `THROTTLE *` uses default W/S keys at 0/50/100% in v11 (unknown without focus);
older all-zero throttle tracks use a separately marked legacy control-input proxy.
`GAME km/h` is positional game velocity, not aerodynamic IAS. Rustler cockpit placement remains pending.
Gauge ranges (HANDOFF §48): speed 0–300 km/h with two capture-time damping stages (0.25 s each),
altitude 0–1000 m with a stock 800 m reference mark. Out-of-range numbers remain visible; needles do not wrap.
Display-only health/throttle transitions (HANDOFF §49) take 0.4/0.28 s, using capture time and cached
causal easing. Raw health/throttle and damage warnings remain immediate; unknown throttle clears at once.
Speed's filled green scale arc follows the same damped needle value for peripheral reading (HANDOFF §50).
Hydra's translucent stick now pivots with recorded elevator/aileron travel (HANDOFF §51), with per-axis
key fallback when nodes are missing. Motion is display-only, bounded to 18 degrees and deterministic
for pause/scrub/export; stock geometry guards still skip incompatible mods and Rustler.
Hydra also has procedural rudder pedals below the dashboard (HANDOFF §52): recorded native-Z rudder
twist drives opposite 7 cm fore/aft travel, with Q/E fallback only when the node is missing.
