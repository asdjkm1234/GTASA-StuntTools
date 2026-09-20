# Asset loaders

`packages/loaders/src/` — standalone, framework-agnostic (no React, no `game`). Resolves the game's assets into the
VFS behind one contract; the loader kind is chosen **per game** by its `assetLoader` in `GAME_CONFIG`
(plan 056). Plans [049](../plans/049-asset-loader/readme.md) (fetch) + [053](../plans/053-asset-local-loader/readme.md)
(local + restructure).

## Layout

```
packages/loaders/src/
  index.ts            # createAssetLoader(config) factory (per-game assetLoader) + public re-exports
  types.ts            # shared contract: AssetLoader + Manifest/GroupName/AssetSink/ProgressSnapshot/…
  manifest.ts         # manifest helpers (parseManifest, allChunks, chunkUrl, …) — pure
  emitter.ts          # typed event emitter   |   progress.ts — ProgressTracker (pure)
  asset-fetch-loader/ # AssetFetchLoader (manifest + chunk download)  + cache-store.ts, invalidate.ts
  asset-local-loader/ # AssetLocalLoader (user-picked raw GTA install) + dir-handle-store, img-reader, …
```

The boot flow (`use-asset-boot.ts`) creates **one** `AssetLoader` per selected game via `createAssetLoader(...)`
(passing the game's `assetLoader`); everything downstream (VFS, renderer) is loader-agnostic.

```ts
interface AssetLoader {
  readonly events: Emitter<AssetLoaderEvents>;
  init(): Promise<Manifest>; // fetch+parse manifest / prompt+scan the install
  load(groups?: readonly GroupName[]): Promise<void>; // make groups present in the VFS sink
  prepare?(): Promise<void>; // local only: the user-gesture folder prompt
  restore?(): Promise<void>; // local only: boot-time restore of the remembered folder
  ready?(): boolean; // local only: folder acquired?
}
```

## Fetch loader (`asset-fetch-loader/`, plan 049)

Turns the build's chunk manifest into a cached, on-demand download pipeline.

- **Manifest** (`manifest.ts`, pure): `parseManifest` (validates `{ chunks: { data, models, others, textures },
game, version }`; each chunk is `{ bytes, cached, entries, file, hash }`), `manifestDir`, `chunkUrl`, `allChunks`
  (data → others → models → textures, group-tagged), `chunkUrls`. `GROUP_NAMES` is the load order; `CORE_GROUPS`
  (everything but textures) is the first boot phase.
- **`AssetFetchLoader`**: `init()` fetches the manifest (`cache: 'no-store'`) then **invalidates** stale cache
  entries; `load(groups?)` ensures the given groups' chunks are present (download streamed, concurrency-limited,
  **skips cached**), verifying byte length (+ optional SHA-1). Partial/failed downloads are never cached.
  Hands each ready chunk's **raw zip bytes** to the `AssetSink` (the VFS); never unzips.
