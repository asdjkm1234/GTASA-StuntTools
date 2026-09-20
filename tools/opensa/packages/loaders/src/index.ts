/**
 * Asset loaders (plans 049 + 053): the boot flow drives one {@link AssetLoader} chosen per game by its
 * `assetLoader` — `fetch` (manifest + chunk download) or `local` (a user-picked raw install). Both fill the
 * same VFS, so everything downstream is loader-agnostic. Public surface of the loaders module.
 */
import type { AssetLoader, AssetLoaderKind, AssetSink } from './types';

import { AssetFetchLoader } from './asset-fetch-loader';
import { AssetHttpDirLoader, AssetLocalLoader } from './asset-local-loader';

export { AssetFetchLoader, type AssetFetchLoaderConfig, cacheStorageStatus } from './asset-fetch-loader';
export {
  assembleInstallSource,
  AssetHttpDirLoader,
  AssetLocalLoader,
  type AssetLocalLoaderConfig,
  browserInstallSource,
  type DirIndexEntry,
  fetchDirIndex,
  fetchInstallSource,
  type InstallIo,
  type InstallPlan,
  type InstallSource,
  readEntry,
  selectInstallEntries,
} from './asset-local-loader';
export { Emitter, type Listener } from './emitter';
export { allChunks, chunkUrl, chunkUrls, CORE_GROUPS, GROUP_NAMES, manifestDir, parseManifest } from './manifest';
export type {
  AssetLoader,
  AssetLoaderEvents,
  AssetLoaderKind,
  AssetSink,
  ChunkInfo,
  ChunkStatus,
  GroupChunk,
  GroupName,
  Manifest,
  ProgressSnapshot,
} from './types';

/** Everything {@link createAssetLoader} needs for any loader; unused fields are ignored by the others. */
export interface CreateAssetLoaderConfig {
  /** Which loader to build for this game. */
  assetLoader: AssetLoaderKind;
  /** The served game-dir base URL — required for `http-dir` (`?src=`), ignored otherwise. */
  base?: string;
  /** Read-back view of the sink (the VFS) — lets the fetch loader's `openWorld` serve the pak files its
   *  chunks delivered (plan 086 phase 3). */
  files?: { get(name: string): ArrayBuffer | null };
  /** Build variant (e.g. `gostown`) — labels the local loader's synthesised manifest. */
  game: string;
  /** Full URL to `manifest.json` — used by the fetch loader. */
  manifestUrl: string;
  /** Where resolved bytes go — the VFS. */
  sink?: AssetSink;
  /** Build version string. */
  version: string;
}

/** Build the loader for a game's configured (or session-overridden) `assetLoader`. */
export function createAssetLoader(config: CreateAssetLoaderConfig): AssetLoader {
  const install = { game: config.game, sink: config.sink, version: config.version };
  if (config.assetLoader === 'http-dir') {
    if (!config.base) {
      throw new Error('http-dir loader needs a served game-dir base URL (?src=)');
    }

    return new AssetHttpDirLoader(install, config.base);
  }
  if (config.assetLoader === 'local') {
    return new AssetLocalLoader(install);
  }

  return new AssetFetchLoader({
    ...(config.files ? { files: config.files } : {}),
    manifestUrl: config.manifestUrl,
    sink: config.sink,
  });
}
