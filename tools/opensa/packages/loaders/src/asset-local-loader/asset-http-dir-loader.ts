/**
 * The http-dir asset loader (plan 079 phase 1): loads the game from a perfect-map-builder output served
 * statically over HTTP. No folder picker — the served dir's `__index` gives the file listing, and every file
 * is a Range/GET away ({@link fetchInstallSource}). This is the harness's real load path (was: a fake picker)
 * and the way the app runs against the one canonical build. Opt-in per session with `?loader=http-dir&src=`.
 */
import type { InstallSource } from './build-vfs';

import { fetchDirIndex, fetchInstallSource } from './fetch-install-source';
import { type InstallLoaderConfig, InstallSourceLoader } from './install-source-loader';

export class AssetHttpDirLoader extends InstallSourceLoader {
  constructor(
    config: InstallLoaderConfig,
    private readonly base: string,
  ) {
    super(config);
  }

  protected async resolveSource(): Promise<InstallSource> {
    return fetchInstallSource(this.base, await fetchDirIndex(this.base));
  }
}
