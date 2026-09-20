# Boot & asset loading

How a game gets from a source (hosted chunks, a picked GTA install, or a served build dir) into a running
world. Feature detail: [features/asset-loader.md](../features/asset-loader.md),
[features/ui-shell.md](../features/ui-shell.md).

## The three loaders, one VFS

`createAssetLoader` (`packages/loaders/src/index.ts`) picks the loader from the game's config
(`GAME_CONFIG[game].assetLoader`) or the dev override `?loader=http-dir&src=<url>`:

| Kind       | Class                | Source                                                      | Caches?                                         |
| ---------- | -------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `fetch`    | `AssetFetchLoader`   | hosted chunk archives + `manifest.json`                     | Cache Storage, keyed by build                   |
| `local`    | `AssetLocalLoader`   | user-picked GTA install (File System Access, Chromium-only) | no — reads the disk every boot                  |
| `http-dir` | `AssetHttpDirLoader` | a **served** game dir (`serve-static` mounts `./build`)     | no — dev surfaces read the canonical build live |

All three fill the same `Vfs` (`packages/vfs`) through the `AssetSink` interface (`addChunk` unzips fetch
chunks via fflate; `addFiles` ingests raw files), and `Vfs` implements `AssetFileSystem` — everything
downstream is loader-agnostic. The VFS reaches the game unwrapped: **mods are installed at BUILD time**, by
`mod-installer` / `vehicle-installer` into the game dir the loaders then read
([postmortem](../postmortem/runtime-modloader-overlay.md)).

![Loader chain](./assets/loader-chain.svg)

<details><summary>diagram source</summary>

```mermaid
%%| loader-chain
flowchart LR
  chunks[("hosted chunks<br/>+ manifest.json")]:::data
  folder[("picked GTA install<br/>(File System Access)")]:::data
  served[("served build dir<br/>serve-static /build")]:::data

  fetch["AssetFetchLoader<br/>verify + Cache Storage"]:::infra
  local["AssetLocalLoader<br/>folder prompt + IndexedDB restore"]:::infra
  httpdir["AssetHttpDirLoader<br/>__index + HTTP Range"]:::infra
  base["InstallSourceLoader (base)<br/>selectInstallEntries → groups"]:::infra

  vfs["Vfs<br/>AssetSink → AssetFileSystem"]:::infra
  game[["game + engine"]]:::engine
  pak["openWorld(name) →<br/>opensa/&lt;name&gt; from the SAME source"]:::data

  chunks --> fetch --> vfs
  folder --> local --> base
  served --> httpdir --> base
  base --> vfs
  vfs --> game
  base -.-> pak -.->|LocalPakSource| game

  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

</details>

### Fetch loader (`asset-fetch-loader/`)

- `init()` fetches `manifest.json` with `cache: 'no-store'`; a failed manifest fetch/parse **wipes the whole
  cache bucket** and rethrows — that's build revocation. Stale cached chunks are evicted (`staleKeys`).
- `load()` downloads with a concurrency limit (4): the never-cached `data` group goes **first** as a
  build-liveness probe, then the cacheable groups — so a revoke wipe stays atomic.
- Every chunk is verified (byte length always, SHA-1 12-hex prefix when the manifest carries one) before it
  reaches the sink. Cache Storage degrades to a silent no-op in insecure contexts (plain `http://` LAN).

### Install-source loaders (`asset-local-loader/`)

`InstallSourceLoader` is the shared base (plan 079); subclasses differ only in `resolveSource()`:

- **`AssetLocalLoader`** — `prepare()` shows the folder prompt inside the Play-click gesture, `restore()`
  re-opens a remembered folder from IndexedDB without a gesture. Source = `browserInstallSource(dir)`.
- **`AssetHttpDirLoader`** — `fetchDirIndex(base)` GETs `${base}/__index` (served by `scripts/serve-static.ts`'s
  `/build` mount), archives are read lazily over **HTTP Range** (`urlRangeSource`).

