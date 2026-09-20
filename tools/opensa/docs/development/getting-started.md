# Getting started

How to go from a clean checkout + your own copy of GTA: San Andreas to a running build.

The project ships **no game assets**. You supply them once from a legitimate GTA SA install; a build
step repacks them into compact archives under `static/`, and the app loads the game from there.

## 1. Prerequisites

- Node.js (see `.nvmrc` / `package.json` `engines` if present) and `npm`.
- A legitimate **GTA: San Andreas v1.0** install to copy assets from.

Install dependencies:

```sh
npm install
```

## 2. Provide the game assets — `game-src/original/`

Create `game-src/original/` and copy the relevant folders from your San Andreas install into it,
preserving the layout:

```
game-src/original/
  data/        # gta.dat, *.dat, *.ide (incl. peds.ide, vehicles.ide), data/maps/**, timecyc.dat, …
  models/      # gta3.img, gta_int.img, effects.fxp, effectsPC.txd, particle.txd, generic/
  anim/        # ped.ifp and friends
```

`original` is the base build for the current game version — **treat it as read-only** once populated
(it is the ground-truth source the build reads from). Notes:

- `models/gta3.img` is the primary archive; `models/gta_int.img` is overlaid as a fallback for the
  few interior props `gta3.img` lacks (the same override the build and dev scripts use).
- There is **no `player/` or `vehicles/` folder** — the full ped/car roster comes from `data/peds.ide` /
  `data/vehicles.ide`, with the model/txd bytes read straight from the `.img` archives (per-asset overrides
  are installed into the build by `mod-installer` / `vehicle-installer`, never at runtime).
- The build reads model/texture bytes **straight from the `.img` archives** — you do not extract them.
- Optional `data/timecyc_24h.dat` is used as-is when present; otherwise the vanilla `data/timecyc.dat`
  is converted to 24h at runtime.

To build a non-default variant (e.g. a TC), drop it in `game-src/<name>/` with the same layout and use
the matching alias (see below) or call the pmb CLI with `--game/--in/--out` directly.

## 3. Build the archives

```sh
npm run build:game:original:opensa       # pmb + fetch-pack → ./build/original (opensa/ + opensa-pack/)
npm run build:game:original:sa           # the real-game target instead → ./build/original/sa
# other games (opensa only): npm run build:game:gostown|carcer|anderius:opensa
```

A full `original` run is ~50 min (`opensa` — the pack alone ~35) and ~12 min for `sa`. Two things keep that
from being paid twice:

- **a run that dies is resumed, not restarted** — `npx tsx tools/perfect-map-builder/src/cli.ts <same flags>
  --resume` re-enters at the last finished step (a dead pack at its last finished weld chunk), reading
  `<out>/.work-<target>/resume.json`; it refuses, naming the difference, if the sources, the flags or the code
  changed since that run (pmb plan 006);
- **one changed model does not need a rebuild** — `scripts/debug/model-lab.ts` for the `sa` tree,
  `scripts/debug/model-repack.ts` for the OpenSA one (a servable lab pak with the model's HD AND its cell LOD
  regenerated, `?src=/build/<game>/opensa-lab`); rows in [`docs/debug/README.md`](../debug/README.md).

One command, TWO independent builds (plan 086 phase 8): `opensa/` — the SELF-CONTAINED game dir
(engine pak inside at `pak/`; open it in folder mode or serve it for http-dir), and `opensa-pack/` —
the FETCH build (`tools/fetch-pack` packs the game dir into `<game>-<version>/` chunks; deploy = upload
that folder as `games/<game>-<version>/`). Each group is split into **~50MB content-hashed chunks**
(`<group>-<hash>.zip`) so a dropped download re-fetches one chunk, not the whole group; the download
`manifest.json` lists them:

- `data` — loose root files + the `data/` and `text/` folders (ide/ipl/dat/cfg/zon/gxt).
- `models` — the `models/` IMGs (converted `.osm` inside) + the game dir's `pak/` (`world.ospak`, sliced).
- `textures` — EMPTY for a pak build (pak textures live inside `world.ospak`); kept for the manifest shape.
- `others` — everything else (anim/ifp and friends).

