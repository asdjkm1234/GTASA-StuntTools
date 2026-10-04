/**
 * File System Access wiring for {@link InstallSource} (plan 053, phase 5). Walks the user-picked raw GTA
 * install once to index every file handle, then hands the handle index to the shared assembly
 * (`install-source-core.ts`) which opens `gta3.img` and merges **every other `models/*.img`** (gta_int.img +
 * any mod archives the install ships, e.g. our cell-LOD `lods.img`, gostown's `gostown6.img`) into one lazy
 * override archive, and serves loose files on demand. Mirrors the fetch build's `gta3` +
 * `mergeArchives(overrides)` split — otherwise models a mod adds in a separate IMG (like `lod_<cx>_<cy>.dff`
 * in `lods.img`) resolve to nothing and are dropped. Chromium-only.
 */
import type { InstallSource } from './build-vfs';

import { fileHandleSource } from './img-reader';
import { assembleInstallSource } from './install-source-core';

/** Build an {@link InstallSource} over a picked install directory (opens the IMG archives lazily). */
export async function browserInstallSource(dir: FileSystemDirectoryHandle): Promise<InstallSource> {
  const handles = new Map<string, FileSystemFileHandle>();
  for await (const file of walkFiles(dir)) {
    handles.set(file.path, file.handle);
  }
  const require = (path: string, label = 'file'): FileSystemFileHandle => {
    const handle = handles.get(path);
    if (!handle) {
      throw new Error(`${label} not found: ${path}`);
    }

    return handle;
  };

  return assembleInstallSource({
    archiveSource: (path) => fileHandleSource(require(path, 'archive')),
    // The File is a disk-backed Blob — `slice()` reads ranges lazily (the pak worker's range mode over a
    // local file). Paths are indexed lowercased, so callers pass lowercased keys (e.g. `opensa/world.ospak`).
    openLoose: async (path) => {
      const handle = handles.get(path);

      return handle ? await handle.getFile() : null;
    },
    paths: [...handles.keys()],
    readLoose: async (path) => new Uint8Array(await (await require(path, 'loose file').getFile()).arrayBuffer()),
  });
}

/** Recursively yield every file handle under `dir` with its lowercased, `/`-joined relative path. */
async function* walkFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      yield { handle: entry, path: path.toLowerCase() };
    } else {
      yield* walkFiles(entry, path);
    }
  }
}
