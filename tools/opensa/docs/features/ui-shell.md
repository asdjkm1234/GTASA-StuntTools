# UI shell (boot, menu, loading, pause)

`apps/web/src/ui/shell/` — the app entry (plans 051 / 056). A lightweight React shell that paints instantly (no
renderer, no WebGPU device), shows a **menu of the games in `GAME_CONFIG`**, runs the picked game's disclaimer + load behind a
branded loading screen, then lazy-loads and reveals the game. Theme: black bg, white text, orange-gradient
accent (from `logo.svg`).

## Implemented

- **Boot state machine** (`boot-machine.ts`, pure): `menu → (disclaimer | folder) → loading → warmup →
playing`, plus `paused` and `error`. State carries the selected `game`; `SELECT` routes a **fetch** game to
  `disclaimer` — **always, every launch** — and a **local** game to the `folder` prompt, which carries the
  same notice. Retry up to `MAX_RETRIES` (3), then back to the menu. Nothing downloads until a game is
  picked (no eager pre-menu load).
- **Hook** (`use-asset-boot.ts`): a fresh `Vfs` + `AssetLoader` **per selected game** (via `createAssetLoader`
  with the game's `assetLoader`); manifest at `${VITE_STATIC_URL}/<game>-${__APP_VERSION__}/manifest.json`.
  On the `loading` phase it `init()`s then loads **all groups** in one screen → verify → warmup. Local
  `restore()`s the remembered folder and only reads after the folder gesture (`chooseFolder → prepare()`).
  Runs once per attempt (retry/StrictMode-safe); reports progress + rotating status. **Nothing about the
  disclaimer is remembered** (2026-08-03): it is a legal notice, not an onboarding step to get past once, so
  the `opensa.disclaimer.v2.<game>` localStorage flag and its module are gone. `restore()` still re-grants the
  folder handle so the pick need not re-prompt — it no longer skips the folder screen, because that screen is
  where the notice lives.
- **Instant shell, lazy game:** the initial bundle is React + shell + asset-loader + vfs + fflate
  (~85 kB gz); `app.tsx` does `lazy(() => import('../engine-canvas-host'))`, so the engine + Rapier
  (~980 kB gz across the `engine-canvas-host` and `engine-environment-driver` chunks) load only past
  the menu.
- **Logo** (`logo.tsx` inlines the SVG; `shell.css`): a centered pulse while loading, the small subtitled mark
  on the menu.
- **Components:** `menu` (one button per `GAME_CONFIG` game by `label`, disabled with `disabledNote`; +
  Code/Blog/Videos links), `preloader` (bar + rotating status), `disclaimer` (the game's notice + OK, fetch
  path), `error-panel` (Retry), `folder-prompt` (local loader: the game's disclaimer + the bring-your-own-files
  notice + "Choose game folder").
- **Game integration** (`engine-canvas-host.tsx`): `world-ready` — a system watches `Velocity.grounded[player]` and
  reveals the game only once the player has landed (12 s fallback); `paused` → `game.setGameState('pause')`
  (Esc pause menu with Continue). `Vfs.addChunk` is idempotent by chunk file (retry-safe).
- **WebGPU gate** (`webgpu-gate.ts`): probed once on mount; anything but `ok` replaces the whole shell with
  the sorry screen. It asks **one** question — is there an adapter — and deliberately not a second. It used to
  also demand `texture-compression-bc`, which conflated the device with the content and told every phone that
  its browser does not support WebGPU (it does; the WORLD was BC). Whether a given world is displayable is
  read from that world's manifest at stream setup (`requireWorldSupport`), where the answer is true and
  specific. The probe reports **`no-api` vs `no-adapter`** (200/4-05) and `webGpuGateMessage` says which:
  the phone case is `no-adapter` — WebGPU is present and the driver blocklist refuses the adapter — where
  "this browser does not support WebGPU" is simply false. A thrown request counts as `no-adapter`.
- **Preloader note** (`boot-status.ts` `cacheNote`): a standing line under the rotating status for what this
  load will NOT do. Today: the download is not being kept, because Cache Storage is unavailable (200/4-06).
  Only for the `fetch` loader — a picked folder is read where it is.
- **Analytics** (`analytics.ts`): gtag, `VITE_GA_ID`-gated — a no-op when unset (dev). See `.env.example`.
- **Debugger** re-skinned to the same theme (`debug-styles.ts`).

## Known gaps / candidates

- Placeholder external URLs (Code/Blog/Videos) in `menu.tsx`; prod GA id.
- No settings/key-rebinding/save-slot/localization UI yet.
- Textures load is "all at once" — per-zone lazy streaming is a future chunking phase.

## Test coverage anchors

- Unit: `boot-machine.test.ts`, `boot-status.test.ts`, `webgpu-gate.test.ts`.
- e2e: `e2e/shell.spec.ts` (menu lists games; fetch game → disclaimer → loading; manifest-failure →
  error/retry; local game → folder prompt). The presentational components + GL boot are covered here / in the
  object-viewer lane (no RTL infra in repo).
