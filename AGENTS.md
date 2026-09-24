# AGENTS — start here (project v1.0)

Local **GTA:SA stunt-flight recorder + WebGPU replay**. Full detail in **[`HANDOFF.md`](HANDOFF.md)**; this
file is the fast onboarding for a new AI session. Do not distribute game assets; OpenSA is AGPL-3.0.

## What it is
- **Recorder**: standalone ASI `recorder/src/FlightRecorderASI.cpp` — records Hydra(520)/Rustler(476) to CSV at
  25 Hz (v6 columns: full pose basis, real control-surface node quaternions, game clock/weather).
- **Replay**: OpenSA WebGPU engine in the browser, streaming a **locally baked map pak** (Route A). The
  raw-install live-welding path was removed (HANDOFF §8) — a pak is required.
- Everything runs on this machine; the browser reads the user's own install only.

## Run / build / test (this machine)
```powershell
# 1. Map pak (required; re-bake after any map mod)
cd tools\opensa
npx tsx scripts\bake-map.mts map-pak          # whole map: ~40s, ~760MB (gitignored)

# 2. Serve + open (keep the window open)
..\..\start-replay.cmd                        # -> http://127.0.0.1:4173/ (auto-loads latest CSV)

# 3. After changing app code
cd tools\opensa
npx tsc --noEmit -p tsconfig.json             # MUST be 0 errors
powershell -ExecutionPolicy Bypass -File .\build-flight-replay.ps1   # publish to web-replay\dist\opensa

# 4. Recorder (only if the .cpp changed)
cd recorder
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Architecture (v1.0)
- App entry: `tools/opensa/apps/web/src/standalone/flight-replay.ts`
  + `apps/web/src/flight/`: `pak-world.ts` (stream the pak), `camera.ts`, `csv.ts`, `aircraft.ts`, `math.ts`,
  `map-source.ts`, `asset-store.ts` (data files + aircraft only).
- Baker: `tools/opensa/scripts/bake-map.mts` → `map-pak/{index.json, cells/*.bin, textures/*.ostex}`.
- Server: `web-replay/local-server.mjs` (`/map-pak`, `/game-src`, `/local-recording/latest.csv`, `/webgpu-report`).
- Self-tests (self-close their Chrome): `tools/opensa/scripts/{capture-replay,test-multitrack,test-scrub,soak-replay,test-hud}.mjs`, `smoke-map.mts`.

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
  minute) and offers `省电模式`/`重启渲染`. It is NOT a data bug.

## Next steps (see HANDOFF §10)
1. Bake only the recording route's cells → small pak + HUD "bake" button.
2. Bake `timecyc/water/carcols` + aircraft into the pak to drop the raw install entirely.
3. Graphics master switch (bloom/godrays/clouds off) to reduce driver resets.
4. Route B (optional): engine in-place texture append for true dynamic streaming.
5. Compatibility: SA-MP `SAMP.img/custom.img` override baking; Rustler(476) cockpit anchor.
