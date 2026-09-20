# fetch-pack — one build for local play AND hosted fetch

**State (2026-07-23): tool SHIPPED (phase 2) and the fetch CLIENT boots the pak (phase 3): the VFS
reassembles `<name>#index` slices, `AssetFetchLoader.openWorld` serves `opensa/*` from the delivered
chunks — the dead `public/pak-map` fallback is unreachable in fetch mode. E2E smoke owed with the
first small TC build (phase 4).**

`tools/fetch-pack` packs a pmb build's self-contained `opensa/` game dir into content-hashed zip
chunks + a download `manifest.json` under `build/<id>/opensa-pack/<game>-<version>/` (086 phase 8 —
the second, independent build; deploy = upload that folder to the host as `games/<game>-<version>/`,
`--out ./static/games` stages a local fetch test). Same layout the `asset-fetch-loader` already
downloads/caches. Identity (`game`, `appVersion`) rides the pak manifest (086 phase 1).
chained into every `npm run build:game:<id>:opensa` alias (standalone: `npx tsx tools/fetch-pack/src/cli.ts`).

Replaced: `scripts/build-game.ts` (raw-game partitioning) — deleted; `original-extend` npm target —
deleted. Details: `tools/fetch-pack/docs/plans/001-architecture.md`.