- **Caching policy** (per-chunk `cached`, set by the build's `CACHED` map): `cached: true` chunks
  (models/textures/others) are read from / written to Cache Storage. `cached: false` chunks (the `data`
  group) are **always re-fetched** and never stored — `data` doubles as a **build-liveness probe**.
  `load` fetches the non-cached probe **before** any cacheable chunk; if it fails (e.g. the server returns
  404 because the build was revoked), the loader **wipes the entire cache** (`CacheStore.clear`) and rejects.
  Doing the probe first makes the wipe atomic — no cacheable chunk can race back in after it. The **manifest
  itself** is the same liveness signal: if `init()` can't fetch/parse it (404/revoked or network/parse error),
  it likewise wipes the whole cache before rejecting.
- **Cache** (`cache-store.ts`): Cache Storage, one named bucket, keyed by content-hashed chunk URL.
  **Invalidation** in `invalidate.ts` (pure `staleKeys`); **`clear()`** drops the whole bucket (revoke).
  Cache Storage needs a **secure context** (https / localhost); over plain `http://` (e.g. a phone on a LAN
  IP) `caches` is undefined, so every op degrades to a no-op — nothing is cached and assets re-download each
  visit (no crash). **And it SAYS so** (plan 200/4-06): `cacheStorageStatus()` reports availability plus the
  reason — discriminating on `isSecureContext`, because "serve over https" is the wrong advice for a secure
  context that simply has no Cache Storage — the loader logs one line before the first byte, and the shell's
  preloader carries it as a standing note. A silent no-op costs the whole game again on the next visit.

## Local loader (`asset-local-loader/`, plan 053)

Reads a **user-picked raw GTA San Andreas install** folder via the File System Access API and converts it
in-browser to the same VFS — so the downstream flow is identical. **Chromium-only; opt-in** per game
(`assetLoader: 'local'` in `GAME_CONFIG`).

- **Folder handle** (`dir-handle-store.ts`): persisted in IndexedDB and remembered across visits.
  `restoreDir` (boot, no gesture) loads it; `pickDir` (the Play-folder gesture) makes the picker /
  `requestPermission` its **first** await so the user activation isn't lost across an IndexedDB read.
- **Lazy IMG reader** (`img-reader.ts`): reads only the VER2 directory up front, then slices each needed
  entry's byte range from disk — never buffers the ~1 GB `gta3.img`. VER2 parsing shared from
  `renderware/archive`.
- **Selection** (`build-vfs.ts`): the shared partition (`packages/game-build/src/partition.ts` —
  `partitionEntries` + `looseGroup`) run in-browser — exterior-placed models/textures,
  `.col`, the loose `data/`/anim/text files, and the `gta3.img` ipl/ifp/dat, **plus** the dynamic models
  (`dynamicModelRefs`): **every** ped from `peds.ide`, **every** vehicle from `vehicles.ide`, and procobj
  clutter from `procobj.dat`.
- **`AssetLocalLoader`**: `restore()` (boot) → `prepare()` (folder gesture) → `init()` (scan+select →
  one synthetic chunk per group) → `load()` (read selected bytes into the VFS, count-based progress).
- **Boot gate**: the shell shows the game menu; picking a local game opens the **folder prompt**
  (`FolderPrompt`, `boot-machine` `folder` phase, with the game's disclaimer) → load. See [ui-shell](ui-shell.md).

## HTTP-dir loader (`asset-local-loader/`, plan 079)

The dev-only sibling of the local loader: instead of a user-picked folder, it reads a **served** game dir
over HTTP so every dev surface (lab, bench harness, viewers) can boot the one canonical build
(`./build/original`) without the folder gesture. Selected with `?loader=http-dir&src=<url>` (read in
`use-asset-boot.ts`); never a per-game default.

- **Shared core** (`install-source-core.ts`, `assembleInstallSource`): the local and http-dir loaders both
  build an `InstallSource` (openLoose/gta3/gtaInt/readLoose) and run the **same** `build-vfs.ts` selection —
  the only difference is where the bytes come from.
- **`fetchInstallSource`** (`fetch-install-source.ts`): assembles an `InstallSource` from a served dir —
  `fetchDirIndex` walks the server's `/__index` listing; loose files are ranged/fetched by URL, and the IMG
  archives use the lazy `urlRangeSource` (`img-reader.ts`, a `ByteRangeSource` over HTTP `Range`) so the
  ~1 GB `gta3.img` is never buffered — identical laziness to the disk path.
- **`InstallSourceLoader`** (base) / **`AssetHttpDirLoader`**: the http-dir loader extends the shared
  `InstallSourceLoader`; `init()` fetches+selects, `load()` reads selected bytes into the VFS. No `prepare`/
  `restore`/`ready` — there is no folder gesture to guard.
- Served by `scripts/serve-static.ts`'s `/build` mount (a `dirIndex()` walk answers `/__index`); see
  [scripts.md](../development/scripts.md).

## Progress + events

Typed emitter (`emitter.ts`): `progress` (global `{ loadedBytes, loadedChunks, totalBytes, totalChunks }`),
`chunk` (per-chunk `cached`/`downloading`/`done`/`error`), `chunkReady`, `error`. Fetch aggregates bytes;
local emits count-based progress per file.

## Virtual File System — `packages/vfs/src/` (plan 050)

The `AssetSink` consumer. `Vfs implements AssetSink, AssetFileSystem`:

- `addChunk(group, file, zipBytes)` — unzip (fflate) + index by name (fetch loader).
- `addFiles(chunkId, entries)` — raw ingest of already-unzipped name→bytes (local loader), accounting like
  `addChunk` so `verify(manifest)` works against the local loader's **synthesised** manifest.
- `get`/`getText`/`has`/`names`; `verify(manifest)` (delivered chunk + entry totals; `verify.ts` is pure).
- **Keys** = names as packed: bare for archive files (`cj.dff`, `la.col`), relative paths for loose files
  (`data/gta.dat`). The game reads everything through `AssetFileSystem`.

## Known gaps / candidates

- Local loader is **Chromium-only** (File System Access); `fetch` stays the default everywhere else.
- Lazy per-file inflate for the fetch path (decompress on `get`) if the eager-unzip footprint bites.

## Test coverage anchors

- Unit: `loaders/{manifest,emitter,progress}.test.ts`, `asset-fetch-loader/invalidate.test.ts`,
  `asset-local-loader/{dir-handle-store,img-reader,build-vfs,asset-local-loader}.test.ts`, `vfs/{verify,vfs}.test.ts`.
- e2e (browser IO): `e2e/asset-fetch-loader.spec.ts` (download/progress/sink, skip-if-cached, invalidation,
  error, cache-wipe on a revoked `data` probe **or** manifest) and `e2e/asset-local-loader.spec.ts`
  (fake FSA tree → walk + lazy reader + selection + VFS, verify clean).