Both assemble the same `InstallSource` (`install-source-core.ts`): `models/gta3.img` is required (throws if
absent), every other `models/*.img` merges as one lazy override layer (`gta_int.img` first, then mod archives
such as `lods.img`). `selectInstallEntries` ports the build-script selection: IPL-placed models, **every**
ped and vehicle from `peds.ide`/`vehicles.ide`, procobj clutter, loose files, and the world pak.

### The pak-source rule (plan 079)

**The loading mode selects the world.** If the loader has `openWorld`, boot passes a `LocalPakSource` to the
engine and the world pak is read as `opensa/<name>` **from the picked/served install**; a missing file returns
`null` and streaming fails loudly. Only fetch mode (no `openWorld`) falls back to the hosted
`/${?src ?? 'pak-map'}` URL. There is no `public/` fallback in folder/http-dir mode — that silent shadow is
exactly the bug 079 removed.

## Boot flow (`apps/web`)

`boot-machine.ts` is a pure reducer over `BootPhase`
(`menu → disclaimer/folder → loading → warmup → playing ⇄ paused`, `error` + 3 retries). Nothing downloads
until a game is picked. `use-asset-boot.ts` owns the session (`loader + vfs`), runs
`init → load → vfs.verify` per attempt, and exposes `pakSource` + progress. `EngineCanvasHost` lazily builds
the engine, calls `setupStreaming(engine, pakSource, { lodRadius })`, and fires `WORLD_READY` once streaming
settles (`pendingCells === 0 && created > 0`, or a timeout backstop).

**Boot does not populate the world any more** (2026-08-02). `setupEngineVehicles` used to `await` a spawn for
every `parked.json` placement — 212 cars for stock `original`, most of them far outside the collision radius,
where they had nothing to stand on. Both car populations are now REGISTERED with the vehicle LOD system and
materialise by distance, so the function is synchronous and boot builds no vehicles at all. Each population
prints its size once (`[vehicles] parked placements registered: N`,
`[vehicles] map car generators registered: N`) — see
[`restrictions/architecture.md`](../restrictions/architecture.md). Map car generators are registered by
`EngineCanvasHost` rather than inside `setupEngineVehicles`, because resolving a random generator needs the
`map.zon` city boxes, which are built later in the boot closure.

![Boot flow](./assets/boot-flow.svg)

<details><summary>diagram source</summary>

```mermaid
%%| boot-flow
flowchart TB
  a([main → App]):::ui --> m["MENU · lists GAME_CONFIG games<br/>(nothing downloads yet)"]:::ui
  m -->|fetch game| d["disclaimer · every launch"]:::ui
  m -->|local game| f["folder prompt · + disclaimer"]:::ui
  d --> l["loading · data → others → models → textures<br/>loader → vfs → verify"]:::infra
  f --> l
  l --> w["warmup · lazy canvas-host<br/>build Game + adapter, setupStreaming"]:::engine
  w -->|world-ready<br/>pendingCells 0 + created &gt; 0| p([PLAYING]):::engine
  p -->|Esc| pa["paused"]:::ui
  pa -->|continue| p
  l -. fail .-> e["error + retry"]:::data
  w -. fail .-> e
  e -->|retry ×3| l
  e -->|exhausted| m

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

</details>

### What boot may tell the UI, and when

The React chrome reaches the game's `EventBus` only once `boot()` has RESOLVED: `EngineCanvasHost` publishes
`hudGameRef` through `booted.then(...)`, and `<Hud>` mounts after that. Anything the boot closure emits while
it is still booting therefore goes to an empty bus — events are not queued or replayed.

So a mode that changes the chrome from inside boot (video mode's UI hide is the one that exists) must expose
its state on the `HudGame` surface and let the chrome READ it on mount, with the event carrying only later
changes. `getFlyCamera()` joins `getTime()`/`getZone()` in being exactly that. The rule and the probe that
checks it: `docs/restrictions/architecture.md`.

### Version guard

`opensa-pack` stamps `buildTime` into the pak's `manifest.json`; `setupStreaming` surfaces it and the F2
debugger shows it as a grey `build HH:mm DD-MM-YYYY` line — every dev surface displays which build it is
actually reading. If two surfaces disagree, one of them is not on the canonical build.
