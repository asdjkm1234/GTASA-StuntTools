/**
 * HTTP wiring for {@link InstallSource} (plan 079 phase 1). The served-dir twin of `install-source.ts`: given a
 * base URL and a flat file index (a `{ path, size }[]` listing the server exposes), it opens the IMG archives
 * over Range requests and serves loose files with plain GETs. Lets a perfect-map-builder output served
 * statically be the game's VFS with no folder picker — the harness's real load path (was: a fake picker).
 */
import type { InstallSource } from './build-vfs';

import { urlRangeSource } from './img-reader';
import { assembleInstallSource } from './install-source-core';

/** One entry of a served dir's file index (a flat walk the server exposes, e.g. `/__index`). */
export interface DirIndexEntry {
  path: string;
  size: number;
}

/** Fetch a served dir's flat file index from `${base}/__index` (served by serve-static's `/build` mount). */
export async function fetchDirIndex(base: string): Promise<DirIndexEntry[]> {
  const response = await fetch(`${base}/__index`);
  if (!response.ok) {
    throw new Error(
      `no __index at ${base}/__index (${response.status}) — serve the build with \`npm run serve:static\` ` +
        `(the /build mount), and point ?src= at a game dir under it`,
    );
  }

  return (await response.json()) as DirIndexEntry[];
}

/** Build an {@link InstallSource} over a game dir served at `base` (files reachable at `${base}/<path>`). */
export function fetchInstallSource(base: string, index: readonly DirIndexEntry[]): Promise<InstallSource> {
  const sizes = new Map<string, number>();
  for (const entry of index) {
    sizes.set(entry.path.toLowerCase(), entry.size);
  }
  const url = (path: string): string => `${base}/${path}`;
  const readLoose = async (path: string): Promise<Uint8Array> => {
    const response = await fetch(url(path));
    if (!response.ok) {
      throw new Error(`loose file not found: ${path} (${response.status})`);
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  return assembleInstallSource({
    archiveSource: (path) => Promise.resolve(urlRangeSource(url(path), sizes.get(path) ?? 0)),
    openLoose: async (path) => {
      const response = await fetch(url(path));

      return response.ok ? await response.blob() : null;
    },
    paths: [...sizes.keys()],
    readLoose,
  });
}