Chunk assignment is a stable hash bucket, so changing one file leaves the other chunks byte-identical
(same hash/filename → the browser cache survives a version bump) — unless a group's total crosses a
50 MB multiple, which changes the bucket count and reshuffles that group's chunks. See
[fetch-pack.md](../features/fetch-pack.md) for the full breakdown.

Each chunk also carries a `cached` flag from the build's `CACHED` map (`tools/fetch-pack`). `models`,
`textures`, and `others` are cached in the browser (Cache Storage); `data` is `cached: false` — always
re-downloaded and never stored. That makes `data` a **build-liveness probe**: delete its zip on the server
(to revoke a build) and clients 404 on it, which wipes their whole asset cache. Deleting the whole build
(so `manifest.json` 404s) wipes the cache the same way. See [asset-loader.md](../features/asset-loader.md).

## 4. Run

```sh
npm run serve:static            # serves ./static (viewer fixtures + built game archives) at :3001 (VITE_STATIC_URL)
npm run dev                     # Vite dev server for the app
```

The app reads `VITE_STATIC_URL` (default `http://localhost:3001`, see `.env`). The UI shell (plans 051 / 056,
`apps/web/src/ui/shell/`) shows a **menu of the games in `GAME_CONFIG`** (`apps/web/src/game-config.tsx`); picking one runs its
disclaimer → the **asset loader** (plan 049) loads `static/<game>-<version>/` into the **VFS** (plan 050,
unzip + verify) → the lazily-loaded game runs entirely from the VFS.

> **Per-game config (`apps/web/src/game-config.tsx`):** each game sets its `assetLoader` (`fetch` = download chunks;
> `local` = read a user-picked **raw GTA install**, Chromium only), `mainCharacter`, `vehicles`, `playerSpawn`,
> teleports, and a `disclaimer`. `original` is `local` (bring-your-own-files → "Choose game folder", remembered
> in IndexedDB); `gostown` is `fetch`. See [asset loaders](../features/asset-loader.md).

> **Note:** the boot fetches `static/<game>-${__APP_VERSION__}/manifest.json` for the picked game (version from
> `package.json`, wired in `apps/web/src/ui/shell/use-asset-boot.ts`).

> **Testing on a phone (LAN):** Cache Storage needs a **secure context** (https / localhost). Over plain
> `http://<your-ip>:port` `caches` is undefined, so the loader skips caching and **re-downloads every visit**
> (it no longer crashes — see [asset loaders](../features/asset-loader.md)). For on-device caching, serve over
> https (Vite `server.https`) or a tunnel (ngrok / cloudflared).

## 5. Test fixtures (to run the test suite)

The real-asset test fixtures under `fixtures/original/` are Rockstar assets, so they are **not committed**
(gitignored) — regenerate them locally from an **unmodified** GTA SA copy placed at `game-src/original/`:

```bash
npm run test:fixtures   # extracts/copies the needed files from game-src/original into fixtures/original/
npm test                # now the unit tests have their fixtures
```

Custom (non-Rockstar) fixtures — `fixtures/custom/` — are a MIRROR of `fixtures-src/`, a folder that is
**local and uncommitted** (nothing under `tests/` is in git since 2026-08-17): the same run copies it in,
wiping the mirror first. `fixtures-src/` holds the curated, version-pinned and golden-snapshot files that
exist nowhere else on disk — keep your own backup of it; a tree without it runs the suite with those tests
skipped (`skipIf(!existsSync)`), and `test:fixtures` says so. Re-run `npm run test:fixtures` whenever you
add a fixture to the manifest or drop a file into `fixtures-src/`.

## 6. Standalone viewers

The standalone model viewers (`/viewer.html` — object/vehicle/character tabs via `?tab=`) load models by
name from the **compare server** (`--after` side). Run it alongside `npm run dev`:

```bash
npx tsx tools/map-optimizer/src/compare-serve.ts --before <gameDir> --after <gameDir>
```

The object-viewer e2e instead renders static fixtures from `fixtures/viewer/` (gitignored like `fixtures/original/`),
extracted from `game-src/original/` by `npm run test:fixtures`.

## Where to go next

- [scripts.md](./scripts.md) — the build/asset pipeline and the offline debug tools under `scripts/debug/`.
- [build-flags.md](./build-flags.md) — viewer/debugger build flags.
- [e2e.md](./e2e.md) / [test-coverage.md](./test-coverage.md) — the test lanes.
