/**
 * The local asset loader (plan 053): reads a user-picked **raw GTA San Andreas install** folder via the File
 * System Access API and converts it in-browser to the same in-memory VFS the fetch loader produces — so the
 * downstream flow is identical. The picked folder handle is remembered (IndexedDB) and not re-prompted unless
 * it becomes invalid. Chromium-only; opt-in via `VITE_ASSET_LOADER=local`.
 *
 * The InstallSource → VFS work (`init` / `load` / `openWorld`) lives in {@link InstallSourceLoader}; this class
 * adds only the user-gesture folder acquisition. `prepare()` does the one gesture step (the folder prompt) and
 * is called from the Play click; `resolveSource()` opens the picked folder into an {@link InstallSource}.
 */
import type { InstallSource } from './build-vfs';
import type { RestoredDir } from './dir-handle-store';

import { browserDirHandleDeps, pickDir, restoreDir } from './dir-handle-store';
import { browserInstallSource } from './install-source';
import { type InstallLoaderConfig, InstallSourceLoader } from './install-source-loader';

export type AssetLocalLoaderConfig = InstallLoaderConfig;

/** Seams for testing without the File System Access API; default to the real browser wiring. */
export interface AssetLocalLoaderDeps {
  /** Resolve a usable directory, prompting if needed (USER GESTURE) — given the boot-restored handle. */
  acquireDir: (stored: FileSystemDirectoryHandle | null) => Promise<FileSystemDirectoryHandle>;
  /** Open an {@link InstallSource} over a directory handle. */
  openSource: (dir: FileSystemDirectoryHandle) => Promise<InstallSource>;
  /** Boot-time (no gesture): load the remembered handle + whether it is already usable. */
  restoreDir: () => Promise<RestoredDir>;
}

export class AssetLocalLoader extends InstallSourceLoader {
  private readonly deps: AssetLocalLoaderDeps;
  private dir: FileSystemDirectoryHandle | null = null;
  private stored: FileSystemDirectoryHandle | null = null;

  constructor(config: AssetLocalLoaderConfig, deps?: Partial<AssetLocalLoaderDeps>) {
    super(config);
    this.deps = {
      acquireDir:
        deps?.acquireDir ?? ((stored): Promise<FileSystemDirectoryHandle> => pickDir(browserDirHandleDeps(), stored)),
      openSource: deps?.openSource ?? browserInstallSource,
      restoreDir: deps?.restoreDir ?? ((): Promise<RestoredDir> => restoreDir(browserDirHandleDeps())),
    };
  }

  /**
   * The gesture-bound folder step — called from the Play click. Uses the boot-restored handle (so the picker /
   * permission request is the first await and keeps the user activation). A denied/cancelled prompt rejects;
   * the stored handle is forgotten so the next click prompts afresh.
   */
  async prepare(): Promise<void> {
    if (this.dir) {
      return;
    }
    try {
      this.dir = await this.deps.acquireDir(this.stored);
    } catch (error) {
      this.stored = null;
      throw error;
    }
  }

  /** `true` once a folder has been acquired (via {@link prepare} or an already-granted {@link restore}). */
  ready(): boolean {
    return this.dir !== null;
  }

  /** Boot-time (no gesture): restore the remembered folder so {@link prepare} can skip / shorten the prompt. */
  async restore(): Promise<void> {
    const { handle, ready } = await this.deps.restoreDir();
    this.stored = handle;
    if (ready && handle) {
      this.dir = handle;
    }
  }

  protected resolveSource(): Promise<InstallSource> {
    if (!this.dir) {
      throw new Error('install folder not selected — call prepare() from a user gesture first');
    }

    return this.deps.openSource(this.dir);
  }
}
